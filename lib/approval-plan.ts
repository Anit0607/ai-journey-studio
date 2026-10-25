import {scheduledPolicyBinding} from './scheduler-window-policy';
import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {hash} from "./domain";
import {Store} from "./store";
import {reviewReadiness,saveEvidenceApproval} from "./evidence-review";
import {assertNoPendingAgentRevision} from "./agent-revisions";
import {platformVariants} from "./platform-variants";
import {calendarPlatformPolicy,taskPlatformPolicy} from "./platform-policy";
import {Publishing,PublicationValidationError,type PublishingRuntime} from "./publishing";
import {APPROVAL_PLAN_EVENT,calendarPublicationBinding,lockPublicationGuards} from "./calendar-publication-binding";

import {APPROVAL_PLAN_CONTRACT_V2,currentApprovalPlanContract,type ApprovalPlan} from "./approval-plan-contract";
function fail(message:string):never{throw new PublicationValidationError(message);}
const scopedDb=(db:Database,tx:Connection):Database=>({...db,query:tx.query.bind(tx),transaction:work=>work(tx),close:async()=>{}});

/** Read-only preparation. No outbox, approval, credential read or outbound call. */
export async function previewApprovalPlan(db:Database,runtime:PublishingRuntime,taskId:string,token:string):Promise<ApprovalPlan>{
  return db.transaction(async tx=>{
    // Settings -> OAuth guard -> entry -> task -> source/policy -> connection.
    await lockPublicationGuards(tx,true);
    const entries=await tx.query<any>("SELECT * FROM calendar_entries WHERE task_id=$1 ORDER BY id FOR UPDATE",[taskId]);
    if(entries.length!==1)fail("Exactly one existing calendar slot must be linked to this task");
    const entry=entries[0],context=await new Store(db).revisionContext(tx,taskId,token);
    if(context.task.checkpoint!==6)fail("All six artifacts must be complete");
    await assertNoPendingAgentRevision(tx,taskId);
    const policy=taskPlatformPolicy(context.task);
    if(JSON.stringify(policy)!==JSON.stringify(calendarPlatformPolicy(entry))||policy?.platforms.join(",")!=="LinkedIn")fail("A matching LinkedIn-only calendar slot is required");
    if(entry.source_id!==context.source.id)fail("Calendar source linkage changed");
    const slot=entry.platform_schedule?.LinkedIn?.intended_post,at=new Date(slot),now=(runtime.now||(()=>new Date()))();
    if(typeof slot!=="string"||!Number.isFinite(at.getTime())||at.getTime()!==new Date(entry.intended_post).getTime()||at<=now)fail("Existing LinkedIn calendar posting time must be valid and in the future");
    let scheduler_policy_hash:string|null;
    try{scheduler_policy_hash=scheduledPolicyBinding(runtime.scheduler_window_policy,at);}catch(error){fail((error as Error).message);}
    const accounts=(runtime.accounts||[]).filter(a=>a.platform==="LinkedIn"&&a.enabled===true&&a.verified===true);
    if(accounts.length!==1)fail("Exactly one enabled verified LinkedIn destination is required");
    const account=accounts[0];
    if(runtime.accountCurrent&&!await runtime.accountCurrent(account,tx,false))fail("LinkedIn destination authorization changed");
    const quality=await reviewReadiness(tx,taskId,context.bundle,context.source);
    if(quality.editorial.blocking)fail("Resolve the saved editorial hold before approval or publication");
    if(quality.flags.length)fail("Resolve source-grounding flags before approval");
    const variants=platformVariants(context.bundle.find(a=>a.role==="Platform Adapter"),policy),variant=variants.variants.find(v=>v.platform==="LinkedIn");
    if(!variants.complete||!variant?.hash||variant.text===null)fail("Exact LinkedIn draft is incomplete");
    const values={...APPROVAL_PLAN_CONTRACT_V2,task_id:taskId,review_token:token,entry_id:entry.id,calendar_binding:calendarPublicationBinding(entry),source_hash:context.source.hash,clearance_id:context.source.clearance_id||null,quality_binding:quality.binding,evidence_version:quality.evidence_version,account_id:account.id,account_version:account.authorization_version,account_label:account.label,remote_id:account.remote_id,scheduled_at:at.toISOString(),scheduler_policy_hash,timezone:"UTC" as const,delivery_mode:"scheduled" as const,text:variant.text,variant_hash:variant.hash};
    return {...values,version:hash(JSON.stringify(values))};
  });
}

/** One explicit owner approval, with both audit records committed or neither. */
export async function approveApprovalPlan(db:Database,runtime:PublishingRuntime,input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join(",")!=="acknowledged,acknowledgement,acknowledgement_hash,acknowledgement_version,expected_plan,review_token,task_id")fail("Exact plan approval request required");
  const body=input as Record<string,unknown>;
  if(!currentApprovalPlanContract(body))fail("Current final-post acknowledgement required; refresh the approval preview");
  if(body.acknowledged!==true||typeof body.task_id!=="string"||typeof body.review_token!=="string"||typeof body.expected_plan!=="string")fail("Explicit exact plan acknowledgement required");
  return db.transaction(async tx=>{
    // Settings -> OAuth guard -> outbox -> entry -> task -> source/policy -> connection.
    // Nested helpers reuse these singleton locks; none is first acquired late.
    await lockPublicationGuards(tx,true);
    const existing=await tx.query<any>("SELECT * FROM publishing_outbox WHERE task_id=$1 AND platform='LinkedIn' ORDER BY id FOR UPDATE",[body.task_id]);
    const local=scopedDb(db,tx),plan=await previewApprovalPlan(local,runtime,body.task_id as string,body.review_token as string);
    if(plan.version!==body.expected_plan)fail("Approval plan changed; review the full preview again");
    // An uncertain, claimed or completed prior delivery must never be auto-replayed.
    if(existing.some(row=>["claimed","uncertain","published"].includes(row.status)))fail("Prior delivery requires reconciliation; automatic replay is blocked");
    const store=new Store(local),context=await store.revisionContext(tx,plan.task_id,plan.review_token);
    if(context.latest)await store.approveRevision(plan.task_id,plan.review_token,true,"final-post");
    else if(context.task.status!=="approved")await store.approve(plan.task_id,plan.review_token.slice("original:".length),"final-post");
    else{
      const approved=(await tx.query<{version:string}>("SELECT version FROM approvals WHERE task_id=$1",[plan.task_id]))[0];
      if(approved?.version!==plan.review_token.slice("original:".length))fail("Exact original content approval is missing");
      // Preserve the original immutable approval; append a fresh source/evidence
      // receipt only because this action explicitly approves the final post and exact delivery plan.
      await saveEvidenceApproval(tx,plan.task_id,plan.review_token,await reviewReadiness(tx,plan.task_id,context.bundle,context.source));
    }
    const key=plan.version,requestId=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20,32)}`;
    const publisher=new Publishing(local,runtime),row=await publisher.enqueue({request_id:requestId,task_id:plan.task_id,review_token:plan.review_token,platform:"LinkedIn",account_id:plan.account_id,scheduled_at:plan.scheduled_at,payload:{text:plan.text},delivery_mode:"scheduled"});
    if(!["staged","approved"].includes(row.status))fail("Existing delivery plan is not available for approval");
    // Replace only unattempted older plans; never create a second eligible delivery.
    for(const previous of existing)if(previous.id!==row.id&&["staged","approved","invalidated","missed"].includes(previous.status))await publisher.cancel(previous.id,previous.version);
    const receipts=await tx.query<{detail:string}>("SELECT detail FROM events WHERE task_id=$1 AND kind=$2",[plan.task_id,APPROVAL_PLAN_EVENT]);
    if(!receipts.some(event=>JSON.parse(event.detail).plan_version===plan.version))await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[randomUUID(),plan.task_id,APPROVAL_PLAN_EVENT,JSON.stringify({outbox_id:row.id,entry_id:plan.entry_id,calendar_binding:plan.calendar_binding,plan_version:plan.version,scheduler_policy_hash:plan.scheduler_policy_hash,acknowledgement_version:plan.acknowledgement_version,acknowledgement:plan.acknowledgement,acknowledgement_hash:plan.acknowledgement_hash})]);
    return publisher.approve(row.id,row.version,true);
  });
}
