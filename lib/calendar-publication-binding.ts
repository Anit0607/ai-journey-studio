import type {Connection} from "./db";
import {hash} from "./domain";

export const APPROVAL_PLAN_EVENT="calendar_publication_approved";
/** Acquire both singletons before outbox/task/source/policy/connection locks.
 * Calendar writers take settings UPDATE; guarded OAuth writers take OAuth UPDATE.
 * Retain through durable admission, then release before provider I/O. */
export async function lockPublicationGuards(tx:Connection,exclusiveCalendar=false){
  const settings=await tx.query(exclusiveCalendar?"SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE":"SELECT id FROM calendar_settings WHERE id=1 FOR SHARE");
  if(settings.length!==1)throw Error("Calendar settings unavailable");
  const oauth=await tx.query("SELECT id FROM integration_oauth_guard WHERE id=1 FOR SHARE");
  if(oauth.length!==1)throw Error("OAuth guard unavailable");
}
export function calendarPublicationBinding(entry:any){
  return hash(JSON.stringify({id:entry.id,task_id:entry.task_id,source_id:entry.source_id,intended_post:new Date(entry.intended_post).toISOString(),platform_schedule:entry.platform_schedule}));
}
/** Caller holds lockPublicationGuards (or the stronger preview/update guard)
 * through its approval/admission commit, so mutations cannot race this read. */
export async function calendarPublicationCurrent(tx:Connection,row:{id:string;task_id:string}){
  const events=await tx.query<{detail:string}>("SELECT detail FROM events WHERE task_id=$1 AND kind=$2",[row.task_id,APPROVAL_PLAN_EVENT]);
  for(const event of events){
    const binding=JSON.parse(event.detail);
    if(binding.outbox_id!==row.id)continue;
    const entry=(await tx.query("SELECT * FROM calendar_entries WHERE id=$1",[binding.entry_id]))[0];
    if(!entry||calendarPublicationBinding(entry)!==binding.calendar_binding)return false;
  }
  return true;
}
