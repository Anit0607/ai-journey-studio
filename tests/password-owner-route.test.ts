import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {GET,POST} from "../app/api/studio/[action]/route";

test("real studio route uses cookies, rejects tampering/CSRF, and never bypasses source clearance",async()=>{
 const db=await embedded(),origin="http://127.0.0.1:3111",password="6728194035",secret="isolated-route-auth-secret-"+"x".repeat(32);
 const globals=globalThis as typeof globalThis&{studioDb?:Promise<any>};globals.studioDb=Promise.resolve(db);
 process.env.STUDIO_ORIGIN=origin;process.env.STUDIO_AUTH_SECRET=secret;process.env.STUDIO_RUNTIME_CONFIG="{}";process.env.STUDIO_ACCESS_TOKEN="isolated-worker-token-"+"b".repeat(32);process.env.OPENAI_API_KEY="";process.env.GEMINI_API_KEY="";
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3111","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",{STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret},async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const get=(value:string)=>GET(new Request(origin+"/api/studio/state",{headers:{Cookie:value,Host:"127.0.0.1:3111"}}),{params:Promise.resolve({action:"state"})});
  assert.equal((await get(cookie)).status,200);assert.equal((await get(cookie+"corrupt")).status,401);
  const stage=(from:string)=>POST(new Request(origin+"/api/studio/source-stage",{method:"POST",headers:{Cookie:cookie,Origin:from,Host:"127.0.0.1:3111","Content-Type":"application/json"},body:JSON.stringify({text:"Isolated cookie-authentication test fixture.",category:"project-note",reported_date:"2026-10-10"})}),{params:Promise.resolve({action:"source-stage"})});
  assert.equal((await stage("https://other.example")).status,403);assert.equal((await stage(origin)).status,200);
  const source=(await db.query<any>("SELECT * FROM sources"))[0];assert.equal(source.cleared,false);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
  process.env.STUDIO_AUTH_SECRET="different-isolated-secret-"+"z".repeat(32);assert.equal((await get(cookie)).status,401);
 }finally{delete globals.studioDb;await db.close();}
});

test("hosted owner cookie access works with generation off but cannot invoke paid steps or cron",async()=>{
 const local=await embedded(),db={...local,kind:"postgres" as const},origin="https://studio.example.test",password="6728194035",secret="isolated-hosted-owner-secret-"+"x".repeat(32);
 const globals=globalThis as typeof globalThis&{studioDb?:Promise<any>};globals.studioDb=Promise.resolve(db);
 const config={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-model",pricing_version:"fixture",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"},hosted:{owner_auth_authorized:true,enabled:false,persistent_key_authorized:false,cron_authorized:false,fluid_compute_verified:true}};
 const settings={VERCEL:"1",VERCEL_ENV:"production",STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret,STUDIO_DATABASE_AUTHORIZED:"1",STUDIO_LOCAL_DB:"0",DATABASE_URL:"postgresql://fixture.invalid/isolated",STUDIO_RUNTIME_CONFIG:JSON.stringify(config),STUDIO_HOSTED_ENABLED:"0",OPENAI_API_KEY:"isolated-nonfunctional-fixture",CRON_SECRET:"isolated-cron-secret-"+"y".repeat(32)};
 Object.assign(process.env,settings);
 const savedFetch=globalThis.fetch;let transmissions=0;globalThis.fetch=async()=>{transmissions++;throw Error("No external request allowed");};
 try{
  await provisionOwner(db,password,true);
  const logged=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({password})}),"login",settings,async()=>db);assert.equal(logged.status,200);
  const cookie=logged.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");assert(logged.headers.getSetCookie().some(value=>/Secure/i.test(value)));
  const state=await GET(new Request(origin+"/api/studio/state",{headers:{Cookie:cookie}}),{params:Promise.resolve({action:"state"})});assert.equal(state.status,200);assert.equal((await state.json()).live_enabled,false);
  const denied=await POST(new Request(origin+"/api/studio/step",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:"{}"}),{params:Promise.resolve({action:"step"})});assert.equal(denied.status,403);
  const {handleHostedCron}=await import("../lib/hosted-http");let cronDb=0;
  const cron=await handleHostedCron(new Request(origin+"/api/cron",{headers:{authorization:"Bearer "+settings.CRON_SECRET}}),{env:settings,readConfig:()=>config as any,database:async()=>{cronDb++;return db;}});assert.equal(cron.status,503);assert.equal(cronDb,0);
  assert.equal((await db.query("SELECT * FROM ledger")).length,0);assert.equal((await db.query("SELECT * FROM tasks")).length,0);assert.equal(transmissions,0);
 }finally{globalThis.fetch=savedFetch;delete globals.studioDb;for(const name of Object.keys(settings))delete process.env[name];await local.close();}
});
