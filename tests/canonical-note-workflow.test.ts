import {criticCitationIndex} from '../lib/evidence-review';
import {queueAgentRevision} from '../lib/agent-revisions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {hash,tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';
import {canonicalNoteArtifacts} from './canonical-note-helpers';
import {providerResponseFormatBytes} from '../lib/critic-response-format';
import {DRAFT_OUTPUT_RECORDED} from '../lib/draft-run-receipt';
const observed=JSON.parse(readFileSync(new URL('./fixtures/owner-style-failed-note-2026-10-25.json',import.meta.url),'utf8'));
const pricing:Pricing={model:'isolated-canonical-note-fixture',pricing_version:'fixture-only',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
async function seed(db:Awaited<ReturnType<typeof embedded>>){const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage({...observed.source,category:'project-note'}),source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id),artifacts=canonicalNoteArtifacts(source,observed.outputs);return {db,store,source,task,artifacts};}
const completion=(text:string)=>({text,input:10,output:20,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-no-network',finishReason:'stop'}});
async function seedAt(f:Awaited<ReturnType<typeof seed>>,checkpoint:number,raw=false){for(const [n,a] of (raw?observed.outputs:f.artifacts).slice(0,checkpoint).entries())await f.db.query('INSERT INTO outputs(id,task_id,role,text,hash,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),f.task.id,a.role,a.text,a.hash,new Date(Date.UTC(2026,9,25,0,0,n)).toISOString()]);await f.db.query('UPDATE tasks SET checkpoint=$2 WHERE id=$1',[f.task.id,checkpoint]);}

test('invalid completed Story Miner settles paid usage and immutable output, durably stopping before Strategist',()=>fixture(async f=>{
 await seedAt(f,1);let calls=0;
 const result=await step(f.store,config,async(_provider,prompt,p,_transport,_key,contract)=>{calls++;assert.equal(contract?.artifact,'note');const row=(await f.db.query<any>('SELECT reserved FROM ledger WHERE task_id=$1',[f.task.id]))[0];assert.equal(Number(row.reserved),tokenCost(p,Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',contract)+256,1200));return completion(observed.outputs[1].text);},true);
 assert.equal(result.status,'blocked');assert.equal(calls,1);
 const task=(await f.db.query<any>('SELECT * FROM tasks WHERE id=$1',[f.task.id]))[0];assert.equal(task.status,'blocked');assert.equal(task.block_reason,'note_contract');assert.equal(task.checkpoint,2);
 const ledger=(await f.db.query<any>('SELECT * FROM ledger WHERE task_id=$1',[f.task.id]))[0];assert.equal(ledger.status,'settled');assert.equal(Number(ledger.estimated),36);assert.equal(ledger.input_tokens,10);assert.equal(ledger.output_tokens,20);
 const output=(await f.db.query<any>("SELECT * FROM outputs WHERE task_id=$1 AND role='Story Miner'",[f.task.id]))[0];assert.equal(output.text,observed.outputs[1].text);assert.equal(output.hash,observed.outputs[1].hash);
 assert.equal((await f.db.query('SELECT id FROM events WHERE task_id=$1 AND kind=$2',[f.task.id,DRAFT_OUTPUT_RECORDED])).length,1);
 assert.equal((await step(f.store,config,async()=>{calls++;throw Error('must not run');},true)).status,'idle');assert.equal(calls,1);
 await assert.rejects(f.store.retry(f.task.id));
 assert.equal((await f.db.query('SELECT task_id FROM approvals')).length,0);assert.equal((await f.db.query('SELECT id FROM publishing_outbox')).length,0);
}));
test('a saved legacy fabricated predecessor blocks before another reservation or call',()=>fixture(async f=>{
 await seedAt(f,2,true);let calls=0;const result=await step(f.store,config,async()=>{calls++;throw Error('must not run');},true);assert.equal(result.status,'blocked');assert.equal(calls,0);assert.equal((await f.db.query('SELECT id FROM ledger WHERE task_id=$1',[f.task.id])).length,0);assert.equal((await f.db.query('SELECT id FROM outputs WHERE task_id=$1',[f.task.id])).length,2);await assert.rejects(f.store.retry(f.task.id));
}));
test('valid canonical stages keep six paid calls and expose exact server-rendered selected evidence, without granting approval',()=>fixture(async f=>{
 const index=criticCitationIndex(f.artifacts.slice(0,5),f.source);const critic=JSON.stringify({schema:2,source_hash:f.source.hash,index_hash:index.index_hash,'Unsupported claims:':'Compare every current assertion to source.','Evidence needed:':'Human source comparison is required.','Proposed advice:':'Review the practical episode before approval.',evidence:[]});f.artifacts[5]={role:'Critic',text:critic,hash:hash(critic)};
 let calls=0;for(let cp=0;cp<6;cp++){const result=await step(f.store,config,async(_provider,_prompt,_p,_t,_k,contract)=>{calls++;assert.equal(contract?.artifact,cp<=2?'note':cp===5?'critic':undefined);return completion(f.artifacts[cp].text);},true);assert.equal(result.status,'step_saved');}
 assert.equal(calls,6);assert.equal((await f.db.query('SELECT id FROM ledger WHERE task_id=$1',[f.task.id])).length,6);
 const state=await f.store.snapshot(),review=state.reviews.find((r:any)=>r.task_id===f.task.id)!;for(const role of review.contributions.roles.slice(0,3)){const run=role.runs[0];assert(run.selected_facts);assert.equal(run.selected_facts.selection_artifact_hash,run.output!.hash);for(const fact of run.selected_facts.facts)assert.equal(fact.text,f.source.text.slice(fact.start,fact.end));}
 assert.equal(review.quality.critic.valid,true,'The new current-index contract is structurally admissible, not a factual pass');assert(review.quality.flags.length>0);assert.equal(review.quality.editorial.status,'editorial_review_required');assert.equal(review.approval,null);assert.equal((await f.db.query('SELECT id FROM publishing_outbox')).length,0);
}));
test('needs-source selection is paid and retained but blocks, and in-flight cancellation has precedence',()=>fixture(async f=>{
 await seedAt(f,1);const value=JSON.parse(f.artifacts[1].text);value.decision='needs_source';value.source_ids=[];const result=await step(f.store,config,async()=>{await f.store.cancel(f.task.id);return completion(JSON.stringify(value));},true);
 assert.equal(result.status,'step_saved');const row=(await f.db.query<any>('SELECT * FROM tasks WHERE id=$1',[f.task.id]))[0];assert.equal(row.status,'cancelled');assert.notEqual(row.block_reason,'note_contract');assert.equal((await f.db.query<any>('SELECT status FROM ledger WHERE task_id=$1',[f.task.id]))[0].status,'settled');assert.equal((await f.db.query('SELECT id FROM outputs WHERE task_id=$1',[f.task.id])).length,2);
}));

test('needs-source completed selection settles known usage then stops before further selection',()=>fixture(async f=>{
 await seedAt(f,1);const value=JSON.parse(f.artifacts[1].text);value.decision='needs_source';value.source_ids=[];let calls=0;
 assert.equal((await step(f.store,config,async()=>{calls++;return completion(JSON.stringify(value));},true)).status,'blocked');
 const row=(await f.db.query<any>('SELECT * FROM tasks WHERE id=$1',[f.task.id]))[0];assert.equal(row.status,'blocked');assert.equal(row.block_reason,'note_contract');assert.equal(row.checkpoint,2);
 assert.equal((await f.db.query<any>('SELECT status FROM ledger WHERE task_id=$1',[f.task.id]))[0].status,'settled');await assert.rejects(f.store.retry(f.task.id));assert.equal((await step(f.store,config,async()=>{calls++;throw Error('must not run');},true)).status,'idle');assert.equal(calls,1);
}));
test('invalid revision-child selector preserves the exact parent content and approval state',()=>fixture(async f=>{
 await seedAt(f,6,true);await f.db.query("UPDATE tasks SET status='review' WHERE id=$1",[f.task.id]);const before=(await f.store.snapshot()).reviews[0];
 const child=await queueAgentRevision(f.store,config,f.task.id,before.token,'Use the supported facts in plain language.');let calls=0;
 assert.equal((await step(f.store,config,async()=>{calls++;return completion(observed.outputs[0].text);},true)).status,'blocked');assert.equal(calls,1);
 const after=(await f.store.snapshot()).reviews[0];assert.equal(after.token,before.token);assert.deepEqual(after.bundle,before.bundle);assert.deepEqual(after.history,before.history);assert.deepEqual(after.approval,before.approval);assert.equal((await f.db.query<any>('SELECT block_reason FROM tasks WHERE id=$1',[child.id]))[0].block_reason,'note_contract');
 await assert.rejects(f.store.retry(child.id));assert.equal((await f.db.query('SELECT id FROM publishing_outbox')).length,0);
}));
