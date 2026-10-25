import {criticContractFromPrompt} from './prompt-contract-helper';
import {providerResponseFormatBytes} from '../lib/critic-response-format';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {ROLES,tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';
import {step} from '../lib/workflow';
import {sourceDraftingContract} from '../lib/drafting-contract';
import {CRITIC_CONTRACT} from '../lib/evidence-review';

const observed=JSON.parse(readFileSync(new URL('./fixtures/milestone-draft-2026-10-23.json',import.meta.url),'utf8')) as {source:{text:string;reported_date:string}};
const pricing:Pricing={model:'isolated-quality-contract',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
const marker='\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ';

for(const malformed of [false,true])test('six mocked checkpoints use server citation IDs, no extra call or approval'+(malformed?' after malformed Critic output':''),async()=>{
 const db=await embedded();
 try{
  const store=new Store(db),intake=new SourceIntake(db),source=await intake.stage({...observed.source,category:'build-log'});
  await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);let calls=0;const prompts:string[]=[];
  const call=async(_provider:unknown,prompt:string)=>{
   const checkpoint=calls++;prompts.push(prompt);assert(prompt.includes(sourceDraftingContract(checkpoint,source.text)));
   let text=checkpoint<3?'SOURCE: '+source.text:checkpoint===3?source.text:'### LinkedIn\n'+source.text;
   if(checkpoint===5){
    assert(prompt.includes(CRITIC_CONTRACT));const index=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));assert.equal(index.schema,2);
    const entry={claim_id:malformed?'writer:999999':index.artifacts[0].sentences[0].id,source_ids:[index.source.sentences[0].id],verdict:'wording_review',reason:'Owner comparison remains required.'};
    text=JSON.stringify({schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'Review exact claims without factual certification.','Evidence needed:':'Compare evidence and attribution.','Proposed advice:':'Owner review before approval.',evidence:[entry]});
   }
   return {text,input:10,output:20,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-'+checkpoint,finishReason:'stop'}};
  };
  for(let n=0;n<6;n++)assert.equal((await step(store,config,call,true)).status,'step_saved');
  assert.equal((await step(store,config,call,true)).status,'idle');assert.equal(calls,6);
  const state=await store.snapshot(),review=state.reviews.find((r:{task_id:string})=>r.task_id===task.id);
  assert.equal(state.tasks[0].status,'review');assert.equal(state.outputs.length,6);assert.deepEqual(state.outputs.map((x:{role:string})=>x.role),[...ROLES]);assert.equal(state.approvals.length,0);assert.equal(review.approval,null);assert.equal(review.quality.evidence_version,null);
  assert.equal(review.quality.critic.valid,!malformed);assert.equal(review.quality.status,malformed?'needs_revision':'needs_human_review');
  for(const row of state.ledger){assert.equal(row.status,'settled');assert.equal(Number(row.reserved),tokenCost(pricing,Buffer.byteLength(prompts[row.checkpoint])+providerResponseFormatBytes('openai',row.checkpoint===5?criticContractFromPrompt(prompts[row.checkpoint]):undefined)+256,1200));}
  assert.equal(state.ledger.length,6);assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
 }finally{await db.close();}
});
