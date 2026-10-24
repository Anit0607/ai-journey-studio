import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Connection,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";
import {IntegrationOAuth,OAUTH_SCOPES,type OAuthOwnerSession} from "../lib/integration-oauth";
import {OAUTH_SCHEMA} from "../lib/integration-oauth-schema";
import {OWNER_ID} from "../lib/owner-password";
import {Publishing,type PublishingRuntime} from "../lib/publishing";
import {approveApprovalPlan,previewApprovalPlan} from "../lib/approval-plan";

const origin="https://127.0.0.1:3199",base=new Date("2026-10-20T08:00:00Z"),post=new Date(base.getTime()+60000),prose="Proposed approach: inspect one cleared source.";
const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-oauth-admission-fixture",STUDIO_CONNECTIONS_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64"),STUDIO_OAUTH_LINKEDIN_CLIENT_ID:"fixture-client",STUDIO_OAUTH_LINKEDIN_CLIENT_SECRET:"fixture-client-secret"};
const config={enabled:true,credential_use_authorized:true,providers:{linkedin:{enabled:true,redirect_uri:origin+"/api/connections/linkedin/callback",linkedin_version:"202610"}}};

async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
async function seed(db:Database){
 for(const sql of OAUTH_SCHEMA.split(";").map(part=>part.trim()).filter(Boolean))await db.query(sql);
 await db.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',\'owner@studio.local\',true,now(),now())',[OWNER_ID]);
 const session:OAuthOwnerSession={owner_id:OWNER_ID,session_id:randomUUID()};await db.query('INSERT INTO studio_auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[session.session_id,OWNER_ID,randomUUID(),new Date(base.getTime()+8*3600000)]);
 let clock=base,identityRejected=false;
 const transport:typeof fetch=async url=>String(url).endsWith("/userinfo")?Response.json(identityRejected?{}:{sub:"12345",name:"Fictional owner"},{status:identityRejected?401:200}):Response.json({access_token:"fixture-access-only",expires_in:7200,token_type:"Bearer",scope:OAUTH_SCOPES.linkedin.join(" ")});
 const oauth=new IntegrationOAuth(db,config,env,{now:()=>clock,fetch:transport}),start=await oauth.start("linkedin",session,true),state=new URL(start.authorization_url).searchParams.get("state")!,binding=start.set_cookie.split(";")[0].split("=")[1];
 await oauth.callback("linkedin",{state,binding,code:"fixture-code"});await oauth.test("linkedin",session,true);const [account]=await oauth.publishingAccounts();assert.equal(account.id,"oauth_linkedin");
 const intake=new SourceIntake(db),s=await intake.stage({text:"I reviewed one draft.",category:"project-note",reported_date:"2026-10-20"}),source=await intake.clear(s.id,s.hash,true),store=new Store(db),task=await store.enqueue(source.id);
 for(const role of ROLES){const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared note\nProposed advice: inspect the source.":role==="Platform Adapter"?"### LinkedIn\n"+prose:prose;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
 await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);const token=(await store.snapshot()).reviews[0].token;
 const when=post.toISOString(),entry=randomUUID(),schedule={LinkedIn:{intended_post:when,draft_due:when,review_due:when},platform_policy:NEW_PLATFORM_POLICY};
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,'2026-10-20','shortform',$2,$2,$2,$3,$4,$5)",[entry,when,source.id,task.id,JSON.stringify(schedule)]);
 let sent=0;
 const runtime:PublishingRuntime={enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,now:()=>clock,accounts:[account],credential:a=>oauth.credential(a),accountCurrent:(a,tx,fresh)=>oauth.validateAccount(a,tx,!fresh),fetch:async()=>{sent++;return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});}};
 const plan=await previewApprovalPlan(db,runtime,task.id,token),body={task_id:task.id,review_token:token,expected_plan:plan.version,acknowledged:true};
 return {db,oauth,session,account,runtime,body,task,plan,counts:()=>({sent}),due:()=>{clock=post;},rejectIdentity:()=>{identityRejected=true;}};
}

test("transaction-bound OAuth validation locks its actual row after early guards and task/source; admission commits before transport",()=>fixture(async f=>{
 const transactions:string[][]=[];let active=0;
 const traced:Database={...f.db,transaction:work=>f.db.transaction(async tx=>{const sqls:string[]=[];transactions.push(sqls);active++;try{return await work({query:async(sql,params)=>{sqls.push(sql);return tx.query(sql,params);}});}finally{active--;}})};
 f.runtime.fetch=async()=>{assert.equal(active,0);return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});};
 const first=await approveApprovalPlan(traced,f.runtime,f.body),replay=await approveApprovalPlan(traced,f.runtime,f.body);assert.equal(first.id,replay.id,"Replay reuses the same exact outbox under the same first-acquisition order");
 f.due();assert.equal((await new Publishing(traced,f.runtime).dispatch(post)).status,"published");
 const admission=transactions.find(sqls=>sqls.some(sql=>sql.startsWith("INSERT INTO publishing_attempts")));assert(admission);
 assert.equal(admission[0],"SELECT id FROM calendar_settings WHERE id=1 FOR SHARE");assert.equal(admission[1],"SELECT id FROM integration_oauth_guard WHERE id=1 FOR SHARE");
 const connection=admission.findIndex(sql=>sql.includes("FROM integration_oauth_connections")&&sql.endsWith("FOR SHARE")),task=admission.findIndex(sql=>sql.includes("FROM tasks WHERE id=")&&sql.includes("FOR UPDATE")),source=admission.findIndex(sql=>sql.includes("FROM sources WHERE id=")&&sql.includes("FOR UPDATE")),attempt=admission.findIndex(sql=>sql.startsWith("INSERT INTO publishing_attempts"));
 assert(connection>task&&connection>source&&attempt>connection,"Account row SHARE is held from validation through durable admission");
 for(const sqls of transactions.filter(sqls=>sqls.some(sql=>sql.includes("FROM integration_oauth_connections")&&sql.endsWith("FOR SHARE")))){
  const firstGuard=sqls.findIndex(sql=>sql==="SELECT id FROM integration_oauth_guard WHERE id=1 FOR SHARE"),firstRow=sqls.findIndex(sql=>sql.includes("FROM integration_oauth_connections")&&sql.endsWith("FOR SHARE"));
  assert(firstGuard>=0&&firstGuard<firstRow);assert(firstGuard<sqls.findIndex(sql=>sql.includes("FROM tasks WHERE id=")&&sql.includes("FOR UPDATE")));
 }
}));

test("missing OAuth singleton guard fails closed before content approval or durable admission",()=>fixture(async f=>{
 await f.db.query("DELETE FROM integration_oauth_guard WHERE id=1");
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,f.body),/OAuth guard unavailable/);
 for(const table of ["approvals","evidence_approval_receipts","publishing_outbox","publishing_approvals","publishing_attempts"])assert.equal((await f.db.query("SELECT * FROM "+table)).length,0);
 assert.equal(f.counts().sent,0);
}));

test("a committed disconnect or actual unguarded identity invalidation before final admission prevents every publication request",async t=>{
 for(const mutation of ["disconnect","invalidate"] as const)await t.test(mutation,()=>fixture(async f=>{
  await approveApprovalPlan(f.db,f.runtime,f.body);f.due();
  f.runtime.credential=async account=>{const value=await f.oauth.credential(account);if(mutation==="disconnect")await f.oauth.disconnect("linkedin",f.session,true);else{f.rejectIdentity();await assert.rejects(f.oauth.test("linkedin",f.session,true),/rejected/);}return value;};
  const result=await new Publishing(f.db,f.runtime).dispatch(post);assert.notEqual(result.status,"published");assert.equal(f.counts().sent,0);assert.equal((await f.db.query("SELECT * FROM publishing_attempts")).length,0);
  assert.equal(await f.oauth.validateAccount(f.account),false);
 }));
});

test("deterministic row-lock simulation holds a queued connection UPDATE until durable admission releases its actual validator row SHARE",()=>fixture(async f=>{
 // This simulates the PostgreSQL lock lifetime; it is not a multi-session PostgreSQL race test.
 let shareHeld=false,release!:()=>void,mutationCommitted=false;
 const released=new Promise<void>(resolve=>{release=resolve;});
 const tx:Connection={query:async(sql,params)=>{if(sql.includes("FROM integration_oauth_connections")&&sql.endsWith("FOR SHARE"))shareHeld=true;return f.db.query(sql,params);}};
 assert.equal(await f.oauth.validateAccount(f.account,tx),true);assert(shareHeld,"Use the real validator's SQL, not a source-string inspection");
 const disconnect=(async()=>{if(shareHeld)await released;await f.oauth.disconnect("linkedin",f.session,true);mutationCommitted=true;})();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(mutationCommitted,false);
 // The admission decision is durable before the transaction releases its row lock.
 const admitted=await f.db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'fixture_admitted','Deterministic admission boundary') RETURNING id",[randomUUID(),f.task.id]);assert.equal(admitted.length,1);assert.equal(mutationCommitted,false);
 shareHeld=false;release();await disconnect;assert.equal(mutationCommitted,true);assert.equal(await f.oauth.validateAccount(f.account),false);
}));
