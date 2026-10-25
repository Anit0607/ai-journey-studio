import {scopedCalendarContext} from "./hosted-calendar-policy";
import {githubSelectionPool} from "./github-source-selection";
import {githubEvidenceEligibility,githubProvenanceHash,resolveScopedSource} from "./github-source-policy";
import {NEW_PLATFORM_POLICY,NEW_PLATFORMS,activePlatforms,calendarPlatformPolicy,taskPlatformPolicy} from "./platform-policy";
import {calendarRecoverySnapshot} from "./calendar-recovery";
import {generationTimePreview,generationRowSQL,identifiableGenerationHistory} from './calendar-generation-time';
import {platformVariants} from "./platform-variants";
import {randomUUID} from "node:crypto";
import type {Database} from "./db";
import {CAPSULE,CAP,BUFFER,configReady,istMonth,tokenCost,type RuntimeConfig,type Source,type Task} from "./domain";
import {sourceEligible,draftSourceEligible,sourceAuthorized} from "./sources";
const DAY=86400000;
export const LEGACY_CALENDAR_BLOCKER="This unbound legacy calendar slot cannot create new three-platform work. Create a fresh LinkedIn-only plan on an unused date and explicitly link a cleared source; this historical slot is unchanged.";
import {PLATFORMS,BENCHMARK_PRESET} from "./schedule-presets";
export type PlatformTimes=Partial<Record<typeof PLATFORMS[number],Record<string,string|null>>>;
const validTime=(value:unknown)=>typeof value==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function validateTimes(value:unknown):value is PlatformTimes{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  return Object.entries(value).every(([platform,days])=>PLATFORMS.includes(platform as typeof PLATFORMS[number])&&days&&typeof days==="object"&&!Array.isArray(days)&&Object.entries(days).every(([day,time])=>/^[0-6]$/.test(day)&&(time===null||validTime(time))));
}
function timingMissing(settings:any){
  if(settings.timing_mode!=="per_platform")return !settings.post_time;
  return [...settings.short_days,settings.long_day].some(day=>NEW_PLATFORMS.some(platform=>!validTime(settings.platform_times[platform]?.[day])));
}
function validCadence(days:unknown,longDay:unknown):days is number[]{return Array.isArray(days)&&days.length>=1&&days.length<=6&&days.every(day=>Number.isInteger(day)&&day>=0&&day<=6)&&new Set(days).size===days.length&&Number.isInteger(longDay)&&Number(longDay)>=0&&Number(longDay)<=6&&!days.includes(longDay);}
function validDate(value:unknown):value is string{return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
type BudgetState={used:number;unresolved:number;pricingBlocked:boolean};
type DispatchEntry={entry_id:string;task_id:string|null;status:string;reason?:string};
// A due task must fit at least one maximum-size ordinary checkpoint. The worker
// reserves again immediately before every provider call under its budget lock.
const CHECKPOINT_MAX_INPUT_BYTES=48_000;
function dispatchBlockers(settings:any,entry:any,source:Source|undefined,c:RuntimeConfig,runtimeEnabled:boolean,budget:BudgetState,now:Date,minimumLeadHours=49,scopedSelection=false){
  const reasons:string[]=[];
  if(!entry.task_id&&!calendarPlatformPolicy(entry))reasons.push(LEGACY_CALENDAR_BLOCKER);
  if(settings.generation_enabled!==true)reasons.push("Recurring paid calendar generation is not activated");
  if(c.owner_cleared_sources_authorized!==true)reasons.push("Standing consent for owner-cleared OpenAI sources is missing");
  if(!source)reasons.push("No source is available for this entry. Link a cleared source, or use an active bounded GitHub policy with eligible unused evidence");
  else if(!scopedSelection&&(!draftSourceEligible(source,undefined,"openai",now)||!sourceAuthorized(c,source,"openai",now)))reasons.push("Source requires explicit owner clearance and provider transmission consent");
  if(!entry.generation_due)reasons.push("Generation timing is unset");
  else if(settings.generation_lead_hours===48||Math.min(new Date(entry.draft_due).getTime(),new Date(entry.review_due).getTime())-new Date(entry.generation_due).getTime()<3_600_000)reasons.push("Generation timing needs at least a one-hour cushion before draft/review; choose a lead of 49 hours or more and explicitly replan");
  if(minimumLeadHours>49&&(!entry.generation_due||new Date(entry.intended_post).getTime()-new Date(entry.generation_due).getTime()<minimumLeadHours*3_600_000))reasons.push("Hosted daily generation requires a lead of at least "+minimumLeadHours+" hours; explicitly replan without changing the 48-hour review deadline");
  if(new Date(entry.intended_post)<=now)reasons.push("Scheduled posting time has passed; reschedule before generating");
  else if(new Date(entry.draft_due)<now||new Date(entry.review_due)<now)reasons.push("Draft/review deadline has passed; reschedule to preserve the 48-hour review window");
  if(!configReady(c,now))reasons.push("Current pricing/security configuration is required before paid work");
  if(c.fallback_authorized)reasons.push("Scheduled generation permits OpenAI only; Gemini fallback must remain disabled");
  if(!runtimeEnabled)reasons.push("Provider runtime is not active");
  if(budget.pricingBlocked||budget.unresolved)reasons.push("Unresolved provider accounting needs reconciliation");
  let upper=0;
  try{if(c.openai)upper=tokenCost(c.openai,CHECKPOINT_MAX_INPUT_BYTES+256,1200);}catch{/* Configuration blocker above explains invalid pricing. */}
  if(!Number.isSafeInteger(budget.used)||budget.used<0||budget.used>=CAP-BUFFER||budget.used+upper>CAP-BUFFER)reasons.push("Monthly budget has no safe remaining capacity for the next checkpoint");
  return reasons;
}
function linkedBlocker(task:Task|undefined,entry:any,job:any,source:Source|undefined){
  if(!task||task.id!==entry.task_id||(job.task_id&&job.task_id!==task.id))return "Scheduled task linkage changed; manual review required";
  if(task.source_id!==entry.source_id||task.source_hash!==source?.hash||(job.source_id&&job.source_id!==task.source_id)||(job.source_hash&&job.source_hash!==task.source_hash))return "Linked task does not match the exact scheduled source version";
  if(JSON.stringify(taskPlatformPolicy(task))!==JSON.stringify(calendarPlatformPolicy(entry)))return "Task and calendar platform policies must match";
  if(task.status==="cancelled")return "Linked task was cancelled; automatic replacement and replay are disabled";
  if(task.status==="blocked")return "Linked task is blocked; explicit reconciliation or retry is required";
  return null;
}
export class Calendar{
  constructor(readonly db:Database,readonly minimumGenerationLeadHours=49){}
  async settings(){return (await this.db.query<any>("SELECT * FROM calendar_settings WHERE id=1"))[0];}
  async configure(input:{start_date:string|null;post_time:string|null;short_days:number[];long_day:number;generation_lead_hours:number|null;timing_mode?:"shared"|"per_platform";platform_times?:PlatformTimes;timing_basis?:string|null;generation_enabled?:boolean}){
    if((input.start_date!==null&&!validDate(input.start_date))||(input.post_time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.post_time)))throw Error("Invalid calendar date or time");
    if(!validCadence(input.short_days,input.long_day))throw Error("Invalid cadence");
    if(input.generation_lead_hours!==null&&(!Number.isInteger(input.generation_lead_hours)||input.generation_lead_hours<this.minimumGenerationLeadHours||input.generation_lead_hours>336))throw Error("Generation lead must be "+this.minimumGenerationLeadHours+" to 336 hours or unset");
    if(input.timing_mode!==undefined&&!["shared","per_platform"].includes(input.timing_mode))throw Error("Invalid platform timing");
    if(input.platform_times!==undefined&&!validateTimes(input.platform_times))throw Error("Invalid platform timing");
    if(input.timing_basis!==undefined&&input.timing_basis!==null&&!["custom",BENCHMARK_PRESET.id].includes(input.timing_basis))throw Error("Invalid platform timing");
    if(input.timing_basis===BENCHMARK_PRESET.id&&(!input.platform_times||NEW_PLATFORMS.some(platform=>Object.keys(input.platform_times![platform]||{}).length!==4||Object.entries(BENCHMARK_PRESET.times[platform]).some(([day,hour])=>input.platform_times![platform]?.[day]!==hour))))throw Error("Preset provenance does not match selected hours");
    if(input.generation_enabled!==undefined&&typeof input.generation_enabled!=="boolean")throw Error("Invalid generation activation");
    await this.db.transaction(async tx=>{
      await tx.query("UPDATE calendar_settings SET short_days=$1,long_day=$2,start_date=$3,post_time=$4,generation_lead_hours=$5,updated=now() WHERE id=1",[JSON.stringify(input.short_days),input.long_day,input.start_date,input.post_time,input.generation_lead_hours]);
      if(input.timing_mode!==undefined)await tx.query("UPDATE calendar_settings SET timing_mode=$1 WHERE id=1",[input.timing_mode]);
      if(input.platform_times!==undefined)await tx.query("UPDATE calendar_settings SET platform_times=$1 WHERE id=1",[JSON.stringify(input.platform_times)]);
      if(input.platform_times!==undefined||input.timing_basis!==undefined)await tx.query("UPDATE calendar_settings SET timing_basis=$1 WHERE id=1",[input.timing_basis||"custom"]);
      if(input.generation_enabled!==undefined)await tx.query("UPDATE calendar_settings SET generation_enabled=$1 WHERE id=1",[input.generation_enabled]);
      await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_configured',$2)",[randomUUID(),input.generation_enabled===undefined?"Owner saved IST cadence and timing; generation activation unchanged":input.generation_enabled?"Owner enabled due generation; source authorization, runtime and budget gates still apply":"Owner disabled future calendar dispatch; existing tasks retain their state"]);
    });
  }
  async plan(weeks:number){
    if(!Number.isInteger(weeks)||weeks<1||weeks>4)throw Error("Choose one to four weeks");
    return this.db.transaction(async tx=>{
      const s=(await tx.query<any>("SELECT * FROM calendar_settings WHERE id=1 FOR UPDATE"))[0];
      if(!s.start_date)throw Error("Choose start date and posting time first");
      if(timingMissing(s))throw Error(s.timing_mode==="per_platform"?"Choose every platform/day posting time first":"Choose start date and posting time first");
      for(let offset=0;offset<weeks*7;offset++){
        const date=new Date(Date.parse(s.start_date)+offset*DAY),weekday=date.getUTCDay(),kind=weekday===s.long_day?"longform":s.short_days.includes(weekday)?"shortform":null;
        if(!kind)continue;
        const planned=date.toISOString().slice(0,10),schedule=Object.fromEntries(NEW_PLATFORMS.map(platform=>{
          const hour=s.timing_mode==="per_platform"?s.platform_times[platform][weekday]:s.post_time;
          const post=new Date(planned+"T"+hour+":00+05:30"),review=new Date(post.getTime()-48*3600000);
          return [platform,{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}];
        }));
        // The content family must be review-ready for its earliest platform.
        const post=new Date(Math.min(...Object.values(schedule).map(item=>Date.parse(item.intended_post)))),review=new Date(post.getTime()-48*3600000),generation=s.generation_lead_hours===null?null:new Date(post.getTime()-s.generation_lead_hours*3600000);
        await tx.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule) VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT(planned_date,kind) DO NOTHING",[randomUUID(),planned,kind,post,review,generation,JSON.stringify({...schedule,platform_policy:NEW_PLATFORM_POLICY})]);
      }
      await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_planned','User requested LinkedIn-only planned dates; existing entries unchanged; no source selected and no paid generation')",[randomUUID()]);
    });
  }
  /** Extend only future generation opportunities; never replan existing dates or bind content. */
  async refillHorizon(now=new Date()){
    if(!Number.isFinite(now.getTime()))throw Error("Invalid refill time");
    return this.db.transaction(async tx=>{
      // Standalone settings-first transaction; callers must not hold a budget guard.
      const s=(await tx.query<any>("SELECT * FROM calendar_settings WHERE id=1 FOR UPDATE"))[0];
      if(!s||s.generation_enabled!==true)return {inserted:0};
      // Apply the same date, cadence, time and lead constraints as owner configuration.
      if(!validDate(s.start_date)||!validCadence(s.short_days,s.long_day)||
        !Number.isInteger(s.generation_lead_hours)||s.generation_lead_hours<this.minimumGenerationLeadHours||s.generation_lead_hours>336||
        !["shared","per_platform"].includes(s.timing_mode)||!validateTimes(s.platform_times)||
        (s.timing_mode==="shared"&&!validTime(s.post_time))||timingMissing(s))return {inserted:0};
      const today=new Date(now.getTime()+330*60_000).toISOString().slice(0,10);
      let inserted=0;
      for(let offset=0;offset<28;offset++){
        const date=new Date(Date.parse(today)+offset*DAY),planned=date.toISOString().slice(0,10),weekday=date.getUTCDay();
        if(planned<s.start_date)continue;
        const kind=weekday===s.long_day?"longform":s.short_days.includes(weekday)?"shortform":null;
        if(!kind)continue;
        // Automatic refill treats the whole date as occupied, including other/legacy kinds.
        if((await tx.query("SELECT id FROM calendar_entries WHERE planned_date=$1 LIMIT 1",[planned])).length)continue;
        const schedule=Object.fromEntries(NEW_PLATFORMS.map(platform=>{
          const hour=s.timing_mode==="per_platform"?s.platform_times[platform][weekday]:s.post_time;
          const post=new Date(planned+"T"+hour+":00+05:30"),review=new Date(post.getTime()-48*3_600_000);
          return [platform,{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}];
        }));
        const post=new Date(Math.min(...Object.values(schedule).map(item=>Date.parse(item.intended_post))));
        const generation=new Date(post.getTime()-s.generation_lead_hours*3_600_000),review=new Date(post.getTime()-48*3_600_000);
        if(generation.getTime()<=now.getTime())continue;
        inserted+=(await tx.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule) VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT(planned_date,kind) DO NOTHING RETURNING id",[randomUUID(),planned,kind,post,review,generation,JSON.stringify({...schedule,platform_policy:NEW_PLATFORM_POLICY})])).length;
      }
      return {inserted};
    });
  }
  async link(entry:string,source:string|null,task:string|null){
    await this.db.transaction(async tx=>{
      // Keep explicit links serialized with recovery and dispatch.
      await tx.query("SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE");
      const planned=(await tx.query<any>("SELECT * FROM calendar_entries WHERE id=$1 FOR UPDATE",[entry]))[0];
      if(!planned)throw Error("Unknown calendar entry");
      const intent=(await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entry]))[0];
      if(intent?.task_id&&(intent.task_id!==task||intent.source_id!==source))throw Error("Dispatched calendar task cannot be relinked");
      if(source&&!sourceEligible((await tx.query<Source>("SELECT * FROM sources WHERE id=$1",[source]))[0]))throw Error("Source not cleared");
      if(task){
        const linked=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 AND source_id=$2",[task,source]))[0];
        if(!source||!linked)throw Error("Task must match the linked source");
        if(JSON.stringify(taskPlatformPolicy(linked))!==JSON.stringify(calendarPlatformPolicy(planned)))throw Error("Task and calendar platform policies must match");
      }
      await tx.query("UPDATE calendar_entries SET source_id=$2,task_id=$3,updated=now() WHERE id=$1",[entry,source,task]);
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_linked','User linked calendar evidence/task; no model call')",[randomUUID(),task]);
    });
  }
  async prepareDue(now=new Date()){
    // This legacy planning operation never inserts or queues a content task.
    // Only dispatchDue can promote an intent after the separate owner toggle.
    return this.db.transaction(async tx=>{
      const due=await tx.query<{id:string}>("SELECT id FROM calendar_entries WHERE generation_due IS NOT NULL AND generation_due<=$1 FOR UPDATE",[now]);let inserted=0;
      for(const entry of due)inserted+=(await tx.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked') ON CONFLICT(entry_id) DO NOTHING RETURNING id",[randomUUID(),entry.id])).length;
      if(inserted)await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_due_prepared','Due intents stored idempotently; paid execution remains disabled')",[randomUUID()]);
      return {inserted,paid_execution:false};
    });
  }
  async dispatchDue(c:RuntimeConfig,runtimeEnabled:boolean,now=new Date(),options:{hostedScopedOnly?:boolean}={}){
    if(!Number.isFinite(now.getTime()))throw Error("Invalid dispatch time");
    return this.db.transaction(async tx=>{
      // Owner toggle and all due entry locks serialize concurrent scheduler delivery.
      const settings=(await tx.query<any>("SELECT * FROM calendar_settings WHERE id=1 FOR UPDATE"))[0];
      let due=await tx.query<any>("SELECT * FROM calendar_entries WHERE generation_due IS NOT NULL AND generation_due<=$1 ORDER BY generation_due,id FOR UPDATE",[now]);
      const result={queued:0,blocked:0,existing:0,paid_execution:false as const,entries:[] as DispatchEntry[]};
      if(!due.length)return result;
      const hostedJobs=new Map<string,any>();
      if(options.hostedScopedOnly&&(settings?.generation_enabled!==true||!runtimeEnabled||!configReady(c,now)||c.owner_cleared_sources_authorized!==true||c.fallback_authorized===true))return result;
      if(options.hostedScopedOnly){
        const allowed:any[]=[];
        for(const entry of due){
          // Scope is decided before any job/task mutation or budget guard.
          const job=(await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entry.id]))[0];
          if(entry.source_id||entry.task_id||job?.source_id||job?.source_hash||job?.task_id){
            if(!entry.task_id||job?.task_id!==entry.task_id)continue;
            const grant=await tx.query("SELECT id FROM github_source_grants WHERE task_id=$1 AND entry_id=$2 AND source_id=$3 AND source_hash=$4",[entry.task_id,entry.id,entry.source_id,job.source_hash]);
            if(grant.length!==1)continue;
            hostedJobs.set(entry.id,job);allowed.push(entry);
          }else{
            try{if(calendarPlatformPolicy(entry))allowed.push(entry);}catch{/* Invalid/legacy slots remain untouched. */}
          }
        }
        due=allowed;if(!due.length)return result;
      }
      // Lock all source rows before the shared budget guard to match worker order.
      const selection=await githubSelectionPool(tx,c,now),usedEvidence=new Set<string>();
      const sourceIds=[...new Set([...due.map(entry=>entry.source_id).filter(Boolean),...selection.candidates.map(item=>item.source.id)])].sort();
      const rawSources=sourceIds.length?await tx.query<Source>("SELECT * FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[sourceIds]):[];
      const sources=await Promise.all(rawSources.map(source=>resolveScopedSource(tx,source,now)));
      if(options.hostedScopedOnly){
        const allowed:any[]=[];
        for(const entry of due){
          if(!entry.task_id||await scopedCalendarContext(tx,entry.task_id,c,{rootId:entry.task_id,entry,job:hostedJobs.get(entry.id)},now,false,false))allowed.push(entry);
        }
        due=allowed;if(!due.length)return result;
      }
      await tx.query("INSERT INTO budget_months(month) VALUES('__combined_guard__') ON CONFLICT DO NOTHING");
      await tx.query("SELECT month FROM budget_months WHERE month='__combined_guard__' FOR UPDATE");
      const accounting=(await tx.query<any>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END) FILTER (WHERE month=$1 OR status!='settled'),0) AS used,COUNT(*) FILTER (WHERE status!='settled') AS unresolved,COUNT(*) FILTER (WHERE pricing_anomaly=true AND status!='settled') AS pricing_anomalies FROM ledger",[istMonth(now)]))[0];
      const budget={used:Number(accounting.used),unresolved:Number(accounting.unresolved),pricingBlocked:Number(accounting.pricing_anomalies)>0};
      for(const entry of due){
        // Preserve legacy entry/job records, but do not start new multi-platform work.
        const priorJob=(await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entry.id]))[0];
        if(!entry.task_id&&!priorJob?.task_id&&!calendarPlatformPolicy(entry)){
          result.blocked++;result.entries.push({entry_id:entry.id,task_id:null,status:"blocked",reason:LEGACY_CALENDAR_BLOCKER});continue;
        }
        let job=priorJob||{};
        let source=sources.find(item=>item?.id===entry.source_id);
        let selected:typeof selection.candidates[number]|undefined;
        if(!entry.source_id&&!entry.task_id&&!job.source_id&&!job.task_id&&calendarPlatformPolicy(entry)&&selection.policy){
          for(const candidate of selection.candidates){
            const current=rawSources.find(item=>item.id===candidate.source.id);
            if(!current||current.cleared||current.clearance_id||current.revoked_at||usedEvidence.has(candidate.evidence_key))continue;
            const eligible=githubEvidenceEligibility(current,candidate.provenance,selection.policy.scope,now);
            if(!eligible.eligible||eligible.evidence_key!==candidate.evidence_key)continue;
            if((await tx.query("SELECT id FROM tasks WHERE source_id=$1",[current.id])).length||(await tx.query("SELECT id FROM github_source_grants WHERE source_id=$1 OR evidence_key=$2",[current.id,candidate.evidence_key])).length)continue;
            selected={...candidate,source:current};source=current;break;
          }
        }
        // A hosted run cannot create even a blocked job for a manually linked or
        // unproven source. Unlinked slots must first select genuine scoped evidence.
        if(options.hostedScopedOnly&&!entry.task_id&&!job.task_id&&!selected)continue;
        await tx.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked') ON CONFLICT(entry_id) DO NOTHING",[randomUUID(),entry.id]);
        job=(await tx.query<any>("SELECT * FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE",[entry.id]))[0];
        // Once any task is bound, neither retries, edits, cancellation nor time
        // passing can create a replacement task for this scheduled slot.
        if(job.task_id||entry.task_id){
          const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1",[job.task_id||entry.task_id]))[0];
          const reason=linkedBlocker(task,entry,job,source);
          if(!job.task_id&&task){
            await tx.query("UPDATE calendar_jobs SET status='linked',task_id=$2,source_id=$3,source_hash=$4,block_reason=$5,updated=$6 WHERE id=$1",[job.id,task.id,task.source_id,task.source_hash,reason,now]);
          }else await tx.query("UPDATE calendar_jobs SET block_reason=$2,updated=$3 WHERE id=$1",[job.id,reason,now]);
          result.existing++;if(reason)result.blocked++;
          result.entries.push({entry_id:entry.id,task_id:task?.id||job.task_id||entry.task_id,status:reason?"blocked":task?.status||"linked",...(reason?{reason}:{})});
          continue;
        }
        const blockers=dispatchBlockers(settings,entry,source,c,runtimeEnabled,budget,now,this.minimumGenerationLeadHours,!!selected);
        if(!source&&selection.policy)blockers.push(selection.reason||"All eligible evidence has already been selected; no duplicate reuse");
        if(blockers.length){
          const reason=blockers.join("; ");
          await tx.query("UPDATE calendar_jobs SET status='blocked',block_reason=$2,updated=$3 WHERE id=$1",[job.id,reason,now]);
          result.blocked++;result.entries.push({entry_id:entry.id,task_id:null,status:"blocked",reason});continue;
        }
        const grantId=selected?randomUUID():null;
        const policy=calendarPlatformPolicy(entry),origin="calendar:"+entry.id,brief={kind:entry.kind,planned_date:entry.planned_date,platforms:activePlatforms(policy),...(policy?{platform_policy:policy}:{}),intended_post:new Date(entry.intended_post).toISOString(),review_due:new Date(entry.review_due).toISOString(),generation_due:new Date(entry.generation_due).toISOString(),...(selected?{source_policy:{id:selection.policy!.id,hash:selection.policy!.scope_hash,grant_id:grantId,provenance_id:selected.provenance.id}}:{})};
        if(selected){
          await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'github_source_selected',$2)",[grantId,JSON.stringify({policy_id:selection.policy!.id,source_hash:source!.hash,provenance_hash:githubProvenanceHash(selected.provenance),entry_id:entry.id,evidence_key:selected.evidence_key})]);
          await tx.query("INSERT INTO github_source_grants(id,policy_id,policy_hash,provenance_id,provenance_hash,source_id,source_hash,evidence_key,entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[grantId,selection.policy!.id,selection.policy!.scope_hash,selected.provenance.id,githubProvenanceHash(selected.provenance),source!.id,source!.hash,selected.evidence_key,entry.id]);
        }
        const inserted=await tx.query<Task>("INSERT INTO tasks(id,source_id,source_hash,status,origin_key,content_brief) VALUES($1,$2,$3,'queued',$4,$5) ON CONFLICT(source_id,source_hash,origin_key) DO NOTHING RETURNING *",[randomUUID(),source!.id,source!.hash,origin,JSON.stringify(brief)]);
        const task=inserted[0]||(await tx.query<Task>("SELECT * FROM tasks WHERE source_id=$1 AND source_hash=$2 AND origin_key=$3",[source!.id,source!.hash,origin]))[0];
        if(!task)throw Error("Scheduled task linkage unavailable");
        if(selected){
          await tx.query("UPDATE github_source_grants SET task_id=$2 WHERE id=$1",[grantId,task.id]);
          await tx.query("UPDATE calendar_entries SET source_id=$2 WHERE id=$1",[entry.id,source!.id]);
          usedEvidence.add(selected.evidence_key);
        }
        const reason=task.status==="cancelled"?"Linked task was cancelled; automatic replacement and replay are disabled":task.status==="blocked"?"Linked task is blocked; explicit reconciliation or retry is required":null;
        await tx.query("UPDATE calendar_entries SET task_id=$2,updated=$3 WHERE id=$1",[entry.id,task.id,now]);
        await tx.query("UPDATE calendar_jobs SET status='dispatched',task_id=$2,source_id=$3,source_hash=$4,block_reason=$5,dispatched_at=$6,updated=$6 WHERE id=$1",[job.id,task.id,source!.id,source!.hash,reason,now]);
        if(inserted.length){
          result.queued++;
          await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_dispatched',$3)",[randomUUID(),task.id,"Due entry "+entry.id+" queued once from authorized source "+source!.hash+"; no publication"]);
        }else result.existing++;
        if(reason)result.blocked++;
        result.entries.push({entry_id:entry.id,task_id:task.id,status:task.status,...(reason?{reason}:{})});
      }
      return result;
    });
  }
  async snapshot(state:any,c:RuntimeConfig,runtimeEnabled:boolean,now=new Date(),ownerActionReady=runtimeEnabled){
    const {generation_exact:exactSettings,...settings}=(await this.db.query<any>(`SELECT s.*,${generationRowSQL('s')} AS generation_exact FROM calendar_settings s WHERE id=1`))[0];
    const jobs=await this.db.query<any>("SELECT * FROM calendar_jobs ORDER BY created,id"),rawEntries=await this.db.query<any>(`SELECT e.*,${generationRowSQL('e')} AS generation_exact FROM calendar_entries e ORDER BY intended_post,id`);
    const exactEntries=new Map(rawEntries.map(entry=>[entry.id,entry.generation_exact])),entries=rawEntries.map(raw=>{const entry={...raw};delete entry.generation_exact;return entry;});
    const selection=await githubSelectionPool(this.db,c,now);
    const budget={used:Number(state.budget.committed_microdollars),unresolved:Number(state.budget.unresolved_reservations),pricingBlocked:!!state.pricing_blocked};
    return {automatic_source_selection:{enabled:!!selection.policy,eligible_candidates:selection.candidates.length,notice:selection.reason||"Due dispatch selects one unused GitHub evidence item atomically; source availability may change"},settings,new_platform_policy:NEW_PLATFORM_POLICY,new_active_platforms:NEW_PLATFORMS,minimum_generation_lead_hours:this.minimumGenerationLeadHours,paid_activation:settings.generation_enabled===true,scheduler:"Due dispatch requires an active worker or external scheduler invocation; saving does not start a scheduler",configuration_needed:!settings.start_date||timingMissing(settings),entries:entries.map(entry=>{
      const source=state.sources.find((item:any)=>item.id===entry.source_id),task=state.tasks.find((item:any)=>item.id===entry.task_id),review=state.reviews.find((item:any)=>item.task_id===entry.task_id),job=jobs.find(item=>item.entry_id===entry.id)||null;
      const candidate=!entry.source_id&&!entry.task_id&&!job?.source_id&&!job?.task_id&&calendarPlatformPolicy(entry)?selection.candidates[0]:undefined;
      const blockers=dispatchBlockers(settings,entry,source||candidate?.source,c,runtimeEnabled,budget,now,this.minimumGenerationLeadHours,!!candidate);
      if(!source&&!candidate&&selection.policy)blockers.push(selection.reason||"No unused eligible GitHub evidence is currently available");
      if(source?.text===CAPSULE)blockers.push("Source lacks concrete events and emotional context; do not invent personal lessons or feelings");
      const reviewReady=task?.status==="review"||task?.status==="approved";
      if(reviewReady&&review?.quality.flags.length)blockers.push("Linked content has source-grounding flags");
      if(reviewReady&&review?.quality.editorial?.blocking)blockers.push("Linked content has a saved editorial hold; story/source correction required");
      const linkageReason=task||job?.task_id?linkedBlocker(task,entry,job||{},source):null;
      if(linkageReason)blockers.push(linkageReason);
      const due=!!entry.generation_due&&new Date(entry.generation_due)<=now;
      const content=review?.bundle.find((item:any)=>item.role==="Platform Adapter");
      const policy=calendarPlatformPolicy(entry),parsed=platformVariants(content,policy);
      const variants=activePlatforms(policy).map(platform=>{const variant=parsed.variants.find(item=>item.platform===platform)!;return {platform,...(entry.platform_schedule[platform]||{intended_post:entry.intended_post,draft_due:entry.draft_due,review_due:entry.review_due}),status:content?(variant.hash?review?.approval&&parsed.complete?"user_approved_quality_separate":"review_needed":"not_separately_identified"):"not_generated",artifact_hash:variant.hash,source_artifact_hash:content?.hash||null};});
      const generationLate=!!entry.generation_due&&(job?.dispatched_at?new Date(job.dispatched_at)>new Date(entry.generation_due):!task&&new Date(entry.generation_due)<now);
      const timingNotice=generationLate?(job?.dispatched_at?"Queued after the target generation time; the review deadline is unchanged":"Target generation time has passed. Catch-up is allowed only while the review deadline remains in the future"):null;
      const timingHistory=!!job||state.tasks.some((item:Task)=>item.origin_key==='calendar:'+entry.id)||identifiableGenerationHistory(state.events||[],entry.id);
      return {...entry,generation_time_preview:generationTimePreview(exactEntries.get(entry.id),exactSettings,selection,c,ownerActionReady,now,timingHistory),platform_policy:policy||null,active_platforms:activePlatforms(policy),job,recovery:calendarRecoverySnapshot(entry,job,task,source,state.ledger||[],now),generation_late:generationLate,timing_notice:timingNotice,status:(review?.approval||(!review?.latest_revision&&review?.original_approval))&&!parsed.complete?"historical_approval_completeness_unverified":reviewReady&&(review?.quality.flags.length||review?.quality.editorial?.blocking)?"changes_needed":review?.approval?"user_approved_quality_separate":review?.latest_revision?"review_needed":task?.status==="review"?"review_needed":task?task.status:due?blockers.length?"due_blocked":"due_ready":blockers.length?"planned_blocked":"planned_ready",blocked_reasons:blockers,variants,linked_task_status:task?.status||null,linked_content_version:review?.token||null};
    })};
  }
}
