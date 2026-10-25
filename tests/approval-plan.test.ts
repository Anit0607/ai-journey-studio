import {APPROVAL_PLAN_ACK,APPROVAL_PLAN_CONTRACT_V2} from "../lib/approval-plan-contract";
import {schedulerWindowPolicy} from '../lib/scheduler-window-policy';
import {fixedSettings} from './scheduler-window-fixture';
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash,type RuntimeConfig} from "../lib/domain";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";
import {step} from "../lib/workflow";
import {Publishing,type PublishingRuntime} from "../lib/publishing";
import {previewApprovalPlan,approveApprovalPlan} from "../lib/approval-plan";

const prose="Proposed approach: inspect one cleared source.";
const critic="Unsupported claims: none\nEvidence needed: a concrete cleared note\nProposed advice: inspect the source.";
const start=new Date("2030-10-14T04:30:00Z"),post="2030-10-15T04:30:00.000Z";
async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>,mockDraft=false,sourceText="I reviewed a draft."){const db=await embedded();try{await work(await seed(db,mockDraft,sourceText));}finally{await db.close();}}
async function seed(db:Database,mockDraft:boolean,sourceText:string){
 const intake=new SourceIntake(db),store=new Store(db),staged=await intake.stage({text:sourceText,category:"project-note",reported_date:"2026-10-20"}),source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id);
 let modelCalls=0;
 if(mockDraft){
  const pricing={model:"isolated-plan-model",pricing_version:"test",pricing_tier:"standard" as const,official_pricing_url:"https://example.test",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
  const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),openai:pricing,fallback_authorized:false};
  for(let n=0;n<6;n++)assert.equal((await step(store,config,async()=>{modelCalls++;return {text:n===4?"### LinkedIn\n"+prose:n===5?critic:prose,input:10,output:10,outcome:"complete",report:{serviceTier:"default",model:pricing.model,requestId:"mock",finishReason:"stop"}};},true)).status,"step_saved");
 }else{
  for(const role of ROLES){const text=role==="Critic"?critic:role==="Platform Adapter"?"### LinkedIn\n"+prose:prose;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 }
 const entry=randomUUID(),schedule={LinkedIn:{intended_post:post,draft_due:"2030-10-13T04:30:00.000Z",review_due:"2030-10-13T04:30:00.000Z"},platform_policy:NEW_PLATFORM_POLICY};
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,'2030-10-15','shortform',$2,'2030-10-13T04:30Z','2030-10-13T04:30Z',$3,$4,$5)",[entry,post,source.id,task.id,JSON.stringify(schedule)]);
 let calls=0,credentials=0,now=start;
 const runtime:PublishingRuntime={enabled:false,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,now:()=>now,accounts:[{id:"fixture-linkedin",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Fictional owner",enabled:true,verified:true,authorization_version:"fixture-v1",scopes:["w_member_social"],linkedin_version:"202610"}],credential:async()=>{credentials++;return "fixture-only";},fetch:async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).commentary,prose);return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});}};
 const review=(await store.snapshot()).reviews[0],preview=()=>previewApprovalPlan(db,runtime,task.id,review.token);
 const plan=await preview(),body={...APPROVAL_PLAN_CONTRACT_V2,task_id:task.id,review_token:review.token,expected_plan:plan.version,acknowledged:true};
 return {db,store,intake,source,task,entry,schedule,runtime,plan,body,preview,modelCalls,counts:()=>({calls,credentials}),due:()=>{now=new Date(post);}};
}
async function noApproval(db:Database){for(const table of ["approvals","revision_approvals","evidence_approval_receipts","publishing_outbox","publishing_approvals"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table);}

test("six mocked LinkedIn stages -> read-only preview while OFF -> one atomic concurrent approval -> due-only mock receipt",()=>fixture(async f=>{
 assert.equal(f.modelCalls,6);assert.equal(f.plan.text,prose);assert.equal(f.plan.scheduled_at,post);await noApproval(f.db);assert.deepEqual(f.counts(),{calls:0,credentials:0});
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,{...f.body,acknowledged:false}),/acknowledgement/);
 const rows=await Promise.all([approveApprovalPlan(f.db,f.runtime,f.body),approveApprovalPlan(f.db,f.runtime,f.body)]);assert.equal(rows[0].id,rows[1].id);
 for(const table of ["approvals","evidence_approval_receipts","publishing_outbox","publishing_approvals","publishing_requests"])assert.equal((await f.db.query("SELECT * FROM "+table)).length,1,table);
 assert.equal((await f.db.query("SELECT * FROM events WHERE kind='calendar_publication_approved'")).length,1);
 const p=new Publishing(f.db,f.runtime);assert.equal((await p.dispatch()).status,"disabled");f.runtime.enabled=true;assert.equal((await p.dispatch(start)).status,"idle");assert.deepEqual(f.counts(),{calls:0,credentials:0});
 f.due();assert.equal((await p.dispatch(new Date(post))).status,"published");assert.equal((await p.dispatch(new Date(post))).status,"idle");assert.deepEqual(f.counts(),{calls:1,credentials:1});
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,f.body),/future|replay/);
},true));

test("edits, source reclearance, destination reconnect and calendar time changes reject the old preview without approving anything",async t=>{
 for(const change of ["edit","source","account","account-id","account-remote","account-label","time","valid-time"] as const)await t.test(change,()=>fixture(async f=>{
  if(change==="edit")await f.store.revise(f.task.id,f.plan.review_token,"Shorten proposal",{role:"Platform Adapter",text:"### LinkedIn\nProposed approach: inspect the source."});
  if(change==="source"){await f.intake.revoke(f.source.id,f.source.hash);await f.intake.clear(f.source.id,f.source.hash,true);}
  if(change==="account")f.runtime.accounts![0].authorization_version="fixture-v2";
  if(change==="account-id")f.runtime.accounts![0].id="new-account";
  if(change==="account-remote")f.runtime.accounts![0].remote_id="urn:li:person:99999";
  if(change==="account-label")f.runtime.accounts![0].label="Different display account";
  if(change==="valid-time")await f.db.query("UPDATE calendar_entries SET intended_post=$2,platform_schedule=$3 WHERE id=$1",[f.entry,"2030-10-16T04:30Z",JSON.stringify({...f.schedule,LinkedIn:{...f.schedule.LinkedIn,intended_post:"2030-10-16T04:30:00.000Z"}})]);
  if(change==="time")await f.db.query("UPDATE calendar_entries SET intended_post=$2 WHERE id=$1",[f.entry,"2030-10-16T04:30Z"]);
  await assert.rejects(approveApprovalPlan(f.db,f.runtime,f.body));await noApproval(f.db);assert.deepEqual(f.counts(),{calls:0,credentials:0});
 }));
});

test("missing or ambiguous existing destination/slot fails closed without choosing defaults",async t=>{
 for(const change of ["missing-slot","duplicate-slot","no-account","ambiguous-account"] as const)await t.test(change,()=>fixture(async f=>{
  if(change==="missing-slot")await f.db.query("UPDATE calendar_entries SET task_id=NULL");
  if(change==="duplicate-slot")await f.db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,'2030-10-16','shortform',$2,'2030-10-13T04:30Z','2030-10-13T04:30Z',$3,$4,$5)",[randomUUID(),post,f.source.id,f.task.id,JSON.stringify(f.schedule)]);
  if(change==="no-account")f.runtime.accounts=[];
  if(change==="ambiguous-account")f.runtime.accounts!.push({...f.runtime.accounts![0],id:"another"});
  await assert.rejects(f.preview(),/Exactly one/);await noApproval(f.db);
 }));
});

test("failure saving publication approval rolls back content, outbox and both audit bindings",()=>fixture(async f=>{
 const broken:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,params)=>{if(sql.startsWith("INSERT INTO publishing_approvals"))throw Error("Injected approval failure");return tx.query(sql,params);}}))};
 await assert.rejects(approveApprovalPlan(broken,f.runtime,f.body),/Injected/);await noApproval(f.db);assert.equal((await f.db.query("SELECT * FROM events WHERE kind='calendar_publication_approved'")).length,0);
}));

test("approved plan is rechecked at dispatch for calendar changes and source revocation",async t=>{
 for(const change of ["calendar","source"] as const)await t.test(change,()=>fixture(async f=>{
  await approveApprovalPlan(f.db,f.runtime,f.body);
  if(change==="calendar")await f.db.query("UPDATE calendar_entries SET task_id=NULL WHERE id=$1",[f.entry]);else await f.intake.revoke(f.source.id,f.source.hash);
  f.due();f.runtime.enabled=true;assert.equal((await new Publishing(f.db,f.runtime).dispatch(new Date(post))).status,"blocked");assert.deepEqual(f.counts(),{calls:0,credentials:0});
  if(change==="source"){
   await f.intake.clear(f.source.id,f.source.hash,true);
   const next="2030-10-16T04:30:00Z";await f.db.query("UPDATE calendar_entries SET intended_post=$2,platform_schedule=$3 WHERE id=$1",[f.entry,next,JSON.stringify({...f.schedule,LinkedIn:{...f.schedule.LinkedIn,intended_post:next}})]);
   const fresh=await f.preview();await approveApprovalPlan(f.db,f.runtime,{...f.body,expected_plan:fresh.version});
   assert.equal((await f.db.query("SELECT * FROM approvals")).length,1,"Historical content approval remains immutable");assert.equal((await f.db.query("SELECT * FROM evidence_approval_receipts")).length,2,"Reclearance requires an explicitly approved new source receipt");
   assert.equal((await f.db.query("SELECT * FROM publishing_outbox WHERE status='approved'")).length,1);assert.deepEqual(f.counts(),{calls:0,credentials:0});
  }
 }));
});

test("uncertain delivery cannot be replayed through the combined approval action",()=>fixture(async f=>{
 await approveApprovalPlan(f.db,f.runtime,f.body);f.runtime.fetch=async()=>{throw Error("Simulated lost response");};f.runtime.enabled=true;f.due();assert.equal((await new Publishing(f.db,f.runtime).dispatch(new Date(post))).status,"uncertain");
 // A future replacement slot cannot turn uncertainty into permission to send again.
 await f.db.query("UPDATE calendar_entries SET intended_post=$2,platform_schedule=$3 WHERE id=$1",[f.entry,"2030-10-16T04:30:00Z",JSON.stringify({...f.schedule,LinkedIn:{...f.schedule.LinkedIn,intended_post:"2030-10-16T04:30:00Z"}})]);
 const next=await f.preview();await assert.rejects(approveApprovalPlan(f.db,f.runtime,{...f.body,expected_plan:next.version}),/reconciliation|replay/);assert.equal((await f.db.query("SELECT * FROM publishing_outbox")).length,1);
}));

test("exact revision and individual evidence decisions bind the plan; withdrawal invalidates preview and delivery",()=>fixture(async f=>{
 await f.store.revise(f.task.id,f.plan.review_token,"Compare responsibility wording",{role:"Writer",text:"The project owner uses AI agents for implementation while retaining final approval."});
 let review=(await f.store.snapshot()).reviews[0];assert.equal(review.quality.flags.length,1);
 const quote="I use AI agents for implementation while retaining final approval.",start=f.source.text.indexOf(quote),finding=review.quality.flags[0];
 const decision={binding:review.quality.binding,finding_id:finding.id,decision:"accept",reason:"The wording retains the cleared responsibility statement.",source_span:{start,end:start+quote.length},source_quote:quote,acknowledged:true};
 await f.store.reviewEvidence(f.task.id,review.token,decision);
 const first=await previewApprovalPlan(f.db,f.runtime,f.task.id,review.token),body={...f.body,review_token:review.token,expected_plan:first.version};assert(first.evidence_version);
 await f.store.reviewEvidence(f.task.id,review.token,{...decision,decision:"withdraw"});
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,body),/source-grounding/);await noApproval(f.db);
 await f.store.reviewEvidence(f.task.id,review.token,decision);
 const current=await previewApprovalPlan(f.db,f.runtime,f.task.id,review.token);assert.notEqual(current.version,first.version);
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,body),/plan changed/);await noApproval(f.db);
 await approveApprovalPlan(f.db,f.runtime,{...body,expected_plan:current.version});assert.equal((await f.db.query("SELECT * FROM approvals")).length,0);assert.equal((await f.db.query("SELECT * FROM revision_approvals")).length,1);
 await f.store.reviewEvidence(f.task.id,review.token,{...decision,decision:"withdraw"});review=(await f.store.snapshot()).reviews[0];assert.equal(review.approval,null);
 f.runtime.enabled=true;f.due();assert.equal((await new Publishing(f.db,f.runtime).dispatch(new Date(post))).status,"blocked");assert.deepEqual(f.counts(),{calls:0,credentials:0});
},false,"The project is a drafting prototype. I use AI agents for implementation while retaining final approval."));

test("publication admission takes the calendar guard before outbox locks and releases the transaction before transport",()=>fixture(async f=>{
 await approveApprovalPlan(f.db,f.runtime,f.body);f.runtime.enabled=true;f.due();
 const transactions:string[][]=[];let active=0;
 const guarded:Database={...f.db,transaction:work=>f.db.transaction(async tx=>{const sqls:string[]=[];transactions.push(sqls);active++;try{return await work({query:async(sql,params)=>{sqls.push(sql);return tx.query(sql,params);}});}finally{active--;}})};
 f.runtime.fetch=async()=>{assert.equal(active,0,"No transaction can be held across provider I/O");return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:12345"}});};
 assert.equal((await new Publishing(guarded,f.runtime).dispatch(new Date(post))).status,"published");
 const admission=transactions.find(sqls=>sqls.some(sql=>sql.startsWith("INSERT INTO publishing_attempts")));assert(admission);
 assert.equal(admission[0],"SELECT id FROM calendar_settings WHERE id=1 FOR SHARE");
 assert(admission.findIndex(sql=>sql.includes("FROM calendar_entries"))<admission.findIndex(sql=>sql.startsWith("INSERT INTO publishing_attempts")));
 for(const sqls of transactions.filter(sqls=>sqls.some(sql=>sql.includes("publishing_outbox")&&sql.includes("FOR UPDATE"))))assert.equal(sqls[0],"SELECT id FROM calendar_settings WHERE id=1 FOR SHARE");
}));


test("exact approval preview binds configured scheduler policy; policy change cannot reuse approval and unsupported time is rejected",()=>fixture(async f=>{
 const at="2030-10-14T16:30:00.000Z";
 await f.db.query("UPDATE calendar_entries SET intended_post=$2,platform_schedule=$3 WHERE id=$1",[f.entry,at,JSON.stringify({...f.schedule,LinkedIn:{...f.schedule.LinkedIn,intended_post:at}})]);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy(fixedSettings().scheduler);
 const plan=await f.preview();assert.equal(plan.scheduler_policy_hash,f.runtime.scheduler_window_policy.hash);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy(fixedSettings(false).scheduler);
 const changed=await f.preview();assert.notEqual(changed.version,plan.version);
 await assert.rejects(approveApprovalPlan(f.db,f.runtime,{...f.body,expected_plan:plan.version}),/plan changed/);await noApproval(f.db);
 const row=await approveApprovalPlan(f.db,f.runtime,{...f.body,expected_plan:changed.version});assert.equal(row.scheduler_policy_hash,changed.scheduler_policy_hash);
 const event=(await f.db.query("SELECT detail FROM events WHERE kind='calendar_publication_approved'"))[0];assert.equal(JSON.parse(event.detail).scheduler_policy_hash,changed.scheduler_policy_hash);
 const unsupported="2030-10-14T16:32:00Z";
 await f.db.query("UPDATE calendar_entries SET intended_post=$2,platform_schedule=$3 WHERE id=$1",[f.entry,unsupported,JSON.stringify({...f.schedule,LinkedIn:{...f.schedule.LinkedIn,intended_post:unsupported}})]);
 await assert.rejects(f.preview(),/exact configured UTC anchor/);assert.deepEqual(f.counts(),{calls:0,credentials:0});
}));

test("V2 preview binds the exact final-post acknowledgement before hashing; cached V1 assent cannot create approvals",()=>fixture(async f=>{
 const {version,...values}=f.plan;
 assert.equal(version,hash(JSON.stringify(values)));
 assert.equal(f.plan.acknowledgement_version,2);
 assert.equal(f.plan.acknowledgement_hash,hash(f.plan.acknowledgement));
 const legacyValues=Object.fromEntries(Object.entries(values).filter(([key])=>!key.startsWith("acknowledgement")));
 const legacyPlan=hash(JSON.stringify(legacyValues));assert.notEqual(version,legacyPlan);
 const legacyBody={task_id:f.task.id,review_token:f.plan.review_token,expected_plan:version,acknowledged:true};
 for(const input of [legacyBody,{...f.body,expected_plan:legacyPlan},{...f.body,acknowledgement_version:1},{...f.body,acknowledgement_version:3},{...f.body,acknowledgement:"I reviewed all six artifacts"},{...f.body,acknowledgement_hash:hash("altered")}]){
  await assert.rejects(approveApprovalPlan(f.db,f.runtime,input),/request required|acknowledgement|plan changed/);
  await noApproval(f.db);
 }
 assert.deepEqual(f.counts(),{calls:0,credentials:0});
 const before=await f.db.query("SELECT * FROM events ORDER BY id");
 await f.preview();assert.deepEqual(await f.db.query("SELECT * FROM events ORDER BY id"),before,"Preview must not manufacture owner action or migrate receipts");
 await noApproval(f.db);
}));

test("V2 consent records only the final-post scope and keeps exact contract text/hash in immutable receipts",async t=>{
 for(const revised of [false,true])await t.test(revised?"revision":"original",()=>fixture(async f=>{
  let plan=f.plan;
  if(revised){await f.store.revise(f.task.id,plan.review_token,"Shorten proposal",{role:"Platform Adapter",text:"### LinkedIn\nProposed approach: inspect the source."});const review=(await f.store.snapshot()).reviews[0];plan=await previewApprovalPlan(f.db,f.runtime,f.task.id,review.token);}
  await approveApprovalPlan(f.db,f.runtime,{...f.body,review_token:plan.review_token,expected_plan:plan.version});
  const events=await f.db.query<{kind:string;detail:string}>("SELECT kind,detail FROM events WHERE task_id=$1 ORDER BY id",[f.task.id]);
  const receipt=JSON.parse(events.find(event=>event.kind==="calendar_publication_approved")!.detail);
  for(const [key,value] of Object.entries(APPROVAL_PLAN_CONTRACT_V2))assert.equal(receipt[key],value);
  assert.equal(receipt.plan_version,plan.version);
  const contentEvent=events.find(event=>event.kind===(revised?"revision_approved":"approved"))!;
  assert.match(contentEvent.detail,/Owner approved the exact final LinkedIn post/);assert.doesNotMatch(contentEvent.detail,/after factual review|reviewed all six|reviewed.*source/);
  const before=await f.db.query("SELECT * FROM events ORDER BY id");await previewApprovalPlan(f.db,f.runtime,f.task.id,plan.review_token);
  assert.deepEqual(await f.db.query("SELECT * FROM events ORDER BY id"),before);
  assert.deepEqual(f.counts(),{calls:0,credentials:0});
 }));
});

test("valid legacy V1 receipts remain unchanged and deliver under existing exact content/account/time guards",async t=>{
 for(const change of ["none","content","account","calendar"] as const)await t.test(change,()=>fixture(async f=>{
  await f.store.approve(f.task.id,f.plan.review_token.slice("original:".length));
  const publisher=new Publishing(f.db,f.runtime),row=await publisher.enqueue({request_id:randomUUID(),task_id:f.task.id,review_token:f.plan.review_token,platform:"LinkedIn",account_id:f.plan.account_id,scheduled_at:f.plan.scheduled_at,payload:{text:f.plan.text},delivery_mode:"scheduled"});
  await publisher.approve(row.id,row.version,true);
  const receipt=JSON.stringify({outbox_id:row.id,entry_id:f.entry,calendar_binding:f.plan.calendar_binding,plan_version:hash("legacy exact plan"),scheduler_policy_hash:null,acknowledgement:APPROVAL_PLAN_ACK});
  const eventId=randomUUID();await f.db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'calendar_publication_approved',$3)",[eventId,f.task.id,receipt]);
  const before=await f.db.query("SELECT * FROM events WHERE id=$1",[eventId]);await f.preview();
  assert.deepEqual(await f.db.query("SELECT * FROM events WHERE id=$1",[eventId]),before);
  if(change==="content")await f.store.revise(f.task.id,f.plan.review_token,"Shorten proposal",{role:"Platform Adapter",text:"### LinkedIn\nProposed approach: inspect the source."});
  if(change==="account")f.runtime.accounts![0].authorization_version="reconnected";
  if(change==="calendar")await f.db.query("UPDATE calendar_entries SET task_id=NULL WHERE id=$1",[f.entry]);
  f.runtime.enabled=true;f.due();const result=await publisher.dispatch(new Date(post));
  assert.equal(result.status,change==="none"?"published":"blocked");
  assert.deepEqual(f.counts(),change==="none"?{calls:1,credentials:1}:{calls:0,credentials:0});
  assert.deepEqual(await f.db.query("SELECT * FROM events WHERE id=$1",[eventId]),before);
 }));
});
