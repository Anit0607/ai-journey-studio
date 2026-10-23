import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {allowedOrigin,response} from "../lib/auth";
import {validOwnerDraftRequest,ownerDraftConfigHash} from "../lib/owner-draft";
import {embedded,type Database} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {POST as studioPost,GET as studioGet} from "../app/api/studio/[action]/route";
import {SourceIntake} from "../lib/sources";
import {Store} from "../lib/store";
import {handleHostedCron} from "../lib/hosted-http";
import type {RuntimeConfig} from "../lib/domain";

const origin="https://studio.example.test";
const body=()=>({task_id:randomUUID(),expected_source_id:randomUUID(),expected_source_hash:"a".repeat(64),expected_clearance_id:randomUUID(),expected_updated:new Date().toISOString(),expected_checkpoint:0,expected_config_hash:"b".repeat(64),acknowledged:true});
function harness(){
  const calls={password:0,bearer:0,db:0,run:[] as Array<{input:unknown;options:any}>};
  const flags={authenticated:true,status:"review",steps:6};
  const fakeDb={kind:"postgres"};
  const config={owner_cleared_sources_authorized:true};
  const modules:Record<string,unknown>={
    "../../../../lib/owner-draft":{validOwnerDraftRequest,runOwnerDraft:async(db:unknown,input:unknown,options:unknown)=>{assert.equal(db,fakeDb);calls.run.push({input,options});return {task_id:(input as any).task_id,status:flags.status,steps:flags.steps};}},
    "../../../../lib/owner-password":{passwordOwnerAuthenticated:async()=>{calls.password++;return flags.authenticated;},ownerApiAuthenticated:async()=>{calls.bearer++;return true;}},
    "../../../../lib/auth":{allowedOrigin:(request:Request)=>allowedOrigin(request,origin),response},
    "../../../../lib/db":{database:async()=>{calls.db++;return fakeDb;}},
    "../../../../lib/store":{Store:class {constructor(readonly db:unknown){}}},
    "../../../../lib/config":{runtimeConfig:()=>config},
    "../../../../lib/hosted":{hostedEnvironment:()=>true},
    "../../../../lib/owner-reports":{REPORT_ERRORS:[]},
    "../../../../lib/source-ingestion":{safeIngestionError:()=>null},
    "../../../../lib/publication-media":{safeMediaError:()=>null},
    "../../../../lib/publishing":{safePublicationError:()=>null},
    "../../../../lib/calendar-recovery":{safeCalendarRecoveryError:()=>null},
  };
  const source=readFileSync(new URL("../app/api/studio/[action]/route.ts",import.meta.url),"utf8"),exports:Record<string,any>={};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,require:(id:string)=>modules[id]||{},Request,Response,URL,Buffer,process:{env:{}}});
  const invoke=(payload:unknown=body(),from=origin,headers:Record<string,string>={})=>exports.POST(new Request(origin+"/api/studio/owner-draft-run",{method:"POST",headers:{Origin:from,"Content-Type":"application/json",...headers},body:typeof payload==="string"?payload:JSON.stringify(payload)}),{params:Promise.resolve({action:"owner-draft-run"})});
  return {calls,flags,invoke,exports,config};
}

test("owner-draft route requires password owner authentication, never accepts the general worker bearer guard",async()=>{
  const h=harness();h.flags.authenticated=false;
  const result=await h.invoke(body(),origin,{Authorization:"Bearer local-worker-token"});
  assert.equal(result.status,401);assert.equal(h.calls.password,1);assert.equal(h.calls.bearer,0);assert.equal(h.calls.db,0);assert.equal(h.calls.run.length,0);
});
test("owner-draft route rejects cross-origin input before any database or runner action",async()=>{
  const h=harness();const result=await h.invoke(body(),"https://other.example.test");
  assert.equal(result.status,403);assert.equal(h.calls.db,0);assert.equal(h.calls.run.length,0);
  const host=await h.invoke(body(),origin,{Host:"other.example.test"});assert.equal(host.status,403);assert.equal(h.calls.db,0);
});
test("owner-draft route validates every exact acknowledgement and rejects extra or malformed fields",async()=>{
  const h=harness();
  for(const input of [{...body(),acknowledged:false},{...body(),expected_checkpoint:1},{...body(),extra:"no queue sweep"},{...body(),expected_clearance_id:"bad"},[],null]){
    const result=await h.invoke(input);assert.equal(result.status,400);assert.equal(h.calls.run.length,0);
  }
  assert.equal((await h.invoke("{invalid-json")).status,400);assert.equal(h.calls.run.length,0);
  assert.equal((await h.invoke(body(),origin,{"Content-Length":"4097"})).status,413);
  assert.equal((await h.invoke("x".repeat(4097))).status,400);assert.equal(h.calls.run.length,0);
});
test("owner-draft route forwards exact bindings and request abort signal; successful draft is not publication",async()=>{
  const h=harness(),input=body(),result=await h.invoke(input);
  assert.equal(result.status,200);assert.equal(h.calls.run.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.run[0].input)),input);
  assert.deepEqual(h.calls.run[0].options.readConfig(),h.config);assert.ok(h.calls.run[0].options.signal);
  assert.equal(result.headers.get("Cache-Control"),"no-store");assert.equal(result.headers.get("X-Content-Type-Options"),"nosniff");
  assert.equal((await result.json()).result.status,"review");assert.equal(h.exports.maxDuration,300);
});
test("owner-draft route returns explicit safe conflicts for duplicate, stopped and unknown outcomes",async()=>{
  for(const status of ["duplicate","blocked","uncertain"]){
    const h=harness();h.flags.status=status;h.flags.steps=0;const result=await h.invoke();assert.equal(result.status,409);
    const value=await result.json();assert.equal(value.result.status,status);assert.match(value.error,/do not retry|no automatic retry/i);assert.equal(h.calls.run.length,1);
  }
});

test("original hosted step remains forbidden before body parsing or queue access",async()=>{
 const h=harness();
 const result=await h.exports.POST(new Request(origin+"/api/studio/step",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:"{malformed"}),{params:Promise.resolve({action:"step"})});
 assert.equal(result.status,403);assert.match((await result.json()).error,/only through the protected daily scheduler/);
 assert.equal(h.calls.bearer,1);assert.equal(h.calls.password,0);assert.equal(h.calls.db,0);assert.equal(h.calls.run.length,0);
});

test("real password-cookie route rejects worker bearer, wrong Origin, malformed body and revoked owner sessions without execution",async()=>{
 const db=await embedded(),globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>};
 const previousDb=globals.studioDb,previousEnv={...process.env},originalFetch=globalThis.fetch;
 const localOrigin="http://127.0.0.1:3198",password="6728194035";
 const env={STUDIO_ORIGIN:localOrigin,STUDIO_AUTH_SECRET:"isolated-owner-draft-auth-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-owner-draft-worker-"+"y".repeat(40),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:"{}",OPENAI_API_KEY:"",GEMINI_API_KEY:"",STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:"",STUDIO_PASSWORD_AUTH_ENABLED:"1"};
 for(const key of ["VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV","CRON_SECRET"])delete process.env[key];
 Object.assign(process.env,env);globals.studioDb=Promise.resolve(db);let transmissions=0;
 globalThis.fetch=async()=>{transmissions++;throw Error("No outbound requests are allowed in owner-draft route tests");};
 try{
  const intake=new SourceIntake(db),staged=await intake.stage({text:"I checked the exact source used for an isolated route test.",category:"build-log",reported_date:new Date().toISOString().slice(0,10)});
  const source=await intake.clear(staged.id,staged.hash,true),task=await new Store(db).enqueue(source.id),originalTasks=await db.query("SELECT * FROM tasks ORDER BY id");
  const input={task_id:task.id,expected_source_id:source.id,expected_source_hash:source.hash,expected_clearance_id:source.clearance_id,expected_updated:new Date(task.updated).toISOString(),expected_checkpoint:0,expected_config_hash:ownerDraftConfigHash({}),acknowledged:true};
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(localOrigin+"/api/auth/login",{method:"POST",headers:{Origin:localOrigin,"Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");assert.ok(cookie);
  const call=(payload:unknown=input,session=cookie,from=localOrigin,headers:Record<string,string>={})=>studioPost(new Request(localOrigin+"/api/studio/owner-draft-run",{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json",...headers},body:typeof payload==="string"?payload:JSON.stringify(payload)}),{params:Promise.resolve({action:"owner-draft-run"})});
  assert.equal((await call(input,"")).status,401);
  assert.equal((await call(input,"",localOrigin,{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN})).status,401);
  assert.equal((await call(input,"not-an-owner-cookie",localOrigin,{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN})).status,401);
  assert.equal((await call(input,cookie,"https://other.example.test")).status,403);assert.equal((await call(input,cookie,"")).status,403);
  assert.equal((await call(input,cookie,localOrigin,{Host:"other.example.test"})).status,401);
  assert.equal((await studioGet(new Request(localOrigin+"/api/studio/owner-draft-run",{headers:{Cookie:cookie}}),{params:Promise.resolve({action:"owner-draft-run"})})).status,404);
  for(const payload of [null,[],{},"{invalid-json",{...input,acknowledged:false},{...input,acknowledged:"true"},{...input,expected_checkpoint:1},{...input,runtime:{enabled:true}},{...input,provider:"gemini"},{...input,task_id:"invalid"}])assert.equal((await call(payload)).status,400);
  for(const key of Object.keys(input)){const missing={...input} as Record<string,unknown>;delete missing[key];assert.equal((await call(missing)).status,400);}
  assert.equal((await call(input,cookie,localOrigin,{"Content-Length":"4097"})).status,413);
  assert.equal((await call("x".repeat(4097))).status,400);
  const blocked=await call();assert.equal(blocked.status,409);assert.equal((await blocked.json()).result.status,"blocked","Owner cookie authorizes the route, not local/runtime bypass");
  assert.deepEqual(await db.query("SELECT * FROM tasks ORDER BY id"),originalTasks);
  for(const table of ["outputs","ledger","approvals","publishing_outbox","hosted_batches","calendar_entries"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table+" must remain untouched");
  assert.equal((await db.query("SELECT * FROM events WHERE kind LIKE 'owner_draft%'")).length,0);assert.equal(transmissions,0);
  const logout=await handleOwnerAuth(new Request(localOrigin+"/api/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:localOrigin,"Content-Type":"application/json"},body:"{}"}),"logout",env,async()=>db);assert.equal(logout.status,200);
  assert.equal((await call()).status,401);assert.equal(transmissions,0);
 }finally{
  globalThis.fetch=originalFetch;if(previousDb===undefined)delete globals.studioDb;else globals.studioDb=previousDb;
  for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);await db.close();
 }
});

test("owner draft permission does not authorize legacy cron transport or bypass cron consent",async()=>{
 const machine="isolated-owner-draft-machine-"+"m".repeat(32),cron="isolated-owner-draft-cron-"+"c".repeat(32);
 const env={VERCEL:"1",VERCEL_ENV:"production",STUDIO_HOSTED_ENABLED:"1",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL:"postgresql://fixture.invalid/studio",STUDIO_ORIGIN:origin,STUDIO_ACCESS_TOKEN:machine,STUDIO_AUTH_SECRET:"isolated-owner-draft-secret-"+"s".repeat(32),CRON_SECRET:cron,OPENAI_API_KEY:"isolated-never-used-provider-fixture"};
 const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-model",pricing_version:"isolated",pricing_tier:"standard",official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.001",output_microdollars_per_token:"0.001"},hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,fluid_compute_verified:true,cron_authorized:false}};
 let databaseCalls=0,batches=0;
 const dependencies={env,readConfig:()=>config,readIntegrationConfig:()=>({}),database:async()=>{databaseCalls++;throw Error("Cron must not open a database");},runBatch:async()=>{batches++;throw Error("Cron must not run a batch");}};
 const rejectedHeaders:Record<string,string>[]=[{},{Authorization:"Bearer "+machine},{Cookie:"better-auth.session_token=isolated-owner-cookie"}];
 for(const headers of rejectedHeaders){
  const result=await handleHostedCron(new Request(origin+"/api/cron",{headers}),dependencies);assert.equal(result.status,401);
 }
 const authorizedTransport=await handleHostedCron(new Request(origin+"/api/cron",{headers:{Authorization:"Bearer "+cron}}),dependencies);assert.equal(authorizedTransport.status,503);assert.match((await authorizedTransport.json()).error,/scheduling is not ready/);
 const post=await handleHostedCron(new Request(origin+"/api/cron",{method:"POST",headers:{Authorization:"Bearer "+cron},body:"{}"}),dependencies);assert.equal(post.status,405);
 assert.equal(databaseCalls,0);assert.equal(batches,0);
});
