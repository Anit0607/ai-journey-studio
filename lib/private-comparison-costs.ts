import {hash,ROLES,tokenCost} from './domain';
import {COMPARISON_TARGET,COMPARISON_PRICING,COMPARISON_OUTPUT_CAP} from './private-comparison-policy';
import {comparisonPolicy,COMPARISON_PREDECESSOR} from './private-comparison-scopes';
import {comparisonDetail} from './private-comparison-predecessor';

type Row=Record<string,any>;
const kinds=new Set(['private_comparison_started','private_comparison_admitted','private_comparison_stage','private_comparison_finished']);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const whole=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const amount=(v:unknown)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&whole(Number(v))?Number(v):null;
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function check(value:unknown):asserts value{if(!value)throw Error('Comparison cost evidence is incomplete or inconsistent');}

/** Cost verification only, deliberately separate from adoption verification:
 * the pinned blocked predecessor has spending evidence but is never adoptable.
 * Partial/inconsistent evidence yields unknown, never an inferred stage cost. */
function verifiedCost(runId:string,related:Row[],rows:Row[]){
 check(related.every(e=>e.data?.run_id===runId)&&new Set(related.map(e=>e.id)).size===related.length);
 const one=(kind:string)=>{const matches=related.filter(e=>e.kind===kind);check(matches.length===1);return matches[0];};
 const start=one('private_comparison_started'),end=one('private_comparison_finished'),s=start.data,f=end.data;
 const policy=comparisonPolicy(s.scope_hash);check(policy);
 check(start.id===runId&&same(s.scope,policy.scope)&&hash(JSON.stringify(s.scope))===policy.hash&&digest(s.state_hash)&&digest(s.config_hash));
 const predecessor=runId===COMPARISON_PREDECESSOR.run_id;
 check(f.steps===6&&f.reservation_retained===false&&whole(f.known_microdollars)&&(f.status==='completed_requires_review'||predecessor&&f.status==='blocked'));
 if(predecessor)check(s.scope_hash===COMPARISON_PREDECESSOR.scope_hash&&s.state_hash===COMPARISON_PREDECESSOR.state_hash&&s.config_hash===COMPARISON_PREDECESSOR.config_hash&&end.id===COMPARISON_PREDECESSOR.finished_event_id&&f.status===COMPARISON_PREDECESSOR.status&&f.known_microdollars===COMPARISON_PREDECESSOR.spent_microdollars);
 const row=rows[0];
 check(rows.length===1&&row.task_id===COMPARISON_TARGET.task_id&&row.provider==='openai'&&row.model===COMPARISON_PRICING.model&&row.status==='settled'&&row.completion_status===f.status&&row.pricing_anomaly===false&&row.requested_service_tier==='default'&&row.role===null&&row.checkpoint===null&&amount(row.reserved)===policy.cap&&same(row.pricing,COMPARISON_PRICING));
 const saved=related.filter(e=>e.kind==='private_comparison_stage'),admitted=related.filter(e=>e.kind==='private_comparison_admitted');
 check(saved.length===6&&admitted.length===6);
 const stages=ROLES.map((role,checkpoint)=>{
  const found=saved.filter(e=>e.data.role===role&&e.data.checkpoint===checkpoint),requests=admitted.filter(e=>e.data.role===role&&e.data.checkpoint===checkpoint);
  check(found.length===1&&requests.length===1);
  const stage=found[0].data,request=requests[0].data,raw=stage.raw,choice=raw?.choices?.[0];
  check(typeof stage.text==='string'&&!!stage.text.trim()&&stage.hash===hash(stage.text)&&(!predecessor||stage.hash===COMPARISON_PREDECESSOR.stage_hashes[checkpoint]));
  check(stage.report?.model===COMPARISON_PRICING.model&&stage.report?.tier==='default'&&stage.report?.finish_reason==='stop');
  check(raw?.model===stage.report.model&&raw?.service_tier===stage.report.tier&&raw?.choices?.length===1&&choice?.finish_reason==='stop'&&!choice?.message?.refusal&&choice?.message?.content===stage.text&&raw?.usage?.prompt_tokens===stage.input&&raw?.usage?.completion_tokens===stage.output);
  check(whole(stage.input)&&whole(stage.output)&&(!('total_tokens' in raw.usage)||raw.usage.total_tokens===stage.input+stage.output));
  check(request.model===COMPARISON_PRICING.model&&(!policy.corrected||request.prompt_policy_hash===('prompt_policy_hash' in policy.scope?policy.scope.prompt_policy_hash:null))&&digest(request.prompt_hash)&&whole(request.input_bound)&&request.input_bound<=policy.scope.plan[checkpoint].input_bound&&request.completion_cap===COMPARISON_OUTPUT_CAP&&stage.input<=request.input_bound&&stage.output<=COMPARISON_OUTPUT_CAP);
  return {role,checkpoint,hash:stage.hash as string,input_tokens:stage.input,output_tokens:stage.output,estimated_microdollars:tokenCost(COMPARISON_PRICING,stage.input,stage.output)};
 });
 const sum=(key:'input_tokens'|'output_tokens'|'estimated_microdollars')=>stages.reduce((n,stage)=>n+stage[key],0);
 check(amount(row.input_tokens)===sum('input_tokens')&&amount(row.output_tokens)===sum('output_tokens')&&amount(row.estimated)===sum('estimated_microdollars')&&f.known_microdollars===sum('estimated_microdollars')&&f.known_microdollars<=policy.cap);
 return {status:f.status as string,model:COMPARISON_PRICING.model,stages,estimated_microdollars:f.known_microdollars as number};
}

/** Read-only disaggregation of existing ledger records, never additional spending.
 * Counts verified saved responses, not hidden retries or unrecorded provider calls. */
export function privateComparisonCosts(taskId:string,events:Row[],ledger:Row[]){
 if(taskId!==COMPARISON_TARGET.task_id)return null;
 const related:Row[]=events.filter(e=>e.task_id===taskId&&kinds.has(e.kind)).map(e=>({...e,data:comparisonDetail(e)}));
 const eventRun=(e:Row)=>uuid(e.data?.run_id)?e.data.run_id:e.kind==='private_comparison_started'&&uuid(e.id)?e.id:null;
 const ids=new Set<string>(related.map(eventRun).filter((id):id is string=>id!==null));
 // Include an orphan aggregate reservation rather than silently dropping it.
 for(const row of ledger)if(row.task_id===taskId&&row.provider==='openai'&&row.model===COMPARISON_PRICING.model&&row.role===null&&row.checkpoint===null&&uuid(row.id))ids.add(row.id);
 const runs=[...ids].map(run_id=>{
  const records=related.filter(e=>eventRun(e)===run_id),rows=ledger.filter(r=>r.id===run_id),row=rows.length===1?rows[0]:null;
  const ends=records.filter(e=>e.kind==='private_comparison_finished'),status=ends.length===1&&typeof ends[0].data?.status==='string'?ends[0].data.status:'not verified';
  const base={run_id,status,recorded_stage_events:records.filter(e=>e.kind==='private_comparison_stage').length,aggregate_ledger_records:rows.length,spending_history_only:true};
  try{return {...base,...verifiedCost(run_id,records,rows),verification:'verified' as const,verified_stage_responses:6,unresolved_reserved_microdollars:0};}
  catch{return {...base,verification:'uncertain' as const,model:null,stages:[],verified_stage_responses:null,estimated_microdollars:null,unresolved_reserved_microdollars:row&&row.task_id===taskId&&['reserved','unknown'].includes(row.status)?amount(row.reserved):null};}
 });
 const verified=runs.filter(run=>run.verification==='verified'),unassigned_event_records=related.filter(e=>eventRun(e)===null).length;
 return {runs,unassigned_event_records,aggregate_ledger_records:runs.reduce((n,r)=>n+r.aggregate_ledger_records,0),verified_stage_responses:verified.reduce((n,r)=>n+(r.verified_stage_responses??0),0),estimated_microdollars:runs.length>0&&verified.length===runs.length&&!unassigned_event_records?verified.reduce((n,r)=>n+r.estimated_microdollars!,0):null,known_verified_estimate_microdollars:verified.length?verified.reduce((n,r)=>n+r.estimated_microdollars!,0):null,notice:'Read-only breakdown of private comparison spending already included in overall usage and budget totals. Do not add these estimates again. This is spending history, not the cost of the current edited artifact, an invoice, or adoption/approval eligibility.'};
}
