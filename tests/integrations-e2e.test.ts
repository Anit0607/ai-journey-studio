import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {SourceIngestion} from "../lib/source-ingestion";
import {SourceIntake} from "../lib/sources";
import {Store} from "../lib/store";
import {step} from "../lib/workflow";
import {Publishing,type PublishingRuntime,type PublishInput} from "../lib/publishing";
import {hash,type Source,type RuntimeConfig,type Output} from "../lib/domain";
import type {Completion} from "../lib/providers";
import {variantFixture} from "./variant-fixture";

/** Isolated semantic chain: every model and publishing request is injected. */
test("owner export -> source clearance -> six mocked checkpoints -> exact content and publication approvals -> one mock receipt; revocation stops outbound",async()=>{
  const db=await embedded(),now=new Date(),date=now.toISOString().slice(0,10),text="I built a working outline and checked it against my notes.";
  let networkCalls=0,modelCalls=0,credentialReads=0;const requests:{url:string;body:unknown}[]=[];
  const pricing={model:"isolated-e2e-model",pricing_version:"test-only",pricing_tier:"standard" as const,official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"};
  const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:date,openai:pricing};
  const publishingRuntime:PublishingRuntime={enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,now:()=>now,
    accounts:[{id:"e2e-linkedin",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Isolated LinkedIn fixture",enabled:true,verified:true,authorization_version:"e2e-approval-v1",scopes:["w_member_social"],linkedin_version:"202609"}],
    credential:async()=>{credentialReads++;return "isolated-placeholder";},
    fetch:async(url,init)=>{networkCalls++;requests.push({url:String(url),body:JSON.parse(String(init?.body))});assert.equal(init?.redirect,"error");return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});}};
  try{
    const ingestion=new SourceIngestion(db,{chat:{enabled:true}},{env:{},now:()=>now,fetch:async()=>{throw Error("Export import must not fetch");}}),intake=new SourceIntake(db),store=new Store(db),publisher=new Publishing(db,publishingRuntime);
    const imported=await ingestion.importChat({format:"ai-journey-chat-v1",provider:"chatgpt",conversations:[{id:"e2e-conversation",title:"Build notes",reported_date:date,messages:[{role:"user",text},{role:"assistant",text:"I earned $99999 from this project."}]}]},true);
    assert.equal(imported.staged,1);const source=(await db.query<Source>("SELECT * FROM sources"))[0];assert.equal(source.cleared,false);assert.equal(source.text.includes("99999"),false);
    assert.equal((await db.query("SELECT * FROM source_provenance")).length,1);await assert.rejects(store.enqueue(source.id),/Source not cleared/);assert.equal(modelCalls,0);assert.equal(networkCalls,0);
    await assert.rejects(intake.clear(source.id,source.hash,false),/Explicit owner/);await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
    const mockProvider=async(_provider:unknown,prompt:string):Promise<Completion>=>{
      assert.ok(prompt.includes(text));assert.equal(prompt.includes("99999"),false);assert.ok(prompt.includes("untrusted evidence"));
      const checkpoint=modelCalls++;const output=checkpoint===4?variantFixture(text):checkpoint===5?"Unsupported claims: none\nEvidence needed: none for the exact quoted event\nProposed advice: inspect source notes":text;
      return {text:output,input:30,output:30,outcome:"complete",report:{serviceTier:"default",model:pricing.model,requestId:"isolated-e2e-"+checkpoint,finishReason:"stop"}};
    };
    for(let checkpoint=0;checkpoint<6;checkpoint++)assert.equal((await step(store,config,mockProvider,true,{ownerClearedOnly:true})).status,"step_saved");
    assert.equal(modelCalls,6);assert.equal(networkCalls,0);assert.equal(credentialReads,0);
    const outputs=await db.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]);assert.equal(outputs.length,6);const version=hash(outputs.map(output=>output.hash).join("|"));
    assert.equal((await db.query<{status:string}>("SELECT status FROM tasks WHERE id=$1",[task.id]))[0].status,"review");
    assert.equal((await db.query("SELECT * FROM ledger WHERE status='settled'")).length,6);assert.deepEqual(await db.query("SELECT * FROM ledger WHERE status!='settled'"),[]);
    const intent:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:"original:"+version,platform:"LinkedIn",account_id:"e2e-linkedin",scheduled_at:now.toISOString(),payload:{text}};
    await assert.rejects(publisher.enqueue(intent),/Approve the exact final artifact/);await store.approve(task.id,version);
    const staged=await publisher.enqueue(intent);assert.equal(staged.status,"staged");assert.equal((await publisher.dispatch(now)).status,"idle");assert.equal(networkCalls,0);
    await assert.rejects(publisher.approve(staged.id,staged.version,false),/acknowledgement/);await assert.rejects(publisher.approve(staged.id,hash("wrong version"),true),/Stale publication/);
    await publisher.approve(staged.id,staged.version,true);const published=await publisher.dispatch(now);assert.equal(published.status,"published");assert.equal(published.receipt?.provider_id,"urn:li:share:12345");assert.equal(networkCalls,1);assert.equal(credentialReads,1);
    assert.equal(requests[0].url,"https://api.linkedin.com/rest/posts");assert.equal((requests[0].body as {commentary:string}).commentary,text);assert.equal((await publisher.dispatch(now)).status,"idle");assert.equal(networkCalls,1);
    const nextTime=new Date(now.getTime()+60_000);const later=await publisher.enqueue({...intent,request_id:randomUUID(),scheduled_at:nextTime.toISOString()});await publisher.approve(later.id,later.version,true);
    await intake.revoke(source.id,source.hash);assert.equal((await publisher.dispatch(nextTime)).status,"blocked");assert.equal(networkCalls,1);assert.equal(credentialReads,1);
    const final=await publisher.snapshot();assert.equal(final.jobs.find(row=>row.id===staged.id)?.status,"published");assert.equal(final.jobs.find(row=>row.id===later.id)?.status,"invalidated");assert.equal(final.attempts.length,1);assert.equal(final.approvals.length,2);assert.equal(JSON.stringify(final).includes("isolated-placeholder"),false);
  }finally{await db.close();}
});
