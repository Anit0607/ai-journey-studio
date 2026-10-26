import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {hash} from '../lib/domain';
import {bundleVersion} from '../lib/grounding';
import {COMPARISON_PRICING,COMPARISON_TARGET} from '../lib/private-comparison-policy';
import * as productionScopes from '../lib/private-comparison-scopes';
const require=createRequire(import.meta.url),pinned='a92c37461e9d2b3d904ceb831cd498aebb7a9863a534865d94d56aac474dbf0a';
/** Isolated compiled module fixture only: no production grant changes, DB or provider. */
function modules(currentDigest:string,approved=false){
 const loaded:Record<string,any>={'./private-comparison-prompt-policy-manifest':{COMPARISON_PROMPT_POLICY_HASH:currentDigest}};
 function load(name:string):any{
  if(loaded[name])return loaded[name];
  if(!['./private-comparison-scopes','./private-comparison-record','./private-comparison-predecessor','./private-comparison'].includes(name))return require(name.startsWith('./')?'../lib/'+name.slice(2):name);
  let source=readFileSync(new URL('../lib/'+name.slice(2)+'.ts',import.meta.url),'utf8');
  if(name==='./private-comparison-scopes'){
   const before="Object.freeze({status:'approved',consent_reference:'Sentinel_5fe38455d5bc8191ad426a18b4a923a4',prompt_policy_hash:'"+pinned+"'})";
   assert.equal(source.split(before).length,2,'mock only the exact reviewed grant in isolated test code');
   source=source.replace(before,approved?"Object.freeze({status:'approved',consent_reference:'offline-test-only-not-live-consent',prompt_policy_hash:'"+pinned+"'})":"Object.freeze({status:'pending',consent_reference:null,prompt_policy_hash:'"+pinned+"'})");
  }
  const exports:Record<string,any>={};loaded[name]=exports;
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:load,Buffer,Date,setTimeout,clearTimeout});
  return exports;
 }
 return {scopes:load('./private-comparison-scopes'),record:()=>load('./private-comparison-record'),runtime:()=>load('./private-comparison')};
}
/** Synthetic successor records exercise verification only; no old output is rebound in storage. */
function completedFixture(scopes:any){
 const original=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-2026-10-25.json',import.meta.url),'utf8')) as any[];
 const id='11111111-1111-4111-8111-111111111111';
 const successor=original.map((row,index)=>{
  const detail=JSON.parse(row.detail);detail.run_id=id;
  if(row.kind==='private_comparison_started'){detail.scope=scopes.CORRECTED_COMPARISON_SCOPE;detail.scope_hash=scopes.CORRECTED_COMPARISON_SCOPE_HASH;}
  if(row.kind==='private_comparison_admitted')detail.prompt_policy_hash=pinned;
  if(row.kind==='private_comparison_finished')detail.status='completed_requires_review';
  return {...row,id:row.kind==='private_comparison_started'?id:'successor-event-'+index,detail:JSON.stringify(detail)};
 });
 const stages=original.filter(row=>row.kind==='private_comparison_stage').map(row=>JSON.parse(row.detail));
 const prior={id:scopes.COMPARISON_PREDECESSOR.run_id,task_id:COMPARISON_TARGET.task_id,provider:'openai',model:COMPARISON_PRICING.model,pricing:COMPARISON_PRICING,status:'settled',completion_status:'blocked',reserved:850000,estimated:85324,input_tokens:stages.reduce((n,s)=>n+s.input,0),output_tokens:stages.reduce((n,s)=>n+s.output,0),role:null,checkpoint:null,requested_service_tier:'default',pricing_anomaly:false};
 return {id,events:[...original,...successor],ledger:[prior,{...prior,id,reserved:764676,completion_status:'completed_requires_review'}]};
}
test('isolated pending permission remains unexecutable and cannot validate corrected history',async()=>{
 const {scopes,record,runtime}=modules(hash('later prompt code')),policy=scopes.comparisonPolicy(scopes.CORRECTED_COMPARISON_SCOPE_HASH),f=completedFixture(scopes);
 assert.equal(productionScopes.CORRECTED_COMPARISON_AUTHORIZATION.status,'approved');assert.equal(productionScopes.CORRECTED_COMPARISON_AUTHORIZATION.consent_reference,'Sentinel_5fe38455d5bc8191ad426a18b4a923a4');
 assert.equal(scopes.comparisonPolicyRecordedPermission(policy),false);assert.equal(scopes.comparisonPolicyAuthorized(policy,pinned),false);
 assert.throws(()=>record().verifiedComparisonRun(f.events,f.ledger,f.id));
 let calls=0;const unavailable=()=>{calls++;throw Error('must remain offline');};
 const result=await runtime().runPrivateComparison({kind:'postgres',query:unavailable,transaction:unavailable,close:unavailable},{scope_hash:policy.hash,expected_state_hash:hash('state'),acknowledged:true},{readConfig:unavailable,ready:()=>true,provider:unavailable});
 assert.equal(result.status,'blocked');assert.equal(calls,0);
});
test('mock-approved immutable historical scope survives current policy drift but cannot execute or retry',async()=>{
 const before=modules(pinned,true),after=modules(hash('later prompt code'),true),oldPolicy=before.scopes.comparisonPolicy(before.scopes.CORRECTED_COMPARISON_SCOPE_HASH),policy=after.scopes.comparisonPolicy(after.scopes.CORRECTED_COMPARISON_SCOPE_HASH),f=completedFixture(before.scopes);
 assert.equal(before.scopes.comparisonPolicyAuthorized(oldPolicy,pinned),true);
 assert.equal(policy.hash,oldPolicy.hash);assert.equal(JSON.stringify(policy.scope),JSON.stringify(oldPolicy.scope));
 assert.equal(after.scopes.currentComparisonPromptPolicyHash(),hash('later prompt code'));assert.equal(policy.scope.prompt_policy_hash,pinned);
 assert.equal(after.scopes.comparisonPolicyRecordedPermission(policy),true);assert.equal(after.scopes.comparisonPolicyAuthorized(policy,after.scopes.currentComparisonPromptPolicyHash()),false);
 const record=after.record().verifiedComparisonRun(f.events,f.ledger,f.id);assert.equal(record.policy.hash,policy.hash);assert.equal(record.stages.length,6);
 const revision={id:'offline-revision',base_token:'original:'+hash('original'),bundle:record.bundle,version:bundleVersion(record.bundle,COMPARISON_TARGET.source_hash),agent_task_id:null,created:'2026-10-25T19:00:00Z'};
 const receipt={schema:1,task_id:COMPARISON_TARGET.task_id,source_id:COMPARISON_TARGET.source_id,source_hash:COMPARISON_TARGET.source_hash,revision_id:revision.id,run_id:f.id,scope_hash:policy.hash,model:COMPARISON_PRICING.model,base_token:revision.base_token,version:revision.version,state_hash:record.start.data.state_hash,finished_event_id:record.end.id,stages:record.stages.map(({event_id,checkpoint,role,hash}:any)=>({event_id,checkpoint,role,hash}))};
 const origin=after.record().comparisonRevisionOrigin({id:COMPARISON_TARGET.task_id,source_id:COMPARISON_TARGET.source_id,source_hash:COMPARISON_TARGET.source_hash},revision,[...f.events,{task_id:COMPARISON_TARGET.task_id,kind:'private_comparison_adopted',detail:JSON.stringify(receipt)}],f.ledger);assert.equal(origin.kind,'private_comparison');assert.equal(origin.run_id,f.id);
 assert.throws(()=>after.record().verifiedComparisonRun(f.events,f.ledger,after.scopes.COMPARISON_PREDECESSOR.run_id));
 assert.equal(after.scopes.comparisonPolicy(hash('third attempt')),null);
 let calls=0;const unavailable=()=>{calls++;throw Error('must not call');};const run=()=>after.runtime().runPrivateComparison({kind:'postgres',query:unavailable,transaction:unavailable,close:unavailable},{scope_hash:policy.hash,expected_state_hash:hash('state'),acknowledged:true},{readConfig:unavailable,ready:()=>true,provider:unavailable});
 assert.equal((await run()).status,'blocked');assert.equal((await run()).status,'blocked');assert.equal(calls,0);
});
