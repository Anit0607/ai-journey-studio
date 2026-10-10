"use client";
import {useState,type CSSProperties} from "react";
const textStyle:CSSProperties={display:"block",width:"100%",boxSizing:"border-box",background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b",padding:"12px",margin:"8px 0"};
export default function RevisionPanel({task,review,busy,action}:{task:string;review:any;busy:boolean;action:(path:string,body:unknown)=>Promise<void>}){
  const [note,setNote]=useState(""),[role,setRole]=useState("Writer"),[text,setText]=useState(""),[editing,setEditing]=useState(false),[ack,setAck]=useState(false);
  return <section aria-label="Revision workflow">
    <p><strong>User approval:</strong> {review.approval?"approved for this exact version":"fresh approval required"} · <strong>Factual quality:</strong> {review.quality.status.replaceAll("_"," ")}</p>
    <p>Original approval remains in history. Approval does not establish truth or authorize publishing.</p>
    <p className="fine">{review.quality.notice}</p>
    {review.quality.flags.length>0&&<details><summary>Source-grounding flags ({review.quality.flags.length})</summary>{review.quality.flags.map((flag:any,index:number)=><p key={index}><strong>{flag.role}:</strong> {flag.claim}<br/>{flag.reason}</p>)}</details>}
    <label>Reason / revision note<textarea style={textStyle} aria-label="Revision note" value={note} maxLength={1000} onChange={event=>setNote(event.target.value)}/></label>
    <button disabled={busy||!note.trim()} onClick={()=>void action("request-changes",{task,expected:review.token,note})}>Request changes</button>
    {review.latest_revision&&<>
      <button disabled={busy} onClick={()=>{setEditing(!editing);setText(review.bundle.find((item:any)=>item.role===role)?.text||"");setAck(false);}}>Edit revision</button>
      {editing&&<div><label>Artifact<select aria-label="Revision artifact" value={role} onChange={event=>{setRole(event.target.value);setText(review.bundle.find((item:any)=>item.role===event.target.value)?.text||"");}}>{review.bundle.map((item:any)=><option key={item.role}>{item.role}</option>)}</select></label><label>Revised text<textarea style={textStyle} aria-label="Revised text" rows={14} value={text} onChange={event=>{setText(event.target.value);setAck(false);}}/></label><button disabled={busy||!note.trim()||!text.trim()} onClick={async()=>{await action("revise",{task,expected:review.token,note,role,text});setAck(false);}}>Save new revision</button></div>}
      <label><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/> I reviewed all six current artifacts against the cleared note; approval is not publishing.</label>
      <button disabled={busy||!ack||!!review.approval||review.quality.flags.length>0} onClick={()=>void action("approve-revision",{task,expected:review.token,acknowledged:ack})}>Approve this exact revision</button>
    </>}
    <details><summary>Original artifacts · {review.original_approval?"historical user approval preserved":"not approved"}</summary>{review.original_bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>
    {review.history.length>0&&<details><summary>Immutable revision history ({review.history.length})</summary>{review.history.map((revision:any)=><details key={revision.id}><summary>{revision.created} · {revision.approval?"user approved":"not approved"} · {revision.request_note}</summary>{revision.bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>)}</details>}
  </section>;
}
