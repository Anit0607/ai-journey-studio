import {randomUUID} from "node:crypto";
import type {Database,Connection} from "./db";
import {CAP,BUFFER,istMonth,type RuntimeConfig,type Task,type Source} from "./domain";
import {hostedOwnerDraftReady} from "./hosted";
import {sourceAuthorized,ownerSourceEligible} from "./sources";
import {Store} from "./store";
import {providerCall} from "./providers";
import {step} from "./workflow";
import {assertOwnerDraftScope,OWNER_DRAFT_BUDGET_MS,OWNER_DRAFT_MAX_CALLS,OWNER_DRAFT_MAX_RESERVED,OWNER_DRAFT_STARTED,OWNER_DRAFT_FINISHED,ownerDraftConfigHash,type OwnerDraftScope} from "./owner-draft-policy";
export {ownerDraftConfigHash} from "./owner-draft-policy";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const HEADROOM=70_000;
export type OwnerDraftRequest={task_id:string;expected_source_id:string;expected_source_hash:string;expected_clearance_id:string;expected_updated:string;expected_checkpoint:0;expected_config_hash:string;acknowledged:true};
export type OwnerDraftResult={task_id:string;run_id?:string;status:"review"|"blocked"|"uncertain"|"duplicate";steps:number};
type Options={readConfig:()=>RuntimeConfig;isReady?:(config:RuntimeConfig)=>boolean;provider?:typeof providerCall;signal?:AbortSignal;elapsed?:()=>number;providerTimeoutMs?:number};
export function validOwnerDraftRequest(value:unknown):value is OwnerDraftRequest{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const b=value as OwnerDraftRequest;
  if(![b.task_id,b.expected_source_id,b.expected_clearance_id,b.expected_source_hash,b.expected_config_hash].every(field=>typeof field==="string"))return false;
  return Object.keys(b).length===8&&Object.keys(b).every(key=>["task_id","expected_source_id","expected_source_hash","expected_clearance_id","expected_updated","expected_checkpoint","expected_config_hash","acknowledged"].includes(key))&&UUID.test(b.task_id)&&UUID.test(b.expected_source_id)&&UUID.test(b.expected_clearance_id)&&SHA.test(b.expected_source_hash)&&SHA.test(b.expected_config_hash)&&b.expected_checkpoint===0&&b.acknowledged===true&&typeof b.expected_updated==="string"&&Number.isFinite(Date.parse(b.expected_updated));
}
async function generationAndAccounting(tx:Connection){
  if((await tx.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings WHERE id=1"))[0]?.generation_enabled!==true)throw Error("Owner draft gate blocked");
  const usage=(await tx.query<{used:string;unresolved:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END) FILTER (WHERE month=$1 OR status!='settled'),0) AS used,COUNT(*) FILTER (WHERE status!='settled') AS unresolved FROM ledger",[istMonth()]))[0];
  if(!usage||Number(usage.unresolved)!==0||!Number.isSafeInteger(Number(usage.used))||Number(usage.used)<0||Number(usage.used)>=CAP-BUFFER)throw Error("Owner draft gate blocked");
}
/** Static status from durable events; reading never resumes work or reconciles unknown calls. */
export async function ownerDraftSnapshot(db:Database,config:RuntimeConfig,ready=hostedOwnerDraftReady(config)){
  const events=await db.query<{id:string;task_id:string;kind:string;detail:string}>("SELECT id,task_id,kind,detail FROM events WHERE kind IN ($1,$2) ORDER BY created,id",[OWNER_DRAFT_STARTED,OWNER_DRAFT_FINISHED]);
  const runs=events.filter(e=>e.kind===OWNER_DRAFT_STARTED).map(event=>{
    const start=JSON.parse(event.detail),end=events.find(e=>e.task_id===event.task_id&&e.kind===OWNER_DRAFT_FINISHED),finished=end?JSON.parse(end.detail):null;
    return {task_id:event.task_id,run_id:event.id,status:finished?.status||(Date.now()>=Date.parse(start.deadline)?"uncertain":"running"),steps:finished?.steps??null,deadline:start.deadline,max_reserved_microdollars:OWNER_DRAFT_MAX_RESERVED};
  });
  return {runtime_ready:ready,config_hash:ownerDraftConfigHash(config),model:config.openai?.model||null,max_calls:OWNER_DRAFT_MAX_CALLS,max_reserved_microdollars:OWNER_DRAFT_MAX_RESERVED,runs};
}
/** One exact owner-selected original task. No Calendar dispatch, queue sweep, fallback or continuation. */
export async function runOwnerDraft(rawDb:Database,input:OwnerDraftRequest,options:Options):Promise<OwnerDraftResult>{
  // Bound each database operation on the existing approved connection; no extra client or credentials.
  const transaction:Database["transaction"]=work=>rawDb.transaction(async tx=>{await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");return work(tx);});
  const db:Database={kind:rawDb.kind,close:()=>rawDb.close(),transaction,query:(sql,params)=>transaction(tx=>tx.query(sql,params))};
  const result:OwnerDraftResult={task_id:input?.task_id||"",status:"blocked",steps:0};
  if(!validOwnerDraftRequest(input)||db.kind!=="postgres")return result;
  const started=performance.now(),elapsed=options.elapsed||(()=>performance.now()-started),ready=options.isReady||hostedOwnerDraftReady;
  const runtime=()=>{const c=options.readConfig();if(!ready(c)||ownerDraftConfigHash(c)!==input.expected_config_hash||c.owner_cleared_sources_authorized!==true||(c.fallback_authorized!==undefined&&c.fallback_authorized!==false))throw Error("Owner draft gate blocked");return c;};
  const time=()=>{if(options.signal?.aborted||elapsed()>OWNER_DRAFT_BUDGET_MS-HEADROOM)throw Error("Owner draft deadline");};
  let scope:OwnerDraftScope|undefined;
  const store=new Store(db);
  async function finish(status:OwnerDraftResult["status"]){
    result.status=status;
    if(!scope)return result;
    await db.transaction(async tx=>{
      const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[input.task_id]))[0];
      if(status==="review"){
        runtime();
        if(!task||task.status!=="review"||task.checkpoint!==6)throw Error("Owner draft completion unavailable");
        await assertOwnerDraftScope(tx,task,{...scope!,checkpoint:6});
      }
      // Partial or stopped one-shot runs are terminal, even if no provider request began.
      if(status!=="review")await tx.query("UPDATE tasks SET status='blocked',block_reason='owner_draft_once',lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1 AND status IN ('queued','running','review')",[input.task_id]);
      if(!(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[input.task_id,OWNER_DRAFT_FINISHED])).length)await store.event(tx,input.task_id,OWNER_DRAFT_FINISHED,JSON.stringify({run_id:scope!.run_id,status,steps:result.steps}));
    });
    return result;
  }
  try{
    const initial=runtime();time();
    const claimed=await db.transaction(async tx=>{
      await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");
      const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[input.task_id]))[0];
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[input.task_id,OWNER_DRAFT_STARTED])).length)return false;
      if(!task||task.status!=="queued"||task.checkpoint!==0||task.origin_key!=="manual"||task.revision_parent_task_id||task.source_id!==input.expected_source_id||task.source_hash!==input.expected_source_hash||new Date(task.updated).getTime()!==Date.parse(input.expected_updated))throw Error("Owner draft target changed");
      if((await tx.query("SELECT id FROM outputs WHERE task_id=$1 UNION ALL SELECT id FROM ledger WHERE task_id=$1 UNION ALL SELECT id FROM calendar_entries WHERE task_id=$1",[task.id])).length)throw Error("Owner draft target changed");
      const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[task.source_id]))[0];
      if(!ownerSourceEligible(source,task.source_hash)||source.clearance_id!==input.expected_clearance_id||!sourceAuthorized(initial,source))throw Error("Owner draft source changed");
      await generationAndAccounting(tx);runtime();time();
      const next:OwnerDraftScope={run_id:randomUUID(),task_id:task.id,source_id:source.id,source_hash:source.hash,clearance_id:source.clearance_id!,config_hash:input.expected_config_hash,deadline:new Date(Date.now()+OWNER_DRAFT_BUDGET_MS).toISOString(),checkpoint:0};
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[next.run_id,task.id,OWNER_DRAFT_STARTED,JSON.stringify({...next,max_calls:OWNER_DRAFT_MAX_CALLS,max_reserved_microdollars:OWNER_DRAFT_MAX_RESERVED})]);
      return next;
    });
    if(!claimed){result.status="duplicate";return result;}
    scope=claimed;result.run_id=scope.run_id;
    while(result.steps<OWNER_DRAFT_MAX_CALLS){
      time();const current=runtime();await generationAndAccounting(db);time();
      const provider:typeof providerCall=async(...args)=>{
        // A late transport completion is consumed but cannot settle or advance a timed-out checkpoint.
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{return await Promise.race([(options.provider||providerCall)(...args),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Provider outcome uncertain")),Math.min(60_000,options.providerTimeoutMs??60_000));})]);}
        finally{clearTimeout(timer);}
      };
      const outcome=await step(store,current,provider,true,{ownerClearedOnly:true,ownerDraft:{...scope,checkpoint:result.steps},beforeProvider:async()=>{
        time();runtime();
        await db.transaction(async tx=>{
          await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");
          const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[scope!.task_id]))[0];
          if(!task||task.status!=="running")throw Error("Owner draft execution stopped");
          await assertOwnerDraftScope(tx,task,{...scope!,checkpoint:result.steps});
          if((await tx.query("SELECT id FROM ledger WHERE status!='settled' AND NOT (task_id=$1 AND checkpoint=$2 AND status='reserved' AND pricing_anomaly=false) LIMIT 1",[scope!.task_id,result.steps])).length)throw Error("Owner draft accounting unresolved");
          const used=(await tx.query<{used:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END),0) AS used FROM ledger WHERE month=$1 OR status!='settled'",[istMonth()]))[0];
          if(!used||!Number.isSafeInteger(Number(used.used))||Number(used.used)>CAP-BUFFER)throw Error("Owner draft accounting unresolved");
        });
        time();runtime();
      }});
      if(outcome.status!=="step_saved")return await finish((await db.query("SELECT id FROM ledger WHERE task_id=$1 AND status!='settled'",[input.task_id])).length?"uncertain":"blocked");
      result.steps++;
    }
    return await finish("review");
  }catch{
    // A durable start with no durable finish is an uncertain attempt, never a retry invitation.
    try{return await finish(scope&&(await db.query("SELECT id FROM ledger WHERE task_id=$1 AND status!='settled'",[input.task_id])).length?"uncertain":"blocked");}catch{return {...result,status:scope?"uncertain":"blocked"};}
  }
}
