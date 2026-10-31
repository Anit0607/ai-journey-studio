import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {importOwnerChats} from "../lib/chat-import";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";
import {runAutopilot,storyScore,AUTOPILOT_EVENT} from "../lib/autopilot";
import type {RuntimeConfig,Source} from "../lib/domain";
import type {OwnerNotice} from "../lib/notify";

const now=new Date("2026-11-01T01:30:00Z");
const pricing={model:"m",pricing_version:"v",pricing_tier:"standard" as const,official_pricing_url:"https://example.test",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:"2026-10-30",pricing_window_authorized:true,pricing_valid_until:"until-changed",openai:pricing,fallback_authorized:false};
const story="I tried to make the scheduler sleep and it broke twice. I finally fixed it by checking the clock first, and I learned to test with real timing.";
const plain="This is a long message about a meeting agenda and a list of topics for the next review session with the team.";
async function entry(db:Database,post:string,planned:string){const id=randomUUID(),review=new Date(Date.parse(post)-48*3_600_000).toISOString();await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,platform_schedule) VALUES($1,$2,'shortform',$3,$4,$4,$5)",[id,planned,post,review,JSON.stringify({LinkedIn:{intended_post:post,draft_due:review,review_due:review},platform_policy:NEW_PLATFORM_POLICY})]);return id;}
async function seed(db:Database){
 await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
 const chat=(id:string,text:string)=>({provider:"chatgpt",id,title:"",reported_date:"2026-10-30",messages:[{text,date:"2026-10-30"},{text:text+" Again.",date:"2026-10-30"}]});
 await importOwnerChats(db,{conversations:[chat("a",story),chat("b",plain)]},new Date("2026-10-31T06:00:00Z"),true);
 return entry(db,"2026-11-03T03:30:00.000Z","2026-11-03");
}
// Stands in for the capped six-stage run: marks the task reviewable, as a successful run would.
const draft=async(db:Database,input:{task_id:string})=>{await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[input.task_id]);return {task_id:input.task_id,status:"review" as const,steps:6};};
const run=(db:Database,extra:Record<string,unknown>={})=>{const sent:OwnerNotice[]=[];return runAutopilot(db,{readConfig:()=>config,isReady:()=>true,now:()=>now,draft:draft as never,notify:async notice=>{sent.push(notice);},dashboard:"https://studio.example.test",actor:"scheduler",...extra}).then(result=>({result,sent}));};

test('the story agent ranks concrete first-person episodes above plain notes',()=>{
 const source=(text:string,category="owner-chat")=>({text,category,reported_date:"2026-10-30"} as Source);
 assert(storyScore(source(story),now)>0);assert.equal(storyScore(source(plain),now),0);
 assert(storyScore(source("Owner story interview (x). "+story,"user-reported-notes"),now)>storyScore(source(story),now),'owner-written Story Bank answers rank higher');
});

test('autopilot drafts the best unused story into the next free slot, then asks the owner to approve',async()=>{
 const db=await embedded();try{
  const slot=await seed(db);
  const {result,sent}=await run(db);
  assert.equal(result.status,"drafted");assert.equal(result.entry,slot);
  const task=(await db.query<any>("SELECT t.*,s.text FROM tasks t JOIN sources s ON s.id=t.source_id WHERE t.id=$1",[result.task]))[0];
  assert(task.text.includes("it broke twice"),'the story with real episodes was chosen');
  assert.equal(task.content_brief.audience,"india");assert.equal(task.content_brief.format,"post");assert.deepEqual(task.content_brief.platform_policy,NEW_PLATFORM_POLICY);
  assert.equal((await db.query<any>("SELECT task_id FROM calendar_entries WHERE id=$1",[slot]))[0].task_id,result.task,'the slot is linked after drafting');
  assert.equal(sent.length,1);assert.equal(sent[0].title,"Draft ready to approve");assert.equal(sent[0].click,"https://studio.example.test");assert(!sent[0].message.includes("broke"),'no post or story text in the alert');
  assert.match((await db.query<any>("SELECT detail FROM events WHERE kind=$1",[AUTOPILOT_EVENT]))[0].detail,/owner standing consent of 31 Oct 2026.*nothing is approved/);
  for(const table of ["approvals","revision_approvals","publishing_outbox","evidence_decisions"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table);
 }finally{await db.close();}
});

test('autopilot never reuses a story and stops at the daily limit',async()=>{
 const db=await embedded();try{
  await seed(db);await entry(db,"2026-11-05T03:30:00.000Z","2026-11-05");await entry(db,"2026-11-06T03:30:00.000Z","2026-11-06");
  assert.equal((await run(db)).result.status,"drafted");
  assert.equal((await run(db)).result.status,"no_story",'the only episode story is used; the plain note is never picked');
  await importOwnerChats(db,{conversations:[{provider:"claude",id:"c",title:"",reported_date:"2026-10-31",messages:[{text:story.replace("twice","three times"),date:"2026-10-31"},{text:"I decided to write it down and I noticed the logs were wrong.",date:"2026-10-31"}]}]},new Date("2026-10-31T06:00:00Z"),true);
  assert.equal((await run(db)).result.status,"drafted");
  assert.equal((await run(db)).result.status,"limit",'at most two drafts per day');
 }finally{await db.close();}
});

test('autopilot does nothing without a ready runtime, generation, a slot in range, or a successful draft',async()=>{
 const db=await embedded();try{
  const slot=await seed(db);
  assert.equal((await run(db,{isReady:()=>false})).result.status,"blocked");
  await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");assert.equal((await run(db)).result.status,"blocked");await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
  assert.equal((await run(db,{now:()=>new Date("2026-11-02T10:00:00Z")})).result.status,"no_slot",'a slot under 30 hours away is left for manual handling');
  const failed=await run(db,{draft:async(_db:Database,input:{task_id:string})=>({task_id:input.task_id,status:"blocked",steps:2})});
  assert.equal(failed.result.status,"blocked");assert.equal(failed.sent.length,0);
  assert.equal((await db.query<any>("SELECT task_id FROM calendar_entries WHERE id=$1",[slot]))[0].task_id,null,'a failed draft never takes the slot');
 }finally{await db.close();}
});

test('the autopilot route needs the cron secret or the assistant credential',async()=>{
 const {handleAutopilot}=await import('../lib/autopilot-http');
 const env={CRON_SECRET:"cron-"+"c".repeat(40),STUDIO_ACCESS_TOKEN:"worker-"+"w".repeat(40),STUDIO_AUTH_SECRET:"auth-"+"a".repeat(40),STUDIO_ASSISTANT_EDIT_TOKEN:"assist-"+"s".repeat(40),STUDIO_ORIGIN:"https://studio.example.test"};
 const req=(auth?:string,origin?:string)=>new Request("https://studio.example.test/api/autopilot",{method:"GET",headers:{...(auth?{Authorization:"Bearer "+auth}:{}),...(origin?{Origin:origin}:{})}});
 assert.equal((await handleAutopilot(req(),"scheduler",env)).status,401);
 assert.equal((await handleAutopilot(req(env.STUDIO_ACCESS_TOKEN),"scheduler",env)).status,401,'worker token is not the cron secret');
 assert.equal((await handleAutopilot(req(env.CRON_SECRET),"assistant",env)).status,401,'cron secret is not the assistant credential');
 assert.equal((await handleAutopilot(req(env.STUDIO_ASSISTANT_EDIT_TOKEN,"https://other.example.test"),"assistant",env)).status,401,'assistant runs need the studio origin');
});
