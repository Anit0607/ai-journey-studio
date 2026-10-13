import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {GET,POST} from "../app/api/studio/[action]/route";
import {istMonth} from "../lib/domain";

test("owner-only reporting routes enforce cookie authentication, Origin, input bounds, zero provider calls and logout",async()=>{
 const db=await embedded(),origin="http://127.0.0.1:3191",password="6728194035",secret="isolated-report-auth-"+"x".repeat(40),globals=globalThis as typeof globalThis&{studioDb?:Promise<any>};
 globals.studioDb=Promise.resolve(db);const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret,STUDIO_RUNTIME_CONFIG:"{}",STUDIO_ACCESS_TOKEN:"isolated-report-worker-"+"y".repeat(40),OPENAI_API_KEY:"",GEMINI_API_KEY:"",STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:""};Object.assign(process.env,env);
 const originalFetch=globalThis.fetch;let transmissions=0;globalThis.fetch=async()=>{transmissions++;throw Error("No outgoing requests allowed");};
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3191","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const call=(action:string,body:unknown,session=cookie,from=origin)=>POST(new Request(origin+"/api/studio/"+action,{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
  for(const action of ["metrics-save","money-add","money-void","coverage-confirm"]){assert.equal((await call(action,{},"")).status,401);assert.equal((await call(action,{},cookie,"https://other.example")).status,403);}
  const amount={request_id:randomUUID(),period:istMonth(),currency:"INR",kind:"revenue",category:"revenue",amount_minor:0,source_reference:"Isolated content-only report with complete revenue coverage",attributable:true};
  assert.equal((await call("money-add",amount)).status,200);assert.equal((await call("money-add",amount)).status,200);assert.equal((await call("money-add",{...amount,request_id:randomUUID(),amount_minor:-1})).status,400);
  const observed=new Date(Date.now()-60_000);assert.equal((await call("metrics-save",{request_id:randomUUID(),period:istMonth(observed),platform:"X",post_reference:"isolated-post",observed_at:observed.toISOString(),task_id:null,metrics:{impressions:0},source_reference:"Isolated platform UI, impressions only",expected_id:null})).status,200);
  assert.equal((await call("metrics-save",{...amount,source_reference:"x".repeat(5000)})).status,400);
  const get=()=>GET(new Request(origin+"/api/studio/state",{headers:{Cookie:cookie}}),{params:Promise.resolve({action:"state"})});let response=await get();assert.equal(response.status,200);const state=await response.json();assert.equal(state.analyst.money_records.length,1);assert.equal(state.analyst.metrics.length,1);assert.equal(state.sources.length,0);assert.equal(state.tasks.length,0);assert.equal(state.ledger.length,0);assert.equal(state.live_enabled,false);assert.equal(transmissions,0);
  const report=state.analyst.finances.find((row:any)=>row.period===istMonth()&&row.currency==="INR");const coverage={period:istMonth(),currency:"INR",basis:"actual_expenses",input_hash:report.input_hash,source_reference:"Isolated complete attributable coverage",acknowledged:true,revenue_covered:true,costs_covered:true};assert.equal((await call("coverage-confirm",{...coverage,revenue_covered:false})).status,400);assert.equal((await call("coverage-confirm",coverage)).status,200);
  const logout=await handleOwnerAuth(new Request(origin+"/api/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:"{}"}),"logout",env,async()=>db);assert.equal(logout.status,200);response=await get();assert.equal(response.status,401);assert.equal((await call("money-add",amount)).status,401);
 }finally{globalThis.fetch=originalFetch;delete globals.studioDb;for(const key of Object.keys(env))delete process.env[key];await db.close();}
});
