import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {SUPPORTED_SENTENCES} from '../lib/grounding';
import {taskPlatformPolicy} from '../lib/platform-policy';
import {platformVariants} from '../lib/platform-variants';
import type {Pricing,RuntimeConfig} from '../lib/domain';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-owner-draft-blocked-2026-10-24.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;category:string;reported_date:string}};
const pricing:Pricing={model:'isolated-commit-grounding',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
const marker='\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ';

test('six mock checkpoints keep the imported source attributed and LinkedIn-only without extra calls or approval',async()=>{
 const db=await embedded();
 try{
  const store=new Store(db),intake=new SourceIntake(db),source=await intake.stage(observed.source);
  await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);let calls=0;
  const copy='The repository anit0607/ai-journey-studio records the commit message "Add owner-only exact-task bounded draft execution".';
  const call=async(_provider:unknown,prompt:string)=>{
   const checkpoint=calls++;assert(prompt.includes(source.text));assert(prompt.includes(source.hash));
   for(const personal of SUPPORTED_SENTENCES)assert(!prompt.includes(personal),personal);
   assert(!prompt.includes('Find an honest learning-story angle supported by the source.'));
   assert(!prompt.includes('Learning journey, no sales funnel.'));assert(prompt.includes('Attributed source update, no sales funnel.'));
   assert(prompt.includes('not code, a diff, tests or deployment results'));
   if(checkpoint===1)assert(prompt.includes('Choose one concise attributed source update'));
   if(checkpoint===0)assert(!prompt.includes('Do not rewrite the facts into third person.'));
   if(checkpoint===4){assert(prompt.includes('Produce the LinkedIn variant only.'));assert(!prompt.includes('Produce LinkedIn, X and Instagram variants.'));}
   let text=checkpoint<3?'SOURCE: '+source.text:checkpoint===3?copy:'### LinkedIn\n'+copy;
   if(checkpoint===5){
    const index=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));
    text=JSON.stringify({schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'Owner comparison remains required; the title does not verify implementation.','Evidence needed:':'No test or deployment result is supplied.','Proposed advice:':'Keep the repository attribution and review the exact quote.',evidence:[]});
   }
   return {text,input:10,output:20,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-commit-'+checkpoint,finishReason:'stop'}};
  };
  for(let checkpoint=0;checkpoint<6;checkpoint++)assert.equal((await step(store,config,call,true)).status,'step_saved');
  assert.equal((await step(store,config,call,true)).status,'idle');assert.equal(calls,6);
  const state=await store.snapshot(),saved=state.tasks.find((item:{id:string})=>item.id===task.id);
  assert.equal(saved.status,'review');assert.equal(state.outputs.length,6);assert.equal(state.ledger.length,6);
  assert(state.ledger.every((row:{status:string})=>row.status==='settled'));assert.equal(state.approvals.length,0);
  assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
  const variants=platformVariants(state.outputs.find((item:{role:string})=>item.role==='Platform Adapter'),taskPlatformPolicy(saved));
  assert.equal(variants.complete,true);assert.deepEqual(variants.variants.map(item=>item.platform),['LinkedIn']);
  const review=state.reviews.find((item:{task_id:string})=>item.task_id===task.id);assert.equal(review.approval,null);assert.equal(review.quality.evidence_version,null);
  assert.equal((await db.query<{text:string;hash:string}>('SELECT text,hash FROM sources WHERE id=$1',[source.id]))[0].hash,observed.source.hash);
 }finally{await db.close();}
});
