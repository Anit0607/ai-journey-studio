"use client";
import {useRef,useState} from "react";
type Recovery={eligible:boolean;reason:string|null;expected:string;task_review_due:string};
type Props={entryId:string;recovery:Recovery|null;minimumLeadHours:number;busy:boolean;action:(path:string,body:unknown)=>Promise<void>};
export default function CalendarRecoveryForm({entryId,recovery,minimumLeadHours,busy,action}:Props){
 const [editing,setEditing]=useState(false),[expected,setExpected]=useState(""),[date,setDate]=useState(""),[time,setTime]=useState(""),[lead,setLead]=useState(String(minimumLeadHours)),[reason,setReason]=useState(""),[ack,setAck]=useState(false),[saving,setSaving]=useState(false);
 const inFlight=useRef(false);
 if(!recovery)return null;
 const stale=editing&&expected!==recovery.expected,valid=!!date&&!!time&&!!reason.trim()&&ack&&Number.isInteger(Number(lead))&&Number(lead)>=minimumLeadHours&&Number(lead)<=336;
 async function recover(){
  if(busy||inFlight.current||!recovery?.eligible||stale||!valid)return;
  inFlight.current=true;setSaving(true);setAck(false);
  try{await action("calendar-recover",{entry:entryId,expected,planned_date:date,post_time:time,generation_lead_hours:Number(lead),reason,acknowledged:true});}
  finally{inFlight.current=false;setSaving(false);}
 }
 return <div>
  <p>The review deadline saved with the dispatched draft has passed. Changing calendar settings does not rewrite that saved deadline.</p>
  {!recovery.eligible?<p role="status">Recovery unavailable: {recovery.reason}</p>:editing?<div>
   <p>This cancels the unfinished old task and creates a separate future plan on the same exact cleared source. Old artifacts, costs and history stay untouched. No draft is queued now and no model call is made. Normal future dispatch still needs the existing opt-in and safety checks; new content needs fresh approval. Nothing is published.</p>
   <label>New posting date (IST)<input aria-label="Recovery posting date IST" type="date" value={date} disabled={busy||saving} onChange={event=>{setDate(event.target.value);setAck(false);}}/></label>
   <label>New shared posting time (IST)<input aria-label="Recovery posting time IST" type="time" value={time} disabled={busy||saving} onChange={event=>{setTime(event.target.value);setAck(false);}}/></label>
   <p className="fine">The chosen time applies to LinkedIn, X and Instagram for this one new plan. Choose an unused date for this content format; existing entries are never overwritten.</p>
   <label>Generation lead (hours)<input aria-label="Recovery generation lead hours" type="number" min={minimumLeadHours} max={336} value={lead} disabled={busy||saving} onChange={event=>{setLead(event.target.value);setAck(false);}}/></label>
   <p className="fine">Choose a date far enough ahead that generation starts in the future, at least {minimumLeadHours} hours before posting. The review deadline remains 48 hours before posting.</p>
   <label>Reason for replanning<textarea aria-label="Recovery reason" maxLength={1000} value={reason} disabled={busy||saving} onChange={event=>{setReason(event.target.value);setAck(false);}}/></label>
   <label><input type="checkbox" checked={ack} disabled={busy||saving||stale} onChange={event=>setAck(event.target.checked)}/>I want to cancel this expired unfinished draft and create the separate future plan shown here, without copying approvals.</label>
   {stale&&<p role="status">The draft or its source changed. Close this form and reopen it to review the current recovery state.</p>}
   <button disabled={busy||saving||stale||!valid} onClick={()=>void recover()}>Cancel old draft and save future plan</button>
   <button disabled={busy||saving} onClick={()=>{setEditing(false);setAck(false);}}>Keep old draft</button>
  </div>:<button disabled={busy||saving} onClick={()=>{setExpected(recovery.expected);setAck(false);setEditing(true);}}>Replan overdue draft</button>}
 </div>;
}
