import {ntfyNotifier} from './notify';
import {schedulerWindowPolicy,schedulerWindowPhase,nextUtcIntakeBoundary} from './scheduler-window-policy';
import {qstashSchedulerStatus} from './qstash-scheduler';
import {createGitHubAppCredentialResolver,githubAppStatus} from "./github-app-auth";
import {IntegrationOAuth} from "./integration-oauth";
import {PublicationMediaStorage,mediaStorageStatus,mediaPublicUrl} from "./publication-media-storage";
import {randomUUID,createHash} from 'node:crypto';
import type {Database} from './db';
import {SourceIngestion} from './source-ingestion';
import {Publishing,type PublishingRuntime} from './publishing';
import {integrationConfig,schedulerStatus,type IntegrationSettings} from './integration-config';

export function publishingRuntime(config:IntegrationSettings,env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch,db?:Database):PublishingRuntime {
 const p=config.publishing||{}, scheduler=schedulerStatus(config);
 const accounts=Array.isArray(p.accounts)?p.accounts.map(account=>{const a=account as Record<string,unknown>;const slot=typeof a.credential_env==='string'&&/^STUDIO_PUBLISH_[A-Z0-9_]{1,100}$/.test(a.credential_env)?a.credential_env:null;return {...a,credential_configured:!!slot&&!!env[slot]};}):[];
 return {...p,accounts,enabled:p.enabled===true,credential_use_authorized:p.credential_use_authorized===true,
  notify:ntfyNotifier(env,fetcher),dashboard_url:env.STUDIO_ORIGIN,
  scheduler_authorized:scheduler.publication_ready,scheduler_interval_seconds:config.scheduler?.cadence_seconds,scheduler_window_policy:schedulerWindowPolicy(config.scheduler),
  monthly_cap_microdollars:typeof p.monthly_cap_microdollars==='number'?p.monthly_cap_microdollars:undefined,
  credential:async account=>typeof account.credential_env==='string'&&/^STUDIO_PUBLISH_[A-Z0-9_]{1,100}$/.test(account.credential_env)?env[account.credential_env]||'':'',fetch:fetcher,
  verifyMedia:async (media,context)=>{
   if(db&&config.media?.enabled===true){const generated=await db.query("SELECT id FROM media_artifacts WHERE sha256=$1 AND task_id=$2 AND review_token=$3",[media.sha256,context.task_id,context.review_token]);if(generated.length)return new PublicationMediaStorage(db,config.media,env,{fetch:fetcher}).ensure(media,context);}
   // Only reviewed Vercel public Blob origins and content-addressed object paths; no arbitrary hosts or redirects.
   const hosts=Array.isArray(p.media_hosts)?p.media_hosts:[];
   try {
    const url=new URL(media.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||!hosts.includes(url.hostname)||!(/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname))||!url.pathname.includes(media.sha256))return false;
    const res=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15_000)});
    if(!res.ok||res.headers.get('content-type')?.split(';')[0]!=='image/jpeg'||Number(res.headers.get('content-length')||0)>10_000_000)return false;
    const reader=res.body?.getReader();if(!reader)return false;
    let size=0;const digest=createHash('sha256');
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10_000_000){await reader.cancel();return false;}digest.update(part.value);}
    return size>0&&digest.digest('hex')===media.sha256;
   }catch{return false;}
  }
 } as PublishingRuntime;
}
export class Integrations {
 readonly sources:SourceIngestion;readonly publishing:Publishing;readonly oauth:IntegrationOAuth;
 constructor(readonly db:Database,readonly config=integrationConfig(),readonly env:Record<string,string|undefined>=process.env){
  this.oauth=new IntegrationOAuth(db,config.oauth||{},env);
  this.sources=new SourceIngestion(db,config.sources||{},{env,...(config.sources?.github?.app?{githubCredential:createGitHubAppCredentialResolver(config.sources.github.app,config.sources.github.repositories||[],{env})}:{})});
  this.publishing=new Publishing(db,publishingRuntime(config,env,fetch,db));
 }
 async ready(){
  const base=publishingRuntime(this.config,this.env,fetch,this.db),connected=await this.oauth.publishingAccounts();
  this.publishing.runtime.accounts=[...(base.accounts||[]).filter(a=>!a.id.startsWith('oauth_')),...connected];
  this.publishing.runtime.credential=account=>account.id.startsWith('oauth_')?this.oauth.credential(account):base.credential!(account);
  this.publishing.runtime.accountCurrent=async(account,tx,requireFresh)=>{
   if(!account.id.startsWith('oauth_'))return true;
   return this.oauth.validateAccount(account,tx,!requireFresh);
  };
  return this;
 }
 async snapshot(){await this.ready();return {github_app:githubAppStatus(this.config.sources?.github?.app,this.config.sources?.github?.repositories||[],this.env),oauth:await this.oauth.snapshot(),sources:await this.sources.snapshot(),publishing:await this.publishing.snapshot(),media:{storage:mediaStorageStatus(this.config.media||{},this.env),artifacts:(await this.db.query<any>("SELECT m.id,m.task_id,m.review_token,m.sha256,m.mime_type,m.width,m.height,m.source_clearance_id FROM media_artifacts m JOIN sources s ON s.id=m.source_id AND s.clearance_id=m.source_clearance_id AND s.cleared=true AND s.revoked_at IS NULL ORDER BY m.created DESC LIMIT 100")).map(item=>({...item,public_url:mediaPublicUrl(this.config.media||{},item.sha256)})),approvals:await this.db.query("SELECT artifact_id,sha256,public_origin FROM media_public_approvals")},scheduler:{...schedulerStatus(this.config),transport:qstashSchedulerStatus(this.config.scheduler,this.env),delivery:(await this.db.query('SELECT last_started,last_finished,last_status,last_result FROM integration_ticks WHERE id=1'))[0]||null},chat_history:'Selected owner exports only. Consumer API keys do not synchronize ChatGPT, Claude, Gemini or Spark history. Codex local app-server requires an authorized awake computer.'};}
 async tick(now=new Date()){
  if(!schedulerStatus(this.config).authorized)return {status:'disabled'};
  const phase=schedulerWindowPhase(schedulerWindowPolicy(this.config.scheduler),now);
  if(phase==='invalid')return {status:'disabled'};
  if(phase==='idle')return {status:'idle'};
  const deadline=AbortSignal.timeout(150_000);
  // Intake must not refresh publishing credentials or run overdue publication work.
  if(phase!=='intake')await this.ready();
  this.publishing.runtime.signal=deadline;
  const token=randomUUID();
  const claimed=await this.db.query<{next_source_sync:string|null}>("UPDATE integration_ticks SET lease_token=$1,lease_until=$2,last_started=$3,last_status='running' WHERE id=1 AND (lease_until IS NULL OR lease_until<=$3) RETURNING next_source_sync",[token,new Date(now.getTime()+240000),now]);
  if(!claimed.length)return {status:'already-running'};
  const result:Record<string,unknown>={};
  try {
   if((phase==='generic'||phase==='intake')&&(!claimed[0].next_source_sync||new Date(claimed[0].next_source_sync)<=now)){
    result.sources=await this.sources.sync();
    const raw=this.config.scheduler?.source_interval_minutes;const minutes=typeof raw==='number'&&Number.isInteger(raw)&&raw>=5?Math.min(raw,10080):60;
    await this.db.query('UPDATE integration_ticks SET next_source_sync=$2 WHERE id=1 AND lease_token=$1',[token,phase==='intake'?nextUtcIntakeBoundary(now):new Date(now.getTime()+minutes*60000)]);
   }
   if(phase==='generic'||phase==='publication')result.publishing=await this.publishing.dispatch(new Date());
   await this.db.query("UPDATE integration_ticks SET lease_token=NULL,lease_until=NULL,last_finished=now(),last_status='completed',last_result=$2 WHERE id=1 AND lease_token=$1",[token,JSON.stringify(result)]);
   return {status:'completed',...result};
  }catch {
   await this.db.query("UPDATE integration_ticks SET lease_token=NULL,lease_until=NULL,last_finished=now(),last_status='failed',last_result='{\"error\":\"Integration tick failed; review connector and publication records\"}' WHERE id=1 AND lease_token=$1",[token]);
   return {status:'failed'};
  }
 }
}

export async function createIntegrations(db:Database){return new Integrations(db).ready();}
