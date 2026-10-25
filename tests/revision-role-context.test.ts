import {canonicalNoteArtifacts} from './canonical-note-helpers';
import {draftArtifactContract} from '../lib/critic-response-format';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {revisionPromptContext,queueAgentRevision,type AgentRevisionTask} from '../lib/agent-revisions';
import {criticCitationIndex,criticSuggestions,evidenceQuality,EVIDENCE_POLICY} from '../lib/evidence-review';
import {assertBundle,type Artifact} from '../lib/grounding';
import {hash,ROLES,tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';
import {Store} from '../lib/store';
import {embedded} from '../lib/db';
import {SourceIntake} from '../lib/sources';
import {step} from '../lib/workflow';
import {providerResponseFormatBytes} from '../lib/critic-response-format';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';

const historical=JSON.parse(readFileSync(new URL('./fixtures/github-rich-note-draft-2026-10-25.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string};outputs:Artifact[]};
const observed=JSON.parse(readFileSync(new URL('./fixtures/github-rich-note-revision-2026-10-25.json',import.meta.url),'utf8')) as {feedback:string;outputs:Artifact[]};
const oldCritic=JSON.parse(historical.outputs.find(item=>item.role==='Critic')!.text);
const returnedCritic=JSON.parse(observed.outputs.find(item=>item.role==='Critic')!.text);
const marker='\nUNTRUSTED REVISION DATA: ';
const citationMarker='\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ';
const baseToken='original:'+hash(historical.outputs.map(item=>item.hash).join('|'));
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
const withCritic=(data:unknown)=>observed.outputs.map(item=>item.role==='Critic'?artifact('Critic',JSON.stringify(data)):item);
function isolatedContext(checkpoint:number,bundle=historical.outputs){
 const task={id:'offline-child',source_id:'offline-source',source_hash:historical.source.hash,status:'queued',checkpoint,revision_parent_task_id:'offline-parent',revision_base_token:baseToken,revision_note:observed.feedback} as AgentRevisionTask;
 const store={db:{transaction:async(work:(tx:unknown)=>Promise<string>)=>work({})},revisionContext:async()=>{assertBundle(bundle);return {task:{id:'offline-parent'},source:{...historical.source,id:'offline-source'},token:baseToken,bundle};}} as unknown as Store;
 return {task,store};
}

test('captured revision has fresh hashes but recycled assessments and one invalid passage, not malformed JSON',()=>{
 for(const item of [...historical.outputs,...observed.outputs])assert.equal(hash(item.text),item.hash);
 assert.equal(observed.feedback.length,844);
 const index=criticCitationIndex(observed.outputs,historical.source);
 assert.equal(returnedCritic.source_hash,historical.source.hash);
 assert.equal(returnedCritic.index_hash,index.index_hash);
 for(const key of ['Unsupported claims','Evidence needed','Proposed advice'])assert.equal(returnedCritic[key+':'],oldCritic[key]);
 assert.deepEqual(returnedCritic.evidence.map((entry:{reason:string})=>entry.reason),oldCritic.evidence.map((entry:{reason:string})=>entry.reason));
 assert.equal(criticSuggestions(observed.outputs,historical.source).valid,false);
 for(const [n,entry] of returnedCritic.evidence.entries())assert.equal(criticSuggestions(withCritic({...returnedCritic,evidence:[entry]}),historical.source).valid,n!==2);
 const q=evidenceQuality(observed.outputs,historical.source,[],NEW_PLATFORM_POLICY);
 assert.equal(q.flags.length,22);assert.equal(q.flags.filter(item=>item.kind==='hard').length,1);
 assert.equal(q.evidence_version,null);assert.equal(q.status,'needs_revision');
 assert.equal(EVIDENCE_POLICY,'evidence-review-v3-lossless-spans');
});

test('structurally admissible citation is not semantic approval and leaves all wording findings unresolved',()=>{
 const correctedPassage={...returnedCritic,evidence:returnedCritic.evidence.map((entry:unknown,n:number)=>n===2?{...(entry as object),source_ids:['source:5','source:6','source:7','source:8','source:9']}:entry)};
 const q=evidenceQuality(withCritic(correctedPassage),historical.source,[],NEW_PLATFORM_POLICY);
 assert.equal(q.critic.valid,true);assert.equal(q.flags.length,21);
 assert.equal(q.status,'needs_revision');assert.equal(q.evidence_version,null);
 assert(q.flags.every(item=>item.resolution===null));
 // The observed no-publication/evidence-gap pairing illustrates why an accepted
 // advisory link is not factual verification, a waiver or publication approval.
 const unsupportedPair=returnedCritic.evidence.find((entry:{claim_id:string})=>entry.claim_id==='writer:5');
 assert.deepEqual(unsupportedPair.source_ids,['source:17']);
 const index=criticCitationIndex(observed.outputs,historical.source);
 assert.equal(index.artifacts[0].sentences.find(item=>item.id==='writer:5')!.text,'The documented check recorded no new publication.');
 assert.match(index.source.sentences.find(item=>item.id==='source:17')!.text,/evidence gap/);
});

test('revision input projection keeps public feedback only in Writer and Adapter, with no historical Critic at any stage',async()=>{
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const {task,store}=isolatedContext(checkpoint),context=await revisionPromptContext(store,task),data=JSON.parse(context.split(marker)[1]);
  assert.equal(data.source.hash,historical.source.hash);assert.equal(data.source.reported_date,historical.source.reported_date);assert.equal(data.base_token,baseToken);
  assert(!context.includes(oldCritic.index_hash));
  for(const key of ['Unsupported claims','Evidence needed','Proposed advice'])assert(!context.includes(oldCritic[key]));
  for(const entry of oldCritic.evidence)assert(!context.includes(entry.reason));
  if(checkpoint===3||checkpoint===4){
   assert.equal(data.owner_feedback,observed.feedback);
   assert.deepEqual(data.prior_artifacts,historical.outputs.filter(item=>item.role==='Writer'||item.role==='Platform Adapter'));
   assert.match(context,/Apply owner feedback to the public copy only/);
  }else{
   assert.equal(data.owner_feedback,undefined);assert.equal(data.prior_artifacts,undefined);
   assert(!context.includes(observed.feedback));
   for(const prior of historical.outputs)assert(!context.includes(prior.hash));
   assert.match(context,checkpoint===5?/fresh critique of the current child artifacts/:/Regenerate only this internal role using its required canonical note JSON/);
  }
 }
});

test('context omission never skips complete parent privacy, integrity, source and feedback checks',async()=>{
 const privateParent=historical.outputs.map(item=>item.role==='Critic'?artifact('Critic','PASSWORD=isolated-fixture'):item);
 const brokenParent=historical.outputs.map(item=>item.role==='Story Miner'?{...item,text:'tampered fixture'}:item);
 for(const checkpoint of [0,3,5]){
  for(const [bundle,message] of [[privateParent,/Excluded private material/],[brokenParent,/Invalid artifact bundle/]] as const){
   const {task,store}=isolatedContext(checkpoint,bundle);await assert.rejects(revisionPromptContext(store,task),message);
  }
  const {task,store}=isolatedContext(checkpoint);
  await assert.rejects(revisionPromptContext(store,{...task,source_hash:hash('wrong source')}),/source mismatch/);
  await assert.rejects(revisionPromptContext(store,{...task,revision_note:'PASSWORD=isolated-fixture'}),/Excluded private material/);
 }
});

const pricing:Pricing={model:'isolated-revision-context-fixture',pricing_version:'fixture-only',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
test('actual six-stage prompt assembly isolates parent context while retaining fresh child evidence and exact reservations',async()=>{
 const db=await embedded();
 try{
  const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage({...historical.source,category:'project-note'});
  await intake.clear(staged.id,staged.hash,true);const parent=await store.enqueue(staged.id);
  for(const item of historical.outputs)await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),parent.id,item.role,item.text,item.hash]);
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[parent.id]);
  const generated=canonicalNoteArtifacts(historical.source,observed.outputs);
  const base=(await store.snapshot()).reviews[0],child=await queueAgentRevision(store,config,parent.id,base.token,observed.feedback),prompts:string[]=[];
  for(let checkpoint=0;checkpoint<6;checkpoint++){
   const result=await step(store,config,async(provider,prompt,_pricing,_transport,_credential,contract)=>{
    assert.equal(provider,'openai');prompts.push(prompt);
    assert(prompt.includes(historical.source.text));assert(prompt.includes(base.token));
    const data=JSON.parse(prompt.split(marker)[1].split('\nGROUNDING CONTRACT: ')[0]);
    assert.equal(data.owner_feedback,checkpoint===3||checkpoint===4?observed.feedback:undefined);
    for(const key of ['Unsupported claims','Evidence needed','Proposed advice'])assert(!prompt.includes(oldCritic[key]));
    for(const entry of oldCritic.evidence)assert(!prompt.includes(entry.reason));
    assert(!prompt.includes(oldCritic.index_hash));
    const current=await db.query<Artifact>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[child.id]);
    assert.deepEqual(contract,draftArtifactContract({...child,checkpoint},historical.source as any,current));
    if(checkpoint===5){
     const index=JSON.parse(prompt.split(citationMarker)[1]);
     const current=await db.query<Artifact>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[child.id]);
     assert.deepEqual(index,criticCitationIndex(current,historical.source));
     for(const role of ['Writer','Platform Adapter'])assert.equal(index.artifacts.find((item:{role:string})=>item.role===role)!.artifact_hash,observed.outputs.find(item=>item.role===role)!.hash);
     assert.match(prompt,/citation must support the whole assertion/);
    }
    // Typed selection fixtures precede the captured public/invalid Critic outputs.
    // Contract validity must not bless that Critic or invent a live quality pass.
    return {text:generated[checkpoint].text,input:10,output:10,outcome:'complete',report:{serviceTier:'default',model:pricing.model,requestId:'isolated-mock',finishReason:'stop'}};
   },true);
   assert.equal(result.status,'step_saved');
  }
  const state=await store.snapshot(),review=state.reviews[0];
  assert.equal(prompts.length,6);assert.equal(state.ledger.length,6);
  for(const row of state.ledger){assert.equal(row.status,'settled');assert.equal(Number(row.reserved),tokenCost(pricing,Buffer.byteLength(prompts[row.checkpoint])+providerResponseFormatBytes('openai',draftArtifactContract({...child,checkpoint:row.checkpoint},historical.source as any,generated.slice(0,row.checkpoint)))+256,1200));}
  assert.deepEqual(state.outputs.filter((item:{task_id:string})=>item.task_id===child.id).map((item:Artifact)=>item.role).sort(),[...ROLES].sort());
  assert.equal(review.quality.critic.valid,false);assert.deepEqual(review.quality.flags.map((f:any)=>f.id),evidenceQuality(generated,historical.source,[],NEW_PLATFORM_POLICY).flags.map(f=>f.id));
  assert.equal(review.approval,null);assert.equal(review.quality.evidence_version,null);
  assert.equal(state.approvals.length,0);
  assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
  assert.equal((await db.query('SELECT id FROM evidence_decisions')).length,0);
 }finally{await db.close();}
});
