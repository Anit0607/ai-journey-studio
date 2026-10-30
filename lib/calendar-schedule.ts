import {randomUUID} from "node:crypto";
import type {Database} from "./db";
import {Calendar} from "./calendar";
import {BENCHMARK_PRESET} from "./schedule-presets";
import {NEW_PLATFORM_POLICY} from "./platform-policy";
import {lockPublicationGuards} from "./calendar-publication-binding";

export type ScheduleActor="owner"|"assistant";
const HOUR=3_600_000;
const istToday=(now:Date)=>new Date(now.getTime()+330*60_000).toISOString().slice(0,10);
const actorText=(actor:ScheduleActor)=>actor==="assistant"?"Assistant (owner-approved in chat)":"Owner";

/** Switch the calendar to the evidence schedule and replace future empty slots. Slots with a
 * source, task, dispatch job or GitHub grant are never changed. Nothing is approved. */
export async function applyEvidenceSchedule(db:Database,actor:ScheduleActor,now=new Date(),minimumLeadHours=49){
  const removed=await db.transaction(async tx=>{
    await tx.query("SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE");
    await tx.query("UPDATE calendar_settings SET short_days=$1,long_day=$2,timing_mode='per_platform',platform_times=$3,timing_basis=$4,start_date=$5,updated=now() WHERE id=1",[JSON.stringify(BENCHMARK_PRESET.short_days),BENCHMARK_PRESET.long_day,JSON.stringify({LinkedIn:BENCHMARK_PRESET.times.LinkedIn}),BENCHMARK_PRESET.id,istToday(now)]);
    const rows=await tx.query<{planned_date:string}>("DELETE FROM calendar_entries e WHERE e.task_id IS NULL AND e.source_id IS NULL AND e.intended_post>$1 AND NOT EXISTS(SELECT 1 FROM calendar_jobs j WHERE j.entry_id=e.id) AND NOT EXISTS(SELECT 1 FROM github_source_grants g WHERE g.entry_id=e.id) RETURNING planned_date",[now]);
    await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_schedule_applied',$2)",[randomUUID(),actorText(actor)+" applied "+BENCHMARK_PRESET.id+"; replaced "+rows.length+" future empty slot(s); slots with posts unchanged; nothing approved"]);
    return rows.length;
  });
  await new Calendar(db,minimumLeadHours).plan(4);
  return {removed,schedule:BENCHMARK_PRESET.id};
}

/** Move a planned post to another scheduled day. Any unattempted delivery plan is cancelled,
 * so the owner must approve again; started or completed deliveries block the move. */
export async function moveCalendarEntry(db:Database,input:{entry:string;planned_date:string},actor:ScheduleActor,now=new Date()){
  if(!input||typeof input.entry!=="string"||typeof input.planned_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.planned_date))throw Error("Choose a post and a new date");
  return db.transaction(async tx=>{
    await lockPublicationGuards(tx,true);
    const settings=(await tx.query<any>("SELECT * FROM calendar_settings WHERE id=1"))[0];
    const entry=(await tx.query<any>("SELECT * FROM calendar_entries WHERE id=$1 FOR UPDATE",[input.entry]))[0];
    if(!entry)throw Error("Unknown calendar entry");
    if(new Date(entry.intended_post)<=now)throw Error("Only a future post can be moved");
    const outbox=entry.task_id?await tx.query<any>("SELECT * FROM publishing_outbox WHERE task_id=$1 ORDER BY id FOR UPDATE",[entry.task_id]):[];
    if(outbox.some(row=>["claimed","published","uncertain"].includes(row.status)||row.claimed_at||row.claim_token))throw Error("Publication has started or may have completed; it cannot be moved");
    const date=new Date(input.planned_date+"T00:00:00Z"),weekday=date.getUTCDay();
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.planned_date)throw Error("Choose a post and a new date");
    const kind=weekday===settings.long_day?"longform":settings.short_days.includes(weekday)?"shortform":null,hour=settings.platform_times?.LinkedIn?.[weekday];
    if(!kind||settings.timing_mode!=="per_platform"||typeof hour!=="string")throw Error("That day is not a posting day in the current schedule");
    const post=new Date(input.planned_date+"T"+hour+":00+05:30"),review=new Date(post.getTime()-48*HOUR);
    if(post.getTime()<=now.getTime()+HOUR)throw Error("Choose a posting time at least one hour from now");
    const occupant=(await tx.query<any>("SELECT * FROM calendar_entries WHERE planned_date=$1 AND kind=$2 AND id<>$3 FOR UPDATE",[input.planned_date,kind,entry.id]))[0];
    if(occupant){
      const busy=occupant.task_id||occupant.source_id||(await tx.query("SELECT 1 FROM calendar_jobs WHERE entry_id=$1 UNION ALL SELECT 1 FROM github_source_grants WHERE entry_id=$1",[occupant.id])).length;
      if(busy)throw Error("That slot already has a post");
      await tx.query("DELETE FROM calendar_entries WHERE id=$1",[occupant.id]);
    }
    for(const row of outbox)if(["staged","approved","invalidated","missed"].includes(row.status))await tx.query("UPDATE publishing_outbox SET status='cancelled',reason='Moved to another posting slot; fresh approval required',updated=now() WHERE id=$1",[row.id]);
    const schedule={LinkedIn:{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()},platform_policy:NEW_PLATFORM_POLICY};
    await tx.query("UPDATE calendar_entries SET planned_date=$2,kind=$3,intended_post=$4,draft_due=$5,review_due=$5,platform_schedule=$6,updated=now() WHERE id=$1",[entry.id,input.planned_date,kind,post,review,JSON.stringify(schedule)]);
    await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_entry_moved',$3)",[randomUUID(),entry.task_id,actorText(actor)+" moved the post from "+new Date(entry.intended_post).toISOString()+" to "+post.toISOString()+"; unattempted delivery plans cancelled; fresh owner approval required"]);
    return {entry:entry.id,intended_post:post.toISOString(),kind};
  });
}
