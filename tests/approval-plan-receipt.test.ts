import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {hash} from "../lib/domain";
import {APPROVAL_PLAN_ACK,APPROVAL_PLAN_ACK_V2,APPROVAL_PLAN_CONTRACT_V2} from "../lib/approval-plan-contract";
import {validApprovalPlanReceipt} from "../lib/approval-plan-receipt";
import {identifiableGenerationHistory} from "../lib/calendar-generation-time";
const base={outbox_id:randomUUID(),entry_id:randomUUID(),calendar_binding:hash("calendar"),plan_version:hash("plan")};
const legacy={...base,acknowledgement:APPROVAL_PLAN_ACK};
const current={...base,scheduler_policy_hash:null,...APPROVAL_PLAN_CONTRACT_V2};
test("legacy acknowledgement text is immutable; V2 has its own exact UTF-8 hash",()=>{
 assert.equal(APPROVAL_PLAN_ACK,"I reviewed all six artifacts against the cleared source and approve this exact LinkedIn text, displayed account and scheduled time for automatic publication. Changes require fresh approval.");
 assert.equal(APPROVAL_PLAN_ACK_V2,"I approve this exact LinkedIn post for automatic publication to the displayed account at the displayed time. Any change requires my approval again.");
 assert.equal(APPROVAL_PLAN_CONTRACT_V2.acknowledgement_hash,hash(APPROVAL_PLAN_ACK_V2));
});
test("strict readers distinguish legacy and V2 receipts without relabeling history",()=>{
 for(const receipt of [legacy,{...legacy,scheduler_policy_hash:null},{...legacy,scheduler_policy_hash:hash("policy")},current,{...current,scheduler_policy_hash:hash("policy")}]){
  const original=JSON.stringify(receipt);assert.equal(validApprovalPlanReceipt(receipt),true);
  const event={id:randomUUID(),kind:"calendar_publication_approved",detail:original};
  assert.equal(identifiableGenerationHistory([event],base.entry_id),true);
  assert.equal(identifiableGenerationHistory([event],randomUUID()),false,"Valid unrelated V1/V2 history must not globally block generation-time previews");
  assert.equal(JSON.stringify(receipt),original);
 }
 for(const receipt of [null,[],{}, {...legacy,acknowledgement:APPROVAL_PLAN_ACK_V2},{...legacy,acknowledgement_version:2},{...current,acknowledgement:APPROVAL_PLAN_ACK},{...current,acknowledgement_version:1},{...current,acknowledgement_version:3},{...current,acknowledgement_hash:hash("other")},{...current,scheduler_policy_hash:"invalid"},{...current,owner_reviewed_source:true}])assert.equal(validApprovalPlanReceipt(receipt),false,JSON.stringify(receipt));
});
