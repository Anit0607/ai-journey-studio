"use client";
import {useRef,useState} from "react";
import {currentApprovalPlanContract,type ApprovalPlan} from "../lib/approval-plan-contract";

// Browser-safe display data and consent text only; no server implementation import.
type Props={preview:{plan:ApprovalPlan|null;reason?:string};publishingEnabled?:boolean;busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>};
export default function ApprovalPlanPanel(props:Props){
  if(props.preview.plan&&!currentApprovalPlanContract(props.preview.plan))return <section aria-label="Automatic LinkedIn approval"><p>Approval acknowledgement changed. Refresh to review the current final-post approval before continuing.</p></section>;
  return props.preview.plan?<ExactPlan key={props.preview.plan.version} {...props} plan={props.preview.plan}/>:<section aria-label="Automatic LinkedIn approval"><p>Automatic LinkedIn plan unavailable: {props.preview.reason}</p><p>The assistant must resolve the stated content-review, owner-approved calendar linkage or verified-destination blocker before this plan can be approved. No posting time or destination has been chosen automatically.</p></section>;
}
function ExactPlan({plan,publishingEnabled,busy,action}:Props&{plan:ApprovalPlan}){
  const [ack,setAck]=useState(false),[pending,setPending]=useState(false),[submitted,setSubmitted]=useState(false),lock=useRef(false);
  async function approve(){
    if(busy||!ack||lock.current||submitted||!currentApprovalPlanContract(plan))return;
    lock.current=true;setPending(true);setAck(false);
    try{const result=await action("approval-plan-approve",{task_id:plan.task_id,review_token:plan.review_token,expected_plan:plan.version,acknowledgement_version:plan.acknowledgement_version,acknowledgement:plan.acknowledgement,acknowledgement_hash:plan.acknowledgement_hash,acknowledged:true});if(result!==false)setSubmitted(true);}
    finally{lock.current=false;setPending(false);}
  }
  const ist=new Date(plan.scheduled_at).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  return <section aria-label="Automatic LinkedIn approval">
    <h3>Approve final LinkedIn post</h3>
    <pre>{plan.text}</pre>
    <p>Destination: <strong>{plan.account_label}</strong> · {plan.remote_id} · {plan.account_id}<br/>Authorization version: {plan.account_version}</p>
    <p>Existing calendar time (IST · Asia/Kolkata): <strong>{ist}</strong><br/>UTC: <strong>{plan.scheduled_at}</strong></p>
    <p>Delivery mode: scheduled automatic publication.</p>
    <p>Factual-review status: current source/privacy and source-grounding checks passed; no unresolved flags. This is not independent factual verification.</p>
    <p>Review this final post for a specific supported problem, decision or method, reader value and natural voice. Factual checks alone do not establish content quality. Six-stage artifacts and source details are optional context; this approval does not claim you personally reviewed them.</p>
    <details><summary>Optional exact-version details</summary><p className="fine">Source SHA-256 {plan.source_hash}<br/>Review {plan.review_token}<br/>LinkedIn draft SHA-256 {plan.variant_hash}<br/>Scheduler policy SHA-256 {plan.scheduler_policy_hash||"generic cadence"}<br/>Acknowledgement version {plan.acknowledgement_version} · SHA-256 {plan.acknowledgement_hash}<br/>Plan SHA-256 {plan.version}</p></details>
    <label><input type="checkbox" checked={ack} disabled={busy||pending||submitted} onChange={event=>setAck(event.target.checked)}/>{plan.acknowledgement}</label>
    <button disabled={busy||pending||submitted||!ack} onClick={()=>void approve()}>Approve this exact post and publication plan</button>
    <p>One approval records your final-post decision and the exact delivery plan, retaining the current factual-review bindings. Delivery still requires authorized publishing credentials and dispatch; OFF switches continue to block it. Approval is not a delivery receipt.</p>
    <p>{publishingEnabled?"Publishing configuration is ON; this does not verify an active scheduler or successful delivery.":"Publishing is OFF. An approved plan is held and cannot be delivered while OFF."}</p>
    {submitted&&<p role="status">Approval saved. Check the publication plan and eventual provider receipt.</p>}
  </section>;
}
