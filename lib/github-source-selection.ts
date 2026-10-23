import type {Connection} from './db';
import type {RuntimeConfig,Source} from './domain';
import {activeGithubPolicy,githubEvidenceEligibility,type Provenance} from './github-source-policy';
export type ScopedCandidate={source:Source;provenance:Provenance;evidence_key:string};
/** Bounded oldest-first selection. Never performs network, model, clearance, or publication work. */
export async function githubSelectionPool(tx:Connection,c:RuntimeConfig,now:Date){
 const policy=await activeGithubPolicy(tx,c,now);if(!policy)return {policy:undefined,candidates:[] as ScopedCandidate[],reason:'No active owner-authorized GitHub source policy matches the current runtime'};
 const rows=await tx.query<{source:Source;provenance:Provenance}>(`SELECT row_to_json(s) AS source,row_to_json(p) AS provenance
 FROM sources s JOIN source_provenance p ON p.source_id=s.id
 WHERE p.provider='github' AND p.scope=$1 AND s.reported_date>=$2
 AND s.cleared=false AND s.clearance_id IS NULL AND s.revoked_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_id=s.id)
 AND NOT EXISTS (SELECT 1 FROM github_source_grants g WHERE g.source_id=s.id)
 ORDER BY s.reported_date,p.external_id,p.id LIMIT 101`,[policy.scope.repository,policy.scope.start_date]);
 if(rows.length>100)return {policy,candidates:[] as ScopedCandidate[],reason:'More than 100 unused GitHub source versions need review; automatic selection is bounded and skipped'};
 const candidates:ScopedCandidate[]=[];const reasons=new Set<string>();
 for(const row of rows){
  // A text version with competing provenance is ambiguous, even if one matches.
  if((await tx.query('SELECT id FROM source_provenance WHERE source_id=$1',[row.source.id])).length!==1){reasons.add('Ambiguous multiple provenance records');continue;}
  const eligible=githubEvidenceEligibility(row.source,row.provenance,policy.scope,now);
  if(!eligible.eligible){reasons.add(eligible.reason);continue;}
  if((await tx.query('SELECT id FROM github_source_grants WHERE evidence_key=$1',[eligible.evidence_key])).length){reasons.add('Evidence already used by an automatic draft');continue;}
  candidates.push({...row,evidence_key:eligible.evidence_key});
 }
 return {policy,candidates,reason:candidates.length?'':rows.length?'No eligible unused evidence: '+[...reasons].sort().join('; '):'No unused GitHub evidence matches the approved source scope'};
}
