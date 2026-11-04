import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {ntfyNotifier,eventRecorder,notifierBlocker,NOTICE_EVENT} from "../lib/notify";

const env={STUDIO_NTFY_TOPIC:"ajs-"+"t".repeat(20)};
const notice={title:"Draft ready to approve",message:"secret post words"};

test('every notice attempt is recorded with ntfy\'s answer and never the message',async()=>{
 const db=await embedded();try{
  const record=eventRecorder(db);
  await ntfyNotifier(env,async()=>new Response("",{status:200}),record)!(notice);
  await ntfyNotifier(env,async()=>new Response("",{status:429}),record)!(notice);
  await ntfyNotifier(env,async()=>{throw Object.assign(new Error("x"),{name:"TimeoutError"});},record)!(notice);
  const rows=await db.query<{detail:string}>("SELECT detail FROM events WHERE kind=$1 ORDER BY created",[NOTICE_EVENT]);
  assert.deepEqual(rows.map(r=>JSON.parse(r.detail).outcome),["accepted 200","refused 429","unreachable TimeoutError"]);
  assert(rows.every(r=>!r.detail.includes("secret")),'no post words are stored');
 }finally{await db.close();}
 await ntfyNotifier(env,async()=>new Response("",{status:200}),async()=>{throw Error("db down");})!(notice);
 assert.equal(notifierBlocker({}),"STUDIO_NTFY_TOPIC is not set");assert.equal(notifierBlocker({STUDIO_NTFY_TOPIC:"short"}),"STUDIO_NTFY_TOPIC is not a valid topic name");assert.equal(notifierBlocker(env),null);
});

test('the notification test route needs the assistant credential and studio origin',async()=>{
 const {handleNotifyTest}=await import("../lib/autopilot-http");
 const e={...env,STUDIO_ASSISTANT_EDIT_TOKEN:"assist-"+"s".repeat(40),STUDIO_ORIGIN:"https://studio.example.test",STUDIO_ACCESS_TOKEN:"worker-"+"w".repeat(40)};
 const req=(auth?:string,origin?:string)=>new Request("https://studio.example.test/api/notify-test",{method:"POST",headers:{...(auth?{Authorization:"Bearer "+auth}:{}),...(origin?{Origin:origin}:{})}});
 let sent=0;const transport=async()=>{sent++;return new Response("",{status:200});};
 assert.equal((await handleNotifyTest(req(),e,transport)).status,401);
 assert.equal((await handleNotifyTest(req(e.STUDIO_ACCESS_TOKEN,e.STUDIO_ORIGIN),e,transport)).status,401);
 assert.equal((await handleNotifyTest(req(e.STUDIO_ASSISTANT_EDIT_TOKEN,"https://other.example.test"),e,transport)).status,401);
 assert.equal(sent,0);
 const missing=await handleNotifyTest(req(e.STUDIO_ASSISTANT_EDIT_TOKEN,e.STUDIO_ORIGIN),{...e,STUDIO_NTFY_TOPIC:undefined},transport);
 assert.deepEqual(await missing.json(),{outcome:"not_configured",reason:"STUDIO_NTFY_TOPIC is not set"});
});
