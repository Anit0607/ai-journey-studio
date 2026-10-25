"use client";
import {useRef,useState} from "react";
import {APPROVAL_PLAN_ACK,type ApprovalPlan} from "../lib/approval-plan-contract";

// Browser-safe display data and consent text only; no server implementation import.
type Props={preview:{plan:ApprovalPlan|null;reason?:string};publishingEnabled?:boolean;busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>};
export default function ApprovalPlanPanel(props:Props){
  return props.preview.plan?<ExactPlan key={props.preview.plan.version} {...props} plan={props.preview.plan}/>:<section aria-label="Automatic LinkedIn approval"><p>Automatic LinkedIn plan unavailable: {props.preview.reason}</p><p>The assistant must resolve the stated content-review, owner-approved calendar linkage or verified-destination blocker before this plan can be approved. No posting time or destination has been chosen automatically.</p></section>;
}
function ExactPlan({plan,publishingEnabled,busy,action}:Props&{plan:ApprovalPlan}){
  const [ack,setAck]=useState(false),[pending,setPending]=useState(false),[submitted,setSubmitted]=useState(false),lock=useRef(false);
  async function approve(){
    if(busy||!ack||lock.current||submitted)return;
    lock.current=true;setPending(true);setAck(false);
    try{const result=await action("approval-plan-approve",{task_id:plan.task_id,review_token:plan.review_token,expected_plan:plan.version,acknowledged:true});if(result!==false)setSubmitted(true);}
    finally{lock.current=false;setPending(false);}
  }
  return <section aria-label="Automatic LinkedIn approval">
    <h3>Approve exact LinkedIn publication</h3>
    <p>Destination: <strong>{plan.account_label}</strong> · {plan.remote_id} · {plan.account_id}<br/>Authorization version: {plan.account_version}</p>
    <p>Existing calendar time (UTC): <strong>{plan.scheduled_at}</strong></p>
    <p>Delivery mode: scheduled automatic publication.</p>
    <pre>{plan.text}</pre>
    <p>Editorial review is still required: does this exact post show a specific supported problem, decision or method that is useful to people already using ChatGPT/Codex, in a natural voice? Factual checks alone do not establish content quality.</p>
    <p className="fine">Source SHA-256 {plan.source_hash}<br/>Review {plan.review_token}<br/>LinkedIn draft SHA-256 {plan.variant_hash}<br/>Scheduler policy SHA-256 {plan.scheduler_policy_hash||"generic cadence"}<br/>Plan SHA-256 {plan.version}</p>
    <label><input type="checkbox" checked={ack} disabled={busy||pending||submitted} onChange={event=>setAck(event.target.checked)}/>{APPROVAL_PLAN_ACK}</label>
    <button disabled={busy||pending||submitted||!ack} onClick={()=>void approve()}>Approve exact content and publication plan</button>
    <p>One approval records both content review and the exact delivery plan. Delivery still requires authorized publishing credentials and dispatch; OFF switches continue to block it. Approval is not a delivery receipt.</p>
    <p>{publishingEnabled?"Publishing configuration is ON; this does not verify an active scheduler or successful delivery.":"Publishing is OFF. An approved plan is held and cannot be delivered while OFF."}</p>
    {submitted&&<p role="status">Approval saved. Check the publication plan and eventual provider receipt.</p>}
  </section>;
}
