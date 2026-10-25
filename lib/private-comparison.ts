import {randomUUID} from 'node:crypto';
import type {Connection,Database} from './db';
import {CAP,BUFFER,ROLES,hash,istMonth,tokenCost,type RuntimeConfig,type Source,type Task,type Output} from './domain';
import {sourceAuthorized,draftSourceEligible} from './sources';
import {resolveScopedSource} from './github-source-policy';
import {scopedTaskMatches} from './scoped-source-proof';
import {assertArtifactPrivacy} from './artifact-privacy';
import {buildDraftPrompt} from './draft-prompt';
import {draftArtifactContract,providerResponseFormatBytes} from './critic-response-format';
import {noteStageIssue} from './note-fact-selection';
import {evidenceQuality} from './evidence-review';
import {editorialReview} from './editorial-review';
import {taskPlatformPolicy} from './platform-policy';
import {OWNER_WRITING_PROFILE} from './owner-writing-profile';
import {comparisonProvider,type ComparisonCompletion} from './private-comparison-provider';
import {COMPARISON_TARGET as target,COMPARISON_SCOPE,COMPARISON_SCOPE_HASH,COMPARISON_CAP,COMPARISON_INPUT_BOUNDS,COMPARISON_OUTPUT_CAP,COMPARISON_PRICING,validComparisonRequest,type ComparisonRequest} from './private-comparison-policy';

const START='private_comparison_started',STAGE='private_comparison_stage',END='private_comparison_finished';
type Options={readConfig:()=>RuntimeConfig;ready:()=>boolean;provider?:typeof comparisonProvider;signal?:AbortSignal};
const configHash=(c:RuntimeConfig)=>hash(JSON.stringify(c));
async function event(tx:Connection,kind:string,detail:unknown,id=randomUUID()) {await tx.query('INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)',[id,target.task_id,kind,JSON.stringify(detail)]);}
/** Read-only preview binds original artifacts too; never changes or resumes a task. */
export async function comparisonContext(tx:Connection,c:RuntimeConfig,lock=false){
 const task=(await tx.query<Task>('SELECT * FROM tasks WHERE id=$1'+(lock?' FOR UPDATE':''),[target.task_id]))[0];
 const source=await resolveScopedSource(tx,(await tx.query<Source>('SELECT * FROM sources WHERE id=$1'+(lock?' FOR UPDATE':''),[target.source_id]))[0]);
 const calendar=(await tx.query('SELECT * FROM calendar_entries WHERE id=$1'+(lock?' FOR UPDATE':''),[target.calendar_id]))[0];
 const original=await tx.query<Output>('SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id',[target.task_id]);
 if(!task||!['blocked','review'].includes(task.status)||task.checkpoint!==6||task.source_id!==target.source_id||task.source_hash!==target.source_hash||!source||!draftSourceEligible(source,target.source_hash)||!sourceAuthorized(c,source)||!scopedTaskMatches(source,task)||!calendar||calendar.task_id!==task.id||calendar.source_id!==source.id||original.length!==6||new Set(original.map(x=>x.role)).size!==6||!ROLES.every(role=>original.some(x=>x.role===role))||!taskPlatformPolicy(task))throw Error('Comparison target changed');
 assertArtifactPrivacy(JSON.stringify(task.content_brief||{}));
 for(const output of original){if(hash(output.text)!==output.hash)throw Error('Comparison artifact changed');assertArtifactPrivacy(output.text);}
 const state_hash=hash(JSON.stringify({task,source,calendar,original,config_hash:configHash(c),style_hash:OWNER_WRITING_PROFILE.hash,scope_hash:COMPARISON_SCOPE_HASH}));
 return {task,source,original,state_hash};
}
export async function comparisonSnapshot(db:Database,c:RuntimeConfig){
 const history=await db.query<{id:string;kind:string;detail:string}>('SELECT id,kind,detail FROM events WHERE task_id=$1 AND kind IN ($2,$3,$4,$5) ORDER BY created,id',[target.task_id,START,STAGE,END,'private_comparison_admitted']);
 let preview:{state_hash:string}|null=null;try{preview={state_hash:(await comparisonContext(db,c)).state_hash};}catch{}
 return {scope:COMPARISON_SCOPE,scope_hash:COMPARISON_SCOPE_HASH,preview,history:history.map(e=>({...e,detail:JSON.parse(e.detail)})),notice:'Private comparison only. Raw output is unchanged; factual and editorial holds remain. No approval or publication action exists here.'};
}
/** One reservation, one terminal attempt. Never inserts/updates tasks, outputs, approvals or Calendar. */
export async function runPrivateComparison(rawDb:Database,input:ComparisonRequest,options:Options){
 const transaction:Database['transaction']=work=>rawDb.transaction(async tx=>{await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");return work(tx);});
 const db:Database={kind:rawDb.kind,close:()=>rawDb.close(),transaction,query:(sql,params)=>transaction(tx=>tx.query(sql,params))};
 const result:{status:string;steps:number;run_id?:string}={status:'blocked',steps:0};
 if(!validComparisonRequest(input)||db.kind!=='postgres')return result;
 const initial=options.readConfig(),binding=configHash(initial),deadline=Date.now()+240_000;
 const runtime=()=>{const day=new Date().toISOString().slice(0,10);if(!options.ready()||options.signal?.aborted||Date.now()>=deadline||configHash(options.readConfig())!==binding||day<COMPARISON_SCOPE.pricing_verified||day>COMPARISON_SCOPE.pricing_expires)throw Error('Comparison gate closed');};
 let reservation:string|undefined,known=true,spent=0,inputs=0,outputs=0,pricingAnomaly=false,claimAttempted=false;
 const proposedRunId=randomUUID();
 const artifacts:Output[]=[];
 async function finish(status:string,assessment?:unknown){
  if(!reservation)return {...result,status};
  await db.transaction(async tx=>{
   if(status==='completed_requires_review')try{runtime();if((await comparisonContext(tx,options.readConfig(),true)).state_hash!==input.expected_state_hash)status='stale_state';}catch{status='stale_state';}
   await tx.query('SELECT id FROM ledger WHERE id=$1 FOR UPDATE',[reservation]);
   await tx.query("UPDATE ledger SET status=$2,estimated=$3,input_tokens=$4,output_tokens=$5,completion_status=$6,pricing_anomaly=$7 WHERE id=$1 AND status='reserved'",[reservation,known?'settled':'unknown',known?spent:null,known?inputs:null,known?outputs:null,status,pricingAnomaly]);
   await event(tx,END,{run_id:reservation,status,steps:result.steps,known_microdollars:spent,reservation_retained:!known,assessment});
  });return {...result,status};
 }
 try{
  runtime();
  claimAttempted=true;
  const claimed=await db.transaction(async tx=>{
   await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");
   await tx.query("INSERT INTO budget_months(month) VALUES('__combined_guard__') ON CONFLICT DO NOTHING");
   await tx.query("SELECT month FROM budget_months WHERE month='__combined_guard__' FOR UPDATE");
   if((await tx.query('SELECT id FROM events WHERE task_id=$1 AND kind=$2',[target.task_id,START])).length)return null;
   const current=await comparisonContext(tx,initial,true);if(current.state_hash!==input.expected_state_hash)throw Error('Comparison stale preview');
   const usage=(await tx.query<{used:string;unresolved:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END) FILTER (WHERE month=$1 OR status!='settled'),0) AS used,COUNT(*) FILTER (WHERE status!='settled' OR estimated IS NULL OR estimated<0) AS unresolved FROM ledger",[istMonth()]))[0];
   if(!usage||Number(usage.unresolved)!==0||!Number.isSafeInteger(Number(usage.used))||Number(usage.used)<0||Number(usage.used)+COMPARISON_CAP>CAP-BUFFER)throw Error('Comparison budget unavailable');
   runtime();const id=proposedRunId,month=istMonth();
   await tx.query('INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING',[month]);
   await tx.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status,requested_service_tier) VALUES($1,$2,$3,'openai',$4,$5,$6,'reserved','default')",[id,target.task_id,month,COMPARISON_PRICING.model,JSON.stringify(COMPARISON_PRICING),COMPARISON_CAP]);
   await event(tx,START,{run_id:id,scope:COMPARISON_SCOPE,scope_hash:COMPARISON_SCOPE_HASH,state_hash:current.state_hash,config_hash:binding,style:{version:OWNER_WRITING_PROFILE.version,hash:OWNER_WRITING_PROFILE.hash},deadline:new Date(deadline).toISOString(),original_hashes:current.original.map(x=>({role:x.role,hash:x.hash}))},id);
   return {id,...current};
  });
  if(!claimed)return {...result,status:'duplicate'};
  reservation=claimed.id;result.run_id=reservation;
  for(let checkpoint=0;checkpoint<6;checkpoint++){
   runtime();
   await db.transaction(async tx=>{const current=await comparisonContext(tx,options.readConfig(),true);if(current.state_hash!==input.expected_state_hash)throw Error('Comparison state changed');const row=(await tx.query<{status:string}>('SELECT status FROM ledger WHERE id=$1 FOR UPDATE',[reservation]))[0];if(row?.status!=='reserved'||(await tx.query("SELECT id FROM ledger WHERE id!=$1 AND status!='settled' LIMIT 1",[reservation])).length)throw Error('Comparison accounting changed');});
   const task={...claimed.task,checkpoint},prompt=buildDraftPrompt(task,claimed.source,artifacts),contract=draftArtifactContract(task,claimed.source,artifacts);
   const inputBound=Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',contract)+1024;
   if(inputBound>COMPARISON_INPUT_BOUNDS[checkpoint]||spent+tokenCost(COMPARISON_PRICING,inputBound,COMPARISON_OUTPUT_CAP)>COMPARISON_CAP)throw Error('Comparison input too large');
   await db.transaction(async tx=>{
    runtime();if((await comparisonContext(tx,options.readConfig(),true)).state_hash!==input.expected_state_hash)throw Error('Comparison state changed');
    await event(tx,'private_comparison_admitted',{run_id:reservation,checkpoint,role:ROLES[checkpoint],model:COMPARISON_PRICING.model,prompt_hash:hash(prompt),input_bound:inputBound,completion_cap:COMPARISON_OUTPUT_CAP,contract});
   });
   runtime();known=false;
   // Even an injected hanging transport cannot resume after the request deadline.
   let timer:ReturnType<typeof setTimeout>|undefined;let completion:ComparisonCompletion;
   try{completion=await Promise.race([(options.provider||comparisonProvider)(prompt,contract,options.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Comparison outcome uncertain')),35_000);})]);}finally{clearTimeout(timer);}
   // Preserve the original response before validation; no repairs or replacement copy.
   await event(db,STAGE,{run_id:reservation,checkpoint,role:ROLES[checkpoint],text:completion.text,hash:hash(completion.text),input:completion.input,output:completion.output,report:completion.report,raw:completion.raw});
   if(completion.report.model!==COMPARISON_PRICING.model||completion.report.tier!=='default'){pricingAnomaly=true;throw Error('Comparison billing mismatch');}
   const cost=tokenCost(COMPARISON_PRICING,completion.input,completion.output);spent+=cost;inputs+=completion.input;outputs+=completion.output;known=true;
   if(completion.input>inputBound||completion.output>COMPARISON_OUTPUT_CAP||spent>COMPARISON_CAP){known=false;pricingAnomaly=true;throw Error('Comparison pricing anomaly');}
   artifacts.push({id:randomUUID(),task_id:target.task_id,role:ROLES[checkpoint],text:completion.text,hash:hash(completion.text),created:new Date().toISOString()});result.steps++;
   runtime();const current=await comparisonContext(db,options.readConfig());if(current.state_hash!==input.expected_state_hash)throw Error('Comparison state changed');
   if(!completion.complete)return await finish('incomplete');
   assertArtifactPrivacy(completion.text);
   const issue=noteStageIssue(checkpoint,completion.text,claimed.source,artifacts);
   if(issue)return await finish('contract_failed',{issue});
   if(editorialReview(artifacts).blocking)return await finish('editorial_hold',editorialReview(artifacts));
  }
  const quality=evidenceQuality(artifacts,claimed.source,[],taskPlatformPolicy(claimed.task));
  return await finish('completed_requires_review',quality);
 }catch{
  // A lost COMMIT response is not proof that reservation/start did not commit.
  if(!reservation&&claimAttempted){
   try{if((await db.query('SELECT id FROM events WHERE id=$1 AND kind=$2',[proposedRunId,START])).length){reservation=proposedRunId;result.run_id=reservation;}}
   catch{return {...result,run_id:proposedRunId,status:'uncertain'};}
  }
  try{return await finish(known?'blocked':'uncertain');}catch{return {...result,status:reservation?'uncertain':'blocked'};}
 }
}
