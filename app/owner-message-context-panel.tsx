'use client';
import {useRef,useState} from 'react';
export type OwnerMessageContextView={eligible:boolean;policy_hash:string|null;version:string|null;status:'unattached'|'active'|'revoked'|'invalid'|'unavailable';quote:string|null;statement:string|null;source_hash:string|null;source_sentences?:Array<{start:number;end:number;text:string}>;message_reference:string|null;authorization_reference:string|null;notice:string};
type Props={context?:OwnerMessageContextView;task:string;token:string;busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>};
/** Only a deliberate click records or revokes context; neither action is owner review. */
export default function OwnerMessageContextPanel({context,task,token,busy,action}:Props){
 const [ack,setAck]=useState(false),[submitted,setSubmitted]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
 if(!context||(!context.eligible&&context.status==='unavailable'))return null;
 const revoke=context.status==='active',valid=context.eligible&&!!context.policy_hash&&['unattached','active','revoked'].includes(context.status)&&(!revoke||!!context.version),blocked=!valid||busy||pending||submitted;
 async function submit(){
  if(blocked||lock.current||!ack||!context)return;
  lock.current=true;setSubmitted(true);setPending(true);setAck(false);
  try{const result=await action('owner-message-context',{task,expected:token,policy_hash:context.policy_hash,expected_context_version:context.version,decision:revoke?'revoke':'attach',acknowledged:true});setMessage(result===false?'Context change not confirmed. Read the refreshed receipt before another deliberate action; nothing is retried automatically.':'Request sent. Read the refreshed context receipt and wording findings; final-post approval remains separate.');}
  catch{setMessage('Context outcome unconfirmed. Inspect the saved receipt before another deliberate action; no automatic retry was made.');}
  finally{lock.current=false;setPending(false);}
 }
 return <section aria-label="Owner-message context">
  <h3>Owner-message context</h3>
  <p>{context.status==='unattached'?'Owner self-report available for assistant import.':'Owner self-report, imported by the assistant.'} This is not independent verification or a claim that the owner personally reviewed a source in this app.</p>
  <p>{context.notice}</p><p>Current status: <strong>{context.status}</strong></p>
  {context.quote&&<><h4>Exact owner-supplied quotation</h4><blockquote>{context.quote}</blockquote></>}
  <p>Message reference: {context.message_reference||'Unavailable'}<br/>Drafting authorization reference: {context.authorization_reference||'Unavailable'}</p>
  {context.source_hash&&<p>Context statement SHA-256: <code>{context.source_hash}</code></p>}
  {context.version&&<p>Saved receipt version: <code>{context.version}</code></p>}
  <p>Only this task and its bound source/project may use the recorded context. Technical claims still need their original evidence. Attaching or revoking context invalidates previous review bindings; it does not call a model, approve, schedule or publish.</p>
  {valid?<><label><input type="checkbox" checked={ack} disabled={blocked} onChange={event=>setAck(event.target.checked)}/>{revoke?' Revoke use of this owner-message context for this task. Preserve its immutable history and require fresh review.':' Record the assistant’s import of this exact owner-supplied context for this task—not a personal owner source review or publication approval.'}</label>
  <button disabled={blocked||!ack} onClick={()=>void submit()}>{pending?'Recording context change…':revoke?'Revoke owner-message context':'Attach owner-message context'}</button></>:<p role="status">Context is unavailable or invalid for this task. No context change can be submitted.</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
