import {comparisonRevisionOrigin} from './private-comparison-record';
import {privateComparisonCosts} from './private-comparison-costs';
import {parseNoteSelection,canonicalFactPacket} from './note-fact-selection';
import {ROLES,hash,type Task} from './domain';
import {type Artifact} from './grounding';
import {DRAFT_PROMPT_PREPARED,DRAFT_OUTPUT_RECORDED,validPromptMetadata} from './draft-run-receipt';
type Row=Record<string,any>;
const purposes=['Preserve source facts and provenance; canonical note runs acknowledge the server index.','Select one supported problem, choice or method.','Plan the reader-facing angle and practical use.','Write the public draft.','Adapt the draft to the active platform.','Check support, privacy and editorial fit; never grant approval.'];
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const amount=(v:unknown)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
const timestamp=(v:unknown)=>v instanceof Date?v.getTime():typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)?Date.parse(v):NaN;
function eventData(event:Row){try{if(typeof event.detail!=='string'||event.detail.length>8000)return null;const v=JSON.parse(event.detail);return v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(v)===event.detail?v:null;}catch{return null;}}
function exactArtifact(item:Row|undefined){return !!item&&typeof item.text==='string'&&typeof item.hash==='string'&&hash(item.text)===item.hash;}
function usage(rows:Row[]){
 const known=rows.filter(r=>r.status==='settled'&&amount(r.estimated)!==null),unresolved=rows.filter(r=>r.status!=='settled'),sum=(key:string)=>rows.length>0&&rows.every(r=>amount(r[key])!==null)?rows.reduce((n,r)=>n+Number(r[key]),0):null;
 const reserved=rows.length>0&&unresolved.every(r=>amount(r.reserved)!==null)?unresolved.reduce((n,r)=>n+Number(r.reserved),0):null;
 return {attempts:rows.length,settled:rows.filter(r=>r.status==='settled').length,estimated_microdollars:rows.length>0&&known.length===rows.length?known.reduce((n,r)=>n+Number(r.estimated),0):null,known_estimate_microdollars:known.reduce((n,r)=>n+Number(r.estimated),0),unresolved_reserved_microdollars:reserved,unknown_usage_calls:rows.filter(r=>r.status!=='settled'||amount(r.estimated)===null||amount(r.input_tokens)===null||amount(r.output_tokens)===null).length,input_tokens:sum('input_tokens'),output_tokens:sum('output_tokens')};
}
function runFor(task:Row,role:string,checkpoint:number,outputs:Row[],ledger:Row[],events:Row[],source?:Row){
 const matches=outputs.filter(o=>o.task_id===task.id&&o.role===role),output=matches.length===1&&exactArtifact(matches[0])?matches[0]:null;
 const rows=ledger.filter(r=>r.task_id===task.id&&r.role===role&&r.checkpoint===checkpoint);
 const receipts=events.filter(e=>e.task_id===task.id&&e.kind===DRAFT_PROMPT_PREPARED).map(eventData).filter(Boolean).filter(r=>{const {reservation_id,...meta}=r;return uuid(reservation_id)&&validPromptMetadata(meta)&&meta.checkpoint===checkpoint&&meta.source_hash===task.source_hash&&rows.some(row=>row.id===reservation_id);});
 const attempts=rows.map(row=>{
  const found=receipts.filter(r=>r.reservation_id===row.id),prepared=found.length===1?found[0]:null;
  const recorded=events.filter(e=>e.task_id===task.id&&e.kind===DRAFT_OUTPUT_RECORDED).map(eventData).filter(r=>r&&Object.keys(r).sort().join('|')==='artifact_hash|checkpoint|reservation_id|role|schema'&&r.schema===1&&r.reservation_id===row.id&&r.checkpoint===checkpoint&&r.role===role&&output&&r.artifact_hash===output.hash);
  return {id:row.id,status:row.status,completion_status:row.completion_status||null,provider:row.provider,model:row.model,estimated_microdollars:row.status==='settled'?amount(row.estimated):null,reserved_microdollars:row.status!=='settled'?amount(row.reserved):0,input_tokens:amount(row.input_tokens),output_tokens:amount(row.output_tokens),prepared,receipt_state:prepared?(recorded.length===1&&row.status==='settled'&&row.completion_status==='complete'?'saved_output_recorded':'prepared_not_proof_of_transmission'):'not_recorded'};
 });
 const completed=rows.filter(r=>r.status==='settled'&&r.completion_status==='complete');
 // Legacy elapsed is only a conservative wall-clock interval, never model latency.
 const from=rows.length===1&&completed.length===1?timestamp(rows[0].created):NaN,to=output?timestamp(output.created):NaN;
 const elapsed=Number.isFinite(from)&&Number.isFinite(to)&&to>=from?to-from:null;
 let selectedFacts:Row|null=null;
 if(output&&source&&source.id===task.source_id&&source.hash===task.source_hash&&checkpoint<=2){try{const prior=checkpoint===2?parseNoteSelection(1,outputs.find(o=>o.task_id===task.id&&o.role==='Story Miner')?.text||'',source as any):undefined;const selection=parseNoteSelection(checkpoint as 0|1|2,output.text,source as any,prior);selectedFacts={decision:selection.decision||'source_index',...canonicalFactPacket(source as any,selection,output.hash)};}catch{}}
 return {selected_facts:selectedFacts,task_id:task.id,kind:task.revision_parent_task_id?'agent_revision':'original_run',status:task.status,output:output?{text:output.text,hash:output.hash,created:output.created}:null,usage:usage(rows),attempts,elapsed_ms:elapsed,elapsed_basis:elapsed===null?'not_recorded':'reservation_to_saved_artifact_including_application_overhead'};
}
export function agentContributions(task:Task,tasks:Row[],outputs:Row[],ledger:Row[],events:Row[],history:Row[],bundle:Artifact[],source?:Row){
 const family=[task,...tasks.filter(t=>t.revision_parent_task_id===task.id)],familyIds=new Set(family.map(t=>t.id));
 const revisions=[...history].sort((a,b)=>Number(a.sequence)-Number(b.sequence));
 const roles=ROLES.map((role,checkpoint)=>{
  const runs=family.map(t=>runFor(t,role,checkpoint,outputs,ledger,events,source));
  const original=runs[0].output;
  let prior:Row|null=original,origin:Row=original?{kind:'saved_original',task_id:task.id,revision_id:null,created:original.created}:{kind:'unknown',task_id:null,revision_id:null,created:null};
  let lastSequence=0,lastRevision:string|null=null;
  for(const revision of revisions){
   const candidates=Array.isArray(revision.bundle)?revision.bundle.filter((a:Row)=>a.role===role):[],item=candidates.length===1?candidates[0]:null;
   if(!exactArtifact(item)||!Number.isInteger(revision.sequence)||revision.sequence!==lastSequence+1||(revision.parent_id||null)!==lastRevision){origin={kind:'unknown',task_id:null,revision_id:revision.id,created:revision.created};prior=item;lastSequence=revision.sequence;lastRevision=revision.id;continue;}
   const comparison=comparisonRevisionOrigin(task,revision,events,ledger);
   if(comparison){origin=comparison;}else if(revision.agent_task_id){
    const run=runs.find(r=>r.task_id===revision.agent_task_id&&r.kind==='agent_revision');
    origin=run&&run.output&&run.output.hash===item.hash&&run.output.text===item.text?{kind:'agent_revision',task_id:run.task_id,revision_id:revision.id,created:revision.created}:{kind:'unknown',task_id:null,revision_id:revision.id,created:revision.created};
   }else if(!prior||prior.hash!==item.hash||prior.text!==item.text){origin={kind:'manual_edit',task_id:null,revision_id:revision.id,created:revision.created};}
   prior=item;lastSequence=revision.sequence;lastRevision=revision.id;
  }
  const current=bundle.find(item=>item.role===role);
  if(!exactArtifact(current)||!prior||current!.hash!==prior.hash||current!.text!==prior.text)origin={kind:'unknown',task_id:null,revision_id:null,created:null};
  return {role,checkpoint,purpose:purposes[checkpoint],current_hash:current?.hash||null,current_origin:origin,runs,usage:usage(ledger.filter(r=>familyIds.has(r.task_id)&&r.role===role&&r.checkpoint===checkpoint))};
 });
 // Preserve the existing API key; its value counts ledger records, not provider calls.
 return {roles,unattributed_calls:ledger.filter(r=>familyIds.has(r.task_id)&&(!ROLES.includes(r.role)||r.checkpoint!==ROLES.indexOf(r.role))).length,private_comparisons:privateComparisonCosts(task.id,events,ledger),notice:'Role descriptions are responsibilities, not evaluations. Role usage below is original-run and agent-revision history only; it excludes private comparisons and is not the cost of the current artifact. Saved model artifacts may be superseded by manual edits. Usage is a provider-reported estimate, not an invoice. No style score, factual pass or publication approval is inferred.'};
}
