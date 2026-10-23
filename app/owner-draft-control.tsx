"use client";
import {useRef,useState} from "react";
type Props={task:Record<string,any>;source:Record<string,any>|undefined;execution:Record<string,any>;generationEnabled:boolean;busy:boolean;action:(path:string,body:unknown)=>Promise<boolean>};
export default function OwnerDraftControl(props:Props){
  const {task,source,execution}=props;
  const binding=JSON.stringify([task.id,task.updated,task.checkpoint,task.platform_policy_hash,source?.id,source?.hash,source?.clearance_id,source?.cleared,source?.revoked_at,execution.config_hash]);
  return <BoundOwnerDraftControl key={binding} {...props}/>;
}
function BoundOwnerDraftControl({task,source,execution,generationEnabled,busy,action}:Props){
  const [ack,setAck]=useState(false),[attempted,setAttempted]=useState(false);
  const inFlight=useRef(false);
  const run=execution.runs?.find((item:any)=>item.task_id===task.id);
  const eligible=typeof task.platform_policy_hash==="string"&&execution.runtime_ready&&generationEnabled&&task.status==="queued"&&task.checkpoint===0&&task.origin_key==="manual"&&!task.revision_parent_task_id&&source?.cleared&&!source?.revoked_at&&source?.clearance_id&&source.hash===task.source_hash&&!run;
  async function execute(){
    if(!eligible||!ack||busy||inFlight.current||attempted)return;
    inFlight.current=true;setAttempted(true);setAck(false);
    try{await action("owner-draft-run",{task_id:task.id,expected_source_id:source!.id,expected_source_hash:source!.hash,expected_clearance_id:source!.clearance_id,expected_updated:task.updated,expected_checkpoint:0,expected_config_hash:execution.config_hash,expected_platform_policy_hash:task.platform_policy_hash,acknowledged:true});}
    finally{inFlight.current=false;}
  }
  if(run)return <p role="status">Selected draft run: {run.status}{run.steps!==null?` · ${run.steps}/6 checkpoints`:""}. This one-shot attempt cannot be replayed. Review saved outputs and usage; uncertain calls require reconciliation.</p>;
  if(task.status!=="queued"||task.checkpoint!==0||task.origin_key!=="manual"||task.revision_parent_task_id)return null;
  return <section aria-label="Run this exact queued draft">
    <h4>Run only this queued draft</h4><p>No scheduler or other queued task is invoked. Up to six OpenAI calls with a total reservation ceiling of $0.13, within the existing monthly cap. No retries, revisions, approval or publishing are included. This task produces {task.content_brief?.platform_policy?"LinkedIn only":"LinkedIn, X and Instagram (legacy scope)"}; this does not activate any platform account.</p>
    {source&&<><pre>{source.text}</pre><small>Source {source.id} · SHA-256 {source.hash} · Clearance {source.clearance_id}</small></>}
    <p>Task {task.id} · checkpoint 0 · Model {execution.model||"unavailable"}</p>
    {!generationEnabled&&<p>Drafting is OFF. Enable drafting separately in Calendar before this deliberate action; this control does not change that setting.</p>}
    {!execution.runtime_ready&&<p>Owner draft runtime checks are not ready.</p>}
    <label><input type="checkbox" checked={ack} disabled={!eligible||busy||attempted} onChange={e=>setAck(e.target.checked)}/> I approve sending this exact cleared source through this task’s six draft stages to OpenAI, with at most $0.13 reserved. I understand this does not publish anything.</label>
    <button disabled={!eligible||!ack||busy||attempted} onClick={()=>void execute()}>Run this exact draft once · max $0.13</button>
    {attempted&&<p role="status">Attempt submitted. Check saved run status and usage; do not retry if the response is interrupted.</p>}
  </section>;
}
