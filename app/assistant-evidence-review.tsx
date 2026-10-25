'use client';
import {useRef,useState} from 'react';
import type {Decision,Finding,Span} from '../lib/evidence-review';
type Sentence=Span&{text:string};
type Props={item:Finding&{resolution:Decision|null};quality:{binding:string;source_text:string;source_sentences?:Sentence[]};task:string;token:string;busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>};
/** Deliberate delegated comparison, never an owner's personal testimony. */
export default function AssistantEvidenceReview({item,quality,task,token,busy,action}:Props){
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[submitted,setSubmitted]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
 if(item.kind!=='wording_review'||item.category||item.resolution?.actor==='owner')return null;
 const sentences=quality.source_sentences||[],first=sentences[Number(start)],last=sentences[Number(end)];
 const span=start!==''&&end!==''&&Number(end)>=Number(start)&&first&&last?{start:first.start,end:last.end}:null;
 const quote=span?quality.source_text.slice(span.start,span.end):'',withdraw=item.resolution?.actor==='assistant';
 async function submit(){
  if(lock.current||submitted||busy||!ack||!reason.trim()||(!withdraw&&(!span||!quote||quote.length>2000)))return;
  lock.current=true;setSubmitted(true);setAck(false);
  try{const result=await action('assistant-evidence-review',{task,expected:token,binding:quality.binding,finding_id:item.id,decision:withdraw?'withdraw':'accept',reason,source_span:withdraw?null:span,source_quote:withdraw?'':quote,acknowledged:true});setMessage(result===false?'Comparison not confirmed. Inspect the current saved review before a new deliberate request.':'Request sent. Inspect the saved assistant record; final post approval remains separate.');}
  catch{setMessage('Comparison outcome unconfirmed. Read the saved review before any new request; nothing is retried automatically.');}
  finally{lock.current=false;}
 }
 return <section aria-label={'Assistant source comparison '+item.id}>
  <h4>Assistant source comparison</h4><p>{withdraw?'Assistant compared wording against cited source; not owner review or independent verification.':'An assistant comparison records wording against cited source; not owner review or independent verification.'} This cannot waive hard findings, invalid Critic evidence or editorial holds, and cannot approve, schedule or publish.</p>
  {!withdraw&&<><label>First complete source sentence<select style={{display:'block',width:'100%',maxWidth:'100%'}} aria-label={'Assistant first source sentence '+item.id} value={start} disabled={busy||submitted} onChange={e=>{setStart(e.target.value);setEnd(e.target.value);setAck(false);}}><option value="">Select exact evidence</option>{sentences.map((s,n)=><option key={s.start} value={String(n)}>{n+1}. {s.text}</option>)}</select></label>
  <label>Last complete source sentence<select style={{display:'block',width:'100%',maxWidth:'100%'}} aria-label={'Assistant last source sentence '+item.id} value={end} disabled={busy||submitted||start===''} onChange={e=>{setEnd(e.target.value);setAck(false);}}><option value="">Select ending sentence</option>{sentences.map((s,n)=>n>=Number(start)&&<option key={s.start} value={String(n)}>{n+1}. {s.text}</option>)}</select></label><blockquote>{quote||'No evidence selected.'}</blockquote>{span&&<small>Exact JavaScript UTF-16 source offsets {span.start}–{span.end}</small>}</>}
  <label>Assistant comparison reason<textarea style={{display:'block',width:'100%',maxWidth:'100%'}} aria-label={'Assistant comparison reason '+item.id} maxLength={600} value={reason} disabled={busy||submitted} onChange={e=>{setReason(e.target.value);setAck(false);}}/></label>
  <label><input type="checkbox" checked={ack} disabled={busy||submitted} onChange={e=>setAck(e.target.checked)}/>{withdraw?' Withdraw only the assistant comparison; do not replace or override an owner decision.':' Record the assistant’s explicit comparison of this exact wording and quotation, including attribution, timing and uncertainty—not a personal owner review.'}</label>
  <button disabled={busy||submitted||!ack||!reason.trim()||(!withdraw&&(!quote||quote.length>2000))} onClick={()=>void submit()}>{withdraw?'Withdraw assistant comparison':'Record assistant source comparison'}</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
