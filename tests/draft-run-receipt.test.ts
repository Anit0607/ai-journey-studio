import test from 'node:test';
import assert from 'node:assert/strict';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {DRAFT_PROMPT_PREPARED,DRAFT_OUTPUT_RECORDED} from '../lib/draft-run-receipt';
import {OWNER_WRITING_PROFILE} from '../lib/owner-writing-profile';
import {hash,tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';
const pricing:Pricing={model:'isolated-style-fixture',pricing_version:'fixture-only',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
async function fixture(work:(f:{store:Store;task:any;db:Awaited<ReturnType<typeof embedded>>})=>Promise<void>){const db=await embedded();try{const store=new Store(db),intake=new SourceIntake(db),source=await intake.stage({text:'I asked the agent to list the background timers.',reported_date:'2026-10-25',category:'project-note'});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);await db.query('UPDATE tasks SET checkpoint=3 WHERE id=$1',[task.id]);await work({store,task,db});}finally{await db.close();}}
const completion={text:'Proposed question: which timers can pause?',input:10,output:10,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-no-network',finishReason:'stop'}};
test('reservation and exact prompt/style metadata commit together; recorded output links the same reservation without new approval',()=>fixture(async({store,task,db})=>{
 let calls=0;const result=await step(store,config,async(_provider,prompt,p)=>{
  calls++;const rows=await db.query<any>('SELECT * FROM ledger WHERE task_id=$1',[task.id]);assert.equal(rows.length,1);
  const event=(await db.query<any>('SELECT detail FROM events WHERE task_id=$1 AND kind=$2',[task.id,DRAFT_PROMPT_PREPARED]))[0],receipt=JSON.parse(event.detail);
  assert.equal(receipt.reservation_id,rows[0].id);assert.equal(receipt.prompt_hash,hash(prompt));assert.equal(receipt.prompt_bytes,Buffer.byteLength(prompt));assert.equal(receipt.writing_profile.hash,OWNER_WRITING_PROFILE.hash);
  assert.equal(Number(rows[0].reserved),tokenCost(p,Buffer.byteLength(prompt)+256,1200));assert(!event.detail.includes('I asked the agent'));
  return completion;
 },true);assert.equal(result.status,'step_saved');assert.equal(calls,1);
 const rows=await db.query<any>('SELECT * FROM ledger WHERE task_id=$1',[task.id]),outputs=await db.query<any>('SELECT * FROM outputs WHERE task_id=$1',[task.id]);
 const receipt=JSON.parse((await db.query<any>('SELECT detail FROM events WHERE task_id=$1 AND kind=$2',[task.id,DRAFT_OUTPUT_RECORDED]))[0].detail);assert.equal(receipt.reservation_id,rows[0].id);assert.equal(receipt.artifact_hash,outputs[0].hash);
 assert.equal((await db.query('SELECT task_id FROM approvals')).length,0);assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
}));
test('failed prompt receipt rolls back its reservation and prevents the provider call',()=>fixture(async({store,task,db})=>{
 const event=store.event.bind(store);store.event=async(tx,id,kind,detail)=>{if(kind===DRAFT_PROMPT_PREPARED)throw Error('isolated receipt failure');return event(tx,id,kind,detail);};
 let calls=0;const result=await step(store,config,async()=>{calls++;return completion;},true);assert.equal(result.status,'blocked');assert.equal(calls,0);
 assert.equal((await db.query('SELECT id FROM ledger WHERE task_id=$1',[task.id])).length,0);assert.equal((await db.query('SELECT id FROM outputs WHERE task_id=$1',[task.id])).length,0);
}));
test('a prepared reservation can stop before transmission, and never gains a saved-output receipt',()=>fixture(async({store,task,db})=>{
 let calls=0;const result=await step(store,config,async()=>{calls++;return completion;},true,{beforeProvider:async()=>{throw Error('Owner draft execution stopped');}});assert.equal(result.status,'blocked');assert.equal(calls,0);
 assert.equal((await db.query('SELECT id FROM events WHERE task_id=$1 AND kind=$2',[task.id,DRAFT_PROMPT_PREPARED])).length,1);assert.equal((await db.query('SELECT id FROM events WHERE task_id=$1 AND kind=$2',[task.id,DRAFT_OUTPUT_RECORDED])).length,0);
 const state=await store.snapshot(),run=state.reviews[0].contributions.roles[3].runs[0];assert.equal(run.attempts[0].receipt_state,'prepared_not_proof_of_transmission');assert.equal(run.usage.estimated_microdollars,null);
}));
test('failed output receipt rolls back output and settlement, retaining uncertain usage rather than retrying',()=>fixture(async({store,task,db})=>{
 const event=store.event.bind(store);store.event=async(tx,id,kind,detail)=>{if(kind===DRAFT_OUTPUT_RECORDED)throw Error('isolated output receipt failure');return event(tx,id,kind,detail);};
 let calls=0;const result=await step(store,config,async()=>{calls++;return completion;},true);assert.equal(result.status,'blocked');assert.equal(calls,1);
 assert.equal((await db.query('SELECT id FROM outputs WHERE task_id=$1',[task.id])).length,0);assert.equal((await db.query<any>('SELECT status FROM ledger WHERE task_id=$1',[task.id]))[0].status,'unknown');
 assert.equal((await step(store,config,async()=>{calls++;return completion;},true)).status,'idle');assert.equal(calls,1);
}));
