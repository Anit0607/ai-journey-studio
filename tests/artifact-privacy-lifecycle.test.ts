import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {embedded,type Database} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {hash,ROLES,type Pricing,type RuntimeConfig} from '../lib/domain';
import {step} from '../lib/workflow';
import {queueAgentRevision,revisionPromptContext} from '../lib/agent-revisions';
import {Publishing} from '../lib/publishing';
import {renderInstagramCard,renderApprovedInstagram} from '../lib/publication-media';
import {criticCitationIndex,criticSuggestions,evidenceQuality,validateEvidence,saveEvidenceDecision} from '../lib/evidence-review';
import type {Artifact} from '../lib/grounding';
import {enqueueLegacy} from './legacy-task-fixture';
import {variantFixture} from './variant-fixture';

const TEXT='Proposed approach: discuss authorization in AI agent workflows.';
const SOURCE='I built a source-linked outline and reviewed each generated statement.';
const CRITIC='Unsupported claims: Owner review required.\nEvidence needed: Compare exact evidence.\nProposed advice: Review authorization concepts before use.';
const pricing:Pricing={model:'isolated-artifact-privacy',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
const observed=JSON.parse(readFileSync(new URL('./fixtures/github-owner-draft-blocked-2026-10-24.json',import.meta.url),'utf8')) as {source:{text:string;category:string;reported_date:string};bundle:Artifact[]};
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
const bundle=(text=TEXT)=>ROLES.map(role=>artifact(role,role==='Critic'?CRITIC:role==='Platform Adapter'?variantFixture(text):text));
async function isolated(work:(db:Database,store:Store)=>Promise<void>){const db=await embedded();try{await work(db,new Store(db));}finally{await db.close();}}
async function seed(db:Database,store:Store,text=TEXT){
 const intake=new SourceIntake(db),source=await intake.stage({text:SOURCE,category:'build-log',reported_date:'2026-10-23'});await intake.clear(source.id,source.hash,true);const task=await enqueueLegacy(store,source.id);
 for(const item of bundle(text))await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,item.role,item.text,item.hash]);
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);const review=(await store.snapshot()).reviews[0];return {task,source,review};
}
const completion=(text:string)=>({text,input:10,output:20,outcome:'complete' as const,report:{serviceTier:'default',model:pricing.model,requestId:'isolated-only',finishReason:'stop'}});

test('exact observed prior artifacts pass the next mocked generation privacy gate without changing the historical bytes',()=>isolated(async(db,store)=>{
 const intake=new SourceIntake(db),source=await intake.stage({...observed.source,category:'build-log'});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
 for(const item of observed.bundle)await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,item.role,item.text,item.hash]);
 await db.query('UPDATE tasks SET checkpoint=2 WHERE id=$1',[task.id]);let calls=0;
 const result=await step(store,config,async(_provider,prompt)=>{calls++;assert(prompt.includes(JSON.stringify(observed.bundle[1].text).slice(1,-1)));return completion(TEXT);},true);
 assert.equal(result.status,'step_saved');assert.equal(calls,1);const state=await store.snapshot();assert.equal(state.tasks[0].checkpoint,3);
 for(const item of observed.bundle){const saved=state.outputs.find((x:Artifact)=>x.role===item.role);assert.equal(saved.text,item.text);assert.equal(saved.hash,item.hash);}
 assert.equal(state.ledger.length,1);assert.equal(state.ledger[0].status,'settled');assert.equal(state.approvals.length,0);assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
 // This only proves the privacy checkpoint, not that the observed inferred claims are grounded.
}));

test('credential or private prior output blocks before another mocked call or reservation',()=>isolated(async(db,store)=>{
 for(const text of ['Authorization: Basic YWxpY2U6c2VjcmV0','Proposed approach: use private client data.']){
  const intake=new SourceIntake(db),source=await intake.stage({text:SOURCE+'\n'+randomUUID(),category:'build-log',reported_date:'2026-10-23'});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
  await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,'Harvester',text,hash(text)]);await db.query('UPDATE tasks SET checkpoint=1 WHERE id=$1',[task.id]);let calls=0;
  assert.equal((await step(store,config,async()=>{calls++;throw Error('No call allowed');},true)).status,'blocked');assert.equal(calls,0);
 }
 assert.equal((await store.snapshot()).ledger.length,0);
}));

test('artifact review, manual edits, content approval, publication staging and media share the guard but retain separate consent',()=>isolated(async(db,store)=>{
 const {task,review}=await seed(db,store);assert.equal(review.quality.flags.length,0);assert.equal(review.approval,null);
 const publisher=new Publishing(db,{enabled:false,accounts:[{id:'isolated-li',platform:'LinkedIn',remote_id:'urn:li:person:12345',label:'Isolated account',enabled:true,verified:true,authorization_version:'isolated-v1',scopes:['w_member_social'],linkedin_version:'202609'}]});
 const input={request_id:randomUUID(),task_id:task.id,review_token:review.token,platform:'LinkedIn' as const,account_id:'isolated-li',scheduled_at:new Date(Date.now()+3600000).toISOString(),payload:{text:TEXT}};
 await assert.rejects(publisher.enqueue(input),/approv/i);await assert.rejects(renderApprovedInstagram(db,task.id,review.token),/Approve/);
 await store.approve(task.id,review.token.slice(9));const row=await publisher.enqueue(input);assert.equal(row.status,'staged');assert.equal((await publisher.dispatch()).status,'disabled');
 const card=await renderApprovedInstagram(db,task.id,review.token);assert.equal(card.caption,TEXT);assert.equal(card.caption_hash,hash(TEXT));assert.equal((await db.query('SELECT id FROM media_public_approvals')).length,0);
 for(const text of ['Authorization: Basic YWxpY2U6c2VjcmV0','Bandhan Bank client data','Proposed approach: use private information.']){
  await assert.rejects(store.revise(task.id,review.token,'Correct the draft',{role:'Writer',text}),/Excluded private/);
  await assert.rejects(publisher.enqueue({...input,request_id:randomUUID(),payload:{text}}),/Excluded private/);
  await assert.rejects(renderInstagramCard(text),/Excluded private/);
  assert(evidenceQuality(bundle(text),{text:SOURCE,hash:hash(SOURCE),cleared:true}).flags.some(x=>x.claim==='Integrity or privacy check failed'));
 }
 await assert.rejects(store.revise(task.id,review.token,'Discuss authorization concepts',{role:'Writer',text:TEXT}),/Excluded private/);
 await store.revise(task.id,review.token,'Shorten the proposed approach',{role:'Writer',text:TEXT+' Review one concept at a time.'});
 const edited=(await store.snapshot()).reviews[0];assert.equal(edited.approval,null);await assert.rejects(store.approveRevision(task.id,edited.token,false),/acknowledgement/);await store.approveRevision(task.id,edited.token,true);
 assert.equal((await store.snapshot()).ledger.length,0);assert.equal((await db.query("SELECT id FROM publishing_outbox WHERE status <> 'staged'")).length,0);
}));

for(const unsafe of [false,true])test('revision prior and final bundles use artifact scanning while feedback stays conservative'+(unsafe?' and terminal credentials stay blocked':''),()=>isolated(async(db,store)=>{
 const {task,review}=await seed(db,store);await assert.rejects(queueAgentRevision(store,config,task.id,review.token,'Discuss authorization concepts'),/Excluded private/);
 const child=await queueAgentRevision(store,config,task.id,review.token,'Shorten the proposed approach');assert((await revisionPromptContext(store,{...child,checkpoint:3})).includes(TEXT));let calls=0;
 for(let n=0;n<6;n++)await step(store,config,async()=>{const role=ROLES[calls++];return completion(role==='Critic'?(unsafe?'Authorization: Basic YWxpY2U6c2VjcmV0':CRITIC):role==='Platform Adapter'?variantFixture(TEXT):TEXT);},true);
 const state=await store.snapshot(),current=state.reviews[0];assert.equal(calls,6);assert.equal(state.ledger.length,6);assert(state.ledger.every((x:{status:string})=>x.status==='settled'));assert.equal(state.outputs.filter((x:{task_id:string})=>x.task_id===child.id).length,6);assert.equal(state.approvals.length,0);
 if(unsafe){assert.equal(current.history.length,0);assert.equal(state.tasks.find((x:{id:string})=>x.id===child.id).status,'blocked');}
 else{assert.equal(current.history.length,1);assert.equal(current.approval,null);await store.approveRevision(task.id,current.token,true);}
 assert.equal((await db.query('SELECT id FROM publishing_outbox')).length,0);
}));

test('generated Critic reason allows technical authorization, not credential material or invalid links; human evidence remains strict',async()=>{
 const source={text:SOURCE,hash:hash(SOURCE),cleared:true},b=bundle(),index=criticCitationIndex(b,source);
 const reason=(text:string,claim_id='writer:0')=>{const data={schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'This claim is unsupported.','Evidence needed:':'Compare exact evidence.','Proposed advice:':'Correct unsupported wording.',evidence:[{claim_id,source_ids:[],verdict:'unsupported',reason:text}]};return b.map(x=>x.role==='Critic'?artifact(x.role,JSON.stringify(data)):x);};
 assert.equal(criticSuggestions(reason('The title does not verify authorization in AI agent workflows.'),source).valid,true);
 for(const text of ['Authorization: Basic YWxpY2U6c2VjcmV0','Private client information'])assert.equal(criticSuggestions(reason(text),source).valid,false);
 assert.equal(criticSuggestions(reason('Discuss authorization concepts.','writer:99999'),source).valid,false);
 const quote='Discuss authorization in AI agent workflows.',f={id:'isolated',role:'Writer',claim:quote,reason:'Compare wording',kind:'wording_review' as const,artifact_hash:hash(quote),span:{start:0,end:quote.length}};
 assert.throws(()=>validateEvidence(f,quote,{start:0,end:quote.length},quote),/Excluded private/);
 // A mocked transaction only reaches the human reason check; no write is allowed.
 const humanBundle=bundle('The project owner built a source-linked outline and reviewed each generated statement.');const q=evidenceQuality(humanBundle,source),finding=q.findings.find(x=>x.kind==='wording_review')!;assert(finding);
 const reads:string[]=[],writes:string[]=[],expectedReads=['SELECT * FROM evidence_decisions WHERE task_id=$1 ORDER BY sequence','SELECT * FROM tasks WHERE id=$1','SELECT id,version FROM content_revisions WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1'];
 await assert.rejects(saveEvidenceDecision({query:async<T>(sql:string,params?:unknown[])=>{
  if(!sql.startsWith('SELECT ')){writes.push(sql);throw Error('No write allowed');}
  reads.push(sql);assert.deepEqual(params,['isolated']);
  if(sql===expectedReads[0]||sql===expectedReads[2])return [] as T[];
  if(sql===expectedReads[1])return [{id:'isolated',source_id:'isolated-source',source_hash:source.hash,status:'review',checkpoint:6,content_brief:{}}] as T[];
  throw Error('Unexpected read: '+sql);
 }},'isolated',humanBundle,source,{binding:q.binding,finding_id:finding.id,decision:'accept',reason:'Discuss authorization concepts',source_span:{start:0,end:SOURCE.length},source_quote:SOURCE,acknowledged:true}),/Excluded private/);
 assert.deepEqual(reads,expectedReads);assert.deepEqual(writes,[],'Private human evidence must be rejected before any write');
});
