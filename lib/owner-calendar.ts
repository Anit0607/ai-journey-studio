import {randomUUID} from "node:crypto";
import type {Database,Connection} from "./db";
import {CAP,BUFFER,istMonth,hash,type RuntimeConfig} from "./domain";
import {hostedOwnerDraftReady} from "./hosted";
import {ownerDraftConfigHash} from "./owner-draft-policy";
import {ownerCalendarContext,ownerCalendarBinding,assertOwnerCalendarScope,OWNER_CALENDAR_STARTED,OWNER_CALENDAR_FINISHED,OWNER_CALENDAR_MAX_CALLS,OWNER_CALENDAR_MAX_RESERVED,OWNER_CALENDAR_BUDGET_MS,type OwnerCalendarScope} from "./owner-calendar-policy";
import {finalizeAgentRevision} from "./agent-revisions";
import {Store} from "./store";
import {providerCall} from "./providers";
import {step} from "./workflow";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
export type OwnerCalendarRequest={task_id:string;expected_preview:string;acknowledged:true};
export type OwnerCalendarResult={task_id:string;run_id?:string;status:"review"|"blocked"|"uncertain"|"duplicate";steps:number};
type Options={readConfig:()=>RuntimeConfig;isReady?:(c:RuntimeConfig)=>boolean;provider?:typeof providerCall;signal?:AbortSignal;elapsed?:()=>number;providerTimeoutMs?:number};
export function validOwnerCalendarRequest(value:unknown):value is OwnerCalendarRequest{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const b=value as OwnerCalendarRequest;
  return Object.keys(b).sort().join(",")==="acknowledged,expected_preview,task_id"&&typeof b.task_id==="string"&&UUID.test(b.task_id)&&typeof b.expected_preview==="string"&&SHA.test(b.expected_preview)&&b.acknowledged===true;
}
async function accounting(tx:Connection){
  const usage=(await tx.query<{used:string;unresolved:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END) FILTER (WHERE month=$1 OR status!='settled'),0) AS used,COUNT(*) FILTER (WHERE status!='settled') AS unresolved FROM ledger",[istMonth()]))[0];
  if(!usage||Number(usage.unresolved)!==0||!Number.isSafeInteger(Number(usage.used))||Number(usage.used)<0||Number(usage.used)>=CAP-BUFFER)throw Error("Owner Calendar accounting blocked");
}
async function preview(tx:Connection,id:string,config:RuntimeConfig,locked?:NonNullable<Awaited<ReturnType<typeof ownerCalendarContext>>>){
  const context=locked||await ownerCalendarContext(tx,id,config);
  if(!context||context.task.status!=="queued"||context.task.checkpoint!==0)throw Error("Exact Calendar task is not eligible");
  const {task,root,source,proof,entry}=context;
  if((await tx.query("SELECT id FROM outputs WHERE task_id=$1 UNION ALL SELECT id FROM ledger WHERE task_id=$1 UNION ALL SELECT id FROM events WHERE task_id=$1 AND kind IN ('owner_draft_started','owner_calendar_started')",[task.id])).length)throw Error("Exact Calendar task already attempted");
  const binding=ownerCalendarBinding(context,config),updated=new Date(task.updated).toISOString();
  const values={task_id:task.id,mode:task.id===root.id?"initial":"revision",parent_id:task.revision_parent_task_id||null,parent_token:task.revision_base_token||null,feedback:task.revision_note||null,source:{id:source.id,hash:source.hash,text:source.text,reported_date:source.reported_date},policy_id:proof.policy_id,grant_id:proof.grant_id,entry_id:entry.id,generation_due:new Date(entry.generation_due).toISOString(),review_due:new Date(entry.review_due).toISOString(),intended_post:new Date(entry.intended_post).toISOString(),model:config.openai!.model,binding,config_hash:ownerDraftConfigHash(config),updated,max_calls:OWNER_CALENDAR_MAX_CALLS,max_reserved_microdollars:OWNER_CALENDAR_MAX_RESERVED};
  return {...values,version:hash(JSON.stringify(values))};
}
/** Only reads existing exact tasks; it never dispatches, consumes evidence or resumes a run. */
export async function ownerCalendarSnapshot(db:Database,config:RuntimeConfig,ready=hostedOwnerDraftReady(config)){
  const events=await db.query<{id:string;task_id:string;kind:string;detail:string}>("SELECT id,task_id,kind,detail FROM events WHERE kind IN ($1,$2) ORDER BY created,id",[OWNER_CALENDAR_STARTED,OWNER_CALENDAR_FINISHED]);
  const runs=events.filter(e=>e.kind===OWNER_CALENDAR_STARTED).map(e=>{const start=JSON.parse(e.detail),end=events.find(x=>x.task_id===e.task_id&&x.kind===OWNER_CALENDAR_FINISHED),finish=end?JSON.parse(end.detail):null;return {task_id:e.task_id,run_id:e.id,status:finish?.status||(Date.now()>=Date.parse(start.deadline)?"uncertain":"running"),steps:finish?.steps??null};});
  const previews=[];
  if(ready){
    const tasks=await db.query<{id:string}>("SELECT id FROM tasks WHERE status='queued' AND checkpoint=0 AND content_brief->'source_policy' IS NOT NULL ORDER BY updated,id LIMIT 32");
    for(const task of tasks){try{previews.push(await db.transaction(tx=>preview(tx,task.id,config)));}catch{/* A stale/ineligible task has no executable preview. */}}
  }
  return {runtime_ready:ready,previews,runs};
}
/** One explicit owner-cookie action, one exact initial/revision task, no retry or daily claim. */
export async function runOwnerCalendar(rawDb:Database,input:OwnerCalendarRequest,options:Options):Promise<OwnerCalendarResult>{
  const result:OwnerCalendarResult={task_id:input?.task_id||"",status:"blocked",steps:0};
  if(!validOwnerCalendarRequest(input)||rawDb.kind!=="postgres")return result;
  const transaction:Database["transaction"]=work=>rawDb.transaction(async tx=>{await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");return work(tx);});
  const db:Database={kind:rawDb.kind,close:()=>rawDb.close(),transaction,query:(sql,params)=>transaction(tx=>tx.query(sql,params))},store=new Store(db);
  const started=performance.now(),elapsed=options.elapsed||(()=>performance.now()-started),ready=options.isReady||hostedOwnerDraftReady;
  let scope:OwnerCalendarScope|undefined;
  const runtime=()=>{const c=options.readConfig();if(!ready(c)||c.owner_cleared_sources_authorized!==true||c.fallback_authorized===true||(scope&&ownerDraftConfigHash(c)!==scope.config_hash))throw Error("Owner Calendar runtime changed");return c;};
  const time=(completion=false)=>{if(options.signal?.aborted||elapsed()>=OWNER_CALENDAR_BUDGET_MS-(completion?0:70_000))throw Error("Owner Calendar deadline");};
  async function finish(status:OwnerCalendarResult["status"]){
    result.status=status;if(!scope)return result;
    await db.transaction(async tx=>{
      if(status==="review"){
        time(true);const config=runtime();
        const context=await assertOwnerCalendarScope(tx,{scope:{...scope!,checkpoint:6},config},true);
        if(context.task.status!=="running"||context.task.checkpoint!==6)throw Error("Owner Calendar completion stopped");
        await accounting(tx);time(true);runtime();
        await tx.query("UPDATE tasks SET status='review',updated=now() WHERE id=$1",[scope!.task_id]);
        const revision=await finalizeAgentRevision(tx,{...context.task,status:"review"});
        if(revision.status==="blocked")throw Error("Owner Calendar revision stopped");
        if(revision.status==="not_revision")await store.event(tx,scope!.task_id,"review_ready","Exact versions require user approval");
      }else{
        // Terminal even with zero calls; no marker deletion, lease recovery or replay.
        await tx.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE",[scope!.task_id]);
        const finished=(await tx.query<{detail:string}>("SELECT detail FROM events WHERE task_id=$1 AND kind=$2",[scope!.task_id,OWNER_CALENDAR_FINISHED]))[0];
        if(finished){
          const saved=JSON.parse(finished.detail);
          if(saved.run_id!==scope!.run_id||!["review","blocked","uncertain"].includes(saved.status))throw Error("Owner Calendar finish outcome uncertain");
          result.status=saved.status;result.steps=saved.steps;return;
        }
        await tx.query("UPDATE tasks SET status='blocked',block_reason='owner_calendar_once',lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1 AND status IN ('queued','running','review')",[scope!.task_id]);
      }
      // Finalization has awaited multiple writes; a late deadline/abort/config change
      // must roll back the parent revision and review state, not just its receipt.
      if(status==="review"){time(true);runtime();}
      if(!(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[scope!.task_id,OWNER_CALENDAR_FINISHED])).length)await store.event(tx,scope!.task_id,OWNER_CALENDAR_FINISHED,JSON.stringify({run_id:scope!.run_id,status,steps:result.steps}));
      if(status==="review"){time(true);runtime();}
    });
    return result;
  }
  try{
    const c=runtime();time();
    const claimed=await db.transaction(async tx=>{
      // Context/preview acquire Calendar locks before tasks and source/policy.
      const context=await ownerCalendarContext(tx,input.task_id,c);
      // Recheck the durable marker after the task lock, even on a completed run.
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[input.task_id,OWNER_CALENDAR_STARTED])).length)return false;
      if(!context)throw Error("Exact Calendar task changed");
      const current=await preview(tx,input.task_id,c,context);
      if(current.version!==input.expected_preview)throw Error("Exact Calendar preview changed");
      await accounting(tx);time();runtime();
      const next:OwnerCalendarScope={run_id:randomUUID(),task_id:input.task_id,binding:current.binding,config_hash:current.config_hash,deadline:new Date(Date.now()+OWNER_CALENDAR_BUDGET_MS).toISOString(),checkpoint:0};
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[next.run_id,next.task_id,OWNER_CALENDAR_STARTED,JSON.stringify({...next,preview:current,max_calls:OWNER_CALENDAR_MAX_CALLS,max_reserved_microdollars:OWNER_CALENDAR_MAX_RESERVED})]);
      return next;
    });
    if(!claimed){result.status="duplicate";return result;}
    scope=claimed;result.run_id=scope.run_id;
    while(result.steps<OWNER_CALENDAR_MAX_CALLS){
      time();const config=runtime();await accounting(db);time();
      const provider:typeof providerCall=async(...args)=>{
        // Scoped admission itself can wait on locks. Recheck immediately at transport.
        time();runtime();
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{return await Promise.race([(options.provider||providerCall)(...args),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Provider outcome uncertain")),Math.min(60_000,options.providerTimeoutMs??60_000));})]);}finally{clearTimeout(timer);}
      };
      const outcome=await step(store,config,provider,true,{ownerClearedOnly:true,minimumGenerationLeadHours:120,ownerCalendar:{...scope,checkpoint:result.steps},beforeProvider:async()=>{
        time();const current=runtime();
        await db.transaction(async tx=>{
          const context=await assertOwnerCalendarScope(tx,{scope:{...scope!,checkpoint:result.steps},config:current});
          if(context.task.status!=="running")throw Error("Owner calendar execution stopped");
          if((await tx.query("SELECT id FROM ledger WHERE status!='settled' AND NOT (task_id=$1 AND checkpoint=$2 AND status='reserved' AND pricing_anomaly=false) LIMIT 1",[scope!.task_id,result.steps])).length)throw Error("Owner Calendar accounting unresolved");
          const used=(await tx.query<{used:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END),0) AS used FROM ledger WHERE month=$1 OR status!='settled'",[istMonth()]))[0];
          if(!used||!Number.isSafeInteger(Number(used.used))||Number(used.used)>CAP-BUFFER)throw Error("Owner Calendar accounting unresolved");
        });
        time();runtime();
      }});
      if(outcome.status!=="step_saved")return await finish((await db.query("SELECT id FROM ledger WHERE task_id=$1 AND status!='settled'",[input.task_id])).length?"uncertain":"blocked");
      result.steps++;
    }
    return await finish("review");
  }catch{
    try{return await finish(scope&&(await db.query("SELECT id FROM ledger WHERE task_id=$1 AND status!='settled'",[input.task_id])).length?"uncertain":"blocked");}catch{return {...result,status:scope?"uncertain":"blocked"};}
  }
}
