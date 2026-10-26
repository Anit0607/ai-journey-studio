"use client";
import {useState} from "react";
import AssistantEvidenceReview from "./assistant-evidence-review";
import OwnerMessageContextPanel,{type OwnerMessageContextView} from "./owner-message-context-panel";
import type {Finding,Span,Decision} from "../lib/evidence-review";
type Quality={binding:string;source_text:string;source_sentences?:Array<Span&{text:string}>;source_hash:string;bundle_hash:string;policy_version:string;findings:Array<Finding&{resolution:Decision|null;evidence_source?:'owner_message_context'}>;owner_message_context?:OwnerMessageContextView;critic?:{valid:boolean;legacy:boolean}};
const fieldStyle={display:'block',width:'100%',boxSizing:'border-box' as const,background:'#0d141c',color:'#dce8ed',border:'1px solid #30404b',padding:12,margin:'8px 0',fontFamily:'inherit',fontSize:14};
type Action=(path:string,body:unknown)=>Promise<unknown>;
function IndividualReview({item,quality,task,token,busy,action}:{item:Quality['findings'][number];quality:Quality;task:string;token:string;busy:boolean;action:Action}){
 const [span,setSpan]=useState<Span|null>(null),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
 const contextual=item.evidence_source==='owner_message_context',evidenceText=contextual?(quality.owner_message_context?.statement||''):quality.source_text;
 const quote=span?evidenceText.slice(span.start,span.end):'';
 return <article aria-label={'Evidence review '+item.role} className="panel">
  <strong>{item.role} · {item.kind==='hard'?'Correction required':item.resolution?(item.resolution.actor==='assistant'?'Assistant-compared wording':'Owner-reviewed wording'):'Compare wording'}</strong>
  <p>{item.reason}</p>{item.resolution&&<p>Recorded by {item.resolution.actor} · {item.resolution.created||'saved'} · {item.resolution.reason}<br/>Evidence: {item.resolution.evidence.source_quote}</p>}<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
   <div><h4>Draft sentence</h4><blockquote>{item.claim}</blockquote><small>Claim offsets {item.span.start}–{item.span.end}</small></div>
   <div><h4>{contextual?'Owner self-report · assistant import':'Exact cleared note'}</h4><textarea aria-label={'Source evidence for '+item.id} readOnly rows={7} style={fieldStyle} value={evidenceText} onSelect={event=>{const el=event.currentTarget;if(el.selectionEnd>el.selectionStart){setSpan({start:el.selectionStart,end:el.selectionEnd});setAck(false);}}}/></div>
  </div>
  <details><summary>Version evidence</summary><p>Policy: {quality.policy_version}</p><p>{contextual?'Original technical source SHA-256: ':'Source SHA-256: '}{quality.source_hash}</p>{contextual&&<p>Owner-message statement SHA-256: {quality.owner_message_context?.source_hash}</p>}<p>Artifact SHA-256: {item.artifact_hash}</p><p>Bundle SHA-256: {quality.bundle_hash}</p><p>Finding: {item.id}</p></details>
  {item.kind==='hard'?<p>This issue cannot be waived here. Correct the draft or provide separately cleared evidence.</p>:contextual?<>{item.resolution&&<>
   <p>An owner can withdraw this saved decision without claiming a personal source comparison.</p>
   <label>Withdrawal reason<textarea style={fieldStyle} aria-label={'Withdrawal reason for '+item.id} maxLength={600} value={reason} onChange={e=>{setReason(e.target.value);setAck(false);}}/></label>
   <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> Withdraw this saved wording decision; this does not record a personal source review.</label>
   <button disabled={busy||!ack||!reason.trim()} onClick={()=>void action('evidence-review',{task,expected:token,binding:quality.binding,finding_id:item.id,decision:'withdraw',reason,source_span:null,source_quote:'',acknowledged:ack})}>Withdraw this wording decision</button>
  </>}</>:<>
   <p>Select one or more complete supporting sentences in the cleared note above. This records your judgement, not an automatic truth check.</p>
   <p>Selected evidence: {quote||'Nothing selected'} {span&&`(${span.start}–${span.end})`}</p>
   <label>Why does this mean the same thing?<textarea style={fieldStyle} aria-label={'Review reason for '+item.id} maxLength={600} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I compared this sentence with its evidence, including uncertainty, timing and attribution.</label>
   <button disabled={busy||!ack||!reason.trim()||(!item.resolution&&!quote)} onClick={()=>void action('evidence-review',{task,expected:token,binding:quality.binding,finding_id:item.id,decision:item.resolution?'withdraw':'accept',reason,source_span:span,source_quote:quote,acknowledged:ack})}>{item.resolution?'Withdraw this wording decision':'Record this wording review'}</button>
  </>}
 <AssistantEvidenceReview key={token+quality.binding+item.id+(item.resolution?.id||'unresolved')} {...{item,quality,task,token,busy,action}}/>
 </article>;
}
export default function EvidencePanel({quality,task,token,busy,action}:{quality:Quality;task:string;token:string;busy:boolean;action:Action}){
 if(!quality.findings)return null;
 return <section aria-label="Evidence review"><h3>Check wording against evidence</h3><p>Review each sentence separately. This does not approve content or allow publishing. Changed content or source clearance invalidates its decisions.</p>
 <OwnerMessageContextPanel key={task+token+quality.binding+(quality.owner_message_context?.version||'none')+(quality.owner_message_context?.policy_hash||'none')+(quality.owner_message_context?.status||'unavailable')} context={quality.owner_message_context} {...{task,token,busy,action}}/>
 {quality.critic&&!quality.critic.legacy&&<p>Agent evidence suggestions: {quality.critic.valid?'format checked; not independent factual verification':'invalid; correct the Critic artifact before approval'}.</p>}
 {quality.findings.map(item=>item.category==='structure'?<article key={quality.binding+item.id} aria-label={'Review blocker '+item.role}><strong>{item.role} · Review blocker</strong><p>{item.claim}</p><p>{item.reason}</p><p>Correct the artifact structure before approval. This is not a sentence to confirm against the source.</p></article>:<IndividualReview key={quality.binding+item.id+(item.resolution?.id||'unresolved')} {...{item,quality,task,token,busy,action}}/>)}
 </section>;
}
