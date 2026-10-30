import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {Publishing,type PublishingAccount} from "../lib/publishing";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {GET,POST} from "../app/api/studio/[action]/route";

const account:PublishingAccount={id:"approval-auth-fixture",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Fictional owner",enabled:true,verified:true,authorization_version:"fixture-v1",scopes:["w_member_social"],linkedin_version:"202610"};
const ownerActions=["approve","approve-revision","publication-approve","publication-media-approve","approval-plan-approve","approval-plan-confirm-approve","attest-final-post","evidence-review","source-clear","agent-revise"];

test("every approval action requires a live owner cookie and same origin; worker reads and execution remain permitted",async()=>{
 const db=await embedded(),globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>},priorDb=globals.studioDb,priorFetch=globalThis.fetch;
 const origin="http://127.0.0.1:3198",password="6728194035";
 const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-approval-auth-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-execution-only-"+"y".repeat(40),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:JSON.stringify({publishing:{accounts:[account]}}),STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:"",OPENAI_API_KEY:"",GEMINI_API_KEY:""};
 const names=[...Object.keys(env),"VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV"],previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
 Object.assign(process.env,env);for(const key of names.filter(key=>key.startsWith("VERCEL")))delete process.env[key];globals.studioDb=Promise.resolve(db);globalThis.fetch=async()=>assert.fail("Approval regression must not make network requests");
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3198","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const call=(action:string,body:unknown={},session="",from=origin,worker=false)=>POST(new Request(origin+"/api/studio/"+action,{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json",...(worker?{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN}:{})},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
  for(const action of ownerActions){
   assert.equal((await call(action,{},"",origin,true)).status,401,action+" must reject worker bearer");
   assert.equal((await call(action,{},cookie,"https://other.example.test")).status,403,action+" must reject cross-origin cookie use");
   assert.equal((await call(action,{},cookie,"")).status,403,action+" must require Origin");
   assert.equal((await call(action,{},cookie+"tampered")).status,401,action+" must reject tampered sessions");
  }
  const intake=new SourceIntake(db),source=await intake.stage({text:"I reviewed one draft. I use AI agents for implementation while retaining final approval.",category:"project-note",reported_date:"2026-10-20"});
  const clearance={source:source.id,expected_hash:source.hash,acknowledged:true};assert.equal((await call("source-clear",clearance,cookie)).status,200);
  const store=new Store(db),task=await store.enqueue(source.id),prose="Proposed approach: inspect one cleared source.";
  for(const role of ROLES){const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared note\nProposed advice: inspect the source.":role==="Platform Adapter"?"### LinkedIn\n"+prose:prose;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
  await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);
  let review=(await store.snapshot()).reviews[0];const approve={task:task.id,version:review.token.slice("original:".length)};
  assert.equal((await call("approve",approve,"",origin,true)).status,401);assert.equal((await call("approve",approve,cookie)).status,200);
  await store.revise(task.id,review.token,"Review the exact new version",{role:"Writer",text:"The project owner uses AI agents for implementation while retaining final approval."});review=(await store.snapshot()).reviews[0];
  const quote="I use AI agents for implementation while retaining final approval.",start=source.text.indexOf(quote),finding=review.quality.flags[0];assert(finding);
  const evidence={task:task.id,expected:review.token,binding:review.quality.binding,finding_id:finding.id,decision:"accept",reason:"The wording retains the cleared responsibility statement.",source_span:{start,end:start+quote.length},source_quote:quote,acknowledged:true};
  assert.equal((await call("evidence-review",evidence,"",origin,true)).status,401);assert.equal((await call("evidence-review",evidence,cookie)).status,200);
  const revision={task:task.id,expected:review.token,acknowledged:true};
  assert.equal((await call("approve-revision",revision,"",origin,true)).status,401);assert.equal((await call("approve-revision",revision,cookie)).status,200);
  const row=await new Publishing(db,{accounts:[account]}).enqueue({request_id:randomUUID(),task_id:task.id,review_token:review.token,platform:"LinkedIn",account_id:account.id,scheduled_at:"2030-10-15T04:30:00.000Z",payload:{text:prose}}),publication={id:row.id,expected_version:row.version,acknowledged:true};
  assert.equal((await call("publication-approve",publication,"",origin,true)).status,401);assert.equal((await call("publication-approve",publication,cookie)).status,200);
  const revisionRequest={task:task.id,expected:review.token,note:"Keep the revision faithful to the exact cleared source."};
  assert.equal((await call("agent-revise",revisionRequest,"",origin,true)).status,401);
  process.env.STUDIO_RUNTIME_CONFIG=JSON.stringify({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-revision-fixture",pricing_version:"test",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"}});
  assert.equal((await call("agent-revise",revisionRequest,cookie)).status,200,"Only the owner cookie can issue a revision request; queuing must not invoke a model");process.env.STUDIO_RUNTIME_CONFIG="{}";
  for(const action of ["publication-media-approve","evidence-review"])assert.equal((await call(action,{},cookie)).status,400,"Owner authentication must reach validation without bypassing its exact-data gates");
  assert.equal((await GET(new Request(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN}}),{params:Promise.resolve({action:"state"})})).status,200);
  assert.equal((await call("step",{},"",origin,true)).status,200,"Worker execution remains authenticated separately");
  assert.equal((await db.query("SELECT * FROM ledger")).length,0);assert.equal((await db.query("SELECT * FROM publishing_attempts")).length,0);
  const logout=await handleOwnerAuth(new Request(origin+"/api/auth/logout",{method:"POST",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:"{}"}),"logout",env,async()=>db);assert.equal(logout.status,200);
  for(const action of ownerActions)assert.equal((await call(action,{},cookie)).status,401,action+" must reject a revoked session");
 }finally{globals.studioDb=priorDb;globalThis.fetch=priorFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.close();}
});
