import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {handleIntegrationTick,type IntegrationTickDependencies} from '../lib/integration-http';
import type {Database} from '../lib/db';
import {fixedSettings} from './scheduler-window-fixture';
const origin='https://fixed-window.example.test',url=origin+'/api/integrations/tick';
const current='offline-window-key-'+ 'a'.repeat(40),next='offline-window-key-'+ 'b'.repeat(40);
const env={STUDIO_ORIGIN:origin,QSTASH_CURRENT_SIGNING_KEY:current,QSTASH_NEXT_SIGNING_KEY:next};
function jwt(body='{}',patch:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000),claims={iss:'Upstash',sub:url,nbf:now-5,iat:now-5,exp:now+120,jti:'offline-window-test',body:createHash('sha256').update(body).digest('base64url'),...patch};
 const input=[{alg:'HS256',typ:'JWT'},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');return input+'.'+createHmac('sha256',current).update(input).digest('base64url');
}
const request=(body='{}',signature=jwt(body),target=url,headers={})=>new Request(target,{method:'POST',headers:{'content-type':'application/json','upstash-signature':signature,...headers},body});
const idle=()=>new Date('2026-10-26T12:15:00Z');

test('off-window valid wake returns 2xx before any DB open or delivery claim after the full signature gate',async()=>{
 let opened=0,runs=0;const deps:IntegrationTickDependencies={env,config:fixedSettings(),now:idle,database:async()=>{opened++;throw Error('DB forbidden');},runTick:async()=>{runs++;return {status:'completed'};}};
 const response=await handleIntegrationTick(request(),deps);assert.equal(response.status,200);assert.deepEqual(await response.json(),{result:{status:'idle'}});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(opened,0);assert.equal(runs,0);
 for(const req of [request('{}','bad.signature.here'),request('{ }',jwt('{}')),request('{"limit":1}'),request('[]'),request('{}',jwt('{}',{exp:Math.floor(Date.now()/1000)-1})),request('{}',jwt(),'https://wrong.example.test/api/integrations/tick'),request('{}',jwt(),url+'?x=1'),request('{}',jwt(),url,{host:'other.example.test'}),request('{}',jwt(),url,{'content-type':'text/plain'}),request(' '.repeat(1025))])assert.notEqual((await handleIntegrationTick(req,deps)).status,200);
 assert.equal(opened,0);assert.equal(runs,0);
 assert.equal((await handleIntegrationTick(request(),{...deps,env:{...env,QSTASH_NEXT_SIGNING_KEY:''}})).status,503);
 assert.equal((await handleIntegrationTick(request(),{...deps,config:{scheduler:{...fixedSettings().scheduler,authorized:false}}})).status,503);
 assert.equal((await handleIntegrationTick(request(),{...deps,env:{...env,VERCEL:'1'},readRuntimeConfig:()=>({})})).status,503);
 assert.equal(opened,0);
});

test('invalid explicit policy fails closed after signature validation, never generic polling',async()=>{
 let opened=0;const deps:IntegrationTickDependencies={env,now:idle,database:async()=>{opened++;throw Error('No DB');}};
 for(const policy of [null,{},'fixed-cadence-v1']){
  const config={scheduler:{...fixedSettings().scheduler,window_policy:policy}};
  assert.equal((await handleIntegrationTick(request(),{...deps,config})).status,503);
  assert.equal((await handleIntegrationTick(request('{}','bad.signature.here'),{...deps,config})).status,401);
 }
 assert.equal(opened,0);
});

test('generic delivery and admitted windows retain durable authenticated-jti deduplication',async()=>{
 let queries=0,runs=0,opens=0;const db={query:async(sql:string)=>{queries++;return sql.startsWith('INSERT')?[{signed_jti:'offline-window-test'}]:[];}} as unknown as Database;
 const deps:IntegrationTickDependencies={env,config:fixedSettings(),database:async()=>{opens++;return db;},runTick:async()=>{runs++;return {status:'completed'};}};
 for(const now of [()=>new Date('2026-10-26T12:00:00Z'),()=>new Date('2026-10-26T17:56:00Z')])assert.equal((await handleIntegrationTick(request(),{...deps,now})).status,200);
 assert.equal(runs,2);assert.equal(opens,2);assert.equal(queries,4);
 const generic={scheduler:{provider:'qstash' as const,mode:'external' as const,authorized:true,cadence_seconds:120}};
 await handleIntegrationTick(request(),{...deps,config:generic,now:idle});assert.equal(runs,3);
 const duplicate=await handleIntegrationTick(request(),{...deps,now:()=>new Date('2026-10-26T12:00:00Z'),database:async()=>({...db,query:async()=>[]})});assert.deepEqual(await duplicate.json(),{result:{status:'duplicate'}});assert.equal(runs,3);
});
