import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {verifyQStashSchedulerRequest,qstashSafeResult,qstashSchedulerStatus,legacySchedulerSelected,claimQStashDelivery,completeQStashDelivery,type QStashRequestOptions} from "../lib/qstash-scheduler";
import {handleHostedCron} from "../lib/hosted-http";
import {embedded,type Database} from "../lib/db";
import {QSTASH_SCHEDULER_SCHEMA} from "../lib/qstash-scheduler-schema";
import type {RuntimeConfig} from "../lib/domain";
const ORIGIN="https://studio.example.test",TICK="/api/integrations/tick",CRON="/api/cron";
// Isolated signing fixtures only. These are not real provider keys or tokens.
const CURRENT="fixture-current-"+"a".repeat(40),NEXT="fixture-next-"+"b".repeat(40),OTHER="fixture-other-"+"c".repeat(40);
const env=()=>({STUDIO_ORIGIN:ORIGIN,QSTASH_CURRENT_SIGNING_KEY:CURRENT,QSTASH_NEXT_SIGNING_KEY:NEXT});
const options=(path=TICK):QStashRequestOptions=>({scheduler:{provider:"qstash",authorized:true,mode:"external",cadence_seconds:300},env:env(),path});
function jwt(body="{}",path=TICK,key=CURRENT,patch:Record<string,unknown>={},header:Record<string,unknown>={alg:"HS256",typ:"JWT"}){
 const now=Math.floor(Date.now()/1000),claims={iss:"Upstash",sub:ORIGIN+path,nbf:now-5,iat:now-5,exp:now+120,jti:"jwt_isolated_delivery",body:createHash("sha256").update(body).digest("base64url"),...patch};
 const input=[header,claims].map(value=>Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");return input+"."+createHmac("sha256",key).update(input).digest("base64url");
}
function request(body="{}",path=TICK,signature=jwt(body,path),headers:Record<string,string>={}){return new Request(ORIGIN+path,{method:"POST",headers:{"content-type":"application/json","upstash-signature":signature,...headers},body});}

test("QStash official SDK accepts current and next keys without any network calls",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("No provider calls allowed");};
 try{for(const key of [CURRENT,NEXT]){const result=await verifyQStashSchedulerRequest(request("{}\n",TICK,jwt("{}\n",TICK,key)),options());assert.deepEqual(result,{ok:true,delivery_id:"jwt_isolated_delivery",destination:ORIGIN+TICK});}assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

test("signature authenticates exact raw body and endpoint, not reserialized JSON or forwarded host",async()=>{
 for(const req of [request("{ }",TICK,jwt("{}")),request("{}",TICK,jwt("{}",CRON)),request("{}",TICK+"?maxSteps=100",jwt()),request("{}",TICK,jwt(),{host:"attacker.example.test"})])assert.equal((await verifyQStashSchedulerRequest(req,options())).ok,false);
 const good=request("{}",TICK,jwt(),{"x-forwarded-host":"attacker.example.test","upstash-message-id":"spoofed-header-value"});const result=await verifyQStashSchedulerRequest(good,options());assert.equal(result.ok,true);if(result.ok)assert.equal(result.delivery_id,"jwt_isolated_delivery");
});

test("signature fails closed for bad issuer, algorithm, keys, temporal claims, required claims and malformed tokens",async()=>{
 const now=Math.floor(Date.now()/1000);
 const signatures=["", "abc.def.ghi",jwt("{}",TICK,OTHER),jwt("{}",TICK,CURRENT,{iss:"someone-else"}),jwt("{}",TICK,CURRENT,{exp:now-1}),jwt("{}",TICK,CURRENT,{nbf:now+60}),jwt("{}",TICK,CURRENT,{exp:undefined}),jwt("{}",TICK,CURRENT,{nbf:undefined}),jwt("{}",TICK,CURRENT,{iat:undefined}),jwt("{}",TICK,CURRENT,{jti:undefined}),jwt("{}",TICK,CURRENT,{body:undefined}),jwt("{}",TICK,CURRENT,{}, {alg:"none"}),jwt("{}",TICK,CURRENT,{}, {alg:"HS512"})];
 for(const signature of signatures){const result=await verifyQStashSchedulerRequest(request("{}",TICK,signature),options());assert.equal(result.ok,false);if(!result.ok)assert.equal(result.status,401);}
});

test("scheduler transport, explicit authorization, both keys and canonical origin are mandatory",async()=>{
 const cases:QStashRequestOptions[]=[{...options(),scheduler:{}},{...options(),scheduler:{provider:"external-bearer",authorized:true,mode:"external"}},{...options(),scheduler:{provider:"qstash",authorized:false,mode:"external"}},{...options(),env:{...env(),QSTASH_NEXT_SIGNING_KEY:""}},{...options(),env:{...env(),QSTASH_CURRENT_SIGNING_KEY:"short"}},{...options(),env:{...env(),STUDIO_ORIGIN:"http://studio.example.test"}},{...options(),env:{...env(),STUDIO_ORIGIN:ORIGIN+"/"}},{...options(),env:{...env(),CRON_SECRET:CURRENT}}];
 for(const config of cases){const result=await verifyQStashSchedulerRequest(request(),config);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.status,503);}
 assert.equal(legacySchedulerSelected(undefined),true);assert.equal(legacySchedulerSelected({provider:"external-bearer"}),true);assert.equal(legacySchedulerSelected({provider:"qstash"}),false);
 assert.equal((await verifyQStashSchedulerRequest(new Request(ORIGIN+TICK),options())).ok,false);
 const state=qstashSchedulerStatus(options().scheduler,env());assert.equal(state.provisioned,false);assert.equal(state.live_delivery_verified,false);assert(!JSON.stringify(state).includes(CURRENT));
});

test("signed wakeups reject payload instructions, oversize streams, encoding and invalid UTF-8",async()=>{
 for(const body of ['{"maxSteps":100}', '{"source":"PRIVATE_CONTENT"}', '[]', 'null', '"{}"', ''])assert.equal((await verifyQStashSchedulerRequest(request(body),options())).ok,false);
 const oversize=await verifyQStashSchedulerRequest(request(" ".repeat(1025)),options());assert.equal(oversize.ok,false);if(!oversize.ok)assert.equal(oversize.status,413);
 assert.equal((await verifyQStashSchedulerRequest(request("{}",TICK,jwt(),{"content-encoding":"gzip"}),options())).ok,false);
 assert.equal((await verifyQStashSchedulerRequest(request("{}",TICK,jwt(),{"content-type":"text/plain"}),options())).ok,false);
 const malformed=new Request(ORIGIN+TICK,{method:"POST",body:new Uint8Array([0xc0,0x80]),headers:{"content-type":"application/json","upstash-signature":jwt()}});assert.equal((await verifyQStashSchedulerRequest(malformed,options())).ok,false);
});

test("QStash result receipts contain only fixed status and aggregate counts",()=>{
 const privateData={status:"completed",sources:{status:"synced",providers:[{provider:"github",staged:2,duplicates:3,rejected:1,scope:"PRIVATE_REPOSITORY",raw:"PRIVATE_SOURCE"}]},publishing:{status:"published",id:"PRIVATE_TASK_ID",receipt:{provider_id:"PRIVATE_ACCOUNT",url:"https://private.test"}},token:CURRENT};
 assert.deepEqual(qstashSafeResult(privateData,"integration"),{status:"completed",sources:{status:"synced",providers_checked:1,staged:2,duplicates:3,rejected:1},publishing:{status:"published",published:1}});
 assert.deepEqual(qstashSafeResult({status:"idle",steps:3,reason:"PRIVATE_REASON",day:"2026-10-15"},"generation"),{status:"idle",steps:3});
 assert.equal(qstashSafeResult({status:"PRIVATE_STATUS"},"generation").status,"unknown");
});

const owner="fixture-owner-"+"o".repeat(40),cron="fixture-cron-"+"c".repeat(40);
const hostedEnv=()=>({...env(),VERCEL:"1",VERCEL_ENV:"production",STUDIO_HOSTED_ENABLED:"1",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL:"postgresql://fixture.invalid/studio",STUDIO_ACCESS_TOKEN:owner,STUDIO_AUTH_SECRET:"fixture-auth-"+"z".repeat(40),CRON_SECRET:cron,OPENAI_API_KEY:"isolated-provider-fixture"});
const hostedConfig=():RuntimeConfig=>({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-model",pricing_version:"test",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"},hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,cron_authorized:true,fluid_compute_verified:true}});

test("signed daily route rejects invalid delivery before runtime config or database inspection",async()=>{
 let reads=0,opens=0;
 const result=await handleHostedCron(request("{}",CRON,"invalid.signature.value"),{env:hostedEnv(),readIntegrationConfig:()=>({scheduler:options().scheduler}),readConfig:()=>{reads++;return hostedConfig();},database:async()=>{opens++;throw Error("No database expected");}});
 assert.equal(result.status,401);assert.equal(reads,0);assert.equal(opens,0);assert.equal(result.headers.get("cache-control"),"no-store");
});

test("signed daily route preserves existing runtime and batch gates and returns a sanitized receipt",async()=>{
 let calls=0;const result=await handleHostedCron(request("{ }\n",CRON),{env:hostedEnv(),readIntegrationConfig:()=>({scheduler:options().scheduler}),readConfig:hostedConfig,database:async()=>({kind:"postgres",query:async(sql:string)=>sql.startsWith("INSERT")?[{signed_jti:"fixture"}]:[]} as unknown as Database),runBatch:async(_store,config,opts)=>{calls++;assert.equal(await opts!.isReady!(config,new Date()),true);assert.equal(opts!.signal instanceof AbortSignal,true);assert.equal("maxSteps" in opts!,false);return {status:"idle",steps:2,day:"2026-10-15",reason:"runtime_not_ready"};}});
 assert.equal(result.status,200);assert.equal(calls,1);assert.deepEqual(await result.json(),{result:{status:"idle",steps:2}});
 for(const environment of [{...hostedEnv(),VERCEL_ENV:"preview"},{...hostedEnv(),OPENAI_API_KEY:undefined},{...hostedEnv(),CRON_SECRET:undefined}]){let opened=0;const denied=await handleHostedCron(request("{}",CRON),{env:environment,readIntegrationConfig:()=>({scheduler:options().scheduler}),readConfig:hostedConfig,database:async()=>{opened++;throw Error("No database expected");}});assert.equal(denied.status,503);assert.equal(opened,0);}
});

test("QStash selection does not authorize legacy bearer transport and cannot leak runtime errors",async()=>{
 let calls=0;const deps={env:hostedEnv(),readIntegrationConfig:()=>({scheduler:options().scheduler}),readConfig:hostedConfig,database:async()=>{calls++;throw Error("PRIVATE_CONNECTION_DETAIL");}};
 const bearer=new Request(ORIGIN+CRON,{headers:{authorization:"Bearer "+cron}});assert.equal((await handleHostedCron(bearer,deps)).status,503);assert.equal(calls,0);
 const signed=await handleHostedCron(request("{}",CRON),deps);assert.equal(signed.status,503);assert.equal(calls,1);assert(!await signed.text().then(text=>text.includes("PRIVATE_CONNECTION_DETAIL")));
});


test("durable signed endpoint/jti claims reject concurrent and completed replays but namespace routes",async()=>{
 const db=await embedded();try{
  for(const sql of QSTASH_SCHEDULER_SCHEMA.split(";").filter(sql=>sql.trim()))await db.query(sql);
  const tick=await verifyQStashSchedulerRequest(request(),options()),daily=await verifyQStashSchedulerRequest(request("{}",CRON),options(CRON));assert(tick.ok);assert(daily.ok);
  const concurrent=await Promise.all([claimQStashDelivery(db,tick),claimQStashDelivery(db,tick)]);assert.deepEqual(concurrent.sort(),[false,true]);
  await completeQStashDelivery(db,tick,"completed");assert.equal(await claimQStashDelivery(db,tick),false);
  assert.equal(await claimQStashDelivery(db,daily),true);assert.equal(await claimQStashDelivery(db,daily),false);
  const rows=await db.query<{outcome:string}>("SELECT outcome FROM qstash_deliveries ORDER BY destination");assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.outcome).sort(),["claimed","completed"]);
 }finally{await db.close();}
});

test("completed signed daily delivery returns duplicate without invoking batch again",async()=>{
 const db=await embedded();try{
  for(const sql of QSTASH_SCHEDULER_SCHEMA.split(";").filter(sql=>sql.trim()))await db.query(sql);
  let calls=0;const deps={env:hostedEnv(),readIntegrationConfig:()=>({scheduler:options().scheduler}),readConfig:hostedConfig,database:async()=>db,runBatch:async()=>{calls++;return {status:"idle" as const,steps:2,day:"2026-10-15"};}};
  const first=await handleHostedCron(request("{}",CRON),deps);assert.equal(first.status,200);assert.equal(calls,1);
  const replay=await handleHostedCron(request("{}",CRON),deps);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{result:{status:"duplicate",steps:0}});assert.equal(calls,1);
 }finally{await db.close();}
});
