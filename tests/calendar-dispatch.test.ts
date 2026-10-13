import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {embedded,type Database} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {CAPSULE,CAP,BUFFER,WARNING,hash,istMonth,tokenCost,type RuntimeConfig,type Source} from "../lib/domain";
import {BASE_SCHEMA,PREFLIGHT_SCHEMA,REVISION_SCHEMA,CALENDAR_SCHEMA,PLATFORM_TIMING_SCHEMA} from "../lib/schema";
import {CALENDAR_DISPATCH_SCHEMA} from "../lib/calendar-dispatch-schema";

const now=new Date(),hour=3_600_000;
const pricing={model:"gpt-test",pricing_version:"isolated-test",pricing_tier:"standard" as const,official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:now.toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
const chosen={start_date:new Date(now.getTime()+72*hour).toISOString().slice(0,10),post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:72};
async function fixture(work:(db:Database,calendar:Calendar,store:Store,intake:SourceIntake)=>Promise<void>){
  const db=await embedded();try{await work(db,new Calendar(db),new Store(db),new SourceIntake(db));}finally{await db.close();}
}
async function cleared(intake:SourceIntake,text="I built an agent workflow today. I found that reviewing each source helped me catch a missing date."){
  const source=await intake.stage({text,category:"build-log",reported_date:now.toISOString().slice(0,10)});
  return intake.clear(source.id,source.hash,true);
}
async function entry(db:Database,source:Source|null,options:{task?:string;offset?:number;postHours?:number;due?:Date|null}={}){
  const id=randomUUID(),post=new Date(now.getTime()+(options.postHours??72)*hour),review=new Date(post.getTime()-48*hour);
  await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id,task_id) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6,$7)",[id,new Date(now.getTime()+(72+(options.offset||0)*24)*hour).toISOString().slice(0,10),post,review,options.due===undefined?now:options.due,source?.id||null,options.task||null]);
  return id;
}
async function accounting(db:Database,taskId:string,status="settled",amount=1,month=istMonth(now),anomaly=false){
  await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);
  await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,estimated,status,pricing_anomaly) VALUES($1,$2,$3,'openai','gpt-test',$4,$5,$6,$7,$8)",[randomUUID(),taskId,month,JSON.stringify(pricing),amount,status==="settled"?amount:null,status,anomaly]);
}

test("calendar activation defaults off and ordinary configuration never implicitly enables it",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure(chosen);const id=await entry(db,source);
  const first=await calendar.dispatchDue(config,true,now);assert.equal(first.queued,0);assert.equal(first.blocked,1);assert.match(first.entries[0].reason!,/not activated/);assert.equal((await calendar.settings()).generation_enabled,false);assert.equal((await store.snapshot()).tasks.length,0);
  await assert.rejects(calendar.configure({...chosen,generation_enabled:"true" as any}),/activation/);
  await calendar.configure({...chosen,generation_enabled:true});await calendar.configure(chosen);assert.equal((await calendar.settings()).generation_enabled,true);
  const next=await calendar.dispatchDue(config,true,now);assert.equal(next.queued,1);assert.equal(next.entries[0].entry_id,id);assert.equal(next.paid_execution,false);assert.equal((await store.snapshot()).ledger.length,0);
  await calendar.configure({...chosen,generation_enabled:false});assert.equal((await calendar.settings()).generation_enabled,false);
}));

test("generation requires a one-hour cushion and preserves legacy 48-hour settings without dispatch",()=>fixture(async(db,calendar,store,intake)=>{
  await assert.rejects(calendar.configure({...chosen,generation_lead_hours:48,generation_enabled:true}),/49 to 336/);
  assert.equal((await calendar.settings()).generation_lead_hours,null);
  await calendar.configure({...chosen,generation_lead_hours:49,generation_enabled:true});assert.equal((await calendar.settings()).generation_lead_hours,49);
  const source=await cleared(intake);const legacy=await entry(db,source,{postHours:48});
  await db.query("UPDATE calendar_settings SET generation_lead_hours=48 WHERE id=1");
  let result=await calendar.dispatchDue(config,true,now);assert.equal(result.queued,0);assert.match(result.entries[0].reason!,/one-hour cushion/);assert.equal((await calendar.settings()).generation_lead_hours,48);
  assert.equal((await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[legacy]))[0].generation_due.getTime(),now.getTime());
  await calendar.configure({...chosen,generation_lead_hours:49,generation_enabled:true});
  result=await calendar.dispatchDue(config,true,now);assert.equal(result.queued,0);assert.match(result.entries[0].reason!,/explicitly replan/);
  await entry(db,source,{offset:1,postHours:49});
  const interior=new Date(now.getTime()+30*60_000),runtime={...config,pricing_verified_date:interior.toISOString().slice(0,10)};
  result=await calendar.dispatchDue(runtime,true,interior);assert.equal(result.queued,1);assert.equal((await store.snapshot()).tasks.length,1);assert.equal((await store.snapshot()).ledger.length,0);
}));

test("concurrent due dispatch and legacy preparation produce exactly one durable task and exact linkage",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});const id=await entry(db,source);
  assert.equal((await calendar.prepareDue(now)).inserted,1);
  const results=await Promise.all(Array.from({length:5},()=>calendar.dispatchDue(config,true,now)));
  assert.equal(results.reduce((sum,result)=>sum+result.queued,0),1);assert.equal(results.reduce((sum,result)=>sum+result.existing,0),4);
  const tasks=await db.query<any>("SELECT * FROM tasks"),jobs=await db.query<any>("SELECT * FROM calendar_jobs"),planned=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[id]))[0];
  assert.equal(tasks.length,1);assert.equal(tasks[0].origin_key,"calendar:"+id);assert.equal(jobs.length,1);assert.equal(jobs[0].status,"dispatched");assert.equal(jobs[0].task_id,tasks[0].id);assert.equal(jobs[0].source_hash,source.hash);assert.equal(planned.task_id,tasks[0].id);assert.equal((await store.snapshot()).ledger.length,0);
  assert.equal((await db.query("SELECT id FROM events WHERE kind='calendar_dispatched'")).length,1);
  const brief=tasks[0].content_brief;assert.equal(brief.kind,"shortform");assert.deepEqual(brief.platforms,["LinkedIn","X","Instagram"]);assert.equal(brief.planned_date,planned.planned_date);assert.equal(brief.intended_post,new Date(planned.intended_post).toISOString());
  await db.query("UPDATE calendar_entries SET kind='longform',intended_post=intended_post+interval '1 day' WHERE id=$1",[id]);
  await calendar.dispatchDue(config,true,now);assert.deepEqual((await db.query<any>("SELECT * FROM tasks WHERE id=$1",[tasks[0].id]))[0].content_brief,brief);
}));

test("distinct scheduled slots never reuse a completed manual task or each other's task",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake),manual=await store.enqueue(source.id);await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[manual.id]);
  await calendar.configure({...chosen,generation_enabled:true});await entry(db,source);await entry(db,source,{offset:1});
  assert.equal((await calendar.dispatchDue(config,true,now)).queued,2);
  const tasks=await db.query<any>("SELECT * FROM tasks"),jobs=await db.query<any>("SELECT * FROM calendar_jobs");assert.equal(tasks.length,3);assert.equal(new Set(jobs.map(job=>job.task_id)).size,2);assert(jobs.every(job=>job.task_id!==manual.id));
  assert.equal((await store.enqueue(source.id)).id,manual.id);
}));

test("explicitly linked review task is preserved without automatic regeneration",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake),task=await store.enqueue(source.id);await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  await calendar.configure({...chosen,generation_enabled:true});const id=await entry(db,source,{task:task.id});
  const result=await calendar.dispatchDue(config,true,now);assert.equal(result.queued,0);assert.equal(result.existing,1);assert.equal(result.entries[0].status,"review");assert.equal((await db.query("SELECT id FROM tasks")).length,1);
  const job=(await db.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1",[id]))[0];assert.equal(job.status,"linked");assert.equal(job.task_id,task.id);await assert.rejects(calendar.link(id,source.id,null),/cannot be relinked/);
}));

test("cancelled or accounting-blocked scheduled tasks are never replaced or replayed",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});const id=await entry(db,source);
  const created=await calendar.dispatchDue(config,true,now),taskId=created.entries[0].task_id!;await store.cancel(taskId);
  const cancelled=await calendar.dispatchDue(config,true,now);assert.equal(cancelled.queued,0);assert.equal(cancelled.existing,1);assert.match(cancelled.entries[0].reason!,/cancelled/);
  await assert.rejects(calendar.link(id,null,null),/cannot be relinked/);assert.equal((await db.query("SELECT id FROM tasks")).length,1);
  await db.query("UPDATE tasks SET status='blocked' WHERE id=$1",[taskId]);await accounting(db,taskId,"unknown",50,"2020-01");
  assert.match((await calendar.dispatchDue(config,true,now)).entries[0].reason!,/reconciliation/);
  await db.query("UPDATE ledger SET status='settled',estimated=1 WHERE task_id=$1",[taskId]);assert.equal((await calendar.dispatchDue(config,true,now)).queued,0);assert.equal((await db.query<any>("SELECT * FROM tasks WHERE id=$1",[taskId]))[0].status,"blocked");
}));

test("standing consent, explicit owner source clearance, runtime, pricing and OpenAI-only gates fail closed",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});await entry(db,source);
  const cases:[RuntimeConfig,boolean,RegExp][]=[
    [{...config,owner_cleared_sources_authorized:false},true,/Standing consent/],
    [config,false,/runtime/],
    [{...config,pricing_verified_date:"2000-01-01"},true,/pricing\/security/],
    [{...config,security_tests_passed:false},true,/pricing\/security/],
    [{...config,credential_use_authorized:false},true,/pricing\/security/],
    [{...config,fallback_authorized:true,gemini:pricing},true,/OpenAI only/]
  ];
  for(const [runtime,enabled,reason] of cases){const result=await calendar.dispatchDue(runtime,enabled,now);assert.equal(result.queued,0);assert.match(result.entries[0].reason!,reason);}
  await intake.revoke(source.id,source.hash);assert.match((await calendar.dispatchDue(config,true,now)).entries[0].reason!,/owner clearance/);
  assert.equal((await store.snapshot()).tasks.length,0);assert.equal((await store.snapshot()).ledger.length,0);
  await intake.clear(source.id,source.hash,true);assert.equal((await calendar.dispatchDue(config,true,now)).queued,1);
}));

test("legacy clearance and an unlinked available source cannot silently authorize a scheduled source",()=>fixture(async(db,calendar,store,intake)=>{
  const legacy=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true);await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});await entry(db,legacy);await entry(db,null,{offset:1});
  const result=await calendar.dispatchDue({...config,source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true},true,now);assert.equal(result.queued,0);assert.equal(result.blocked,2);assert(result.entries.some(item=>item.reason?.includes("owner clearance")));assert(result.entries.some(item=>item.reason?.includes("no evidence is auto-selected")));assert.equal((await store.snapshot()).tasks.length,0);
}));

test("source text or provenance tampering blocks dispatch from persisted evidence",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});await entry(db,source);
  await db.query("UPDATE sources SET text=$2 WHERE id=$1",[source.id,source.text+" An added claim."]);assert.equal((await calendar.dispatchDue(config,true,now)).queued,0);
  await db.query("UPDATE sources SET text=$2,clearance_provider='gemini' WHERE id=$1",[source.id,source.text]);assert.equal((await calendar.dispatchDue(config,true,now)).queued,0);assert.equal((await store.snapshot()).tasks.length,0);
}));

test("unresolved prior-month accounting and insufficient next-checkpoint headroom block dispatch",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake),manual=await store.enqueue(source.id);await calendar.configure({...chosen,generation_enabled:true});await entry(db,source);
  await accounting(db,manual.id,"unknown",100,"2020-01");assert.match((await calendar.dispatchDue(config,true,now)).entries[0].reason!,/accounting/);
  await db.query("UPDATE ledger SET status='reserved',pricing_anomaly=true");assert.equal((await calendar.dispatchDue(config,true,now)).queued,0);
  const upper=tokenCost(pricing,48_256,1200);await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[istMonth(now)]);
  await db.query("UPDATE ledger SET status='settled',pricing_anomaly=false,estimated=$1,month=$2",[CAP-BUFFER-upper+1,istMonth(now)]);
  assert.match((await calendar.dispatchDue(config,true,now)).entries[0].reason!,/remaining capacity/);
  await db.query("UPDATE ledger SET estimated=$1",[WARNING]);assert.equal((await calendar.dispatchDue(config,true,now)).queued,1);
  assert.equal((await store.snapshot()).budget.warning,true);
}));

test("future and unset slots stay untouched; missed review/posting deadlines have explicit reasons",()=>fixture(async(db,calendar,_store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});await entry(db,source,{due:new Date(now.getTime()+1)});await entry(db,source,{offset:1,due:null});
  assert.equal((await calendar.dispatchDue(config,true,now)).entries.length,0);assert.equal((await db.query("SELECT id FROM calendar_jobs")).length,0);
  await entry(db,source,{offset:2,postHours:47});await entry(db,source,{offset:3,postHours:0});
  const result=await calendar.dispatchDue(config,true,now);assert.equal(result.queued,0);assert.equal(result.blocked,2);assert(result.entries.some(item=>item.reason?.includes("Draft/review deadline")));assert(result.entries.some(item=>item.reason?.includes("posting time has passed")));
  await entry(db,source,{offset:4,postHours:49});assert.equal((await calendar.dispatchDue(config,true,now)).queued,1);
}));

test("dispatch failure rolls back task creation, calendar link and durable intent together",()=>fixture(async(db,calendar,_store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});const id=await entry(db,source);
  const failing:Database={...db,transaction:work=>db.transaction(tx=>work({async query<T>(sql:string,params?:unknown[]){if(sql.includes("'calendar_dispatched'"))throw Error("Injected event failure");return tx.query<T>(sql,params);}}))};
  await assert.rejects(new Calendar(failing).dispatchDue(config,true,now),/Injected/);assert.equal((await db.query("SELECT id FROM tasks")).length,0);assert.equal((await db.query("SELECT id FROM calendar_jobs")).length,0);assert.equal((await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[id]))[0].task_id,null);
  assert.equal((await calendar.dispatchDue(config,true,now)).queued,1);
}));

test("snapshot exposes actual toggle, fresh gates and exact job linkage without claiming a scheduler",()=>fixture(async(db,calendar,store,intake)=>{
  const source=await cleared(intake);await calendar.configure({...chosen,generation_enabled:true});const id=await entry(db,source);
  let state=await calendar.snapshot(await store.snapshot(),config,true,now);assert.equal(state.paid_activation,true);assert.equal(state.entries[0].status,"due_ready");assert.deepEqual(state.entries[0].blocked_reasons,[]);assert.match(state.scheduler,/requires.*invocation/);
  const result=await calendar.dispatchDue(config,true,now);state=await calendar.snapshot(await store.snapshot(),config,true,now);assert.equal(state.entries[0].job.task_id,result.entries[0].task_id);assert.equal(state.entries[0].status,"queued");
  await db.query("UPDATE calendar_entries SET task_id=NULL WHERE id=$1",[id]);const repeated=await calendar.dispatchDue(config,true,now);assert.equal(repeated.queued,0);assert.match(repeated.entries[0].reason!,/linkage changed/);assert.equal((await db.query("SELECT id FROM tasks")).length,1);
}));

test("calendar dispatch migration is repeatable and preserves legacy data without activation",async()=>{
  const db=new PGlite();try{
    await db.exec(BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA+CALENDAR_SCHEMA+PLATFORM_TIMING_SCHEMA);
    const source=randomUUID(),task=randomUUID(),planned=randomUUID(),job=randomUUID();
    await db.query("INSERT INTO sources(id,text,category,reported_date,hash,cleared) VALUES($1,'Legacy test','build-log','2026-10-09','legacy-hash',true)",[source]);
    await db.query("INSERT INTO tasks(id,source_id,source_hash,status) VALUES($1,$2,'legacy-hash','cancelled')",[task,source]);
    await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,task_id,source_id) VALUES($1,'2026-10-14','shortform','2026-10-14','2026-10-12','2026-10-12',$2,$3)",[planned,task,source]);
    await db.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked')",[job,planned]);
    await db.exec(CALENDAR_DISPATCH_SCHEMA);await db.exec(CALENDAR_DISPATCH_SCHEMA);
    assert.equal((await db.query<any>("SELECT * FROM calendar_settings")).rows[0].generation_enabled,false);const after=(await db.query<any>("SELECT * FROM tasks")).rows[0];assert.equal(after.id,task);assert.equal(after.status,"cancelled");assert.equal(after.origin_key,"manual");assert.deepEqual(after.content_brief,{});assert.equal((await db.query<any>("SELECT * FROM calendar_entries")).rows[0].task_id,task);assert.equal((await db.query<any>("SELECT * FROM calendar_jobs")).rows[0].task_id,null);
    await db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key) VALUES($1,$2,'legacy-hash','queued',$3)",[randomUUID(),source,"calendar:"+planned]);assert.equal((await db.query("SELECT id FROM tasks")).rows.length,2);
    await assert.rejects(db.query("INSERT INTO tasks(id,source_id,source_hash,status) VALUES($1,$2,'legacy-hash','queued')",[randomUUID(),source]));
  }finally{await db.close();}
});

test("hosted daily plans need120-hour lead without silently modifying local choices or review deadlines",()=>fixture(async(db,calendar,store,intake)=>{
  const hosted=new Calendar(db,120),source=await cleared(intake);
  await assert.rejects(hosted.configure({...chosen,generation_lead_hours:60}),/120 to 336/);
  await calendar.configure({...chosen,generation_lead_hours:60,generation_enabled:true});
  const id=await entry(db,source,{postHours:72});
  const blocked=await hosted.dispatchDue(config,true,now);assert.equal(blocked.queued,0);assert.match(blocked.entries[0].reason!,/at least 120 hours/);
  assert.equal((await calendar.settings()).generation_lead_hours,60);
  const before=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[id]))[0];
  const catchupDue=new Date(now.getTime()-48*hour);
  await db.query("UPDATE calendar_entries SET generation_due=$2 WHERE id=$1",[id,catchupDue]);
  const queued=await hosted.dispatchDue(config,true,now);assert.equal(queued.queued,1);
  const after=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[id]))[0];
  assert.equal(new Date(after.review_due).getTime(),new Date(before.review_due).getTime());
  const snapshot=await hosted.snapshot(await store.snapshot(),config,true,now);
  assert.equal(snapshot.minimum_generation_lead_hours,120);assert.equal(snapshot.entries[0].generation_late,true);
  assert.match(snapshot.entries[0].timing_notice!,/after the target/);
  assert.equal((await store.snapshot()).tasks[0].content_brief.generation_due,catchupDue.toISOString());
  assert.equal((await hosted.dispatchDue(config,true,now)).queued,0);
}));
