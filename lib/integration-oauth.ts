import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Database,Connection} from './db';
import {database} from './db';
import {allowedOrigin,response} from './auth';
import {istMonth} from './domain';
import {hostedEnvironment,hostedOwnerReady} from './hosted';
import {runtimeConfig} from './config';
import {createOwnerAuth,passwordOwnerAuthenticated,OWNER_ID} from './owner-password';
import type {PublishingAccount} from './publishing';

export type OAuthProvider='x'|'linkedin'|'instagram_facebook';
type Env=Record<string,string|undefined>;
export type OAuthProviderConfig={
 enabled?:boolean; client_id_env?:string; client_secret_env?:string; redirect_uri?:string;
 linkedin_version?:string; instagram_api_version?:string;
 /** Deployment owner verified outbound OAuth exchange URLs are redacted from every log/APM sink. */
 exchange_url_redaction_verified?:boolean;
 /** Separate, explicit authorization/cap for the potentially paid X identity test. */
 identity_cost_authorized?:boolean; identity_max_microdollars?:number; monthly_identity_cap_microdollars?:number;
};
export type OAuthConfig={enabled?:boolean;credential_use_authorized?:boolean;providers?:Partial<Record<OAuthProvider,OAuthProviderConfig>>};
export type OAuthOwnerSession={owner_id:string;session_id:string};
export type OAuthDependencies={fetch?:typeof fetch;now?:()=>Date};
export class OAuthError extends Error {constructor(message:string,readonly status=409){super(message);this.name='OAuthError';}}
export const OAUTH_SCOPES:Record<OAuthProvider,readonly string[]>={x:['tweet.read','tweet.write','users.read','offline.access'],linkedin:['openid','profile','w_member_social'],instagram_facebook:['pages_show_list','instagram_basic','instagram_content_publish','pages_read_engagement']};
export const OAUTH_DOCUMENTATION={
 x:'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code',
 linkedin:'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
 linkedin_identity:'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2',
 instagram_facebook:'https://github.com/fbsamples/reels_publishing_apis/tree/main/insta_reels_publishing_api_sample',
 linkedin_refresh:'https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens',
} as const;
const PROVIDERS:OAuthProvider[]=['x','linkedin','instagram_facebook'];
const ENDPOINTS={x:{authorize:'https://x.com/i/oauth2/authorize',token:'https://api.x.com/2/oauth2/token',identity:'https://api.x.com/2/users/me'},linkedin:{authorize:'https://www.linkedin.com/oauth/v2/authorization',token:'https://www.linkedin.com/oauth/v2/accessToken',identity:'https://api.linkedin.com/v2/userinfo'}} as const;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const stamp=(value:Date|string)=>new Date(value).getTime();
const tokenText=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/[\u0000-\u0020\u007f]/.test(v);
const fail=(message:string,status=409):never=>{throw new OAuthError(message,status);};
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export type InstagramCandidate={page_id:string;remote_id:string;label:string};
export type InstagramSelection={acknowledged:boolean;page_id:string;remote_id:string;authorization_version:string};
type OAuthAccountReference=Pick<PublishingAccount,'id'|'platform'|'remote_id'|'authorization_version'|'instagram_login'|'instagram_api_version'|'professional'>;
type SecretTokens={access_token:string;refresh_token?:string;candidates?:InstagramCandidate[];selected?:InstagramCandidate};
type ConnectionRow={provider:OAuthProvider;owner_id:string;authorization_version:string;config_hash:string;status:'connected'|'tested'|'selection_required'|'reauthorization_required'|'disconnected';token_ciphertext:string|null;scopes:string[];expires_at:string|Date|null;remote_id:string|null;label:string|null;tested_at:string|Date|null;refresh_lease:string|null;refresh_until:string|Date|null;last_error:string|null};
type Flow={state_hash:string;provider:OAuthProvider;owner_id:string;session_id:string;binding_hash:string;verifier_ciphertext:string|null;config_hash:string;redirect_uri:string;expires_at:string|Date;consumed_at:string|Date|null};
type Ready={clientId:string;clientSecret:string;redirect:string;configHash:string;config:OAuthProviderConfig};
function key(env:Env):Buffer{
 const value=env.STUDIO_CONNECTIONS_ENCRYPTION_KEY;
 if(!value||value===env.STUDIO_AUTH_SECRET||value===env.STUDIO_ACCESS_TOKEN||!/^[A-Za-z0-9+/]{43}=$/.test(value))return fail('A separate 32-byte connections encryption key must be provisioned',503);
 const parsed=Buffer.from(value,'base64');if(parsed.length!==32||parsed.toString('base64')!==value)return fail('Connections encryption key is invalid',503);return parsed;
}
function seal(value:unknown,context:string,env:Env){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);cipher.setAAD(Buffer.from(context));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');}
function unseal<T>(value:string,context:string,env:Env):T{
 try{const [version,iv,tag,ciphertext,...extra]=value.split('.');if(version!=='v1'||extra.length||!iv||!tag||!ciphertext)throw Error();const decipher=createDecipheriv('aes-256-gcm',key(env),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8'));}catch{return fail('Stored connection cannot be decrypted; authorized key recovery or reconnection is required',503);}
}
const tokenContext=(row:Pick<ConnectionRow,'provider'|'authorization_version'|'owner_id'>)=>`studio-oauth:v1:tokens:${row.owner_id}:${row.provider}:${row.authorization_version}`;
function callbackPath(provider:OAuthProvider){return `/api/connections/${provider}/callback`;}
function cookieName(provider:OAuthProvider,secure:boolean){return `${secure?'__Secure-':''}studio_oauth_${provider}`;}
function bindingCookie(provider:OAuthProvider,binding:string,origin:string,maxAge=600){const secure=origin.startsWith('https:');return `${cookieName(provider,secure)}=${binding}; Path=${callbackPath(provider)}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;}
function readBinding(request:Request,provider:OAuthProvider,origin:string){const name=cookieName(provider,origin.startsWith('https:'));const matches=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):'';}
async function boundedJSON(result:Response):Promise<Record<string,unknown>>{
 if(Number(result.headers.get('content-length')||0)>65536)fail('Provider response was too large');const reader=result.body?.getReader();if(!reader)return fail('Provider response was unreadable');let size=0;const parts:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536){await reader.cancel();return fail('Provider response was too large');}parts.push(chunk.value);}const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}catch(error){if(error instanceof OAuthError)throw error;return fail('Provider response was unreadable');}
}
/** Server-only OAuth lifecycle. No provider requests occur in snapshot or publishingAccounts. */
export class IntegrationOAuth {
 private readonly transport:typeof fetch;private readonly now:()=>Date;
 constructor(readonly db:Database,readonly config:OAuthConfig={},readonly env:Env=process.env,deps:OAuthDependencies={}){this.transport=deps.fetch||fetch;this.now=deps.now||(()=>new Date());}
 private ready(provider:OAuthProvider):Ready{
  if(!PROVIDERS.includes(provider))return fail('Provider connection flow is not supported',404);
  const config=this.config.providers?.[provider];if(this.config.enabled!==true||this.config.credential_use_authorized!==true||config?.enabled!==true)return fail('Provider connection is not enabled and authorized in server configuration',503);
  if(provider==='instagram_facebook'&&config.exchange_url_redaction_verified!==true)return fail('Verify that Facebook OAuth exchange URL secrets are redacted from deployment logs and tracing before enabling this connection',503);
  const origin=this.env.STUDIO_ORIGIN;let base:URL;try{base=new URL(origin||'');}catch{return fail('Exact studio origin is required',503);}
  if(base.origin!==origin||base.username||base.password||!(base.protocol==='https:'||(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))))return fail('Exact secure studio origin is required',503);
  if(provider!=='x'&&base.protocol!=='https:')return fail(`${provider==='linkedin'?'LinkedIn':'Facebook Login'} requires an exact registered HTTPS callback URL`,503);
  if(provider==='instagram_facebook'&&!/^v\d{2}\.0$/.test(config.instagram_api_version||''))return fail('Configure a supported Facebook Graph API version',503);
  const redirect=origin+callbackPath(provider);if(config.redirect_uri!==redirect)return fail('Register the exact provider callback URL in server configuration',503);
  const idSlot=config.client_id_env||`STUDIO_OAUTH_${provider.toUpperCase()}_CLIENT_ID`,secretSlot=config.client_secret_env||`STUDIO_OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`;
  if(!/^STUDIO_OAUTH_[A-Z0-9_]{1,100}$/.test(idSlot)||!/^STUDIO_OAUTH_[A-Z0-9_]{1,100}$/.test(secretSlot))return fail('Invalid provider credential slot',503);
  const clientId=this.env[idSlot],clientSecret=this.env[secretSlot];if(!tokenText(clientId)||!tokenText(clientSecret))return fail('Provider application credentials must be provisioned separately',503);
  key(this.env);return {clientId,clientSecret,redirect,config,configHash:sha(JSON.stringify({provider,clientId,redirect,scopes:OAUTH_SCOPES[provider],...(provider==='instagram_facebook'?{instagram_login:'facebook',instagram_api_version:config.instagram_api_version,exchange_url_redaction_verified:config.exchange_url_redaction_verified}:{})}))};
 }
 private async validSession(session:OAuthOwnerSession,tx:Connection=this.db){
  if(session.owner_id!==OWNER_ID||typeof session.session_id!=='string'||!session.session_id)return fail('Authenticated owner session required',401);
  const found=await tx.query('SELECT id FROM studio_auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">$3',[session.session_id,OWNER_ID,this.now()]);if(found.length!==1)return fail('Owner session expired; sign in and reconnect',401);
 }
 async start(provider:OAuthProvider,session:OAuthOwnerSession,acknowledged:boolean){
  if(acknowledged!==true)return fail('Explicit approval to connect this provider is required',400);
  const ready=this.ready(provider);await this.validSession(session);const state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),stateHash=sha(state),verifier=provider==='x'?randomBytes(48).toString('base64url'):null,now=this.now(),expires=new Date(now.getTime()+600000);
  await this.db.transaction(async tx=>{await this.validSession(session,tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');await tx.query('DELETE FROM integration_oauth_flows WHERE provider=$1 OR expires_at<=$2',[provider,now]);await tx.query('INSERT INTO integration_oauth_flows(state_hash,provider,owner_id,session_id,binding_hash,verifier_ciphertext,config_hash,redirect_uri,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[stateHash,provider,OWNER_ID,session.session_id,sha(binding),verifier?seal(verifier,`studio-oauth:v1:pkce:${stateHash}`,this.env):null,ready.configHash,ready.redirect,expires]);});
  const url=new URL(provider==='instagram_facebook'?'https://www.facebook.com/dialog/oauth':ENDPOINTS[provider].authorize);url.search=new URLSearchParams({response_type:'code',client_id:ready.clientId,redirect_uri:ready.redirect,scope:OAUTH_SCOPES[provider].join(provider==='instagram_facebook'?',':' '),state}).toString();
  if(verifier){url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');}
  return {authorization_url:url.toString(),expires_at:expires.toISOString(),set_cookie:bindingCookie(provider,binding,this.env.STUDIO_ORIGIN!),scopes:[...OAUTH_SCOPES[provider]]};
 }
 private async tokenRequest(provider:OAuthProvider,ready:Ready,values:Record<string,string>){
  const body=new URLSearchParams(values);const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'};
  if(provider==='x')headers.Authorization='Basic '+Buffer.from(`${encodeURIComponent(ready.clientId)}:${encodeURIComponent(ready.clientSecret)}`).toString('base64');
  else{body.set('client_id',ready.clientId);body.set('client_secret',ready.clientSecret);}
  if(provider==='instagram_facebook')body.delete('grant_type');
  let endpoint=provider==='instagram_facebook'?`https://graph.facebook.com/${ready.config.instagram_api_version}/oauth/access_token`:ENDPOINTS[provider].token;
  // Current Meta samples require these exchange parameters in the query. Never log this URL, the response body, or transport exceptions. Deployment tracing must redact this endpoint.
  if(provider==='instagram_facebook'){const exchange=new URL(endpoint);exchange.search=body.toString();endpoint=exchange.toString();}
  let result:Response;try{result=await this.transport(endpoint,{method:'POST',headers,body:provider==='instagram_facebook'?undefined:body.toString(),redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{return fail('Provider token exchange could not be confirmed; reconnect before retrying');}
  if(!result.ok)return fail('Provider rejected token exchange; reconnect or review application permissions');return boundedJSON(result);
 }
 private parseTokens(provider:OAuthProvider,data:Record<string,unknown>,requested:readonly string[],previous?:SecretTokens){
  if(provider==='instagram_facebook'&&tokenText(data.access_token)&&(typeof data.expires_in!=='number'||!Number.isSafeInteger(data.expires_in)||data.expires_in<=60||data.expires_in>366*86400))return fail('Facebook did not return a usable token expiry; reauthorization is required');
  if(!tokenText(data.access_token)||typeof data.expires_in!=='number'||!Number.isSafeInteger(data.expires_in)||data.expires_in<=60||data.expires_in>366*86400||data.token_type!==undefined&&(typeof data.token_type!=='string'||data.token_type.toLowerCase()!=='bearer'))return fail('Provider token response is invalid');
  // OAuth 2.0 permits omitted scope only when it is identical to the requested scope.
  const scopes=data.scope===undefined?[...requested]:typeof data.scope==='string'?data.scope.split(/[ ,]+/).filter(Boolean):[];
  if(requested.some(scope=>!scopes.includes(scope))||scopes.some(scope=>!requested.includes(scope)))return fail('Provider granted unexpected scopes; reconnect with the required permissions');
  const refresh=provider==='x'?(data.refresh_token??previous?.refresh_token):undefined;
  if(provider==='x'&&!tokenText(refresh))return fail('X offline access refresh token was not granted; reconnect');
  return {tokens:{access_token:data.access_token,...(provider==='x'?{refresh_token:refresh as string}:{})},scopes:[...requested],expires:new Date(this.now().getTime()+data.expires_in*1000)};
 }
 async callback(provider:OAuthProvider,input:{state:string;code?:string;error?:string;binding:string}){
  const ready=this.ready(provider);if(!/^[A-Za-z0-9_-]{43}$/.test(input.state)||!/^[A-Za-z0-9_-]{43}$/.test(input.binding))return fail('OAuth state or browser binding is invalid',400);
  const stateHash=sha(input.state),now=this.now();
  const flow=await this.db.transaction(async tx=>{const row=(await tx.query<Flow>('SELECT * FROM integration_oauth_flows WHERE state_hash=$1 FOR UPDATE',[stateHash]))[0];if(!row||row.provider!==provider||row.consumed_at||stamp(row.expires_at)<=now.getTime()||!equal(row.binding_hash,sha(input.binding))||!equal(row.config_hash,ready.configHash)||row.redirect_uri!==ready.redirect)return fail('OAuth state expired, changed, or was already used',400);await this.validSession({owner_id:row.owner_id,session_id:row.session_id},tx);await tx.query('UPDATE integration_oauth_flows SET consumed_at=$2,verifier_ciphertext=NULL WHERE state_hash=$1',[stateHash,now]);return row;});
  if(input.error!==undefined)return fail('Provider connection was declined; no connection was changed',400);
  if(!tokenText(input.code))return fail('Provider authorization code is missing or invalid',400);
  const values:Record<string,string>={grant_type:'authorization_code',code:input.code,redirect_uri:ready.redirect};if(provider==='x'){if(!flow.verifier_ciphertext)return fail('PKCE verifier is missing',400);values.code_verifier=unseal<string>(flow.verifier_ciphertext,`studio-oauth:v1:pkce:${stateHash}`,this.env);}
  const data=await this.tokenRequest(provider,ready,values),parsed=this.parseTokens(provider,data,OAUTH_SCOPES[provider]),version=randomUUID(),context={provider,owner_id:OWNER_ID,authorization_version:version};
  await this.db.transaction(async tx=>{await this.validSession({owner_id:flow.owner_id,session_id:flow.session_id},tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');
   // A newer start or disconnect invalidates this in-flight callback before it can persist credentials.
   if(!(await tx.query('SELECT state_hash FROM integration_oauth_flows WHERE state_hash=$1 AND consumed_at IS NOT NULL',[stateHash])).length)return fail('Connection flow was superseded; reconnect',409);
   await tx.query("INSERT INTO integration_oauth_connections(provider,owner_id,authorization_version,config_hash,status,token_ciphertext,scopes,expires_at) VALUES($1,$2,$3,$4,'connected',$5,$6,$7) ON CONFLICT(provider) DO UPDATE SET authorization_version=EXCLUDED.authorization_version,config_hash=EXCLUDED.config_hash,status='connected',token_ciphertext=EXCLUDED.token_ciphertext,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,remote_id=NULL,label=NULL,tested_at=NULL,refresh_lease=NULL,refresh_until=NULL,last_error=NULL,updated=now()",[provider,OWNER_ID,version,ready.configHash,seal(parsed.tokens,tokenContext(context),this.env),JSON.stringify(parsed.scopes),parsed.expires]);
  });return {provider,status:'connected',tested:false,expires_at:parsed.expires.toISOString()};
 }
 private async row(provider:OAuthProvider){return (await this.db.query<ConnectionRow>('SELECT * FROM integration_oauth_connections WHERE provider=$1 AND owner_id=$2',[provider,OWNER_ID]))[0];}
 private async invalidate(provider:OAuthProvider,version:string,message:string,lease?:string){await this.db.query("UPDATE integration_oauth_connections SET status='reauthorization_required',token_ciphertext=NULL,refresh_lease=NULL,refresh_until=NULL,last_error=$3,updated=now() WHERE provider=$1 AND authorization_version=$2 AND ($4::uuid IS NULL OR refresh_lease=$4)",[provider,version,message,lease||null]);}
 private async access(provider:OAuthProvider,expectedVersion?:string):Promise<{token:string;row:ConnectionRow}>{
  const ready=this.ready(provider),row=await this.row(provider);if(!row||!row.token_ciphertext||!['connected','tested','selection_required'].includes(row.status))return fail('Connect this provider before using its credentials');
  if(!equal(row.config_hash,ready.configHash))return fail('Provider configuration changed; reconnect');if(expectedVersion&&row.authorization_version!==expectedVersion)return fail('Connection changed; fresh account approval is required');
  if(row.refresh_lease){if(!row.refresh_until||stamp(row.refresh_until)<=this.now().getTime()){await this.invalidate(provider,row.authorization_version,'Refresh outcome is uncertain; reconnect',row.refresh_lease);return fail('Refresh outcome is uncertain; reconnect');}return fail('Connection refresh is already in progress; retry after it finishes');}
  const tokens=unseal<SecretTokens>(row.token_ciphertext,tokenContext(row),this.env);if(!tokenText(tokens.access_token))return fail('Stored provider credential is invalid');
  if(row.expires_at&&stamp(row.expires_at)>this.now().getTime()+60000)return {token:tokens.access_token,row};
  if(provider!=='x')return fail(`${provider==='linkedin'?'LinkedIn':'Facebook Login'} access expired or is expiring; reauthorize the member connection`);
  if(!tokenText(tokens.refresh_token))return fail('Refresh credential unavailable; reconnect');const lease=randomUUID(),until=new Date(this.now().getTime()+60000);
  const claimed=await this.db.query('UPDATE integration_oauth_connections SET refresh_lease=$3,refresh_until=$4 WHERE provider=$1 AND authorization_version=$2 AND refresh_lease IS NULL AND token_ciphertext=$5 RETURNING provider',[provider,row.authorization_version,lease,until,row.token_ciphertext]);if(claimed.length!==1)return fail('Connection refresh is already in progress; retry after it finishes');
  try{const data=await this.tokenRequest(provider,ready,{grant_type:'refresh_token',refresh_token:tokens.refresh_token}),parsed=this.parseTokens(provider,data,row.scopes,tokens);const saved=await this.db.query<ConnectionRow>('UPDATE integration_oauth_connections SET token_ciphertext=$4,scopes=$5,expires_at=$6,refresh_lease=NULL,refresh_until=NULL,last_error=NULL,updated=now() WHERE provider=$1 AND authorization_version=$2 AND refresh_lease=$3 RETURNING *',[provider,row.authorization_version,lease,seal(parsed.tokens,tokenContext(row),this.env),JSON.stringify(parsed.scopes),parsed.expires]);if(saved.length!==1)return fail('Connection changed during refresh; reconnect');return {token:parsed.tokens.access_token,row:saved[0]};}
  catch{await this.invalidate(provider,row.authorization_version,'Refresh failed or its outcome is uncertain; reconnect',lease);return fail('Refresh failed or its outcome is uncertain; reconnect');}
 }
 async credential(account:OAuthAccountReference){
  const provider=account.id==='oauth_x'?'x':account.id==='oauth_linkedin'?'linkedin':account.id==='oauth_instagram_facebook'?'instagram_facebook':null;if(!provider)return fail('Not an OAuth-backed publishing account');
  const result=await this.access(provider,account.authorization_version);if(provider==='instagram_facebook'&&(account.instagram_login!=='facebook'||account.instagram_api_version!==this.ready(provider).config.instagram_api_version||account.professional!==true))return fail('Instagram authorization family or API version changed');if(result.row.status!=='tested'||!result.row.tested_at||result.row.remote_id!==account.remote_id||account.platform!==(provider==='x'?'X':provider==='linkedin'?'LinkedIn':'Instagram'))return fail('Connected provider account has not passed its identity check');return result.token;
 }
 /** Admission callers hold settings -> OAuth guard -> task/source/policy before this row SHARE.
  * Every connection UPDATE conflicts with it until the caller commits admission; no I/O here.
  * An autocommit call is only a current-metadata hint, not durable publication admission. */
 async validateAccount(account:OAuthAccountReference,tx:Connection=this.db,allowRefreshableX=false):Promise<boolean>{
  const provider=account.id==='oauth_x'?'x':account.id==='oauth_linkedin'?'linkedin':account.id==='oauth_instagram_facebook'?'instagram_facebook':null;if(!provider)return false;
  try{const ready=this.ready(provider);if(provider==='instagram_facebook'&&(account.instagram_login!=='facebook'||account.instagram_api_version!==ready.config.instagram_api_version||account.professional!==true))return false;const row=(await tx.query<ConnectionRow>('SELECT * FROM integration_oauth_connections WHERE provider=$1 AND owner_id=$2 FOR SHARE',[provider,OWNER_ID]))[0];return !!row&&row.status==='tested'&&!!row.token_ciphertext&&!!row.tested_at&&!row.refresh_lease&&row.authorization_version===account.authorization_version&&row.remote_id===account.remote_id&&account.platform===(provider==='x'?'X':provider==='linkedin'?'LinkedIn':'Instagram')&&row.config_hash===ready.configHash&&!!row.expires_at&&(stamp(row.expires_at)>this.now().getTime()||allowRefreshableX&&provider==='x')&&this.readable(row)&&OAUTH_SCOPES[provider].every(scope=>row.scopes.includes(scope));}catch{return false;}
 }
 async test(provider:OAuthProvider,session:OAuthOwnerSession,acknowledged:boolean){
  if(acknowledged!==true)return fail('Explicit approval to test this connection is required',400);if(provider==='instagram_facebook')return this.discoverInstagram(session);await this.validSession(session);const ready=this.ready(provider);let reserve=0;
  if(provider==='x'){const c=ready.config;if(c.identity_cost_authorized!==true||!Number.isSafeInteger(c.identity_max_microdollars)||c.identity_max_microdollars!<=0||c.identity_max_microdollars!>1000000||!Number.isSafeInteger(c.monthly_identity_cap_microdollars)||c.monthly_identity_cap_microdollars!<=0)return fail('X identity test requires separate explicit cost authorization and a monthly cap');reserve=c.identity_max_microdollars!;}
  const result=await this.access(provider),testId=randomUUID(),month=istMonth(this.now());
  await this.db.transaction(async tx=>{await this.validSession(session,tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');const current=(await tx.query<ConnectionRow>('SELECT * FROM integration_oauth_connections WHERE provider=$1 AND owner_id=$2',[provider,OWNER_ID]))[0];if(!current||current.authorization_version!==result.row.authorization_version||!['connected','tested'].includes(current.status)||!current.token_ciphertext||current.refresh_lease||current.config_hash!==ready.configHash)return fail('Connection changed before its identity test');if(provider==='x'){const rows=await tx.query<{cost:string}>("SELECT COALESCE(SUM(reserved_microdollars),0)::text AS cost FROM integration_oauth_tests WHERE provider=$1 AND (month=$2 OR state IN ('started','uncertain'))",[provider,month]);if(Number(rows[0].cost)+reserve>ready.config.monthly_identity_cap_microdollars!)return fail('X identity test monthly budget is exhausted');}await tx.query("INSERT INTO integration_oauth_tests(id,provider,authorization_version,month,reserved_microdollars,state) VALUES($1,$2,$3,$4,$5,'started')",[testId,provider,result.row.authorization_version,month,reserve]);});
  let testState:'failed'|'uncertain'='uncertain';
  try{
   let remote:Response;try{remote=await this.transport(ENDPOINTS[provider].identity,{method:'GET',headers:{Authorization:`Bearer ${result.token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{return fail('Connection identity test could not be completed');}
   testState=remote.status>=500||remote.status===408?'uncertain':'failed';
   if(!remote.ok){if(remote.status===401)await this.invalidate(provider,result.row.authorization_version,'Provider rejected credential; reconnect');return fail('Provider rejected the connection identity test');}
   const data=await boundedJSON(remote),identity=provider==='x'?(data.data as Record<string,unknown>|undefined):data,id=provider==='x'?identity?.id:identity?.sub;
   if(typeof id!=='string'||!(provider==='x'?/^\d{1,30}$/:/^[A-Za-z0-9_-]{1,200}$/).test(id))return fail('Provider did not return a valid account identity');
   const remoteId=provider==='x'?id:`urn:li:person:${id}`,rawLabel=provider==='x'?identity?.username:identity?.name,label=typeof rawLabel==='string'&&rawLabel.trim()&&!/[\u0000-\u001f\u007f]/.test(rawLabel)?rawLabel.slice(0,200):`${provider==='x'?'X':provider==='linkedin'?'LinkedIn':'Instagram'} account`;
   if(result.row.remote_id&&result.row.remote_id!==remoteId){await this.invalidate(provider,result.row.authorization_version,'Provider account identity changed; reconnect');return fail('Provider account identity changed; reconnect');}
   const saved=await this.db.query("UPDATE integration_oauth_connections SET remote_id=$3,label=$4,tested_at=$5,status='tested',last_error=NULL,updated=now() WHERE provider=$1 AND authorization_version=$2 AND status IN ('connected','tested') AND token_ciphertext IS NOT NULL RETURNING provider",[provider,result.row.authorization_version,remoteId,label,this.now()]);if(saved.length!==1)return fail('Connection changed during its identity test');
   await this.db.query("UPDATE integration_oauth_tests SET state='succeeded' WHERE id=$1",[testId]);return {provider,status:'tested',remote_id:remoteId,label,tested_at:this.now().toISOString()};
  }catch(error){await this.db.query('UPDATE integration_oauth_tests SET state=$2 WHERE id=$1',[testId,testState]);if(error instanceof OAuthError)throw error;return fail('Connection identity test could not be completed');}
 }
 private async facebookRead(path:string,params:Record<string,string>,token:string,version:string){
  // Paths are constructed from fixed literals or strictly validated numeric provider IDs.
  const url=new URL(`https://graph.facebook.com/${version}/${path}`);url.search=new URLSearchParams(params).toString();let remote:Response;
  try{remote=await this.transport(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{return fail('Facebook account verification could not be completed');}
  if(!remote.ok)return fail('Facebook rejected account verification; review the granted permissions and account access');return boundedJSON(remote);
 }
 private async discoverInstagram(session:OAuthOwnerSession){
  await this.validSession(session);const provider='instagram_facebook',ready=this.ready(provider),result=await this.access(provider),version=ready.config.instagram_api_version!;
  const permissions=await this.facebookRead('me/permissions',{},result.token,version),grants=Array.isArray(permissions.data)?permissions.data:[];
  if(!Array.isArray(permissions.data)||permissions.paging&&typeof permissions.paging==='object'&&(permissions.paging as {next?:unknown}).next||OAUTH_SCOPES[provider].some(scope=>!grants.some((entry:unknown)=>!!entry&&typeof entry==='object'&&(entry as {permission?:unknown}).permission===scope&&(entry as {status?:unknown}).status==='granted'))){await this.invalidate(provider,result.row.authorization_version,'Required Facebook permissions were not granted; reconnect');return fail('Required Facebook permissions were not granted; reconnect');}
  const pages=await this.facebookRead('me/accounts',{fields:'id,name,instagram_business_account{id,name,username}',limit:'25'},result.token,version);
  if(!Array.isArray(pages.data)||pages.data.length>25||pages.paging&&typeof pages.paging==='object'&&(pages.paging as {next?:unknown}).next)return fail('Linked Page discovery was incomplete; restrict the grant to selected Pages and reconnect');
  const candidates:InstagramCandidate[]=[];
  for(const value of pages.data){
   if(!value||typeof value!=='object'||Array.isArray(value))return fail('Facebook returned invalid Page metadata');const page=value as Record<string,unknown>,ig=page.instagram_business_account as Record<string,unknown>|undefined;if(!ig)continue;
   if(typeof page.id!=='string'||!/^\d{1,30}$/.test(page.id)||typeof ig!=='object'||typeof ig.id!=='string'||!/^\d{1,30}$/.test(ig.id)||typeof ig.username!=='string'||!ig.username||ig.username.length>100||/[\u0000-\u001f\u007f]/.test(ig.username))return fail('Facebook returned an invalid linked professional account');
   if(candidates.some(candidate=>candidate.page_id===page.id||candidate.remote_id===ig.id))return fail('Facebook returned ambiguous duplicate account identities');
   const pageName=typeof page.name==='string'&&!/[\u0000-\u001f\u007f]/.test(page.name)?page.name.slice(0,80):page.id;
   candidates.push({page_id:page.id,remote_id:ig.id,label:`@${ig.username} (Page ${pageName})`});
  }
  if(!candidates.length)return fail('No linked professional Instagram account was found');if(candidates.length>10)return fail('Too many linked professional accounts; restrict the grant to selected Pages and reconnect');
  const nextVersion=randomUUID(),context:Pick<ConnectionRow,'provider'|'owner_id'|'authorization_version'>={provider,owner_id:OWNER_ID,authorization_version:nextVersion},sealed=seal({access_token:result.token,candidates},tokenContext(context),this.env);
  await this.db.transaction(async tx=>{await this.validSession(session,tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');const saved=await tx.query("UPDATE integration_oauth_connections SET authorization_version=$3,status='selection_required',token_ciphertext=$4,remote_id=NULL,label=NULL,tested_at=NULL,last_error=NULL,updated=now() WHERE provider=$1 AND authorization_version=$2 AND status IN ('connected','tested','selection_required') AND token_ciphertext IS NOT NULL AND expires_at>$5 RETURNING provider",[provider,result.row.authorization_version,nextVersion,sealed,new Date(this.now().getTime()+60000)]);if(saved.length!==1)return fail('Connection changed during linked account discovery');});
  return {provider,status:'selection_required',tested:false,candidates,selection_version:nextVersion};
 }
 async selectInstagram(session:OAuthOwnerSession,selection:InstagramSelection){
  if(!selection||Object.keys(selection).some(k=>!['acknowledged','page_id','remote_id','authorization_version'].includes(k))||selection.acknowledged!==true)return fail('Explicit approval of this exact Page and professional Instagram account is required',400);
  if(!/^\d{1,30}$/.test(selection.page_id)||!/^\d{1,30}$/.test(selection.remote_id)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.authorization_version))return fail('Invalid exact account selection',400);
  await this.validSession(session);const provider='instagram_facebook',ready=this.ready(provider),result=await this.access(provider,selection.authorization_version),stored=unseal<SecretTokens>(result.row.token_ciphertext!,tokenContext(result.row),this.env);
  const candidates=stored.candidates||[],candidate=candidates.find(item=>item.page_id===selection.page_id&&item.remote_id===selection.remote_id);if(result.row.status!=='selection_required'||!candidate)return fail('Select an account from the current verified candidate list');
  // Recheck the exact Page-to-Instagram link and publishing permission before committing the choice.
  const linked=await this.facebookRead(selection.page_id,{fields:'id,instagram_business_account{id,username}'},result.token,ready.config.instagram_api_version!),professional=linked.instagram_business_account as {id?:unknown}|undefined;
  if(linked.id!==selection.page_id||professional?.id!==selection.remote_id)return fail('The selected Page is no longer linked to that Instagram account; rediscover accounts');
  const profile=await this.facebookRead(selection.remote_id,{fields:'id,username'},result.token,ready.config.instagram_api_version!);if(profile.id!==selection.remote_id)return fail('Instagram returned a different account identity');
  const eligibility=await this.facebookRead(selection.remote_id+'/content_publishing_limit',{},result.token,ready.config.instagram_api_version!);if(!Array.isArray(eligibility.data))return fail('Instagram publishing access could not be verified');
  const nextVersion=randomUUID(),context:Pick<ConnectionRow,'provider'|'owner_id'|'authorization_version'>={provider,owner_id:OWNER_ID,authorization_version:nextVersion},sealed=seal({access_token:result.token,selected:candidate},tokenContext(context),this.env);
  await this.db.transaction(async tx=>{await this.validSession(session,tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');const saved=await tx.query("UPDATE integration_oauth_connections SET authorization_version=$3,status='tested',token_ciphertext=$4,remote_id=$5,label=$6,tested_at=$7,last_error=NULL,updated=now() WHERE provider=$1 AND authorization_version=$2 AND status='selection_required' AND token_ciphertext IS NOT NULL AND expires_at>$8 RETURNING provider",[provider,result.row.authorization_version,nextVersion,sealed,candidate.remote_id,candidate.label,this.now(),new Date(this.now().getTime()+60000)]);if(saved.length!==1)return fail('Connection changed during account selection');});
  return {provider,status:'tested',page_id:candidate.page_id,remote_id:candidate.remote_id,label:candidate.label,authorization_version:nextVersion};
 }
 async disconnect(provider:OAuthProvider,session:OAuthOwnerSession,acknowledged:boolean){
  if(!PROVIDERS.includes(provider))return fail('Provider connection flow is not supported',404);if(acknowledged!==true)return fail('Explicit approval to disconnect this provider is required',400);await this.validSession(session);
  await this.db.transaction(async tx=>{await this.validSession(session,tx);await tx.query('SELECT id FROM integration_oauth_guard WHERE id=1 FOR UPDATE');await tx.query('DELETE FROM integration_oauth_flows WHERE provider=$1',[provider]);await tx.query("UPDATE integration_oauth_connections SET authorization_version=$2,status='disconnected',token_ciphertext=NULL,scopes='[]',expires_at=NULL,remote_id=NULL,label=NULL,tested_at=NULL,refresh_lease=NULL,refresh_until=NULL,last_error=NULL,updated=now() WHERE provider=$1",[provider,randomUUID()]);});return {provider,status:'disconnected',notice:'Local credentials removed. Revoke the application grant in the provider settings to remove provider-side access.'};
 }
 private readable(row:ConnectionRow):boolean {try{if(!row.token_ciphertext)return false;const value=unseal<SecretTokens>(row.token_ciphertext,tokenContext(row),this.env);return tokenText(value.access_token)&&(row.provider!=='x'||tokenText(value.refresh_token))&&(row.provider!=='instagram_facebook'||row.status!=='tested'||!!value.selected&&value.selected.remote_id===row.remote_id&&/^\d{1,30}$/.test(value.selected.page_id));}catch{return false;}}
 async snapshot(){
  const all=await this.db.query<ConnectionRow>('SELECT * FROM integration_oauth_connections WHERE owner_id=$1',[OWNER_ID]);
  const result=PROVIDERS.map(provider=>{let ready:Ready|undefined,reason:string|null=null;try{ready=this.ready(provider);}catch(error){reason=error instanceof OAuthError?error.message:'Connection configuration unavailable';}const row=all.find(item=>item.provider===provider),compatible=!!ready&&row?.config_hash===ready.configHash,expired=!!row?.expires_at&&stamp(row.expires_at)<=this.now().getTime(),hasToken=!!row&&this.readable(row)&&['connected','tested','selection_required'].includes(row.status),staleRefresh=!!row?.refresh_lease&&(!row.refresh_until||stamp(row.refresh_until)<=this.now().getTime()),connected=compatible&&hasToken&&!expired&&!row?.refresh_lease,tested=connected&&row?.status==='tested'&&!!row.tested_at&&!!row.remote_id;
   let candidates:InstagramCandidate[]=[];if(provider==='instagram_facebook'&&row?.token_ciphertext&&hasToken)try{candidates=unseal<SecretTokens>(row.token_ciphertext,tokenContext(row),this.env).candidates||[];}catch{}
   const status=!ready?'unconfigured':!row?'configured':!compatible?'reauthorization_required':row.status==='disconnected'?'configured':staleRefresh?'reauthorization_required':row.refresh_lease?'refreshing':!hasToken?'reauthorization_required':row.status==='reauthorization_required'?'reauthorization_required':expired?'expired':row.status==='selection_required'?'selection_required':tested?'tested':'connected';
   return {provider,supported:true,candidates,selection_version:provider==='instagram_facebook'&&row?.status==='selection_required'?row.authorization_version:null,configured:!!ready,connected,tested,expired,status,account_id:`oauth_${provider}`,remote_id:row?.remote_id||null,label:row?.label||null,authorization_version:row?.authorization_version||null,expires_at:row?.expires_at?new Date(row.expires_at).toISOString():null,tested_at:row?.tested_at?new Date(row.tested_at).toISOString():null,scopes:[...OAUTH_SCOPES[provider]],reason:reason||(!compatible&&row?'Provider configuration changed; reconnect':staleRefresh?'Refresh outcome is uncertain; reconnect':row&&['connected','tested','selection_required'].includes(row.status)&&!hasToken?'Stored connection cannot be decrypted; authorized key recovery or reconnection is required':row?.last_error)||(provider==='instagram_facebook'?'Facebook Login can list the Pages you permit, read their linked Instagram professional accounts, and publish to the Instagram account you explicitly select.':null),identity_test_cost:provider==='x'?{authorized:ready?.config.identity_cost_authorized===true,max_microdollars:ready?.config.identity_max_microdollars??null,monthly_cap_microdollars:ready?.config.monthly_identity_cap_microdollars??null,currency:'USD',separate_from_publishing_cap:true}:null,refresh:provider==='x'?'automatic_rotation':'owner_reauthorization',documentation:OAUTH_DOCUMENTATION[provider]};});
  return [...result,...(['instagram','github','youtube'] as const).map(provider=>({provider,supported:false,configured:false,connected:false,tested:false,expired:false,status:'unsupported',reason:provider==='instagram'?'Instagram Login OAuth exchange and refresh are not enabled. The separately listed Facebook Login flow supports linked professional accounts.':provider==='github'?'GitHub requires a separately approved, selected-repository read-only App installation; this flow does not create installation credentials.':'YouTube owner-read OAuth is not enabled; separately configured metadata access remains available.'}))];
 }
 async publishingAccounts():Promise<PublishingAccount[]>{
  const rows=await this.db.query<ConnectionRow>("SELECT * FROM integration_oauth_connections WHERE owner_id=$1 AND remote_id IS NOT NULL AND tested_at IS NOT NULL",[OWNER_ID]);
  return rows.map(row=>{let configured=false;try{configured=this.ready(row.provider).configHash===row.config_hash&&this.readable(row)&&row.status==='tested'&&!row.refresh_lease;}catch{}const usable=configured&&(!!row.expires_at&&stamp(row.expires_at)>this.now().getTime()+60000||row.provider==='x');return {id:`oauth_${row.provider}`,platform:row.provider==='x'?'X':row.provider==='linkedin'?'LinkedIn':'Instagram',remote_id:row.remote_id!,label:row.label||`${row.provider} account`,authorization_version:row.authorization_version,scopes:row.scopes,enabled:usable,verified:row.status==='tested',credential_configured:usable,linkedin_version:this.config.providers?.linkedin?.linkedin_version,...(row.provider==='instagram_facebook'?{instagram_login:'facebook' as const,instagram_api_version:this.config.providers?.instagram_facebook?.instagram_api_version,professional:true}:{})};});
 }
}
export type OAuthHandlerDependencies=OAuthDependencies&{db?:Database;env?:Env;config?:OAuthConfig};
async function connectionBody(request:Request){if(Number(request.headers.get('content-length')||0)>1024)return fail('Invalid connection request',400);const reader=request.body?.getReader();if(!reader)return fail('Connection acknowledgement required',400);let size=0;const parts:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024){await reader.cancel();return fail('Invalid connection request',400);}parts.push(part.value);}const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))return fail('Invalid connection request',400);return value as Record<string,unknown>;}catch{return fail('Invalid connection request',400);}}
/** Cookie owner auth only; machine bearer tokens cannot create persistent connections. */
export async function handleIntegrationOAuth(request:Request,providerName:string,action:string,deps:OAuthHandlerDependencies={}){
 const env=deps.env||process.env,provider=providerName as OAuthProvider;
 if(!PROVIDERS.includes(provider)||!['start','callback','test','select','disconnect','status'].includes(action))return response({error:'Unknown provider connection action'},404);
 if(request.method!==(action==='callback'||action==='status'?'GET':'POST'))return response({error:'Method not allowed'},405);
 const origin=env.STUDIO_ORIGIN;let url:URL;try{url=new URL(request.url);if(!origin)return response({error:'Origin rejected'},403);const expected=new URL(origin),host=request.headers.get('host'),canonical=url.origin===origin,normalized=expected.hostname==='127.0.0.1'&&url.hostname==='localhost'&&url.protocol===expected.protocol&&url.port===expected.port&&host===expected.host;if((host&&host!==expected.host)||(!canonical&&!normalized))return response({error:'Origin rejected'},403);}catch{return response({error:'Origin rejected'},403);}
 if(action!=='callback'&&action!=='status'&&!allowedOrigin(request,origin))return response({error:'Origin rejected'},403);
 try{
  const db=deps.db||await database();if(hostedEnvironment(env)&&(db.kind!=='postgres'||!hostedOwnerReady(runtimeConfig(env),env)))return response({error:'Authorized production owner setup is required'},503);let config=deps.config;if(!config){const {integrationConfig}=await import('./integration-config');config=(integrationConfig(env) as {oauth?:OAuthConfig}).oauth||{};}const service=new IntegrationOAuth(db,config,env,deps);
  if(action==='callback'){
   if(url.pathname!==callbackPath(provider)||['state','code','error'].some(name=>url.searchParams.getAll(name).length>1))return response({error:'Invalid connection callback'},400);
   await service.callback(provider,{state:url.searchParams.get('state')||'',code:url.searchParams.get('code')??undefined,error:url.searchParams.get('error')??undefined,binding:readBinding(request,provider,origin)});
   // Fixed same-origin destination, no authorization code, provider error text, or tokens in URL/body.
   return new Response(null,{status:303,headers:{Location:origin+'/?connection='+provider,'Set-Cookie':bindingCookie(provider,'',origin,0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(!await passwordOwnerAuthenticated(request,env,async()=>db))return response({error:'Authenticated owner session required'},401);
  if(action==='status')return response({connections:await service.snapshot()});
  const current=await createOwnerAuth(db,env).api.getSession({headers:request.headers});if(current?.user.id!==OWNER_ID)return response({error:'Authenticated owner session required'},401);const session={owner_id:OWNER_ID,session_id:current.session.id},body=await connectionBody(request),ack=Object.keys(body).length===1&&body.acknowledged===true;
  if(action==='select'){if(provider!=='instagram_facebook')return response({error:'Account selection is unsupported for this provider'},404);return response(await service.selectInstagram(session,body as InstagramSelection));}
  if(action==='start'){const {set_cookie,...result}=await service.start(provider,session,ack);return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json','Set-Cookie':set_cookie,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
  return response(action==='test'?await service.test(provider,session,ack):await service.disconnect(provider,session,ack));
 }catch(error){const result=response({error:error instanceof OAuthError?error.message:'Provider connection unavailable'},error instanceof OAuthError?error.status:503);result.headers.set('Referrer-Policy','no-referrer');if(action==='callback'&&origin)result.headers.set('Set-Cookie',bindingCookie(provider,'',origin,0));return result;}
}
