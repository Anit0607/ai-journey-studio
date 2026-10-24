import {randomUUID} from 'node:crypto';
import type {Connection,Database} from './db';
import {CAP,WARNING,configReady,hash,type RuntimeConfig,type Source} from './domain';
import {OWNER_ID} from './owner-password';
import {ownerSourceEligible,validateSourceInput} from './sources';
import {githubDraftRuntimeBinding,type ScopedSourceProof} from './scoped-source-proof';
import {SCOPED_GITHUB_REPOSITORY,normalizeGithubNotePaths,validateGithubBuildNote,validateGithubHashPinnedText,GITHUB_HASH_PINNED_TEXT_PROFILE} from './github-source-boundary';

export const GITHUB_POLICY_ACKNOWLEDGEMENT='I authorize automatic selection of the displayed GitHub source scope and sending its selected facts, repository and immutable commit/file identifiers, existing commit author/committer account attribution, and intermediate drafts to OpenAI for LinkedIn drafts and revisions under the shared $10 monthly warning and $15 monthly cap. This does not establish that I performed the reported work. Bank, client, confidential, credential and unrelated material is excluded. This does not authorize new account access, other repositories, Gemini, scheduling or publication. I must approve every final post before it is scheduled or published.';
export type GithubSourceScope={version:1;repository:string;commit_summaries:boolean;note_paths:string[];categories:('build-log'|'project-note')[];start_date:string;provenance:['repository','immutable-commit-file-identifiers','existing-commit-account-attribution'];recipient:'openai';platforms:['LinkedIn'];purpose:'content-drafts-revisions';intermediate_drafts:true;warning_microdollars:number;cap_microdollars:number};
export type GithubPolicyInput={repository:string;commit_summaries:boolean;note_paths:string[];start_date:string};
export type PolicySession={owner_id:string;session_id:string};
type PolicyRow={id:string;scope:GithubSourceScope;scope_hash:string;runtime_binding:string;receipt_id:string;active:boolean;created:string|Date;revoked_at:string|Date|null};
type PreviewRow={id:string;scope:GithubSourceScope;scope_hash:string;runtime_binding:string;preview_hash:string;expires_at:string|Date;consumed_at:string|Date|null;owner_id:string;session_id:string};
export type Provenance={id:string;source_id:string;provider:string;scope:string;external_id:string;content_hash:string;source_url:string|null;metadata:Record<string,unknown>};
type Grant={id:string;policy_id:string;policy_hash:string;provenance_id:string;provenance_hash:string;source_id:string;source_hash:string;evidence_key:string;entry_id:string;task_id:string|null;created:string|Date};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/,COMMIT=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const stableJson=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export class GithubSourcePolicyError extends Error {}
const fail=(message:string):never=>{throw new GithubSourcePolicyError(message);};
export async function githubPolicySchemaReady(db:Connection){return (await db.query('SELECT version FROM schema_versions WHERE version=21')).length===1;}
function exactKeys(value:Record<string,unknown>,keys:string[]){return Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));}
export function normalizeGithubScope(input:unknown,now=new Date()):GithubSourceScope{
 if(!input||typeof input!=='object'||Array.isArray(input))return fail('Invalid GitHub source scope');
 const p=input as Record<string,unknown>;
 if(!exactKeys(p,['repository','commit_summaries','note_paths','start_date'])||typeof p.repository!=='string'||p.repository.toLowerCase()!==SCOPED_GITHUB_REPOSITORY||typeof p.commit_summaries!=='boolean'||typeof p.start_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.start_date))return fail('Invalid GitHub source scope');
 const day=new Date(p.start_date+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==p.start_date||day>now)return fail('Invalid GitHub source start date');
 const paths=Array.isArray(p.note_paths)&&p.note_paths.length===0?[]:normalizeGithubNotePaths(p.note_paths).sort();
 if(!p.commit_summaries&&!paths.length)return fail('Choose at least one bounded GitHub source category');
 return {version:1,repository:SCOPED_GITHUB_REPOSITORY,commit_summaries:p.commit_summaries,note_paths:paths,categories:[...(p.commit_summaries?['build-log' as const]:[]),...(paths.length?['project-note' as const]:[])],start_date:p.start_date,provenance:['repository','immutable-commit-file-identifiers','existing-commit-account-attribution'],recipient:'openai',platforms:['LinkedIn'],purpose:'content-drafts-revisions',intermediate_drafts:true,warning_microdollars:WARNING,cap_microdollars:CAP};
}
function canonicalScope(scope:GithubSourceScope,now:Date){
 const normalized=normalizeGithubScope({repository:scope.repository,commit_summaries:scope.commit_summaries,note_paths:scope.note_paths,start_date:scope.start_date},now);
 if(stableJson(scope)!==stableJson(normalized))return fail('Stored GitHub source scope changed');
 return normalized;
}
export const githubProvenanceHash=(p:Provenance)=>hash(JSON.stringify({id:p.id,source_id:p.source_id,provider:p.provider,scope:p.scope,external_id:p.external_id,content_hash:p.content_hash,source_url:p.source_url,metadata:p.metadata}));
/** Conservative admission: attribution is not owner experience; unsafe and thin summaries are skipped. */
export function githubEvidenceEligibility(source:Source,p:Provenance,scope:GithubSourceScope,now=new Date()):{eligible:true;evidence_key:string}|{eligible:false;reason:string}{
 try{
  validateSourceInput(source,now);const m=p.metadata;
  if(source.revoked_at)return {eligible:false,reason:'Owner revoked this exact source'};
  if(source.hash!==hash(source.text)||p.source_id!==source.id||p.provider!=='github'||p.scope!==scope.repository||m.repository!==scope.repository||m.content_digest!==source.hash||typeof m.commit_sha!=='string'||!COMMIT.test(m.commit_sha)||typeof m.source_timestamp!=='string'||!Number.isFinite(Date.parse(m.source_timestamp))||new Date(m.source_timestamp)>now||m.source_timestamp.slice(0,10)!==source.reported_date||source.reported_date<scope.start_date||!scope.categories.includes(source.category as 'build-log'|'project-note'))return {eligible:false,reason:'Source provenance or date is outside the exact policy'};
  if(p.content_hash!==hash(JSON.stringify({text:source.text,category:source.category,reported_date:source.reported_date})))return {eligible:false,reason:'Source provenance integrity failed'};
  if(m.content_kind==='commit_summary'){
   if(!scope.commit_summaries||source.category!=='build-log'||p.external_id!==m.commit_sha||p.source_url!==`https://github.com/${scope.repository}/commit/${m.commit_sha}`)return {eligible:false,reason:'Commit scope does not match policy'};
   const marker=`\nCommit: ${m.commit_sha}\n`,at=source.text.indexOf(marker),summary=at<0?'':source.text.slice(at+marker.length);
   const login=(value:unknown)=>value===null?'unattributed':typeof value==='string'&&/^[A-Za-z0-9_\[\]-]{1,100}$/.test(value)?value:null;
   const author=login(m.author_login),committer=login(m.committer_login);
   if(!author||!committer||source.text!==`Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: ${scope.repository}\nAuthor account: ${author}\nCommitter account: ${committer}\nCommit: ${m.commit_sha}\n${summary}`||m.evidence_digest!==hash(summary))return {eligible:false,reason:'Commit attribution or selected evidence integrity failed'};
   if(summary.length<40||summary.length>500||summary.split(/\s+/).length<8||/[\r\n]/.test(summary)||!/\b(?:add(?:ed)?|fix(?:ed)?|build|built|implement(?:ed)?|test(?:ed)?|verif(?:y|ied)|improv(?:e|ed)|document(?:ed)?|refactor(?:ed)?|support(?:ed)?|prevent(?:ed)?)\b/i.test(summary)||/^(?:merge|bump|revert)\b/i.test(summary))return {eligible:false,reason:'Commit summary has insufficient concrete progress'};
   if(/(?:ignore|override|disregard).{0,40}(?:instructions?|rules?|policy)|(?:system|assistant|developer)\s*:|https?:\/\//i.test(summary))return {eligible:false,reason:'Commit summary contains ambiguous instructions or links'};
   return {eligible:true,evidence_key:hash(JSON.stringify([scope.repository,'commit_summary',m.commit_sha]))};
  }
  if(m.content_kind==='hash_pinned_text'){
   if(source.category!=='project-note'||typeof m.note_path!=='string'||!scope.note_paths.includes(m.note_path)||typeof m.blob_sha!=='string'||!COMMIT.test(m.blob_sha)||typeof m.root_tree_sha!=='string'||!COMMIT.test(m.root_tree_sha)||m.note_mode!=='100644'||p.external_id!==`${m.commit_sha}:${m.note_path}`||p.source_url!==`https://github.com/${scope.repository}/blob/${m.commit_sha}/${m.note_path}`||m.content_profile!==GITHUB_HASH_PINNED_TEXT_PROFILE||m.profile_path!==m.note_path||typeof m.raw_sha256!=='string'||m.expected_raw_sha256!==m.raw_sha256)return {eligible:false,reason:'Hash-pinned text provenance is invalid'};
   const prefix=`Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: ${scope.repository}\nCommit: ${m.commit_sha}\nNote: ${m.note_path}\n\n`;
   if(!source.text.startsWith(prefix))return {eligible:false,reason:'Hash-pinned text attribution changed'};
   const raw=validateGithubHashPinnedText(source.text.slice(prefix.length),scope.repository,m.commit_sha,m.note_path,m.raw_sha256);
   if(m.raw_bytes!==Buffer.byteLength(raw,'utf8')||m.evidence_digest!==hash(raw))return {eligible:false,reason:'Hash-pinned text integrity failed'};
   // Structured-note consent never grants this distinct, exact-byte profile.
   return {eligible:false,reason:'Hash-pinned text requires separate exact owner source clearance'};
  }
  if(m.content_kind==='build_note'){
   if(m.content_profile!==undefined)return {eligible:false,reason:'Unsupported build note profile'};
   if(source.category!=='project-note'||typeof m.note_path!=='string'||!scope.note_paths.includes(m.note_path)||typeof m.blob_sha!=='string'||!COMMIT.test(m.blob_sha)||typeof m.root_tree_sha!=='string'||!COMMIT.test(m.root_tree_sha)||m.note_mode!=='100644'||p.source_url!==`https://github.com/${scope.repository}/blob/${m.commit_sha}/${m.note_path}`)return {eligible:false,reason:'Build note path or immutable identity is outside policy'};
   const start=source.text.indexOf('## Verified progress\n');if(start<0)return {eligible:false,reason:'Build note lacks verified progress structure'};
   const expectedPrefix=`Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: ${scope.repository}\nCommit: ${m.commit_sha}\nNote: ${m.note_path}\n\n`;
   if(source.text.slice(0,start)!==expectedPrefix)return {eligible:false,reason:'Build note attribution or prefix changed'};
   const selected=validateGithubBuildNote(source.text,scope.repository,m.commit_sha);
   if(m.evidence_digest!==hash(selected))return {eligible:false,reason:'Build note selected evidence integrity failed'};
   return {eligible:true,evidence_key:hash(JSON.stringify([scope.repository,'build_note',m.evidence_digest]))};
  }
  return {eligible:false,reason:'Source category is not eligible for automatic drafting'};
 }catch{return {eligible:false,reason:'Unsafe, malformed or ambiguous source material'};}
}
async function receiptCurrent(tx:Connection,p:PolicyRow,now:Date){
 try{canonicalScope(p.scope,now);if(!p.active||p.revoked_at||hash(stableJson(p.scope))!==p.scope_hash)return false;
  const event=(await tx.query<{kind:string;detail:string}>('SELECT kind,detail FROM events WHERE id=$1',[p.receipt_id]))[0];if(event?.kind!=='github_source_policy_authorized')return false;
  const receipt=JSON.parse(event.detail);
  return receipt.owner_id===OWNER_ID&&receipt.policy_id===p.id&&receipt.scope_hash===p.scope_hash&&receipt.runtime_binding===p.runtime_binding&&receipt.acknowledgement===GITHUB_POLICY_ACKNOWLEDGEMENT&&typeof receipt.session_id==='string'&&!!receipt.session_id;
 }catch{return false;}
}
export async function activeGithubPolicy(tx:Connection,c:RuntimeConfig,now=new Date()):Promise<PolicyRow|undefined>{
 if(!await githubPolicySchemaReady(tx))return undefined;
 const rows=await tx.query<PolicyRow>('SELECT * FROM github_source_policies WHERE active=true');
 const p=rows[0];if(rows.length!==1||!p||!await receiptCurrent(tx,p,now)||p.runtime_binding!==githubDraftRuntimeBinding(c))return undefined;
 return p;
}
/** No persisted Source row is changed. Manual review wins; manual/source revocations never get bypassed. */
export async function resolveScopedSource(tx:Connection,raw:Source|undefined|null,now=new Date()):Promise<Source|undefined>{
 if(!raw)return undefined;
 const source={...raw};delete source.scoped_authorization;
 if(ownerSourceEligible(source,undefined,'openai',now)||source.revoked_at||source.clearance_id||source.clearance_owner_acknowledged)return source;
 if(!await githubPolicySchemaReady(tx))return source;
 const grants=await tx.query<Grant>('SELECT * FROM github_source_grants WHERE source_id=$1',[source.id]);const g=grants[0];if(grants.length!==1||!g?.task_id||g.source_hash!==source.hash)return source;
 const p=(await tx.query<PolicyRow>('SELECT * FROM github_source_policies WHERE id=$1 FOR SHARE',[g.policy_id]))[0];
 const provenance=(await tx.query<Provenance>('SELECT * FROM source_provenance WHERE id=$1',[g.provenance_id]))[0];
 if(!p||!provenance||!await receiptCurrent(tx,p,now)||g.policy_hash!==p.scope_hash||g.provenance_hash!==githubProvenanceHash(provenance))return source;
 const eligible=githubEvidenceEligibility(source,provenance,p.scope,now);if(!eligible.eligible||eligible.evidence_key!==g.evidence_key)return source;
 const task=(await tx.query<{source_id:string;source_hash:string;origin_key:string;content_brief:Record<string,unknown>}>('SELECT source_id,source_hash,origin_key,content_brief FROM tasks WHERE id=$1',[g.task_id]))[0];
 const event=(await tx.query<{kind:string;detail:string}>('SELECT kind,detail FROM events WHERE id=$1',[g.id]))[0];
 if(!task||task.source_id!==source.id||task.source_hash!==source.hash||task.origin_key!=='calendar:'+g.entry_id||event?.kind!=='github_source_selected')return source;
 try{const receipt=JSON.parse(event.detail);if(receipt.policy_id!==p.id||receipt.source_hash!==source.hash||receipt.provenance_hash!==g.provenance_hash||receipt.entry_id!==g.entry_id||receipt.evidence_key!==g.evidence_key||stableJson(task.content_brief.source_policy)!==stableJson({id:p.id,hash:p.scope_hash,grant_id:g.id,provenance_id:g.provenance_id}))return source;}catch{return source;}
 const proof:ScopedSourceProof={grant_id:g.id,policy_id:p.id,policy_hash:p.scope_hash,runtime_binding:p.runtime_binding,provenance_id:g.provenance_id,source_hash:g.source_hash,evidence_key:g.evidence_key,entry_id:g.entry_id,task_id:g.task_id};
 return {...source,cleared:true,clearance_id:g.id,cleared_at:g.created,scoped_authorization:proof};
}
export class GithubSourcePolicies{
 constructor(readonly db:Database,readonly config:RuntimeConfig,readonly now=()=>new Date()){}
 private async session(tx:Connection,session:PolicySession){
  if(session.owner_id!==OWNER_ID||typeof session.session_id!=='string'||!session.session_id||(await tx.query('SELECT id FROM studio_auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">$3',[session.session_id,OWNER_ID,this.now()])).length!==1)fail('Authenticated owner session required');
 }
 async snapshot(){if(!await githubPolicySchemaReady(this.db))return {available:false,active:null,notice:'Source-policy setup is pending; automatic selection is OFF'};
  const rows=await this.db.query<PolicyRow>('SELECT * FROM github_source_policies ORDER BY created DESC LIMIT 10');
  const active=rows.find(p=>p.active)||null,valid=!!active&&await receiptCurrent(this.db,active,this.now());
  return {available:true,active,policies:rows,runtime_binding:githubDraftRuntimeBinding(this.config),binding_current:valid&&active?.runtime_binding===githubDraftRuntimeBinding(this.config),runtime_ready:configReady(this.config,this.now())&&this.config.fallback_authorized!==true,notice:'Policy consent does not connect GitHub, start a scheduler, enable paid generation or approve a post'};
 }
 async preview(input:unknown,session:PolicySession){
  const scope=normalizeGithubScope(input,this.now()),id=randomUUID(),scopeHash=hash(stableJson(scope)),runtime=githubDraftRuntimeBinding(this.config),expires=new Date(this.now().getTime()+10*60_000).toISOString();
  const previewHash=hash(JSON.stringify({id,scope,scope_hash:scopeHash,runtime_binding:runtime,expires_at:expires,acknowledgement:GITHUB_POLICY_ACKNOWLEDGEMENT}));
  await this.db.transaction(async tx=>{await this.session(tx,session);if(!await githubPolicySchemaReady(tx))fail('Source-policy setup is pending');await tx.query('INSERT INTO github_source_policy_previews(id,owner_id,session_id,scope,scope_hash,runtime_binding,preview_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,OWNER_ID,session.session_id,JSON.stringify(scope),scopeHash,runtime,previewHash,expires]);});
  return {id,scope,scope_hash:scopeHash,runtime_binding:runtime,preview_hash:previewHash,expires_at:expires,acknowledgement:GITHUB_POLICY_ACKNOWLEDGEMENT};
 }
 async activate(input:{preview_id:string;preview_hash:string;acknowledgement:string;acknowledged:boolean},session:PolicySession){
  if(!input||!UUID.test(input.preview_id)||!SHA.test(input.preview_hash)||input.acknowledged!==true||input.acknowledgement!==GITHUB_POLICY_ACKNOWLEDGEMENT)fail('Exact bounded source-policy acknowledgement required');
  if(!configReady(this.config,this.now())||this.config.fallback_authorized===true)fail('Current OpenAI-only runtime scope is required before activation');
  return this.db.transaction(async tx=>{
   await this.session(tx,session);await tx.query('SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE');
   const prior=(await tx.query<PolicyRow>('SELECT * FROM github_source_policies WHERE id=$1',[input.preview_id]))[0];
   if(prior){if(!prior.active||prior.revoked_at)fail('Revoked policy cannot be replayed; create a fresh preview');const original=(await tx.query<PreviewRow>('SELECT * FROM github_source_policy_previews WHERE id=$1',[prior.id]))[0];if(!original||original.preview_hash!==input.preview_hash||original.session_id!==session.session_id||prior.runtime_binding!==githubDraftRuntimeBinding(this.config)||!await receiptCurrent(tx,prior,this.now()))fail('Policy receipt changed');return prior;}
   const p=(await tx.query<PreviewRow>('SELECT * FROM github_source_policy_previews WHERE id=$1 FOR UPDATE',[input.preview_id]))[0];
   if(!p||p.owner_id!==OWNER_ID||p.session_id!==session.session_id||p.consumed_at||new Date(p.expires_at)<=this.now()||p.preview_hash!==input.preview_hash||p.runtime_binding!==githubDraftRuntimeBinding(this.config)||hash(stableJson(canonicalScope(p.scope,this.now())))!==p.scope_hash)fail('Policy preview expired or changed; preview again');
   if((await tx.query('SELECT id FROM github_source_policies WHERE active=true')).length)fail('Revoke the current policy before changing its scope');
   const receipt=randomUUID();await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'github_source_policy_authorized',$2)",[receipt,JSON.stringify({owner_id:OWNER_ID,session_id:session.session_id,policy_id:p.id,scope_hash:p.scope_hash,runtime_binding:p.runtime_binding,acknowledgement:GITHUB_POLICY_ACKNOWLEDGEMENT})]);
   await tx.query('UPDATE github_source_policy_previews SET consumed_at=$2 WHERE id=$1',[p.id,this.now()]);
   return (await tx.query<PolicyRow>('INSERT INTO github_source_policies(id,scope,scope_hash,runtime_binding,receipt_id,active) VALUES($1,$2,$3,$4,$5,true) RETURNING *',[p.id,JSON.stringify(p.scope),p.scope_hash,p.runtime_binding,receipt]))[0];
  });
 }
 async revoke(id:string,expectedHash:string,session:PolicySession){
  if(!UUID.test(id)||!SHA.test(expectedHash))fail('Exact policy reference required');
  return this.db.transaction(async tx=>{await this.session(tx,session);await tx.query('SELECT id FROM calendar_settings WHERE id=1 FOR UPDATE');const p=(await tx.query<PolicyRow>('SELECT * FROM github_source_policies WHERE id=$1 FOR UPDATE',[id]))[0];if(!p||p.scope_hash!==expectedHash)fail('Policy changed; refresh before revocation');if(p.revoked_at)return p;
   await tx.query("INSERT INTO events(id,kind,detail) VALUES($1,'github_source_policy_revoked',$2)",[randomUUID(),JSON.stringify({owner_id:OWNER_ID,policy_id:id,scope_hash:expectedHash})]);
   return (await tx.query<PolicyRow>('UPDATE github_source_policies SET active=false,revoked_at=$2 WHERE id=$1 RETURNING *',[id,this.now()]))[0];
  });
 }
}
