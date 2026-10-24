import test from "node:test";
import assert from "node:assert/strict";
import {embedded,type Database} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {POST} from "../app/api/studio/[action]/route";

test("combined plan approval requires the live owner cookie and same origin; bearer and injected consent fields fail closed",async()=>{
 const db=await embedded(),globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>},priorDb=globals.studioDb,priorFetch=globalThis.fetch;
 const origin="http://127.0.0.1:3197",env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-plan-route-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-plan-worker-"+"y".repeat(40),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:"{}",STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:"",OPENAI_API_KEY:"",GEMINI_API_KEY:""};
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);globals.studioDb=Promise.resolve(db);globalThis.fetch=async()=>assert.fail("Approval must not send outbound requests");
 try{
  const password="6728194035";await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3197","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const body={task_id:"task",review_token:"token",expected_plan:"plan",acknowledged:true};
  const call=(payload:unknown=body,session=cookie,from=origin,extra:Record<string,string>={})=>POST(new Request(origin+"/api/studio/approval-plan-approve",{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json",...extra},body:JSON.stringify(payload)}),{params:Promise.resolve({action:"approval-plan-approve"})});
  assert.equal((await call(body,"")).status,401);assert.equal((await call(body,"",origin,{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN})).status,401);
  assert.equal((await call(body,cookie,"https://other.example.test")).status,403);assert.equal((await call(body,cookie,"")).status,403);
  for(const payload of [null,{},[],{...body,acknowledged:false},{...body,acknowledged:"true"},{...body,account_id:"override"},{...body,scheduled_at:"2030-01-01T00:00Z"},{...body,payload:{text:"replacement"}},{...body,enabled:true}])assert.equal((await call(payload)).status,400);
  for(const table of ["approvals","revision_approvals","publishing_outbox","publishing_approvals"])assert.equal((await db.query("SELECT * FROM "+table)).length,0);
 }finally{globals.studioDb=priorDb;globalThis.fetch=priorFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.close();}
});
