import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {hash,ROLES,tokenCost,istMonth,type Task} from '../lib/domain';
import {privateComparisonCosts} from '../lib/private-comparison-costs';
import {agentContributions} from '../lib/agent-contributions';
import {COMPARISON_TARGET as target,COMPARISON_PRICING} from '../lib/private-comparison-policy';
import {COMPARISON_PREDECESSOR as prior,CORRECTED_COMPARISON_SCOPE,CORRECTED_COMPARISON_SCOPE_HASH,CORRECTED_COMPARISON_CAP} from '../lib/private-comparison-scopes';
import {verifiedComparisonRun,COMPARISON_ADOPTED} from '../lib/private-comparison-record';
import {bundleVersion} from '../lib/grounding';
import {usageSummary} from '../lib/usage';
import {OwnerReports} from '../lib/owner-reports';
import {embedded} from '../lib/db';

const successor='11111111-1111-4111-8111-111111111111',costs=[9865,10053,13050,14255,15445,30528];
// Deliberately synthetic token pairs/prose reproduce the requested rounded-cost regression amounts.
const tokens=[[3546,100],[3621,100],[4820,100],[5302,100],[5778,100],[11811,100]];
function fixture(){
 const original=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-2026-10-25.json',import.meta.url),'utf8')) as any[];
 const corrected=original.map(row=>{
  const detail=JSON.parse(row.detail);detail.run_id=successor;
  if(row.kind==='private_comparison_started'){detail.scope=CORRECTED_COMPARISON_SCOPE;detail.scope_hash=CORRECTED_COMPARISON_SCOPE_HASH;}
  if(row.kind==='private_comparison_admitted')detail.prompt_policy_hash=CORRECTED_COMPARISON_SCOPE.prompt_policy_hash;
  if(row.kind==='private_comparison_stage'){
   detail.text='Synthetic cost-only fixture: '+detail.role;detail.hash=hash(detail.text);[detail.input,detail.output]=tokens[detail.checkpoint];
   detail.raw.choices[0].message.content=detail.text;detail.raw.usage={prompt_tokens:detail.input,completion_tokens:detail.output,total_tokens:detail.input+detail.output};
  }
  if(row.kind==='private_comparison_finished'){detail.status='completed_requires_review';detail.known_microdollars=93196;}
  return {...row,id:row.kind==='private_comparison_started'?successor:randomUUID(),detail:JSON.stringify(detail)};
 });
 const ledger=[original,corrected].map((events,index)=>{
  const stages=events.filter(e=>e.kind==='private_comparison_stage').map(e=>JSON.parse(e.detail));
  return {id:index?successor:prior.run_id,task_id:target.task_id,month:istMonth(),provider:'openai',model:COMPARISON_PRICING.model,pricing:COMPARISON_PRICING,status:'settled',completion_status:index?'completed_requires_review':'blocked',reserved:index?CORRECTED_COMPARISON_CAP:850000,estimated:stages.reduce((n,s)=>n+tokenCost(COMPARISON_PRICING,s.input,s.output),0),input_tokens:stages.reduce((n,s)=>n+s.input,0),output_tokens:stages.reduce((n,s)=>n+s.output,0),role:null,checkpoint:null,requested_service_tier:'default',pricing_anomaly:false};
 });
 return {events:[...original,...corrected],ledger};
}
const project=(f:ReturnType<typeof fixture>)=>privateComparisonCosts(target.task_id,f.events,f.ledger)!;
const alter=(f:ReturnType<typeof fixture>,kind:string,change:(d:any)=>void)=>{const e=f.events.find(e=>e.kind===kind&&JSON.parse(e.detail).run_id===successor)!,d=JSON.parse(e.detail);change(d);e.detail=JSON.stringify(d);};

test('twelve verified stage responses disaggregate two existing ledger records, with 178520 counted once',async()=>{
 const f=fixture(),before=JSON.stringify(f),usage=usageSummary(f.ledger),r=project(f);
 assert.equal(r.aggregate_ledger_records,2);assert.equal(r.verified_stage_responses,12);assert.equal(r.estimated_microdollars,178520);assert.equal(r.known_verified_estimate_microdollars,178520);
 assert.deepEqual(r.runs[1].stages.map(s=>s.estimated_microdollars),costs);assert.equal(r.runs[1].estimated_microdollars,93196);assert.equal(r.runs[0].estimated_microdollars,85324);assert.equal(r.runs[0].status,'blocked');assert(r.runs.every(r=>r.spending_history_only));
 assert.equal(usage.lifetime_total.calls,2);assert.equal(usage.lifetime_total.estimated_microdollars,178520);assert.deepEqual(usageSummary(f.ledger),usage);
 const db=await embedded();try{const reports=new OwnerReports(db),beforeReport=await reports.snapshot(f.ledger);project(f);assert.deepEqual(await reports.snapshot(f.ledger),beforeReport);assert.equal(beforeReport.finances.find(row=>row.period===istMonth()&&row.currency==='USD')!.ai_estimated_microdollars,178520);}finally{await db.close();}
 assert.equal(JSON.stringify(f),before);assert.throws(()=>verifiedComparisonRun(f.events,f.ledger,prior.run_id));
});

test('manual edits and current comparison provenance never borrow original mini-run costs',()=>{
 const f=fixture(),run=verifiedComparisonRun(f.events,f.ledger,successor),task={id:target.task_id,source_id:target.source_id,source_hash:target.source_hash,status:'review',checkpoint:6} as Task;
 const outputs=ROLES.map(role=>({task_id:task.id,role,text:'Original mini '+role,hash:hash('Original mini '+role)}));
 const mini=ROLES.map((role,checkpoint)=>({id:randomUUID(),task_id:task.id,role,checkpoint,status:'settled',completion_status:'complete',provider:'openai',model:'mini-fixture',estimated:10,input_tokens:1,output_tokens:1,reserved:100}));
 const revision={id:randomUUID(),sequence:1,parent_id:null,base_token:'original:'+hash('original'),bundle:run.bundle,version:bundleVersion(run.bundle,task.source_hash),agent_task_id:null,created:'2026-10-26T00:00:00Z'};
 const receipt={schema:1,task_id:task.id,source_id:task.source_id,source_hash:task.source_hash,revision_id:revision.id,run_id:successor,scope_hash:run.policy.hash,model:COMPARISON_PRICING.model,base_token:revision.base_token,version:revision.version,state_hash:run.start.data!.state_hash,finished_event_id:run.end.id,stages:run.stages.map(({event_id,checkpoint,role,hash})=>({event_id,checkpoint,role,hash}))};
 const edited=run.bundle.map(a=>a.role==='Writer'?{...a,text:'Manual owner-voice edit.',hash:hash('Manual owner-voice edit.')}:a),manual={...revision,id:randomUUID(),sequence:2,parent_id:revision.id,bundle:edited};
 const events=[...f.events,{task_id:task.id,kind:COMPARISON_ADOPTED,detail:JSON.stringify(receipt)}],rows=[...mini,...f.ledger],before=JSON.stringify({events,rows,outputs,revision,manual});
 const result=agentContributions(task,[task],outputs,rows,events,[revision,manual],edited);
 assert.equal(result.roles[3].current_origin.kind,'manual_edit');assert.equal(result.roles[4].current_origin.kind,'private_comparison');assert(result.roles.every(r=>r.usage.estimated_microdollars===10));assert.equal(result.unattributed_calls,2);assert.equal(result.private_comparisons!.estimated_microdollars,178520);assert.match(result.notice,/excludes private comparisons/);assert.match(result.notice,/not the cost of the current artifact/);
 assert.equal(JSON.stringify({events,rows,outputs,revision,manual}),before);
});

for(const [name,change] of [
 ['missing stage',(f:any)=>f.events.splice(f.events.findIndex((e:any)=>e.kind==='private_comparison_stage'&&JSON.parse(e.detail).run_id===successor),1)],
 ['duplicate stage',(f:any)=>f.events.push({...f.events.find((e:any)=>e.kind==='private_comparison_stage'&&JSON.parse(e.detail).run_id===successor),id:randomUUID()})],
 ['duplicate aggregate row',(f:any)=>f.ledger.push({...f.ledger[1]})],
 ['missing aggregate row',(f:any)=>f.ledger.pop()],
 ['wrong ledger model',(f:any)=>f.ledger[1].model='other'],
 ['wrong ledger task',(f:any)=>f.ledger[1].task_id='other'],
 ['wrong ledger tier',(f:any)=>f.ledger[1].requested_service_tier='priority'],
 ['aggregate cost mismatch',(f:any)=>f.ledger[1].estimated++],
 ['aggregate token mismatch',(f:any)=>f.ledger[1].input_tokens++],
 ['pricing anomaly',(f:any)=>f.ledger[1].pricing_anomaly=true],
 ['scope mismatch',(f:any)=>alter(f,'private_comparison_started',d=>d.scope_hash=hash('unknown scope'))],
 ['hash mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.hash=hash('other'))],
 ['raw text mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.raw.choices[0].message.content+='other')],
 ['raw token mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.raw.usage.prompt_tokens++)],
 ['raw total token mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.raw.usage.total_tokens++)],
 ['raw model mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.raw.model='other')],
 ['raw tier mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.raw.service_tier='priority')],
 ['stage tier mismatch',(f:any)=>alter(f,'private_comparison_stage',d=>d.report.tier='priority')],
 ['request model mismatch',(f:any)=>alter(f,'private_comparison_admitted',d=>d.model='other')],
 ['request policy mismatch',(f:any)=>alter(f,'private_comparison_admitted',d=>d.prompt_policy_hash=hash('other'))],
 ['finished cost mismatch',(f:any)=>alter(f,'private_comparison_finished',d=>d.known_microdollars++)],
 ['retained reservation',(f:any)=>alter(f,'private_comparison_finished',d=>d.reservation_retained=true)],
 ['missing start',(f:any)=>f.events.splice(f.events.findIndex((e:any)=>e.id===successor),1)],
] as const)test(name+' remains uncertain, never inferred zero or a verified stage estimate',()=>{
 const f=fixture();change(f);const before=JSON.stringify(f),r=project(f),run=r.runs.find(r=>r.run_id===successor)!;
 assert.equal(run.verification,'uncertain');assert.equal(run.estimated_microdollars,null);assert.equal(run.verified_stage_responses,null);assert.deepEqual(run.stages,[]);assert.equal(r.estimated_microdollars,null);assert.equal(r.known_verified_estimate_microdollars,85324);assert.equal(JSON.stringify(f),before);
});

test('uncertain and orphan reservations retain known bounds, while malformed bounds stay unknown',()=>{
 const f=fixture();f.ledger[1]={...f.ledger[1],status:'unknown',estimated:null,input_tokens:null,output_tokens:null} as any;
 let r=project(f);assert.equal(r.runs[1].estimated_microdollars,null);assert.equal(r.runs[1].unresolved_reserved_microdollars,CORRECTED_COMPARISON_CAP);assert.equal(usageSummary(f.ledger).lifetime_total.reserved_microdollars,CORRECTED_COMPARISON_CAP);
 f.events=f.events.filter(e=>JSON.parse(e.detail).run_id!==successor);r=project(f);assert.equal(r.runs.length,2);assert.equal(r.runs[1].recorded_stage_events,0);assert.equal(r.runs[1].unresolved_reserved_microdollars,CORRECTED_COMPARISON_CAP);
 f.ledger[1].reserved=null as any;assert.equal(project(f).runs[1].unresolved_reserved_microdollars,null);
 assert.equal(privateComparisonCosts(randomUUID(),f.events,f.ledger),null);
});

test('malformed unassigned events keep the full history uncertain even when saved runs verify',()=>{
 const f=fixture();f.events.push({id:randomUUID(),task_id:target.task_id,kind:'private_comparison_stage',detail:'invalid'});
 const r=project(f);assert.equal(r.unassigned_event_records,1);assert.equal(r.estimated_microdollars,null);assert.equal(r.known_verified_estimate_microdollars,178520);
});
