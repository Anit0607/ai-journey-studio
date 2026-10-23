import {randomUUID} from "node:crypto";
import type {Database} from "./db";
import {hash,type Source,type Task} from "./domain";
import {assertSourcePrivacy,ownerSourceEligible} from "./sources";
import {NEW_PLATFORM_POLICY,NEW_PLATFORMS} from "./platform-policy";

const HOUR=3_600_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class CalendarRecoveryError extends Error{}
export function safeCalendarRecoveryError(error:unknown){return error instanceof CalendarRecoveryError?error.message:null;}
type RecoveryTask=Task&{block_reason?:string|null};
type RecoveryInput={entry:string;expected:string;planned_date:string;post_time:string;generation_lead_hours:number;reason:string;acknowledged:boolean};
type Usage={task_id:string;status:string};
const timestamp=(value:unknown)=>value?new Date(value as string).toISOString():null;
function expired(task:RecoveryTask|undefined,now:Date){return typeof task?.content_brief?.review_due==="string"&&Number.isFinite(Date.parse(task.content_brief.review_due))&&Date.parse(task.content_brief.review_due)<now.getTime();}
function version(entry:any,job:any,task:RecoveryTask,source:Source|undefined){
  return hash(JSON.stringify({schema:1,entry:{id:entry.id,planned_date:entry.planned_date,kind:entry.kind,source_id:entry.source_id,task_id:entry.task_id,intended_post:timestamp(entry.intended_post),draft_due:timestamp(entry.draft_due),review_due:timestamp(entry.review_due),generation_due:timestamp(entry.generation_due),platform_schedule:entry.platform_schedule,updated:timestamp(entry.updated)},job:job?{id:job.id,status:job.status,task_id:job.task_id,source_id:job.source_id,source_hash:job.source_hash,updated:timestamp(job.updated)}:null,task:{id:task.id,source_id:task.source_id,source_hash:task.source_hash,origin_key:task.origin_key,status:task.status,checkpoint:task.checkpoint,lease_token:task.lease_token,lease_until:timestamp(task.lease_until),block_reason:task.block_reason||null,content_brief:task.content_brief,updated:timestamp(task.updated)},source:source?{id:source.id,hash:source.hash,cleared:source.cleared,clearance_id:source.clearance_id,cleared_at:timestamp(source.cleared_at),revoked_at:timestamp(source.revoked_at)}:null}));
}
function blocker(entry:any,job:any,task:RecoveryTask|undefined,source:Source|undefined,usage:Usage[],now:Date){
  if(!task||!job||job.status!=="dispatched"||entry.task_id!==task.id||job.task_id!==task.id||task.origin_key!=="calendar:"+entry.id||task.revision_parent_task_id)return "Only the exact dispatched calendar draft can be replanned";
  if(entry.source_id!==task.source_id||job.source_id!==task.source_id||job.source_hash!==task.source_hash||source?.id!==task.source_id||source.hash!==task.source_hash)return "Calendar draft source linkage changed; recovery is blocked";
  if(!["queued","blocked"].includes(task.status)||task.checkpoint<0||task.checkpoint>=6)return "Only an unfinished queued or blocked draft can be replanned; cancelled and completed tasks stay unchanged";
  if(task.lease_token||task.lease_until)return "A task lease is present; wait for execution or reconciliation before replanning";
  if(usage.some(row=>row.task_id===task.id&&["reserved","unknown"].includes(row.status)))return "Unresolved provider usage must be reconciled before replanning";
  if(task.block_reason)return "This draft has a safety or completion block; resolve it before replanning";
  if(!expired(task,now))return "The linked draft review deadline has not passed";
  if(!ownerSourceEligible(source,task.source_hash,"openai",now))return "The exact source must retain owner clearance for OpenAI before replanning";
  return null;
}
/** Snapshot data is advisory; the write recomputes the same binding under locks. */
export function calendarRecoverySnapshot(entry:any,job:any,task:RecoveryTask|undefined,source:Source|undefined,usage:Usage[],now=new Date()){
  if(!task?.origin_key?.startsWith("calendar:")||!expired(task,now))return null;
  const reason=blocker(entry,job,task,source,usage,now);
  return {eligible:!reason,reason,expected:version(entry,job,task,source),task_review_due:task.content_brief!.review_due};
}
/** Owner-triggered only. No task insert, provider invocation, approval or scheduler change. */
export async function recoverOverdueCalendarDraft(db:Database,input:RecoveryInput,minimumLeadHours=49,clock:()=>Date=()=>new Date()){
  if(!input||typeof input.entry!=="string"||!UUID.test(input.entry)||typeof input.expected!=="string"||!/^[a-f0-9]{64}$/.test(input.expected))throw new CalendarRecoveryError("Exact calendar recovery version required; refresh the calendar");
  if(input.acknowledged!==true)throw new CalendarRecoveryError("Acknowledge cancellation and a separate fresh draft plan");
  if(typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.reason))throw new CalendarRecoveryError("A short recovery reason is required (maximum 1000 characters)");
  assertSourcePrivacy(input.reason);
  if(typeof input.planned_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.planned_date)||!Number.isFinite(Date.parse(input.planned_date))||new Date(input.planned_date).toISOString().slice(0,10)!==input.planned_date||typeof input.post_time!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.post_time))throw new CalendarRecoveryError("Choose a valid new posting date and time in IST");
  if(!Number.isInteger(input.generation_lead_hours)||input.generation_lead_hours<minimumLeadHours||input.generation_lead_hours>336)throw new CalendarRecoveryError("Recovery generation lead must be "+minimumLeadHours+" to 336 hours");
  const post=new Date(input.planned_date+"T"+input.post_time+":00+05:30"),review=new Date(post.getTime()-48*HOUR),generation=new Date(post.getTime()-input.generation_lead_hours*HOUR);
  const assertFuture=(now:Date)=>{if(!(now instanceof Date)||!Number.isFinite(now.getTime())||generation<=now||review<=now)throw new CalendarRecoveryError("Choose a later posting time so generation and the 48-hour review deadline are both in the future");};
  assertFuture(clock());
  return db.transaction(async tx=>{
    // Serialize all calendar dispatch/plan/recovery operations. Worker operations
    // lock the task before source/ledger, so the eligibility decision cannot race
    // a new claim/reservation or completion. Nothing clears an uncertain lease.
    await tx.query("SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE");
    const entry=(await tx.query<any>("SELECT * FROM calendar_entries WHERE id=$1 FOR UPDATE",[input.entry]))[0];
    if(!entry)throw new CalendarRecoveryError("Unknown calendar entry");
    const job=(await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entry.id]))[0];
    const task=entry.task_id?(await tx.query<RecoveryTask>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[entry.task_id]))[0]:undefined;
    const source=task?(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[task.source_id]))[0]:undefined;
    const usage=task?await tx.query<Usage>("SELECT * FROM ledger WHERE task_id=$1 FOR UPDATE",[task.id]):[];
    if(!task||input.expected!==version(entry,job,task,source))throw new CalendarRecoveryError("Calendar recovery is stale; refresh and review the current draft");
    const reason=blocker(entry,job,task,source,usage,clock());if(reason)throw new CalendarRecoveryError(reason);
    if((await tx.query("SELECT id FROM calendar_entries WHERE task_id=$1 AND id!=$2",[task.id,entry.id])).length||(await tx.query("SELECT id FROM calendar_jobs WHERE task_id=$1 AND entry_id!=$2",[task.id,entry.id])).length)throw new CalendarRecoveryError("This task is linked to another calendar entry; review its links first");
    if((await tx.query("SELECT id FROM tasks WHERE revision_parent_task_id=$1",[task.id])).length||(await tx.query("SELECT task_id FROM approvals WHERE task_id=$1",[task.id])).length||(await tx.query("SELECT id FROM content_revisions WHERE task_id=$1",[task.id])).length||(await tx.query("SELECT id FROM publishing_outbox WHERE task_id=$1",[task.id])).length)throw new CalendarRecoveryError("This draft has review, revision or publication history; use its existing review workflow");
    const id=randomUUID(),schedule=Object.fromEntries(NEW_PLATFORMS.map(platform=>[platform,{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}]));
    // Lock waits and validation queries can cross the chosen generation time.
    // Re-read the clock at the write boundary, never the request-start time.
    assertFuture(clock());
    const created=await tx.query<any>("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule,source_id) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8) ON CONFLICT(planned_date,kind) DO NOTHING RETURNING *",[id,input.planned_date,entry.kind,post,review,generation,JSON.stringify({...schedule,platform_policy:NEW_PLATFORM_POLICY}),task.source_id]);
    if(!created.length)throw new CalendarRecoveryError("A calendar entry already exists for that date and format; choose an unused date");
    await tx.query("UPDATE tasks SET status='cancelled',updated=now() WHERE id=$1",[task.id]);
    await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_draft_replanned',$3)",[randomUUID(),task.id,JSON.stringify({old_entry:entry.id,old_task:task.id,old_version:input.expected,new_entry:id,source_id:task.source_id,source_hash:task.source_hash,reason:input.reason.trim(),intended_post:post.toISOString(),generation_due:generation.toISOString(),review_due:review.toISOString(),note:"Owner cancelled an expired dormant task. Original brief, artifacts, usage and links retained. New plan has no task; future dispatch and fresh approval remain separate."})]);
    return {entry:created[0],cancelled_task:task.id,queued:false,paid_execution:false};
  });
}
