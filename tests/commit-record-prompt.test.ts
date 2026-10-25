import {providerResponseFormatBytes} from '../lib/critic-response-format';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {draftingGuidance} from '../lib/drafting-guidance';
import {sourceDraftingContract,attributedCommitSummary} from '../lib/drafting-contract';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {criticCitationIndex,CRITIC_CONTRACT} from '../lib/evidence-review';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-natural-draft-2026-10-25.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string}};
const {source}=observed;
const oldGoals=['choose one source-supported point, audience need, evidence gap and reader takeaway','Use an evidence-backed question or specific tension as the opening; deliver its payoff promptly','One clear opening, immediate payoff, evidence, useful takeaway'];
test('only an exact attributed commit record replaces affirmative hook, payoff and takeaway requirements',()=>{
 for(const checkpoint of [2,3,4]){
  const guidance=draftingGuidance(checkpoint,NEW_PLATFORM_POLICY,source.text);
  assert(guidance.includes('Commit-title evidence only'));assert(guidance.includes('unchanged title'));assert(guidance.includes('Do not require a hook'));
  assert(guidance.includes('Do not interpret technical title terms'));assert(guidance.includes('or add dates to public copy'));assert(Buffer.byteLength(guidance)<800);
  for(const goal of oldGoals)assert(!guidance.includes(goal));
 }
 for(const text of ['I reviewed a draft.',source.text.replace('Attributed GitHub','Attributed YouTube'),source.text+'\nAdditional verified build notes.']){
  assert.equal(attributedCommitSummary(text),null);
  for(const checkpoint of [2,3,4])assert.equal(draftingGuidance(checkpoint,NEW_PLATFORM_POLICY,text),draftingGuidance(checkpoint,NEW_PLATFORM_POLICY));
 }
 for(const checkpoint of [0,1,5])assert.equal(draftingGuidance(checkpoint,NEW_PLATFORM_POLICY,source.text),draftingGuidance(checkpoint,NEW_PLATFORM_POLICY));
});

test('commit record instructions distinguish source metadata from event dates and require unsupported citation verdicts',()=>{
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const contract=sourceDraftingContract(checkpoint,source.text);
  assert(contract.includes('SOURCE DATE is source-record metadata, not proof of when a commit was made, deployed or published'));
  assert(contract.includes('do not add it to public copy or insert it into a verbatim source'));
  assert(contract.includes('even for a longform slot'));
  assert(contract.includes('Harvester returns only SOURCE: followed by the complete SOURCE'));
  assert(contract.includes('as unsupported with source_ids=[], not a wording-only paraphrase'));
 }
 assert(CRITIC_CONTRACT.includes('without Markdown fences or surrounding prose'));
 assert(CRITIC_CONTRACT.includes('whose text actually supports the wording'));
});

test('six offline checkpoints use narrow source-only guidance and tolerate one valid Critic fence without approval or added calls',async()=>{
 const db=await embedded();
 const pricing:Pricing={model:'isolated-natural-record',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
 const runtime:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
 try{
  const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage({text:source.text,reported_date:source.reported_date,category:'build-log'});
  await intake.clear(staged.id,staged.hash,true);const task=await store.enqueue(staged.id);const prompts:string[]=[];
  const copy='The repository anit0607/ai-journey-studio records the commit title "'+attributedCommitSummary(source.text)+'".';
  const provider=async(_provider:unknown,prompt:string)=>{
   const checkpoint=prompts.length;prompts.push(prompt);
   assert(prompt.includes(source.text));assert(prompt.includes(sourceDraftingContract(checkpoint,source.text)));
   for(const goal of oldGoals)assert(!prompt.includes(goal));
   let text=checkpoint<3?'SOURCE: '+source.text:checkpoint===3?copy:'### LinkedIn\n'+copy;
   if(checkpoint===5){
    const marker='\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ';
    const index=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));
    const outputs=await db.query<any>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]);
    assert.deepEqual(index,criticCitationIndex(outputs,staged));
    const title=index.source.sentences.find((item:{text:string})=>item.text===attributedCommitSummary(source.text));assert(title);
    text='```json\n'+JSON.stringify({schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'Owner review remains required.','Evidence needed:':'No implementation results are supplied.','Proposed advice:':'Keep the exact title and repository attribution.',evidence:[{claim_id:'writer:0',source_ids:[title.id],verdict:'wording_review',reason:'Compare the exact title; this is not evidence of implementation.'}]})+'\n```';
   }
   return {text,input:10,output:20,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-'+checkpoint,finishReason:'stop'}};
  };
  for(let checkpoint=0;checkpoint<6;checkpoint++)assert.equal((await step(store,runtime,provider,true)).status,'step_saved');
  assert.equal((await step(store,runtime,provider,true)).status,'idle');assert.equal(prompts.length,6);
  const state=await store.snapshot(),review=state.reviews.find((item:{task_id:string})=>item.task_id===task.id);
  assert.equal(state.outputs.length,6);assert.equal(state.tasks[0].status,'review');assert.equal(state.approvals.length,0);assert.equal(review.approval,null);
  assert.equal(review.quality.critic.legacy,false);assert.equal(review.quality.critic.valid,true);assert.equal(review.quality.critic.suggestions.length,1);
  // Valid citation suggestions do not resolve the owner's comparison of attributed prose.
  assert.equal(review.quality.status,'needs_revision');assert.equal(review.quality.evidence_version,null);
  assert.equal(review.quality.flags.length,2);assert(review.quality.flags.every((flag:{kind:string;role:string})=>flag.kind==='wording_review'&&['Writer','Platform Adapter'].includes(flag.role)));
  assert.equal(state.ledger.length,6);for(const row of state.ledger){assert.equal(row.status,'settled');assert.equal(Number(row.reserved),tokenCost(pricing,Buffer.byteLength(prompts[row.checkpoint])+providerResponseFormatBytes('openai',row.checkpoint===5?{artifact:'critic'}:undefined)+256,1200));}
  assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
 }finally{await db.close();}
});
