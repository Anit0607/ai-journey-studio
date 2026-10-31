import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {Calendar} from "../lib/calendar";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";
import {BENCHMARK_PRESET} from "../lib/schedule-presets";
import {applyEvidenceSchedule,moveCalendarEntry} from "../lib/calendar-schedule";
import {parseAssistantCalendar} from "../lib/assistant-edit";
import {FIXED_WEEKLY_UTC,schedulerWindowPolicy,exactSchedulerAnchor} from "../lib/scheduler-window-policy";

// Friday 30 Oct 2026, 20:00 UTC (Saturday 01:30 IST), mirroring the live transition.
const now=new Date("2026-10-30T20:00:00Z");
const oldEntry=async(db:Database,date:string,kind:string,post:string,link:{source?:string;task?:string}={})=>{const id=randomUUID(),review=new Date(Date.parse(post)-48*3_600_000).toISOString();await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)",[id,date,kind,post,review,link.source||null,link.task||null,JSON.stringify({LinkedIn:{intended_post:post,draft_due:review,review_due:review},platform_policy:NEW_PLATFORM_POLICY})]);return id;};
async function seed(db:Database){
 await new Calendar(db).configure({start_date:"2026-10-27",post_time:null,short_days:[1,3,5],long_day:0,generation_lead_hours:120,timing_mode:"per_platform",platform_times:{LinkedIn:{"0":"22:00","1":"22:00","3":"16:00","5":"15:00"}},timing_basis:"custom"});
 const intake=new SourceIntake(db),staged=await intake.stage({text:"I reviewed a draft.",category:"project-note",reported_date:"2026-10-20"}),source=await intake.clear(staged.id,staged.hash,true),task=await new Store(db).enqueue(source.id);
 const linked=await oldEntry(db,"2026-11-01","longform","2026-11-01T16:30:00.000Z",{source:source.id,task:task.id});
 const empty=[await oldEntry(db,"2026-11-02","shortform","2026-11-02T16:30:00.000Z"),await oldEntry(db,"2026-11-04","shortform","2026-11-04T10:30:00.000Z"),await oldEntry(db,"2026-11-06","shortform","2026-11-06T09:30:00.000Z")];
 return {source,task,linked,empty};
}
const outbox=(db:Database,task:{id:string;source_id:string},status:string,extra:Record<string,unknown>={})=>db.query("INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,source_clearance_token,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version,status,claimed_at) VALUES($1,$2,$3,$4,'h','c','r','a','v','LinkedIn','acct','v1','urn:li:person:1',$5,'2026-11-01T16:30:00Z',$6,$7,$8)",[randomUUID(),randomUUID(),task.id,task.source_id,JSON.stringify({text:"x"}),randomUUID(),status,extra.claimed_at||null]);

test('the fixed weekly anchors are the owner-approved evidence slots',()=>{
 assert.deepEqual([...FIXED_WEEKLY_UTC],['Mon18:00','Tue03:30','Wed14:00','Thu03:30']);
 const policy=schedulerWindowPolicy({provider:'qstash',mode:'external',cadence_seconds:120,source_interval_minutes:60,window_policy:{kind:'fixed-cadence-v1',weekly_utc:[...FIXED_WEEKLY_UTC],exceptions_utc:[]}});
 for(const at of ['2026-11-02T18:00:00Z','2026-11-03T03:30:00Z','2026-11-04T14:00:00Z','2026-11-05T03:30:00Z'])assert.equal(exactSchedulerAnchor(policy,at),true,at);
 for(const at of ['2026-11-01T16:30:00Z','2026-11-06T09:30:00Z','2026-11-02T16:30:00Z'])assert.equal(exactSchedulerAnchor(policy,at),false,at);
 assert.deepEqual(Object.values(BENCHMARK_PRESET.slots).map(slot=>slot.audience),['global','india','global','india']);
});

test('applying the evidence schedule replaces only future empty slots and plans the new days',async()=>{
 const db=await embedded();try{
  const {linked,empty}=await seed(db);
  const result=await applyEvidenceSchedule(db,'assistant',now);assert.equal(result.removed,3);
  const settings=(await db.query<any>("SELECT * FROM calendar_settings WHERE id=1"))[0];
  assert.deepEqual(settings.short_days,[1,2,4]);assert.equal(settings.long_day,3);assert.equal(settings.timing_basis,BENCHMARK_PRESET.id);assert.equal(settings.start_date,'2026-10-31');
  const entries=await db.query<any>("SELECT id,planned_date,kind,intended_post FROM calendar_entries ORDER BY planned_date");
  assert(entries.some(e=>e.id===linked),'the slot with a post is untouched');assert(!entries.some(e=>empty.includes(e.id)));
  const fresh=entries.filter(e=>e.id!==linked).map(e=>[e.planned_date,e.kind,new Date(e.intended_post).toISOString()]);
  assert.deepEqual(fresh.slice(0,4),[['2026-11-02','shortform','2026-11-02T18:00:00.000Z'],['2026-11-03','shortform','2026-11-03T03:30:00.000Z'],['2026-11-04','longform','2026-11-04T14:00:00.000Z'],['2026-11-05','shortform','2026-11-05T03:30:00.000Z']]);
  assert.equal(fresh.length,16,'four weeks of four slots');
  const events=await db.query<any>("SELECT detail FROM events WHERE kind='calendar_schedule_applied'");assert.match(events[0].detail,/^Assistant \(owner-approved in chat\) applied .*nothing approved$/);
 }finally{await db.close();}
});

test('moving a post retimes it to the new slot, replaces an empty occupant and cancels unattempted approvals',async()=>{
 const db=await embedded();try{
  const {task,linked}=await seed(db);await applyEvidenceSchedule(db,'owner',now);
  await outbox(db,task,'approved');
  const moved=await moveCalendarEntry(db,{entry:linked,planned_date:'2026-11-03'},'assistant',now);
  assert.deepEqual(moved,{entry:linked,intended_post:'2026-11-03T03:30:00.000Z',kind:'shortform'});
  const entry=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[linked]))[0];
  assert.equal(entry.planned_date,'2026-11-03');assert.equal(entry.platform_schedule.LinkedIn.intended_post,'2026-11-03T03:30:00.000Z');assert.equal(new Date(entry.review_due).toISOString(),'2026-11-01T03:30:00.000Z');
  assert.equal((await db.query("SELECT * FROM calendar_entries WHERE planned_date='2026-11-03'")).length,1,'the empty planned slot was replaced, not duplicated');
  const rows=await db.query<any>("SELECT status,reason FROM publishing_outbox");assert.equal(rows[0].status,'cancelled');assert.match(rows[0].reason,/fresh approval required/);
  assert.match((await db.query<any>("SELECT detail FROM events WHERE kind='calendar_entry_moved'"))[0].detail,/fresh owner approval required/);
 }finally{await db.close();}
});

test('a move is refused for non-posting days, past or imminent times, occupied slots and started deliveries',async()=>{
 const db=await embedded();try{
  const {task,source,linked}=await seed(db);await applyEvidenceSchedule(db,'owner',now);
  await assert.rejects(moveCalendarEntry(db,{entry:linked,planned_date:'2026-11-06'},'owner',now),/not a posting day/);
  await assert.rejects(moveCalendarEntry(db,{entry:linked,planned_date:'2026-10-27'},'owner',now),/at least one hour from now/);
  await assert.rejects(moveCalendarEntry(db,{entry:linked,planned_date:'2026-11-3'},'owner',now),/Choose a post and a new date/);
  const other=await new Store(db).enqueue(source.id);
  await db.query("UPDATE calendar_entries SET source_id=$1,task_id=$2 WHERE planned_date='2026-11-05'",[source.id,other.id]);
  await assert.rejects(moveCalendarEntry(db,{entry:linked,planned_date:'2026-11-05'},'owner',now),/already has a post/);
  await outbox(db,task,'claimed',{claimed_at:now});
  await assert.rejects(moveCalendarEntry(db,{entry:linked,planned_date:'2026-11-03'},'owner',now),/cannot be moved/);
  assert.equal(new Date((await db.query<any>("SELECT intended_post FROM calendar_entries WHERE id=$1",[linked]))[0].intended_post).toISOString(),'2026-11-01T16:30:00.000Z','refused moves change nothing');
 }finally{await db.close();}
});

test('the assistant calendar request accepts only the two scheduling operations',()=>{
 assert.deepEqual(parseAssistantCalendar({op:'apply-schedule'}),{op:'apply-schedule'});
 assert.deepEqual(parseAssistantCalendar({op:'move',entry:'e',planned_date:'2026-11-03'}),{op:'move',entry:'e',planned_date:'2026-11-03'});
 for(const bad of [{op:'approve'},{op:'apply-schedule',extra:1},{op:'move',entry:'e'},{op:'move',entry:'e',planned_date:'d',acknowledged:true},[]])assert.throws(()=>parseAssistantCalendar(bad),/Invalid assistant calendar request/);
});

test('standing owner-approved prices keep drafting available after seven days; other windows still expire',async()=>{
 const {configReady}=await import('../lib/domain');
 const pricing={model:'m',pricing_version:'v',pricing_tier:'standard' as const,official_pricing_url:'https://example.test',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
 const base={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:'2026-10-30',pricing_window_authorized:true,openai:pricing,fallback_authorized:false};
 assert.equal(configReady({...base,pricing_valid_until:'until-changed'},new Date('2027-03-01T00:00:00Z')),true);
 assert.equal(configReady({...base,pricing_valid_until:'2026-11-05'},new Date('2026-11-06T00:00:00Z')),false);
 assert.equal(configReady({...base,pricing_valid_until:'until-changed'},new Date('2026-10-29T00:00:00Z')),false,'not before the verification day');
 assert.equal(configReady({...base,pricing_window_authorized:false,pricing_valid_until:'until-changed'},new Date('2026-11-06T00:00:00Z')),false,'standing prices need the explicit window authorization');
});
