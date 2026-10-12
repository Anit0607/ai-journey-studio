import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import type {Database} from "../lib/db";
import {SCHEMA} from "../lib/schema";
import {HOSTED_BATCH_SCHEMA} from "../lib/hosted-schema";
import {HOSTED_MAX_STEPS,HOSTED_LEASE_MS,runHostedBatch,type HostedBatchOptions} from "../lib/hosted-batch";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {CAPSULE,hash,CAP,BUFFER,istMonth,type RuntimeConfig} from "../lib/domain";
import type {Completion} from "../lib/providers";
import {assertSchemaParity} from "./schema-parity";

const dayMs=86_400_000;
const pricing={model:"gpt-test",pricing_version:"isolated-test",pricing_tier:"standard" as const,official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"};
const configuration=(date:Date):RuntimeConfig=>({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:date.toISOString().slice(0,10),fallback_authorized:false,openai:pricing});
const completion:Completion={text:"I built an agent workflow today and reviewed each source.",input:30,output:20,outcome:"complete",report:{serviceTier:"default",model:"gpt-test",requestId:"isolated-test",finishReason:"stop"}};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(work:(db:Database,store:Store,intake:SourceIntake,inTransaction:()=>boolean)=>Promise<void>){
  const local=new PGlite();let transactions=0;
  await local.exec(SCHEMA+HOSTED_BATCH_SCHEMA);
  // Explicit isolated Postgres-kind wrapper. Production embedded() remains kind=pglite and is rejected.
  const db:Database={kind:"postgres",query:async<T>(sql:string,params:unknown[]=[]) =>(await local.query<T>(sql,params)).rows,transaction:work=>local.transaction(async tx=>{transactions++;try{return await work({query:async<T>(sql:string,params:unknown[]=[]) =>(await tx.query<T>(sql,params)).rows});}finally{transactions--;}}),close:()=>local.close()};
  try{await db.query("UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=120 WHERE id=1");await work(db,new Store(db),new SourceIntake(db),()=>transactions>0);}finally{await db.close();}
}
const isolated=(date:()=>Date):HostedBatchOptions=>({now:date,isReady:()=>true,readConfig:()=>configuration(date()),dispatch:async()=>{}});
async function queued(store:Store,intake:SourceIntake){const source=await intake.stage({text:"I built an agent workflow today and reviewed each source.",category:"build-log",reported_date:new Date().toISOString().slice(0,10)});await intake.clear(source.id,source.hash,true);return store.enqueue(source.id);}
async function accounting(db:Database,task:string,status="unknown",amount=10,month="2020-01"){
  await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);
  await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,estimated,status) VALUES($1,$2,$3,'openai','gpt-test',$4,$5,$6,$7)",[randomUUID(),task,month,JSON.stringify(pricing),amount,status==="settled"?amount:null,status]);
}

test("hosted batch refuses embedded storage even with an injected readiness callback",()=>fixture(async(db)=>{
  let calls=0;const now=new Date();
  const result=await runHostedBatch(new Store({...db,kind:"pglite"}),configuration(now),{...isolated(()=>now),step:async()=>{calls++;return {status:"idle"};}});
  assert.equal(result.status,"blocked");assert.equal(result.reason,"postgres_required");assert.equal(calls,0);assert.equal((await db.query("SELECT day FROM hosted_batches")).length,0);
}));

test("configuration and standing OpenAI consent cannot be bypassed by readiness injection",()=>fixture(async(db,store)=>{
  const now=new Date();let calls=0;
  for(const change of [{owner_cleared_sources_authorized:false},{credential_use_authorized:false},{security_tests_passed:false},{fallback_authorized:true},{pricing_verified_date:"2000-01-01"}]){
    const result=await runHostedBatch(store,{...configuration(now),...change},{now:()=>now,isReady:()=>true,step:async()=>{calls++;return {status:"idle"};}});
    assert.equal(result.reason,"runtime_not_ready");
  }
  assert.equal(calls,0);assert.equal((await db.query("SELECT day FROM hosted_batches")).length,0);
  const session=process.env.STUDIO_SESSION_ONLY;process.env.STUDIO_SESSION_ONLY="0";
  try{
    const defaultGate=await runHostedBatch(store,configuration(now),{now:()=>now,step:async()=>{calls++;return {status:"idle"};}});
    assert.equal(defaultGate.reason,"runtime_not_ready");assert.equal(calls,0);
  }finally{if(session===undefined)delete process.env.STUDIO_SESSION_ONLY;else process.env.STUDIO_SESSION_ONLY=session;}
}));

test("persisted calendar deactivation stops queued work and consumes the daily attempt",()=>fixture(async(db,store,intake)=>{
  await queued(store,intake);await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");let calls=0;const now=new Date();
  const options={...isolated(()=>now),step:async()=>{calls++;return {status:"idle"};}};
  assert.equal((await runHostedBatch(store,configuration(now),options)).reason,"generation_disabled");
  await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
  assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");assert.equal(calls,0);
}));

test("concurrent and repeated delivery has exactly one daily runner and no SQL transaction across an await",()=>fixture(async(db,store,_intake,inTransaction)=>{
  const now=new Date(),started=deferred(),release=deferred();let calls=0,dispatches=0;
  const options:HostedBatchOptions={...isolated(()=>now),dispatch:async()=>{dispatches++;assert.equal(inTransaction(),false);},step:async()=>{calls++;assert.equal(inTransaction(),false);started.resolve();await release.promise;return {status:"idle"};}};
  const active=runHostedBatch(store,configuration(now),options);await started.promise;
  const duplicates=await Promise.all(Array.from({length:5},()=>runHostedBatch(store,configuration(now),options)));
  assert(duplicates.every(result=>result.status==="duplicate"));assert.equal(calls,1);release.resolve();assert.equal((await active).status,"idle");
  assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");assert.equal(dispatches,1);assert.equal(calls,1);
  assert.equal((await db.query("SELECT day FROM hosted_batches")).length,1);assert.equal((await db.query<any>("SELECT * FROM hosted_batch_lease"))[0].lease_token,null);
}));

test("singleton lease also deduplicates overlapping UTC days",()=>fixture(async(db,store)=>{
  let now=new Date(new Date().toISOString().slice(0,10)+"T23:59:59Z");const firstDay=now.toISOString().slice(0,10),started=deferred(),release=deferred();let calls=0;
  const options:HostedBatchOptions={...isolated(()=>now),step:async()=>{calls++;started.resolve();await release.promise;return {status:"idle"};}};
  const active=runHostedBatch(store,configuration(now),options);await started.promise;now=new Date(now.getTime()+2000);
  const next=await runHostedBatch(store,configuration(now),options);assert.equal(next.reason,"another_batch_running");assert.notEqual(next.day,firstDay);assert.equal(calls,1);
  release.resolve();assert.equal((await active).status,"idle");assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");
  assert.equal((await db.query("SELECT day FROM hosted_batches")).length,2);
}));

test("stale prior-day attempts become interrupted and are never replayed",()=>fixture(async(db,store)=>{
  const now=new Date(),previous=new Date(now.getTime()-dayMs),token=randomUUID(),day=previous.toISOString().slice(0,10);
  await db.query("INSERT INTO hosted_batches(day,lease_token,status,started_at,heartbeat,attempts) VALUES($1,$2,'running',$3,$3,1)",[day,token,previous]);
  await db.query("UPDATE hosted_batch_lease SET lease_token=$1,batch_day=$2,lease_until=$3 WHERE id=1",[token,day,new Date(previous.getTime()+HOSTED_LEASE_MS)]);
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),step:async()=>({status:"idle"})});assert.equal(result.status,"idle");
  const prior=(await db.query<any>("SELECT * FROM hosted_batches WHERE day=$1",[day]))[0];assert.equal(prior.status,"interrupted");assert.equal(prior.reason,"stale_batch");assert.equal(prior.attempts,1);
  assert.equal((await runHostedBatch(store,configuration(previous),{...isolated(()=>previous),step:async()=>{throw Error("must not run");}})).status,"duplicate");
}));

test("less than eighty seconds of run budget prevents starting a checkpoint",()=>fixture(async(db,store)=>{
  let now=new Date();let calls=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),dispatch:async()=>{now=new Date(now.getTime()+160_001);},step:async()=>{calls++;return {status:"step_saved"};}});
  assert.equal(result.status,"deadline");assert.equal(result.steps,0);assert.equal(calls,0);assert.equal((await db.query<any>("SELECT * FROM hosted_batches"))[0].attempts,0);
}));

test("maximum twelve checkpoints per daily attempt is enforced even for immediate completions",()=>fixture(async(db,store)=>{
  const now=new Date();let calls=0,dispatches=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),dispatch:async()=>{dispatches++;},step:async()=>{calls++;return {status:"step_saved"};}});
  assert.equal(result.status,"max_steps");assert.equal(result.steps,HOSTED_MAX_STEPS);assert.equal(calls,12);assert.equal(dispatches,1);
  const saved=(await db.query<any>("SELECT * FROM hosted_batches"))[0];assert.equal(saved.steps,12);assert.equal(saved.attempts,12);assert(saved.finished_at);assert(saved.heartbeat);
}));

test("safe checkpoints resume the next UTC day, never during same-day retries",()=>fixture(async(db,store,intake,inTransaction)=>{
  let now=new Date();const task=await queued(store,intake);let calls=0,advance=true;
  const approved={...configuration(now),pricing_window_authorized:true,pricing_valid_until:new Date(now.getTime()+2*dayMs).toISOString().slice(0,10)};
  const options:HostedBatchOptions={...isolated(()=>now),readConfig:()=>approved,provider:async()=>{assert.equal(inTransaction(),false);calls++;if(advance)now=new Date(now.getTime()+90_000);return completion;}};
  const first=await runHostedBatch(store,configuration(now),options);assert.equal(first.status,"deadline");assert.equal(first.steps,2);assert.equal(calls,2);
  let taskState=(await db.query<any>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0];assert.equal(taskState.checkpoint,2);assert.equal(taskState.status,"queued");
  assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");assert.equal(calls,2);
  now=new Date(now.getTime()+dayMs);advance=false;
  const resumed=await runHostedBatch(store,configuration(now),options);assert.equal(resumed.status,"idle");assert.equal(resumed.steps,4);assert.equal(calls,6);
  taskState=(await db.query<any>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0];assert.equal(taskState.checkpoint,6);assert.equal(taskState.status,"review");assert.equal((await db.query("SELECT id FROM ledger WHERE status!='settled'")).length,0);
}));

test("unresolved prior-month accounting prevents any new provider request",()=>fixture(async(db,store,intake)=>{
  const task=await queued(store,intake);await accounting(db,task.id);const now=new Date();let calls=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),provider:async()=>{calls++;return completion;}});
  assert.equal(result.reason,"unresolved_accounting");assert.equal(calls,0);assert.equal((await db.query<any>("SELECT status FROM ledger"))[0].status,"unknown");
}));

test("budget headroom, persisted toggle and runtime config are checked between steps",async()=>{
  for(const gate of ["budget","toggle","config","accounting"]){await fixture(async(db,store,intake)=>{
    const now=new Date(),task=await queued(store,intake);let calls=0,current=configuration(now);
    const result=await runHostedBatch(store,current,{...isolated(()=>now),readConfig:()=>current,step:async()=>{calls++;
      if(gate==="budget")await accounting(db,task.id,"settled",CAP-BUFFER,istMonth(now));
      if(gate==="toggle")await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");
      if(gate==="config")current={...current,credential_use_authorized:false};
      if(gate==="accounting")await accounting(db,task.id,"reserved");
      return {status:"step_saved"};}});
    assert.equal(result.status,"blocked");assert.equal(result.steps,1);assert.equal(calls,1);
    assert.equal(result.reason,{budget:"budget_exhausted",toggle:"generation_disabled",config:"runtime_not_ready",accounting:"unresolved_accounting"}[gate]);
  });}
});

test("cancellation stops following checkpoints without discarding in-flight accounting",()=>fixture(async(db,store,intake)=>{
  const now=new Date(),task=await queued(store,intake);let calls=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),provider:async()=>{calls++;await store.cancel(task.id);return completion;}});
  assert.equal(result.reason,"cancelled");assert.equal(calls,1);assert.equal(result.steps,1);assert.equal((await db.query<any>("SELECT status FROM tasks WHERE id=$1",[task.id]))[0].status,"cancelled");
  assert.equal((await db.query<any>("SELECT status FROM ledger"))[0].status,"settled");
}));

test("abort signal stops later checkpoints and never abandons an active request",()=>fixture(async(_db,store)=>{
  const now=new Date(),controller=new AbortController();let calls=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),signal:controller.signal,step:async()=>{calls++;controller.abort();return {status:"step_saved"};}});
  assert.equal(result.reason,"cancelled");assert.equal(result.steps,1);assert.equal(calls,1);
}));

test("uncertain completion stays reserved and never automatically retries the same or next day",()=>fixture(async(db,store,intake)=>{
  let now=new Date();const task=await queued(store,intake);let calls=0;
  const options:HostedBatchOptions={...isolated(()=>now),provider:async()=>{calls++;throw Error("secret credential and source must not appear");}};
  const first=await runHostedBatch(store,configuration(now),options);assert.equal(first.reason,"checkpoint_blocked");assert.equal(calls,1);
  assert.equal((await db.query<any>("SELECT status FROM ledger"))[0].status,"unknown");assert.equal((await db.query<any>("SELECT status FROM tasks WHERE id=$1",[task.id]))[0].status,"blocked");
  assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");now=new Date(now.getTime()+dayMs);
  const next=await runHostedBatch(store,configuration(now),options);assert.equal(next.reason,"unresolved_accounting");assert.equal(calls,1);
  assert(!JSON.stringify([...await db.query("SELECT * FROM hosted_batches"),first,next]).includes("secret"));
}));

test("a thrown runtime failure is sanitized, preserves reservations and permanently consumes that day",()=>fixture(async(db,store,intake)=>{
  let now=new Date();await queued(store,intake);let calls=0;
  const options:HostedBatchOptions={...isolated(()=>now),step:async()=>{calls++;const task=await store.claim();assert(task);await store.reserve(task,"openai",pricing,100);throw Error("private source or secret");}};
  const first=await runHostedBatch(store,configuration(now),options);assert.equal(first.status,"failed");assert.equal(first.reason,"runtime_failure");assert.equal(first.steps,0);
  assert.equal((await db.query<any>("SELECT * FROM ledger"))[0].status,"reserved");assert.equal((await runHostedBatch(store,configuration(now),options)).status,"duplicate");
  now=new Date(now.getTime()+dayMs);assert.equal((await runHostedBatch(store,configuration(now),options)).reason,"unresolved_accounting");assert.equal(calls,1);
  const stored=await db.query<any>("SELECT * FROM hosted_batches");assert.equal(stored[0].attempts,1);assert(!JSON.stringify(stored).includes("private"));
}));

test("a worker that loses its lease cannot mutate a successor's record or release its token",()=>fixture(async(db,store)=>{
  let now=new Date(new Date().toISOString().slice(0,10)+"T23:59:59Z");const nextToken=randomUUID();let nextDay="",calls=0;
  const result=await runHostedBatch(store,configuration(now),{...isolated(()=>now),step:async()=>{
    calls++;now=new Date(now.getTime()+HOSTED_LEASE_MS+1);nextDay=now.toISOString().slice(0,10);
    await db.query("UPDATE hosted_batches SET status='interrupted',reason='stale_batch',finished_at=$1 WHERE status='running'",[now]);
    await db.query("INSERT INTO hosted_batches(day,lease_token,status,started_at,heartbeat) VALUES($1,$2,'running',$3,$3)",[nextDay,nextToken,now]);
    await db.query("UPDATE hosted_batch_lease SET lease_token=$1,batch_day=$2,lease_until=$3 WHERE id=1",[nextToken,nextDay,new Date(now.getTime()+HOSTED_LEASE_MS)]);
    return {status:"step_saved"};}});
  assert.equal(result.status,"interrupted");assert.equal(result.reason,"lease_lost");assert.equal(calls,1);
  const lease=(await db.query<any>("SELECT * FROM hosted_batch_lease"))[0];assert.equal(lease.lease_token,nextToken);assert.equal(lease.batch_day,nextDay);
  const successor=(await db.query<any>("SELECT * FROM hosted_batches WHERE day=$1",[nextDay]))[0];assert.equal(successor.status,"running");assert.equal(successor.steps,0);assert.equal(successor.finished_at,null);
}));

test("hosted migration is repeatable, bounded and matches exported schema",async()=>{
  assertSchemaParity(readFileSync(new URL("../migrations/009_hosted_batch.sql",import.meta.url),"utf8"),HOSTED_BATCH_SCHEMA.replace(/^\n/,""));
  await fixture(async(db)=>{
    const now=new Date(),token=randomUUID(),day=now.toISOString().slice(0,10);
    await db.query("INSERT INTO hosted_batches(day,lease_token,status,started_at,heartbeat,finished_at) VALUES($1,$2,'idle',$3,$3,$3)",[day,token,now]);
    await assert.rejects(db.query("UPDATE hosted_batches SET attempts=13 WHERE day=$1",[day]));
    await assert.rejects(db.query("UPDATE hosted_batches SET steps=1 WHERE day=$1",[day]));
    assert.equal((await db.query("SELECT version FROM schema_versions WHERE version=9")).length,1);
  });
});


test("production default checkpoint rejects legacy capsule clearance even when legacy config would authorize it",()=>fixture(async(db,store)=>{
  const now=new Date(),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true);await store.enqueue(source.id);let calls=0;
  const config={...configuration(now),source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true};
  const result=await runHostedBatch(store,config,{now:()=>now,isReady:()=>true,provider:async()=>{calls++;return completion;}});
  assert.equal(result.reason,"checkpoint_blocked");assert.equal(calls,0);assert.equal((await db.query("SELECT id FROM ledger")).length,0);assert.equal((await db.query<any>("SELECT status FROM tasks"))[0].status,"blocked");
}));

test("production default checkpoint rejects a previously queued forty-nine-hour calendar brief",()=>fixture(async(db,store,intake)=>{
  const now=new Date(),task=await queued(store,intake);let calls=0;
  const post=new Date(now.getTime()+72*3_600_000),brief={kind:"shortform",intended_post:post.toISOString(),generation_due:new Date(post.getTime()-49*3_600_000).toISOString(),review_due:new Date(post.getTime()-48*3_600_000).toISOString()};
  await db.query("UPDATE tasks SET origin_key=$2,content_brief=$3 WHERE id=$1",[task.id,"calendar:"+randomUUID(),JSON.stringify(brief)]);
  const result=await runHostedBatch(store,configuration(now),{now:()=>now,isReady:()=>true,provider:async()=>{calls++;return completion;}});
  assert.equal(result.reason,"checkpoint_blocked");assert.equal(calls,0);assert.equal((await db.query("SELECT id FROM ledger")).length,0);assert.equal((await db.query<any>("SELECT status FROM tasks"))[0].status,"blocked");
}));
