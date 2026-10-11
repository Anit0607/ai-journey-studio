"use client";
import {useState,type CSSProperties} from "react";
const textStyle:CSSProperties={display:"block",width:"100%",boxSizing:"border-box",background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b",padding:"12px",margin:"8px 0"};
export default function RevisionPanel({task,review,busy,action,agentRevisionEligible=false}:{task:string;review:any;busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>;agentRevisionEligible?:boolean}){
  const [note,setNote]=useState(""),[role,setRole]=useState("Writer"),[text,setText]=useState(""),[editing,setEditing]=useState(false),[ack,setAck]=useState(false),[ackToken,setAckToken]=useState<string|null>(null),[editBase,setEditBase]=useState<string|null>(null);
  const pending=review.pending_agent_revision;
  const existing=(review.agent_revision_jobs||[]).find((job:any)=>job.revision_base_token===review.token);
  const canRequestAgent=agentRevisionEligible&&!review.is_agent_revision&&!pending&&!existing;
  const acknowledged=ack&&ackToken===review.token;
  return <section aria-label="Revision workflow">
    <p><strong>User approval:</strong> {pending?"agent revision pending; approval blocked":review.approval?"approved for this exact version":"fresh approval required"} · <strong>Factual quality:</strong> {review.quality.status.replaceAll("_"," ")}</p>
    <p>Original approval remains in history. Approval does not establish truth or authorize publishing.</p>
    <p className="fine">{review.quality.notice}</p>
    {review.quality.flags.length>0&&<details><summary>Source-grounding flags ({review.quality.flags.length})</summary>{review.quality.flags.map((flag:any,index:number)=><p key={index}><strong>{flag.role}:</strong> {flag.claim}<br/>{flag.reason}</p>)}</details>}
    <label>Reason / revision note<textarea style={textStyle} aria-label="Revision note" value={note} maxLength={1000} onChange={event=>setNote(event.target.value)}/></label>
    <p className="fine">Feedback may change tone or structure. New personal facts need their own cleared source. Do not include bank, client, private, confidential, or credential material.</p>
    <button disabled={busy||!note.trim()||!canRequestAgent} onClick={async()=>{setAck(false);await action("agent-revise",{task,expected:review.token,note});}}>Request agent revision</button>
    <p className="fine">Queues all six roles through the existing OpenAI budget and worker checks. It requires fresh approval when complete and never publishes. {!agentRevisionEligible&&"Standing permission for owner-cleared OpenAI drafts and revisions is required."}</p>
    {existing&&!pending&&<p className="fine">This exact version already has an agent revision request ({existing.status}). It will not be restarted automatically. Use Request changes to create a new version before requesting different feedback.</p>}
    {pending&&<div role="status"><p>Agent revision {pending.status}. {pending.status==="blocked"?"Resolve the blocker or cancel this request before approval.":"The current content stays unchanged until the complete revision is ready."}</p><button disabled={busy} onClick={()=>void action("cancel",{task:pending.id})}>Cancel agent revision</button><p className="fine">Cancellation stops future calls; any in-flight usage still counts.</p></div>}
    <button disabled={busy||!note.trim()} onClick={()=>void action("request-changes",{task,expected:review.token,note})}>Request changes</button>
    <p className="fine">Request changes creates a manual-edit copy without a model call. {pending&&"Creating or editing a manual revision makes the pending agent request stale. Cancel it first if you want to replace it."}</p>
    {review.latest_revision&&<>
      <button disabled={busy} onClick={()=>{setEditing(!editing);setEditBase(review.token);setText(review.bundle.find((item:any)=>item.role===role)?.text||"");setAck(false);}}>Edit revision</button>
      {editing&&<div>{editBase!==review.token&&<p role="status">A newer version is available. Close and reopen the editor before saving.</p>}<label>Artifact<select aria-label="Revision artifact" value={role} onChange={event=>{setRole(event.target.value);setText(review.bundle.find((item:any)=>item.role===event.target.value)?.text||"");}}>{review.bundle.map((item:any)=><option key={item.role}>{item.role}</option>)}</select></label><label>Revised text<textarea style={textStyle} aria-label="Revised text" rows={14} value={text} onChange={event=>{setText(event.target.value);setAck(false);}}/></label><button disabled={busy||!note.trim()||!text.trim()||editBase!==review.token} onClick={async()=>{const saved=await action("revise",{task,expected:editBase,note,role,text});if(saved!==false){setEditing(false);setAck(false);}}}>Save new revision</button></div>}
      <label><input type="checkbox" checked={acknowledged} onChange={event=>{setAck(event.target.checked);setAckToken(review.token);}}/> I reviewed all six current artifacts against the cleared note; approval is not publishing.</label>
      <button disabled={busy||!acknowledged||!!review.approval||!!pending||!!review.is_agent_revision||review.quality.flags.length>0} onClick={()=>void action("approve-revision",{task,expected:review.token,acknowledged})}>Approve this exact revision</button>
    </>}
    <details><summary>Original artifacts · {review.original_approval?"historical user approval preserved":"not approved"}</summary>{review.original_bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>
    {review.history.length>0&&<details><summary>Immutable revision history ({review.history.length})</summary>{review.history.map((revision:any)=><details key={revision.id}><summary>{revision.created} · {revision.approval?"user approved":"not approved"} · {revision.request_note}</summary>{revision.bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>)}</details>}
    {review.agent_revision_jobs?.length>0&&<details><summary>Agent revision requests ({review.agent_revision_jobs.length})</summary>{review.agent_revision_jobs.map((job:any)=><p key={job.id}>{job.status} · {job.checkpoint}/6 artifacts · {job.revision_note}{job.block_reason?" · "+job.block_reason:""}</p>)}</details>}
  </section>;
}
