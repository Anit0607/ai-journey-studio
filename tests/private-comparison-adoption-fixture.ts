import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Database} from '../lib/db';
import {hash,type Source,type RuntimeConfig} from '../lib/domain';
import {GithubSourcePolicies,githubEvidenceEligibility,githubProvenanceHash,resolveScopedSource,type Provenance} from '../lib/github-source-policy';
import {SCOPED_GITHUB_REPOSITORY,validateGithubBuildNote} from '../lib/github-source-boundary';
import {OWNER_ID} from '../lib/owner-password';
import {COMPARISON_TARGET as target} from '../lib/private-comparison-policy';
/** Offline fixture only: actual policy activation and resolver, with fixed target IDs. */
export async function bindScopedComparisonFixture(db:Database,c:RuntimeConfig,source:Source){
 const now=new Date(),session={owner_id:OWNER_ID,session_id:randomUUID()},commit='d214eb1cac3042e5f1533a74c42ae9db1aed9dd5',path='docs/build-notes/studio-progress.md';
 await db.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',\'owner@studio.local\',true,now(),now()) ON CONFLICT DO NOTHING',[OWNER_ID]);
 await db.query('INSERT INTO studio_auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[session.session_id,OWNER_ID,randomUUID(),new Date(now.getTime()+3600000)]);
 const metadata={repository:SCOPED_GITHUB_REPOSITORY,content_kind:'build_note',content_digest:source.hash,commit_sha:commit,source_timestamp:'2026-10-25T00:00:00Z',note_path:path,blob_sha:'a'.repeat(40),root_tree_sha:'b'.repeat(40),note_mode:'100644',evidence_digest:hash(validateGithubBuildNote(source.text,SCOPED_GITHUB_REPOSITORY,commit))};
 const provenanceId=randomUUID();await db.query("INSERT INTO source_provenance(id,source_id,provider,scope,external_id,content_hash,source_url,metadata) VALUES($1,$2,'github',$3,$4,$5,$6,$7)",[provenanceId,source.id,SCOPED_GITHUB_REPOSITORY,commit+':'+path,hash(JSON.stringify({text:source.text,category:source.category,reported_date:source.reported_date})),'https://github.com/'+SCOPED_GITHUB_REPOSITORY+'/blob/'+commit+'/'+path,JSON.stringify(metadata)]);
 const provenance=(await db.query<Provenance>('SELECT * FROM source_provenance WHERE id=$1',[provenanceId]))[0];
 const policies=new GithubSourcePolicies(db,c,()=>now),preview=await policies.preview({repository:SCOPED_GITHUB_REPOSITORY,commit_summaries:false,note_paths:[path],start_date:'2026-10-25'},session);
 const policy=await policies.activate({preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true},session);
 const eligible=githubEvidenceEligibility(source,provenance,policy.scope,now);assert(eligible.eligible);
 const id=randomUUID(),provenanceHash=githubProvenanceHash(provenance);
 await db.query("INSERT INTO events(id,kind,detail) VALUES($1,'github_source_selected',$2)",[id,JSON.stringify({policy_id:policy.id,source_hash:source.hash,provenance_hash:provenanceHash,entry_id:target.calendar_id,evidence_key:eligible.evidence_key})]);
 await db.query('INSERT INTO github_source_grants(id,policy_id,policy_hash,provenance_id,provenance_hash,source_id,source_hash,evidence_key,entry_id,task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,policy.id,policy.scope_hash,provenance.id,provenanceHash,source.id,source.hash,eligible.evidence_key,target.calendar_id,target.task_id]);
 await db.query('UPDATE tasks SET origin_key=$2,content_brief=content_brief||$3::jsonb WHERE id=$1',[target.task_id,'calendar:'+target.calendar_id,JSON.stringify({source_policy:{id:policy.id,hash:policy.scope_hash,grant_id:id,provenance_id:provenance.id}})]);
 const resolved=await resolveScopedSource(db,source);assert(resolved?.scoped_authorization);assert.equal(resolved.clearance_owner_acknowledged,false);
 return {source:resolved,policy,policies,session};
}
