import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PrivacyNotice from '../app/privacy/page';
import OwnerUseNotice from '../app/use/page';
import Page from '../app/page';
import ConnectionsPanel from '../app/connections-panel';
import {embedded} from '../lib/db';
import {handleOwnerAuth,provisionOwner} from '../lib/owner-password';
import {handleIntegrationOAuth,OAUTH_SCOPES,type OAuthConfig} from '../lib/integration-oauth';
import {GET as studioGet} from '../app/api/studio/[action]/route';

const render=(component:Parameters<typeof createElement>[0])=>renderToStaticMarkup(createElement(component));
const connectionProps={integrations:{sources:{connections:[]},publishing:{enabled:false},scheduler:{notice:'Publishing and scheduler are off'},oauth:[{provider:'linkedin',supported:true,configured:true,connected:false,status:'configured',scopes:['openid','profile','w_member_social']}]},busy:false,action:async()=>true,onChanged:async()=>{}};

test('public notice pages render static policy text and exact contact, without owner-data access',async()=>{
 const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Public notices must not perform requests');};
 try{
  for(const component of [PrivacyNotice,OwnerUseNotice]){
   const html=render(component);
   assert.match(html,/Effective date: 23 October 2026/);
   assert.match(html,/href="\/privacy"/);assert.match(html,/href="\/use"/);
   assert.match(html,/href="https:\/\/www.linkedin.com\/company\/ai-journey-studio\/home\/"/);
   assert.match(html,/Return to owner sign-in/);
   assert.doesNotMatch(html,/<input|<button|<form|token_ciphertext|session_id|DATABASE_URL|STUDIO_AUTH_SECRET/);
  }
  for(const file of ['app/privacy/page.tsx','app/use/page.tsx','app/notice-shell.tsx','app/notice-links.tsx']){
   const source=await readFile(file,'utf8');
   assert.doesNotMatch(source,/lib\/(?:db|store|owner-password|integration-oauth|workflow)|process\.env|fetch\(|cookies\(|headers\(|dangerouslySetInnerHTML/);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;}
});

test('privacy notice distinguishes scope breadth, stored profile, model access and retained history',()=>{
 const html=render(PrivacyNotice);
 for(const text of ['openid, profile and w_member_social, but not email access','includes posts, comments and reactions','publishing is currently off','does not approve any post or grant Page-posting access','member identifier and name','Verification is owner-initiated, not periodic','does not send its profile response or token to OpenAI','store=false, which is not a zero-retention guarantee','Minimal disconnected-status and verification history remains','no automatic age-based deletion','General workspace deletion is not self-service'])assert(html.includes(text),text);
});

test('owner-use notice is concise and excludes confidential material, not general banking knowledge',()=>{
 const html=render(OwnerUseNotice),article=html.match(/<article>([\s\S]*?)<\/article>/)![1];
 const words=article.replace(/<\/p>/g,' ').replace(/<[^>]*>/g,'').trim().split(/\s+/);
 assert(words.length<=150);
 assert.match(article,/Do not add employer or client material, private or confidential data, or credentials/);
 assert.doesNotMatch(article,/(?:Exclude|Do not add)[^.]*bank/i);
 assert.match(article,/Saving notes, connecting LinkedIn, approving drafts and approving publication are separate decisions/);
});

test('login and LinkedIn disclosure link both public notices and start unchecked',()=>{
 const login=render(Page),html=renderToStaticMarkup(createElement(ConnectionsPanel,connectionProps));
 for(const text of [login,html]){assert.match(text,/href="\/privacy"/);assert.match(text,/href="\/use"/);}
 assert.match(html,/I have read the Privacy Notice and owner-use notice and approve the stated connection access and storage/);
 assert.match(html,/posting permission also covers comments\/reactions/);
 assert.match(html,/Connecting does not approve a post or send your LinkedIn profile to OpenAI/);
 assert.match(html,/<button disabled="">Continue to LinkedIn<\/button>/);
 assert.doesNotMatch(html,/<input[^>]+checked/);
 assert.match(html,/&quot;enabled&quot;:\s*false/);
});

test('public pages do not alter protected owner APIs, CSRF or affirmative LinkedIn acknowledgement',async()=>{
 const db=await embedded(),origin='https://127.0.0.1:3195';
 const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:'isolated-notice-test-auth-secret-'.repeat(2),STUDIO_CONNECTIONS_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),STUDIO_OAUTH_LINKEDIN_CLIENT_ID:'fixture-linkedin-client',STUDIO_OAUTH_LINKEDIN_CLIENT_SECRET:'fixture-linkedin-secret',STUDIO_RUNTIME_CONFIG:'{}'};
 const config:OAuthConfig={enabled:true,credential_use_authorized:true,providers:{linkedin:{enabled:true,redirect_uri:origin+'/api/connections/linkedin/callback',linkedin_version:'202610'}}};
 const global=globalThis as typeof globalThis&{studioDb?:Promise<any>};global.studioDb=Promise.resolve(db);
 const saved=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
 let network=0;const deps={db,env,config,fetch:(async()=>{network++;throw Error('No external calls');}) as typeof fetch};
 const request=(ack:unknown,headers:Record<string,string>={})=>new Request(origin+'/api/connections/linkedin/start',{method:'POST',headers:{Origin:origin,Host:'127.0.0.1:3195','Content-Type':'application/json',...headers},body:JSON.stringify({acknowledged:ack})});
 try{
  await provisionOwner(db,'fixture-notice-owner-passphrase',true);
  assert.equal((await studioGet(new Request(origin+'/api/studio/state'),{params:Promise.resolve({action:'state'})})).status,401);
  assert.equal((await handleIntegrationOAuth(request(true),'linkedin','start',deps)).status,401);
  const login=await handleOwnerAuth(new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,Host:'127.0.0.1:3195','Content-Type':'application/json'},body:JSON.stringify({password:'fixture-notice-owner-passphrase'})}),'login',env,async()=>db);
  assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(part=>part.split(';')[0]).join('; ');
  for(const ack of [false,undefined,'true',1])assert.equal((await handleIntegrationOAuth(request(ack,{Cookie:cookie}),'linkedin','start',deps)).status,400);
  assert.equal((await handleIntegrationOAuth(request(true,{Cookie:cookie,Origin:'https://wrong.example'}),'linkedin','start',deps)).status,403);
  assert.equal((await db.query('SELECT * FROM integration_oauth_flows')).length,0);
  const started=await handleIntegrationOAuth(request(true,{Cookie:cookie}),'linkedin','start',deps);assert.equal(started.status,200);
  const authorization=new URL((await started.json()).authorization_url);assert.equal(authorization.origin,'https://www.linkedin.com');assert.deepEqual(authorization.searchParams.get('scope')!.split(' '),OAUTH_SCOPES.linkedin);
  assert.equal((await db.query('SELECT * FROM integration_oauth_connections')).length,0);assert.equal((await db.query('SELECT * FROM publishing_outbox')).length,0);assert.equal((await db.query('SELECT * FROM ledger')).length,0);assert.equal(network,0);
 }finally{delete global.studioDb;for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;await db.close();}
});
