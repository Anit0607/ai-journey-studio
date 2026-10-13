import test from "node:test";
import assert from "node:assert/strict";
import {handleHostedCron,ownerRequestReady} from "../lib/hosted-http";
import type {RuntimeConfig} from "../lib/domain";
import type {HostedEnvironment} from "../lib/hosted";
import type {Database} from "../lib/db";
const owner="isolated-owner-"+"a".repeat(32),cron="isolated-cron-"+"b".repeat(32);
const environment=():HostedEnvironment=>({VERCEL:"1",VERCEL_ENV:"production",STUDIO_HOSTED_ENABLED:"1",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL:"postgresql://fixture.invalid/studio",STUDIO_ORIGIN:"https://studio.example.test",STUDIO_ACCESS_TOKEN:owner,CRON_SECRET:cron,OPENAI_API_KEY:"isolated-provider-fixture"});
const config=():RuntimeConfig=>({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-model",pricing_version:"test",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"},hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,cron_authorized:true,fluid_compute_verified:true}});
const request=(token:string|undefined=cron,url="https://studio.example.test/api/cron",method="GET")=>new Request(url,{method,headers:token?{authorization:"Bearer "+token}:{}});

test("cron rejects missing, owner, short and query-only credentials before configuration or database access",async()=>{
  for(const input of [request(""),request(owner),request("short"),new Request("https://studio.example.test/api/cron?secret="+cron)]){
    let touched=0;
    const result=await handleHostedCron(input,{env:environment(),readConfig:()=>{touched++;return config();},database:async()=>{touched++;throw Error("No database expected");}});
    assert.equal(result.status,401);assert.equal(touched,0);assert.equal(result.headers.get("Cache-Control"),"no-store");
  }
});
test("cron rejects POST without inspecting credentials or opening a database",async()=>{
  const result=await handleHostedCron(request(cron,undefined,"POST"),{env:environment(),readConfig:()=>{throw Error("Must not read");}});assert.equal(result.status,405);
});
test("cron fails closed for preview, missing hosted permission, origin mismatch, missing key and expired pricing",async()=>{
  const cases=[{env:{...environment(),VERCEL_ENV:"preview"}},{env:{...environment(),OPENAI_API_KEY:undefined}},{env:{...environment(),STUDIO_HOSTED_ENABLED:"0"}},{c:{...config(),hosted:{...config().hosted,cron_authorized:false}}},{c:{...config(),hosted:{...config().hosted,persistent_key_authorized:false}}},{c:{...config(),pricing_verified_date:"2000-01-01"}},{req:request(cron,"https://other.example.test/api/cron")}];
  for(const item of cases){let dbCalls=0;const result=await handleHostedCron(item.req||request(),{env:item.env||environment(),readConfig:()=>item.c||config(),database:async()=>{dbCalls++;throw Error("Not expected");}});assert.equal(result.status,503);assert.equal(dbCalls,0);}
});
test("authenticated cron passes fresh readiness checks and no request-controlled limits to a bounded runner",async()=>{
  const env=environment(),c=config();let calls=0,reads=0;
  const result=await handleHostedCron(request(cron,"https://studio.example.test/api/cron?maxSteps=9000"),{env,readConfig:()=>{reads++;return c;},database:async()=>({kind:"postgres"} as Database),runBatch:async(store,current,options)=>{
    calls++;assert.equal(store.db.kind,"postgres");assert.equal(current,c);assert.equal(await options!.isReady!(c,new Date()),true);assert.equal(await options!.isReady!({...c,hosted:{...c.hosted,cron_authorized:false}},new Date()),false);assert.equal(await options!.readConfig!(),c);assert.equal((options as any).maxSteps,undefined);return {status:"idle",day:"2026-10-12",steps:0};
  }});
  assert.equal(result.status,200);assert.equal(calls,1);assert.equal(reads,2);assert.equal((await result.json()).result.status,"idle");
});
test("cron database failures return static secret-free errors",async()=>{
  const result=await handleHostedCron(request(),{env:environment(),readConfig:config,database:async()=>{throw Error("PRIVATE_CONNECTION_FIXTURE");}});assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/PRIVATE_CONNECTION_FIXTURE/);
});
test("hosted owner reads require separate owner permission and exact origin but not provider readiness",()=>{
  const env=environment(),c=config(),input=request(owner,"https://studio.example.test/api/studio/state");
  assert.equal(ownerRequestReady(input,c,env),true);
  assert.equal(ownerRequestReady(request(cron),c,env),false);
  assert.equal(ownerRequestReady(input,{...c,hosted:{...c.hosted,owner_auth_authorized:false}},env),false);
  assert.equal(ownerRequestReady(input,c,{...env,VERCEL_ENV:"preview"}),false);
  assert.equal(ownerRequestReady(request(owner,"https://other.example.test/api/studio/state"),c,env),false);
  assert.equal(ownerRequestReady(input,{...c,pricing_verified_date:"2000-01-01",hosted:{...c.hosted,persistent_key_authorized:false,cron_authorized:false}},{...env,OPENAI_API_KEY:undefined}),true);
  assert.equal(ownerRequestReady(request(owner,"http://127.0.0.1:3000/api/studio/state"),{},{STUDIO_ACCESS_TOKEN:owner}),true);
});
