import {APPROVAL_PLAN_CONTRACT_V2} from "../lib/approval-plan-contract";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";
import {type PublishingAccount,type PublishingRuntime} from "../lib/publishing";
import {previewApprovalPlan,confirmAndApproveApprovalPlan} from "../lib/approval-plan";
import {assistantEditAuthorized,parseAssistantRevision} from "../lib/assistant-edit";
import {OWNER_ATTESTATION_POLICY} from "../lib/evidence-review";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {POST} from "../app/api/studio/[action]/route";

const prose="Proposed approach: inspect one cleared source.";
const critic="Unsupported claims: none\nEvidence needed: a concrete cleared note\nProposed advice: inspect the source.";
const reworded="### LinkedIn\n"+prose+"\nThe draft was reviewed.";
const post="2030-10-15T04:30:00.000Z";
const account:PublishingAccount={id:"one-click-fixture",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Fictional owner",enabled:true,verified:true,authorization_version:"fixture-v1",scopes:["w_member_social"],linkedin_version:"202610"};

async function seed(db:Database,linkedin="### LinkedIn\n"+prose){
 const intake=new SourceIntake(db),store=new Store(db),staged=await intake.stage({text:"I reviewed a draft.",category:"project-note",reported_date:"2026-10-20"}),source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id);
 for(const role of ROLES){const text=role==="Critic"?critic:role==="Platform Adapter"?"### LinkedIn\n"+prose:prose;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 const schedule={LinkedIn:{intended_post:post,draft_due:"2030-10-13T04:30:00.000Z",review_due:"2030-10-13T04:30:00.000Z"},platform_policy:NEW_PLATFORM_POLICY};
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,'2030-10-15','shortform',$2,'2030-10-13T04:30Z','2030-10-13T04:30Z',$3,$4,$5)",[randomUUID(),post,source.id,task.id,JSON.stringify(schedule)]);
 const runtime:PublishingRuntime={enabled:false,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,now:()=>new Date("2030-10-14T04:30:00Z"),accounts:[account],credential:()=>assert.fail("approval must not read credentials")};
 if(linkedin!=="### LinkedIn\n"+prose){const review=(await store.snapshot()).reviews[0];await store.revise(task.id,review.token,"Owner wording edit",{role:"Platform Adapter",text:linkedin});}
 const review=(await store.snapshot()).reviews[0];
 return {store,task,runtime,review};
}
async function counts(db:Database){const out:Record<string,number>={};for(const table of ["approvals","revision_approvals","evidence_approval_receipts","publishing_outbox","evidence_decisions"])out[table]=(await db.query("SELECT * FROM "+table)).length;return out;}
const request=(plan:Awaited<ReturnType<typeof previewApprovalPlan>>,extra:Record<string,unknown>={})=>({...APPROVAL_PLAN_CONTRACT_V2,task_id:plan.task_id,review_token:plan.review_token,expected_plan:plan.version,binding:plan.pending_confirmation?.binding,acknowledged:true,...extra});

test('a plan with open wording findings is previewable only for owner confirmation, and one action confirms and approves it',async()=>{
 const db=await embedded();try{
  const {task,runtime,review}=await seed(db,reworded);
  assert(review.quality.flags.length>0&&review.quality.flags.every((f:any)=>f.kind==="wording_review"));
  await assert.rejects(previewApprovalPlan(db,runtime,task.id,review.token),/Resolve source-grounding flags/);
  const plan=await previewApprovalPlan(db,runtime,task.id,review.token,{allowOwnerConfirmation:true});
  assert.equal(plan.pending_confirmation?.count,review.quality.flags.length);assert.equal(plan.text,reworded.slice("### LinkedIn\n".length));
  const before=await counts(db);
  await assert.rejects(confirmAndApproveApprovalPlan(db,runtime,request(plan,{expected_plan:"0".repeat(64)})),/Approval plan changed/);
  await assert.rejects(confirmAndApproveApprovalPlan(db,runtime,request(plan,{binding:"stale"})),/Review changed/);
  await assert.rejects(confirmAndApproveApprovalPlan(db,runtime,request(plan,{acknowledged:false})),/Explicit exact plan acknowledgement/);
  await assert.rejects(confirmAndApproveApprovalPlan(db,runtime,{...request(plan),extra:true}),/Exact confirm-and-approve request/);
  assert.deepEqual(await counts(db),before,'refused requests save nothing');
  await confirmAndApproveApprovalPlan(db,runtime,request(plan));
  const outbox=await db.query<any>("SELECT * FROM publishing_outbox");assert.equal(outbox.length,1);assert.equal(outbox[0].payload.text,plan.text);assert.equal(new Date(outbox[0].scheduled_at).toISOString(),post);
  assert(outbox[0].status==="approved","the delivery plan is approved in the same action");
  const decisions=await db.query<any>("SELECT * FROM evidence_decisions");assert.equal(decisions.length,review.quality.flags.length);assert(decisions.every(d=>d.actor==="owner"&&d.policy_version===OWNER_ATTESTATION_POLICY));
  assert.equal((await db.query("SELECT * FROM revision_approvals")).length,1);
  assert.equal((await previewApprovalPlan(db,runtime,task.id,review.token)).pending_confirmation,undefined);
 }finally{await db.close();}
});

test('hard findings keep the plan unavailable even for owner confirmation',async()=>{
 const db=await embedded();try{
  const {task,runtime,review}=await seed(db,"### LinkedIn\n"+prose+"\nThe project has 500 users.");
  assert(review.quality.flags.some((f:any)=>f.kind==="hard"));
  await assert.rejects(previewApprovalPlan(db,runtime,task.id,review.token,{allowOwnerConfirmation:true}),/Resolve source-grounding flags/);
 }finally{await db.close();}
});

test('the assistant-edit credential is separate, strong and parses only public-copy edits',()=>{
 const token="assistant-edit-"+"a".repeat(40),req=(value:string)=>new Request("http://127.0.0.1/api/studio/assistant-revise",{method:"POST",headers:{Authorization:value}});
 assert.equal(assistantEditAuthorized(req("Bearer "+token),{STUDIO_ASSISTANT_EDIT_TOKEN:token}),true);
 assert.equal(assistantEditAuthorized(req("Bearer "+token+"x"),{STUDIO_ASSISTANT_EDIT_TOKEN:token}),false);
 assert.equal(assistantEditAuthorized(req("Bearer short"),{STUDIO_ASSISTANT_EDIT_TOKEN:"short"}),false);
 for(const other of ["STUDIO_ACCESS_TOKEN","STUDIO_AUTH_SECRET","CRON_SECRET","STUDIO_CONNECTIONS_ENCRYPTION_KEY"])assert.equal(assistantEditAuthorized(req("Bearer "+token),{STUDIO_ASSISTANT_EDIT_TOKEN:token,[other]:token}),false,other);
 const body={task:"t",expected:"e",note:"n",role:"Platform Adapter",text:"x"};
 assert.deepEqual(parseAssistantRevision(body),body);
 for(const bad of [{...body,role:"Critic"},{...body,role:"Harvester"},{...body,acknowledged:true},{...body,text:1}])assert.throws(()=>parseAssistantRevision(bad),/Invalid assistant revision request/);
});

test('over HTTP the assistant credential saves an attributed draft edit and reaches no other action',async()=>{
 const db=await embedded(),globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>},priorDb=globals.studioDb,priorFetch=globalThis.fetch;
 const origin="http://127.0.0.1:3197",password="6728194035",assistant="isolated-assistant-edit-"+"z".repeat(40);
 const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-one-click-auth-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-execution-only-"+"y".repeat(40),STUDIO_ASSISTANT_EDIT_TOKEN:assistant,STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:JSON.stringify({publishing:{accounts:[account]}}),STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:"",OPENAI_API_KEY:"",GEMINI_API_KEY:""};
 const names=[...Object.keys(env),"VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV"],previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
 Object.assign(process.env,env);for(const key of names.filter(key=>key.startsWith("VERCEL")))delete process.env[key];globals.studioDb=Promise.resolve(db);globalThis.fetch=async()=>assert.fail("no network");
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3197","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const call=(action:string,body:unknown,auth:string,session="",from=origin)=>POST(new Request(origin+"/api/studio/"+action,{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json",...(auth?{Authorization:"Bearer "+auth}:{})},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
  for(const action of ["approve","approve-revision","attest-final-post","approval-plan-approve","approval-plan-confirm-approve","publication-approve","publication-publish","evidence-review","source-clear","revise","agent-revise"])assert.equal((await call(action,{},assistant)).status,401,action+" must reject the assistant credential");
  const {task,review}=await seed(db);
  const edit={task:task.id,expected:review.token,role:"Platform Adapter",note:"Tighten the opening",text:reworded};
  assert.equal((await call("assistant-revise",edit,"")).status,401);
  assert.equal((await call("assistant-revise",edit,env.STUDIO_ACCESS_TOKEN)).status,401,"worker token is not the assistant credential");
  assert.equal((await call("assistant-revise",edit,"",cookie)).status,401,"the owner cookie alone is not the assistant credential");
  assert.equal((await call("assistant-revise",edit,assistant,"","https://other.example.test")).status,403);
  assert.equal((await call("assistant-revise",{...edit,role:"Critic"},assistant)).status,400);
  assert.equal((await call("assistant-revise",edit,assistant)).status,200);
  const rows=await db.query<any>("SELECT request_note FROM content_revisions");assert.equal(rows.length,1);assert.equal(rows[0].request_note,"[Assistant edit] Tighten the opening");
  const events=await db.query<any>("SELECT kind,detail FROM events WHERE kind='assistant_revision_saved'");assert.equal(events.length,1);assert.match(events[0].detail,/not owner review or approval/);
  assert.deepEqual(await counts(db),{approvals:0,revision_approvals:0,evidence_approval_receipts:0,publishing_outbox:0,evidence_decisions:0});
 }finally{globals.studioDb=priorDb;globalThis.fetch=priorFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.close();}
});
