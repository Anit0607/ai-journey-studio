"use client";
import {useRef,useState} from 'react';
type Props={entryId:string;preview:any;busy:boolean;action:(path:string,body:unknown)=>Promise<void>};
export default function CalendarGenerationForm(props:Props){return <BoundGenerationForm key={props.entryId+':'+props.preview?.expected_preview} {...props}/>;}
function BoundGenerationForm({entryId,preview,busy,action}:Props){
 const [ack,setAck]=useState(false),[attempted,setAttempted]=useState(false);const inFlight=useRef(false);
 if(!preview?.eligible||!preview.expected_preview)return null;
 async function save(){
  if(!ack||busy||inFlight.current||attempted)return;
  inFlight.current=true;setAttempted(true);setAck(false);
  try{await action('calendar-generation-now',{entry_id:entryId,expected_preview:preview.expected_preview,requested_generation_time:'server_now',acknowledged:true});}finally{inFlight.current=false;}
 }
 return <section aria-label="Bring this draft forward">
  <h4>Draft this planned post sooner</h4><p>{preview.notice}</p>
  <p>Uses the active bounded GitHub policy, not a claim that you personally reviewed a source. Final post approval remains separate.</p>
  <label><input type="checkbox" checked={ack} disabled={busy||attempted} onChange={event=>setAck(event.target.checked)}/> Bring only this plan’s generation forward to the current server time when saved. Keep its posting and review times unchanged.</label>
  <button disabled={busy||attempted||!ack} onClick={()=>void save()}>Make this draft due now · no model call</button>
  <p className="fine">After saving, use the existing due queue and exact-Calendar draft control. This changes no source permission, recurring setting or publication approval.</p>
  {attempted&&<p role="status">Timing request submitted. Refresh and inspect the saved generation time; do not submit a replacement after an uncertain response.</p>}
 </section>;
}
