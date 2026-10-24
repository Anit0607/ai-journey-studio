import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {SourceIngestion,type SourceIngestionConfig} from '../lib/source-ingestion';
import {createGitHubAppCredentialResolver,GITHUB_APP_PRIVATE_KEY_ENV,type GitHubAppConfig} from '../lib/github-app-auth';

// Generated test-only fixture; every transport is injected. Never use process credentials.
const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const initial=Date.parse('2026-10-15T03:00:00Z'),repository='builder/studio',repositoryId=101;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const entry={sha:'a'.repeat(40),commit:{message:'Implemented source-linked draft previews and verified the review checklist.',committer:{date:'2026-10-14T12:00:00Z'}}};
const metadata=(extra:Record<string,unknown>={})=>({id:repositoryId,full_name:'Builder/Studio',private:true,visibility:'private',permissions:{pull:false,push:false,admin:false},...extra});
async function fixture(work:(db:Database)=>Promise<void>){const db=await embedded();try{await work(db);}finally{await db.close();}}
function setup(){
  const app:GitHubAppConfig={authorized:true,app_id:7,installation_id:9,selected_repository_ids:[repositoryId]};
  const config:SourceIngestionConfig={github:{enabled:true,sync_authorized:true,private_read_authorized:true,repositories:['Builder/Studio'],since:'2026-10-01T00:00:00Z',app}};
  let time=initial,appCalls=0;
  const now=()=>new Date(time);
  const credential=createGitHubAppCredentialResolver(app,config.github!.repositories,{env:{[GITHUB_APP_PRIVATE_KEY_ENV]:pem},now,fetch:async(_input,init)=>{
    appCalls++;return init?.method==='POST'?json({token:'fixture-app-token',expires_at:new Date(time+3_600_000).toISOString(),permissions:{contents:'read',metadata:'read'},repository_selection:'selected',repositories:[{id:repositoryId,full_name:'Builder/Studio',owner:{login:'Builder',id:11}}]},201):json({id:9,app_id:7,account:{login:'Builder',id:11,type:'User'},suspended_at:null,repository_selection:'selected'});
  }});
  return {app,config,now,credential,advance:()=>{time+=3_540_000;},calls:()=>appCalls};
}
async function noStaging(db:Database){assert.deepEqual(await db.query('SELECT * FROM sources'),[]);assert.deepEqual(await db.query('SELECT * FROM source_provenance'),[]);assert.deepEqual(await db.query('SELECT * FROM tasks'),[]);assert.equal((await db.query('SELECT last_synced_at FROM source_sync_state'))[0]?.last_synced_at,null);}

for(const permissions of [{pull:false,push:false,admin:false},{},undefined])test('validated App read grant accepts user-style permissions '+JSON.stringify(permissions),()=>fixture(async db=>{
  const s=setup();let reads=0;
  const service=new SourceIngestion(db,s.config,{env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'},now:s.now,githubCredential:s.credential,fetch:async(input,init)=>{
    reads++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-app-token');assert.equal(init?.redirect,'error');
    return new URL(String(input)).pathname.endsWith('/commits')?json([entry]):json(metadata({permissions}));
  }});
  const result=await service.sync('github');assert.equal(result.status,'synced');assert.equal(result.providers[0].staged,1);assert.equal(reads,2);assert.equal(s.calls(),2);
  const source=(await db.query('SELECT * FROM sources'))[0];assert.equal(source.cleared,false);assert.equal(source.clearance_id,null);assert.deepEqual(await db.query('SELECT * FROM tasks'),[]);
  assert.equal(JSON.stringify(await service.snapshot()).includes('fixture-app-token'),false);
}));

for(const [id,isPublic] of [[999,false],[undefined,false],['101',false],[999,true],[undefined,true]] as const)test('App metadata ID '+String(id)+' is bound even with pull:true and public='+isPublic,()=>fixture(async db=>{
  const s=setup();let reads=0;
  const result=await new SourceIngestion(db,s.config,{env:{},now:s.now,githubCredential:s.credential,fetch:async()=>{reads++;return json(metadata({id,private:!isPublic,visibility:isPublic?'public':'private',permissions:{pull:true}}));}}).sync('github');
  assert.equal(result.providers[0].error,'github_app_repository_response_mismatch');assert.equal(reads,1);await noStaging(db);
}));

test('a verified App ID cannot authorize a different response repository name',()=>fixture(async db=>{
  const s=setup();const result=await new SourceIngestion(db,s.config,{env:{},now:s.now,githubCredential:s.credential,fetch:async()=>json(metadata({full_name:'builder/other'}))}).sync('github');assert.equal(result.providers[0].error,'repository_allowlist_mismatch');await noStaging(db);
}));

for(const change of ['expiry','revocation'] as const)test('App proof fails closed when '+change+' occurs during metadata read',()=>fixture(async db=>{
  const s=setup();const result=await new SourceIngestion(db,s.config,{env:{},now:s.now,githubCredential:s.credential,fetch:async()=>{if(change==='expiry')s.advance();else s.app.authorized=false;return json(metadata({private:false,visibility:'public',permissions:{pull:true}}));}}).sync('github');
  assert.equal(result.providers[0].error,'github_app_repository_response_mismatch');await noStaging(db);
}));

for(const kind of ['default','lookalike'] as const)test(kind+' token path cannot invent App proof from flags or callback properties',()=>fixture(async db=>{
  const s=setup(),fake=Object.assign(async()=> 'fixture-default-token',{authorized:true,permissions:{contents:'read',metadata:'read'},repositoryIds:new Map([[repository,repositoryId]])});
  const result=await new SourceIngestion(db,s.config,{env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'},now:s.now,...(kind==='lookalike'?{githubCredential:fake}:{}),fetch:async()=>json(metadata())}).sync('github');
  assert.equal(result.providers[0].error,'repository_read_permission_required');assert.equal(s.calls(),0);await noStaging(db);
}));

test('missing private-read consent does not invoke App resolver even with a default token',()=>fixture(async db=>{
  const s=setup();s.config.github!.private_read_authorized=false;
  const result=await new SourceIngestion(db,s.config,{env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'},now:s.now,githubCredential:s.credential,fetch:async()=>json(metadata())}).sync('github');
  assert.equal(result.providers[0].error,'private_repository_authorization_required');assert.equal(s.calls(),0);await noStaging(db);
}));

for(const status of [401,403])for(const phase of ['metadata','commits'] as const)test('App '+phase+' HTTP '+status+' never falls back or stages',()=>fixture(async db=>{
  const s=setup();let reads=0;
  const result=await new SourceIngestion(db,s.config,{env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'},now:s.now,githubCredential:s.credential,fetch:async(input,init)=>{
    reads++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-app-token');
    return phase==='metadata'||new URL(String(input)).pathname.endsWith('/commits')?json({message:'not recorded'},status):json(metadata());
  }}).sync('github');assert.equal(result.providers[0].error,'provider_access_denied');assert.equal(reads,phase==='metadata'?1:2);await noStaging(db);
}));

test('an invalid App grant cannot fall back to a configured default token',()=>fixture(async db=>{
  const s=setup();let reads=0;s.app.authorized=false;
  const result=await new SourceIngestion(db,s.config,{env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'},now:s.now,githubCredential:s.credential,fetch:async()=>{reads++;return json(metadata({permissions:{pull:true}}));}}).sync('github');
  assert.equal(result.providers[0].error,'github_app_authorization_required');assert.equal(reads,0);await noStaging(db);
}));
