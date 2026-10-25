import type {Connection} from "./db";
import {hash,type RuntimeConfig} from "./domain";
import {calendarGuard,scopedCalendarContext,validScopedCalendarRevision,type ScopedCalendarContext} from "./hosted-calendar-policy";
import {stableJson} from "./github-source-policy";
import {ownerDraftConfigHash} from "./owner-draft-policy";

export const OWNER_CALENDAR_STARTED="owner_calendar_started";
export const OWNER_CALENDAR_FINISHED="owner_calendar_finished";
export const OWNER_CALENDAR_MAX_CALLS=6,OWNER_CALENDAR_MAX_RESERVED=130_000,OWNER_CALENDAR_BUDGET_MS=240_000;
export type OwnerCalendarScope={run_id:string;task_id:string;binding:string;config_hash:string;deadline:string;checkpoint:number};
export type OwnerCalendarExecution={scope:OwnerCalendarScope;config:RuntimeConfig};

/** Same admission as the daily worker, with no source selection, clock edits or queue sweep. */
export async function ownerCalendarContext(tx:Connection,id:string,config:RuntimeConfig,completion=false){
  const guard=await calendarGuard(tx,id);if(!guard)return undefined;
  const context=await scopedCalendarContext(tx,id,config,guard,new Date(),true,true,completion);
  if(!context||!await validScopedCalendarRevision(tx,context))return undefined;
  return context;
}
/** Checkpoint/status/timestamps may advance; every consent and editorial binding may not. */
export function ownerCalendarBinding(context:ScopedCalendarContext,config:RuntimeConfig){
  const {task,root,source,proof,entry,job}=context;
  return hash(stableJson({version:1,mode:task.id===root.id?"initial":"revision",task_id:task.id,root_id:root.id,source_id:source.id,source_hash:source.hash,proof,origin:task.origin_key,brief:task.content_brief,parent_id:task.revision_parent_task_id||null,base_token:task.revision_base_token||null,feedback:task.revision_note||null,entry_id:entry.id,job_id:job.id,config_hash:ownerDraftConfigHash(config)}));
}
/** Takes Calendar -> child -> root -> source -> policy locks in the established order. */
export async function assertOwnerCalendarScope(tx:Connection,execution:OwnerCalendarExecution,completion=false){
  const {scope,config}=execution;
  const context=await ownerCalendarContext(tx,scope.task_id,config,completion);
  if(!context||context.task.checkpoint!==scope.checkpoint||ownerDraftConfigHash(config)!==scope.config_hash||ownerCalendarBinding(context,config)!==scope.binding||Date.now()>=Date.parse(scope.deadline))throw Error("Owner calendar execution stopped");
  const events=await tx.query<{id:string;detail:string}>("SELECT id,detail FROM events WHERE task_id=$1 AND kind=$2",[scope.task_id,OWNER_CALENDAR_STARTED]);
  if(events.length!==1||events[0].id!==scope.run_id||(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[scope.task_id,OWNER_CALENDAR_FINISHED])).length)throw Error("Owner calendar execution stopped");
  const recorded=JSON.parse(events[0].detail);
  for(const key of ["task_id","binding","config_hash","deadline"] as const)if(recorded[key]!==scope[key])throw Error("Owner calendar execution stopped");
  if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind='owner_draft_started'",[scope.task_id])).length)throw Error("Owner calendar execution stopped");
  return context;
}
