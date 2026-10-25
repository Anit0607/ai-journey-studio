import {hash,ROLES,tokenCost} from './domain';
import {assertBundle,bundleVersion,type Artifact} from './grounding';
import {COMPARISON_TARGET,COMPARISON_SCOPE_HASH,COMPARISON_SCOPE,COMPARISON_PRICING,COMPARISON_CAP,COMPARISON_INPUT_BOUNDS,COMPARISON_OUTPUT_CAP} from './private-comparison-policy';

type Row=Record<string,any>;
export const COMPARISON_ADOPTED='private_comparison_adopted';
export function comparisonEventDetail(row:Row):Row|null{
 try{const value=JSON.parse(row.detail);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}
}
const whole=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const amount=(v:unknown)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isSafeInteger(Number(v))&&Number(v)>=0;
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function requireRecord(condition:unknown):asserts condition{if(!condition)throw Error('Comparison record is incomplete or does not match its binding');}
/** One complete, settled run only. This reads original saved bytes, never caller-supplied prose. */
export function verifiedComparisonRun(events:Row[],ledger:Row[],runId:string){
 const related:(Row&{data:Row|null})[]=events.filter(e=>e.task_id===COMPARISON_TARGET.task_id).map(e=>({...e,data:comparisonEventDetail(e)})).filter(e=>e.data?.run_id===runId);
 const one=(kind:string)=>{const found=related.filter(e=>e.kind===kind);requireRecord(found.length===1);return found[0];};
 const start=one('private_comparison_started'),end=one('private_comparison_finished'),s=start.data!,f=end.data!;
 requireRecord(start.id===runId&&s.scope_hash===COMPARISON_SCOPE_HASH&&same(s.scope,COMPARISON_SCOPE)&&hash(JSON.stringify(s.scope))===COMPARISON_SCOPE_HASH&&digest(s.state_hash)&&digest(s.config_hash));
 requireRecord(f.status==='completed_requires_review'&&f.steps===6&&f.reservation_retained===false&&whole(f.known_microdollars));
 const rows=ledger.filter(r=>r.id===runId),row=rows[0];
 requireRecord(rows.length===1&&row.task_id===COMPARISON_TARGET.task_id&&row.provider==='openai'&&row.model===COMPARISON_PRICING.model&&row.status==='settled'&&row.completion_status==='completed_requires_review'&&!row.pricing_anomaly&&row.requested_service_tier==='default'&&row.role===null&&row.checkpoint===null&&Number(row.reserved)===COMPARISON_CAP&&same(row.pricing,COMPARISON_PRICING));
 const saved=related.filter(e=>e.kind==='private_comparison_stage'),admitted=related.filter(e=>e.kind==='private_comparison_admitted');
 requireRecord(saved.length===6&&admitted.length===6);
 let input=0,output=0,cost=0;
 const stages=ROLES.map((role,checkpoint)=>{
  const found=saved.filter(e=>e.data!.role===role&&e.data!.checkpoint===checkpoint),requests=admitted.filter(e=>e.data!.role===role&&e.data!.checkpoint===checkpoint);
  requireRecord(found.length===1&&requests.length===1);
  const event=found[0],stage=event.data!,request=requests[0].data!,raw=stage.raw,choice=raw?.choices?.[0];
  requireRecord(typeof stage.text==='string'&&!!stage.text.trim()&&stage.hash===hash(stage.text)&&stage.report?.model===COMPARISON_PRICING.model&&stage.report?.tier==='default'&&stage.report?.finish_reason==='stop');
  requireRecord(raw?.model===stage.report.model&&raw?.service_tier===stage.report.tier&&choice?.finish_reason==='stop'&&!choice?.message?.refusal&&choice?.message?.content===stage.text&&raw?.usage?.prompt_tokens===stage.input&&raw?.usage?.completion_tokens===stage.output);
  requireRecord(request.model===COMPARISON_PRICING.model&&digest(request.prompt_hash)&&whole(request.input_bound)&&request.input_bound<=COMPARISON_INPUT_BOUNDS[checkpoint]&&request.completion_cap===COMPARISON_OUTPUT_CAP&&whole(stage.input)&&stage.input<=request.input_bound&&whole(stage.output)&&stage.output<=COMPARISON_OUTPUT_CAP);
  input+=stage.input;output+=stage.output;cost+=tokenCost(COMPARISON_PRICING,stage.input,stage.output);
  return {event_id:event.id,checkpoint,role,text:stage.text as string,hash:stage.hash as string};
 });
 requireRecord([row.input_tokens,row.output_tokens,row.estimated].every(amount)&&Number(row.input_tokens)===input&&Number(row.output_tokens)===output&&Number(row.estimated)===cost&&f.known_microdollars===cost&&cost<=COMPARISON_CAP);
 const bundle:Artifact[]=stages.map(({role,text,hash})=>({role,text,hash}));assertBundle(bundle);
 return {start,end,stages,bundle};
}
/** A revision note is never evidence of model authorship. Verify receipt AND original records. */
export function comparisonRevisionOrigin(task:Row,revision:Row,events:Row[],ledger:Row[]){
 const receipts=events.filter(e=>e.task_id===task.id&&e.kind===COMPARISON_ADOPTED).map(comparisonEventDetail).filter(e=>e?.revision_id===revision.id);
 if(!receipts.length)return null;
 try{
  requireRecord(receipts.length===1);const receipt=receipts[0]!;
  requireRecord(receipt.schema===1&&receipt.task_id===task.id&&task.id===COMPARISON_TARGET.task_id&&receipt.source_id===task.source_id&&receipt.source_hash===task.source_hash&&receipt.source_id===COMPARISON_TARGET.source_id&&receipt.source_hash===COMPARISON_TARGET.source_hash&&receipt.scope_hash===COMPARISON_SCOPE_HASH&&receipt.model===COMPARISON_PRICING.model&&receipt.base_token===revision.base_token&&!revision.agent_task_id);
  const run=verifiedComparisonRun(events,ledger,receipt.run_id);
  requireRecord(receipt.state_hash===run.start.data!.state_hash&&receipt.finished_event_id===run.end.id&&same(receipt.stages,run.stages.map(({event_id,checkpoint,role,hash})=>({event_id,checkpoint,role,hash})))&&same(revision.bundle,run.bundle)&&receipt.version===revision.version&&revision.version===bundleVersion(run.bundle,task.source_hash));
  return {kind:'private_comparison',task_id:task.id,revision_id:revision.id,run_id:receipt.run_id,model:receipt.model,created:revision.created};
 }catch{return {kind:'unknown',task_id:null,revision_id:revision.id,created:revision.created};}
}
