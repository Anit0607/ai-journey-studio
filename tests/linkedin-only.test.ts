import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {Calendar} from "../lib/calendar";
import {CAPSULE,ROLES,hash,type Task,type RuntimeConfig} from "../lib/domain";
import {NEW_PLATFORM_POLICY,activePlatforms,calendarPlatformPolicy,taskPlatformPolicy,readPlatformPolicy} from "../lib/platform-policy";
import {platformVariants,PLATFORM_FORMAT,platformFormat} from "../lib/platform-variants";
import {evidenceBinding,evidenceQuality,EVIDENCE_POLICY} from "../lib/evidence-review";
import {bundleVersion,type Artifact} from "../lib/grounding";
import {Publishing,type PublishingRuntime,type PublishInput,type PublishingAccount} from "../lib/publishing";
import {renderApprovedInstagram} from "../lib/publication-media";
import {queueAgentRevision} from "../lib/agent-revisions";
import {step} from "../lib/workflow";
import {enqueueLegacy} from "./legacy-task-fixture";
import {variantFixture} from "./variant-fixture";

const prose="Proposed approach: inspect one cleared source.";
const critic="Unsupported claims: none\nEvidence needed: a concrete cleared note\nProposed advice: inspect the source.";
const pricing={model:"isolated-policy-test",pricing_version:"test",pricing_tier:"standard" as const,official_pricing_url:"https://example.test",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const runtime:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),openai:pricing,fallback_authorized:false};
const chosen={start_date:"2030-10-14",post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:72};
const artifact=(text:string)=>({role:"Platform Adapter",text,hash:hash(text)});
async function fixture(work:(db:Database,store:Store)=>Promise<void>){const db=await embedded();try{await work(db,new Store(db));}finally{await db.close();}}
async function cleared(db:Database){const intake=new SourceIntake(db),s=await intake.stage({text:"I reviewed a draft.",category:"project-note",reported_date:new Date().toISOString().slice(0,10)});return intake.clear(s.id,s.hash,true);}
async function complete(db:Database,task:Task,adapter="### LinkedIn\n"+prose){
 for(const role of ROLES){const text=role==="Critic"?critic:role==="Platform Adapter"?adapter:prose;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 const bundle=await db.query<Artifact>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]);return {bundle,version:hash(bundle.map(o=>o.hash).join("|"))};
}

test("only explicit supported persisted policy enables LinkedIn-only; missing remains legacy and malformed fails closed",()=>{
 assert.deepEqual(activePlatforms(),["LinkedIn","X","Instagram"]);
 assert.deepEqual(activePlatforms(NEW_PLATFORM_POLICY),["LinkedIn"]);
 assert.equal(taskPlatformPolicy({content_brief:{platforms:["LinkedIn"]}}),undefined);
 for(const value of [null,{},[],{version:2,platforms:["LinkedIn"]},{version:1,platforms:["X"]},{version:1,platforms:["LinkedIn","Instagram"]},{version:1,platforms:["LinkedIn"],extra:true}])assert.throws(()=>readPlatformPolicy(value));
 assert.throws(()=>taskPlatformPolicy({content_brief:{platform_policy:NEW_PLATFORM_POLICY,platforms:["LinkedIn","X"]}}));
 assert.throws(()=>calendarPlatformPolicy({platform_schedule:{platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{},X:{}}}));
});
test("strict single-platform parsing rejects extra sections, placeholders, metadata, tampering and oversize without modifying bytes",()=>{
 const valid=artifact("### LinkedIn\n"+prose),before=JSON.stringify(valid),parsed=platformVariants(valid,NEW_PLATFORM_POLICY);
 assert.equal(parsed.complete,true);assert.equal(parsed.variants.length,1);assert.equal(parsed.variants[0].hash,hash(JSON.stringify({schema:1,platform:"LinkedIn",text:prose})));assert.equal(JSON.stringify(valid),before);
 assert.equal(platformVariants(valid).complete,false);assert.equal(platformVariants(artifact(variantFixture(prose))).complete,true);
 for(const text of [variantFixture(prose),"### LinkedIn\nTBD","### LinkedIn\nDraft\nUnsupported claims: none","### LinkedIn\n"+"a".repeat(3001),"### LinkedIn\nOne\n### LinkedIn\nTwo","Draft\n### LinkedIn\nPost"]){assert.equal(platformVariants(artifact(text),NEW_PLATFORM_POLICY).complete,false,text.slice(0,80));}
 assert.equal(platformVariants({...valid,hash:"wrong"},NEW_PLATFORM_POLICY).complete,false);
 assert.equal(platformFormat(),PLATFORM_FORMAT);assert.match(platformFormat(NEW_PLATFORM_POLICY),/exactly one/);assert.doesNotMatch(platformFormat(NEW_PLATFORM_POLICY),/exactly three/);
});
test("new manual tasks persist LinkedIn scope; duplicate enqueue never converts a historical queued task",()=>fixture(async(db,store)=>{
 const current=await cleared(db),newTask=await store.enqueue(current.id);assert.deepEqual(taskPlatformPolicy(newTask),NEW_PLATFORM_POLICY);
 const s=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),old=await enqueueLegacy(store,s.id),before=JSON.stringify((await db.query("SELECT * FROM tasks WHERE id=$1",[old.id]))[0]);
 assert.equal((await store.enqueue(s.id)).id,old.id);assert.equal(JSON.stringify((await db.query("SELECT * FROM tasks WHERE id=$1",[old.id]))[0]),before);assert.equal((await db.query("SELECT id FROM ledger")).length,0);
}));
test("historical artifacts, approval rows, evidence bindings and all three variant hashes survive new-work creation and snapshots",()=>fixture(async(db,store)=>{
 const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),old=await enqueueLegacy(store,source.id),done=await complete(db,old,variantFixture(prose));
 const originalBinding=hash(JSON.stringify({policy:EVIDENCE_POLICY,source_hash:source.hash,reported_date:source.reported_date,clearance:"legacy",cleared_at:null,bundle:bundleVersion(done.bundle,source.hash)}));
 assert.equal(evidenceBinding(done.bundle,source),originalBinding);await store.approve(old.id,done.version);
 const before=JSON.stringify(await db.query("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[old.id])),approvals=JSON.stringify(await db.query("SELECT * FROM approvals")),receipts=JSON.stringify(await db.query("SELECT * FROM evidence_approval_receipts"));
 const newSource=await cleared(db);await store.enqueue(newSource.id);const state=await store.snapshot(),review=state.reviews.find((r:any)=>r.task_id===old.id);
 assert(review.approval);assert.equal(review.variants.variants.length,3);assert.equal(review.quality.binding,originalBinding);assert.deepEqual(review.variants.variants.map((v:any)=>v.hash),["LinkedIn","X","Instagram"].map(platform=>hash(JSON.stringify({schema:1,platform,text:prose}))));
 assert.equal(JSON.stringify(await db.query("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[old.id])),before);assert.equal(JSON.stringify(await db.query("SELECT * FROM approvals")),approvals);assert.equal(JSON.stringify(await db.query("SELECT * FROM evidence_approval_receipts")),receipts);
}));
test("new policy binds evidence approvals; a changed public revision needs fresh owner approval",()=>fixture(async(db,store)=>{
 const source=await cleared(db),task=await store.enqueue(source.id),done=await complete(db,task);const q=evidenceQuality(done.bundle,source,[],NEW_PLATFORM_POLICY);
 assert.equal(q.flags.length,0);assert.notEqual(q.binding,evidenceBinding(done.bundle,source));await store.approve(task.id,done.version);
 let review=(await store.snapshot()).reviews[0];assert(review.approval);assert.equal(review.variants.variants.length,1);
 await store.revise(task.id,review.token,"Shorten the proposal",{role:"Platform Adapter",text:"### LinkedIn\nProposed approach: inspect the source."});review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);await assert.rejects(store.approveRevision(task.id,review.token,false),/acknowledgement/);await store.approveRevision(task.id,review.token,true);assert((await store.snapshot()).reviews[0].approval);
 assert.equal((await db.query("SELECT * FROM approvals")).length,1);
}));
test("LinkedIn-only task rejects an accidental three-platform bundle at content approval",()=>fixture(async(db,store)=>{
 const task=await store.enqueue((await cleared(db)).id),done=await complete(db,task,variantFixture(prose));await assert.rejects(store.approve(task.id,done.version),/source-grounding/);assert.equal((await db.query("SELECT * FROM approvals")).length,0);
}));
test("calendar requires only LinkedIn hours, creates no other platform slots and never rewrites existing dates",()=>fixture(async(db,store)=>{
 const c=new Calendar(db),legacy=randomUUID();await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due) VALUES($1,'2030-10-14','shortform','2030-10-14T04:30Z','2030-10-12T04:30Z','2030-10-12T04:30Z')",[legacy]);const before=JSON.stringify((await db.query("SELECT * FROM calendar_entries WHERE id=$1",[legacy]))[0]);
 await c.configure({...chosen,post_time:null,timing_mode:"per_platform",platform_times:{LinkedIn:{"1":"22:00","3":"16:00","5":"15:00","0":"22:00"}}});await c.plan(1);await c.plan(1);
 assert.equal(JSON.stringify((await db.query("SELECT * FROM calendar_entries WHERE id=$1",[legacy]))[0]),before);
 const snap=await c.snapshot(await store.snapshot(),{},false);assert.equal(snap.configuration_needed,false);assert.equal(snap.entries.length,4);assert.equal(snap.entries.find(e=>e.id===legacy)!.variants.length,3);
 for(const entry of snap.entries.filter(e=>e.id!==legacy)){assert.deepEqual(entry.active_platforms,["LinkedIn"]);assert.equal(entry.variants.length,1);assert.deepEqual(Object.keys(entry.platform_schedule).sort(),["LinkedIn","platform_policy"]);assert.equal(new Date(entry.intended_post).getTime()-new Date(entry.review_due).getTime(),48*3600000);}
 assert.equal((await db.query("SELECT * FROM tasks")).length,0);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
}));
test("new calendar policy is copied into dispatched task and cross-scope linking is rejected",()=>fixture(async(db,store)=>{
 const source=await cleared(db),c=new Calendar(db);await c.configure({...chosen,generation_enabled:true});await c.plan(1);const entry=(await db.query<any>("SELECT * FROM calendar_entries ORDER BY intended_post LIMIT 1"))[0];await c.link(entry.id,source.id,null);
 const at=new Date(entry.generation_due),config={...runtime,pricing_verified_date:at.toISOString().slice(0,10)};assert.equal((await c.dispatchDue(config,true,at)).queued,1);
 const task=(await db.query<Task>("SELECT * FROM tasks"))[0];assert.deepEqual(taskPlatformPolicy(task),NEW_PLATFORM_POLICY);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
 const oldSource=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),old=await enqueueLegacy(store,oldSource.id),other=(await db.query<any>("SELECT * FROM calendar_entries WHERE id!=$1 ORDER BY intended_post LIMIT 1",[entry.id]))[0];await assert.rejects(c.link(other.id,old.source_id,old.id),/platform policies/);
}));
test("agent revisions inherit the exact parent policy for both new and legacy tasks",()=>fixture(async(db,store)=>{
 const source=await cleared(db),task=await store.enqueue(source.id),done=await complete(db,task);await store.approve(task.id,done.version);const child=await queueAgentRevision(store,runtime,task.id,"original:"+done.version,"Shorten the proposal");assert.deepEqual(child.content_brief,task.content_brief);
 const s=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),old=await enqueueLegacy(store,s.id),oldDone=await complete(db,old,variantFixture(prose));await store.approve(old.id,oldDone.version);const c={...runtime,source_approved:true,approved_source_hash:s.hash,transmission_authorized:true};const legacyChild=await queueAgentRevision(store,c,old.id,"original:"+oldDone.version,"Shorten the proposal");assert.equal(taskPlatformPolicy(legacyChild),undefined);
}));
test("six isolated mocked checkpoints request only the new LinkedIn artifact, preserve source gates and stop for owner review",()=>fixture(async(db,store)=>{
 const s=await cleared(db),task=await store.enqueue(s.id);let calls=0;
 for(let checkpoint=0;checkpoint<6;checkpoint++){const result=await step(store,runtime,async(_provider,prompt)=>{calls++;assert(prompt.includes(s.text));if(checkpoint===4){assert.match(prompt,/Produce the LinkedIn variant only/);assert.match(prompt,/exactly one nonempty section/);assert.doesNotMatch(prompt,/required three-section schema|Produce LinkedIn, X and Instagram variants/);}const text=checkpoint===4?"### LinkedIn\n"+prose:checkpoint===5?critic:prose;return {text,input:10,output:10,outcome:"complete",report:{serviceTier:"default",model:pricing.model,requestId:"fixture",finishReason:"stop"}};},true);assert.equal(result.status,"step_saved");}
 assert.equal(calls,6);const state=await store.snapshot();assert.equal(state.tasks.find((t:any)=>t.id===task.id).status,"review");assert.equal(state.reviews[0].approval,null);assert.equal(state.reviews[0].variants.complete,true);assert.equal((await db.query("SELECT * FROM publishing_outbox")).length,0);
}));
test("approve first, stage, approve exact delivery, then publish once; X/Instagram remain unavailable for new task",()=>fixture(async(db,store)=>{
 const source=await cleared(db),task=await store.enqueue(source.id),done=await complete(db,task),now=new Date();let calls=0;
 const li:PublishingAccount={id:"linkedin-fixture",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Fixture",enabled:true,verified:true,authorization_version:"isolated",scopes:["w_member_social"],linkedin_version:"202609"};
 const x:PublishingAccount={id:"x-fixture",platform:"X",remote_id:"12345",label:"Fixture X",enabled:true,verified:true,authorization_version:"isolated",scopes:["tweet.write","tweet.read","users.read"]};
 const config:PublishingRuntime={now:()=>now,enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,accounts:[li,x],credential:async()=>"fixture-only",fetch:async()=>{calls++;return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});}};
 const p=new Publishing(db,config),input:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:"original:"+done.version,platform:"LinkedIn",account_id:li.id,scheduled_at:now.toISOString(),payload:{text:prose}};
 await assert.rejects(p.enqueue(input),/Approve the exact final artifact/);await store.approve(task.id,done.version);await assert.rejects(p.enqueue({...input,request_id:randomUUID(),platform:"X",account_id:x.id}),/not active/);await assert.rejects(renderApprovedInstagram(db,task.id,input.review_token),/not active/);
 const row=await p.enqueue(input);assert.equal(row.status,"staged");assert.equal((await p.dispatch(now)).status,"idle");assert.equal(calls,0);await assert.rejects(p.approve(row.id,row.version,false),/acknowledgement/);await p.approve(row.id,row.version,true);assert.equal((await p.dispatch(now)).status,"published");assert.equal((await p.dispatch(now)).status,"idle");assert.equal(calls,1);
}));

test("unbound legacy calendar dispatch is blocked without changing historical entry, job or queued legacy task",()=>fixture(async(db,store)=>{
 const source=await cleared(db),legacyTask=await enqueueLegacy(store,source.id),c=new Calendar(db),now=new Date();await c.configure({...chosen,generation_enabled:true});
 const id=randomUUID(),post=new Date(now.getTime()+72*3600000),review=new Date(post.getTime()-48*3600000);
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6)",[id,post.toISOString().slice(0,10),post,review,now,source.id]);
 await db.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked')",[randomUUID(),id]);
 const entryBefore=JSON.stringify(await db.query("SELECT * FROM calendar_entries")),jobBefore=JSON.stringify(await db.query("SELECT * FROM calendar_jobs")),taskBefore=JSON.stringify(await db.query("SELECT * FROM tasks"));
 const result=await c.dispatchDue(runtime,true,now);assert.equal(result.queued,0);assert.equal(result.blocked,1);assert.match(result.entries[0].reason!,/fresh LinkedIn-only plan/);
 assert.equal(JSON.stringify(await db.query("SELECT * FROM calendar_entries")),entryBefore);assert.equal(JSON.stringify(await db.query("SELECT * FROM calendar_jobs")),jobBefore);assert.equal(JSON.stringify(await db.query("SELECT * FROM tasks")),taskBefore);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
 const view=await c.snapshot(await store.snapshot(),runtime,true,now);assert(view.entries[0].blocked_reasons.some((reason:string)=>reason.includes("fresh LinkedIn-only plan")));
 // An already linked legacy task is still recognized, never regenerated or converted.
 await c.link(id,source.id,legacyTask.id);const linked=await c.dispatchDue(runtime,true,now);assert.equal(linked.queued,0);assert.equal(linked.existing,1);assert.equal(linked.entries[0].status,"queued");assert.equal(taskPlatformPolicy((await db.query<Task>("SELECT * FROM tasks WHERE id=$1",[legacyTask.id]))[0]),undefined);
}));
