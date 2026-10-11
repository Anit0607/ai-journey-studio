import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {CAPSULE,hash,type RuntimeConfig} from "../lib/domain";
import {step} from "../lib/workflow";
const config:RuntimeConfig={source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),openai:{model:"isolated-fixture",pricing_version:"test",pricing_tier:"standard",official_pricing_url:"https://example.test",input_microdollars_per_token:"0.4",output_microdollars_per_token:"1.6"}};
test("historical prohibited intermediate artifact is blocked before reservation or provider transmission",async()=>{
 const db=await embedded();try{
  const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id),text="PASSWORD=isolated-nonsecret-fixture";
  await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,'Harvester',$3,$4)",[randomUUID(),task.id,text,hash(text)]);
  await db.query("UPDATE tasks SET checkpoint=1 WHERE id=$1",[task.id]);
  let calls=0;const result=await step(store,config,async()=>{calls++;throw Error("Must not call");},true);
  assert.equal(result.status,"blocked");assert.equal(calls,0);const state=await store.snapshot();assert.equal(state.ledger.length,0);assert.equal(state.outputs[0].text,text,"Historical evidence is preserved unchanged");
 }finally{await db.close();}
});
test("queued scheduled work waking after its frozen review deadline makes no provider call",async()=>{
 const db=await embedded();try{
  const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
  await db.query("UPDATE tasks SET origin_key='calendar:isolated',content_brief=$2 WHERE id=$1",[task.id,JSON.stringify({kind:"shortform",review_due:new Date(Date.now()-1000).toISOString()})]);
  let calls=0;const result=await step(store,config,async()=>{calls++;throw Error("Must not call");},true);
  assert.equal(result.status,"blocked");assert.equal(calls,0);assert.equal((await store.snapshot()).ledger.length,0);
 }finally{await db.close();}
});
