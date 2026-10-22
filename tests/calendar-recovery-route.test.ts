import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {SourceIntake} from "../lib/sources";
import {GET,POST} from "../app/api/studio/[action]/route";
import type {RuntimeConfig} from "../lib/domain";

test("owner recovery route enforces auth, Origin and exact confirmation, exposes snapshot and never generates",async()=>{
 const db=await embedded(),globals=globalThis as typeof globalThis&{studioDb?:Promise<any>},savedEnv={...process.env},originalFetch=globalThis.fetch;
 globals.studioDb=Promise.resolve(db);let calls=0;globalThis.fetch=async()=>{calls++;throw Error("Outbound request forbidden");};
 const origin="http://127.0.0.1:3199",token="isolated-calendar-recovery-owner-token-000000000000";
 Object.assign(process.env,{STUDIO_ORIGIN:origin,STUDIO_ACCESS_TOKEN:token,STUDIO_RUNTIME_CONFIG:"{}",OPENAI_API_KEY:"",GEMINI_API_KEY:"",STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:""});delete process.env.VERCEL;
 const invoke=(body:unknown,authorization=token,from=origin)=>POST(new Request(origin+"/api/studio/calendar-recover",{method:"POST",headers:{Authorization:"Bearer "+authorization,Origin:from,"Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({action:"calendar-recover"})});
 const state=async()=>{const response=await GET(new Request(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}}),{params:Promise.resolve({action:"state"})});assert.equal(response.status,200);return response.json();};
 try{
  const hour=3_600_000,now=new Date(),dispatch=new Date(now.getTime()-25*hour),review=new Date(now.getTime()-hour),post=new Date(review.getTime()+48*hour),calendar=new Calendar(db),intake=new SourceIntake(db);
  const staged=await intake.stage({text:"I built a review screen and found a missing date in my notes.",category:"build-log",reported_date:dispatch.toISOString().slice(0,10)}),source=await intake.clear(staged.id,staged.hash,true),entry=randomUUID();
  const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:dispatch.toISOString().slice(0,10),fallback_authorized:false,openai:{model:"gpt-test",pricing_version:"isolated-recovery",pricing_tier:"standard",official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"}};
  await db.query("UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=72 WHERE id=1");await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6)",[entry,post.toISOString().slice(0,10),post,review,dispatch,source.id]);assert.equal((await calendar.dispatchDue(config,true,dispatch)).queued,1);
  const before=await state(),recovery=before.calendar.entries[0].recovery;assert.equal(recovery.eligible,true);assert.equal(before.live_enabled,false);
  const body={entry,expected:recovery.expected,planned_date:new Date(now.getTime()+240*hour).toISOString().slice(0,10),post_time:"10:00",generation_lead_hours:120,reason:"Move the missed review window",acknowledged:true};
  assert.equal((await invoke(body,"wrong-token")).status,401);assert.equal((await invoke(body,token,"https://other.example")).status,403);
  const missing=await invoke({...body,acknowledged:false});assert.equal(missing.status,400);assert.match((await missing.json()).error,/Acknowledge/);
  const result=await invoke(body);assert.equal(result.status,200);assert.equal((await result.json()).result.queued,false);
  const stale=await invoke(body);assert.equal(stale.status,400);assert.match((await stale.json()).error,/stale/);
  const after=await state();assert.equal(after.tasks.length,1);assert.equal(after.tasks[0].status,"cancelled");assert.equal(after.calendar.entries.length,2);assert.equal(after.ledger.length,0);assert.equal(after.approvals.length,0);assert.equal(after.integrations.publishing.jobs.length,0);assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;delete globals.studioDb;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await db.close();}
});
