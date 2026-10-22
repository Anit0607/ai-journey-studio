import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {CAPSULE,ROLES,hash} from "../lib/domain";
import {Publishing,publishOfficial,safePublicationError,type PublishingAccount,type PublishingPayload,type PublishInput,type AdapterJournal} from "../lib/publishing";

const WHEN="2026-10-20T08:00:00.000Z",NOW=new Date(WHEN);
const TEXT="Proposed approach: inspect one cleared source.";
const X:PublishingAccount={id:"x-owner",platform:"X",remote_id:"12345",label:"Isolated X fixture",enabled:true,verified:true,authorization_version:"fixture-v1",scopes:["tweet.write","tweet.read","users.read"]};
const blockedTransport:typeof fetch=async()=>{assert.fail("No provider request is permitted");};
const blockedJournal:AdapterJournal={before:async()=>{assert.fail("Invalid text must not start an attempt");},after:async()=>{assert.fail("Invalid text must not finish an attempt");}};
async function fixture(text:string,work:(db:Database,store:Store,input:PublishInput)=>Promise<void>,approved=true){
  const db=await embedded();
  try{
    const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
    for(const role of ROLES){
      const content=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: inspect a draft":role==="Platform Adapter"?`### LinkedIn\n${TEXT}\n\n### X\n${text}\n\n### Instagram\n${TEXT}`:TEXT;
      await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,content,hash(content)]);
    }
    await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
    const outputs=await db.query<{hash:string}>("SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]),version=hash(outputs.map(item=>item.hash).join("|"));
    if(approved)await store.approve(task.id,version);
    await work(db,store,{request_id:randomUUID(),task_id:task.id,review_token:"original:"+version,platform:"X",account_id:X.id,scheduled_at:WHEN,payload:{text}});
  }finally{await db.close();}
}
function publisher(db:Database,enabled=false){
  return new Publishing(db,{enabled,now:()=>NOW,accounts:[X],fetch:blockedTransport,credential:async()=>{assert.fail("No credential access is permitted");},credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60});
}

test("weighted X overflow is shared by staging, revision and adapter validation before any attempt",()=>fixture(TEXT,async(db,_store,input)=>{
  const service=publisher(db),row=await service.enqueue(input),text="a".repeat(260)+" https://x.co";
  await assert.rejects(service.enqueue({...input,request_id:randomUUID(),payload:{text}}),/X single-post limit/);
  await assert.rejects(service.revise(row.id,row.version,{...input,payload:{text}}),/X single-post limit/);
  await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text}},X,"fixture-only",blockedTransport,blockedJournal),/X single-post limit/);
  const snapshot=await service.snapshot();assert.equal(snapshot.jobs.length,1);assert.equal(snapshot.jobs[0].version,row.version);assert.equal(snapshot.jobs[0].payload.text,TEXT);assert.equal(snapshot.approvals.length,0);assert.equal(snapshot.attempts.length,0);
}));

test("app input safety limit is explicit and blocks oversized X payloads before any attempt",()=>fixture(TEXT,async(db,_store,input)=>{
  const service=publisher(db),row=await service.enqueue(input);
  for(const text of ["a.".repeat(19000),"https://example.com/"+"p".repeat(3000)+" https://example.com/"+"p".repeat(3000)]){
    await assert.rejects(service.enqueue({...input,request_id:randomUUID(),payload:{text}}),error=>{
      assert.match(safePublicationError(error)||"",/app's 4,096-character input safety limit/);return true;
    });
    await assert.rejects(service.revise(row.id,row.version,{...input,payload:{text}}),/app's 4,096-character input safety limit/);
    await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text}},X,"fixture-only",blockedTransport,blockedJournal),/app's 4,096-character input safety limit/);
  }
  assert.equal((await service.snapshot()).attempts.length,0);
}));

test("formerly accepted over-limit stored X plans cannot gain approval or dispatch",()=>fixture(TEXT,async(db,_store,input)=>{
  const service=publisher(db,true),row=await service.enqueue(input);
  await service.approve(row.id,row.version,true);
  // Isolated legacy-row simulation only. Production data is never opened.
  await db.query("UPDATE publishing_outbox SET payload=$2 WHERE id=$1",[row.id,JSON.stringify({text:"a".repeat(260)+" https://x.co"})]);
  await assert.rejects(service.approve(row.id,row.version,true),/X single-post limit/);
  assert.equal((await service.dispatch(NOW)).status,"blocked");
  const snapshot=await service.snapshot();assert.equal(snapshot.jobs[0].status,"invalidated");assert.equal(snapshot.attempts.length,0);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
}));

test("NFC counting never normalizes approved bytes, bypasses content approval or grants X spending",()=>fixture("e\u0301".repeat(280),async(db,store,input)=>{
  const service=publisher(db,true);
  await assert.rejects(service.enqueue(input),/Approve the exact final artifact/);
  await store.approve(input.task_id,input.review_token.slice("original:".length));
  await assert.rejects(service.enqueue({...input,payload:{text:input.payload.text.normalize("NFC")}}),/exactly match/);
  const before=await db.query("SELECT * FROM outputs ORDER BY created,id"),row=await service.enqueue(input);
  assert.equal(row.payload.text,input.payload.text);assert.notEqual(row.payload.text,row.payload.text.normalize("NFC"));
  assert.equal(row.status,"staged");assert.equal((await service.dispatch(NOW)).status,"idle");
  await assert.rejects(service.approve(row.id,row.version,false),/acknowledgement/);
  await service.approve(row.id,row.version,true);
  assert.match((await service.dispatch(NOW)).reason||"",/cost approval/);
  assert.equal((await publisher(db).dispatch(NOW)).status,"disabled");
  assert.deepEqual(await db.query("SELECT * FROM outputs ORDER BY created,id"),before);
  assert.equal((await service.snapshot()).attempts.length,0);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
},false));

test("long URLs accepted by X counting retain exact payload bytes and hashes",()=>fixture("a".repeat(256)+" https://example.com/"+"p".repeat(900),async(db,_store,input)=>{
  const service=publisher(db),row=await service.enqueue(input);assert.equal(row.payload.text,input.payload.text);
  assert.equal(row.payload.text.length>280,true);await service.approve(row.id,row.version,true);
  assert.equal((await service.snapshot()).jobs[0].version,row.version);assert.equal((await service.dispatch(NOW)).status,"disabled");
}));

test("adapter validates X boundaries and preserves exact NFD and URL text in mocked requests",async()=>{
  for(const text of ["a".repeat(280),"é".repeat(280),"e\u0301".repeat(280),"👨‍👩‍👧‍👦".repeat(140),"🫱🏽‍🫲🏻".repeat(140),"a".repeat(256)+" https://example.com/"+"p".repeat(900)]){
    const bodies:string[]=[];
    const mock:typeof fetch=async(url,init)=>{if(String(url).endsWith("/me"))return new Response(JSON.stringify({data:{id:X.remote_id}}),{status:200});bodies.push(String(init?.body));return new Response(JSON.stringify({data:{id:"456"}}),{status:201});};
    await publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text}},X,"fixture-only",mock,{before:async()=>{},after:async()=>{}});
    assert.deepEqual(bodies,[JSON.stringify({text})]);
  }
  for(const text of ["a".repeat(281),"a".repeat(260)+" https://x.co","é".repeat(281),"e\u0301".repeat(281),"👨‍👩‍👧‍👦".repeat(141),"text\uFFFE"]){
    await assert.rejects(publishOfficial({platform:"X",remote_id:X.remote_id,payload:{text}},X,"fixture-only",blockedTransport,blockedJournal),/X single-post limit|Invalid X publication text/);
  }
});

test("LinkedIn and Instagram keep their existing literal limits and media requirements",async()=>{
  const li:PublishingAccount={...X,platform:"LinkedIn",remote_id:"urn:li:person:12345",scopes:["w_member_social"],linkedin_version:"202609"};
  const ig:PublishingAccount={...X,platform:"Instagram",scopes:["instagram_business_basic","instagram_business_content_publish"],instagram_login:"instagram",instagram_api_version:"v25.0",professional:true};
  const media={url:"https://media.example.test/card.jpg",sha256:hash("fixture-image"),mime_type:"image/jpeg" as const};
  // Stop at the journal, after text/media validation but before transport.
  const stop:AdapterJournal={before:async()=>{throw Error("Validated before network");},after:async()=>{assert.fail("No attempt may complete");}};
  for(const [account,limit] of [[li,3000],[ig,2200]] as const){
    const payload=(text:string):PublishingPayload=>({text,...(account.platform==="Instagram"?{media:[media]}:{})});
    for(const text of ["é".repeat(limit),"https://example.com/"+"a".repeat(limit-20)])await assert.rejects(publishOfficial({platform:account.platform,remote_id:account.remote_id,payload:payload(text)},account,"fixture-only",blockedTransport,stop),/Validated before network/);
    await assert.rejects(publishOfficial({platform:account.platform,remote_id:account.remote_id,payload:payload("é".repeat(limit+1))},account,"fixture-only",blockedTransport,blockedJournal),/text limit|caption limit/);
  }
  await assert.rejects(publishOfficial({platform:"Instagram",remote_id:ig.remote_id,payload:{text:TEXT}},ig,"fixture-only",blockedTransport,blockedJournal),/Instagram requires one verified JPEG/);
  await assert.rejects(publishOfficial({platform:"LinkedIn",remote_id:li.remote_id,payload:{text:TEXT,media:[media]}},li,"fixture-only",blockedTransport,blockedJournal),/Only text-only/);
});
