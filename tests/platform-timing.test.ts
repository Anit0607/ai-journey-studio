import test from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {embedded} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {Store} from "../lib/store";
import {BENCHMARK_PRESET} from "../lib/schedule-presets";
import {BASE_SCHEMA,PREFLIGHT_SCHEMA,REVISION_SCHEMA,CALENDAR_SCHEMA,PLATFORM_TIMING_SCHEMA} from "../lib/schema";
const config={start_date:"2026-10-14",post_time:null,short_days:[1,3,5],long_day:0,generation_lead_hours:null,timing_mode:"per_platform" as const,platform_times:BENCHMARK_PRESET.times,timing_basis:BENCHMARK_PRESET.id};
test("platform/day benchmark is optional; no hours or dates are seeded",async()=>{
  const db=await embedded();try{const calendar=new Calendar(db),settings=await calendar.settings();assert.equal(settings.start_date,null);assert.equal(settings.post_time,null);assert.deepEqual(settings.platform_times,{});assert.equal(settings.timing_basis,null);assert.equal((await db.query<any>("SELECT * FROM calendar_entries")).length,0);}finally{await db.close();}
});
test("new Wednesday plan uses only LinkedIn timing and preserves its 48-hour review deadline",async()=>{
  const db=await embedded();try{const calendar=new Calendar(db),store=new Store(db);await calendar.configure(config);await calendar.plan(1);const snapshot=await calendar.snapshot(await store.snapshot(),{},false),entry=snapshot.entries[0];assert.equal(entry.planned_date,"2026-10-14");
    const linkedin=entry.variants.find((item:any)=>item.platform==="LinkedIn");
    assert.equal(linkedin.intended_post,"2026-10-14T10:30:00.000Z");assert.equal(entry.variants.length,1);assert.equal(new Date(entry.review_due).toISOString(),"2026-10-12T10:30:00.000Z");assert.equal(linkedin.review_due,"2026-10-12T10:30:00.000Z");assert.equal(entry.generation_due,null);assert.equal(snapshot.paid_activation,false);assert.equal(snapshot.settings.timing_basis,BENCHMARK_PRESET.id);assert.equal((await store.snapshot()).ledger.length,0);
    const monday=snapshot.entries.find((item:any)=>item.planned_date==="2026-10-19");assert.equal(monday.variants.find((item:any)=>item.platform==="LinkedIn").intended_post,"2026-10-19T16:30:00.000Z");
  }finally{await db.close();}
});
test("partial/invalid platform times cannot silently fall back to shared hour or mislabel provenance",async()=>{
  const db=await embedded();try{const calendar=new Calendar(db);await calendar.configure({...config,post_time:"10:00",platform_times:{LinkedIn:{"3":"16:00"}},timing_basis:"custom"});await assert.rejects(calendar.plan(1),/every platform\/day/);
    for(const platform_times of [{YouTube:{"3":"10:00"}},{LinkedIn:{"8":"10:00"}},{X:{"3":"24:00"}}])await assert.rejects(calendar.configure({...config,platform_times} as any),/Invalid platform timing/);
    await assert.rejects(calendar.configure({...config,platform_times:{...BENCHMARK_PRESET.times,LinkedIn:{...BENCHMARK_PRESET.times.LinkedIn,"3":"11:00"}}}),/provenance/);assert.equal((await db.query<any>("SELECT * FROM calendar_entries")).length,0);
  }finally{await db.close();}
});
test("additive timing migration preserves legacy settings and existing planned records",async()=>{
  const db=new PGlite();try{await db.exec(BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA+CALENDAR_SCHEMA);await db.query("UPDATE calendar_settings SET start_date='2026-10-14',post_time='10:00' WHERE id=1");await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due) VALUES('00000000-0000-4000-8000-000000000001','2026-10-14','shortform','2026-10-14T04:30Z','2026-10-12T04:30Z','2026-10-12T04:30Z')");const before=(await db.query<any>("SELECT * FROM calendar_entries")).rows[0];await db.exec(PLATFORM_TIMING_SCHEMA);const settings=(await db.query<any>("SELECT * FROM calendar_settings")).rows[0],after=(await db.query<any>("SELECT * FROM calendar_entries")).rows[0];assert.equal(settings.post_time,"10:00");assert.equal(settings.timing_mode,"shared");assert.deepEqual(settings.platform_times,{});for(const [key,value] of Object.entries(before))assert.deepEqual(after[key],value);assert.deepEqual(after.platform_schedule,{});
  }finally{await db.close();}
});
