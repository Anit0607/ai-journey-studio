import {criticContractFromPrompt} from './prompt-contract-helper';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {editorialReview,editorialPrompt,assertNoEditorialHold} from '../lib/editorial-review';
import {evidenceQuality,evidenceApprovalCurrent,saveEvidenceApproval,criticCitationIndex,EVIDENCE_POLICY} from '../lib/evidence-review';
import {sourceDraftingContract,sourceRoleGoal} from '../lib/drafting-contract';
import {draftingGuidance} from '../lib/drafting-guidance';
import {hash,ROLES,tokenCost,type Pricing,type RuntimeConfig} from '../lib/domain';
import type {Artifact} from '../lib/grounding';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {embedded,type Database} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {Publishing,type PublishingRuntime} from '../lib/publishing';
import {previewApprovalPlan} from '../lib/approval-plan';
import {Calendar} from '../lib/calendar';
import {step} from '../lib/workflow';
import {providerResponseFormatBytes} from '../lib/critic-response-format';

const source='The workflow uses a configured window.';
const critic='Unsupported claims: Compare the exact source.\nEvidence needed: Owner review remains required.\nProposed advice: Review the specific practical point.';
const held='EDITORIAL HOLD: needs_revision\n'+critic;
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
function bundle(critique=critic){return ROLES.map(role=>artifact(role,role==='Critic'?critique:role==='Platform Adapter'?'### LinkedIn\n'+source:source));}

test('zero factual flags never mean editorial quality passed, including the rejected generic topic',()=>{
 const q=evidenceQuality(bundle(),{text:source,hash:hash(source)},[],NEW_PLATFORM_POLICY);
 assert.equal(q.flags.length,0);assert.equal(q.editorial.status,'editorial_review_required');assert.equal(q.editorial.blocking,false);
 assert.match(q.editorial.notice,/No automated editorial pass/);assert.equal(EVIDENCE_POLICY,'evidence-review-v3-lossless-spans');
 const rejectedTopic='All six stages finished, but unsupported claims needed checking. Compare each claim with the source.';
 const ordinary=editorialReview([artifact('Writer',rejectedTopic)]);
 assert.equal(ordinary.status,'editorial_review_required');assert.equal(ordinary.blocking,false,'A topic keyword is not an editorial rejection record or a universal veto');
 assert.match(editorialPrompt(1),/previously rejected generic story/);
 assert.match(editorialPrompt(3),/not a chronological system report/);
});

test('explicit editorial holds are separate from factual findings and cannot be waived by a matching evidence receipt',async()=>{
 const q=evidenceQuality(bundle(held),{text:source,hash:hash(source)},[],NEW_PLATFORM_POLICY);
 assert.equal(q.flags.length,0);assert.equal(q.status,'needs_human_review');
 assert.equal(q.editorial.status,'needs_editorial_revision');assert.equal(q.editorial.blocking,true);
 assert.deepEqual(q.editorial.issues.map(item=>item.role),['Critic']);
 assert.throws(()=>assertNoEditorialHold(q.editorial),/editorial hold/);
 let writes=0;await assert.rejects(saveEvidenceApproval({query:async<T>()=>{writes++;return [] as T[];}},'fixture-task','fixture-token',q),/editorial hold/);assert.equal(writes,0);
 const matching={binding:q.binding,evidence_version:'',review_token:'fixture-token'};
 assert.equal(await evidenceApprovalCurrent({query:async<T>()=>[matching] as T[]},'fixture-task','fixture-token',q,null),false);
 const b=bundle(),s={text:source,hash:hash(source)},index=criticCitationIndex(b,s);
 b[5]=artifact('Critic',JSON.stringify({schema:2,source_hash:s.hash,index_hash:index.index_hash,'Unsupported claims:':'Compare the source.','Evidence needed:':'Owner review required.','Proposed advice:':'EDITORIAL HOLD: needs_revision\nSelect a useful episode before publication.',evidence:[]}));
 const structured=evidenceQuality(b,s,[],NEW_PLATFORM_POLICY);assert.equal(structured.critic.valid,true);assert.equal(structured.flags.length,0);assert.equal(structured.editorial.blocking,true);
});

test('holds are recognized in designated artifact positions and existing strict Critic JSON, not arbitrary quoted source words',()=>{
 for(const role of ['Story Miner','Strategist','Writer','Platform Adapter','Critic']){
  const q=editorialReview([artifact(role,'EDITORIAL HOLD: needs_source\nMissing a concrete supported episode.')]);
  assert.equal(q.status,'needs_source');assert.equal(q.blocking,true);
 }
 assert.equal(editorialReview([artifact('Platform Adapter','### LinkedIn\n\nEDITORIAL HOLD: needs_revision\nRework the story.')]).blocking,true);
 const data={'Proposed advice:':'EDITORIAL HOLD: needs_source\nMissing a decision or method.'};
 for(const text of [JSON.stringify(data),'```json\n'+JSON.stringify(data)+'\n```'])assert.equal(editorialReview([artifact('Critic',text)]).status,'needs_source');
 for(const text of ['EDITORIAL HOLD: unknown','Editorial hold:','EDITORIAL HOLD','```text\nEDITORIAL HOLD: needs_revision\n```','**EDITORIAL HOLD:** needs_revision','# EDITORIAL HOLD: needs_revision'])assert.equal(editorialReview([artifact('Critic',text)]).status,'needs_editorial_revision');
 for(const [role,text] of [['Harvester','SOURCE: EDITORIAL HOLD: needs_source'],['Writer','The source quotes “EDITORIAL HOLD: needs_source” as a label.'],['Writer','The six outputs contained unsupported claims.'],['Critic',JSON.stringify({'Proposed advice:':'Compare the discussion of an EDITORIAL HOLD: needs_source label.'})]])assert.equal(editorialReview([artifact(role,text)]).blocking,false);
});

test('role prompts preserve useful method, natural source-supported voice and honest source insufficiency without new permissions',()=>{
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const prompt=editorialPrompt(checkpoint);
  for(const wording of ['already uses ChatGPT/Codex','specific goal or constraint','documented decision/instruction/experiment/change','Natural human texture','emotion is optional','EDITORIAL HOLD: needs_source','calendar deadlines do not justify filler'])assert(prompt.includes(wording),wording);
  assert.match(prompt,/not factual evidence/);assert.match(prompt,/Do not add JSON fields, call tools, obtain another source/);
 }
 assert.match(editorialPrompt(5),/existing Proposed advice: value/);
 assert.match(editorialPrompt(5),/Do not change a factual verdict merely to express an editorial preference/);
 const thin='Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: owner/repo\nAuthor account: owner\nCommitter account: owner\nCommit: '+'a'.repeat(40)+'\nfix: a title only';
 assert.match(sourceDraftingContract(3,thin),/does not supply a practical learning episode/);
 assert.match(sourceRoleGoal(1,thin,'ordinary'),/internal editorial hold/);
 assert.match(draftingGuidance(3,NEW_PLATFORM_POLICY,thin),/not a practical episode/);
});

test('the specific work-window episode preserves implementation versus observed result and does not invent queue inspection',()=>{
 const note=readFileSync(new URL('./fixtures/studio-work-window-note-2026-10-25.md',import.meta.url),'utf8');
 for(const detail of ['five-minute autosuspend','two-minute integration requests','five-second signed-in dashboard polling','return before database access when outside','hourly windows','after 60 seconds','SUSPENDED','not uninterrupted sleep'])assert(note.includes(detail),detail);
 const contract=sourceDraftingContract(3,note);
 assert.match(contract,/not proof that it checks whether an actual queue job is due/);
 assert.match(contract,/retain the source’s stated condition/);
 assert.match(editorialPrompt(3),/Use first person only for a narrator established by SOURCE/);
 // This concrete source can support an attributed practical episode; neither
 // exact fact selection nor this check certifies the eventual prose quality.
 const example='The previous setup included two-minute integration requests and five-second dashboard polling. The change validates signed requests first and returns before database access outside configured work windows. Provider checks later showed the endpoint suspended; those observations do not measure monthly savings.';
 const q=editorialReview([artifact('Writer',example)]);assert.equal(q.status,'editorial_review_required');assert.equal(q.blocking,false);
});

async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
async function seed(db:Database){
 const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage({text:source,category:'project-note',reported_date:'2026-10-20'}),cleared=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(cleared.id);
 for(const item of bundle())await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,item.role,item.text,item.hash]);
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 const post='2030-10-29T10:30:00.000Z',schedule={platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:post,draft_due:'2030-10-27T10:30:00.000Z',review_due:'2030-10-27T10:30:00.000Z'}};
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id,platform_schedule) VALUES($1,'2030-10-29','shortform',$2,'2030-10-27T10:30Z','2030-10-27T10:30Z',$3,$4,$5)",[randomUUID(),post,cleared.id,task.id,JSON.stringify(schedule)]);
 const runtime:PublishingRuntime={enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:60,max_lateness_seconds:300,now:()=>new Date('2030-10-25T00:00Z'),accounts:[{id:'fixture-linkedin',platform:'LinkedIn',remote_id:'urn:li:person:12345',label:'Fictional owner',enabled:true,verified:true,authorization_version:'fixture-v1',scopes:['w_member_social'],linkedin_version:'202610'}],credential:async()=>assert.fail('No credential access'),fetch:async()=>assert.fail('No publication')};
 return {db,store,source:cleared,task,runtime,post};
}

test('saved manual editorial rejection preserves history, blocks revision and combined approval, and requires a new correction',()=>fixture(async f=>{
 let review=(await f.store.snapshot()).reviews[0];await f.store.approve(f.task.id,review.token.slice(9));const before=await f.store.snapshot();
 await f.store.revise(f.task.id,review.token,'Editorial rejection recorded, not a model rerun',{role:'Critic',text:held});
 review=(await f.store.snapshot()).reviews[0];assert.equal(review.quality.flags.length,0);assert.equal(review.quality.editorial.blocking,true);assert.equal(review.approval,null);
 const calendar=await new Calendar(f.db).snapshot(await f.store.snapshot(),{},false,new Date('2030-10-25T00:00Z'));const entry=calendar.entries.find((item:{task_id:string})=>item.task_id===f.task.id)!;assert.equal(entry.status,'changes_needed');assert(entry.blocked_reasons.some((reason:string)=>reason.includes('editorial hold')));
 await assert.rejects(f.store.approveRevision(f.task.id,review.token,true),/editorial hold/);
 await assert.rejects(previewApprovalPlan(f.db,f.runtime,f.task.id,review.token),/editorial hold/);
 assert.deepEqual((await f.store.snapshot()).approvals,before.approvals);assert.deepEqual((await f.store.snapshot()).outputs,before.outputs);
 const rejectedToken=review.token;await f.store.revise(f.task.id,rejectedToken,'Fresh editorial assessment, no model rerun',{role:'Critic',text:critic});
 review=(await f.store.snapshot()).reviews[0];assert.equal(review.quality.editorial.status,'editorial_review_required');assert.equal(review.approval,null);
 await assert.rejects(f.store.approveRevision(f.task.id,rejectedToken,true),/Stale revision/);
 await f.store.approveRevision(f.task.id,review.token,true);assert((await f.store.snapshot()).reviews[0].approval);
 assert.equal((await f.db.query('SELECT * FROM ledger')).length,0);assert.equal((await f.db.query('SELECT * FROM publishing_outbox')).length,0);
}));

test('original approval and preexisting receipt cannot authorize an explicit held bundle or a publication plan',()=>fixture(async f=>{
 await f.db.query("UPDATE outputs SET text=$2,hash=$3 WHERE task_id=$1 AND role='Critic'",[f.task.id,held,hash(held)]);
 const review=(await f.store.snapshot()).reviews[0];assert.equal(review.quality.flags.length,0);
 await assert.rejects(f.store.approve(f.task.id,review.token.slice(9)),/editorial hold/);
 assert.equal((await f.db.query('SELECT * FROM approvals')).length,0);
 // Simulate an old saved receipt, not a current approval action. The new guard
 // must reject it without deleting or rewriting that history.
 await f.db.query("INSERT INTO approvals(task_id,version,evidence_version) VALUES($1,$2,NULL)",[f.task.id,review.token.slice(9)]);
 await f.db.query("UPDATE tasks SET status='approved' WHERE id=$1",[f.task.id]);
 await f.db.query('INSERT INTO evidence_approval_receipts(id,task_id,binding,evidence_version,review_token) VALUES($1,$2,$3,$4,$5)',[randomUUID(),f.task.id,review.quality.binding,'',review.token]);
 assert.equal((await f.store.snapshot()).reviews[0].approval,null);
 await assert.rejects(previewApprovalPlan(f.db,f.runtime,f.task.id,review.token),/editorial hold/);
 await assert.rejects(new Publishing(f.db,f.runtime).enqueue({request_id:randomUUID(),task_id:f.task.id,review_token:review.token,platform:'LinkedIn',account_id:'fixture-linkedin',scheduled_at:f.post,payload:{text:source},delivery_mode:'scheduled'}),/editorial hold/);
 assert.equal((await f.db.query('SELECT * FROM approvals')).length,1);assert.equal((await f.db.query('SELECT * FROM evidence_approval_receipts')).length,1);
 assert.equal((await f.db.query('SELECT * FROM publishing_outbox')).length,0);assert.equal((await f.db.query('SELECT * FROM ledger')).length,0);
}));

test('one bounded mocked run retains an upstream source hold even if later draft stages ignore it',async()=>{
 const db=await embedded();
 const pricing:Pricing={model:'isolated-editorial-fixture',pricing_version:'fixture-only',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
 const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing};
 try{
  const store=new Store(db),intake=new SourceIntake(db),staged=await intake.stage({text:source,category:'project-note',reported_date:'2026-10-20'});await intake.clear(staged.id,staged.hash,true);const task=await store.enqueue(staged.id);const prompts:string[]=[];
  for(let checkpoint=0;checkpoint<6;checkpoint++){
   assert.equal((await step(store,config,async(_provider,prompt,_pricing,_transport,_credential,contract)=>{
    prompts.push(prompt);assert(prompt.includes(editorialPrompt(checkpoint)));assert.deepEqual(contract,checkpoint===5?criticContractFromPrompt(prompt):undefined);
    let text=checkpoint===1?'EDITORIAL HOLD: needs_source\nMissing a concrete supported decision or method.':checkpoint===4?'### LinkedIn\n'+source:source;
    if(checkpoint===5){const index=criticCitationIndex(await db.query<Artifact>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]),staged);text=JSON.stringify({schema:2,source_hash:staged.hash,index_hash:index.index_hash,'Unsupported claims:':'Compare current source.','Evidence needed:':'Owner comparison remains required.','Proposed advice:':'Review the current text.',evidence:[]});}
    return {text,input:10,output:10,outcome:'complete',report:{serviceTier:'default',model:pricing.model,requestId:'isolated-mock',finishReason:'stop'}};
   },true)).status,'step_saved');
  }
  const state=await store.snapshot(),review=state.reviews[0];assert.equal(prompts.length,6);assert.equal(state.ledger.length,6);assert.equal(review.quality.flags.length,0);assert.equal(review.quality.critic.valid,true);
  assert.equal(review.quality.editorial.status,'needs_source');assert.equal(review.approval,null);await assert.rejects(store.approve(task.id,review.token.slice(9)),/editorial hold/);
  let reserved=0;for(const row of state.ledger){assert.equal(row.status,'settled');const amount=tokenCost(pricing,Buffer.byteLength(prompts[row.checkpoint])+providerResponseFormatBytes('openai',row.checkpoint===5?criticContractFromPrompt(prompts[row.checkpoint]):undefined)+256,1200);assert.equal(Number(row.reserved),amount);reserved+=amount;}
  assert(reserved<=130000);assert.equal((await db.query('SELECT * FROM publishing_outbox')).length,0);assert.equal((await db.query('SELECT * FROM approvals')).length,0);
 }finally{await db.close();}
});
