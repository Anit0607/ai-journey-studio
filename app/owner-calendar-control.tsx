"use client";
import {useRef,useState} from "react";
type Props={taskId:string;execution:Record<string,any>;busy:boolean;action:(path:string,body:unknown)=>Promise<boolean>};
export default function OwnerCalendarControl(props:Props){
  const preview=props.execution.previews?.find((item:any)=>item.task_id===props.taskId);
  return <BoundOwnerCalendarControl key={[props.taskId,preview?.version,props.execution.runtime_ready].join(":")} {...props} preview={preview}/>;
}
function BoundOwnerCalendarControl({taskId,execution,busy,action,preview}:Props&{preview:any}){
  const [ack,setAck]=useState(false),[attempted,setAttempted]=useState(false),inFlight=useRef(false);
  const run=execution.runs?.find((item:any)=>item.task_id===taskId);
  const eligible=!!preview&&execution.runtime_ready&&!run;
  async function execute(){
    if(!eligible||!ack||busy||attempted||inFlight.current)return;
    inFlight.current=true;setAttempted(true);setAck(false);
    try{await action("owner-calendar-run",{task_id:taskId,expected_preview:preview.version,acknowledged:true});}finally{inFlight.current=false;}
  }
  if(run)return <p role="status">Selected Calendar run: {run.status}{run.steps!==null?` · ${run.steps}/6 checkpoints`:""}. This one-shot attempt cannot be replayed. Review saved outputs and usage; uncertain calls require reconciliation.</p>;
  if(!preview)return null;
  return <section aria-label="Run this exact Calendar draft">
    <h4>Run this exact Calendar {preview.mode==="revision"?"revision":"draft"} now</h4>
    <p>Only this queued task runs, with up to six OpenAI calls and a total reservation ceiling of $0.13 within the existing monthly cap. No source selection, schedule changes, daily-batch reset, retries, approval or publishing.</p>
    <pre>{preview.source.text}</pre><small>Source {preview.source.id} · SHA-256 {preview.source.hash}</small>
    <p>Task {taskId} · Mode {preview.mode} · Model {preview.model}</p>
    <p>Calendar entry {preview.entry_id} · Generation due {preview.generation_due} · Review due {preview.review_due} · Intended post {preview.intended_post}</p>
    <small>Policy {preview.policy_id} · Grant {preview.grant_id}</small>
    {preview.mode==="revision"&&<><p>Parent {preview.parent_id} · Exact base {preview.parent_token}</p><pre>{preview.feedback}</pre><p>The current parent content stays unchanged until all six artifacts finish. Fresh approval is required.</p></>}
    <label><input type="checkbox" checked={ack} disabled={!eligible||busy||attempted} onChange={e=>setAck(e.target.checked)}/> Run only this exact preview through six OpenAI draft stages, with at most $0.13 reserved under my existing source permission. This does not approve, schedule or publish a post.</label>
    <button disabled={!eligible||!ack||busy||attempted} onClick={()=>void execute()}>Run this Calendar draft once · max $0.13</button>
    {attempted&&<p role="status">Attempt submitted. Check saved run status and usage; do not retry if the response is interrupted.</p>}
  </section>;
}
