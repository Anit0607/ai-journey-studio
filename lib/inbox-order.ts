/** Approval inbox order: drafts linked to an upcoming, not-yet-published slot come first,
 * soonest slot first; everything else (past slots, published, unlinked) is folded below. */
type TaskLike={id:string;status:string;updated:string};
type EntryLike={task_id?:string|null;intended_post:string};
type JobLike={task_id:string;status:string};
export function inboxGroups<T extends TaskLike>(tasks:T[],entries:EntryLike[]|undefined,jobs:JobLike[]|undefined,now=new Date()){
  const slot=new Map<string,string>();
  for(const entry of entries||[])if(entry.task_id)slot.set(entry.task_id,entry.intended_post);
  const published=new Set((jobs||[]).filter(job=>job.status==="published").map(job=>job.task_id));
  const upcoming=(task:T)=>{const at=slot.get(task.id);return !!at&&Date.parse(at)>now.getTime()&&!published.has(task.id)&&!["cancelled","published"].includes(task.status);};
  const next=tasks.filter(upcoming).sort((a,b)=>Date.parse(slot.get(a.id)!)-Date.parse(slot.get(b.id)!));
  const other=tasks.filter(task=>!upcoming(task)).sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated));
  return {next,other,slot:(task:T)=>slot.get(task.id)||null};
}
export const slotLabel=(value:string)=>new Date(value).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false})+" IST";
