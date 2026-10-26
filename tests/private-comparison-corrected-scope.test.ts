import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../lib/domain';
import {COMPARISON_SCOPE_HASH,COMPARISON_SCOPE,COMPARISON_PRICING,COMPARISON_TARGET} from '../lib/private-comparison-policy';
import {comparisonPolicy,comparisonPolicyAuthorized,CORRECTED_COMPARISON_SCOPE_HASH,CORRECTED_COMPARISON_SCOPE,CORRECTED_COMPARISON_CAP,COMPARISON_PREDECESSOR,currentComparisonPromptPolicyHash,validScopedComparisonRequest} from '../lib/private-comparison-scopes';
import {assertCorrectiveComparisonFamily} from '../lib/private-comparison-predecessor';
import {verifiedComparisonRun} from '../lib/private-comparison-record';
import {runPrivateComparison} from '../lib/private-comparison';
const captured=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-2026-10-25.json',import.meta.url),'utf8'));
const eventData=(row:any)=>JSON.parse(row.detail),clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function fixture(){const events=clone(captured),stages=events.filter((e:any)=>e.kind==='private_comparison_stage').map(eventData);const row:Record<string,any>={id:COMPARISON_PREDECESSOR.run_id,task_id:COMPARISON_TARGET.task_id,provider:'openai',model:COMPARISON_PRICING.model,pricing:COMPARISON_PRICING,status:'settled',completion_status:'blocked',reserved:850000,estimated:85324,input_tokens:stages.reduce((n:number,s:any)=>n+s.input,0),output_tokens:stages.reduce((n:number,s:any)=>n+s.output,0),role:null,checkpoint:null,requested_service_tier:'default',pricing_anomaly:false};return {events,ledger:[row]};}
const edit=(events:any[],kind:string,work:(d:any)=>void)=>{const e=events.find(e=>e.kind===kind),d=eventData(e);work(d);e.detail=JSON.stringify(d);};
test('registry preserves the original and binds exactly one owner-approved corrective candidate',()=>{
 assert.equal(COMPARISON_SCOPE_HASH,'ed2bf1903a48644cccff06e8c4ae24cd1716c30a969229cdf5a16723be27a0ce');assert.equal(hash(JSON.stringify(COMPARISON_SCOPE)),COMPARISON_SCOPE_HASH);
 assert(comparisonPolicy(COMPARISON_SCOPE_HASH));assert(comparisonPolicy(CORRECTED_COMPARISON_SCOPE_HASH));assert.equal(comparisonPolicy(hash('third attempt')),null);
 assert.equal(CORRECTED_COMPARISON_SCOPE.consent_reference,'Sentinel_5fe38455d5bc8191ad426a18b4a923a4');assert.equal(CORRECTED_COMPARISON_SCOPE.permission_status,'approved');assert.equal(CORRECTED_COMPARISON_SCOPE.prompt_policy_hash,'a92c37461e9d2b3d904ceb831cd498aebb7a9863a534865d94d56aac474dbf0a');assert.match(currentComparisonPromptPolicyHash(),/^[a-f0-9]{64}$/);assert(comparisonPolicyAuthorized(comparisonPolicy(CORRECTED_COMPARISON_SCOPE_HASH)!,currentComparisonPromptPolicyHash()));
 assert(!comparisonPolicyAuthorized(comparisonPolicy(CORRECTED_COMPARISON_SCOPE_HASH)!,hash('unapproved policy')));
 assert.equal(CORRECTED_COMPARISON_CAP+COMPARISON_PREDECESSOR.spent_microdollars,850000);assert.equal(CORRECTED_COMPARISON_SCOPE.plan.reduce((n,p)=>n+p.maximum_microdollars,0),740760);
 assert(!validScopedComparisonRequest({expected_state_hash:hash('state'),scope_hash:hash('third'),acknowledged:true}));
 assert(!validScopedComparisonRequest({expected_state_hash:hash('state'),scope_hash:CORRECTED_COMPARISON_SCOPE_HASH,acknowledged:true,cap:999999}));
});
test('exact captured predecessor proves six untouched stages and precise remaining cap, never adoption',()=>{
 const {events,ledger}=fixture();assert.deepEqual(assertCorrectiveComparisonFamily(events,ledger),{spent_microdollars:85324,remaining_microdollars:764676});
 assert.throws(()=>verifiedComparisonRun(events,ledger,COMPARISON_PREDECESSOR.run_id));
});
for(const [name,change] of [
 ['wrong prior state',(x:any)=>edit(x.events,'private_comparison_started',d=>d.state_hash=hash('wrong'))],
 ['wrong prior config',(x:any)=>edit(x.events,'private_comparison_started',d=>d.config_hash=hash('wrong'))],
 ['wrong prior scope',(x:any)=>edit(x.events,'private_comparison_started',d=>d.scope_hash=hash('wrong'))],
 ['wrong source',(x:any)=>edit(x.events,'private_comparison_started',d=>d.scope.target.source_hash=hash('wrong'))],
 ['wrong terminal state',(x:any)=>edit(x.events,'private_comparison_finished',d=>d.status='completed_requires_review')],
 ['wrong terminal id',(x:any)=>{x.events.find((e:any)=>e.kind==='private_comparison_finished').id='different';}],
 ['wrong cost',(x:any)=>{x.ledger[0].estimated=85323;}],
 ['unresolved',(x:any)=>{x.ledger[0].status='unknown';}],
 ['retained reservation',(x:any)=>edit(x.events,'private_comparison_finished',d=>d.reservation_retained=true)],
 ['wrong stage hash',(x:any)=>edit(x.events,'private_comparison_stage',d=>d.hash=hash('edited'))],
 ['edited raw bytes',(x:any)=>edit(x.events,'private_comparison_stage',d=>d.text+=' edited')],
 ['pricing anomaly',(x:any)=>{x.ledger[0].pricing_anomaly=true;}],
 ['another unresolved row',(x:any)=>{x.ledger.push({...x.ledger[0],id:'other',status:'reserved'});}],
 ['extra unrecognized START',(x:any)=>{x.events.push({...x.events[0],id:'third',detail:JSON.stringify({...eventData(x.events[0]),run_id:'third',scope_hash:hash('third')})});}],
 ['duplicate original START',(x:any)=>{x.events.push(clone(x.events[0]));}]
] as const)test('corrective admission rejects '+name,()=>{const x=fixture();change(x);assert.throws(()=>assertCorrectiveComparisonFamily(x.events,x.ledger));});
test('one successor proof cannot be replayed into a third attempt or exceed family cap',()=>{
 const x=fixture(),id='11111111-1111-4111-8111-111111111111';x.events.push({id,task_id:COMPARISON_TARGET.task_id,kind:'private_comparison_started',detail:JSON.stringify({run_id:id,scope_hash:CORRECTED_COMPARISON_SCOPE_HASH,scope:CORRECTED_COMPARISON_SCOPE})});
 x.ledger.push({...x.ledger[0],id,status:'reserved',reserved:CORRECTED_COMPARISON_CAP});assert.doesNotThrow(()=>assertCorrectiveComparisonFamily(x.events,x.ledger,id));assert.throws(()=>assertCorrectiveComparisonFamily(x.events,x.ledger));
 x.ledger[1].reserved++;assert.throws(()=>assertCorrectiveComparisonFamily(x.events,x.ledger,id));
});
test('old pending-scope requests remain invalid before database or provider use',async()=>{
 let calls=0;const unavailable=()=>{calls++;throw Error('must not call');};const db={kind:'postgres',close:async()=>{},query:unavailable,transaction:unavailable} as any;
 assert.deepEqual(await runPrivateComparison(db,{expected_state_hash:hash('state'),scope_hash:hash(JSON.stringify({...CORRECTED_COMPARISON_SCOPE,consent_reference:null,permission_status:'pending'})),acknowledged:true},{readConfig:unavailable,ready:()=>true,provider:unavailable}),{status:'blocked',steps:0});assert.equal(calls,0);
});
