"use client";
import EvidencePanel from "./evidence-panel";
import {useEffect,useId,useReducer,useRef,useState,type CSSProperties} from "react";
const textStyle:CSSProperties={display:"block",width:"100%",boxSizing:"border-box",background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b",padding:"12px",margin:"8px 0"};
type Version={token:string;sequence:number;bundle:Record<string,string>};
type Snapshot=Version&{versions:Version[]};
type PendingSave={role:string;text:string;token?:string;unverified?:boolean};
export type RevisionEditor={base:Version;latest:Snapshot;drafts:Record<string,string>;pending:PendingSave|null;message:string;seen:string[]};
type EditorEvent={type:"review";review:any}|{type:"draft";role:string;text:string}|{type:"start";role:string;text:string}|{type:"saved";result:any}|{type:"finished"}|{type:"failed"}|{type:"rebase"};
const bundleText=(bundle:any[])=>Object.fromEntries(bundle.map(item=>[item.role,item.text])) as Record<string,string>;
function snapshot(review:any):Snapshot{
  const versions=(review.history||[]).map((item:any,index:number)=>({token:`revision:${item.id}:${item.version}`,sequence:Number(item.sequence)||index+1,bundle:bundleText(item.bundle)}));
  return {token:review.token,sequence:versions.at(-1)?.sequence||0,bundle:bundleText(review.bundle),versions};
}
export function createRevisionEditor(review:any):RevisionEditor{
  const latest=snapshot(review);
  return {base:latest,latest,drafts:{...latest.bundle},pending:null,message:"",seen:[latest.token]};
}
export const unsavedRevisionRoles=(state:RevisionEditor)=>Object.keys(state.drafts).filter(role=>state.drafts[role]!==state.base.bundle[role]);
function keepDrafts(state:RevisionEditor,next:Version){
  const drafts={...next.bundle};
  for(const role of unsavedRevisionRoles(state))drafts[role]=state.drafts[role];
  return drafts;
}
function reconcileSave(state:RevisionEditor):RevisionEditor{
  if(!state.pending?.token)return state;
  const saved=state.latest.token===state.pending.token?state.latest:state.latest.versions.find(item=>item.token===state.pending?.token);
  if(!saved)return state;
  const drafts=keepDrafts(state,saved);
  // Text typed while the request was in flight remains a new unsaved draft.
  drafts[state.pending.role]=state.drafts[state.pending.role]===state.pending.text?saved.bundle[state.pending.role]:state.drafts[state.pending.role];
  return {...state,base:saved,drafts,pending:null,message:`Saved ${state.pending.role} as a new revision. Other unsaved roles were not saved.`};
}
export function reduceRevisionEditor(state:RevisionEditor,event:EditorEvent):RevisionEditor{
  switch(event.type){
    case "draft":return {...state,drafts:{...state.drafts,[event.role]:event.text}};
    case "start":return state.pending?state:{...state,pending:{role:event.role,text:event.text},message:"Saving one artifact…"};
    case "saved":{
      if(!state.pending)return state;
      const result=event.result;
      if(typeof result?.id!=="string"||!result.id||typeof result?.version!=="string"||!result.version)return {...state,pending:{...state.pending,unverified:true},message:"Save reported success, but its exact version could not be verified. Drafts are kept; refresh and compare the latest version before continuing."};
      return reconcileSave({...state,pending:{...state.pending,token:`revision:${result.id}:${result.version}`},message:"Save accepted. Waiting for the saved version to refresh; all drafts are kept."});
    }
    case "finished":return state.pending&&!state.pending.token?{...state,pending:{...state.pending,unverified:true},message:"Save reported success, but its exact version could not be verified. Drafts are kept; refresh and compare the latest version before continuing."}:state;
    case "failed":return {...state,pending:null,message:"Save was not confirmed. Your drafts and revision note are kept. Check the action error; refresh if the outcome is uncertain."};
    case "rebase":{
      if(state.pending&&(!state.pending.unverified||state.base.token===state.latest.token))return state;
      const drafts=keepDrafts(state,state.latest);
      // An unverified save may have committed after the owner reverted its text.
      if(state.pending)drafts[state.pending.role]=state.drafts[state.pending.role];
      return {...state,pending:null,base:state.latest,drafts,message:"Unsaved drafts kept on the latest saved version. Save each changed role separately."};
    }
    case "review":{
      const next=snapshot(event.review);
      // Ignore delayed snapshots: sequence, not timestamps, orders immutable revisions.
      if(next.token===state.latest.token||next.sequence<state.latest.sequence||state.seen.includes(next.token))return state;
      let updated=reconcileSave({...state,latest:next,seen:[...state.seen,next.token]});
      // An external change never silently rebases unsaved work.
      if(!updated.pending&&!unsavedRevisionRoles(updated).length)updated={...updated,base:next,drafts:{...next.bundle}};
      return updated;
    }
  }
}
export function revisionSaveReason(state:RevisionEditor,role:string,note:string,busy:boolean){
  if(busy)return "A request is in progress. Wait before saving again.";
  if(state.pending)return "Waiting to verify the saved version. Use workspace Refresh; your drafts are kept.";
  if(state.base.token!==state.latest.token)return "A newer saved version is available. Compare it below and keep your drafts on that version before saving.";
  if(!note.trim())return "Add a revision note before saving this artifact.";
  if(!state.drafts[role]?.trim())return "Revised text cannot be empty.";
  if(!unsavedRevisionRoles(state).includes(role))return `No unsaved changes for ${role}. Choose a role marked Unsaved or edit its text.`;
  return "";
}
type Action=(path:string,body:unknown,onSaved?:(result:unknown)=>void)=>Promise<unknown>;
export default function RevisionPanel({task,review,busy,action,agentRevisionEligible=false}:{task:string;review:any;busy:boolean;action:Action;agentRevisionEligible?:boolean}){
  const [note,setNote]=useState(""),[role,setRole]=useState("Writer"),[editing,setEditing]=useState(false),[ack,setAck]=useState(false),[ackToken,setAckToken]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const [editor,dispatch]=useReducer(reduceRevisionEditor,review,createRevisionEditor);
  const saveInFlight=useRef(false),reasonId=useId();
  const unsaved=unsavedRevisionRoles(editor),stale=editor.base.token!==editor.latest.token;
  const pending=review.pending_agent_revision;
  const existing=(review.agent_revision_jobs||[]).find((job:any)=>job.revision_base_token===review.token);
  const canRequestAgent=agentRevisionEligible&&!review.is_agent_revision&&!pending&&!existing;
  const approvalToken=[review.token,review.quality.binding,review.quality.evidence_version].join(":");
  const acknowledged=ack&&ackToken===approvalToken;
  const saveReason=revisionSaveReason(editor,role,note,busy||saving);
  useEffect(()=>{dispatch({type:"review",review});},[review]);
  useEffect(()=>{setAck(false);setAckToken(null);},[approvalToken]);
  useEffect(()=>{
    if(!unsaved.length&&!editor.pending)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[unsaved.length,editor.pending]);
  async function save(){
    if(saveInFlight.current||saveReason)return;
    saveInFlight.current=true;setSaving(true);setAck(false);
    const text=editor.drafts[role];
    dispatch({type:"start",role,text});
    try{
      const saved=await action("revise",{task,expected:editor.base.token,note,role,text},result=>dispatch({type:"saved",result}));
      dispatch({type:saved===false?"failed":"finished"});
    }catch{
      dispatch({type:"failed"});
    }finally{saveInFlight.current=false;setSaving(false);}
  }
  return <section aria-label="Revision workflow">
    <p><strong>User approval:</strong> {pending?"agent revision pending; approval blocked":review.approval?"approved for this exact version":"fresh approval required"} · <strong>Factual quality:</strong> {review.quality.status.replaceAll("_"," ")}</p>
    <p>Original approval remains in history. Approval does not establish truth or authorize publishing.</p>
    <p className="fine">{review.quality.notice}</p>
    {review.quality.editorial&&<section aria-label="Editorial review"><h3>Story and reader value</h3><p><strong>{review.quality.editorial.status.replaceAll("_"," ")}</strong></p><p>{review.quality.editorial.notice}</p>{review.quality.editorial.issues.map((issue:any,index:number)=><p key={index}><strong>{issue.role}:</strong> {issue.message}</p>)}</section>}
    {review.quality.flags.length>0&&<details><summary>Source-grounding flags ({review.quality.flags.length})</summary>{review.quality.flags.map((flag:any,index:number)=><p key={index}><strong>{flag.role}:</strong> {flag.claim}<br/>{flag.reason}</p>)}</details>}
    <EvidencePanel quality={review.quality} task={task} token={review.token} busy={busy||saving} action={action}/>
    <label>Reason / revision note<textarea style={textStyle} aria-label="Revision note" value={note} maxLength={1000} onChange={event=>setNote(event.target.value)}/></label>
    <p className="fine">Feedback may change tone or structure. New personal facts need their own cleared source. Do not include bank, client, private, confidential, or credential material.</p>
    <button disabled={busy||saving||!!editor.pending||!note.trim()||!canRequestAgent} onClick={async()=>{setAck(false);await action("agent-revise",{task,expected:review.token,note});}}>Request agent revision</button>
    <p className="fine">Queues all six roles through the existing OpenAI budget and worker checks. It requires fresh approval when complete and never publishes. {!agentRevisionEligible&&"Standing permission for owner-cleared OpenAI drafts and revisions is required."}</p>
    {existing&&!pending&&<p className="fine">This exact version already has an agent revision request ({existing.status}). It will not be restarted automatically. Use Request changes to create a new version before requesting different feedback.</p>}
    {pending&&<div role="status"><p>Agent revision {pending.status}. {pending.status==="blocked"?"Resolve the blocker or cancel this request before approval.":"The current content stays unchanged until the complete revision is ready."}</p><button disabled={busy||saving} onClick={()=>void action("cancel",{task:pending.id})}>Cancel agent revision</button><p className="fine">Cancellation stops future calls; any in-flight usage still counts.</p></div>}
    <button disabled={busy||saving||!!editor.pending||!note.trim()} onClick={()=>void action("request-changes",{task,expected:review.token,note})}>Request changes</button>
    <p className="fine">Request changes creates a manual-edit copy without a model call. {pending&&"Creating or editing a manual revision makes the pending agent request stale. Cancel it first if you want to replace it."}</p>
    {review.latest_revision&&<>
      <button disabled={busy||saving} onClick={()=>{setEditing(!editing);setAck(false);}}>{editing?"Hide editor (keep drafts)":"Edit revision"}</button>
      <p role="status">{unsaved.length?`Unsaved roles (${unsaved.length}): ${unsaved.join(", ")}.`:"All editor roles match their saved version."}</p>
      {editing&&<section aria-label="Manual revision editor">
        <h3>Edit one artifact at a time</h3>
        <p>Switching artifacts keeps your unsaved text. Saving creates one new revision for the selected role only; it does not save the other roles or approve anything.</p>
        <p className="fine">Drafts are kept only in this open editor. Workspace Refresh is safe; save each role before leaving this screen, signing out, or reloading the browser.</p>
        {editor.message&&<p role="status">{editor.message}</p>}
        {stale&&<div role="status"><p>A newer version is available. Your unsaved text has not been replaced. Compare the latest saved text before keeping your drafts on the new version.</p>
          <details><summary>Compare latest saved artifacts</summary>{Object.entries(editor.latest.bundle).map(([name,text])=><details key={name}><summary>{name}{editor.base.bundle[name]!==text?" · changed on server":" · unchanged on server"}{unsaved.includes(name)?" · local draft kept":""}</summary><pre>{text}</pre></details>)}</details>
          <button disabled={busy||saving||!!editor.pending&&!editor.pending.unverified} onClick={()=>{dispatch({type:"rebase"});setAck(false);}}>Keep my unsaved drafts on latest version</button>
          <p className="fine">This keeps your edited text, updates untouched roles, and changes only the version used for the next save. It does not save or approve anything.</p>
        </div>}
        <label>Artifact<select aria-label="Revision artifact" value={role} onChange={event=>setRole(event.target.value)}>{Object.keys(editor.drafts).map(name=><option key={name} value={name}>{name} · {unsaved.includes(name)?"Unsaved":"Saved"}</option>)}</select></label>
        <label>Revised text<textarea style={textStyle} aria-label="Revised text" rows={14} value={editor.drafts[role]||""} onChange={event=>{dispatch({type:"draft",role,text:event.target.value});setAck(false);}}/></label>
        <label>Revision note (required for this save)<textarea style={textStyle} aria-label="Manual revision note" value={note} maxLength={1000} rows={2} onChange={event=>setNote(event.target.value)}/></label>
        <p id={reasonId} role="status">{saveReason||`Ready to save ${role} only. ${unsaved.length>1?`${unsaved.length-1} other unsaved role(s) will stay in the editor.`:"Fresh approval will still be required."}`}</p>
        <button disabled={!!saveReason} aria-describedby={reasonId} onClick={()=>void save()}>{saving?`Saving ${role}…`:`Save ${role} only`}</button>
      </section>}
      <section aria-label="Separate revision approval"><h3>Approve saved artifacts separately</h3>
        <p>Approval applies only to the saved version, never to unsaved editor drafts.</p>
        {unsaved.length>0&&<p>Save your unsaved roles before reviewing the complete saved revision for approval.</p>}
        <label><input type="checkbox" disabled={busy||saving||!!editor.pending||unsaved.length>0||stale} checked={acknowledged} onChange={event=>{setAck(event.target.checked);setAckToken(approvalToken);}}/> I reviewed all six current artifacts against the cleared note and the practical-journey brief, including the specific method, reader value and natural voice; approval is not publishing.</label>
        <button disabled={busy||saving||!!editor.pending||unsaved.length>0||stale||!acknowledged||!!review.approval||!!pending||!!review.is_agent_revision||review.quality.flags.length>0||review.quality.editorial?.blocking} onClick={()=>void action("approve-revision",{task,expected:review.token,acknowledged})}>Approve this exact revision</button>
      </section>
    </>}
    <details><summary>Original artifacts · {review.original_approval?"historical user approval preserved":"not approved"}</summary>{review.original_bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>
    {review.history.length>0&&<details><summary>Immutable revision history ({review.history.length})</summary>{review.history.map((revision:any)=><details key={revision.id}><summary>{revision.created} · {revision.approval?"user approved":"not approved"} · {revision.request_note}</summary>{revision.bundle.map((item:any)=><details key={item.role}><summary>{item.role}</summary><pre>{item.text}</pre><small>SHA-256 {item.hash}</small></details>)}</details>)}</details>}
    {review.agent_revision_jobs?.length>0&&<details><summary>Agent revision requests ({review.agent_revision_jobs.length})</summary>{review.agent_revision_jobs.map((job:any)=><p key={job.id}>{job.status} · {job.checkpoint}/6 artifacts · {job.revision_note}{job.block_reason?" · "+job.block_reason:""}</p>)}</details>}
  </section>;
}
