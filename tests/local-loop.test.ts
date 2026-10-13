import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {Calendar} from "../lib/calendar";
import {queueAgentRevision} from "../lib/agent-revisions";
import {step} from "../lib/workflow";
import type {RuntimeConfig} from "../lib/domain";
import type {Completion} from "../lib/providers";

test("isolated complete local loop survives restart and requires fresh revision approval",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"studio-loop-")),location=path.join(directory,"db");
 let db:Database=await embedded(location),calls=0;
 const now=new Date(),hour=3_600_000;
 const sourceText="I built a content review screen. I found unsupported claims during a test run. I retained final approval.";
 const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:now.toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-loop",pricing_version:"fixture",pricing_tier:"standard",official_pricing_url:"https://example.test",input_microdollars_per_token:"0.4",output_microdollars_per_token:"1.6"}};
 const mock=async(provider:string,prompt:string):Promise<Completion>=>{
  calls++;assert.equal(provider,"openai");assert(prompt.includes(sourceText));
  return {text:prompt.startsWith("You are Critic.")?"Unsupported claims: none\nEvidence needed: none for quoted statements\nProposed advice: review the source":sourceText,input:10,output:10,outcome:"complete",report:{model:"isolated-loop",serviceTier:"default",requestId:"isolated-"+calls,finishReason:"stop"}};
 };
 try{
  let store=new Store(db);const intake=new SourceIntake(db);const staged=await intake.stage({text:sourceText,category:"build-log",reported_date:now.toISOString().slice(0,10)});
  assert.equal(calls,0);await intake.clear(staged.id,staged.hash,true);
  const calendar=new Calendar(db);await calendar.configure({start_date:new Date(now.getTime()+72*hour).toISOString().slice(0,10),post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:72,generation_enabled:true});
  const entry=randomUUID(),posting=new Date(now.getTime()+72*hour),review=new Date(now.getTime()+24*hour);
  await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id) VALUES($1,$2,'longform',$3,$4,$4,$5,$6)",[entry,posting.toISOString().slice(0,10),posting,review,now,staged.id]);
  assert.equal((await calendar.dispatchDue(config,true,now)).queued,1);
  assert.equal((await calendar.dispatchDue(config,true,now)).queued,0);
  for(let index=0;index<6;index++)assert.equal((await step(store,config,mock,true)).status,"step_saved");
  let state=await store.snapshot();const parent=state.tasks[0];assert.equal(parent.status,"review");assert.equal(state.reviews[0].quality.flags.length,0);assert.equal(calls,6);
  await store.approve(parent.id,state.reviews[0].token.slice("original:".length));
  state=await store.snapshot();const original=JSON.stringify(state.outputs),approval=JSON.stringify(state.approvals);
  const child=await queueAgentRevision(store,config,parent.id,state.reviews[0].token,"Shorten the structure while preserving exact source sentences.");
  assert.equal(child.content_brief?.kind,"longform");
  for(let index=0;index<3;index++)await step(store,config,mock,true);
  await db.close();db=await embedded(location);store=new Store(db);
  for(let index=0;index<3;index++)await step(store,config,mock,true);
  state=await store.snapshot();assert.equal(calls,12);assert.equal(state.reviews[0].approval,null);assert(state.reviews[0].latest_revision);
  assert.equal(JSON.stringify(state.outputs.filter((output:any)=>output.task_id===parent.id)),original);assert.equal(JSON.stringify(state.approvals),approval);
  await assert.rejects(store.approveRevision(parent.id,state.reviews[0].token,false),/acknowledgement/);
  await store.approveRevision(parent.id,state.reviews[0].token,true);
  state=await store.snapshot();assert(state.reviews[0].approval);assert.equal(state.budget.unresolved_reservations,0);
  assert.equal((await new Calendar(db).dispatchDue(config,true)).queued,0);assert.equal(calls,12);
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
