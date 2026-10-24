import {createHash,createPrivateKey,sign} from "node:crypto";
import {assertSourcePrivacy} from "./sources";

/** Nonsecret configuration for an independently provisioned, owner-approved app installation. */
export type GitHubAppConfig={authorized?:boolean;app_id:number;installation_id:number;selected_repository_ids:number[]};
export type GitHubAppDependencies={fetch?:typeof fetch;env?:Record<string,string|undefined>;now?:()=>Date};
export type GitHubCredentialResolver=(repository:string,signal?:AbortSignal)=>Promise<string>;
export const GITHUB_APP_PRIVATE_KEY_ENV="STUDIO_SOURCE_GITHUB_APP_PRIVATE_KEY";
const API="https://api.github.com",VERSION="2026-03-10",MAX_REPOSITORIES=10,MAX_BODY_BYTES=262_144;
const REFRESH_MARGIN_MS=60_000,MAX_TOKEN_LIFETIME_MS=3_600_000;
const REPOSITORY=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
type ObjectValue=Record<string,unknown>;
type Scope={appId:number;installationId:number;repositoryIds:number[];repositories:string[];owner:string};
type CachedToken={identity:string;token:string;expiresAt:number;observedAt:number;repositoryIds:Map<string,number>};
type Flight={identity:string;promise:Promise<CachedToken>;controller:AbortController;waiters:number;settled:boolean};
// Only this factory can register a checker. Config flags or a custom callback are not proof.
const repositoryReadChecks=new WeakMap<GitHubCredentialResolver,(token:string,repository:string,id:unknown)=>boolean>();
/** null means a legacy/custom callback; false means a registered App grant no longer matches. */
export function githubAppRepositoryReadAuthorized(resolver:GitHubCredentialResolver,token:string,repository:string,id:unknown):boolean|null{
  const check=repositoryReadChecks.get(resolver);return check?check(token,repository,id):null;
}

/** Error messages are stable codes. Never attach provider payloads, JWTs, keys, or tokens. */
export class GitHubAppAuthError extends Error {constructor(readonly code:string){super(code);this.name="GitHubAppAuthError";}}
const fail=(code:string):never=>{throw new GitHubAppAuthError(code);};
const isId=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
function object(value:unknown):ObjectValue{if(!value||typeof value!=="object"||Array.isArray(value))return fail("github_app_invalid_response");return value as ObjectValue;}
function scope(config:GitHubAppConfig|undefined,repositories:string[]):Scope{
  if(!config)return fail("github_app_not_configured");
  if(config.authorized!==true)return fail("github_app_authorization_required");
  if(!isId(config.app_id)||!isId(config.installation_id))return fail("github_app_invalid_configuration");
  const ids=config.selected_repository_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>MAX_REPOSITORIES||ids.some(id=>!isId(id))||new Set(ids).size!==ids.length)return fail("github_app_invalid_repository_selection");
  if(!Array.isArray(repositories)||repositories.length!==ids.length)return fail("github_app_invalid_repository_selection");
  const names=repositories.map(name=>{
    if(typeof name!=="string"||!REPOSITORY.test(name)||name.split("/")[1].includes(".."))return fail("github_app_invalid_repository_selection");
    try{assertSourcePrivacy(name);}catch{return fail("github_app_invalid_repository_selection");}
    return name.toLowerCase();
  });
  if(new Set(names).size!==names.length||new Set(names.map(name=>name.split("/")[0])).size!==1)return fail("github_app_invalid_repository_selection");
  return {appId:config.app_id,installationId:config.installation_id,repositoryIds:[...ids].sort((a,b)=>a-b),repositories:[...names].sort(),owner:names[0].split("/")[0]};
}

/** Local readiness only. Presence of configuration/key never claims a tested connection. */
export function githubAppStatus(config:GitHubAppConfig|undefined,repositories:string[],env:Record<string,string|undefined>=process.env){
  let reason:string|null=null;
  try{scope(config,repositories);if(!env[GITHUB_APP_PRIVATE_KEY_ENV])reason="github_app_private_key_missing";}catch(error){reason=error instanceof GitHubAppAuthError?error.code:"github_app_invalid_configuration";}
  return {configured:config!==undefined,authorized:config?.authorized===true,ready:reason===null,tested:false,reason};
}

function privateKey(env:Record<string,string|undefined>):string{
  const value=env[GITHUB_APP_PRIVATE_KEY_ENV];
  if(!value)return fail("github_app_private_key_missing");
  if(typeof value!=="string"||value.length>32_768)return fail("github_app_private_key_invalid");
  return value;
}
function identity(selected:Scope,key:string){return JSON.stringify(selected)+":"+createHash("sha256").update(key).digest("hex");}
function milliseconds(now:()=>Date){const value=now().getTime();if(!Number.isFinite(value))return fail("github_app_invalid_clock");return value;}
function jwt(appId:number,pem:string,now:number):string{
  try{
    const key=createPrivateKey(pem);
    if(key.asymmetricKeyType!=="rsa"||(key.asymmetricKeyDetails?.modulusLength||0)<2048)return fail("github_app_private_key_invalid");
    const issued=Math.floor(now/1000)-60;
    // 60 seconds of clock-skew allowance, with no more than 10 minutes total JWT lifetime.
    const encoded=[{alg:"RS256",typ:"JWT"},{iat:issued,exp:issued+600,iss:String(appId)}].map(value=>Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
    return encoded+"."+sign("RSA-SHA256",Buffer.from(encoded),key).toString("base64url");
  }catch{return fail("github_app_private_key_invalid");}
}
async function discard(response:Response){try{await response.body?.cancel();}catch{/* Do not propagate body or transport error details. */}}
async function request(fetcher:typeof fetch,path:string,appJwt:string,signal:AbortSignal,body?:ObjectValue):Promise<ObjectValue>{
  if(signal.aborted)return fail("github_app_cancelled");
  let response:Response;
  try{response=await fetcher(API+path,{method:body?"POST":"GET",headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+appJwt,"X-GitHub-Api-Version":VERSION,"User-Agent":"AI-Journey-Studio/source-ingestion",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,redirect:"error",cache:"no-store",signal});}
  catch{return fail(signal.aborted?"github_app_cancelled":"github_app_network_error");}
  if(response.status!==(body?201:200)){await discard(response);return fail(response.status===429?"github_app_rate_limited":[401,403,404].includes(response.status)?"github_app_access_denied":"github_app_http_error");}
  if(Number(response.headers.get("content-length")||0)>MAX_BODY_BYTES){await discard(response);return fail("github_app_response_too_large");}
  const reader=response.body?.getReader();if(!reader)return fail("github_app_invalid_response");
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){const {value,done}=await reader.read();if(signal.aborted)return fail("github_app_cancelled");if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES){try{await reader.cancel();}catch{}return fail("github_app_response_too_large");}chunks.push(value);}
  }catch(error){if(error instanceof GitHubAppAuthError)throw error;return fail(signal.aborted?"github_app_cancelled":"github_app_network_error");}
  finally{reader.releaseLock();}
  try{return object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));}catch{return fail("github_app_invalid_response");}
}

function validateInstallation(value:ObjectValue,selected:Scope):number{
  const account=object(value.account);
  if(value.id!==selected.installationId||value.app_id!==selected.appId||typeof account.login!=="string"||account.login.toLowerCase()!==selected.owner||!isId(account.id)||!["User","Organization"].includes(String(account.type)))return fail("github_app_installation_mismatch");
  if(value.suspended_at!==null)return fail("github_app_installation_suspended");
  if(!["all","selected"].includes(String(value.repository_selection)))return fail("github_app_invalid_response");
  return account.id;
}
function validateToken(value:ObjectValue,selected:Scope,ownerId:number,identity:string,observedAt:number):CachedToken{
  const permissions=object(value.permissions);
  if(permissions.contents!=="read"||permissions.metadata!=="read"||Object.keys(permissions).some(key=>key!=="contents"&&key!=="metadata"))return fail("github_app_permissions_mismatch");
  if(value.repository_selection!=="selected"||!Array.isArray(value.repositories)||value.repositories.length!==selected.repositoryIds.length)return fail("github_app_repository_selection_mismatch");
  const ids=new Set<number>(),names=new Set<string>(),repositoryIds=new Map<string,number>();
  for(const entry of value.repositories){
    const repo=object(entry),owner=object(repo.owner);
    if(!isId(repo.id)||!selected.repositoryIds.includes(repo.id)||typeof repo.full_name!=="string"||!selected.repositories.includes(repo.full_name.toLowerCase())||owner.id!==ownerId||typeof owner.login!=="string"||owner.login.toLowerCase()!==selected.owner)return fail("github_app_repository_selection_mismatch");
    ids.add(repo.id);names.add(repo.full_name.toLowerCase());repositoryIds.set(repo.full_name.toLowerCase(),repo.id);
  }
  if(ids.size!==selected.repositoryIds.length||names.size!==selected.repositories.length)return fail("github_app_repository_selection_mismatch");
  // GitHub's 2026 stateless installation tokens are variable-length. Treat them as opaque.
  if(typeof value.token!=="string"||!value.token.length||value.token.length>16_384||!/^[\x21-\x7e]+$/.test(value.token))return fail("github_app_invalid_response");
  if(typeof value.expires_at!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.expires_at))return fail("github_app_invalid_expiry");
  const expiresAt=Date.parse(value.expires_at);
  if(!Number.isFinite(expiresAt)||new Date(expiresAt).toISOString().slice(0,10)!==value.expires_at.slice(0,10)||expiresAt<=observedAt+REFRESH_MARGIN_MS||expiresAt>observedAt+MAX_TOKEN_LIFETIME_MS)return fail("github_app_invalid_expiry");
  return {identity,token:value.token,expiresAt,observedAt,repositoryIds};
}
async function waitFor<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise;
  if(signal.aborted)return fail("github_app_cancelled");
  return new Promise<T>((resolve,reject)=>{
    const aborted=()=>{cleanup();reject(new GitHubAppAuthError("github_app_cancelled"));};
    const cleanup=()=>signal.removeEventListener("abort",aborted);
    signal.addEventListener("abort",aborted,{once:true});
    promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}

/**
 * Server-only credential callback. Retain the resolver to share its memory-only cache.
 * Call only after source enable/sync/private-read authorization. This module never
 * registers an app, installs it, changes grants, persists credentials, or logs secrets.
 * Docs: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
 * JWT: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function createGitHubAppCredentialResolver(config:GitHubAppConfig|undefined,repositories:string[],deps:GitHubAppDependencies={}):GitHubCredentialResolver{
  const fetcher=deps.fetch||fetch,env=deps.env||process.env,now=deps.now||(()=>new Date());
  let cached:CachedToken|undefined,inflight:Flight|undefined,currentIdentity:string|undefined;
  let cacheExpiry:ReturnType<typeof setTimeout>|undefined;
  const clearCache=()=>{cached=undefined;if(cacheExpiry){clearTimeout(cacheExpiry);cacheExpiry=undefined;}};
  const assertCurrent=(fingerprint:string)=>{if(identity(scope(config,repositories),privateKey(env))!==fingerprint)return fail("github_app_configuration_changed");};
  const resolve:GitHubCredentialResolver=async(repository,signal)=>{
    if(signal?.aborted)return fail("github_app_cancelled");
    let selected:Scope,key:string,fingerprint:string;
    try{
      selected=scope(config,repositories);
      if(typeof repository!=="string"||!selected.repositories.includes(repository.toLowerCase()))return fail("github_app_repository_not_allowed");
      key=privateKey(env);fingerprint=identity(selected,key);
    }catch(error){clearCache();inflight?.controller.abort();inflight=undefined;currentIdentity=undefined;throw error;}
    if(currentIdentity!==fingerprint){clearCache();inflight?.controller.abort();inflight=undefined;currentIdentity=fingerprint;}
    const time=milliseconds(now);
    if(cached&&cached.identity===fingerprint&&time>=cached.observedAt&&cached.expiresAt>time+REFRESH_MARGIN_MS)return cached.token;
    clearCache();
    if(!inflight){
      const controller=new AbortController();
      const sharedSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]);
      const flight:Flight={identity:fingerprint,controller,waiters:0,settled:false,promise:undefined as unknown as Promise<CachedToken>};
      flight.promise=(async()=>{
        const appJwt=jwt(selected.appId,key,milliseconds(now));
        const installation=await request(fetcher,`/app/installations/${selected.installationId}`,appJwt,sharedSignal);
        const ownerId=validateInstallation(installation,selected);
        assertCurrent(fingerprint);
        const response=await request(fetcher,`/app/installations/${selected.installationId}/access_tokens`,appJwt,sharedSignal,{repository_ids:selected.repositoryIds,permissions:{contents:"read",metadata:"read"}});
        const token=validateToken(response,selected,ownerId,fingerprint,milliseconds(now));
        if(sharedSignal.aborted)return fail("github_app_cancelled");
        assertCurrent(fingerprint);
        if(currentIdentity===fingerprint){
          clearCache();cached=token;
          // Drop even an idle resolver's token before expiry, without keeping Node alive.
          cacheExpiry=setTimeout(()=>{if(cached===token)clearCache();},token.expiresAt-token.observedAt-REFRESH_MARGIN_MS);cacheExpiry.unref();
        }
        return token;
      })().finally(()=>{flight.settled=true;if(inflight===flight)inflight=undefined;});
      inflight=flight;
    }
    const flight=inflight;flight.waiters++;
    try{
      const value=await waitFor(flight.promise,signal);
      // Revocation, allowlist changes, key rotation, and clock changes fail closed even mid-flight.
      assertCurrent(fingerprint);
      const checkedAt=milliseconds(now);
      if(checkedAt<value.observedAt||value.expiresAt<=checkedAt+REFRESH_MARGIN_MS)return fail("github_app_invalid_expiry");
      return value.token;
    }finally{flight.waiters--;if(!flight.waiters&&!flight.settled){flight.controller.abort();if(inflight===flight)inflight=undefined;}}
  };
  repositoryReadChecks.set(resolve,(token,repository,id)=>{
    try{
      if(!cached||cached.token!==token||!isId(id)||cached.repositoryIds.get(repository.toLowerCase())!==id)return false;
      assertCurrent(cached.identity);
      const checkedAt=milliseconds(now);
      return checkedAt>=cached.observedAt&&cached.expiresAt>checkedAt+REFRESH_MARGIN_MS;
    }catch{return false;}
  });
  return resolve;
}
