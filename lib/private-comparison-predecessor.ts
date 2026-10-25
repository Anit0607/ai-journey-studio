import {hash,ROLES,tokenCost} from './domain';
import {COMPARISON_TARGET,COMPARISON_SCOPE,COMPARISON_SCOPE_HASH,COMPARISON_CAP,COMPARISON_PRICING,COMPARISON_INPUT_BOUNDS,COMPARISON_OUTPUT_CAP} from './private-comparison-policy';
import {COMPARISON_PREDECESSOR as prior,CORRECTED_COMPARISON_CAP,CORRECTED_COMPARISON_SCOPE_HASH,CORRECTED_COMPARISON_SCOPE} from './private-comparison-scopes';
type Row=Record<string,any>;
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const whole=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const amount=(v:unknown)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isSafeInteger(Number(v))&&Number(v)>=0;
function check(v:unknown):asserts v{if(!v)throw Error('Corrective comparison predecessor or family proof failed');}
export function comparisonDetail(row:Row):Row|null{try{const d=typeof row.detail==='string'?JSON.parse(row.detail):row.detail;return d&&typeof d==='object'&&!Array.isArray(d)?d:null;}catch{return null;}}
/** Exact failed predecessor is spending evidence only, never an adoptable bundle. */
export function assertCorrectiveComparisonFamily(events:Row[],ledger:Row[],currentRun?:string,terminal=false){
 const family:(Row&{data:Row|null})[]=events.filter(e=>e.task_id===COMPARISON_TARGET.task_id&&e.kind.startsWith('private_comparison_')).map(e=>({...e,data:comparisonDetail(e)}));
 check(family.every(e=>e.data));
 const starts=family.filter(e=>e.kind==='private_comparison_started');
 check(starts.length===(currentRun?2:1));
 const old=starts.filter(e=>e.id===prior.run_id&&e.data!.run_id===prior.run_id);check(old.length===1);
 const s=old[0].data!;check(s.state_hash===prior.state_hash&&s.config_hash===prior.config_hash&&s.scope_hash===prior.scope_hash&&s.scope_hash===COMPARISON_SCOPE_HASH&&same(s.scope,COMPARISON_SCOPE)&&hash(JSON.stringify(s.scope))===COMPARISON_SCOPE_HASH);
 if(currentRun){const next=starts.filter(e=>e.id===currentRun&&e.data!.run_id===currentRun);check(next.length===1&&next[0].data!.scope_hash===CORRECTED_COMPARISON_SCOPE_HASH&&same(next[0].data!.scope,CORRECTED_COMPARISON_SCOPE)&&hash(JSON.stringify(next[0].data!.scope))===CORRECTED_COMPARISON_SCOPE_HASH);}
 check(family.every(e=>e.data!.run_id===prior.run_id||!!currentRun&&e.data!.run_id===currentRun));
 const related=family.filter(e=>e.data!.run_id===prior.run_id),ends=related.filter(e=>e.kind==='private_comparison_finished');check(ends.length===1&&ends[0].id===prior.finished_event_id);
 const end=ends[0].data!;check(end.status===prior.status&&end.steps===prior.steps&&end.known_microdollars===prior.spent_microdollars&&end.reservation_retained===false);
 const rows=ledger.filter(r=>r.id===prior.run_id),row=rows[0];check(rows.length===1&&row.task_id===COMPARISON_TARGET.task_id&&row.provider==='openai'&&row.model===COMPARISON_PRICING.model&&row.status==='settled'&&row.completion_status==='blocked'&&!row.pricing_anomaly&&row.requested_service_tier==='default'&&row.role===null&&row.checkpoint===null&&Number(row.reserved)===COMPARISON_CAP&&same(row.pricing,COMPARISON_PRICING));
 check(ledger.every(r=>r.status==='settled'&&amount(r.estimated)&&!r.pricing_anomaly||!!currentRun&&r.id===currentRun&&r.status==='reserved'));
 const stages=related.filter(e=>e.kind==='private_comparison_stage'),admitted=related.filter(e=>e.kind==='private_comparison_admitted');check(stages.length===6&&admitted.length===6);
 let input=0,output=0,cost=0;
 for(const [checkpoint,role] of ROLES.entries()){
  const found=stages.filter(e=>e.data!.checkpoint===checkpoint&&e.data!.role===role),requests=admitted.filter(e=>e.data!.checkpoint===checkpoint&&e.data!.role===role);check(found.length===1&&requests.length===1);
  const d=found[0].data!,a=requests[0].data!,raw=d.raw,choice=raw?.choices?.[0];
  check(typeof d.text==='string'&&d.hash===prior.stage_hashes[checkpoint]&&hash(d.text)===d.hash&&d.report?.model===COMPARISON_PRICING.model&&d.report?.tier==='default'&&d.report?.finish_reason==='stop');
  check(raw?.model===d.report.model&&raw?.service_tier===d.report.tier&&choice?.finish_reason==='stop'&&!choice?.message?.refusal&&choice?.message?.content===d.text&&raw?.usage?.prompt_tokens===d.input&&raw?.usage?.completion_tokens===d.output);
  check(a.model===COMPARISON_PRICING.model&&typeof a.prompt_hash==='string'&&/^[a-f0-9]{64}$/.test(a.prompt_hash)&&whole(a.input_bound)&&a.input_bound<=COMPARISON_INPUT_BOUNDS[checkpoint]&&a.completion_cap===COMPARISON_OUTPUT_CAP&&whole(d.input)&&d.input<=a.input_bound&&whole(d.output)&&d.output<=COMPARISON_OUTPUT_CAP);
  input+=d.input;output+=d.output;cost+=tokenCost(COMPARISON_PRICING,d.input,d.output);
 }
 check([row.input_tokens,row.output_tokens,row.estimated].every(amount)&&Number(row.input_tokens)===input&&Number(row.output_tokens)===output&&Number(row.estimated)===cost&&cost===prior.spent_microdollars&&cost+CORRECTED_COMPARISON_CAP<=COMPARISON_CAP);
 if(currentRun){const current=ledger.filter(r=>r.id===currentRun);check(current.length===1&&current[0].task_id===COMPARISON_TARGET.task_id&&Number(current[0].reserved)===CORRECTED_COMPARISON_CAP&&current[0].status===(terminal?'settled':'reserved')&&!current[0].pricing_anomaly&&current[0].requested_service_tier==='default'&&current[0].role===null&&current[0].checkpoint===null&&(!terminal||amount(current[0].estimated)&&Number(current[0].estimated)<=CORRECTED_COMPARISON_CAP)&&current[0].provider==='openai'&&current[0].model===COMPARISON_PRICING.model&&same(current[0].pricing,COMPARISON_PRICING));}
 return {spent_microdollars:cost,remaining_microdollars:COMPARISON_CAP-cost};
}
