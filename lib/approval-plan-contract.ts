// Historical V1 testimony is immutable; never reinterpret old receipts as V2.
export const APPROVAL_PLAN_ACK="I reviewed all six artifacts against the cleared source and approve this exact LinkedIn text, displayed account and scheduled time for automatic publication. Changes require fresh approval.";
export const APPROVAL_PLAN_ACK_V2="I approve this exact LinkedIn post for automatic publication to the displayed account at the displayed time. Any change requires my approval again.";
// Browser-safe SHA-256 of the exact UTF-8 acknowledgement (verified by tests).
export const APPROVAL_PLAN_CONTRACT_V2={acknowledgement_version:2,acknowledgement:APPROVAL_PLAN_ACK_V2,acknowledgement_hash:"2a3bff2cc61259b7bfd7b82136a773c84aff5d886231eeec5e55ea45dded4eac"} as const;
export function currentApprovalPlanContract(value:unknown):boolean{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const contract=value as Record<string,unknown>;
  return Object.entries(APPROVAL_PLAN_CONTRACT_V2).every(([key,expected])=>contract[key]===expected);
}
export type ApprovalPlan=typeof APPROVAL_PLAN_CONTRACT_V2&{task_id:string;review_token:string;entry_id:string;calendar_binding:string;source_hash:string;clearance_id:string|null;quality_binding:string;evidence_version:string|null;account_id:string;account_version:string;account_label:string;remote_id:string;scheduled_at:string;scheduler_policy_hash:string|null;timezone:"UTC";delivery_mode:"scheduled";text:string;variant_hash:string;version:string};
