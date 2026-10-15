import {GitHubAppAuthError} from "./github-app-auth";
import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {hash,type Source} from "./domain";
import {assertSourcePrivacy,SourceIntake,validateSourceInput,type SourceInput} from "./sources";

/** Non-secret, server-held configuration. Enabling alone never authorizes syncing. */
export type SourceIngestionConfig={
  github?:{enabled?:boolean;sync_authorized?:boolean;private_read_authorized?:boolean;app?:import('./github-app-auth').GitHubAppConfig;repositories:string[];since?:string};
  youtube?:{enabled?:boolean;sync_authorized?:boolean;channel_ids?:string[];handles?:string[]};
  chat?:{enabled?:boolean};
};
export type SourceProvider="github"|"youtube";
export type ChatProvider="chatgpt"|"claude"|"gemini"|"codex"|"spark";
export type SourceIngestionDependencies={fetch?:typeof fetch;env?:Record<string,string|undefined>;now?:()=>Date;signal?:AbortSignal;githubCredential?:(repository:string,signal?:AbortSignal)=>Promise<string>};
export type IngestionCounts={staged:number;duplicates:number;rejected:number};
export type ProviderSyncResult=IngestionCounts&{provider:SourceProvider;status:"synced"|"partial"|"blocked"|"busy"|"failed";has_more:boolean;error?:string};
export type SourceSyncResult={status:"synced"|"partial"|"blocked"|"failed";providers:ProviderSyncResult[]};
export type ImportedCandidate={provider:SourceProvider|ChatProvider;scope:string;external_id:string;source_url:string|null;input:SourceInput;metadata?:Record<string,unknown>};
export const CHAT_IMPORT_MAX_BYTES=2_000_000;
export const CHAT_IMPORT_MAX_CONVERSATIONS=100;
const PAGE_BUDGET=2,MAX_SCOPES=10,MAX_SCOPES_PER_RUN=2,MAX_RESPONSE_BYTES=2_000_000;
const CHAT_PROVIDERS:ChatProvider[]=["chatgpt","claude","gemini","codex","spark"];
const REPOSITORY=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
const HANDLE=/^@[\p{L}\p{N}_.-]{3,30}$/u;
const VIDEO=/^[A-Za-z0-9_-]{11}$/;
const EXTERNAL_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PAGE_TOKEN=/^[A-Za-z0-9_=.~-]{1,512}$/;
const SHA=/^[a-fA-F0-9]{40,64}$/;
type Obj=Record<string,unknown>;
type SyncRow={provider:SourceProvider;scope:string;cursor:Obj;lease_token:string|null;last_synced_at:string|Date|null;last_error:string|null};
class IngestionError extends Error {constructor(readonly code:string){super(code);}}
const invalid=()=>new IngestionError("invalid_provider_response");
const object=(value:unknown):Obj=>{if(!value||typeof value!=="object"||Array.isArray(value))throw invalid();return value as Obj;};
const string=(value:unknown,max=12_000):string=>{if(typeof value!=="string"||value.length>max)throw invalid();return value;};
function iso(value:unknown):string {if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value))throw invalid();const d=new Date(value),day=new Date(value.slice(0,10)+"T00:00:00Z");if(!Number.isFinite(d.getTime())||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))throw invalid();return d.toISOString();}
function errorCode(error:unknown):string{return error instanceof IngestionError||error instanceof GitHubAppAuthError?error.code:"sync_unavailable";}
function targetList(config:SourceIngestionConfig,provider:SourceProvider):string[]{
  const raw=provider==="github"?config.github?.repositories:[...(config.youtube?.channel_ids||[]),...(config.youtube?.handles||[])];
  if(!Array.isArray(raw)||raw.length===0||raw.length>MAX_SCOPES)throw new IngestionError("invalid_source_allowlist");
  const checked=raw.map(target=>{if(typeof target!=="string"||!(provider==="github"?REPOSITORY.test(target)&&!target.split("/")[1].includes(".."):CHANNEL.test(target)||HANDLE.test(target)))throw new IngestionError("invalid_source_allowlist");assertSourcePrivacy(target);return provider==="github"?target.toLowerCase():target;});
  return [...new Set(checked)];
}
/** Readiness only, not a connection test. Never returns secret values. */
export function sourceIngestionStatus(config:SourceIngestionConfig,env:Record<string,string|undefined>={}){
  return (["github","youtube"] as const).map(provider=>{
    const c=config?.[provider];let targets:string[]=[];let reason:string|undefined;
    if(c?.enabled!==true)reason="disabled";
    else if(c.sync_authorized!==true)reason="owner_sync_authorization_required";
    else {try{targets=targetList(config,provider);if(provider==="github"&&config.github?.since)iso(config.github.since);}catch{reason="invalid_source_allowlist";}}
    if(!reason&&provider==="youtube"&&!env.STUDIO_SOURCE_YOUTUBE_API_KEY)reason="youtube_api_key_missing";
    return {provider,enabled:c?.enabled===true,authorized:c?.sync_authorized===true,ready:!reason,reason:reason||null,targets};
  });
}
function boundDatabase(db:Database,tx:Connection):Database{return {kind:db.kind,query:tx.query.bind(tx),transaction:work=>work(tx),close:async()=>{}};}
function counts():IngestionCounts{return {staged:0,duplicates:0,rejected:0};}
function sum(into:IngestionCounts,other:IngestionCounts){into.staged+=other.staged;into.duplicates+=other.duplicates;into.rejected+=other.rejected;}

/** Official read-only metadata adapters with explicit private-repository consent. No model calls, task enqueue, clearance, or publishing. */
export class SourceIngestion {
  private readonly fetcher:typeof fetch;private readonly env:Record<string,string|undefined>;private readonly now:()=>Date;
  constructor(readonly db:Database,readonly config:SourceIngestionConfig={},readonly deps:SourceIngestionDependencies={}){this.fetcher=deps.fetch||fetch;this.env=deps.env||process.env;this.now=deps.now||(()=>new Date());}
  async snapshot(){
    return {connections:sourceIngestionStatus(this.config,this.env),chat_import_enabled:this.config.chat?.enabled===true,
      sync:await this.db.query("SELECT provider,scope,last_attempted_at,last_synced_at,last_error,(lease_until>now()) AS running FROM source_sync_state ORDER BY provider,scope"),
      totals:await this.db.query("SELECT provider,count(*)::integer AS versions,count(DISTINCT source_id)::integer AS sources FROM source_provenance GROUP BY provider ORDER BY provider"),
      recent:await this.db.query("SELECT p.id,p.provider,p.scope,p.external_id,p.source_url,p.source_id,p.content_hash,p.metadata,p.imported_at,s.cleared FROM source_provenance p JOIN sources s ON s.id=p.source_id ORDER BY p.imported_at DESC,p.id LIMIT 50")};
  }
  async sync(provider:SourceProvider|"all"="all"):Promise<SourceSyncResult>{
    const deadline=AbortSignal.timeout(55_000);
    const signal=this.deps.signal?AbortSignal.any([deadline,this.deps.signal]):deadline;
    return new SourceIngestion(this.db,this.config,{...this.deps,fetch:this.fetcher,env:this.env,now:this.now,signal}).syncInternal(provider);
  }
  private async syncInternal(provider:SourceProvider|"all"):Promise<SourceSyncResult>{
    if(!["all","github","youtube"].includes(provider))throw new IngestionError("invalid_source_provider");
    const lastAttempts=await this.db.query<{provider:string;scope:string;last_attempted_at:string|Date|null}>("SELECT provider,scope,last_attempted_at FROM source_sync_state");
    const attempted=new Map(lastAttempts.map(row=>[row.provider+":"+row.scope,row.last_attempted_at?new Date(row.last_attempted_at).getTime():0]));
    const ready=sourceIngestionStatus(this.config,this.env).filter(row=>row.ready&&(provider==="all"||row.provider===provider));
    const targets=ready.flatMap(row=>row.targets.map(scope=>({provider:row.provider,scope}))).sort((a,b)=>(attempted.get(a.provider+":"+a.scope)||0)-(attempted.get(b.provider+":"+b.scope)||0));
    const selectedTargets=targets.slice(0,MAX_SCOPES_PER_RUN);
    const providers:ProviderSyncResult[]=[];
    for(const selected of provider==="all"?["github","youtube"] as const:[provider])providers.push(await this.syncProvider(selected,selectedTargets.filter(t=>t.provider===selected).map(t=>t.scope)));
    const status=providers.every(p=>p.status==="blocked")?"blocked":providers.every(p=>p.status==="failed")?"failed":providers.every(p=>p.status==="synced")?"synced":"partial";
    return {status,providers};
  }
  private async syncProvider(provider:SourceProvider,targets:string[]):Promise<ProviderSyncResult>{
    const readiness=sourceIngestionStatus(this.config,this.env).find(c=>c.provider===provider)!;
    const result:ProviderSyncResult={provider,status:"synced",...counts(),has_more:false};
    if(!readiness.ready)return {...result,status:"blocked",error:readiness.reason!};
    let successes=0,failures=0,busy=0;
    result.has_more=targets.length<readiness.targets.length;
    if(!targets.length)return {...result,status:"partial"};
    for(const scope of targets){
      if(this.deps.signal?.aborted){failures++;result.error="sync_cancelled";break;}
      const lease=randomUUID();
      const state=await this.acquire(provider,scope,lease);
      if(!state){busy++;continue;}
      try {
        const report=provider==="github"?await this.github(scope,state,lease,result):await this.youtube(scope,state,lease,result);
        result.has_more ||= report.has_more;successes++;
        await this.db.query("UPDATE source_sync_state SET last_synced_at=$4,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE provider=$1 AND scope=$2 AND lease_token=$3",[provider,scope,lease,this.now().toISOString()]);
      }catch(error){
        failures++;result.error=errorCode(error);
        await this.db.query("UPDATE source_sync_state SET last_error=$4,lease_token=NULL,lease_until=NULL WHERE provider=$1 AND scope=$2 AND lease_token=$3",[provider,scope,lease,result.error]);
      }
    }
    result.status=failures?(successes||result.staged||result.duplicates||result.rejected?"partial":"failed"):busy?(successes?"partial":"busy"):"synced";
    return result;
  }
  private async acquire(provider:SourceProvider,scope:string,lease:string):Promise<SyncRow|undefined>{
    await this.db.query("INSERT INTO source_sync_state(provider,scope) VALUES($1,$2) ON CONFLICT DO NOTHING",[provider,scope]);
    return (await this.db.query<SyncRow>("UPDATE source_sync_state SET lease_token=$3,last_attempted_at=now(),lease_until=now()+interval '120 seconds' WHERE provider=$1 AND scope=$2 AND (lease_until IS NULL OR lease_until<now()) RETURNING *",[provider,scope,lease]))[0];
  }
  private async request(url:URL,provider:SourceProvider):Promise<unknown>{
    const valid=provider==="github"?url.origin==="https://api.github.com"&&url.pathname.startsWith("/repos/"):url.origin==="https://www.googleapis.com"&&url.pathname.startsWith("/youtube/v3/");
    if(!valid||url.username||url.password)throw new IngestionError("invalid_provider_endpoint");
    const headers:Record<string,string>={Accept:"application/json"};
    if(provider==="github"){
      headers.Accept="application/vnd.github+json";headers["User-Agent"]="AI-Journey-Studio/source-ingestion";headers["X-GitHub-Api-Version"]="2026-03-10";
      // Only reached after enabled + explicit sync authorization + allowlist validation.
      if(this.deps.githubCredential&&this.config.github?.private_read_authorized===true){
        const repository=url.pathname.split('/').slice(2,4).join('/');
        const token=await this.deps.githubCredential(repository,this.deps.signal);
        if(typeof token!=="string"||!token.trim()||/[\r\n]/.test(token))throw new IngestionError("github_credential_unavailable");
        headers.Authorization="Bearer "+token;
      }else if(this.env.STUDIO_SOURCE_GITHUB_TOKEN)headers.Authorization="Bearer "+this.env.STUDIO_SOURCE_GITHUB_TOKEN;
    }else headers["X-Goog-Api-Key"]=this.env.STUDIO_SOURCE_YOUTUBE_API_KEY!;
    let response:Response;
    const timeout=AbortSignal.timeout(15_000),signal=this.deps.signal?AbortSignal.any([timeout,this.deps.signal]):timeout;
    try{response=await this.fetcher(url,{method:"GET",headers,redirect:"error",cache:"no-store",signal});}catch{throw new IngestionError(this.deps.signal?.aborted?"sync_cancelled":"provider_network_error");}
    if(!response.ok){await response.body?.cancel();throw new IngestionError(response.status===429?"provider_rate_limited":response.status===401||response.status===403?"provider_access_denied":"provider_http_error");}
    const contentLength=Number(response.headers.get("content-length")||0);
    if(contentLength>MAX_RESPONSE_BYTES){await response.body?.cancel();throw new IngestionError("provider_response_too_large");}
    const reader=response.body?.getReader();if(!reader)throw invalid();let total=0;const chunks:Uint8Array[]=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_RESPONSE_BYTES){await reader.cancel();throw new IngestionError("provider_response_too_large");}chunks.push(value);}}catch(error){if(error instanceof IngestionError)throw error;throw new IngestionError("provider_network_error");}finally{reader.releaseLock();}
    try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw invalid();}
  }
  private async persist(provider:SourceProvider,scope:string,lease:string,candidates:ImportedCandidate[],cursor:Obj,rejected:number):Promise<IngestionCounts>{
    return this.db.transaction(async tx=>{
      const state=(await tx.query<SyncRow>("SELECT * FROM source_sync_state WHERE provider=$1 AND scope=$2 FOR UPDATE",[provider,scope]))[0];
      if(!state||state.lease_token!==lease)throw new IngestionError("sync_lease_expired");
      const result=await this.stage(tx,candidates);result.rejected+=rejected;
      await tx.query("UPDATE source_sync_state SET cursor=$4 WHERE provider=$1 AND scope=$2 AND lease_token=$3",[provider,scope,lease,JSON.stringify(cursor)]);
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,NULL,'source_sync_staged',$2)",[randomUUID(),JSON.stringify({provider,scope,...result,cleared:false})]);
      return result;
    });
  }
  private async stage(tx:Connection,candidates:ImportedCandidate[]):Promise<IngestionCounts>{
    const result=counts(),intake=new SourceIntake(boundDatabase(this.db,tx));
    for(const candidate of [...candidates].sort((a,b)=>hash(a.input.text).localeCompare(hash(b.input.text)))){
      const contentHash=hash(JSON.stringify(candidate.input));
      // Serialize same-source imports across connectors without provider content in logs.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[hash(candidate.input.text)]);
      const existing=await tx.query("SELECT id FROM source_provenance WHERE provider=$1 AND scope=$2 AND external_id=$3 AND content_hash=$4",[candidate.provider,candidate.scope,candidate.external_id,contentHash]);
      if(existing.length){result.duplicates++;continue;}
      // SourceIntake rejects incompatible metadata for identical text. Check first so
      // a known conflict does not abort the page's transaction after a SQL failure.
      const same=(await tx.query<Source>("SELECT * FROM sources WHERE hash=$1",[hash(candidate.input.text)]))[0];
      if(same&&(same.text!==candidate.input.text||same.category!==candidate.input.category||same.reported_date!==candidate.input.reported_date)){result.rejected++;continue;}
      const source=await intake.stage(candidate.input);
      const rows=await tx.query("INSERT INTO source_provenance(id,source_id,provider,scope,external_id,content_hash,source_url,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",[randomUUID(),source.id,candidate.provider,candidate.scope,candidate.external_id,contentHash,candidate.source_url,JSON.stringify(candidate.metadata||{})]);
      if(rows.length)result.staged++;else result.duplicates++;
    }
    return result;
  }
  private async github(scope:string,state:SyncRow,lease:string,progress:IngestionCounts):Promise<IngestionCounts&{has_more:boolean}>{
    const base="https://api.github.com/repos/"+scope;
    const repo=object(await this.request(new URL(base),"github"));
    if(typeof repo.full_name!=="string"||repo.full_name.toLowerCase()!==scope)throw new IngestionError("repository_allowlist_mismatch");
    if(repo.private===true&&(repo.visibility==="private"||repo.visibility==="internal")){
      if(this.config.github?.private_read_authorized!==true||(!this.env.STUDIO_SOURCE_GITHUB_TOKEN&&!this.deps.githubCredential))throw new IngestionError("private_repository_authorization_required");
      if(repo.permissions&&object(repo.permissions).pull!==true)throw new IngestionError("repository_read_permission_required");
    }else if(repo.private!==false||repo.visibility!=="public")throw new IngestionError("repository_visibility_unknown");
    const configured=this.config.github?.since?iso(this.config.github.since):null;
    let cursor=state.cursor||{};
    if(cursor.configuration!==configured)cursor={configuration:configured};
    const now=this.now().toISOString();
    const since=cursor.since?iso(cursor.since):configured||new Date(this.now().getTime()-30*86_400_000).toISOString();
    const until=cursor.until?iso(cursor.until):now;
    if(since>until)throw new IngestionError("invalid_source_window");
    let page=cursor.page===undefined?1:Number(cursor.page);if(!Number.isSafeInteger(page)||page<1||page>100_000)throw invalid();
    const total={...counts(),has_more:false};
    for(let batch=0;batch<PAGE_BUDGET;batch++){
      const url=new URL(base+"/commits");url.search=new URLSearchParams({per_page:"100",page:String(page),since,until}).toString();
      const data=await this.request(url,"github");if(!Array.isArray(data)||data.length>100)throw invalid();
      const candidates:ImportedCandidate[]=[];let rejected=0;
      for(const entry of data){try{
        const row=object(entry),sha=string(row.sha,64);if(!SHA.test(sha))throw invalid();
        const commit=object(row.commit),committer=object(commit.committer),date=iso(committer.date).slice(0,10);
        const login=(value:unknown)=>{if(value===null||value===undefined)return null;const candidate=string(object(value).login,100);if(!/^[A-Za-z0-9_\[\]-]{1,100}$/.test(candidate))throw invalid();assertSourcePrivacy(candidate);return candidate;};
        const authorLogin=login(row.author),committerLogin=login(row.committer);
        const text=`Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: ${scope}\nAuthor account: ${authorLogin||"unattributed"}\nCommitter account: ${committerLogin||"unattributed"}\nCommit: ${sha}\n${string(commit.message)}`;
        const input={text,category:"build-log",reported_date:date};validateSourceInput(input,this.now());
        candidates.push({provider:"github",scope,external_id:sha.toLowerCase(),source_url:`https://github.com/${scope}/commit/${sha}`,input,metadata:{author_login:authorLogin,committer_login:committerLogin,repository_visibility:repo.visibility}});
      }catch{rejected++;}}
      const more=data.length===100;page++;
      // Revisit the fixed lower bound after each completed sweep: a newly pushed
      // commit can carry an older commit timestamp. Hash dedup keeps this safe.
      const next=more?{configuration:configured,since,until,page}:{configuration:configured,since,page:1};
      const saved=await this.persist("github",scope,lease,candidates,next,rejected);sum(total,saved);sum(progress,saved);total.has_more=more;
      if(!more)break;
    }
    return total;
  }
  private async youtube(scope:string,state:SyncRow,lease:string,progress:IngestionCounts):Promise<IngestionCounts&{has_more:boolean}>{
    const channelUrl=new URL("https://www.googleapis.com/youtube/v3/channels");channelUrl.search=new URLSearchParams({part:"contentDetails",[scope.startsWith("@")?"forHandle":"id"]:scope,maxResults:"1"}).toString();
    const channels=object(await this.request(channelUrl,"youtube"));if(!Array.isArray(channels.items)||channels.items.length!==1)throw new IngestionError("youtube_channel_not_found");
    const channel=object(channels.items[0]),channelId=string(channel.id,24);if(!CHANNEL.test(channelId)||(!scope.startsWith("@")&&scope!==channelId))throw invalid();
    const playlist=string(object(object(channel.contentDetails).relatedPlaylists).uploads,128);if(!/^[A-Za-z0-9_-]{1,128}$/.test(playlist))throw invalid();
    let token=state.cursor?.playlist===playlist?state.cursor.page_token:undefined;if(token!==undefined&&(!PAGE_TOKEN.test(string(token,512))))throw invalid();
    const total={...counts(),has_more:false};
    for(let batch=0;batch<PAGE_BUDGET;batch++){
      const url=new URL("https://www.googleapis.com/youtube/v3/playlistItems");url.search=new URLSearchParams({part:"contentDetails",playlistId:playlist,maxResults:"50",...(token?{pageToken:token as string}:{})}).toString();
      const page=object(await this.request(url,"youtube"));if(!Array.isArray(page.items)||page.items.length>50)throw invalid();
      const ids=page.items.map(item=>string(object(object(item).contentDetails).videoId,11));if(ids.some(id=>!VIDEO.test(id)))throw invalid();
      let videos:unknown[]=[];
      if(ids.length){const videoUrl=new URL("https://www.googleapis.com/youtube/v3/videos");videoUrl.search=new URLSearchParams({part:"snippet,status",id:[...new Set(ids)].join(","),maxResults:"50"}).toString();const payload=object(await this.request(videoUrl,"youtube"));if(!Array.isArray(payload.items)||payload.items.length>50)throw invalid();videos=payload.items;}
      const candidates:ImportedCandidate[]=[];let rejected=0;
      for(const entry of videos){try{
        const video=object(entry),id=string(video.id,11),snippet=object(video.snippet);
        if(!ids.includes(id)||!VIDEO.test(id)||snippet.channelId!==channelId)throw invalid();
        if(object(video.status).privacyStatus!=="public"){rejected++;continue;}
        const input={text:`Attributed YouTube evidence; this record does not establish the owner’s experience.\nChannel: ${channelId}\nTitle: ${string(snippet.title,500)}\nDescription: ${string(snippet.description,10_000)}`,category:"project-note",reported_date:iso(snippet.publishedAt).slice(0,10)};
        validateSourceInput(input,this.now());candidates.push({provider:"youtube",scope:channelId,external_id:id,source_url:"https://www.youtube.com/watch?v="+id,input,metadata:{channel_id:channelId,content_kind:"video_metadata"}});
      }catch{rejected++;}}
      token=page.nextPageToken;if(token!==undefined&&(!PAGE_TOKEN.test(string(token,512))))throw invalid();
      // Reject looping provider cursors rather than continually re-fetching one page.
      if(token&&token===state.cursor?.page_token)throw new IngestionError("invalid_provider_cursor");
      const saved=await this.persist("youtube",scope,lease,candidates,{playlist,...(token?{page_token:token}:{})},rejected);sum(total,saved);sum(progress,saved);total.has_more=!!token;
      state={...state,cursor:{playlist,...(token?{page_token:token}:{})}};
      if(!token)break;
    }
    return total;
  }
  async importChat(input:unknown,ownerAcknowledged:boolean):Promise<IngestionCounts>{
    if(this.config.chat?.enabled!==true)throw new IngestionError("chat_import_disabled");
    if(ownerAcknowledged!==true)throw new IngestionError("owner_import_acknowledgement_required");
    const candidates=parseChatExport(input,this.now());
    return this.db.transaction(async tx=>{
      const result=await this.stage(tx,candidates);
      await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,NULL,'chat_export_staged',$2)",[randomUUID(),JSON.stringify({...result,provider:candidates[0]?.provider||null,owner_acknowledged:true,cleared:false})]);
      return result;
    });
  }
}

type ChatMessage={role:"user"|"assistant";text:string};
type ChatConversation={id:string;title:string;reported_date:string;messages:ChatMessage[]};
function chatCandidate(provider:ChatProvider,conversation:ChatConversation,now:Date):ImportedCandidate{
  if(!EXTERNAL_ID.test(conversation.id)||typeof conversation.title!=="string"||conversation.title.length>500||!Array.isArray(conversation.messages)||conversation.messages.length===0||conversation.messages.length>500)throw new IngestionError("invalid_chat_conversation");
  for(const message of conversation.messages){if(!["user","assistant"].includes(message.role)||typeof message.text!=="string"||!message.text.trim())throw new IngestionError("invalid_chat_message");}
  const ownerMessages=conversation.messages.filter(message=>message.role==="user");
  const assistantMessages=conversation.messages.filter(message=>message.role==="assistant");
  if(!ownerMessages.length)throw new IngestionError("owner_messages_required");
  // Generated assistant prose is never promoted into grounding evidence. Only
  // role counts and a digest survive locally; source review sees owner text.
  const input={text:`Imported ${provider} owner messages\n\n${ownerMessages.map(message=>message.text).join("\n\n")}`,category:"user-reported-notes",reported_date:conversation.reported_date};
  validateSourceInput(input,now);assertSourcePrivacy(conversation.id);
  return {provider,scope:"owner-export",external_id:conversation.id,source_url:null,input,metadata:{owner_message_count:ownerMessages.length,assistant_message_count:assistantMessages.length,assistant_content_hash:hash(JSON.stringify(assistantMessages.map(message=>message.text)))}};
}
function exportDate(value:unknown):string {if(typeof value==="number"&&Number.isFinite(value)){const d=new Date(value*1000);if(Number.isFinite(d.getTime()))return d.toISOString().slice(0,10);}return iso(value).slice(0,10);}
/** Owner-selected, bounded JSON only. Never opens archives, HTML, files, or remote links. */
export function parseChatExport(input:unknown,now=new Date()):ImportedCandidate[]{
  let serialized:string;
  try{serialized=typeof input==="string"?input:JSON.stringify(input);}catch{throw new IngestionError("invalid_chat_export");}
  if(!serialized||Buffer.byteLength(serialized)>CHAT_IMPORT_MAX_BYTES)throw new IngestionError("chat_export_too_large");
  let root:Obj;try{root=object(JSON.parse(serialized));}catch{throw new IngestionError("invalid_chat_export");}
  if(root.format==="ai-journey-chat-v1"){
    if(!CHAT_PROVIDERS.includes(root.provider as ChatProvider)||!Array.isArray(root.conversations)||root.conversations.length===0||root.conversations.length>CHAT_IMPORT_MAX_CONVERSATIONS)throw new IngestionError("invalid_chat_export");
    const seen=new Set<string>();return root.conversations.map(value=>{const conversation=object(value);const messages=conversation.messages;if(!Array.isArray(messages))throw new IngestionError("invalid_chat_conversation");const id=string(conversation.id,128);if(seen.has(id))throw new IngestionError("duplicate_chat_selection");seen.add(id);return chatCandidate(root.provider as ChatProvider,{id,title:string(conversation.title,500),reported_date:string(conversation.reported_date,10),messages:messages.map(value=>{const m=object(value);return {role:m.role as ChatMessage["role"],text:string(m.text)};})},now);});
  }
  if(root.format!=="chatgpt-export"&&root.format!=="claude-export")throw new IngestionError("unsupported_chat_export_format");
  if(!Array.isArray(root.conversation_ids)||root.conversation_ids.length===0||root.conversation_ids.length>CHAT_IMPORT_MAX_CONVERSATIONS||root.conversation_ids.some(id=>typeof id!=="string"||!EXTERNAL_ID.test(id))||new Set(root.conversation_ids).size!==root.conversation_ids.length||!Array.isArray(root.data))throw new IngestionError("selected_conversations_required");
  const selected=new Set(root.conversation_ids),found=new Set<string>(),candidates:ImportedCandidate[]=[];
  for(const value of root.data){const conversation=object(value),id=conversation.id||conversation.uuid;if(typeof id!=="string"||!selected.has(id))continue;if(found.has(id))throw new IngestionError("duplicate_chat_selection");found.add(id);
    const messages:ChatMessage[]=[];
    if(root.format==="chatgpt-export"){
      // Follow only the selected active branch, excluding system/tool content and
      // edited alternatives. No attachments or multimodal payloads are ingested.
      const mapping=object(conversation.mapping),visited=new Set<string>();let nodeId=string(conversation.current_node,128);
      while(nodeId){if(visited.has(nodeId)||visited.size>2000)throw new IngestionError("invalid_chat_branch");visited.add(nodeId);const node=object(mapping[nodeId]);
        if(node.message){const message=object(node.message),role=object(message.author).role;
          if(role==="user"||role==="assistant"){const content=object(message.content);if(content.content_type!=="text"||!Array.isArray(content.parts)||content.parts.some(part=>typeof part!=="string"))throw new IngestionError("unsupported_chat_attachment");const text=content.parts.join("\n");if(text.trim())messages.unshift({role,text});}}
        if(node.parent===null||node.parent===undefined)break;nodeId=string(node.parent,128);
      }
      candidates.push(chatCandidate("chatgpt",{id,title:string(conversation.title,500),reported_date:exportDate(conversation.update_time??conversation.create_time),messages},now));
    }else{
      if(!Array.isArray(conversation.chat_messages))throw new IngestionError("invalid_chat_conversation");
      for(const value of conversation.chat_messages){const message=object(value),role=message.sender==="human"?"user":message.sender==="assistant"?"assistant":null;
        if(role){if((Array.isArray(message.attachments)&&message.attachments.length)||(Array.isArray(message.files)&&message.files.length))throw new IngestionError("unsupported_chat_attachment");const text=string(message.text);if(text.trim())messages.push({role,text});}}
      candidates.push(chatCandidate("claude",{id,title:string(conversation.name,500),reported_date:exportDate(conversation.updated_at??conversation.created_at),messages},now));
    }
  }
  if(found.size!==selected.size)throw new IngestionError("selected_conversation_missing");
  return candidates;
}

/** Static input validation labels only; never expose provider exceptions or responses. */
export function safeIngestionError(error:unknown):string|null {
 if(!(error instanceof IngestionError))return null;
 return /^[a-z_]{1,80}$/.test(error.code)?error.code.replace(/_/g,' '):null;
}
