import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {Store} from "../lib/store";
import {CAPSULE} from "../lib/domain";
async function fixture(work:(calendar:Calendar,store:Store)=>Promise<void>){const db=await embedded();try{await work(new Calendar(db),new Store(db));}finally{await db.close();}}
const chosen={start_date:"2026-10-12",post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:null};
test("approved cadence persists but start/hour and all content links remain unset",()=>fixture(async(calendar,store)=>{
  const state=await calendar.snapshot(await store.snapshot(),{},false);assert.deepEqual(state.settings.short_days,[1,3,5]);assert.equal(state.settings.long_day,0);assert.equal(state.settings.timezone,"Asia/Kolkata");assert.equal(state.settings.review_hours,48);assert.equal(state.settings.start_date,null);assert.equal(state.settings.post_time,null);assert.equal(state.settings.generation_lead_hours,null);assert.equal(state.entries.length,0);assert.equal(state.paid_activation,false);await assert.rejects(calendar.plan(1),/Choose start date/);
}));
test("explicit timing creates four real planning intents with IST and exact 48-hour deadline",()=>fixture(async(calendar,store)=>{
  await calendar.configure(chosen);await calendar.plan(1);let state=await calendar.snapshot(await store.snapshot(),{},false);
  assert.equal(state.entries.length,4);assert.equal(state.entries[0].planned_date,"2026-10-12");assert.equal(new Date(state.entries[0].intended_post).toISOString(),"2026-10-12T04:30:00.000Z");assert.equal(new Date(state.entries[0].review_due).toISOString(),"2026-10-10T04:30:00.000Z");assert.equal(state.entries[0].generation_due,null);assert.equal(state.entries[3].kind,"longform");assert(state.entries.every((entry:any)=>entry.source_id===null&&entry.task_id===null));
  const ids=state.entries.map((entry:any)=>entry.id);await calendar.plan(1);state=await calendar.snapshot(await store.snapshot(),{},false);assert.deepEqual(state.entries.map((entry:any)=>entry.id),ids);assert.equal((await store.snapshot()).tasks.length,0);
}));
test("concurrent due preparation is idempotent and never queues a paid content task",()=>fixture(async(calendar,store)=>{
  await calendar.configure({...chosen,generation_lead_hours:72});await calendar.plan(1);
  assert.equal((await calendar.prepareDue(new Date("2026-10-09T04:29:59Z"))).inserted,0);
  const results=await Promise.all([calendar.prepareDue(new Date("2026-10-09T04:30:00Z")),calendar.prepareDue(new Date("2026-10-09T04:30:00Z"))]);assert.equal(results.reduce((sum,item)=>sum+item.inserted,0),1);assert(results.every(item=>item.paid_execution===false));
  const state=await store.snapshot();assert.equal(state.tasks.length,0);assert.equal(state.ledger.length,0);assert.equal((await store.db.query("SELECT * FROM calendar_jobs")).length,1);
}));
test("only explicit matching source/task links persist; content gaps and runtime blockers remain visible",()=>fixture(async(calendar,store)=>{
  const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
  await calendar.configure(chosen);await calendar.plan(1);let state=await calendar.snapshot(await store.snapshot(),{},false),entry=state.entries[0];assert.equal(entry.source_id,null);
  await assert.rejects(calendar.link(entry.id,null,task.id),/must match/);await calendar.link(entry.id,source.id,task.id);
  state=await calendar.snapshot(await store.snapshot(),{},false);entry=state.entries[0];assert.equal(entry.source_id,source.id);assert.equal(entry.task_id,task.id);assert(entry.blocked_reasons.some((reason:string)=>reason.includes("emotional context")));assert(entry.blocked_reasons.some((reason:string)=>reason.includes("consent")));assert(entry.blocked_reasons.some((reason:string)=>reason.includes("runtime")));assert(entry.blocked_reasons.some((reason:string)=>reason.includes("not activated")));assert(entry.variants.every((item:any)=>item.status==="not_generated"));assert.equal((await store.snapshot()).ledger.length,0);
}));
test("invalid dates, cadence and generation timing do not mutate calendar configuration",()=>fixture(async(calendar)=>{
  for(const input of [{...chosen,start_date:"2026-02-30"},{...chosen,post_time:"24:00"},{...chosen,short_days:[1,1]},{...chosen,long_day:1},{...chosen,generation_lead_hours:47}])await assert.rejects(calendar.configure(input));
  assert.equal((await calendar.settings()).start_date,null);await assert.rejects(calendar.plan(5));
}));
