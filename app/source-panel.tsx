"use client";

import {useRef,useState,type CSSProperties} from "react";

type Source = {
  id:string;
  text:string;
  category:string;
  reported_date:string;
  hash:string;
  cleared:boolean;
  clearance_id?:string|null;
  clearance_hash?:string|null;
  clearance_provider?:string|null;
  clearance_purpose?:string|null;
  clearance_owner_acknowledged?:boolean|null;
  clearance_acknowledgement?:string|null;
  cleared_at?:string|null;
  revoked_at?:string|null;
};
type Action = (path:string,body:unknown)=>Promise<boolean>;
type Props = {
  sources:Source[];
  proposedSource:string;
  sourceApproved:boolean;
  intakeAuthorized:boolean;
  liveEnabled:boolean;
  busy:boolean;
  action:Action;
};
const categories = [
  {value:"project-note",label:"Project note"},
  {value:"build-log",label:"Build log"},
  {value:"lesson-learned",label:"Lesson learned"},
  {value:"user-reported-notes",label:"User-reported notes"},
];
const maxLength=12_000,maxBytes=32_000;
// Keep the visible owner acknowledgement identical to the server audit record.
const clearanceAcknowledgement="I am the owner and have reviewed this exact source text and hash. I authorize sending it to OpenAI for content drafts and revisions under the $10 monthly warning and $15 monthly cap. It contains no bank, client, private, confidential, or credential material. This does not authorize Gemini or publishing.";
const hasOwnerClearance=(source:Source)=>source.clearance_owner_acknowledged===true||[source.clearance_id,source.clearance_hash,source.clearance_provider,source.clearance_purpose,source.clearance_acknowledgement,source.cleared_at].some(value=>value!==undefined&&value!==null);
const field:CSSProperties={display:"block",width:"100%",maxWidth:"100%",boxSizing:"border-box",margin:"8px 0 16px",padding:"12px",borderRadius:"8px",background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b"};
const row:CSSProperties={display:"flex",gap:"12px",flexWrap:"wrap",alignItems:"center"};

function SourceCard({source,legacyApproved,intakeAuthorized,liveEnabled,busy,action}:{source:Source;legacyApproved:boolean;intakeAuthorized:boolean;liveEnabled:boolean;busy:boolean;action:Action}){
  const [acknowledged,setAcknowledged]=useState(false),[pending,setPending]=useState("");
  const inFlight=useRef(false);
  const cleared=source.cleared&&!source.revoked_at&&(legacyApproved||(
    !!source.clearance_id&&source.clearance_hash===source.hash&&
    source.clearance_provider==="openai"&&source.clearance_purpose==="content-drafts-revisions"&&
    source.clearance_owner_acknowledged===true&&source.clearance_acknowledgement===clearanceAcknowledgement&&
    !!source.cleared_at&&!Number.isNaN(new Date(source.cleared_at).getTime())
  ));
  const disabled=busy||!!pending;
  async function perform(path:string,body:unknown){
    if(inFlight.current)return;
    inFlight.current=true;setPending(path);
    try{await action(path,body);}
    finally{inFlight.current=false;setPending("");setAcknowledged(false);}
  }
  return <article aria-label={"Source note "+source.id.slice(0,8)}>
    <div style={row}><h3>Source note</h3><span className={"pill"+(cleared?"":" blocked")}>{cleared?"Cleared for OpenAI":source.revoked_at?"Clearance revoked":"Staged · not cleared"}</span></div>
    <p className="fine">{source.category} · Reported {source.reported_date} · {source.id.slice(0,8)}</p>
    <pre aria-label="Exact source note">{source.text}</pre>
    <p className="fine">SHA-256 <span aria-label="Source SHA-256">{source.hash}</span></p>
    <p className="fine">This saved text and its metadata are immutable. Add a new note for a correction and review its clearance separately.</p>
    {cleared?<>
      <p>{legacyApproved?"Consent recorded for this exact capsule.":"Clearance recorded for this exact note and hash: OpenAI, content drafts and revisions only."}</p>
      <div style={row}>
        <button className="primary" disabled={disabled||!liveEnabled||(!legacyApproved&&!intakeAuthorized)} onClick={()=>void perform("run",{source:source.id})}>{pending==="run"?"Queueing…":"Queue content workflow"}</button>
        <button disabled={disabled} onClick={()=>void perform("source-revoke",{source:source.id,expected_hash:source.hash})}>{pending==="source-revoke"?"Revoking…":"Revoke clearance"}</button>
      </div>
      {(!liveEnabled||(!legacyApproved&&!intakeAuthorized))&&<p className="fine">Execution is blocked until runtime transmission permission, secure credential setup, current pricing and the other authorization checks pass.</p>}
      <p className="fine">Revoking stops future use of this note. It cannot recall information already sent or interrupt a call in progress.</p>
    </>:<>
      <label style={{display:"flex",gap:"10px",alignItems:"flex-start",margin:"18px 0"}}>
        <input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event=>setAcknowledged(event.target.checked)} style={{marginTop:"5px",flexShrink:0}}/>
        <span>{clearanceAcknowledgement}</span>
      </label>
      <button className="primary" disabled={disabled||!acknowledged} onClick={()=>void perform("source-clear",{source:source.id,expected_hash:source.hash,acknowledged})}>{pending==="source-clear"?"Recording clearance…":"Clear this exact note for OpenAI"}</button>
      <p className="fine">Clearance is separate from staging. Recording it makes no model call. OpenAI is the only authorized provider; outreach remains disabled. Queue the workflow separately after clearance.</p>
      {!intakeAuthorized&&<p className="fine">Runtime transmission permission for new sources is not enabled for this session. You can record exact-note clearance here; model execution remains blocked until the separate runtime checks pass.</p>}
    </>}
  </article>;
}

export default function SourcePanel({sources,proposedSource,sourceApproved,intakeAuthorized,liveEnabled,busy,action}:Props){
  const [text,setText]=useState(""),[date,setDate]=useState(""),[category,setCategory]=useState("project-note"),[pending,setPending]=useState(false),[notice,setNotice]=useState("");
  const inFlight=useRef(false);
  const today=new Date().toISOString().slice(0,10);
  const bytes=new TextEncoder().encode(text).byteLength;
  const dateValue=new Date(date+"T00:00:00Z");
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(dateValue.getTime())&&dateValue.toISOString().slice(0,10)===date&&date<=today;
  const valid=!!text.trim()&&text.length<=maxLength&&bytes<=maxBytes&&validDate;
  const legacySaved=sources.some(source=>source.text===proposedSource&&source.category==="user-reported-notes"&&source.reported_date==="2026-10-09");
  async function stage(){
    if(inFlight.current||busy||!valid)return;
    inFlight.current=true;setPending(true);setNotice("");
    try{
      const saved=await action("source-stage",{text,category,reported_date:date});
      if(saved){setText("");setDate("");setNotice("Note staged. Review its saved text and SHA-256 below, then decide whether to clear it for OpenAI.");}
    }finally{inFlight.current=false;setPending(false);}
  }
  return <>
    <section aria-labelledby="source-intake-title">
      <span className="eyebrow">REAL EVIDENCE · OWNER REVIEW</span>
      <h2 id="source-intake-title">Stage a project note</h2>
      <p>Record something you actually worked on: what you tried, what happened, and what you can support. Keep uncertain details explicit.</p>
      <p>Do not include bank or client material, private or confidential information, credentials or secrets. Staging stores the note in this studio and makes no model call.</p>
      <form onSubmit={event=>{event.preventDefault();void stage();}}>
        <label htmlFor="source-note">Project note</label>
        <textarea id="source-note" style={{...field,resize:"vertical",minHeight:"180px"}} rows={8} maxLength={maxLength} value={text} disabled={busy||pending} onChange={event=>{setText(event.target.value);setNotice("");}} aria-describedby="source-limits" required/>
        <p id="source-limits" className="fine">{text.length.toLocaleString()} / 12,000 characters · {bytes.toLocaleString()} / 32,000 UTF-8 bytes. The exact text is preserved.</p>
        {bytes>maxBytes&&<p role="alert">This note exceeds the 32,000-byte limit. Shorten it before staging.</p>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 180px), 1fr))",gap:"0 18px"}}>
          <div><label htmlFor="source-category">Note type</label><select id="source-category" style={field} value={category} disabled={busy||pending} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div><label htmlFor="source-date">Reported date</label><input id="source-date" style={field} type="date" max={today} value={date} disabled={busy||pending} onChange={event=>setDate(event.target.value)} aria-describedby="source-date-help" required/></div>
        </div>
        <p id="source-date-help" className="fine">Choose the date of this note. Future dates are not allowed (UTC).</p>
        <button className="primary" type="submit" disabled={busy||pending||!valid}>{pending?"Staging…":"Stage note · no model call"}</button>
      </form>
      {notice&&<p role="status" aria-live="polite">{notice}</p>}
    </section>
    <section aria-labelledby="source-review-title">
      <span className="eyebrow">SEPARATE TRANSMISSION CLEARANCE</span>
      <h2 id="source-review-title">Review saved sources</h2>
      <p>Each note needs its own exact-version review. No source, consent checkbox or workflow is selected automatically.</p>
      {sources.length===0?<div className="empty"><h3>No sources saved</h3><p>Your workspace stays empty until you stage real evidence. Nothing is sent to a model until separately cleared and run.</p></div>:sources.map(source=><SourceCard key={[source.id,source.hash,source.cleared,source.clearance_id,source.revoked_at].join(":")} source={source} legacyApproved={sourceApproved&&!hasOwnerClearance(source)&&source.text===proposedSource&&source.category==="user-reported-notes"&&source.reported_date==="2026-10-09"} intakeAuthorized={intakeAuthorized} liveEnabled={liveEnabled} busy={busy} action={action}/>)}
    </section>
    {proposedSource&&<section aria-labelledby="legacy-source-title">
      <span className="eyebrow">USER-REPORTED NOTES · 9 OCTOBER 2026</span>
      <h2 id="legacy-source-title">The proposed source capsule</h2>
      <blockquote>{proposedSource}</blockquote>
      <p>No proven achievements or outcomes are inferred from these statements.</p>
      <button className="primary" disabled={busy||!sourceApproved||legacySaved} onClick={()=>void action("source",{})}>Save approved capsule</button>
      <p className="fine">{legacySaved?"This exact capsule is already saved.":sourceApproved?"Consent recorded for this exact capsule.":"Source consent pending. Saving is disabled."}</p>
    </section>}
  </>;
}
