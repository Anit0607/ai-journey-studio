import {HOSTED_SCAN_EXHAUSTED} from "./hosted-calendar-policy";
import {randomUUID} from "node:crypto";
import {Calendar} from "./calendar";
import {CAP,BUFFER,configReady,istMonth,type RuntimeConfig} from "./domain";
import {liveReady,providerCall} from "./providers";
import type {Store} from "./store";
import {step as workflowStep} from "./workflow";

export const HOSTED_MAX_STEPS=12;
export const HOSTED_RUN_BUDGET_MS=240_000;
export const HOSTED_STEP_HEADROOM_MS=80_000;
// Longer than the platform's 300-second hard limit. Never extended by a heartbeat.
export const HOSTED_LEASE_MS=360_000;
type BatchStatus="idle"|"blocked"|"deadline"|"max_steps"|"failed"|"interrupted";
type Reason="postgres_required"|"runtime_not_ready"|"generation_disabled"|"unresolved_accounting"|"budget_exhausted"|"daily_already_attempted"|"another_batch_running"|"stale_batch"|"lease_lost"|"cancelled"|"checkpoint_blocked"|"scoped_scan_exhausted"|"runtime_failure"|"run_budget"|"step_limit";
export type HostedBatchResult={status:BatchStatus|"duplicate";day:string;steps:number;reason?:Reason};
type StepResult={status:string;task?:string;reason?:string};
export type HostedBatchOptions={
  /** The route supplies its full hosted-readiness gate. Defaults to the stricter local live gate. */
  isReady?:(config:RuntimeConfig,now:Date)=>boolean|Promise<boolean>;
  /** Reload reviewed configuration before every checkpoint; no config is cached across calls. */
  readConfig?:()=>RuntimeConfig|Promise<RuntimeConfig>;
  /** Test seam: production always uses the wall clock and monotonic elapsed time. */
  now?:()=>Date;
  step?:(store:Store,config:RuntimeConfig)=>Promise<StepResult>;
  provider?:typeof providerCall;
  refill?:(now:Date)=>Promise<unknown>;
  dispatch?:(config:RuntimeConfig,enabled:boolean,now:Date)=>Promise<unknown>;
  /** Stops subsequent checkpoints; never abandons a possibly billable in-flight completion. */
  signal?:AbortSignal;
};
type Lease={lease_token:string|null;batch_day:string|null;lease_until:Date|null};
type Batch={status:string;steps:number};

/** One bounded, durable attempt per UTC day; no chaining, retries, timer scheduling or self-pings. */
export async function runHostedBatch(store:Store,config:RuntimeConfig,options:HostedBatchOptions={}):Promise<HostedBatchResult>{
  const clock=options.now||(()=>new Date()),start=clock(),startedMonotonic=performance.now();
  if(!Number.isFinite(start.getTime()))throw Error("Invalid batch time");
  const day=start.toISOString().slice(0,10),token=randomUUID();
  let steps=0,attempts=0,acquired=false,elapsed=0;
  const result=(status:HostedBatchResult["status"],reason?:Reason):HostedBatchResult=>({status,day,steps,...(reason?{reason}:{})});
  const time=()=>{const date=clock();if(!Number.isFinite(date.getTime()))throw Error("Invalid batch time");elapsed=Math.max(elapsed,date.getTime()-start.getTime(),performance.now()-startedMonotonic);return date;};
  const enoughTime=()=>elapsed<=HOSTED_RUN_BUDGET_MS-HOSTED_STEP_HEADROOM_MS;
  const read=options.readConfig||(()=>config),ready=options.isReady||((current:RuntimeConfig)=>liveReady(current));
  const currentReady=async(current:RuntimeConfig,date:Date)=>current.owner_cleared_sources_authorized===true&&(current.fallback_authorized===undefined||current.fallback_authorized===false)&&configReady(current,date)&&await ready(current,date);
  if(store.db.kind!=="postgres")return result("blocked","postgres_required");

  // Every ownership mutation locks the singleton first. Provider awaits are always outside transactions.
  async function touch(date:Date){
    return store.db.transaction(async tx=>{
      const lease=(await tx.query<Lease>("SELECT * FROM hosted_batch_lease WHERE id=1 FOR UPDATE"))[0];
      if(lease?.lease_token!==token||!lease.lease_until||new Date(lease.lease_until).getTime()<=date.getTime())return false;
      const updated=await tx.query("UPDATE hosted_batches SET heartbeat=$3,attempts=$4,steps=$5 WHERE day=$1 AND lease_token=$2 AND status='running' RETURNING day",[day,token,date,attempts,steps]);
      return updated.length===1;
    });
  }
  async function finish(status:BatchStatus,reason?:Reason):Promise<HostedBatchResult>{
    const date=time();
    const owned=await store.db.transaction(async tx=>{
      const lease=(await tx.query<Lease>("SELECT * FROM hosted_batch_lease WHERE id=1 FOR UPDATE"))[0];
      if(lease?.lease_token!==token)return false;
      // A timed-out owner can release only its own token, never a successor's lease or record.
      if(!lease.lease_until||new Date(lease.lease_until).getTime()<=date.getTime()){status="interrupted";reason="lease_lost";}
      await tx.query("UPDATE hosted_batches SET status=$3,reason=$4,steps=$5,attempts=$6,heartbeat=$7,finished_at=$7 WHERE day=$1 AND lease_token=$2 AND status='running'",[day,token,status,reason||null,steps,attempts,date]);
      await tx.query("UPDATE hosted_batch_lease SET lease_token=NULL,batch_day=NULL,lease_until=NULL WHERE id=1 AND lease_token=$1",[token]);
      return true;
    });
    return owned?result(status,reason):result("interrupted","lease_lost");
  }
  async function persistedGate(date:Date):Promise<Reason|undefined>{
    const settings=(await store.db.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings WHERE id=1"))[0];
    if(settings?.generation_enabled!==true)return "generation_disabled";
    const accounting=(await store.db.query<{used:string;unresolved:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END) FILTER (WHERE month=$1 OR status!='settled'),0) AS used,COUNT(*) FILTER (WHERE status!='settled') AS unresolved FROM ledger",[istMonth(date)]))[0];
    if(!accounting||!Number.isSafeInteger(Number(accounting.unresolved))||Number(accounting.unresolved)!==0)return "unresolved_accounting";
    const used=Number(accounting.used);
    if(!Number.isSafeInteger(used)||used<0||used>=CAP-BUFFER)return "budget_exhausted";
  }

  try{
    let current=await read();
    if(!await currentReady(current,time()))return result("blocked","runtime_not_ready");
    const acquisition=await store.db.transaction(async tx=>{
      const lease=(await tx.query<Lease>("SELECT * FROM hosted_batch_lease WHERE id=1 FOR UPDATE"))[0];
      if(!lease)throw Error("Batch lease schema unavailable");
      const date=time();
      if(lease.lease_token&&lease.lease_until&&new Date(lease.lease_until).getTime()<=date.getTime()){
        await tx.query("UPDATE hosted_batches SET status='interrupted',reason='stale_batch',heartbeat=$3,finished_at=$3 WHERE day=$1 AND lease_token=$2 AND status='running'",[lease.batch_day,lease.lease_token,date]);
        await tx.query("UPDATE hosted_batch_lease SET lease_token=NULL,batch_day=NULL,lease_until=NULL WHERE id=1 AND lease_token=$1",[lease.lease_token]);
        lease.lease_token=null;
      }
      const existing=(await tx.query<Batch>("SELECT status,steps FROM hosted_batches WHERE day=$1",[day]))[0];
      if(existing)return {kind:"duplicate" as const,steps:existing.steps};
      if(lease.lease_token){
        await tx.query("INSERT INTO hosted_batches(day,lease_token,status,reason,started_at,heartbeat,finished_at) VALUES($1,$2,'blocked','another_batch_running',$3,$3,$3)",[day,token,date]);
        return {kind:"busy" as const};
      }
      await tx.query("INSERT INTO hosted_batches(day,lease_token,status,started_at,heartbeat) VALUES($1,$2,'running',$3,$3)",[day,token,date]);
      await tx.query("UPDATE hosted_batch_lease SET lease_token=$1,batch_day=$2,lease_until=$3 WHERE id=1",[token,day,new Date(date.getTime()+HOSTED_LEASE_MS)]);
      return {kind:"acquired" as const};
    });
    if(acquisition.kind==="duplicate"){steps=acquisition.steps;return result("duplicate","daily_already_attempted");}
    if(acquisition.kind==="busy")return result("blocked","another_batch_running");
    acquired=true;
    if(options.signal?.aborted)return await finish("blocked","cancelled");
    let date=time();
    if(!enoughTime())return await finish("deadline","run_budget");
    let gate=await persistedGate(date);
    if(gate)return await finish("blocked",gate);
    // Refill owns a separate settings-first transaction after runtime/accounting gates.
    await (options.refill||((now)=>new Calendar(store.db,120).refillHorizon(now)))(date);
    // Dispatch is idempotent and queues only; it never invokes a provider or reserves spending.
    await (options.dispatch||((c,enabled,now)=>new Calendar(store.db,120).dispatchDue(c,enabled,now,{hostedScopedOnly:true})))(current,true,date);
    while(attempts<HOSTED_MAX_STEPS){
      if(options.signal?.aborted)return await finish("blocked","cancelled");
      current=await read();date=time();
      if(!await currentReady(current,date))return await finish("blocked","runtime_not_ready");
      gate=await persistedGate(date);
      if(gate)return await finish("blocked",gate);
      date=time();
      if(!enoughTime())return await finish("deadline","run_budget");
      // Persist the attempt before invoking the checkpoint: hard termination is never replayed today.
      attempts++;
      if(!await touch(date))return await finish("interrupted","lease_lost");
      // Recheck elapsed time after the ownership transaction as connection acquisition can be slow.
      date=time();
      if(!enoughTime())return await finish("deadline","run_budget");
      if(!configReady(current,date)||!await ready(current,date))return await finish("blocked","runtime_not_ready");
      time();
      if(!enoughTime())return await finish("deadline","run_budget");
      if(options.signal?.aborted)return await finish("blocked","cancelled");
      const outcome=await (options.step||((s,c)=>workflowStep(s,c,options.provider||providerCall,true,{hostedScopedCalendar:true,ownerClearedOnly:true,minimumGenerationLeadHours:120})))(store,current);
      if(outcome.status==="step_saved")steps++;
      if(!await touch(time()))return await finish("interrupted","lease_lost");
      if(outcome.task){
        const task=(await store.db.query<{status:string}>("SELECT status FROM tasks WHERE id=$1",[outcome.task]))[0];
        if(task?.status==="cancelled")return await finish("blocked","cancelled");
      }
      if(outcome.status==="idle")return await finish("idle");
      if(outcome.status!=="step_saved")return await finish("blocked",outcome.reason===HOSTED_SCAN_EXHAUSTED?"scoped_scan_exhausted":"checkpoint_blocked");
    }
    return await finish("max_steps","step_limit");
  }catch{
    // Never persist or expose provider errors, source text, prompts, credentials or untrusted reasons.
    // Existing workflow reservations remain untouched; SQL failure leaves a stale lease for recovery.
    if(acquired){try{return await finish("failed","runtime_failure");}catch{/* Fail closed; same-day row/lease remain durable. */}}
    return result("failed","runtime_failure");
  }
}
