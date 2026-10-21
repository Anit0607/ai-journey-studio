import {variantFixture} from "./variant-fixture";
import {assertSchemaParity} from "./schema-parity";
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {embedded,connectionMode} from "../lib/db";
import {BASE_SCHEMA,PREFLIGHT_SCHEMA,REVISION_SCHEMA,CALENDAR_SCHEMA,PLATFORM_TIMING_SCHEMA} from "../lib/schema";
import {Store} from "../lib/store";
import {CAPSULE,hash,istMonth,tokenCost,configReady,type Pricing,type RuntimeConfig} from "../lib/domain";
import {authorized,allowedOrigin} from "../lib/auth";
import {step} from "../lib/workflow";
import {ProviderFailure,AccountingFailure,type Completion} from "../lib/providers";
const p:Pricing={model:"isolated-fixture",pricing_version:"test-only",pricing_tier:"standard",official_pricing_url:"https://example.test",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const c:RuntimeConfig={source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),openai:p};
const complete=(text:string,input=10,output=10):Completion=>({text,input,output,outcome:"complete",report:{serviceTier:"default",model:p.model,requestId:"isolated",finishReason:"stop"}});
test("inherited database configuration never authorizes connection",()=>{
  assert.equal(connectionMode({DATABASE_URL:"isolated-unused-url"}),null);
  assert.equal(connectionMode({DATABASE_URL:"isolated-unused-url",STUDIO_LOCAL_DB:"1"}),"pglite");
  assert.equal(connectionMode({STUDIO_LOCAL_DB:"1",VERCEL:"1"}),null);
  assert.equal(connectionMode({DATABASE_URL:"isolated-unused-url",STUDIO_DATABASE_AUTHORIZED:"1"}),"postgres");
});
async function fixture(work:(store:Store)=>Promise<void>){const db=await embedded();try{await work(new Store(db));}finally{await db.close();}}
async function queued(s:Store){const source=await s.source(CAPSULE,"user-reported-notes","2026-10-09",true);return s.enqueue(source.id);}
test("authorization rejects missing/wrong token and origin",()=>{
  const token="x".repeat(40);
  assert.equal(authorized(new Request("http://localhost/api"),token),false);
  assert.equal(authorized(new Request("http://localhost/api",{headers:{Authorization:"Bearer "+token}}),token),true);
  assert.equal(allowedOrigin(new Request("http://localhost/api",{headers:{Origin:"https://evil.test"}}),"http://localhost"),false);
  assert.equal(allowedOrigin(new Request("http://localhost/api",{headers:{Origin:"http://localhost"}}),"http://localhost"),true);
});
test("pricing and IST boundary",()=>{
  assert.equal(tokenCost(p,3,2),5);
  assert.equal(istMonth(new Date("2026-10-31T18:29:59Z")),"2026-10");
  assert.equal(istMonth(new Date("2026-10-31T18:30:00Z")),"2026-11");
  assert.equal(configReady(c),true);
  assert.equal(configReady({...c,source_approved:false}),false);
  assert.equal(configReady({...c,pricing_verified_date:"2000-01-01"}),false);
});
test("live workspace begins empty; Analyst stays insufficient-data",()=>fixture(async s=>{
  const state=await s.snapshot();
  for(const table of ["sources","tasks","outputs","events","ledger","approvals"])assert.deepEqual(state[table],[]);
  assert.equal(state.analyst.status,"insufficient-data");
}));
test("source consent, privacy allowlist and duplicate source",()=>fixture(async s=>{
  await assert.rejects(s.source(CAPSULE,"user-reported-notes","2026-10-09",false));
  await assert.rejects(s.source("private client material","user-reported-notes","2026-10-09",true));
  await assert.rejects(s.source(CAPSULE,"excluded","2026-10-09",true));
  const first=await s.source(CAPSULE,"user-reported-notes","2026-10-09",true);
  const second=await s.source(CAPSULE,"user-reported-notes","2026-10-09",true);
  assert.equal(first.id,second.id);
}));
test("concurrent duplicate actions and job claims",()=>fixture(async s=>{
  const source=await s.source(CAPSULE,"user-reported-notes","2026-10-09",true);
  const tasks=await Promise.all(Array.from({length:12},()=>s.enqueue(source.id)));
  assert.equal(new Set(tasks.map(t=>t.id)).size,1);
  const claims=await Promise.all(Array.from({length:8},()=>s.claim()));
  assert.equal(claims.filter(Boolean).length,1);
}));
test("atomic budget concurrency retains $1 inside $15 cap",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  const results=await Promise.allSettled(Array.from({length:30},()=>s.reserve(task,"test",p,1_000_000)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,14);
  assert.equal((await s.snapshot()).budget.committed_microdollars,14_000_000);
}));
test("uncertain previous month still constrains new reservations",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  await s.reserve(task,"test",p,14_000_000,"2026-09");
  await assert.rejects(s.reserve(task,"test",p,1));
  assert.equal((await s.snapshot()).budget.committed_microdollars,14_000_000);
}));
test("lost lease with reservation blocks automatic restart",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  await s.reserve(task,"test",p,1000);
  await s.db.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",[task.id]);
  assert.equal(await s.claim(),null);
  assert.equal((await s.snapshot()).tasks[0].status,"blocked");
  await assert.rejects(s.retry(task.id));
}));
test("lost lease without provider reservation resumes checkpoint",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  await s.db.query("UPDATE tasks SET lease_until=now()-interval '1 second',checkpoint=2 WHERE id=$1",[task.id]);
  const resumed=await s.claim();assert.equal(resumed?.checkpoint,2);assert.notEqual(resumed?.lease_token,task.lease_token);
}));
test("cancelled task stops future calls; in-flight settlement retained",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  const reservation=await s.reserve(task,"test",p,1000);
  await s.cancel(task.id);
  await assert.rejects(s.reserve(task,"test",p,1000));
  await s.settle(task,reservation,"isolated fixture",10,10,20);
  const state=await s.snapshot();assert.equal(state.tasks[0].status,"cancelled");assert.equal(Number(state.ledger[0].estimated),20);
  assert.equal(await s.claim(),null);
}));
test("stale source clearance/version blocks calls",()=>fixture(async s=>{
  await queued(s);const task=(await s.claim())!;
  await s.db.query("UPDATE sources SET cleared=false");
  await assert.rejects(s.reserve(task,"test",p,1000));
}));
test("no setup authorization means no paid call or task claim",()=>fixture(async s=>{
  await queued(s);let calls=0;
  const result=await step(s,{},async()=>{calls++;throw Error("should not run");});
  assert.equal(result.status,"blocked");assert.equal(calls,0);
  assert.equal((await s.snapshot()).tasks[0].status,"queued");
}));
test("timeout retains reservation; no replay",()=>fixture(async s=>{
  await queued(s);let calls=0;
  const call=async()=>{calls++;throw Error("isolated timeout");};
  await step(s,c,call,true);await step(s,c,call,true);
  const state=await s.snapshot();assert.equal(calls,1);assert.equal(state.tasks[0].status,"blocked");assert.equal(state.ledger[0].status,"unknown");
}));
test("403 access refusal never triggers fallback",()=>fixture(async s=>{
  await queued(s);let calls=0;
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="isolated-test-key";
  try{await step(s,{...c,fallback_authorized:true,gemini:p},async()=>{calls++;throw new ProviderFailure(403);},true);}
  finally{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;}
  assert.equal(calls,1);
}));
test("bounded transient fallback retains uncertain primary reservation",()=>fixture(async s=>{
  await queued(s);let calls=0;
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="isolated-test-key";
  try{await step(s,{...c,fallback_authorized:true,gemini:p},async()=>{calls++;if(calls===1)throw new ProviderFailure(503);return complete("isolated fixture");},true);}
  finally{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;}
  const state=await s.snapshot();assert.equal(calls,2);assert.equal(state.ledger[0].status,"unknown");assert.equal(state.ledger[1].status,"settled");
}));
test("six single steps persist outputs; approval invalidation and duplicates",()=>fixture(async s=>{
  const task=await queued(s);
  for(let i=0;i<6;i++)assert.equal((await step(s,c,async()=>complete(i===5?"Unsupported claims: none\nEvidence needed: concrete project note\nProposed advice: review drafts":i===4?variantFixture():"Proposed approach: inspect one cleared source."),true)).status,"step_saved");
  let state=await s.snapshot();assert.equal(state.tasks[0].status,"review");assert.equal(state.outputs.length,6);
  await assert.rejects(s.approve(task.id,"bad-version"));
  const outputs=[...state.outputs].sort((a,b)=>new Date(a.created).getTime()-new Date(b.created).getTime()||String(a.id).localeCompare(String(b.id)));
  const version=hash(outputs.map(o=>o.hash).join("|"));
  const original=outputs[0].text;
  await s.db.query("UPDATE outputs SET text='changed isolated fixture' WHERE id=$1",[outputs[0].id]);
  await assert.rejects(s.approve(task.id,version));
  await s.db.query("UPDATE outputs SET text=$2 WHERE id=$1",[outputs[0].id,original]);
  await s.db.query("UPDATE sources SET cleared=false");
  await assert.rejects(s.approve(task.id,version));
  await s.db.query("UPDATE sources SET cleared=true");
  await s.approve(task.id,version);
  await assert.rejects(s.approve(task.id,version));
  state=await s.snapshot();assert.equal(state.tasks[0].status,"approved");assert.equal(state.approvals.length,1);
}));
test("safe explicit retry resumes; unknown retry remains blocked",()=>fixture(async s=>{
  const task=await queued(s);
  await step(s,c,async()=>{throw new ProviderFailure(429);},true);
  assert.equal((await s.snapshot()).tasks[0].status,"blocked");
  await s.retry(task.id);assert.equal((await s.snapshot()).tasks[0].status,"queued");
}));
test("migrations match tested schema",async()=>{
  assertSchemaParity(await readFile("migrations/001_initial.sql","utf8"),BASE_SCHEMA);
  assertSchemaParity(await readFile("migrations/002_preflight.sql","utf8"),PREFLIGHT_SCHEMA);
  assertSchemaParity(await readFile("migrations/003_revisions.sql","utf8"),REVISION_SCHEMA);
  assertSchemaParity(await readFile("migrations/004_calendar.sql","utf8"),CALENDAR_SCHEMA);
  assertSchemaParity(await readFile("migrations/005_platform_timing.sql","utf8"),PLATFORM_TIMING_SCHEMA);
});
test("relational checkpoint survives database close and reopen",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"studio-persist-test-"));
  let db=await embedded(dir);
  try{
    let store=new Store(db);const task=await queued(store);
    await step(store,c,async()=>complete("isolated persistence fixture"),true);
    await db.close();db=await embedded(dir);store=new Store(db);
    const state=await store.snapshot();
    assert.equal(state.tasks[0].id,task.id);assert.equal(state.tasks[0].checkpoint,1);assert.equal(state.tasks[0].status,"queued");
    await step(store,c,async()=>complete("isolated resumed fixture"),true);
    assert.equal((await store.snapshot()).outputs.length,2);
  }finally{
    await db.close();
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith("studio-persist-test-"));
    await rm(dir,{recursive:true,force:true});
  }
});
test("unexpected tier retains reservation, records tier and pauses further reservations",()=>fixture(async s=>{
  const task=await queued(s);let calls=0;
  const report={serviceTier:"priority",model:p.model,requestId:"isolated-request",finishReason:"stop"};
  await step(s,c,async()=>{calls++;throw new AccountingFailure(report);},true);
  const state=await s.snapshot();
  assert.equal(calls,1);assert.equal(state.tasks[0].checkpoint,0);
  assert.equal(state.tasks[0].id,task.id);
  assert.equal(state.ledger[0].status,"unknown");assert.equal(state.ledger[0].returned_service_tier,"priority");
  assert.equal(state.ledger[0].requested_service_tier,"default");assert.equal(state.ledger[0].pricing.pricing_version,"test-only");
  assert.equal(state.pricing_blocked,true);assert.equal(state.ledger[0].estimated,null);
  await s.db.query("UPDATE tasks SET status='queued'");
  const claimed=(await s.claim())!;
  await assert.rejects(s.reserve(claimed,"test",p,1000),/all provider execution paused/);
}));
test("truncated Critic settles usage without review readiness; explicit complete retry resumes",()=>fixture(async s=>{
  const task=await queued(s);
  for(let i=0;i<5;i++)await step(s,c,async()=>complete("isolated complete "+i),true);
  await step(s,c,async()=>({...complete("isolated truncated Critic"),outcome:"incomplete",report:{...complete("").report,finishReason:"length"}}),true);
  let state=await s.snapshot();
  assert.equal(state.tasks[0].checkpoint,5);assert.equal(state.tasks[0].status,"blocked");assert.equal(state.outputs.length,5);
  const ledger=state.ledger.find((r:any)=>r.completion_status==="incomplete");
  assert.equal(ledger.status,"settled");assert.equal(Number(ledger.estimated),20);assert.equal(ledger.partial_output,"isolated truncated Critic");
  await assert.rejects(s.approve(task.id,"any-version"));
  await s.retry(task.id);
  await step(s,c,async()=>complete("isolated complete Critic"),true);
  state=await s.snapshot();assert.equal(state.tasks[0].checkpoint,6);assert.equal(state.tasks[0].status,"review");assert.equal(state.outputs.length,6);
}));
test("safety termination settles known usage and prohibits retry or downstream calls",()=>fixture(async s=>{
  const task=await queued(s);let calls=0;
  await step(s,c,async()=>{calls++;return {...complete("isolated refusal"),outcome:"safety",report:{...complete("").report,finishReason:"content_filter"}};},true);
  await step(s,c,async()=>{calls++;return complete("should not execute");},true);
  const state=await s.snapshot();
  assert.equal(calls,1);assert.equal(state.outputs.length,0);assert.equal(state.tasks[0].checkpoint,0);
  assert.equal(state.ledger[0].status,"settled");assert.equal(state.tasks[0].block_reason,"safety");
  await assert.rejects(s.retry(task.id),/Safety termination/);
}));
