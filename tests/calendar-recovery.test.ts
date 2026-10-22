import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {hash,istMonth,type RuntimeConfig} from "../lib/domain";
import {step} from "../lib/workflow";
import {calendarRecoverySnapshot,recoverOverdueCalendarDraft} from "../lib/calendar-recovery";

const HOUR=3_600_000,now=new Date(),expiredAt=new Date(now.getTime()-HOUR),dispatchAt=new Date(now.getTime()-25*HOUR);
const pricing={model:"gpt-test",pricing_version:"isolated-recovery",pricing_tier:"standard" as const,official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:dispatchAt.toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){const f=await setup();try{await work(f);}finally{await f.db.close();}}
async function setup(){
 const db=await embedded(),calendar=new Calendar(db),store=new Store(db),intake=new SourceIntake(db);
 const staged=await intake.stage({text:"I built a content review screen. I found a missing date when checking my source notes.",category:"build-log",reported_date:dispatchAt.toISOString().slice(0,10)}),source=await intake.clear(staged.id,staged.hash,true);
 await db.query("UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=72 WHERE id=1");
 const id=randomUUID(),post=new Date(expiredAt.getTime()+48*HOUR);
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6)",[id,post.toISOString().slice(0,10),post,expiredAt,dispatchAt,source.id]);
 const dispatched=await calendar.dispatchDue(config,true,dispatchAt);assert.equal(dispatched.queued,1);
 const taskId=dispatched.entries[0].task_id!;
 const state=async()=>{const entry=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[id]))[0],job=(await db.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1",[id]))[0],task=(await db.query<any>("SELECT * FROM tasks WHERE id=$1",[taskId]))[0],currentSource=(await db.query<any>("SELECT * FROM sources WHERE id=$1",[source.id]))[0],usage=await db.query<any>("SELECT * FROM ledger WHERE task_id=$1",[taskId]);return {entry,job,task,source:currentSource,usage,recovery:calendarRecoverySnapshot(entry,job,task,currentSource,usage,now)!};};
 const input=async()=>({entry:id,expected:(await state()).recovery.expected,planned_date:new Date(now.getTime()+240*HOUR).toISOString().slice(0,10),post_time:"10:00",generation_lead_hours:120,reason:"Move this missed draft to a future review window",acknowledged:true});
 return {db,calendar,store,intake,source,id,taskId,state,input};
}
async function accounting(db:Database,task:string,status:string){await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[istMonth(now)]);await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,estimated,status) VALUES($1,$2,$3,'openai','gpt-test',$4,100,$5,$6)",[randomUUID(),task,istMonth(now),JSON.stringify(pricing),status==="settled"?1:null,status]);}

test("expired dispatch stays blocked until explicit recovery creates a separate future plan without model calls",()=>fixture(async f=>{
 let calls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error("No outgoing requests allowed");};
 try{
 const before=await f.state();assert.equal(before.recovery.eligible,true);
 const blocked=await step(f.store,{...config,pricing_verified_date:now.toISOString().slice(0,10)},async()=>{calls++;throw Error("Unexpected provider call");},true);
 assert.equal(blocked.status,"blocked");assert.match(blocked.reason!,/review deadline passed/);assert.equal(calls,0);
 const blockedState=await f.state(),result=await recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now);
 assert.equal(result.queued,false);assert.equal(result.paid_execution,false);assert.equal(result.cancelled_task,f.taskId);
 const after=await f.state();assert.equal(after.task.status,"cancelled");assert.deepEqual(after.task.content_brief,before.task.content_brief);assert.deepEqual(after.entry,before.entry);assert.deepEqual(after.job,before.job);
 assert.equal(result.entry.task_id,null);assert.equal(result.entry.source_id,f.source.id);assert.equal((await f.db.query("SELECT id FROM tasks")).length,1);assert.equal((await f.db.query("SELECT id FROM calendar_jobs")).length,1);assert.equal((await f.db.query("SELECT id FROM ledger")).length,0);
 assert.equal((await f.calendar.dispatchDue({...config,pricing_verified_date:now.toISOString().slice(0,10)},true,now)).queued,0);
 const future=new Date(result.entry.generation_due),futureConfig={...config,pricing_verified_date:future.toISOString().slice(0,10)};
 const results=await Promise.all([f.calendar.dispatchDue(futureConfig,true,future),f.calendar.dispatchDue(futureConfig,true,future)]);assert.equal(results.reduce((n,r)=>n+r.queued,0),1);
 const tasks=await f.db.query<any>("SELECT * FROM tasks ORDER BY updated");assert.equal(tasks.length,2);const fresh=tasks.find(t=>t.id!==f.taskId)!;
 assert.equal(fresh.status,"queued");assert.equal(fresh.source_id,f.source.id);assert.equal(fresh.source_hash,f.source.hash);assert.equal(fresh.content_brief.review_due,new Date(result.entry.review_due).toISOString());assert.equal(fresh.origin_key,"calendar:"+result.entry.id);assert.notDeepEqual(fresh.content_brief,blockedState.task.content_brief);
 assert.equal((await f.db.query("SELECT id FROM calendar_jobs")).length,2);assert.equal((await f.db.query("SELECT task_id FROM approvals")).length,0);assert.equal((await f.db.query("SELECT id FROM publishing_outbox")).length,0);assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;}
}));

test("partial artifacts and settled costs remain on the cancelled old task, with no approval carried forward",()=>fixture(async f=>{
 const text="Historical partial draft";await f.db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,'Researcher',$3,$4)",[randomUUID(),f.taskId,text,hash(text)]);await f.db.query("UPDATE tasks SET checkpoint=1,status='blocked' WHERE id=$1",[f.taskId]);await accounting(f.db,f.taskId,"settled");
 const outputs=await f.db.query("SELECT * FROM outputs"),ledger=await f.db.query("SELECT * FROM ledger");
 await recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now);
 assert.deepEqual(await f.db.query("SELECT * FROM outputs"),outputs);assert.deepEqual(await f.db.query("SELECT * FROM ledger"),ledger);assert.equal((await f.state()).task.checkpoint,1);assert.equal((await f.db.query("SELECT id FROM content_revisions")).length,0);
}));

test("stale, repeated and concurrent recovery requests cannot cancel twice or duplicate a replacement plan",()=>fixture(async f=>{
 const input=await f.input();await f.db.query("UPDATE tasks SET updated=updated+interval '1 second' WHERE id=$1",[f.taskId]);await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/stale/);
 const fresh=await f.input(),results=await Promise.allSettled([recoverOverdueCalendarDraft(f.db,fresh,120,()=>now),recoverOverdueCalendarDraft(f.db,fresh,120,()=>now)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,2);assert.equal((await f.db.query("SELECT id FROM events WHERE kind='calendar_draft_replanned'")).length,1);
 await assert.rejects(recoverOverdueCalendarDraft(f.db,fresh,120,()=>now),/stale/);
}));

for(const status of ["reserved","unknown"])test(status+" provider usage is never cleared or bypassed",()=>fixture(async f=>{
 await accounting(f.db,f.taskId,status);const before=await f.state();assert.equal(before.recovery.eligible,false);assert.match(before.recovery.reason!,/reconciled/);
 await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/reconciled/);assert.deepEqual((await f.state()).usage,before.usage);assert.equal((await f.state()).task.status,"queued");assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,1);
}));

for(const status of ["running","cancelled","review","approved"])test(status+" task cannot be recovered",()=>fixture(async f=>{
 await f.db.query("UPDATE tasks SET status=$2 WHERE id=$1",[f.taskId,status]);assert.equal((await f.state()).recovery.eligible,false);await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/Only an unfinished/);assert.equal((await f.state()).task.status,status);
}));

test("lease presence blocks recovery even on a dormant task or expired lease",()=>fixture(async f=>{
 await f.db.query("UPDATE tasks SET lease_token=$2,lease_until=$3 WHERE id=$1",[f.taskId,randomUUID(),expiredAt]);const before=await f.state();await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/lease is present/);assert.deepEqual((await f.state()).task,before.task);
}));

test("revocation, source-version mismatch and safety blocks cannot be bypassed",()=>fixture(async f=>{
 await f.intake.revoke(f.source.id,f.source.hash);await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/retain owner clearance/);
 await f.intake.clear(f.source.id,f.source.hash,true);await f.db.query("UPDATE calendar_jobs SET source_hash=$2 WHERE entry_id=$1",[f.id,"f".repeat(64)]);await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/linkage changed/);
 await f.db.query("UPDATE calendar_jobs SET source_hash=$2 WHERE entry_id=$1",[f.id,f.source.hash]);await f.db.query("UPDATE tasks SET status='blocked',block_reason='safety' WHERE id=$1",[f.taskId]);await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/safety or completion block/);
}));

test("non-overdue, invalid inputs, past generation, occupied target dates and unacknowledged recovery leave the task unchanged",()=>fixture(async f=>{
 const input=await f.input();
 for(const changed of [{acknowledged:false},{reason:" "},{planned_date:"2026-02-30"},{post_time:"24:00"},{generation_lead_hours:49},{generation_lead_hours:337},{planned_date:new Date(now.getTime()+HOUR).toISOString().slice(0,10)}])await assert.rejects(recoverOverdueCalendarDraft(f.db,{...input,...changed},120,()=>now));
 await assert.rejects(recoverOverdueCalendarDraft(f.db,{...input,planned_date:(await f.state()).entry.planned_date,generation_lead_hours:49},49,()=>new Date(dispatchAt.getTime()-24*HOUR)),/not passed/);
 await f.db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due) VALUES($1,$2,'shortform',$3,$3,$3)",[randomUUID(),input.planned_date,new Date(now.getTime()+240*HOUR)]);
 await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/already exists/);assert.equal((await f.state()).task.status,"queued");assert.equal((await f.db.query("SELECT id FROM events WHERE kind='calendar_draft_replanned'")).length,0);
}));

test("transaction failure preserves the original task and rolls back the replacement",()=>fixture(async f=>{
 const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({async query<T>(sql:string,params?:unknown[]){if(sql.includes("'calendar_draft_replanned'"))throw Error("Injected recovery event failure");return tx.query<T>(sql,params);}}))};
 await assert.rejects(recoverOverdueCalendarDraft(failing,await f.input(),120,()=>now),/Injected/);assert.equal((await f.state()).task.status,"queued");assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,1);
}));

test("changing the saved brief, calendar slot, job binding or source consent invalidates the exact recovery token",()=>fixture(async f=>{
 let input=await f.input();await f.db.query("UPDATE tasks SET content_brief=content_brief||'{\"kind\":\"longform\"}'::jsonb WHERE id=$1",[f.taskId]);await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/stale/);
 input=await f.input();await f.db.query("UPDATE calendar_entries SET intended_post=intended_post+interval '1 hour' WHERE id=$1",[f.id]);await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/stale/);
 input=await f.input();await f.db.query("UPDATE calendar_jobs SET updated=updated+interval '1 second' WHERE entry_id=$1",[f.id]);await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/stale/);
 input=await f.input();await f.intake.revoke(f.source.id,f.source.hash);await assert.rejects(recoverOverdueCalendarDraft(f.db,input,120,()=>now),/stale/);assert.equal((await f.state()).task.status,"queued");
}));

test("a worker claim wins or recovery wins atomically; a running task is never force-cancelled",()=>fixture(async f=>{
 const input=await f.input(),[claim,recovery]=await Promise.allSettled([f.store.claim(),recoverOverdueCalendarDraft(f.db,input,120,()=>now)]);
 assert.equal(claim.status,"fulfilled");
 if(claim.status==="fulfilled"&&claim.value){assert.equal(recovery.status,"rejected");assert.equal((await f.state()).task.status,"running");assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,1);}
 else{assert.equal(recovery.status,"fulfilled");assert.equal((await f.state()).task.status,"cancelled");assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,2);}
 assert.equal((await f.db.query("SELECT id FROM ledger")).length,0);
}));

test("normal in-flight reservation and unknown completion retain every accounting row and cannot be recovered",()=>fixture(async f=>{
 const task=(await f.store.claim())!,reservation=await f.store.reserve(task,"openai",pricing,100);
 await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/unfinished/);
 await f.store.uncertain(task,reservation,"Isolated unknown completion");const before=await f.state();assert.equal(before.task.status,"blocked");assert.equal(before.usage[0].status,"unknown");
 await assert.rejects(recoverOverdueCalendarDraft(f.db,await f.input(),120,()=>now),/reconciled/);assert.deepEqual((await f.state()).usage,before.usage);assert.deepEqual((await f.state()).task,before.task);
}));

test("a lock wait that crosses generation time rolls back without cancelling or creating a plan",()=>fixture(async f=>{
 const input=await f.input(),generation=new Date(Math.floor(now.getTime()/60_000)*60_000+60_000),post=new Date(generation.getTime()+120*HOUR),ist=new Date(post.getTime()+5.5*HOUR).toISOString();
 const soon={...input,planned_date:ist.slice(0,10),post_time:ist.slice(11,16)};let clockTime=new Date(now),advanced=false;
 const delayed:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({async query<T>(sql:string,params?:unknown[]){
  const rows=await tx.query<T>(sql,params);
  if(sql.includes("FROM ledger WHERE task_id=$1 FOR UPDATE")){clockTime=new Date(now.getTime()+120_000);advanced=true;}
  return rows;
 }}))};
 const before=await f.state(),entries=await f.db.query("SELECT * FROM calendar_entries"),events=await f.db.query("SELECT * FROM events ORDER BY id");
 await assert.rejects(recoverOverdueCalendarDraft(delayed,soon,120,()=>clockTime),/both in the future/);
 assert.equal(advanced,true);assert.deepEqual(await f.state(),before);assert.deepEqual(await f.db.query("SELECT * FROM calendar_entries"),entries);assert.deepEqual(await f.db.query("SELECT * FROM events ORDER BY id"),events);assert.equal((await f.db.query("SELECT id FROM tasks")).length,1);
}));

test("time is checked again immediately before writes, after all locked eligibility checks",()=>fixture(async f=>{
 const input=await f.input(),generation=new Date(Math.floor(now.getTime()/60_000)*60_000+60_000),post=new Date(generation.getTime()+120*HOUR),ist=new Date(post.getTime()+5.5*HOUR).toISOString();let clockTime=new Date(now),advanced=false;
 const delayed:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({async query<T>(sql:string,params?:unknown[]){
  const rows=await tx.query<T>(sql,params);
  if(sql.includes("FROM publishing_outbox WHERE task_id=$1")){clockTime=new Date(now.getTime()+120_000);advanced=true;}
  return rows;
 }}))};
 const before=await f.state();
 await assert.rejects(recoverOverdueCalendarDraft(delayed,{...input,planned_date:ist.slice(0,10),post_time:ist.slice(11,16)},120,()=>clockTime),/both in the future/);
 assert.equal(advanced,true);assert.deepEqual(await f.state(),before);assert.equal((await f.db.query("SELECT id FROM calendar_entries")).length,1);assert.equal((await f.db.query("SELECT id FROM events WHERE kind='calendar_draft_replanned'")).length,0);
}));
