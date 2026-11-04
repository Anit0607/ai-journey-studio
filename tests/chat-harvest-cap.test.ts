import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {step} from "../lib/workflow";
import {importOwnerChats} from "../lib/chat-import";
import {providerCall,OUTPUT_TOKEN_CAP,CHAT_HARVEST_OUTPUT_TOKEN_CAP} from "../lib/providers";
import type {Pricing,RuntimeConfig} from "../lib/domain";
import {enqueueLegacy} from "./legacy-task-fixture";

const pricing:Pricing={model:"cap-fixture",pricing_version:"fixture",pricing_tier:"standard",official_pricing_url:"https://example.test/fixture",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
const completion=(text:string)=>({text,input:100,output:100,outcome:"complete" as const,report:{serviceTier:"default",model:pricing.model,requestId:"r",finishReason:"stop"}});
const mine="I tried to make the scheduler sleep and it broke twice before I finally fixed it by checking the clock first.";

test('the request carries the stage output ceiling',async()=>{
 const bodies:any[]=[];
 const transport=async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({model:pricing.model,service_tier:"default",choices:[{finish_reason:"stop",message:{content:"ok"}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200,headers:{"x-request-id":"r"}});};
 await providerCall("openai","p",pricing,transport as typeof fetch,()=>"k");
 await providerCall("openai","p",pricing,transport as typeof fetch,()=>"k",undefined,CHAT_HARVEST_OUTPUT_TOKEN_CAP);
 assert.deepEqual(bodies.map(b=>b.max_completion_tokens),[OUTPUT_TOKEN_CAP,CHAT_HARVEST_OUTPUT_TOKEN_CAP]);
});

test('the Harvester on an imported chat gets the larger ceiling, other sources keep the default, and the reservation covers it',async()=>{
 const db=await embedded();try{
  const store=new Store(db);
  await importOwnerChats(db,{conversations:[{provider:"claude",id:"c",title:"Scheduler",reported_date:"2026-10-30",messages:[{text:mine,date:"2026-10-30"},{text:mine+" Again.",date:"2026-10-30"}]}]},new Date("2026-10-31T06:00:00Z"),true);
  const chat=(await db.query<{id:string}>("SELECT id FROM sources WHERE category='owner-chat'"))[0];
  const intake=new SourceIntake(db),note=await intake.stage({text:"I built a source-linked outline and reviewed each generated statement.",category:"build-log",reported_date:"2026-10-23"});await intake.clear(note.id,note.hash,true);
  const caps:Record<string,number>={};
  for(const [name,id] of [["chat",chat.id],["note",note.id]] as const){
   await enqueueLegacy(store,id);
   await step(store,config,async(...args:unknown[])=>{caps[name]=args[6] as number;return completion("Proposed approach: inspect one source and keep the owner's words.");},true);
  }
  assert.deepEqual(caps,{chat:CHAT_HARVEST_OUTPUT_TOKEN_CAP,note:OUTPUT_TOKEN_CAP});
  const reserved=Number((await db.query<{reserved:string}>("SELECT l.reserved FROM ledger l JOIN tasks t ON t.id=l.task_id WHERE t.source_id=$1",[chat.id]))[0].reserved);
  assert(reserved>=CHAT_HARVEST_OUTPUT_TOKEN_CAP*1.6,'the reservation covers the larger ceiling at the output price');
 }finally{await db.close();}
});
