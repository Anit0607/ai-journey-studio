import {randomUUID} from "node:crypto";
import type {Database} from "./db";
import {CAPSULE,configReady,hash,type RuntimeConfig} from "./domain";
const DAY=86400000;
function validDate(value:unknown):value is string{return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export class Calendar{
  constructor(readonly db:Database){}
  async settings(){return (await this.db.query<any>("SELECT * FROM calendar_settings WHERE id=1"))[0];}
  async configure(input:{start_date:string|null;post_time:string|null;short_days:number[];long_day:number;generation_lead_hours:number|null}){
    if((input.start_date!==null&&!validDate(input.start_date))||(input.post_time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.post_time)))throw Error("Invalid calendar date or time");
    if(!Array.isArray(input.short_days)||input.short_days.length<1||input.short_days.length>6||input.short_days.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(input.short_days).size!==input.short_days.length||!Number.isInteger(input.long_day)||input.long_day<0||input.long_day>6||input.short_days.includes(input.long_day))throw Error("Invalid cadence");
    if(input.generation_lead_hours!==null&&(!Number.isInteger(input.generation_lead_hours)||input.generation_lead_hours<48||input.generation_lead_hours>336))throw Error("Generation lead must be 48 to 336 hours or unset");
    await this.db.transaction(async tx=>{
      await tx.query("UPDATE calendar_settings SET short_days=$1,long_day=$2,start_date=$3,post_time=$4,generation_lead_hours=$5,updated=now() WHERE id=1",[JSON.stringify(input.short_days),input.long_day,input.start_date,input.post_time,input.generation_lead_hours]);
      await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_configured','User saved IST cadence and timing; paid generation remains disabled')",[randomUUID()]);
    });
  }
  async plan(weeks:number){
    if(!Number.isInteger(weeks)||weeks<1||weeks>4)throw Error("Choose one to four weeks");
    return this.db.transaction(async tx=>{
      const s=(await tx.query<any>("SELECT * FROM calendar_settings WHERE id=1 FOR UPDATE"))[0];
      if(!s.start_date||!s.post_time)throw Error("Choose start date and posting time first");
      for(let offset=0;offset<weeks*7;offset++){
        const date=new Date(Date.parse(s.start_date)+offset*DAY),weekday=date.getUTCDay(),kind=weekday===s.long_day?"longform":s.short_days.includes(weekday)?"shortform":null;
        if(!kind)continue;
        const planned=date.toISOString().slice(0,10),post=new Date(planned+"T"+s.post_time+":00+05:30"),review=new Date(post.getTime()-48*3600000),generation=s.generation_lead_hours===null?null:new Date(post.getTime()-s.generation_lead_hours*3600000);
        await tx.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due) VALUES($1,$2,$3,$4,$5,$5,$6) ON CONFLICT(planned_date,kind) DO UPDATE SET intended_post=EXCLUDED.intended_post,draft_due=EXCLUDED.draft_due,review_due=EXCLUDED.review_due,generation_due=EXCLUDED.generation_due,updated=now()",[randomUUID(),planned,kind,post,review,generation]);
      }
      await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_planned','User created/updated planned dates; sources require explicit links; no paid generation')",[randomUUID()]);
    });
  }
  async link(entry:string,source:string|null,task:string|null){
    await this.db.transaction(async tx=>{
      if(!(await tx.query("SELECT id FROM calendar_entries WHERE id=$1 FOR UPDATE",[entry])).length)throw Error("Unknown calendar entry");
      if(source&&!(await tx.query("SELECT id FROM sources WHERE id=$1 AND cleared=true",[source])).length)throw Error("Source not cleared");
      if(task&&(!source||!(await tx.query("SELECT id FROM tasks WHERE id=$1 AND source_id=$2",[task,source])).length))throw Error("Task must match the linked source");
      await tx.query("UPDATE calendar_entries SET source_id=$2,task_id=$3,updated=now() WHERE id=$1",[entry,source,task]);
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_linked','User linked calendar evidence/task; no model call')",[randomUUID(),task]);
    });
  }
  async prepareDue(now=new Date()){
    // Preparing an intent never inserts a queued content task. A live worker
    // cannot consume these blocked jobs. Future activation requires new approval.
    return this.db.transaction(async tx=>{
      const due=await tx.query<{id:string}>("SELECT id FROM calendar_entries WHERE generation_due IS NOT NULL AND generation_due<=$1 FOR UPDATE",[now]);let inserted=0;
      for(const entry of due)inserted+=(await tx.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked') ON CONFLICT(entry_id) DO NOTHING RETURNING id",[randomUUID(),entry.id])).length;
      if(inserted)await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_due_prepared','Due intents stored idempotently; paid execution remains disabled')",[randomUUID()]);
      return {inserted,paid_execution:false};
    });
  }
  async snapshot(state:any,c:RuntimeConfig,runtimeEnabled:boolean,now=new Date()){
    const settings=await this.settings(),jobs=await this.db.query<any>("SELECT * FROM calendar_jobs ORDER BY created,id"),entries=await this.db.query<any>("SELECT * FROM calendar_entries ORDER BY intended_post,id");
    return {settings,paid_activation:false,scheduler:"Laptop-only; no background or hosted calendar scheduler configured",configuration_needed:!settings.start_date||!settings.post_time,entries:entries.map(entry=>{
      const source=state.sources.find((item:any)=>item.id===entry.source_id),task=state.tasks.find((item:any)=>item.id===entry.task_id),review=state.reviews.find((item:any)=>item.task_id===entry.task_id),blockers:string[]=[];
      if(!source)blockers.push("Link a cleared source; no evidence is auto-selected");
      else if(!source.cleared||source.text!==CAPSULE||source.hash!==hash(CAPSULE))blockers.push("Source requires clearance and provider transmission consent");
      if(source?.text===CAPSULE)blockers.push("Source lacks concrete events and emotional context; do not invent personal lessons or feelings");
      if(!entry.generation_due)blockers.push("Generation timing is unset");
      if(!c.source_approved||!c.transmission_authorized||c.approved_source_hash!==hash(CAPSULE))blockers.push("Provider/source consent is missing or does not match");
      if(!configReady(c))blockers.push("Current pricing/security configuration is required before paid work");
      if(!runtimeEnabled)blockers.push("Provider runtime is not active");
      if(state.pricing_blocked||state.budget.unresolved_reservations)blockers.push("Unresolved provider accounting needs reconciliation");
      if(state.budget.committed_microdollars>=state.budget.cap_microdollars-state.budget.buffer_microdollars)blockers.push("Monthly budget has no safe remaining capacity");
      if(review?.quality.flags.length)blockers.push("Linked content has source-grounding flags");
      blockers.push("Recurring paid calendar generation is not activated");
      const due=!!entry.generation_due&&new Date(entry.generation_due)<=now;
      const content=review?.bundle.find((item:any)=>item.role==="Platform Adapter");
      const variants=["LinkedIn","X","Instagram"].map(platform=>({platform,status:content?(content.text.includes(platform)?review?.approval?"user_approved_quality_separate":"review_needed":"not_separately_identified"):"not_generated",artifact_hash:content?.hash||null}));
      return {...entry,job:jobs.find(job=>job.entry_id===entry.id)||null,status:review?.quality.flags.length?"changes_needed":review?.approval?"user_approved_quality_separate":task?.status==="review"?"review_needed":task?task.status:due?"due_blocked":"planned_blocked",blocked_reasons:blockers,variants,linked_task_status:task?.status||null,linked_content_version:review?.token||null};
    })};
  }
}
