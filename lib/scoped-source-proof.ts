import {CAP,WARNING,hash,type RuntimeConfig,type Source} from './domain';
export type ScopedSourceProof={
  grant_id:string;policy_id:string;policy_hash:string;runtime_binding:string;
  provenance_id:string;source_hash:string;evidence_key:string;entry_id:string;task_id:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
/** This shape is attached only by the transaction-aware database resolver, never by intake. */
export function scopedSourceProof(source:Source|undefined|null):ScopedSourceProof|undefined {
 const proof=source?.scoped_authorization;
 if(!source||!proof||source.revoked_at||source.clearance_owner_acknowledged===true||
   ![proof.grant_id,proof.policy_id,proof.provenance_id,proof.entry_id,proof.task_id].every(v=>UUID.test(v))||
   ![proof.policy_hash,proof.runtime_binding,proof.source_hash,proof.evidence_key].every(v=>SHA.test(v))||
   source.hash!==proof.source_hash||hash(source.text)!==source.hash)return undefined;
 return proof;
}
/** Price freshness is checked separately; changing provider/model/consent requires a fresh policy preview. */
export function githubDraftRuntimeBinding(config:RuntimeConfig){
 return hash(JSON.stringify({version:1,provider:'openai',model:config.openai?.model||null,
  owner_cleared_sources_authorized:config.owner_cleared_sources_authorized===true,
  fallback_authorized:config.fallback_authorized===true,warning_microdollars:WARNING,cap_microdollars:CAP,
  platforms:['LinkedIn'],purpose:'content-drafts-revisions',intermediate_drafts:true}));
}
export function scopedTaskMatches(source:Source,task:import('./domain').Task){
 const proof=scopedSourceProof(source);if(!proof)return !task.content_brief?.source_policy;
 return (task.id===proof.task_id||task.revision_parent_task_id===proof.task_id)&&
  !!task.content_brief?.source_policy&&typeof task.content_brief.source_policy==='object'&&Object.keys(task.content_brief.source_policy).length===4&&Object.entries({id:proof.policy_id,hash:proof.policy_hash,grant_id:proof.grant_id,provenance_id:proof.provenance_id}).every(([key,value])=>(task.content_brief!.source_policy as Record<string,unknown>)[key]===value)&&
  JSON.stringify(task.content_brief?.platform_policy)===JSON.stringify({version:1,platforms:['LinkedIn']})&&
  JSON.stringify(task.content_brief?.platforms)===JSON.stringify(['LinkedIn']);
}
