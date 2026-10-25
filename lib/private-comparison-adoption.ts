import {randomUUID} from 'node:crypto';
import type {Database} from './db';
import type {RuntimeConfig} from './domain';
import {Store} from './store';
import {lockPublicationGuards} from './calendar-publication-binding';
import {assertNoPendingAgentRevision} from './agent-revisions';
import {assertArtifactPrivacy} from './artifact-privacy';
import {bundleVersion} from './grounding';
import {reviewReadiness} from './evidence-review';
import {comparisonContext} from './private-comparison';
import {COMPARISON_TARGET,COMPARISON_PRICING} from './private-comparison-policy';
import {COMPARISON_ADOPTED,comparisonEventDetail,comparisonRevisionOrigin,verifiedComparisonRun} from './private-comparison-record';

import {comparisonPolicy} from './private-comparison-scopes';

type AdoptionRequest={run_id:string;task_id:string;scope_hash:string;expected_review_token:string};
export function validComparisonAdoption(value:unknown):value is AdoptionRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as AdoptionRequest;
 return Object.keys(v).sort().join('|')==='expected_review_token|run_id|scope_hash|task_id'&&v.task_id===COMPARISON_TARGET.task_id&&!!comparisonPolicy(v.scope_hash)&&typeof v.run_id==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.run_id)&&typeof v.expected_review_token==='string'&&/^(?:original:[a-f0-9]{64}|revision:[a-f0-9-]{36}:[a-f0-9]{64})$/.test(v.expected_review_token);
}
/** No provider/approval/publication writes. Task lock serializes all revision and approval paths. */
export async function adoptPrivateComparison(db:Database,input:AdoptionRequest,config:RuntimeConfig){
 if(!validComparisonAdoption(input))throw Error('Exact comparison and review binding required');
 return db.transaction(async tx=>{
  await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");
  // Match the existing Calendar/publication lock order before taking the task lock.
  await lockPublicationGuards(tx,true);
  await tx.query('SELECT id FROM calendar_entries WHERE id=$1 FOR UPDATE',[COMPARISON_TARGET.calendar_id]);
  const current=await comparisonContext(tx,config,true,input.scope_hash);
  if(current.task.revision_parent_task_id||current.task.status!=='review')throw Error('Comparison task is not reviewable');
  const events=await tx.query('SELECT * FROM events WHERE task_id=$1 ORDER BY created,id',[input.task_id]);
  const ledger=await tx.query('SELECT * FROM ledger WHERE task_id=$1 ORDER BY id FOR UPDATE',[input.task_id]);
  const run=verifiedComparisonRun(events,ledger,input.run_id);
  if(run.policy.hash!==input.scope_hash)throw Error('Comparison scope does not match saved run');
  if(run.start.data!.state_hash!==current.state_hash)throw Error('Comparison source, task or runtime changed');
  if(JSON.stringify(run.start.data!.original_hashes)!==JSON.stringify(current.original.map(({role,hash})=>({role,hash}))))throw Error('Original artifacts changed');
  const receipts=events.filter(e=>e.kind===COMPARISON_ADOPTED&&comparisonEventDetail(e)?.run_id===input.run_id);
  if(receipts.length){
   const receipt=comparisonEventDetail(receipts[0])!;
   const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1 AND task_id=$2',[receipt.revision_id,input.task_id]))[0];
   if(receipts.length!==1||receipt.base_token!==input.expected_review_token||!revision||comparisonRevisionOrigin(current.task,revision,events,ledger)?.kind!=='private_comparison')throw Error('Comparison adoption receipt does not match');
   // A replay reports the saved revision; it never replaces a newer revision.
   return {status:'already_adopted',revision_id:revision.id,review_token:'revision:'+revision.id+':'+revision.version};
  }
  const store=new Store(db),context=await store.revisionContext(tx,input.task_id,input.expected_review_token);
  await assertNoPendingAgentRevision(tx,input.task_id);
  // Do not supersede a publication job, even if it was created by another owner action.
  if((await tx.query('SELECT id FROM publishing_outbox WHERE task_id=$1 LIMIT 1',[input.task_id])).length)throw Error('Comparison task has publication history; review it separately');
  for(const artifact of run.bundle)assertArtifactPrivacy(artifact.text);
  const id=randomUUID(),version=bundleVersion(run.bundle,context.source.hash);
  const readiness=await reviewReadiness(tx,input.task_id,run.bundle,context.source,'revision:'+id+':'+version);
  await tx.query('INSERT INTO content_revisions(id,task_id,parent_id,base_token,version,bundle,request_note,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,input.task_id,context.latest?.id||null,context.token,version,JSON.stringify(run.bundle),'Private model comparison output — '+COMPARISON_PRICING.model+'; unchanged six-stage bundle for fresh factual and editorial review.',(context.latest?.sequence||0)+1]);
  await store.event(tx,input.task_id,COMPARISON_ADOPTED,JSON.stringify({schema:1,task_id:input.task_id,run_id:input.run_id,revision_id:id,version,base_token:context.token,source_id:context.source.id,source_hash:context.source.hash,scope_hash:input.scope_hash,model:COMPARISON_PRICING.model,state_hash:current.state_hash,finished_event_id:run.end.id,stages:run.stages.map(({event_id,checkpoint,role,hash})=>({event_id,checkpoint,role,hash}))}));
  return {status:'adopted_requires_review',revision_id:id,review_token:'revision:'+id+':'+version,readiness};
 });
}
