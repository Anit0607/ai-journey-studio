import {slotBrief} from './schedule-presets';
import type {Connection} from "./db";
import {hash,type RuntimeConfig,type Source,type Task,type Output} from "./domain";
import {activeGithubPolicy,resolveScopedSource,stableJson} from "./github-source-policy";
import {scopedSourceProof,scopedTaskMatches} from "./scoped-source-proof";
import {calendarPlatformPolicy,NEW_PLATFORM_POLICY} from "./platform-policy";
import {sourceAuthorized} from "./sources";
import {assertBundle,bundleVersion,type Artifact} from "./grounding";
import {assertArtifactPrivacy} from "./artifact-privacy";

export const HOSTED_CANDIDATE_LIMIT=16;
export const HOSTED_SCAN_EXHAUSTED="hosted_calendar_scan_exhausted";
export class HostedCalendarScanExhausted extends Error{constructor(){super(HOSTED_SCAN_EXHAUSTED);}}
export const SCOPED_REVISION_REQUEST="scoped_calendar_revision_requested_v1";
export type HostedCalendarPolicy={config:RuntimeConfig};
const iso=(value:unknown)=>{const n=value instanceof Date?value.getTime():typeof value==="string"?Date.parse(value):NaN;return Number.isFinite(n)?new Date(n).toISOString():null;};
export type CalendarGuard={rootId:string;entry:any;job:any};

/** Always precedes child/root/source/policy locks. A lookup alone grants nothing. */
export async function calendarGuard(tx:Connection,taskId:string):Promise<CalendarGuard|undefined>{
  await tx.query("SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE");
  const peek=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1",[taskId]))[0];
  if(!peek?.content_brief?.source_policy)return undefined;
  const rootId=peek.revision_parent_task_id||peek.id;
  const entries=await tx.query<any>("SELECT * FROM calendar_entries WHERE task_id=$1 ORDER BY id FOR UPDATE",[rootId]);
  if(entries.length!==1)return undefined;
  const jobs=await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entries[0].id]);
  if(jobs.length!==1)return undefined;
  return {rootId,entry:entries[0],job:jobs[0]};
}

/** Guard already held; locks child -> root -> source -> policy, then re-reads all bindings. */
export async function scopedCalendarContext(tx:Connection,taskId:string,config:RuntimeConfig,guard:CalendarGuard,now=new Date(),execution=true,lockTasks=true,completion=false){
  // Dispatch uses read-only task checks under its existing source locks; only
  // claim/admission/request paths take task locks, always before source locks.
  const taskSql="SELECT * FROM tasks WHERE id=$1"+(lockTasks?" FOR UPDATE":"");
  const task=(await tx.query<Task>(taskSql,[taskId]))[0];
  const root=taskId===guard.rootId?task:(await tx.query<Task>(taskSql,[guard.rootId]))[0];
  if(!task||!root||root.revision_parent_task_id||(task.id!==root.id&&task.revision_parent_task_id!==root.id))return undefined;
  const source=await resolveScopedSource(tx,(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[root.source_id]))[0],now);
  const proof=scopedSourceProof(source),policy=await activeGithubPolicy(tx,config,now),{entry,job}=guard;
  if(!source||!proof||!policy||policy.id!==proof.policy_id||policy.scope_hash!==proof.policy_hash||policy.runtime_binding!==proof.runtime_binding||!sourceAuthorized(config,source,"openai",now)||!scopedTaskMatches(source,root)||!scopedTaskMatches(source,task))return undefined;
  if(proof.task_id!==root.id||proof.entry_id!==entry.id||root.origin_key!=="calendar:"+entry.id||entry.task_id!==root.id||entry.source_id!==source.id||job.task_id!==root.id||job.entry_id!==entry.id||job.source_id!==source.id||job.source_hash!==source.hash||job.status!=="dispatched"||root.source_id!==source.id||root.source_hash!==source.hash||task.source_id!==source.id||task.source_hash!==source.hash)return undefined;
  let platform;try{platform=calendarPlatformPolicy(entry);}catch{return undefined;}
  const post=iso(entry.intended_post),review=iso(entry.review_due),generation=iso(entry.generation_due);
  if(!platform||!post||!review||!generation||iso(entry.draft_due)!==review||Date.parse(post)-Date.parse(review)!==48*3_600_000)return undefined;
  const expected={kind:entry.kind,planned_date:entry.planned_date,platforms:["LinkedIn"],platform_policy:NEW_PLATFORM_POLICY,intended_post:post,review_due:review,generation_due:generation,source_policy:{id:proof.policy_id,hash:proof.policy_hash,grant_id:proof.grant_id,provenance_id:proof.provenance_id}};
  // Briefs created before the evidence schedule have no audience/format; both shapes are exact.
  const briefs=[stableJson(expected),stableJson({...expected,...slotBrief(entry.planned_date)})];
  if(!briefs.includes(stableJson(root.content_brief))||!briefs.includes(stableJson(task.content_brief))||stableJson(entry.platform_schedule)!==stableJson({platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:post,draft_due:review,review_due:review}}))return undefined;
  if(execution){
    const settings=(await tx.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings WHERE id=1"))[0];
    const lead=Date.parse(post)-Date.parse(generation);
    if(!Number.isInteger(task.checkpoint)||task.checkpoint<0||task.checkpoint>(completion?6:5)||settings?.generation_enabled!==true||Date.parse(generation)>now.getTime()||Date.parse(review)<now.getTime()||Date.parse(post)<=now.getTime()||lead<120*3_600_000||lead>336*3_600_000)return undefined;
  }
  return {task,root,source,proof,entry,job};
}
export type ScopedCalendarContext=NonNullable<Awaited<ReturnType<typeof scopedCalendarContext>>>;
export function revisionReceipt(context:ScopedCalendarContext,child:Task){
  return {version:1,child_id:child.id,parent_id:context.root.id,root_id:context.root.id,base_token:child.revision_base_token,feedback_hash:hash(child.revision_note||""),source_id:context.source.id,source_hash:context.source.hash,grant_id:context.proof.grant_id,policy_id:context.proof.policy_id,policy_hash:context.proof.policy_hash,runtime_binding:context.proof.runtime_binding,entry_id:context.entry.id,job_id:context.job.id,brief_hash:hash(stableJson(context.root.content_brief))};
}
export async function validScopedCalendarRevision(tx:Connection,c:ScopedCalendarContext){
  const {task,root,source}=c;
  if(task.id===root.id)return !task.revision_base_token&&!task.revision_note;
  if(!["review","approved"].includes(root.status)||typeof task.revision_note!=="string"||!task.revision_note.trim()||task.revision_note!==task.revision_note.trim()||task.origin_key!=="revision:"+hash(root.id+"|"+task.revision_base_token))return false;
  const receipts=await tx.query<{detail:string}>("SELECT detail FROM events WHERE task_id=$1 AND kind=$2",[task.id,SCOPED_REVISION_REQUEST]);
  if(receipts.length!==1)return false;
  try{if(stableJson(JSON.parse(receipts[0].detail))!==stableJson(revisionReceipt(c,task)))return false;}catch{return false;}
  const latest=(await tx.query<any>("SELECT * FROM content_revisions WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1",[root.id]))[0];
  const bundle:Artifact[]=latest?.bundle||await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[root.id]);
  try{assertBundle(bundle);for(const item of bundle)assertArtifactPrivacy(item.text);if(latest&&bundleVersion(bundle,source.hash)!==latest.version)return false;}catch{return false;}
  const token=latest?"revision:"+latest.id+":"+latest.version:"original:"+hash(bundle.map(item=>item.hash).join("|"));
  return token===task.revision_base_token;
}
/** No status/event write is permitted before this complete locked validation. */
export async function admittedHostedTask(tx:Connection,id:string,config:RuntimeConfig,now=new Date()){
  const guard=await calendarGuard(tx,id);if(!guard)return undefined;
  const c=await scopedCalendarContext(tx,id,config,guard,now);
  if(!c||!await validScopedCalendarRevision(tx,c)||(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind IN ('owner_draft_started','owner_calendar_started')",[id])).length)return undefined;
  return c.task;
}

/** Candidate SQL excludes arbitrary manual/legacy work before recovery or row claiming. */
export async function hostedCandidates(tx:Connection){
  return tx.query<{id:string}>(`SELECT t.id FROM tasks t
    JOIN tasks root ON root.id=COALESCE(t.revision_parent_task_id,t.id)
    JOIN github_source_grants g ON g.task_id=root.id AND g.source_id=t.source_id AND g.source_hash=t.source_hash
    JOIN github_source_policies p ON p.id=g.policy_id AND p.active=true AND p.revoked_at IS NULL
    JOIN calendar_entries e ON e.id=g.entry_id AND e.task_id=root.id AND e.source_id=g.source_id
    JOIN calendar_jobs j ON j.entry_id=e.id AND j.task_id=root.id AND j.source_id=g.source_id AND j.source_hash=g.source_hash
    WHERE root.revision_parent_task_id IS NULL AND root.origin_key='calendar:'||e.id::text
      AND (t.status='queued' OR (t.status='running' AND t.lease_until<now()))
      AND t.checkpoint BETWEEN 0 AND 5
      AND e.generation_due<=now() AND e.review_due>=now() AND e.intended_post>now()
      AND NOT EXISTS (SELECT 1 FROM events WHERE task_id=t.id AND kind IN ('owner_draft_started','owner_calendar_started'))
    ORDER BY t.updated,t.id LIMIT ${HOSTED_CANDIDATE_LIMIT+1}`);
}
