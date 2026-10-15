import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {embedded,type Database} from "../lib/db";
import {Publishing,publishOfficial,PUBLICATION_ACKNOWLEDGEMENT,type PublishingRuntime,type PublishingAccount,type PublishInput,type PublishingPayload,type AdapterJournal} from "../lib/publishing";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {CAPSULE,ROLES,hash} from "../lib/domain";
import {variantFixture} from "./variant-fixture";
const WHEN="2026-10-20T08:00:00.000Z",NOW=new Date(WHEN);
const TEXT="Proposed approach: inspect one cleared source.";
const LI:PublishingAccount={id:"linkedin-owner",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Owner profile",enabled:true,verified:true,authorization_version:"owner-consent-v1",scopes:["w_member_social"],linkedin_version:"202609"};
const X:PublishingAccount={id:"x-owner",platform:"X",remote_id:"12345",label:"Owner X",enabled:true,verified:true,authorization_version:"owner-consent-v1",scopes:["tweet.write","tweet.read","users.read"]};
const IG:PublishingAccount={id:"instagram-owner",platform:"Instagram",remote_id:"12345",label:"Owner Instagram",enabled:true,verified:true,authorization_version:"owner-consent-v1",scopes:["instagram_business_basic","instagram_business_content_publish"],instagram_login:"instagram",instagram_api_version:"v25.0",professional:true};
const media={url:"https://media.example.test/immutable/"+hash("test-jpeg")+".jpg",sha256:hash("test-jpeg"),mime_type:"image/jpeg" as const};
function runtime(fetcher:typeof fetch,extra:Partial<PublishingRuntime>={}):PublishingRuntime{return {now:()=>NOW,enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,accounts:[{...LI},{...X},{...IG}],credential:async()=>"test-only-placeholder",fetch:fetcher,...extra};}
async function seed(db:Database,approve=true){
  const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
  for(const role of ROLES){const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: inspect a draft":role==="Platform Adapter"?variantFixture(TEXT):TEXT;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  const outputs=await db.query<{hash:string}>("SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]);
  const version=hash(outputs.map(item=>item.hash).join("|"));if(approve)await store.approve(task.id,version);
  const input:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:"original:"+version,platform:"LinkedIn",account_id:LI.id,scheduled_at:WHEN,payload:{text:TEXT}};
  return {store,source,task,input};
}
async function fixture(work:(db:Database,context:Awaited<ReturnType<typeof seed>>)=>Promise<void>,approve=true){const db=await embedded();try{await work(db,await seed(db,approve));}finally{await db.close();}}
const linkedinSuccess:typeof fetch=async()=>new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:98765"}});
const noJournal:AdapterJournal={before:async()=>{},after:async()=>{}};

test("publication is server-disabled by default and requires a configured verified account",()=>fixture(async(db,{input})=>{
  const publisher=new Publishing(db);assert.equal((await publisher.snapshot()).enabled,false);assert.equal((await publisher.dispatch(NOW)).status,"disabled");await assert.rejects(publisher.enqueue(input),/account is not configured/);
  const config=runtime(async()=>{throw Error("Unexpected network");},{enabled:false});const offline=new Publishing(db,config),row=await offline.enqueue(input);await offline.approve(row.id,row.version,true);assert.equal((await offline.dispatch(NOW)).status,"disabled");assert.equal((await offline.snapshot()).jobs[0].status,"approved");
}));

test("draft approval never grants publication approval; exact payload, identity and acknowledgement bind the intent",()=>fixture(async(db,{input,store})=>{
  const publisher=new Publishing(db,runtime(linkedinSuccess));await assert.rejects(publisher.enqueue(input),/Approve the exact final artifact/);
  await store.approve(input.task_id,input.review_token.slice("original:".length));
  await assert.rejects(publisher.enqueue({...input,payload:{text:TEXT+" Extra."}}),/exactly match/);
  const row=await publisher.enqueue(input);assert.equal(row.status,"staged");assert.equal((await publisher.dispatch(NOW)).status,"idle");
  await assert.rejects(publisher.approve(row.id,row.version,false),/acknowledgement/);await assert.rejects(publisher.approve(row.id,"0".repeat(64),true),/Stale publication/);
  await publisher.approve(row.id,row.version,true);await publisher.approve(row.id,row.version,true);
  const state=await publisher.snapshot();assert.equal(state.approvals.length,1);assert.equal(state.acknowledgement,PUBLICATION_ACKNOWLEDGEMENT);
  await assert.rejects(db.query("DELETE FROM publishing_approvals"),/immutable/);
},false));

test("durable claim, request idempotency and concurrent dispatch yield one official receipt",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async(...args)=>{calls++;return linkedinSuccess(...args);}));
  const row=await publisher.enqueue(input),duplicate=await publisher.enqueue({...input,request_id:randomUUID()});assert.equal(duplicate.id,row.id);
  await assert.rejects(publisher.enqueue({...input,scheduled_at:"2026-10-20T08:01:00Z"}),/request id reused/);
  await publisher.approve(row.id,row.version,true);
  const results=await Promise.all([publisher.dispatch(NOW),publisher.dispatch(NOW)]);assert.equal(results.filter(result=>result.status==="published").length,1);assert.equal(calls,1);
  const state=await publisher.snapshot();assert.equal(state.jobs[0].provider_id,"urn:li:share:98765");assert.equal(state.jobs[0].status,"published");assert.equal(state.attempts.length,1);assert.equal((state.attempts[0] as {state:string}).state,"received");
  assert.equal((await publisher.dispatch(NOW)).status,"idle");await assert.rejects(publisher.cancel(row.id,row.version),/cannot be cancelled/);
  assert(!JSON.stringify(state).includes("test-only-placeholder"));
}));

test("rescheduling invalidates approval; old versions, cancelled items and late schedules never publish",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async(...args)=>{calls++;return linkedinSuccess(...args);}));
  const first=await publisher.enqueue(input);await publisher.approve(first.id,first.version,true);
  const revised=await publisher.revise(first.id,first.version,{...input,scheduled_at:"2026-10-20T08:01:00Z"});assert.notEqual(revised.version,first.version);assert.equal(revised.status,"staged");
  await assert.rejects(publisher.approve(first.id,first.version,true),/Stale publication/);assert.equal((await publisher.dispatch(new Date("2026-10-20T08:01:00Z"))).status,"idle");
  await publisher.approve(revised.id,revised.version,true);assert.equal((await publisher.dispatch(new Date("2026-10-20T08:06:01Z"))).status,"blocked");assert.equal((await publisher.snapshot()).jobs[0].status,"missed");
  const again=await publisher.revise(revised.id,revised.version,{...input,scheduled_at:"2026-10-21T08:00:00Z"});await publisher.approve(again.id,again.version,true);await publisher.cancel(again.id,again.version);assert.equal((await publisher.dispatch(new Date("2026-10-21T08:00:00Z"))).status,"idle");assert.equal(calls,0);
}));

test("source revocation and newer artifact revisions block already-approved publication",()=>fixture(async(db,{input,store,source})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async(...args)=>{calls++;return linkedinSuccess(...args);}));
  const first=await publisher.enqueue(input);await publisher.approve(first.id,first.version,true);
  await store.revise(input.task_id,input.review_token,"Review a changed proposed approach",{role:"Writer",text:"Proposed approach: check source evidence."});
  assert.equal((await publisher.dispatch(NOW)).status,"blocked");assert.equal((await publisher.snapshot()).jobs[0].status,"invalidated");
  const review=(await store.snapshot()).reviews[0];await store.approveRevision(input.task_id,review.token,true);
  const second=await publisher.enqueue({...input,request_id:randomUUID(),review_token:review.token,scheduled_at:"2026-10-20T08:01:00Z"});await publisher.approve(second.id,second.version,true);
  await db.query("UPDATE sources SET cleared=false,revoked_at=now() WHERE id=$1",[source.id]);assert.equal((await publisher.dispatch(new Date("2026-10-20T08:01:00Z"))).status,"blocked");assert.equal(calls,0);
}));

test("uncertain response survives database restart and blocks replay even under a new schedule",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"publishing-outbox-"));let db=await embedded(join(folder,"db"));
  try{
    const {input}=await seed(db);let calls=0;const config=runtime(async()=>{calls++;throw Error("socket failure with a secret that must not be persisted");});let publisher=new Publishing(db,config);
    const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);assert.equal((await publisher.dispatch(NOW)).status,"uncertain");await db.close();db=await embedded(join(folder,"db"));publisher=new Publishing(db,config);
    assert.equal((await publisher.dispatch(NOW)).status,"idle");assert.equal(calls,1);await assert.rejects(publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:01:00Z"}),/reconciliation/);
    const state=await publisher.snapshot();assert.equal(state.jobs[0].status,"uncertain");assert(!JSON.stringify(state).includes("secret"));assert.equal((state.attempts[0] as {state:string}).state,"uncertain");
  }finally{await db.close();await rm(folder,{recursive:true,force:true});}
});

test("crashed claims become uncertain, while definitive rejection is terminal failed",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return new Response("Do not persist credential-like provider body",{status:403});}));
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);assert.equal((await publisher.dispatch(NOW)).status,"failed");assert.equal((await publisher.dispatch(NOW)).status,"idle");assert.equal(calls,1);
  const other=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:01:00Z"});await publisher.approve(other.id,other.version,true);
  await db.query("UPDATE publishing_outbox SET status='claimed',claim_token=$2,claimed_at=$3 WHERE id=$1",[other.id,randomUUID(),"2026-10-20T07:40:00Z"]);
  await publisher.dispatch(NOW);assert.equal((await publisher.snapshot()).jobs.find(job=>job.id===other.id)?.status,"uncertain");assert.equal(calls,1);
}));

test("scheduler, account and separate X spend gates fail closed; attempted costs stay reserved",()=>fixture(async(db,{input})=>{
  let calls=0;const config=runtime(async()=>{calls++;return new Response(JSON.stringify({data:{id:calls===1?X.remote_id:"888"}}),{status:calls===1?200:201});},{scheduler_interval_seconds:86400});
  const publisher=new Publishing(db,config),row=await publisher.enqueue({...input,platform:"X",account_id:X.id});await publisher.approve(row.id,row.version,true);
  assert.match((await publisher.dispatch(NOW)).reason||"",/scheduler/);config.scheduler_interval_seconds=60;assert.match((await publisher.dispatch(NOW)).reason||"",/cost approval/);
  config.x_cost_authorized=true;config.x_max_create_microdollars=200000;config.x_max_identity_microdollars=10000;config.monthly_cap_microdollars=250000;
  assert.equal((await publisher.dispatch(NOW)).status,"published");const next=await publisher.enqueue({...input,request_id:randomUUID(),platform:"X",account_id:X.id,scheduled_at:"2026-10-20T08:01:00Z"});await publisher.approve(next.id,next.version,true);
  assert.match((await publisher.dispatch(new Date("2026-10-20T08:01:00Z"))).reason||"",/budget/);assert.equal(calls,2);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
}));

test("account reconnect invalidates the exact destination approval",()=>fixture(async(db,{input})=>{
  const config=runtime(async()=>{throw Error("Unexpected network");}),publisher=new Publishing(db,config),row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  config.accounts![0].authorization_version="owner-consent-v2";assert.equal((await publisher.dispatch(NOW)).status,"blocked");assert.equal((await publisher.snapshot()).jobs[0].status,"invalidated");
}));

test("Instagram requires immutable image approval and persists each official container/publish receipt",()=>fixture(async(db,{input})=>{
  const requests:{url:string;body:string}[]=[];
  const config=runtime(async(url,init)=>{requests.push({url:String(url),body:String(init?.body||"")});return new Response(JSON.stringify(String(url).includes("status_code")?{status_code:"FINISHED"}:String(url).endsWith("/media_publish")?{id:"789"}:{id:"456"}),{status:200});},{verifyMedia:async asset=>asset.sha256===media.sha256});
  const publisher=new Publishing(db,config);
  await assert.rejects(publisher.enqueue({...input,platform:"Instagram",account_id:IG.id}),/caption-only/);
  const row=await publisher.enqueue({...input,platform:"Instagram",account_id:IG.id,payload:{text:TEXT,media:[media]}});await publisher.approve(row.id,row.version,true);
  assert.equal((await publisher.dispatch(NOW)).status,"published");assert.equal(requests.length,3);assert.match(requests[0].url,/graph\.instagram\.com\/v25\.0\/12345\/media$/);assert.equal(new URLSearchParams(requests[0].body).get("caption"),TEXT);assert.equal(new URLSearchParams(requests[2].body).get("creation_id"),"456");
  const state=await publisher.snapshot();assert.equal(state.attempts.length,3);assert.equal(state.jobs[0].provider_id,"789");
}));

test("Instagram rechecks source clearance between media creation and final publication",()=>fixture(async(db,{input,source})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;await db.query("UPDATE sources SET cleared=false,revoked_at=now() WHERE id=$1",[source.id]);return new Response(JSON.stringify({id:"456"}),{status:200});},{verifyMedia:async()=>true}));
  const row=await publisher.enqueue({...input,platform:"Instagram",account_id:IG.id,payload:{text:TEXT,media:[media]}});await publisher.approve(row.id,row.version,true);assert.notEqual((await publisher.dispatch(NOW)).status,"published");assert.equal(calls,1);assert.equal((await publisher.dispatch(NOW)).status,"idle");
}));

test("official adapters send narrowly scoped payloads, reject missing receipts, and never follow redirects",async()=>{
  let request:RequestInit|undefined;
  const receipt=await publishOfficial({platform:"LinkedIn",remote_id:LI.remote_id,payload:{text:TEXT}},LI,"mock-token",async(url,init)=>{assert.equal(url,"https://api.linkedin.com/rest/posts");request=init;return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:ugcPost:555"}});},noJournal);
  assert.equal(receipt.provider_id,"urn:li:ugcPost:555");assert.equal(request?.redirect,"error");assert.equal((request?.headers as Record<string,string>)["Linkedin-Version"],"202609");assert.equal(JSON.parse(String(request?.body)).commentary,TEXT);
  await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text:TEXT}},X,"mock-token",async()=>new Response(JSON.stringify({ok:true}),{status:201}),noJournal),/verifiable receipt/);
  for(const payload of [{text:"x".repeat(281)},{text:TEXT,media:[media]},{text:TEXT,reply:"123"}] as PublishingPayload[])await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload},X,"mock-token",async()=>{throw Error("Unexpected network");},noJournal));
  await assert.rejects(publishOfficial({platform:"Instagram",remote_id:IG.remote_id,payload:{text:TEXT,media:[{...media,url:"https://127.0.0.1/a.jpg"}]}},IG,"mock-token",async()=>{throw Error("Unexpected network");},noJournal),/public immutable/);
});

test("X verifies the OAuth identity before creating a post and never posts to a mismatched account",async()=>{
  const urls:string[]=[];
  await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text:TEXT}},X,"mock-token",async(url)=>{urls.push(String(url));return new Response(JSON.stringify({data:{id:"99999"}}),{status:200});},noJournal),/different account/);
  assert.deepEqual(urls,["https://api.x.com/2/users/me"]);
  const happy:string[]=[];
  const receipt=await publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text:TEXT}},X,"mock-token",async(url,init)=>{happy.push(String(url));if(String(url).endsWith("/me"))return new Response(JSON.stringify({data:{id:X.remote_id}}),{status:200});assert.deepEqual(JSON.parse(String(init?.body)),{text:TEXT});return new Response(JSON.stringify({data:{id:"123123"}}),{status:201});},noJournal);
  assert.equal(receipt.provider_id,"123123");assert.deepEqual(happy,["https://api.x.com/2/users/me","https://api.x.com/2/tweets"]);
});

test("publication refuses stale wallclock even when caller supplied an earlier dispatch time",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return linkedinSuccess("unused");},{now:()=>new Date("2026-10-20T08:05:01Z")}));
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);assert.equal((await publisher.dispatch(NOW)).status,"failed");assert.equal(calls,0);assert.equal((await publisher.snapshot()).attempts.length,0);
}));

test("Instagram stops before final publish if media preparation consumed the approved window",()=>fixture(async(db,{input})=>{
  let calls=0,clock=NOW;const publisher=new Publishing(db,runtime(async(url)=>{calls++;if(String(url).includes("status_code")){clock=new Date("2026-10-20T08:05:01Z");return new Response(JSON.stringify({status_code:"FINISHED"}),{status:200});}return new Response(JSON.stringify({id:"456"}),{status:200});},{verifyMedia:async()=>true,now:()=>clock}));
  const row=await publisher.enqueue({...input,platform:"Instagram",account_id:IG.id,payload:{text:TEXT,media:[media]}});await publisher.approve(row.id,row.version,true);assert.equal((await publisher.dispatch(NOW)).status,"failed");assert.equal(calls,2);
}));

test("5xx and malformed success remain uncertain without automatic or manual enqueue replay",()=>fixture(async(db,{input})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return new Response("Provider's private error body",{status:503});}));
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);assert.equal((await publisher.dispatch(NOW)).status,"uncertain");assert.equal((await publisher.dispatch(NOW)).status,"idle");assert.equal(calls,1);assert(!JSON.stringify(await publisher.snapshot()).includes("Provider's private"));
  await assert.rejects(publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:"2026-10-20T08:02:00Z"}),/reconciliation/);
}));


test("revoking then re-clearing the same source cannot revive an old publication approval",()=>fixture(async(db,{input,source})=>{
  let calls=0;const publisher=new Publishing(db,runtime(async(...args)=>{calls++;return linkedinSuccess(...args);})),intake=new SourceIntake(db);
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);
  await intake.revoke(source.id,source.hash);await intake.clear(source.id,source.hash,true);
  assert.equal((await publisher.dispatch(NOW)).status,"blocked");assert.equal((await publisher.snapshot()).jobs[0].status,"invalidated");assert.equal(calls,0);
}));

test("Instagram polls the same asynchronous container without recreating it and records receipt time",()=>fixture(async(db,{input})=>{
  let checks=0,creates=0,publishes=0,pauses=0,clock=NOW;
  const publisher=new Publishing(db,runtime(async(url)=>{
    if(String(url).includes("status_code")){checks++;return new Response(JSON.stringify({status_code:checks<3?"IN_PROGRESS":"FINISHED"}),{status:200});}
    if(String(url).endsWith("/media_publish")){publishes++;clock=new Date("2026-10-20T08:00:07Z");return new Response(JSON.stringify({id:"789"}),{status:200});}
    creates++;return new Response(JSON.stringify({id:"456"}),{status:200});
  },{verifyMedia:async()=>true,now:()=>clock,sleep:async milliseconds=>{assert.equal(milliseconds,1000);pauses++;}}));
  const row=await publisher.enqueue({...input,platform:"Instagram",account_id:IG.id,payload:{text:TEXT,media:[media]}});await publisher.approve(row.id,row.version,true);
  assert.equal((await publisher.snapshot()).accounts.find(account=>account.id===IG.id)?.live_connection_tested,false);
  assert.equal((await publisher.dispatch(NOW)).status,"published");assert.equal(creates,1);assert.equal(checks,3);assert.equal(pauses,2);assert.equal(publishes,1);
  const state=await publisher.snapshot();assert.equal(new Date(state.jobs[0].published_at!).toISOString(),"2026-10-20T08:00:07.000Z");assert.equal(state.attempts.length,5);
  const account=state.accounts.find(item=>item.id===IG.id)!;assert.equal(account.readiness_kind,"configuration_only");assert.equal(account.live_connection_tested,true);assert.equal(account.last_successful_publication?.receipt?.provider_id,"789");
}));

test("Instagram polling is bounded and never publishes or recreates a still-pending container",async()=>{
  let calls=0,pauses=0;
  await assert.rejects(publishOfficial({platform:"Instagram",remote_id:IG.remote_id,payload:{text:TEXT,media:[media]}},IG,"mock-token",async(url)=>{calls++;assert(!String(url).endsWith("media_publish"));return new Response(JSON.stringify(String(url).includes("status_code")?{status_code:"IN_PROGRESS"}:{id:"456"}),{status:200});},noJournal,async()=>{pauses++;}),/not ready/);
  assert.equal(calls,6);assert.equal(pauses,4);
});

test('dynamic connection revocation after credential read prevents final outbound publication',()=>fixture(async(db,{input})=>{
 let current=true,calls=0;const publisher=new Publishing(db,runtime(async()=>{calls++;return linkedinSuccess('https://unused.test');},{accountCurrent:async()=>current,credential:async()=>{current=false;return 'isolated-token';}}));
 const plan=await publisher.enqueue(input);await publisher.approve(plan.id,plan.version,true);const result=await publisher.dispatch(NOW);assert.notEqual(result.status,'published');assert.equal(calls,0);assert.equal((await publisher.snapshot()).attempts.length,0);
}));

test('connection revocation during paid X identity check blocks the final create request',()=>fixture(async(db,{input})=>{
 let current=true,creates=0;const publisher=new Publishing(db,runtime(async url=>{if(String(url).endsWith('/users/me')){current=false;return Response.json({data:{id:X.remote_id}});}creates++;return Response.json({data:{id:'987'}},{status:201});},{accountCurrent:async()=>current,x_cost_authorized:true,x_max_create_microdollars:200000,x_max_identity_microdollars:10000,monthly_cap_microdollars:1000000}));
 const plan=await publisher.enqueue({...input,platform:'X',account_id:X.id});await publisher.approve(plan.id,plan.version,true);assert.notEqual((await publisher.dispatch(NOW)).status,'published');assert.equal(creates,0);
}));

test("invocation signal blocks unsent requests and marks in-flight abort outcomes uncertain",async()=>{
 let calls=0;const aborted=AbortSignal.abort();
 await assert.rejects(publishOfficial({platform:"LinkedIn",remote_id:LI.remote_id,payload:{text:TEXT}},LI,"mock-token",async()=>{calls++;return linkedinSuccess("unused");},noJournal,undefined,aborted),/deadline/);assert.equal(calls,0);
 const controller=new AbortController(),states:string[]=[];
 await assert.rejects(publishOfficial({platform:"LinkedIn",remote_id:LI.remote_id,payload:{text:TEXT}},LI,"mock-token",async(_url,init)=>{calls++;assert(init?.signal);controller.abort();assert.equal(init.signal.aborted,true);throw Error("request aborted");},{before:async()=>{},after:async(_stage,_code,_id,state)=>{states.push(state);}},undefined,controller.signal),/uncertain/);
 assert.equal(calls,1);assert.deepEqual(states,["uncertain"]);
});
