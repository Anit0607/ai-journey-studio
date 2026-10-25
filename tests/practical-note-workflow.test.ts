import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {buildDraftPrompt} from '../lib/draft-prompt';
import {hash,tokenCost,type Pricing,type RuntimeConfig,type Task} from '../lib/domain';
import type {Artifact} from '../lib/grounding';

const observed=JSON.parse(await readFile(new URL('./fixtures/database-note-draft-2026-10-25.json',import.meta.url),'utf8'));
const pricing:Pricing={model:'isolated-practical-note-fixture',pricing_version:'fixture-only',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
async function fixture(work:(value:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
async function seed(db:Awaited<ReturnType<typeof embedded>>){
 const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage(observed.source),source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id);
 for(const [index,item] of (observed.outputs.slice(0,3) as Artifact[]).entries())await db.query('INSERT INTO outputs(id,task_id,role,text,hash,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),task.id,item.role,item.text,item.hash,new Date(Date.UTC(2026,9,25,0,0,index)).toISOString()]);
 await db.query('UPDATE tasks SET checkpoint=3 WHERE id=$1',[task.id]);return {db,store,source,task};
}

test('the actual workflow sends exactly the composed selected-brief prompt and reserves its exact bytes once',()=>fixture(async f=>{
 let calls=0;
 const result=await step(f.store,config,async(provider,prompt,p)=>{
  calls++;assert.equal(provider,'openai');
  const task=(await f.db.query<Task>('SELECT * FROM tasks WHERE id=$1',[f.task.id]))[0];
  const previous=await f.db.query<Artifact>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[f.task.id]);
  assert.equal(prompt,buildDraftPrompt(task,f.source,previous));
  const projected=JSON.parse(prompt.split('\nPRIOR ARTIFACTS: ')[1].split('\n')[0]);
  assert.deepEqual(projected.map((x:Artifact)=>x.role),['Strategist']);
  assert(prompt.includes(f.source.text));assert.match(prompt,/deliver its payoff promptly/);
  assert.doesNotMatch(prompt,/Do not require a hook|A concise milestone update/);
  const ledger=(await f.db.query<{reserved:string}>('SELECT reserved FROM ledger WHERE task_id=$1',[f.task.id]))[0];
  assert.equal(Number(ledger.reserved),tokenCost(p,Buffer.byteLength(prompt)+256,1200));
  return {text:'Proposed approach: inspect the configured windows.',input:10,output:10,outcome:'complete',report:{serviceTier:'default',model:p.model,requestId:'isolated-no-network',finishReason:'stop'}};
 },true);
 assert.equal(result.status,'step_saved');assert.equal(calls,1);
 assert.equal((await f.db.query('SELECT id FROM ledger WHERE task_id=$1',[f.task.id])).length,1);
 assert.equal((await f.db.query('SELECT task_id FROM approvals')).length,0);
 assert.equal((await f.db.query('SELECT id FROM publishing_outbox')).length,0);
}));

test('a corrupted omitted Harvester still stops before reservation or provider execution',()=>fixture(async f=>{
 await f.db.query("UPDATE outputs SET hash=$2 WHERE task_id=$1 AND role='Harvester'",[f.task.id,hash('different')]);
 let calls=0;const result=await step(f.store,config,async()=>{calls++;throw Error('must not execute');},true);
 assert.equal(result.status,'blocked');assert.equal(calls,0);
 assert.equal((await f.db.query('SELECT id FROM ledger WHERE task_id=$1',[f.task.id])).length,0);
}));

test('excluded private material in an omitted Story Miner still stops before reservation or execution',()=>fixture(async f=>{
 const text='confidential fixture';await f.db.query("UPDATE outputs SET text=$2,hash=$3 WHERE task_id=$1 AND role='Story Miner'",[f.task.id,text,hash(text)]);
 let calls=0;const result=await step(f.store,config,async()=>{calls++;throw Error('must not execute');},true);
 assert.equal(result.status,'blocked');assert.equal(calls,0);
 assert.equal((await f.db.query('SELECT id FROM ledger WHERE task_id=$1',[f.task.id])).length,0);
}));
