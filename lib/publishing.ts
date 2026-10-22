import {reviewReadiness,evidenceApprovalCurrent} from "./evidence-review";
import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {hash,istMonth,type Output,type Source,type Task} from "./domain";
import {assertBundle,bundleVersion,type Artifact} from "./grounding";
import {assertNoPendingAgentRevision} from "./agent-revisions";
import {platformVariants,REQUIRED_PLATFORMS,type Platform} from "./platform-variants";
import {assertSourcePrivacy,sourceEligible} from "./sources";
import {xPostTextValidation} from "./x-text";

export class PublicationValidationError extends Error{}
export function safePublicationError(error:unknown):string|null{return error instanceof PublicationValidationError?error.message:null;}
export const PUBLICATION_ACKNOWLEDGEMENT="I approve publishing this exact final platform draft and media to this specific account at this scheduled time. Source clearance and content review alone do not authorize publishing.";
export type PublishingMedia={url:string;sha256:string;mime_type:"image/jpeg"};
export type PublishingPayload={text:string;media?:PublishingMedia[]};
export type PublishingAccount={id:string;platform:Platform;remote_id:string;label:string;enabled?:boolean;verified?:boolean;authorization_version:string;credential_env?:string;credential_configured?:boolean;scopes:string[];linkedin_version?:string;instagram_api_version?:string;instagram_login?:"instagram"|"facebook";professional?:boolean};
/** Server-only configuration. Never obtain this object, credentials, or fetch from request JSON. */
export type PublishingRuntime={
  enabled?:boolean;credential_use_authorized?:boolean;scheduler_authorized?:boolean;scheduler_interval_seconds?:number;max_lateness_seconds?:number;
  signal?:AbortSignal;now?:()=>Date;sleep?:(milliseconds:number)=>Promise<void>;accounts?:PublishingAccount[];accountCurrent?:(account:PublishingAccount,tx:Connection,requireFresh:boolean)=>Promise<boolean>;credential?:(account:PublishingAccount)=>Promise<string>;fetch?:typeof fetch;
  /** Must verify a server-controlled, immutable public JPEG object against its exact SHA-256. */
  verifyMedia?:(media:PublishingMedia,context:PublishRow)=>Promise<boolean>;
  x_cost_authorized?:boolean;x_max_create_microdollars?:number;x_max_identity_microdollars?:number;monthly_cap_microdollars?:number;
};
export type PublishInput={request_id:string;task_id:string;review_token:string;platform:Platform;account_id:string;scheduled_at:string;payload:PublishingPayload};
export type PublishRow={id:string;request_id:string;task_id:string;source_id:string;source_hash:string;source_clearance_token:string;review_token:string;artifact_hash:string;variant_hash:string;platform:Platform;account_id:string;account_version:string;remote_id:string;payload:PublishingPayload;scheduled_at:string|Date;version:string;status:string;reason:string|null;claim_token:string|null;claimed_at:string|Date|null;published_at?:string|Date|null;provider_id:string|null;receipt:PublicationReceipt|null;reserved_microdollars:number|string;budget_month:string|null};
export type PublicationReceipt={platform:Platform;provider_id:string;http_status:number;url?:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9:_-]{1,200}$/;
const iso=(value:string|Date)=>new Date(value).toISOString();
function reference(id:string){if(typeof id!=="string"||!UUID.test(id))throw new PublicationValidationError("Invalid publication id");}
function objectKeys(value:object,allowed:string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))throw new PublicationValidationError("Unsupported publication payload field");}
function normalizedPayload(platform:Platform,payload:PublishingPayload):PublishingPayload{
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new PublicationValidationError("Publication payload required");
  objectKeys(payload,["text","media"]);
  if(typeof payload.text!=="string"||!payload.text.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text))throw new PublicationValidationError("Invalid publication text");
  assertSourcePrivacy(payload.text);
  if(platform==="X"){
    const {weightedLength,valid}=xPostTextValidation(payload.text);
    if(weightedLength===null)throw new PublicationValidationError("X draft exceeds the app's 4,096-character input safety limit; shorten URLs or revise the draft before approval");
    if(weightedLength>280)throw new PublicationValidationError("X single-post limit exceeded; revise the final draft before approval");
    if(!valid)throw new PublicationValidationError("Invalid X publication text; revise the final draft before approval");
  }
  if(platform==="LinkedIn"&&payload.text.length>3000)throw new PublicationValidationError("LinkedIn text limit exceeded");
  if(platform==="Instagram"&&payload.text.length>2200)throw new PublicationValidationError("Instagram caption limit exceeded");
  if(platform!=="Instagram"){
    if(payload.media!==undefined&&(!Array.isArray(payload.media)||payload.media.length))throw new PublicationValidationError("Only text-only LinkedIn and X posts are supported");
    return {text:payload.text};
  }
  if(!Array.isArray(payload.media)||payload.media.length!==1)throw new PublicationValidationError("Instagram requires one verified JPEG image; caption-only and carousel publishing are not enabled");
  const media=payload.media.map(item=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new PublicationValidationError("Invalid Instagram media");
    objectKeys(item,["url","sha256","mime_type"]);
    let url:URL;try{url=new URL(item.url);}catch{throw new PublicationValidationError("Invalid Instagram media URL");}
    if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||url.port||!url.hostname.includes(".")||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname.includes(":"))throw new PublicationValidationError("Instagram media requires a public immutable HTTPS URL without credentials or query parameters");
    if(item.mime_type!=="image/jpeg"||!SHA.test(item.sha256))throw new PublicationValidationError("Instagram media requires JPEG and an exact SHA-256");
    return {url:url.toString(),sha256:item.sha256,mime_type:"image/jpeg" as const};
  });
  if(new Set(media.map(item=>item.url)).size!==media.length)throw new PublicationValidationError("Duplicate Instagram media");
  return {text:payload.text,media};
}
function accountFor(runtime:PublishingRuntime,id:string,platform:Platform){
  const accounts=(runtime.accounts||[]).filter(account=>account.id===id&&account.platform===platform);
  if(accounts.length!==1)throw new PublicationValidationError("Publishing account is not configured");
  const account=accounts[0];
  if(!ID.test(account.id)||!ID.test(account.authorization_version)||typeof account.label!=="string"||!account.label.trim()||account.label.length>200||!Array.isArray(account.scopes))throw new PublicationValidationError("Invalid publishing account configuration");
  if(account.enabled!==true||account.verified!==true)throw new PublicationValidationError("Publishing account is disabled or its identity is unverified");
  if(platform==="LinkedIn"&&!/^urn:li:(?:person|organization):[A-Za-z0-9_-]+$/.test(account.remote_id))throw new PublicationValidationError("Invalid LinkedIn author identity");
  if(platform!=="LinkedIn"&&!/^\d{1,30}$/.test(account.remote_id))throw new PublicationValidationError("Invalid publishing account identity");
  return account;
}
function accountBlocker(account:PublishingAccount){
  if(account.platform==="LinkedIn"){
    if(!/^20\d{2}(?:0[1-9]|1[0-2])$/.test(account.linkedin_version||""))return "Configure a currently supported LinkedIn API version";
    if(!account.scopes.includes(account.remote_id.startsWith("urn:li:organization:")?"w_organization_social":"w_member_social"))return "LinkedIn posting permission is missing";
  }
  if(account.platform==="X"&&!["tweet.write","users.read","tweet.read"].every(scope=>account.scopes.includes(scope)))return "X user-context posting permissions are missing";
  if(account.platform==="Instagram"){
    if(account.professional!==true)return "Instagram requires a verified Professional account";
    if(!/^v\d{2}\.0$/.test(account.instagram_api_version||"")||!["instagram","facebook"].includes(account.instagram_login||""))return "Configure Instagram API version and login type";
    const scopes=account.instagram_login==="instagram"?["instagram_business_basic","instagram_business_content_publish"]:["instagram_basic","instagram_content_publish","pages_read_engagement"];
    if(!scopes.every(scope=>account.scopes.includes(scope)))return "Instagram publishing permissions are missing";
  }
  return null;
}
function runtimeBlocker(runtime:PublishingRuntime,account:PublishingAccount){
  if(runtime.enabled!==true)return "Publishing is disabled by server configuration";
  if(runtime.credential_use_authorized!==true||!runtime.credential||account.credential_configured===false)return "Authorized server-side publishing credentials are not configured";
  const lateness=runtime.max_lateness_seconds??300;
  if(!Number.isInteger(lateness)||lateness<1||lateness>3600||runtime.scheduler_authorized!==true||!Number.isInteger(runtime.scheduler_interval_seconds)||runtime.scheduler_interval_seconds!<1||runtime.scheduler_interval_seconds!>lateness)return "A sufficiently frequent authorized publishing scheduler is required";
  const blocked=accountBlocker(account);if(blocked)return blocked;
  if(account.platform==="Instagram"&&!runtime.verifyMedia)return "Verified immutable public Instagram media is required";
  if(account.platform==="X"&&(runtime.x_cost_authorized!==true||!Number.isSafeInteger(runtime.x_max_create_microdollars)||runtime.x_max_create_microdollars!<200000||runtime.x_max_create_microdollars!>1000000||!Number.isSafeInteger(runtime.x_max_identity_microdollars)||runtime.x_max_identity_microdollars!<=0||runtime.x_max_identity_microdollars!>1000000||!Number.isSafeInteger(runtime.monthly_cap_microdollars)||runtime.monthly_cap_microdollars!<=0))return "X paid API cost approval and a separate X monthly budget are required";
  return null;
}
function intentVersion(row:Pick<PublishRow,"task_id"|"source_id"|"source_hash"|"source_clearance_token"|"review_token"|"artifact_hash"|"variant_hash"|"platform"|"account_id"|"account_version"|"remote_id"|"payload"|"scheduled_at">){
  return hash(JSON.stringify({schema:1,task_id:row.task_id,source_id:row.source_id,source_hash:row.source_hash,source_clearance_token:row.source_clearance_token,review_token:row.review_token,artifact_hash:row.artifact_hash,variant_hash:row.variant_hash,platform:row.platform,account_id:row.account_id,account_version:row.account_version,remote_id:row.remote_id,payload:normalizedPayload(row.platform,row.payload),scheduled_at:iso(row.scheduled_at)}));
}
const clearanceToken=(source:Source)=>hash(JSON.stringify({source_hash:source.hash,clearance_id:source.clearance_id||"legacy",cleared_at:source.cleared_at?iso(source.cleared_at):null}));
async function finalArtifact(tx:Connection,id:string,expected:string,platform:Platform){
  const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
  if(!task||task.revision_parent_task_id||task.checkpoint!==6||!["review","approved"].includes(task.status))throw new PublicationValidationError("Final task is not ready for publishing");
  await assertNoPendingAgentRevision(tx,id);
  const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[task.source_id]))[0];
  if(!sourceEligible(source,task.source_hash))throw new PublicationValidationError("Source clearance was revoked or invalidated");
  const latest=(await tx.query<{id:string;version:string;bundle:Artifact[]}>("SELECT * FROM content_revisions WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1",[id]))[0];
  const bundle=latest?.bundle||await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[id]);assertBundle(bundle);
  const version=latest?bundleVersion(bundle,source.hash):hash(bundle.map(item=>item.hash).join("|"));
  const token=latest?`revision:${latest.id}:${version}`:`original:${version}`;
  if(expected!==token||(latest&&latest.version!==version))throw new PublicationValidationError("Final artifact changed; fresh exact-version approval required");
  const approval=latest?(await tx.query<{version:string;evidence_version:string|null}>("SELECT version,evidence_version FROM revision_approvals WHERE revision_id=$1",[latest.id]))[0]:(await tx.query<{version:string;evidence_version:string|null}>("SELECT version,evidence_version FROM approvals WHERE task_id=$1",[id]))[0];
  if(approval?.version!==version)throw new PublicationValidationError("Approve the exact final artifact before scheduling publication");
  const quality=await reviewReadiness(tx,id,bundle,source);
  if(!await evidenceApprovalCurrent(tx,id,token,quality,approval?.evidence_version))throw new PublicationValidationError("Resolve source-grounding flags before publishing");
  const artifact=bundle.find(item=>item.role==="Platform Adapter")!,variants=platformVariants(artifact),variant=variants.variants.find(item=>item.platform===platform)!;
  if(!variants.complete||!variant.text||!variant.hash)throw new PublicationValidationError("Final platform variants are incomplete");
  return {task,source,artifact,variant};
}

/** Authenticated owner API only. Draft approval is deliberately distinct from publication approval. */
export class Publishing{
  constructor(readonly db:Database,readonly runtime:PublishingRuntime={}){}
  async snapshot(){
    const jobs=await this.db.query<PublishRow>("SELECT * FROM publishing_outbox ORDER BY created,id");
    const approvals=await this.db.query("SELECT * FROM publishing_approvals ORDER BY created,id");
    const attempts=await this.db.query("SELECT * FROM publishing_attempts ORDER BY created,id");
    const accounts=(this.runtime.accounts||[]).map(account=>{
      let reason:string|null=null;try{reason=runtimeBlocker(this.runtime,accountFor(this.runtime,account.id,account.platform));}catch(error){reason=(error as Error).message;}
      const lastSuccess=jobs.filter(job=>job.account_id===account.id&&job.account_version===account.authorization_version&&job.remote_id===account.remote_id&&job.status==="published"&&job.receipt).at(-1);
      return {readiness_kind:"configuration_only",live_connection_tested:!!lastSuccess,last_successful_publication:lastSuccess?{id:lastSuccess.id,published_at:lastSuccess.published_at,receipt:lastSuccess.receipt}:null,id:account.id,platform:account.platform,remote_id:account.remote_id,label:account.label,enabled:account.enabled===true,ready:!reason,reason};
    });
    return {enabled:this.runtime.enabled===true,accounts,jobs,approvals,attempts,acknowledgement:PUBLICATION_ACKNOWLEDGEMENT};
  }
  private async prepare(tx:Connection,input:PublishInput){
    reference(input.request_id);reference(input.task_id);
    if(!REQUIRED_PLATFORMS.includes(input.platform))throw new PublicationValidationError("Unsupported publishing platform");
    if(typeof input.review_token!=="string"||input.review_token.length>200)throw new PublicationValidationError("Exact artifact review token required");
    if(typeof input.scheduled_at!=="string"||!/(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduled_at)||!Number.isFinite(Date.parse(input.scheduled_at)))throw new PublicationValidationError("Scheduled publication must include a time zone");
    const account=accountFor(this.runtime,input.account_id,input.platform),payload=normalizedPayload(input.platform,input.payload);
    const context=await finalArtifact(tx,input.task_id,input.review_token,input.platform);
    if(payload.text!==context.variant.text)throw new PublicationValidationError("Publication text must exactly match the approved final platform variant");
    const values={task_id:input.task_id,source_id:context.source.id,source_hash:context.source.hash,source_clearance_token:clearanceToken(context.source),review_token:input.review_token,artifact_hash:context.artifact.hash,variant_hash:context.variant.hash!,platform:input.platform,account_id:account.id,account_version:account.authorization_version,remote_id:account.remote_id,payload,scheduled_at:iso(input.scheduled_at)};
    return {...values,version:intentVersion(values)};
  }
  async enqueue(input:PublishInput){
    return this.db.transaction(async tx=>{
      const draft=await this.prepare(tx,input);
      const prior=(await tx.query<{outbox_id:string;version:string}>("SELECT * FROM publishing_requests WHERE request_id=$1",[input.request_id]))[0];
      if(prior){if(prior.version!==draft.version)throw new PublicationValidationError("Publication request id reused for a different intent");return (await tx.query<PublishRow>("SELECT * FROM publishing_outbox WHERE id=$1",[prior.outbox_id]))[0];}
      if((await tx.query("SELECT id FROM publishing_outbox WHERE task_id=$1 AND platform=$2 AND account_id=$3 AND status IN ('claimed','uncertain')",[input.task_id,input.platform,input.account_id])).length)throw new PublicationValidationError("Uncertain publication requires reconciliation; replay is blocked");
      let row=(await tx.query<PublishRow>("INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version,source_clearance_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(version) DO NOTHING RETURNING *",[randomUUID(),input.request_id,draft.task_id,draft.source_id,draft.source_hash,draft.review_token,draft.artifact_hash,draft.variant_hash,draft.platform,draft.account_id,draft.account_version,draft.remote_id,JSON.stringify(draft.payload),draft.scheduled_at,draft.version,draft.source_clearance_token]))[0];
      row||=(await tx.query<PublishRow>("SELECT * FROM publishing_outbox WHERE version=$1",[draft.version]))[0];
      await tx.query("INSERT INTO publishing_requests(request_id,outbox_id,version) VALUES($1,$2,$3)",[input.request_id,row.id,draft.version]);
      return row;
    });
  }
  async revise(id:string,expectedVersion:string,input:Omit<PublishInput,"request_id">){
    reference(id);
    return this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,expectedVersion);
      if(!["staged","approved","invalidated","missed"].includes(row.status))throw new PublicationValidationError("Claimed or terminal publications cannot be edited");
      const draft=await this.prepare(tx,{...input,request_id:row.request_id});
      if(draft.task_id!==row.task_id)throw new PublicationValidationError("Publication task cannot change");
      if(draft.version===row.version)return row;
      return (await tx.query<PublishRow>("UPDATE publishing_outbox SET source_id=$2,source_hash=$3,review_token=$4,artifact_hash=$5,variant_hash=$6,platform=$7,account_id=$8,account_version=$9,remote_id=$10,payload=$11,scheduled_at=$12,version=$13,source_clearance_token=$14,status='staged',reason='Changed publication requires fresh owner approval',updated=now() WHERE id=$1 RETURNING *",[id,draft.source_id,draft.source_hash,draft.review_token,draft.artifact_hash,draft.variant_hash,draft.platform,draft.account_id,draft.account_version,draft.remote_id,JSON.stringify(draft.payload),draft.scheduled_at,draft.version,draft.source_clearance_token]))[0];
    });
  }
  private async lock(tx:Connection,id:string,version:string){
    const row=(await tx.query<PublishRow>("SELECT * FROM publishing_outbox WHERE id=$1 FOR UPDATE",[id]))[0];
    if(!row||row.version!==version)throw new PublicationValidationError("Stale publication version; refresh before acting");
    return row;
  }
  private async validate(tx:Connection,row:PublishRow,requireFresh=false){
    if(intentVersion(row)!==row.version)throw new PublicationValidationError("Publication intent integrity check failed");
    const account=accountFor(this.runtime,row.account_id,row.platform);
    if(account.authorization_version!==row.account_version||account.remote_id!==row.remote_id)throw new PublicationValidationError("Publishing account changed; fresh owner approval required");
    if(this.runtime.accountCurrent&&!await this.runtime.accountCurrent(account,tx,requireFresh))throw new PublicationValidationError("Publishing account changed; fresh owner approval required");
    const context=await finalArtifact(tx,row.task_id,row.review_token,row.platform);
    if(context.source.id!==row.source_id||context.source.hash!==row.source_hash||clearanceToken(context.source)!==row.source_clearance_token||context.artifact.hash!==row.artifact_hash||context.variant.hash!==row.variant_hash||context.variant.text!==row.payload.text)throw new PublicationValidationError("Final artifact changed; fresh owner approval required");
    return account;
  }
  async approve(id:string,expectedVersion:string,ownerAcknowledged:boolean){
    reference(id);if(ownerAcknowledged!==true)throw new PublicationValidationError("Explicit publication acknowledgement is required");
    return this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,expectedVersion);if(!["staged","approved"].includes(row.status))throw new PublicationValidationError("Publication is not available for approval");
      await this.validate(tx,row);
      await tx.query("INSERT INTO publishing_approvals(id,outbox_id,version,acknowledgement) VALUES($1,$2,$3,$4) ON CONFLICT(outbox_id,version) DO NOTHING",[randomUUID(),id,row.version,PUBLICATION_ACKNOWLEDGEMENT]);
      return (await tx.query<PublishRow>("UPDATE publishing_outbox SET status='approved',reason=NULL,updated=now() WHERE id=$1 RETURNING *",[id]))[0];
    });
  }
  async cancel(id:string,expectedVersion:string){
    reference(id);return this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,expectedVersion);
      if(row.status==="cancelled")return row;
      if(["claimed","published","uncertain"].includes(row.status))throw new PublicationValidationError("Publication has started or may have completed; it cannot be cancelled or replayed");
      return (await tx.query<PublishRow>("UPDATE publishing_outbox SET status='cancelled',reason='Owner cancelled before dispatch',updated=now() WHERE id=$1 RETURNING *",[id]))[0];
    });
  }
  /** At most one item per call. Crash/timeout after claim is terminal uncertain, never requeued. */
  async dispatch(now=new Date()){
    if(!Number.isFinite(now.getTime()))throw new PublicationValidationError("Invalid dispatch time");
    if(this.runtime.enabled!==true)return {status:"disabled"};
    const claim=await this.db.transaction(async tx=>{
      await tx.query("UPDATE publishing_outbox SET status='uncertain',reason='Claim expired; reconcile provider receipt before any further publication',updated=now() WHERE status='claimed' AND claimed_at<$1",[new Date(now.getTime()-10*60_000)]);
      const row=(await tx.query<PublishRow>("SELECT * FROM publishing_outbox WHERE status='approved' AND scheduled_at<=$1 ORDER BY scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[now]))[0];
      if(!row)return null;
      let account:PublishingAccount;
      try{account=await this.validate(tx,row);}catch{await tx.query("UPDATE publishing_outbox SET status='invalidated',reason='Source, final artifact, or account approval changed; review again',updated=now() WHERE id=$1",[row.id]);return {blocked:row.id,reason:"Publication approval invalidated"};}
      if(!(await tx.query("SELECT id FROM publishing_approvals WHERE outbox_id=$1 AND version=$2",[row.id,row.version])).length){await tx.query("UPDATE publishing_outbox SET status='invalidated',reason='Exact publication approval missing' WHERE id=$1",[row.id]);return {blocked:row.id,reason:"Exact publication approval missing"};}
      const blocker=runtimeBlocker(this.runtime,account);
      if(blocker)return {blocked:row.id,reason:blocker};
      if(now.getTime()-new Date(row.scheduled_at).getTime()>(this.runtime.max_lateness_seconds??300)*1000){await tx.query("UPDATE publishing_outbox SET status='missed',reason='Scheduled time missed; reschedule and approve again',updated=now() WHERE id=$1",[row.id]);return {blocked:row.id,reason:"Scheduled time missed"};}
      if((await tx.query("SELECT id FROM publishing_outbox WHERE id<>$1 AND task_id=$2 AND platform=$3 AND account_id=$4 AND status IN ('claimed','uncertain')",[row.id,row.task_id,row.platform,row.account_id])).length)return {blocked:row.id,reason:"Uncertain publication blocks replay"};
      const month=istMonth(now),reserve=row.platform==="X"?this.runtime.x_max_create_microdollars!+this.runtime.x_max_identity_microdollars!:0;
      if(reserve){
        await tx.query("SELECT id FROM publishing_budget_guard WHERE id=1 FOR UPDATE");
        await tx.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);await tx.query("SELECT month FROM budget_months WHERE month=$1 FOR UPDATE",[month]);
        const posts=await tx.query<{cost:string}>("SELECT COALESCE(SUM(reserved_microdollars),0)::text AS cost FROM publishing_outbox WHERE platform='X' AND (budget_month=$1 OR status IN ('claimed','uncertain'))",[month]);
        if(Number(posts[0].cost)+reserve>this.runtime.monthly_cap_microdollars!)return {blocked:row.id,reason:"Separate X publishing budget has insufficient safe capacity"};
      }
      const token=randomUUID();
      const claimed=(await tx.query<PublishRow>("UPDATE publishing_outbox SET status='claimed',claim_token=$2,claimed_at=$3,budget_month=$4,reserved_microdollars=$5,reason=NULL,updated=now() WHERE id=$1 RETURNING *",[row.id,token,now,month,reserve]))[0];
      return {row:claimed,account};
    });
    if(!claim)return {status:"idle"};
    if("blocked" in claim)return {status:"blocked",id:claim.blocked,reason:claim.reason};
    const {row,account}=claim;
    try{
      let credential:string;
      try{credential=await this.runtime.credential!(account);}catch{await this.db.query("UPDATE publishing_outbox SET reserved_microdollars=0 WHERE id=$1 AND claim_token=$2 AND status='claimed'",[row.id,row.claim_token]);throw new PublishFailure("Authorized publishing credential unavailable before publication",false);}
      if(typeof credential!=="string"||!credential.trim()||/[\r\n]/.test(credential))throw new PublishFailure("Authorized publishing credential unavailable",false);
      if(row.platform==="Instagram")for(const media of row.payload.media!)if(!await this.runtime.verifyMedia!(media,row))throw new PublishFailure("Immutable Instagram media verification failed",false);
      const receipt=await publishOfficial(row,account,credential,this.runtime.fetch||fetch,{
        before:async(stage)=>{
          if(this.runtime.signal?.aborted)throw new PublishFailure("Publishing invocation deadline reached before request",false);
          await this.db.transaction(async tx=>{
            const current=await this.lock(tx,row.id,row.version);if(current.status!=="claimed"||current.claim_token!==row.claim_token)throw new PublishFailure("Publication claim is no longer active",false);
            const checked=await this.validate(tx,current,true),blocked=runtimeBlocker(this.runtime,checked);if(blocked)throw new PublishFailure(blocked,false);
            const currentTime=(this.runtime.now||(()=>new Date()))();
            if(!Number.isFinite(currentTime.getTime())||currentTime.getTime()<new Date(row.scheduled_at).getTime()||currentTime.getTime()-new Date(row.scheduled_at).getTime()>(this.runtime.max_lateness_seconds??300)*1000)throw new PublishFailure("Scheduled publishing window expired before request; reschedule and approve again",false);
            await tx.query("INSERT INTO publishing_attempts(id,outbox_id,claim_token,stage,state) VALUES($1,$2,$3,$4,'started')",[randomUUID(),row.id,row.claim_token,stage]);
          });
        },
        after:async(stage,status,providerId,state)=>{await this.db.query("UPDATE publishing_attempts SET state=$3,http_status=$4,provider_id=$5,updated=now() WHERE outbox_id=$1 AND stage=$2 AND claim_token=$6",[row.id,stage,state,status,providerId||null,row.claim_token]);}
      },this.runtime.sleep,this.runtime.signal);
      const saved=await this.db.query("UPDATE publishing_outbox SET status='published',provider_id=$3,receipt=$4,published_at=$5,updated=now() WHERE id=$1 AND claim_token=$2 AND status='claimed' RETURNING id",[row.id,row.claim_token,receipt.provider_id,JSON.stringify(receipt),(this.runtime.now||(()=>new Date()))()]);
      if(!saved.length)return {status:"uncertain",id:row.id,reason:"Receipt could not finalize the active claim; reconciliation required"};
      return {status:"published",id:row.id,receipt};
    }catch(error){
      const uncertain=!(error instanceof PublishFailure)||error.uncertain;
      const status=uncertain?"uncertain":"failed";
      // Never persist provider bodies, exception messages, headers, credentials, or raw request URLs.
      await this.db.query("UPDATE publishing_outbox SET status=$3,reason=$4,updated=now() WHERE id=$1 AND claim_token=$2 AND status='claimed'",[row.id,row.claim_token,status,uncertain?"Provider outcome uncertain; automatic replay prohibited":"Publication stopped or rejected; explicit review required"]);
      return {status,id:row.id};
    }
  }
}

export class PublishFailure extends Error{constructor(message:string,readonly uncertain:boolean){super(message);}}
export type AdapterJournal={before:(stage:string)=>Promise<void>;after:(stage:string,status:number|null,providerId:string|null,state:"received"|"rejected"|"uncertain")=>Promise<void>};
/** Official APIs only. No token acquisition/refresh, uploads, account discovery, retries, or redirects. */
export async function publishOfficial(row:Pick<PublishRow,"platform"|"payload"|"remote_id">,account:PublishingAccount,token:string,transport:typeof fetch,journal:AdapterJournal,pause:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)),signal?:AbortSignal):Promise<PublicationReceipt>{
  const payload=normalizedPayload(row.platform,row.payload),blocked=accountBlocker(account);
  if(blocked||row.remote_id!==account.remote_id||row.platform!==account.platform)throw new PublishFailure("Publishing account or permissions are invalid",false);
  const request=async(stage:string,url:string,init:RequestInit,readId:(response:Response,data:Record<string,unknown>)=>string|null)=>{
    if(signal?.aborted)throw new PublishFailure("Publishing invocation deadline reached before request",false);
    await journal.before(stage);
    if(signal?.aborted){await journal.after(stage,null,null,"rejected");throw new PublishFailure("Publishing invocation deadline reached before request",false);}
    let response:Response;
    try{response=await transport(url,{...init,redirect:"error",signal:signal?AbortSignal.any([AbortSignal.timeout(30_000),signal]):AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${token}`,...init.headers}});}catch{await journal.after(stage,null,null,"uncertain");throw new PublishFailure("Provider request outcome is uncertain",true);}
    if(!response.ok){const uncertain=response.status>=500||response.status===408;await journal.after(stage,response.status,null,uncertain?"uncertain":"rejected");throw new PublishFailure("Provider rejected publication",uncertain);}
    let data:Record<string,unknown>={};
    if(row.platform!=="LinkedIn")try{data=await response.json();}catch{await journal.after(stage,response.status,null,"uncertain");throw new PublishFailure("Provider returned an unreadable receipt",true);}
    const id=readId(response,data);
    if(!id){await journal.after(stage,response.status,null,"uncertain");throw new PublishFailure("Provider returned no verifiable receipt",true);}
    await journal.after(stage,response.status,id,"received");return {id,status:response.status,data};
  };
  if(row.platform==="LinkedIn"){
    const result=await request("publish","https://api.linkedin.com/rest/posts",{method:"POST",headers:{"Content-Type":"application/json","Linkedin-Version":account.linkedin_version!,"X-Restli-Protocol-Version":"2.0.0"},body:JSON.stringify({author:row.remote_id,commentary:payload.text,visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false})},(response)=>{const id=response.headers.get("x-restli-id");return response.status===201&&id&&/^urn:li:(?:share|ugcPost):\d+$/.test(id)?id:null;});
    return {platform:row.platform,provider_id:result.id,http_status:result.status,url:`https://www.linkedin.com/feed/update/${encodeURIComponent(result.id)}/`};
  }
  if(row.platform==="X"){
    const identity=await request("identity","https://api.x.com/2/users/me",{method:"GET"},(response,data)=>{const id=(data.data as {id?:unknown}|undefined)?.id;return response.status===200&&typeof id==="string"&&/^\d{1,30}$/.test(id)?id:null;});
    if(identity.id!==row.remote_id)throw new PublishFailure("X credential belongs to a different account",false);
    const result=await request("publish","https://api.x.com/2/tweets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:payload.text})},(response,data)=>{const id=(data.data as {id?:unknown}|undefined)?.id;return response.status===201&&typeof id==="string"&&/^\d{1,30}$/.test(id)?id:null;});
    return {platform:row.platform,provider_id:result.id,http_status:result.status,url:`https://x.com/i/web/status/${result.id}`};
  }
  const root=`https://${account.instagram_login==="instagram"?"graph.instagram.com":"graph.facebook.com"}/${account.instagram_api_version}`;
  const graphId=(response:Response,data:Record<string,unknown>)=>response.status===200&&typeof data.id==="string"&&/^\d{1,30}$/.test(data.id)?data.id:null;
  const post=async(stage:string,fields:Record<string,string>,edge="media")=>request(stage,`${root}/${row.remote_id}/${edge}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(fields).toString()},graphId);
  const container=(await post("container_0",{image_url:payload.media![0].url,caption:payload.text})).id;
  // Poll only this durable container. Never recreate or automatically replay a publish.
  let status:unknown="IN_PROGRESS";
  for(let check=0;check<5;check++){
    if(check)await pause(1000);
    const ready=await request(check?`container_status_${check}`:"container_status",`${root}/${container}?fields=status_code`,{method:"GET"},(_response,data)=>typeof data.status_code==="string"&&["FINISHED","IN_PROGRESS","ERROR","EXPIRED","PUBLISHED"].includes(data.status_code)?container:null);
    status=ready.data.status_code;
    if(status!=="IN_PROGRESS")break;
  }
  if(status!=="FINISHED")throw new PublishFailure("Instagram container is not ready; reconcile without replay",status==="PUBLISHED");
  const result=await post("publish",{creation_id:container},"media_publish");
  return {platform:row.platform,provider_id:result.id,http_status:result.status};
}
