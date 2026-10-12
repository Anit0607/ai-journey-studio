import test from "node:test";
import assert from "node:assert/strict";
import {CAPSULE,configReady,hash,type Pricing,type RuntimeConfig} from "../lib/domain";
import {hostedEnvironment,hostedOwnerReady,hostedReady,hostedCronReady,hostedBlockers,type HostedEnvironment} from "../lib/hosted";
import {liveReady} from "../lib/providers";

const pricing:Pricing={model:"isolated-hosted-fixture",pricing_version:"test-only",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const fixture=():RuntimeConfig=>({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing,
  hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,cron_authorized:true,fluid_compute_verified:true}});
// All values are isolated fixtures. These tests neither inspect process.env nor
// connect to a database, call a provider, provision credentials, or deploy.
const environment=():HostedEnvironment=>({VERCEL:"1",VERCEL_ENV:"production",STUDIO_HOSTED_ENABLED:"1",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL:"postgresql://fixture.invalid/studio",STUDIO_ORIGIN:"https://studio.example.test",STUDIO_ACCESS_TOKEN:"isolated-owner-token-"+"a".repeat(32),CRON_SECRET:"isolated-cron-token-"+"b".repeat(32),OPENAI_API_KEY:"isolated-nonfunctional-provider-fixture"});

test("hosted runtime is disabled by default and cannot inherit local session authorization",()=>{
  const env=environment(),config=fixture();
  assert.equal(hostedEnvironment(env),true);
  assert.equal(hostedOwnerReady({},env),false);
  assert.equal(hostedReady({...config,hosted:undefined},env),false);
  assert.equal(liveReady({...config,hosted:undefined},{...env,STUDIO_SESSION_ONLY:"1"}),false);
  assert.equal(hostedReady(config,{...env,STUDIO_HOSTED_ENABLED:undefined}),false);
  assert.equal(hostedReady(config,{...env,STUDIO_HOSTED_ENABLED:"0",STUDIO_SESSION_ONLY:"1"}),false);
});

test("fully approved production runtime is ready without local session authorization",()=>{
  const env=environment(),config=fixture();
  assert.deepEqual(hostedBlockers(config,env),[]);
  assert.equal(hostedOwnerReady(config,env),true);
  assert.equal(hostedReady(config,env),true);
  assert.equal(hostedCronReady(config,env),true);
  assert.equal(liveReady(config,{...env,STUDIO_SESSION_ONLY:"0"}),true);
  assert.equal(hostedReady(config,{...env,OPENAI_API_KEY:undefined}),true);
  assert.equal(liveReady(config,{...env,OPENAI_API_KEY:undefined}),false);
});

test("preview, development, missing and malformed deployment markers fail closed",()=>{
  const config=fixture(),env=environment();
  for(const patch of [{VERCEL_ENV:"preview"},{VERCEL_ENV:"development"},{VERCEL_ENV:"production-preview"},{VERCEL_ENV:undefined},{VERCEL:"0"},{VERCEL:"true"},{VERCEL:""},{VERCEL:undefined}]){
    const candidate={...env,...patch,STUDIO_SESSION_ONLY:"1"};
    assert.equal(hostedOwnerReady(config,candidate),false,JSON.stringify(patch));
    assert.equal(hostedReady(config,candidate),false,JSON.stringify(patch));
    assert.equal(hostedCronReady(config,candidate),false,JSON.stringify(patch));
    assert.equal(liveReady(config,candidate),false,JSON.stringify(patch));
  }
  for(const marker of ["VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV"]){
    const partial={STUDIO_SESSION_ONLY:"1",OPENAI_API_KEY:"isolated-fixture",[marker]:""};
    assert.equal(hostedEnvironment(partial),true);
    assert.equal(liveReady(config,partial),false);
  }
});

test("every hosted approval is an explicit true boolean",()=>{
  const env=environment(),config=fixture();
  for(const field of ["enabled","persistent_key_authorized","owner_auth_authorized","fluid_compute_verified"] as const){
    for(const value of [undefined,false,"true",1]){
      const candidate={...config,hosted:{...config.hosted,[field]:value}} as RuntimeConfig;
      assert.equal(hostedReady(candidate,env),false,field+"="+value);
      assert.equal(liveReady(candidate,{...env,STUDIO_SESSION_ONLY:"1"}),false,field+"="+value);
    }
  }
  for(const value of [undefined,false,"true",1]){
    const candidate={...config,hosted:{...config.hosted,cron_authorized:value}} as RuntimeConfig;
    assert.equal(hostedCronReady(candidate,env),false);
    // Owner-triggered work does not silently grant or depend on cron approval.
    assert.equal(hostedReady(candidate,env),true);
  }
});

test("owner setup inspection does not need provider, pricing, persistent-key, Fluid Compute or cron approval",()=>{
  const config:RuntimeConfig={hosted:{enabled:true,owner_auth_authorized:true}};
  const env={...environment(),OPENAI_API_KEY:undefined,CRON_SECRET:undefined};
  assert.equal(hostedOwnerReady(config,env),true);
  assert.equal(hostedReady(config,env),false);
  assert.equal(hostedCronReady(config,env),false);
  assert.equal(liveReady(config,env),false);
  assert.equal(hostedOwnerReady({...config,hosted:{enabled:true}},env),false);
});

test("network PostgreSQL must be explicitly authorized and embedded or socket paths are rejected",()=>{
  const config=fixture(),env=environment();
  for(const patch of [{STUDIO_DATABASE_AUTHORIZED:undefined},{STUDIO_DATABASE_AUTHORIZED:"true"},{DATABASE_URL:undefined},{STUDIO_LOCAL_DB:"1"}]){
    assert.equal(hostedOwnerReady(config,{...env,...patch}),false);
    assert.equal(hostedReady(config,{...env,...patch}),false);
  }
  for(const DATABASE_URL of ["data/local-db","file:///tmp/db","pglite://fixture/db","https://fixture.invalid/db","postgresql:///db","postgresql://%2Ftmp/db","postgresql://fixture.invalid/db?host=/tmp","postgresql://fixture.invalid/db?host=%252Ftmp","postgresql://fixture.invalid/db?host=remote.invalid&host=/tmp","postgresql://fixture.invalid/db?host="]){
    assert.equal(hostedReady(config,{...env,DATABASE_URL}),false,DATABASE_URL);
  }
  for(const DATABASE_URL of ["postgres://fixture.invalid/studio","postgresql://fixture.invalid/studio?sslmode=require","postgresql://fixture.invalid/studio?host=remote.invalid"]){
    assert.equal(hostedReady(config,{...env,DATABASE_URL}),true);
  }
});

test("hosted owner and cron credentials must be strong and distinct",()=>{
  const config=fixture(),env=environment();
  for(const value of [undefined,"","x".repeat(31)," ".repeat(32),"x".repeat(32)+"\n"]){
    assert.equal(hostedOwnerReady(config,{...env,STUDIO_ACCESS_TOKEN:value}),false);
    assert.equal(hostedReady(config,{...env,STUDIO_ACCESS_TOKEN:value}),false);
    assert.equal(hostedReady(config,{...env,CRON_SECRET:value}),false);
  }
  assert.equal(hostedReady(config,{...env,STUDIO_ACCESS_TOKEN:"a".repeat(32),CRON_SECRET:"b".repeat(32)}),true);
  assert.equal(hostedOwnerReady(config,{...env,CRON_SECRET:env.STUDIO_ACCESS_TOKEN}),false);
  assert.equal(hostedReady(config,{...env,CRON_SECRET:env.STUDIO_ACCESS_TOKEN}),false);
});

test("hosted origin is an exact canonical HTTPS origin",()=>{
  const config=fixture(),env=environment();
  for(const STUDIO_ORIGIN of [undefined,"","not-a-url","http://studio.example.test","https://studio.example.test/","https://studio.example.test/path","https://studio.example.test?query=yes","https://studio.example.test#fragment","https://user:pass@studio.example.test"," https://studio.example.test","https://studio.example.test\n","https://STUDIO.example.test","https://studio.example.test:443","https://studio.example.test/.."]){
    assert.equal(hostedOwnerReady(config,{...env,STUDIO_ORIGIN}),false,String(STUDIO_ORIGIN));
  }
  assert.equal(hostedOwnerReady(config,{...env,STUDIO_ORIGIN:"https://studio.example.test:8443"}),true);
});

test("hosted execution requires owner-cleared sources even when legacy consent is valid",()=>{
  const config={...fixture(),owner_cleared_sources_authorized:undefined,source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true};
  assert.equal(configReady(config),true);
  assert.equal(hostedReady(config,environment()),false);
  assert.equal(hostedOwnerReady(config,environment()),true);
});

test("hosted execution blocks fallback and all existing configuration failures",()=>{
  const config=fixture(),env=environment();
  for(const fallback_authorized of [true,"true","false",1,null])assert.equal(hostedReady({...config,fallback_authorized,gemini:pricing} as RuntimeConfig,env),false);
  assert.equal(hostedReady({...config,fallback_authorized:undefined},env),true);
  for(const patch of [{credential_use_authorized:false},{security_tests_passed:false},{pricing_verified_date:"2000-01-01"},{openai:undefined}]){
    assert.equal(hostedReady({...config,...patch},env),false);
    assert.equal(hostedOwnerReady({...config,...patch},env),true);
  }
});

test("blocker messages never contain supplied secret or environment values",()=>{
  const env={...environment(),DATABASE_URL:"secret-database-value",STUDIO_ACCESS_TOKEN:"secret-owner-value",CRON_SECRET:"secret-cron-value",STUDIO_ORIGIN:"secret-origin-value",OPENAI_API_KEY:"secret-provider-value"};
  const blockers=hostedBlockers({},env);
  assert.ok(blockers.length>0);
  for(const key of ["DATABASE_URL","STUDIO_ACCESS_TOKEN","CRON_SECRET","STUDIO_ORIGIN","OPENAI_API_KEY"])assert.equal(JSON.stringify(blockers).includes(env[key as keyof typeof env]!),false);
});

test("local live readiness preserves the original session, configuration and key gates",()=>{
  const config=fixture(),env={STUDIO_SESSION_ONLY:"1",OPENAI_API_KEY:"isolated-local-key"};
  assert.equal(hostedEnvironment(env),false);
  assert.equal(liveReady({...config,hosted:undefined},env),true);
  assert.equal(liveReady({...config,hosted:{enabled:false}},env),true);
  assert.equal(liveReady(config,{...env,STUDIO_SESSION_ONLY:"0"}),false);
  assert.equal(liveReady(config,{...env,STUDIO_SESSION_ONLY:undefined}),false);
  assert.equal(liveReady(config,{...env,OPENAI_API_KEY:undefined}),false);
  assert.equal(liveReady({...config,security_tests_passed:false},env),false);
});

const reviewed=(patch:Partial<RuntimeConfig>={}):RuntimeConfig=>({...fixture(),pricing_verified_date:"2026-10-10",...patch});
const at=(value:string)=>new Date(value);

test("unapproved pricing windows preserve today's exact-date gate",()=>{
  assert.equal(configReady(reviewed(),at("2026-10-10T23:59:59.999Z")),true);
  assert.equal(configReady(reviewed(),at("2026-10-11T00:00:00.000Z")),false);
  for(const pricing_window_authorized of [undefined,false,"true",1]){
    const config=reviewed({pricing_valid_until:"2026-10-16",pricing_window_authorized} as Partial<RuntimeConfig>);
    assert.equal(configReady(config,at("2026-10-10T12:00:00Z")),true);
    assert.equal(configReady(config,at("2026-10-11T12:00:00Z")),false);
  }
});

test("approved pricing windows include at most seven complete UTC calendar days",()=>{
  const config=reviewed({pricing_window_authorized:true,pricing_valid_until:"2026-10-16"});
  assert.equal(configReady(config,at("2026-10-09T23:59:59.999Z")),false);
  assert.equal(configReady(config,at("2026-10-10T00:00:00.000Z")),true);
  assert.equal(configReady(config,at("2026-10-16T23:59:59.999Z")),true);
  assert.equal(configReady(config,at("2026-10-17T00:00:00.000Z")),false);
  assert.equal(configReady({...config,pricing_valid_until:"2026-10-17"},at("2026-10-10T12:00:00Z")),false);
  assert.equal(configReady({...config,pricing_valid_until:"2026-10-10"},at("2026-10-10T23:59:59Z")),true);
  assert.equal(configReady({...config,pricing_valid_until:"2026-10-10"},at("2026-10-11T00:00:00Z")),false);
});

test("pricing dates reject invalid, future, backward, expired and unbounded windows",()=>{
  const date=at("2026-10-12T12:00:00Z");
  for(const pricing_valid_until of [undefined,"","2026-10-09","2026-10-11","2026-10-17","2027-01-01","2026-02-30","2026-13-12","2026-10-16T00:00:00Z","2026-1-16"]){
    assert.equal(configReady(reviewed({pricing_window_authorized:true,pricing_valid_until}),date),false,String(pricing_valid_until));
  }
  for(const pricing_verified_date of [undefined,"","2026-10-13","2026-02-30","2026-10-32","2026-10-10T00:00:00Z","2026-1-10"]){
    assert.equal(configReady(reviewed({pricing_window_authorized:true,pricing_verified_date,pricing_valid_until:"2026-10-16"}),date),false,String(pricing_verified_date));
  }
  assert.equal(configReady(reviewed(),new Date("invalid")),false);
  assert.equal(configReady(reviewed({pricing_verified_date:"2026-10-13"}),date),false);
});

test("pricing windows use UTC day boundaries across months, leap days and years",()=>{
  for(const [pricing_verified_date,pricing_valid_until,inside,outside] of [
    ["2026-10-29","2026-11-04","2026-11-04T23:59:59Z","2026-11-05T00:00:00Z"],
    ["2028-02-27","2028-03-04","2028-02-29T12:00:00Z","2028-03-05T00:00:00Z"],
    ["2026-12-29","2027-01-04","2027-01-04T23:59:59Z","2027-01-05T00:00:00Z"]
  ]){
    const config=reviewed({pricing_window_authorized:true,pricing_verified_date,pricing_valid_until});
    assert.equal(configReady(config,at(inside)),true);
    assert.equal(configReady(config,at(outside)),false);
  }
  const config=reviewed({pricing_window_authorized:true,pricing_valid_until:"2026-10-16"});
  assert.equal(configReady(config,at("2026-10-17T05:29:59+05:30")),true);
  assert.equal(configReady(config,at("2026-10-17T05:30:00+05:30")),false);
});
