import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
const hour=3_600_000;
const settings={start_date:"2020-01-01",post_time:"10:00",short_days:[1,2,3,4,5,6],long_day:0,generation_lead_hours:120,generation_enabled:true};
async function fixture(work:(calendar:Calendar)=>Promise<void>){const db=await embedded();try{await work(new Calendar(db,120));}finally{await db.close();}}
const entries=(calendar:Calendar)=>calendar.db.query<any>("SELECT * FROM calendar_entries ORDER BY planned_date,kind");

test("rolling refill deduplicates repeated/concurrent calls and preserves settings and legacy rows",()=>fixture(async c=>{
  await c.configure(settings);
  const now=new Date("2026-10-24T18:30:00Z");
  await c.db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due) VALUES('00000000-0000-4000-8000-000000000001','2026-11-01','longform','2026-11-01T01:00Z','2026-10-30T01:00Z','2026-10-30T01:00Z')");
  await c.configure({...settings,start_date:"2026-11-02"});await c.plan(1);
  const store=new Store(c.db),intake=new SourceIntake(c.db),source=await intake.stage({text:"I built an owner evidence fixture and verified its exact source before drafting.",category:"project-note",reported_date:"2026-10-24"});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
  const planned=(await entries(c)).find(row=>row.planned_date==="2026-11-02");await c.link(planned.id,source.id,task.id);
  await c.configure(settings);
  const before=await entries(c),config=await c.settings();
  const results=await Promise.all([c.refillHorizon(now),c.refillHorizon(now),c.refillHorizon(now)]);
  const after=await entries(c);
  assert.equal(results.reduce((sum,r)=>sum+r.inserted,0),after.length-before.length);
  for(const existing of before)assert.deepEqual(after.find(row=>row.id===existing.id),existing);assert.deepEqual(await c.settings(),config);
  assert.equal((await c.refillHorizon(now)).inserted,0);
  assert.equal(new Set(after.map(row=>row.planned_date+row.kind)).size,after.length);
  assert.equal((await c.db.query("SELECT * FROM tasks")).length,1);
  assert.equal((await c.db.query("SELECT * FROM calendar_jobs")).length,0);
  assert.equal((await c.db.query("SELECT * FROM github_source_grants")).length,0);
}));

test("OFF and invalid current settings write nothing",()=>fixture(async c=>{
  const now=new Date("2026-10-24T00:00Z");
  for(const change of ["generation_enabled=false","generation_lead_hours=NULL","generation_lead_hours=119","generation_lead_hours=337","start_date=NULL","post_time=NULL","short_days='[1,1]'::jsonb","long_day=1","timing_mode='per_platform',platform_times='{}'::jsonb"]){
    await c.configure(settings);await c.db.query("UPDATE calendar_settings SET "+change+" WHERE id=1");
    const before=await c.settings(),events=await c.db.query("SELECT * FROM events ORDER BY id");
    assert.equal((await c.refillHorizon(now)).inserted,0,change);
    assert.deepEqual(await c.settings(),before);assert.deepEqual(await c.db.query("SELECT * FROM events ORDER BY id"),events);assert.deepEqual(await entries(c),[]);
  }
  await assert.rejects(c.refillHorizon(new Date(NaN)),/Invalid refill/);
}));

for(const instant of ["2026-10-24T18:29:59.999Z","2026-10-24T18:30:00Z","2026-01-31T18:30:00Z","2026-12-31T18:30:00Z","2028-02-28T18:30:00Z"]){
  test("IST bounded date window and exact timing at "+instant,()=>fixture(async c=>{
    const now=new Date(instant),today=new Date(now.getTime()+330*60_000).toISOString().slice(0,10);
    const end=new Date(Date.parse(today)+27*86_400_000).toISOString().slice(0,10);
    await c.configure(settings);await c.refillHorizon(now);const rows=await entries(c);assert(rows.length>0);
    assert.equal(rows.at(-1).planned_date,end);
    for(const row of rows){
      assert(row.planned_date>=today&&row.planned_date<=end);
      assert.equal(new Date(row.intended_post).toISOString(),row.planned_date+"T04:30:00.000Z");
      assert.equal(+new Date(row.intended_post)-+new Date(row.generation_due),120*hour);
      assert.equal(+new Date(row.intended_post)-+new Date(row.review_due),48*hour);
      assert.equal(+new Date(row.draft_due),+new Date(row.review_due));assert(+new Date(row.generation_due)>+now);
      assert.equal(row.source_id,null);assert.equal(row.task_id,null);
    }
  }));
}

test("future start is a floor and cannot extend the 28-date window",()=>fixture(async c=>{
  const now=new Date("2026-10-24T18:30Z");
  await c.configure({...settings,start_date:"2026-11-10"});await c.refillHorizon(now);
  const rows=await entries(c);assert.equal(rows[0].planned_date,"2026-11-10");assert.equal(rows.at(-1).planned_date,"2026-11-21");
  await c.configure({...settings,start_date:"2026-12-01"});assert.equal((await c.refillHorizon(now)).inserted,0);
}));

test("336-hour per-platform lead retains fixed review and skips generation due equal to now",()=>fixture(async c=>{
  const platform_times={LinkedIn:Object.fromEntries(Array.from({length:7},(_,day)=>[day,"00:00"]))};
  const now=new Date("2026-12-31T18:30Z");
  await c.configure({...settings,timing_mode:"per_platform",platform_times,generation_lead_hours:336});
  await c.refillHorizon(now);const rows=await entries(c);
  assert.equal(rows[0].planned_date,"2027-01-16");assert.equal(rows.at(-1).planned_date,"2027-01-28");
  for(const row of rows){assert.equal(+new Date(row.intended_post)-+new Date(row.generation_due),336*hour);assert.equal(+new Date(row.intended_post)-+new Date(row.review_due),48*hour);assert.equal(row.platform_schedule.LinkedIn.review_due,new Date(row.review_due).toISOString());}
}));


test("cadence changes do not add another kind on any occupied date",()=>fixture(async c=>{
  await c.configure({...settings,start_date:"2026-11-02",short_days:[0,2,3,4,5,6],long_day:1});await c.plan(1);
  const before=await entries(c);assert.equal(before[0].kind,"longform");
  await c.configure(settings);await c.refillHorizon(new Date("2026-10-24T18:30Z"));
  const after=await entries(c);for(const row of before){assert.deepEqual(after.find(item=>item.id===row.id),row);assert.equal(after.filter(item=>item.planned_date===row.planned_date).length,1);}
  assert.equal(after.find(item=>item.planned_date==="2026-11-02").kind,"longform");
}));
