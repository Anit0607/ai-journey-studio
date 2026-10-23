import type {Connection} from "./db";
import {hash,type RuntimeConfig,type Source,type Task} from "./domain";
import {ownerSourceEligible} from "./sources";

export const OWNER_DRAFT_MAX_RESERVED=130_000;
export const OWNER_DRAFT_MAX_CALLS=6;
export const OWNER_DRAFT_BUDGET_MS=240_000;
export const OWNER_DRAFT_STARTED="owner_draft_started";
export const OWNER_DRAFT_FINISHED="owner_draft_finished";
export type OwnerDraftScope={run_id:string;task_id:string;source_id:string;source_hash:string;clearance_id:string;config_hash:string;deadline:string;checkpoint:number};
export const ownerDraftConfigHash=(config:RuntimeConfig)=>hash(JSON.stringify(config));

/** Rechecked while the task row is locked; never authorizes a shared-queue claim. */
export async function assertOwnerDraftScope(tx:Connection,task:Task,scope:OwnerDraftScope){
  if(task.id!==scope.task_id||task.source_id!==scope.source_id||task.source_hash!==scope.source_hash||task.checkpoint!==scope.checkpoint||task.origin_key!=="manual"||task.revision_parent_task_id||Date.now()>=Date.parse(scope.deadline))throw Error("Owner draft execution stopped");
  const event=(await tx.query<{detail:string}>("SELECT detail FROM events WHERE id=$1 AND task_id=$2 AND kind=$3",[scope.run_id,task.id,OWNER_DRAFT_STARTED]))[0];
  if(!event||(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[task.id,OWNER_DRAFT_FINISHED])).length)throw Error("Owner draft execution stopped");
  const recorded=JSON.parse(event.detail);
  for(const key of ["task_id","source_id","source_hash","clearance_id","config_hash","deadline"] as const)if(recorded[key]!==scope[key])throw Error("Owner draft execution stopped");
  const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[scope.source_id]))[0];
  if(!ownerSourceEligible(source,scope.source_hash)||source.clearance_id!==scope.clearance_id)throw Error("Source invalidated");
  if((await tx.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings WHERE id=1"))[0]?.generation_enabled!==true)throw Error("Owner draft execution stopped");
  if((await tx.query("SELECT id FROM calendar_entries WHERE task_id=$1 LIMIT 1",[task.id])).length)throw Error("Owner draft execution stopped");
}
