import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {embedded,type Database} from "../lib/db";
import {Publishing,PublicationValidationError,PUBLICATION_ACKNOWLEDGEMENT,type PublishInput,type PublishingAccount,type PublishingRuntime} from "../lib/publishing";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {CAPSULE,ROLES,hash} from "../lib/domain";
import {variantFixture} from "./variant-fixture";
import {PGlite} from "@electric-sql/pglite";
import {SCHEMA} from "../lib/schema";
import {MANUAL_PUBLICATION_SCHEMA} from "../lib/manual-publication-schema";
import {platformVariants} from "../lib/platform-variants";
import type {Output,Source} from "../lib/domain";

const WHEN="2026-10-20T08:00:00.000Z",NOW=new Date(WHEN);
const TEXT="Proposed approach: inspect one cleared source.";
const ACCOUNT:PublishingAccount={id:"manual-linkedin-owner",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Isolated owner profile",enabled:true,verified:true,authorization_version:"manual-consent-v1",scopes:["w_member_social"],linkedin_version:"202609"};
const OTHER:PublishingAccount={...ACCOUNT,id:"manual-linkedin-other",remote_id:"urn:li:person:67890"};
const success:typeof fetch=async()=>new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:98765"}});
function runtime(fetcher:typeof fetch,extra:Partial<PublishingRuntime>={}):PublishingRuntime{
  return {enabled:true,credential_use_authorized:true,scheduler_authorized:false,max_lateness_seconds:300,now:()=>NOW,accounts:[{...ACCOUNT},{...OTHER}],credential:async()=>"isolated-manual-test-token",fetch:fetcher,...extra};
}
async function seed(db:Database){
  const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
  for(const role of ROLES){
    const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: inspect a draft":role==="Platform Adapter"?variantFixture(TEXT):TEXT;
    await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);
  }
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  const outputs=await db.query<{hash:string}>("SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]),version=hash(outputs.map(item=>item.hash).join("|"));
  await store.approve(task.id,version);
  const input:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:"original:"+version,platform:"LinkedIn",account_id:ACCOUNT.id,scheduled_at:WHEN,delivery_mode:"manual",payload:{text:TEXT}};
  return {store,source,task,input};
}
async function fixture(work:(db:Database,context:Awaited<ReturnType<typeof seed>>)=>Promise<void>){
  const db=await embedded();try{await work(db,await seed(db));}finally{await db.close();}
}
async function refuses(work:Promise<{status:string}>){
  try{const result=await work;assert.notEqual(result.status,"published");return result.status;}
  catch(error){assert(error instanceof PublicationValidationError);return "validation-error";}
}

test("manual publishing is server-disabled by default and credential permission is separately required",()=>fixture(async(db,{input})=>{
  let transmissions=0,credentials=0;
  const config=runtime(async()=>{transmissions++;return success("unused");},{enabled:undefined,credential:async()=>{credentials++;return "isolated-token";}}),publisher=new Publishing(db,config);
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  assert.equal((await publisher.snapshot()).enabled,false);
  assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"disabled");
  config.enabled=true;config.credential_use_authorized=false;
  assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"blocked");
  assert.equal(transmissions,0);assert.equal(credentials,0);
  assert.equal((await publisher.snapshot()).jobs[0].status,"approved");
}));

test("manual click cannot approve a staged job and needs a strict acknowledgement plus exact approval record",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");})),row=await publisher.enqueue(input);
  assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"blocked");
  assert.equal((await publisher.snapshot()).approvals.length,0);
  await publisher.approve(row.id,row.version,true);
  for(const acknowledged of [false,undefined,"true",1])await assert.rejects(publisher.publishNow(row.id,row.version,ACCOUNT.id,acknowledged as boolean),PublicationValidationError);
  const missing=await publisher.enqueue({...input,request_id:randomUUID(),account_id:OTHER.id});
  await db.query("UPDATE publishing_outbox SET status='approved' WHERE id=$1",[missing.id]);
  assert.equal((await publisher.publishNow(missing.id,missing.version,OTHER.id,true)).status,"blocked");
  const wrongAcknowledgement=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T07:59:59Z"});
  await db.query("INSERT INTO publishing_approvals(id,outbox_id,version,acknowledgement) VALUES($1,$2,$3,$4)",[randomUUID(),wrongAcknowledgement.id,wrongAcknowledgement.version,PUBLICATION_ACKNOWLEDGEMENT]);
  await db.query("UPDATE publishing_outbox SET status='approved' WHERE id=$1",[wrongAcknowledgement.id]);
  assert.equal((await publisher.publishNow(wrongAcknowledgement.id,wrongAcknowledgement.version,ACCOUNT.id,true)).status,"blocked");
  assert.equal(calls,0);assert.equal((await publisher.snapshot()).approvals.length,2);
}));

test("manual invocation is bound to the exact id, version, account, and mode without queue fallback",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");}));
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  const other=await publisher.enqueue({...input,request_id:randomUUID(),account_id:OTHER.id});await publisher.approve(other.id,other.version,true);
  const scheduled=await publisher.enqueue({...input,request_id:randomUUID(),delivery_mode:"scheduled"});await publisher.approve(scheduled.id,scheduled.version,true);
  for(const args of [
    [randomUUID(),row.version,ACCOUNT.id],
    [row.id,"0".repeat(64),ACCOUNT.id],
    [row.id,row.version,OTHER.id],
    [other.id,row.version,OTHER.id],
    [scheduled.id,scheduled.version,ACCOUNT.id]
  ])await assert.rejects(publisher.publishNow(args[0],args[1],args[2],true),PublicationValidationError);
  assert.equal(calls,0);assert((await publisher.snapshot()).jobs.every(job=>job.status==="approved"));
}));

test("manual publishing refuses future and late target jobs without dispatching a different due job",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");}));
  const due=await publisher.enqueue(input);await publisher.approve(due.id,due.version,true);
  const future=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:01:00Z"});await publisher.approve(future.id,future.version,true);
  const late=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T07:54:59Z"});await publisher.approve(late.id,late.version,true);
  await refuses(publisher.publishNow(future.id,future.version,ACCOUNT.id,true));
  assert.equal((await publisher.publishNow(late.id,late.version,ACCOUNT.id,true)).status,"blocked");
  const state=await publisher.snapshot();assert.equal(state.jobs.find(job=>job.id===due.id)?.status,"approved");assert.equal(state.jobs.find(job=>job.id===late.id)?.status,"missed");assert.equal(calls,0);
}));

test("manual mode is bound into intent identity and a mode revision requires fresh publication approval",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");}));
  const {delivery_mode,...defaultInput}=input;void delivery_mode;
  const scheduled=await publisher.enqueue(defaultInput);assert.equal(scheduled.delivery_mode,"scheduled");await publisher.approve(scheduled.id,scheduled.version,true);
  await assert.rejects(publisher.enqueue({...input,request_id:defaultInput.request_id}),/request id reused/);
  const manual=await publisher.revise(scheduled.id,scheduled.version,input);
  assert.equal(manual.delivery_mode,"manual");assert.notEqual(manual.version,scheduled.version);assert.equal(manual.status,"staged");
  await assert.rejects(publisher.publishNow(manual.id,scheduled.version,ACCOUNT.id,true),PublicationValidationError);
  assert.equal((await publisher.publishNow(manual.id,manual.version,ACCOUNT.id,true)).status,"blocked");
  assert.equal((await publisher.snapshot()).approvals.length,1);
  await publisher.approve(manual.id,manual.version,true);assert.equal((await publisher.publishNow(manual.id,manual.version,ACCOUNT.id,true)).status,"published");assert.equal(calls,1);
}));

test("scheduler never selects a manual job and manual delivery does not require a scheduler",()=>fixture(async(db,{input})=>{
  const requests:string[]=[];const config=runtime(async(_url,init)=>{requests.push(JSON.parse(String(init?.body)).author);return success("unused");},{scheduler_authorized:true,scheduler_interval_seconds:60}),publisher=new Publishing(db,config);
  const manual=await publisher.enqueue(input);await publisher.approve(manual.id,manual.version,true);
  const scheduled=await publisher.enqueue({...input,request_id:randomUUID(),account_id:OTHER.id,delivery_mode:"scheduled"});await publisher.approve(scheduled.id,scheduled.version,true);
  const dispatched=await publisher.dispatch(NOW);assert.equal(dispatched.status,"published");assert.equal(dispatched.id,scheduled.id);assert.deepEqual(requests,[OTHER.remote_id]);
  assert.equal((await publisher.dispatch(NOW)).status,"idle");assert.equal((await publisher.snapshot()).jobs.find(job=>job.id===manual.id)?.status,"approved");
  config.scheduler_authorized=false;config.scheduler_interval_seconds=undefined;
  assert.equal((await publisher.publishNow(manual.id,manual.version,ACCOUNT.id,true)).status,"published");assert.deepEqual(requests,[OTHER.remote_id,ACCOUNT.remote_id]);
}));

test("manual delivery keeps configured account permissions, valid lateness, and X spend gates",()=>fixture(async(db,{input})=>{
  let calls=0,credentials=0;const config=runtime(async()=>{calls++;return success("unused");},{credential:async()=>{credentials++;return "isolated-token";}}),publisher=new Publishing(db,config);
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  for(const lateness of [0,-1,3601,1.5,NaN]){
    config.max_lateness_seconds=lateness;assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"blocked");
  }
  config.max_lateness_seconds=300;config.accounts![0].scopes=[];
  assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"blocked");
  config.accounts!.push({id:"manual-x-owner",platform:"X",remote_id:"11223",label:"Isolated X",enabled:true,verified:true,authorization_version:"v1",scopes:["tweet.write","tweet.read","users.read"]});
  const x=await publisher.enqueue({...input,request_id:randomUUID(),platform:"X",account_id:"manual-x-owner"});await publisher.approve(x.id,x.version,true);
  const result=await publisher.publishNow(x.id,x.version,"manual-x-owner",true);assert.equal(result.status,"blocked");assert.match("reason" in result?result.reason||"":"",/cost approval/);
  assert.equal(calls,0);assert.equal(credentials,0);
}));

test("manual delivery records exactly one mocked official receipt for concurrent and duplicate clicks",()=>fixture(async(db,{input})=>{
  let calls=0,credentials=0;const publisher=new Publishing(db,runtime(async(url,init)=>{
    calls++;assert.equal(url,"https://api.linkedin.com/rest/posts");assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");
    assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer isolated-manual-test-token");
    assert.deepEqual(JSON.parse(String(init?.body)),{author:ACCOUNT.remote_id,commentary:TEXT,visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false});
    return success(url,init);
  },{credential:async()=>{credentials++;return "isolated-manual-test-token";}}));
  const row=await publisher.enqueue(input),duplicate=await publisher.enqueue({...input,request_id:randomUUID()});assert.equal(duplicate.id,row.id);await publisher.approve(row.id,row.version,true);
  const results=await Promise.allSettled([publisher.publishNow(row.id,row.version,ACCOUNT.id,true),publisher.publishNow(row.id,row.version,ACCOUNT.id,true)]);
  const successful=results.filter(result=>result.status==="fulfilled"&&result.value.status==="published");assert.equal(successful.length,1);
  for(const result of results)if(result.status==="rejected")assert(result.reason instanceof PublicationValidationError);
  const expectedReceipt={platform:"LinkedIn",provider_id:"urn:li:share:98765",http_status:201,url:"https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A98765/"};
  const state=await publisher.snapshot();assert.equal(state.jobs[0].status,"published");assert.deepEqual(state.jobs[0].receipt,expectedReceipt);assert.equal(state.jobs[0].provider_id,expectedReceipt.provider_id);assert.equal(new Date(state.jobs[0].published_at!).toISOString(),WHEN);
  assert.equal(state.attempts.length,1);assert.equal((state.attempts[0] as {state:string}).state,"received");
  await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));assert.equal((await publisher.dispatch(NOW)).status,"idle");
  assert.equal(calls,1);assert.equal(credentials,1);assert(!JSON.stringify(state).includes("isolated-manual-test-token"));
}));

test("revoked and subsequently re-cleared source never revives a manual approval",()=>fixture(async(db,{input,source})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");})),intake=new SourceIntake(db);
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  await intake.revoke(source.id,source.hash);await intake.clear(source.id,source.hash,true);
  assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"blocked");assert.equal((await publisher.snapshot()).jobs[0].status,"invalidated");assert.equal(calls,0);
}));

test("artifact revision, account reconnect, and cancellation invalidate exact manual delivery",async t=>{
  for(const change of ["artifact","account","cancel"] as const)await t.test(change,()=>fixture(async(db,{input,store})=>{
    let calls=0;const config=runtime(async()=>{calls++;return success("unused");}),publisher=new Publishing(db,config),row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
    if(change==="artifact")await store.revise(input.task_id,input.review_token,"Review a changed proposed approach",{role:"Writer",text:"Proposed approach: check source evidence."});
    if(change==="account")config.accounts![0].authorization_version="reconnected-v2";
    if(change==="cancel")await publisher.cancel(row.id,row.version);
    await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));assert.equal(calls,0);
  }));
});

test("manual delivery rechecks runtime, credentials, source, account, claim, and time after reading credentials",async t=>{
  for(const change of ["enabled","credential-permission","source","account","claim","mode","time"] as const)await t.test(change,()=>fixture(async(db,{input,source})=>{
    let calls=0,current=true,clock=NOW,credentials=0;
    const config=runtime(async()=>{calls++;return success("unused");},{now:()=>clock,accountCurrent:async()=>current});
    const publisher=new Publishing(db,config),row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
    config.credential=async()=>{
      credentials++;
      if(change==="enabled")config.enabled=false;
      if(change==="credential-permission")config.credential_use_authorized=false;
      if(change==="source")await db.query("UPDATE sources SET cleared=false,revoked_at=now() WHERE id=$1",[source.id]);
      if(change==="account")current=false;
      if(change==="claim")await db.query("UPDATE publishing_outbox SET claim_token=$2 WHERE id=$1",[row.id,randomUUID()]);
      if(change==="mode")await db.query("UPDATE publishing_outbox SET delivery_mode='scheduled' WHERE id=$1",[row.id]);
      if(change==="time")clock=new Date("2026-10-20T08:05:01Z");
      return "isolated-manual-test-token";
    };
    await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));assert.equal(credentials,1);assert.equal(calls,0);assert.equal((await publisher.snapshot()).attempts.length,0);
  }));
});

test("manual uncertain delivery survives restart and cannot be replayed by either mode",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"manual-publication-"));let db=await embedded(join(directory,"db"));
  try{
    const {input}=await seed(db);let calls=0;const config=runtime(async()=>{calls++;throw Error("Isolated private provider error, never persist");});let publisher=new Publishing(db,config);
    const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
    assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,"uncertain");
    await db.close();db=await embedded(join(directory,"db"));publisher=new Publishing(db,config);
    await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));assert.equal((await publisher.dispatch(NOW)).status,"idle");
    for(const delivery_mode of ["manual","scheduled"] as const)await assert.rejects(publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:01:00Z",delivery_mode}),/reconciliation/);
    await assert.rejects(publisher.revise(row.id,row.version,{...input,scheduled_at:"2026-10-20T08:01:00Z"}),PublicationValidationError);
    const state=await publisher.snapshot();assert.equal(state.jobs[0].status,"uncertain");assert.equal(state.attempts.length,1);assert.equal((state.attempts[0] as {state:string}).state,"uncertain");assert.equal(calls,1);assert(!JSON.stringify(state).includes("private provider error"));
  }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});

test("manual definitive rejection and missing-receipt outcomes are terminal without automatic retry",async t=>{
  for(const [status,response] of [["failed",new Response("Private rejected body",{status:403})],["uncertain",new Response(null,{status:201})]] as const)await t.test(status,()=>fixture(async(db,{input})=>{
    let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return response;})),row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
    assert.equal((await publisher.publishNow(row.id,row.version,ACCOUNT.id,true)).status,status);await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));assert.equal(calls,1);assert(!JSON.stringify(await publisher.snapshot()).includes("Private rejected body"));
  }));
});


test("expired manual claims become uncertain without being retried",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");})),row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  await db.query("UPDATE publishing_outbox SET status='claimed',claim_token=$2,claimed_at=$3 WHERE id=$1",[row.id,randomUUID(),"2026-10-20T07:40:00Z"]);
  await refuses(publisher.publishNow(row.id,row.version,ACCOUNT.id,true));
  assert.equal((await publisher.snapshot()).jobs[0].status,"uncertain");assert.equal(calls,0);
  await assert.rejects(publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:01:00Z"}),/reconciliation/);
}));

test("different manual job IDs for the same task and account cannot overlap an in-flight publication",()=>fixture(async(db,{input})=>{
  let calls=0,release!:()=>void,started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const publisher=new Publishing(db,runtime(async()=>{calls++;started();await pending;return success("unused");}));
  const first=await publisher.enqueue(input),second=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T07:59:59Z"});assert.notEqual(first.id,second.id);
  await publisher.approve(first.id,first.version,true);await publisher.approve(second.id,second.version,true);
  const delivery=publisher.publishNow(first.id,first.version,ACCOUNT.id,true);await entered;
  try{
    const blocked=await publisher.publishNow(second.id,second.version,ACCOUNT.id,true);assert.equal(blocked.status,"blocked");assert.equal(blocked.id,second.id);assert.equal(calls,1);
    const state=await publisher.snapshot();assert.equal(state.jobs.find(job=>job.id===first.id)?.status,"claimed");assert.equal(state.jobs.find(job=>job.id===second.id)?.status,"approved");assert.equal(state.attempts.length,1);
  }finally{release();}
  assert.equal((await delivery).status,"published");assert.equal(calls,1);
}));

test("v20 migration preserves an approved pre-v20 schema-1 scheduled intent and its approval",async()=>{
  const instance=new PGlite();assert(SCHEMA.endsWith(MANUAL_PUBLICATION_SCHEMA));
  await instance.exec(SCHEMA.slice(0,-MANUAL_PUBLICATION_SCHEMA.length));
  const db:Database={kind:"pglite",query:async<T>(sql:string,params:unknown[]=[]) => (await instance.query<T>(sql,params)).rows,transaction:work=>instance.transaction(async tx=>work({query:async<T>(sql:string,params:unknown[]=[]) => (await tx.query<T>(sql,params)).rows})),close:()=>instance.close()};
  try{
    const {input,source:seededSource}=await seed(db),source=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[seededSource.id]))[0];
    const artifact=(await db.query<Output>("SELECT * FROM outputs WHERE task_id=$1 AND role='Platform Adapter'",[input.task_id]))[0],variant=platformVariants(artifact).variants.find(item=>item.platform==="LinkedIn")!;
    const legacy={schema:1,task_id:input.task_id,source_id:source.id,source_hash:source.hash,source_clearance_token:hash(JSON.stringify({source_hash:source.hash,clearance_id:source.clearance_id||"legacy",cleared_at:source.cleared_at?new Date(source.cleared_at).toISOString():null})),review_token:input.review_token,artifact_hash:artifact.hash,variant_hash:variant.hash!,platform:input.platform,account_id:ACCOUNT.id,account_version:ACCOUNT.authorization_version,remote_id:ACCOUNT.remote_id,payload:input.payload,scheduled_at:WHEN};
    const id=randomUUID(),approvalId=randomUUID(),version=hash(JSON.stringify(legacy));
    await db.query("INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,source_clearance_token,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'approved')",[id,input.request_id,legacy.task_id,legacy.source_id,legacy.source_hash,legacy.source_clearance_token,legacy.review_token,legacy.artifact_hash,legacy.variant_hash,legacy.platform,legacy.account_id,legacy.account_version,legacy.remote_id,JSON.stringify(legacy.payload),legacy.scheduled_at,version]);
    await db.query("INSERT INTO publishing_requests(request_id,outbox_id,version) VALUES($1,$2,$3)",[input.request_id,id,version]);
    await db.query("INSERT INTO publishing_approvals(id,outbox_id,version,acknowledgement) VALUES($1,$2,$3,$4)",[approvalId,id,version,PUBLICATION_ACKNOWLEDGEMENT]);
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='publishing_outbox' AND column_name='delivery_mode'")).length,0);
    const migration=await readFile(new URL("../migrations/020_manual_publication.sql",import.meta.url),"utf8");await instance.exec(migration);await instance.exec(migration);
    let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return success("unused");},{scheduler_authorized:true,scheduler_interval_seconds:60}));
    const state=await publisher.snapshot();assert.equal(state.jobs[0].delivery_mode,"scheduled");assert.equal(state.jobs[0].version,version);assert.equal(state.jobs[0].status,"approved");
    const approval=state.approvals[0] as {id:string;version:string;acknowledgement:string};assert.equal(approval.id,approvalId);assert.equal(approval.version,version);assert.equal(approval.acknowledgement,PUBLICATION_ACKNOWLEDGEMENT);
    const legacyDuplicate=await publisher.enqueue({...input,delivery_mode:"scheduled"});assert.equal(legacyDuplicate.id,id);assert.equal(legacyDuplicate.version,version);
    await assert.rejects(publisher.publishNow(id,version,ACCOUNT.id,true),PublicationValidationError);
    const delivered=await publisher.dispatch(NOW);assert.equal(delivered.status,"published");assert.equal(delivered.id,id);assert.equal(calls,1);
  }finally{await db.close();}
});

test("manual deadlines prevent unsent credential use and keep an in-flight abort uncertain",()=>fixture(async(db,{input})=>{
  let calls=0,credentials=0;const controller=new AbortController();
  const config=runtime(async(_url,init)=>{calls++;assert(init?.signal);assert.notEqual(init.signal,controller.signal,'Manual and request deadlines must be composed with the caller signal');controller.abort();assert.equal(init.signal.aborted,true);throw new Error('Isolated aborted request');},{signal:AbortSignal.abort(),credential:async()=>{credentials++;return 'isolated-token';}});
  const publisher=new Publishing(db,config),unsent=await publisher.enqueue(input);await publisher.approve(unsent.id,unsent.version,true);
  assert.equal((await publisher.publishNow(unsent.id,unsent.version,ACCOUNT.id,true)).status,'failed');assert.equal(credentials,0);assert.equal(calls,0);
  config.signal=controller.signal;
  const sent=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:new Date(NOW.getTime()-1000).toISOString()});await publisher.approve(sent.id,sent.version,true);
  assert.equal((await publisher.publishNow(sent.id,sent.version,ACCOUNT.id,true)).status,'uncertain');assert.equal(credentials,1);assert.equal(calls,1);
  await refuses(publisher.publishNow(sent.id,sent.version,ACCOUNT.id,true));assert.equal(calls,1);
}));
