import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {allowedOrigin,response} from '../lib/auth';
import {embedded} from '../lib/db';
import {provisionOwner,handleOwnerAuth,passwordOwnerAuthenticated} from '../lib/owner-password';
import {validComparisonAdoption} from '../lib/private-comparison-adoption';
import {COMPARISON_TARGET,COMPARISON_SCOPE_HASH} from '../lib/private-comparison-policy';
const origin='http://127.0.0.1:3199';
const input={task_id:COMPARISON_TARGET.task_id,run_id:'11111111-1111-1111-1111-111111111111',scope_hash:COMPARISON_SCOPE_HASH,expected_review_token:'original:'+'a'.repeat(64)};
function harness(auth:(r:Request)=>Promise<boolean>=async()=>true){
 const calls={db:0,adopt:0};let fail=false;
 const modules:Record<string,unknown>={
  '../../../../lib/auth':{allowedOrigin:(r:Request)=>allowedOrigin(r,origin),response},
  '../../../../lib/owner-password':{passwordOwnerAuthenticated:auth},
  '../../../../lib/db':{database:async()=>{calls.db++;return {}; }},
  '../../../../lib/config':{runtimeConfig:()=>({})},
  '../../../../lib/private-comparison-adoption':{validComparisonAdoption,adoptPrivateComparison:async(_db:unknown,request:unknown)=>{calls.adopt++;assert.equal(JSON.stringify(request),JSON.stringify(input));if(fail)throw Error('sensitive internal error');return {status:'adopted_requires_review'};}}
 };
 const exports:Record<string,any>={};
 const code=ts.transpileModule(readFileSync(new URL('../app/api/private-comparison/adopt/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:(id:string)=>{assert(id in modules,'Unexpected module dependency: '+id);return modules[id];},Buffer});
 const post=(body:unknown=input,from:string|undefined=origin,headers:Record<string,string>={})=>exports.POST(new Request(origin+'/api/private-comparison/adopt',{method:'POST',headers:{...(from?{Origin:from}:{}),Authorization:'Bearer offline-machine-token',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
 return {calls,post,fail:()=>{fail=true;}};
}
test('adoption requires owner session, exact same-origin and bounded strict request before DB access',async()=>{
 const denied=harness(async()=>false);assert.equal((await denied.post()).status,401);assert.equal(denied.calls.db,0);
 const h=harness();for(const origin of ['https://other.example','null',''])assert.equal((await h.post(input,origin)).status,403);
 assert.equal((await h.post(input,origin,{Host:'other.example'})).status,403);
 for(const body of ['{',{}, {...input,text:'injected manual content'},{...input,scope_hash:'x'}])assert.equal((await h.post(body)).status,400);
 assert.equal((await h.post('a'.repeat(1025))).status,413);assert.equal(h.calls.db,0);assert.equal(h.calls.adopt,0);
});
test('valid request calls review-only adoption without a paid execution gate; failures do not leak or approve',async()=>{
 const h=harness(),result=await h.post();assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(h.calls.adopt,1);assert.equal((await result.json()).result.status,'adopted_requires_review');
 h.fail();const failed=await h.post();assert.equal(failed.status,409);const body=await failed.text();assert(!body.includes('sensitive'));assert(body.includes('no approval or publication was granted'));
});
test('real owner cookie permits route, bearer alone, tampered cookie, CSRF and revoked owner session do not',async()=>{
 const db=await embedded(),env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:'isolated-adoption-route-secret-'+'a'.repeat(40)},password='6728194035';
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,Host:'127.0.0.1:3199','Content-Type':'application/json'},body:JSON.stringify({password})}),'login',env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),h=harness(r=>passwordOwnerAuthenticated(r,env,async()=>db));
  assert.equal((await h.post()).status,401);assert.equal((await h.post(input,origin,{Cookie:cookie+'tampered'})).status,401);
  assert.equal((await h.post(input,'https://other.example',{Cookie:cookie})).status,403);
  assert.equal((await h.post(input,origin,{Cookie:cookie})).status,200);assert.equal(h.calls.adopt,1);
  env.STUDIO_AUTH_SECRET+='revoked';assert.equal((await h.post(input,origin,{Cookie:cookie})).status,401);assert.equal(h.calls.adopt,1);
 }finally{await db.close();}
});
