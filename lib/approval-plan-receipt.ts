import {APPROVAL_PLAN_ACK,currentApprovalPlanContract} from "./approval-plan-contract";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const matches=(value:unknown,pattern:RegExp)=>typeof value==="string"&&pattern.test(value);
/** Recognize immutable legacy receipts and the exact final-post contract separately. */
export function validApprovalPlanReceipt(value:unknown):boolean{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const receipt=value as Record<string,unknown>;
  const base=["outbox_id","entry_id","calendar_binding","plan_version","acknowledgement"];
  const expected="acknowledgement_version" in receipt?[...base,"scheduler_policy_hash","acknowledgement_version","acknowledgement_hash"]:"scheduler_policy_hash" in receipt?[...base,"scheduler_policy_hash"]:base;
  if(Object.keys(receipt).sort().join("|")!==expected.sort().join("|")||!matches(receipt.outbox_id,UUID)||!matches(receipt.entry_id,UUID)||!matches(receipt.calendar_binding,SHA)||!matches(receipt.plan_version,SHA))return false;
  if("scheduler_policy_hash" in receipt&&receipt.scheduler_policy_hash!==null&&!matches(receipt.scheduler_policy_hash,SHA))return false;
  return "acknowledgement_version" in receipt?currentApprovalPlanContract(receipt):receipt.acknowledgement===APPROVAL_PLAN_ACK;
}
