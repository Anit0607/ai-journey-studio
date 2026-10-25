import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {embedded,type Database} from '../lib/db';
import {SourceIntake} from '../lib/sources';
import {hash,type Source,type RuntimeConfig} from '../lib/domain';
import {COMPARISON_TARGET as target,COMPARISON_PRICING,COMPARISON_SCOPE_HASH} from '../lib/private-comparison-policy';
import {comparisonSnapshot,runPrivateComparison} from '../lib/private-comparison';
import {adoptPrivateComparison,validComparisonAdoption} from '../lib/private-comparison-adoption';
import {COMPARISON_ADOPTED} from '../lib/private-comparison-record';
import {canonicalNoteArtifacts} from './canonical-note-helpers';
import {newTaskPlatformBrief,NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {criticCitationIndex} from '../lib/evidence-review';
import {previewApprovalPlan} from '../lib/approval-plan';
import type {PublishingRuntime} from '../lib/publishing';
import {bindScopedComparisonFixture} from './private-comparison-adoption-fixture';
import {Store} from '../lib/store';
import AgentContributionsPanel from '../app/agent-contributions-panel';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/database-note-draft-2026-10-25.json',import.meta.url),'utf8'));
let db:Database;
before(async()=>{const local=await embedded();db={...local,kind:'postgres'};});
after(async()=>{await db.close();});
beforeEach(async()=>{await db.query('TRUNCATE sources,events,budget_months,runtime CASCADE');});
async function seed(options:{scoped?:boolean;clean?:boolean}={}){
 const c:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{...COMPARISON_PRICING,model:'unchanged-production-model'}};
 const intake=new SourceIntake(db),text=readFileSync(new URL('./fixtures/private-comparison-source.txt',import.meta.url),'utf8');
 const staged=await intake.stage({text,category:'project-note',reported_date:'2026-10-25'});
 await db.query('UPDATE sources SET id=$1 WHERE id=$2',[target.source_id,staged.id]);
 let source=options.scoped?(await db.query<Source>('SELECT * FROM sources WHERE id=$1',[target.source_id]))[0]:await intake.clear(target.source_id,staged.hash,true);
 await db.query("INSERT INTO tasks(id,source_id,source_hash,status,checkpoint,content_brief) VALUES($1,$2,$3,'review',6,$4)",[target.task_id,source.id,source.hash,JSON.stringify({...newTaskPlatformBrief(),kind:'shortform'})]);
 const artifacts=canonicalNoteArtifacts(source,fixture.outputs);
 if(options.clean){
  const quote=source.text.split('\n').find(s=>s.startsWith('- Updated source intake'))!.slice(2);
  artifacts[3]={role:'Writer',text:quote,hash:hash(quote)};artifacts[4]={role:'Platform Adapter',text:'### LinkedIn\n'+quote,hash:hash('### LinkedIn\n'+quote)};
  const index=criticCitationIndex(artifacts.slice(0,5),source),text=JSON.stringify({schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'Compare every current assertion to source.','Evidence needed:':'Human source comparison is required.','Proposed advice:':'Review the practical episode before approval.',evidence:[]});artifacts[5]={role:'Critic',text,hash:hash(text)};
 }
 for(const [n,o] of artifacts.entries())await db.query('INSERT INTO outputs(id,task_id,role,text,hash,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),target.task_id,o.role,o.text,o.hash,new Date(Date.UTC(2026,9,25,0,0,n)).toISOString()]);
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id) VALUES($1,'2026-11-01','shortform','2026-11-01T16:30:00Z','2026-10-26T12:00:00Z','2026-10-30T16:30:00Z',$2,$3)",[target.calendar_id,source.id,target.task_id]);
 await db.query('UPDATE calendar_entries SET platform_schedule=$2::jsonb WHERE id=$1',[target.calendar_id,JSON.stringify({platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:'2026-11-01T16:30:00Z',draft_due:'2026-10-26T12:00:00Z',review_due:'2026-10-30T16:30:00Z'}})]);
 const scoped=options.scoped?await bindScopedComparisonFixture(db,c,source):null;if(scoped)source=scoped.source;
 const store=new Store(db),review=(await store.snapshot()).reviews.find((r:any)=>r.task_id===target.task_id),preview=await comparisonSnapshot(db,c);assert(preview.preview);
 let calls=0;
 const result=await runPrivateComparison(db,{scope_hash:COMPARISON_SCOPE_HASH,expected_state_hash:preview.preview.state_hash,acknowledged:true},{readConfig:()=>c,ready:()=>true,provider:async()=>{
  const text=artifacts[calls++].text;
  return {text,input:100,output:100,complete:true,report:{model:COMPARISON_PRICING.model,tier:'default',finish_reason:'stop',request_id:'offline'},raw:{model:COMPARISON_PRICING.model,service_tier:'default',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:100,completion_tokens:100}}};
 }});
 assert.equal(result.status,'completed_requires_review');assert.equal(calls,6);
 const request={run_id:result.run_id!,task_id:target.task_id,scope_hash:COMPARISON_SCOPE_HASH,expected_review_token:review.token};
 return {c,store,source,artifacts,request,scoped};
}
async function protectedState(){const rows:Record<string,unknown>={};for(const table of ['tasks','sources','outputs','calendar_entries','approvals','revision_approvals','evidence_decisions','evidence_approval_receipts','publishing_outbox','publishing_approvals','publishing_requests','github_source_policies','github_source_grants','source_provenance','ledger','hosted_batches'])rows[table]=await db.query('SELECT * FROM '+table);return JSON.stringify(rows);}
async function mutateEvent(kind:string,change:(detail:any)=>void){const row=(await db.query('SELECT * FROM events WHERE kind=$1 ORDER BY created,id LIMIT 1',[kind]))[0],detail=JSON.parse(row.detail);change(detail);await db.query('UPDATE events SET detail=$2 WHERE id=$1',[row.id,JSON.stringify(detail)]);}
async function assertNoAdoption(){assert.equal((await db.query('SELECT * FROM content_revisions')).length,0);assert.equal((await db.query('SELECT * FROM events WHERE kind=$1',[COMPARISON_ADOPTED])).length,0);}

test('adopts six exact model outputs atomically, preserves every original and every review hold, and creates no approval or job',async()=>{
 const f=await seed(),before=await protectedState(),events=await db.query('SELECT * FROM events ORDER BY created,id'),config=JSON.stringify(f.c);
 const result=await adoptPrivateComparison(db,f.request,f.c);assert.equal(result.status,'adopted_requires_review');assert(result.readiness!.flags.length>0);
 assert.equal(await protectedState(),before);assert.equal(JSON.stringify(f.c),config);
 assert.deepEqual((await db.query('SELECT * FROM events WHERE kind!=$1 ORDER BY created,id',[COMPARISON_ADOPTED])),events);
 const rows=await db.query('SELECT * FROM content_revisions');assert.equal(rows.length,1);assert.equal(rows[0].agent_task_id,null);assert.equal(rows[0].base_token,f.request.expected_review_token);
 assert.deepEqual(rows[0].bundle,f.artifacts.map(({role,text,hash})=>({role,text,hash})));
 const snapshot=await f.store.snapshot(),review=snapshot.reviews.find((r:any)=>r.task_id===target.task_id);
 assert.equal(review.token,result.review_token);assert.equal(review.approval,null);assert.deepEqual(review.quality.flags,result.readiness!.flags);
 assert(review.contributions.roles.every((r:any)=>r.current_origin.kind==='private_comparison'&&r.current_origin.model==='gpt-6.1-sol'&&r.current_origin.run_id===f.request.run_id));
 const html=renderToStaticMarkup(createElement(AgentContributionsPanel,{contributions:review.contributions}));assert(html.includes('Private model comparison output — gpt-6.1-sol'));assert(!html.includes('Manual editor change'));
});
test('duplicate and concurrent adoption create only one revision; replay never replaces a later manual edit',async()=>{
 const f=await seed(),results=await Promise.all([adoptPrivateComparison(db,f.request,f.c),adoptPrivateComparison(db,f.request,f.c)]);
 assert.deepEqual(results.map(r=>r.status).sort(),['adopted_requires_review','already_adopted']);assert.equal(results[0].revision_id,results[1].revision_id);
 const updated=await f.store.revise(target.task_id,results[0].review_token,'Explicit manual edit',{role:'Writer',text:'Proposed approach: inspect your background timers.'});
 const before=await db.query('SELECT * FROM content_revisions ORDER BY sequence');assert.equal((await adoptPrivateComparison(db,f.request,f.c)).status,'already_adopted');assert.deepEqual(await db.query('SELECT * FROM content_revisions ORDER BY sequence'),before);
 const review=(await f.store.snapshot()).reviews.find((r:any)=>r.task_id===target.task_id);assert.equal(review.latest_revision,updated.id);assert.equal(review.contributions.roles[3].current_origin.kind,'manual_edit');assert.equal(review.contributions.roles[4].current_origin.kind,'private_comparison');
 await assert.rejects(adoptPrivateComparison(db,{...f.request,expected_review_token:'original:'+hash('different')},f.c));
});
test('request rejects task/scope mismatch, arbitrary texts, missing fields and malformed run or review token',async()=>{
 const f=await seed();for(const request of [null,{},[],{...f.request,task_id:randomUUID()},{...f.request,scope_hash:hash('other')},{...f.request,bundle:f.artifacts},{...f.request,run_id:'x'},{...f.request,expected_review_token:'x'}]){assert.equal(validComparisonAdoption(request),false);await assert.rejects(adoptPrivateComparison(db,request as any,f.c));}await assertNoAdoption();
});
test('stale review token or a newer review blocks adoption, without changes to that review',async()=>{
 const f=await seed();await assert.rejects(adoptPrivateComparison(db,{...f.request,expected_review_token:'original:'+hash('stale')},f.c));await assertNoAdoption();
 await f.store.revise(target.task_id,f.request.expected_review_token,'A newer owner review exists');const before=await db.query('SELECT * FROM content_revisions');await assert.rejects(adoptPrivateComparison(db,f.request,f.c));assert.deepEqual(await db.query('SELECT * FROM content_revisions'),before);
});
for(const [label,sql] of [
 ['source revocation','UPDATE sources SET cleared=false,revoked_at=now()'],
 ['source hash change',"UPDATE sources SET hash='"+hash('other')+"'"],
 ['original output tamper',"UPDATE outputs SET text='tampered' WHERE role='Writer'"],
 ['task mismatch',"UPDATE tasks SET content_brief=content_brief||'{\"changed\":true}'::jsonb"],
 ['calendar change',"UPDATE calendar_entries SET intended_post='2026-11-02T16:30:00Z'"],
 ['unsettled ledger',"UPDATE ledger SET status='unknown'"],
 ['wrong ledger model',"UPDATE ledger SET model='wrong'"],
 ['incorrect usage',"UPDATE ledger SET input_tokens=1"],
 ['pricing anomaly',"UPDATE ledger SET pricing_anomaly=true"],
 ['missing stage',"DELETE FROM events WHERE id=(SELECT id FROM events WHERE kind='private_comparison_stage' LIMIT 1)"],
] as const)test('rejects '+label+' without appending revision',async()=>{const f=await seed();await db.query(sql);await assert.rejects(adoptPrivateComparison(db,f.request,f.c));await assertNoAdoption();});
test('changed production runtime or pending agent revision blocks adoption',async()=>{
 const f=await seed();await assert.rejects(adoptPrivateComparison(db,f.request,{...f.c,credential_use_authorized:false}));
 await db.query("INSERT INTO tasks(id,source_id,source_hash,status,revision_parent_task_id,origin_key,revision_base_token,revision_note) VALUES($1,$2,$3,'queued',$4,'revision-fixture','original:offline','Offline revision feedback')",[randomUUID(),target.source_id,target.source_hash,target.task_id]);await assert.rejects(adoptPrivateComparison(db,f.request,f.c));await assertNoAdoption();
});
for(const [label,kind,mutate] of [
 ['failed run','private_comparison_finished',(d:any)=>d.status='contract_failed'],
 ['retained reservation','private_comparison_finished',(d:any)=>d.reservation_retained=true],
 ['wrong scope','private_comparison_started',(d:any)=>d.scope_hash=hash('wrong')],
 ['mismatched source','private_comparison_started',(d:any)=>d.scope.target.source_hash=hash('wrong')],
 ['truncated output','private_comparison_stage',(d:any)=>{d.report.finish_reason='length';d.raw.choices[0].finish_reason='length';}],
 ['raw text mismatch','private_comparison_stage',(d:any)=>d.raw.choices[0].message.content+='changed'],
 ['output hash mismatch','private_comparison_stage',(d:any)=>d.text+='changed'],
 ['refusal','private_comparison_stage',(d:any)=>d.raw.choices[0].message.refusal='refused'],
 ['wrong billing tier','private_comparison_stage',(d:any)=>d.report.tier='priority'],
 ['duplicate role','private_comparison_stage',(d:any)=>{d.role='Writer';d.checkpoint=3;}],
] as const)test('rejects '+label+' in immutable comparison evidence',async()=>{const f=await seed();await mutateEvent(kind,mutate);await assert.rejects(adoptPrivateComparison(db,f.request,f.c));await assertNoAdoption();});
test('a forged revision note does not claim model provenance, and corrupted receipts report unknown',async()=>{
 const f=await seed(),result=await adoptPrivateComparison(db,f.request,f.c);
 await mutateEvent(COMPARISON_ADOPTED,d=>d.stages[0].hash=hash('forged'));
 let review=(await f.store.snapshot()).reviews.find((r:any)=>r.task_id===target.task_id);assert(review.contributions.roles.every((r:any)=>r.current_origin.kind==='unknown'));
 await assert.rejects(adoptPrivateComparison(db,f.request,f.c));
 await f.store.revise(target.task_id,result.review_token,'Model comparison output — gpt-6.1-sol',{role:'Writer',text:'A manual replacement, not model evidence.'});
 review=(await f.store.snapshot()).reviews.find((r:any)=>r.task_id===target.task_id);assert.equal(review.contributions.roles[3].current_origin.kind,'manual_edit');
});
test('event write failure rolls back revision insertion as well',async()=>{
 const f=await seed();const failing:Database={...db,transaction:work=>db.transaction(tx=>work({query:(sql,params)=>{if(sql.startsWith('INSERT INTO events'))throw Error('offline injected write failure');return tx.query(sql,params);}}))};
 await assert.rejects(adoptPrivateComparison(failing,f.request,f.c));await assertNoAdoption();
});
test('existing publication history is never silently superseded or mutated',async()=>{
 const f=await seed();
 await db.query("INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,source_clearance_token,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version) VALUES($1,$2,$3,$4,$5,'offline-clearance',$6,$7,$7,'LinkedIn','offline','offline','offline','{}','2026-11-01T16:30:00Z','offline-version')",[randomUUID(),randomUUID(),target.task_id,target.source_id,target.source_hash,f.request.expected_review_token,hash('offline')]);
 const before=await protectedState();await assert.rejects(adoptPrivateComparison(db,f.request,f.c));await assertNoAdoption();assert.equal(await protectedState(),before);
});

test('scoped model provenance survives adoption and exact future LinkedIn preview without owner decisions or approval',async()=>{
 const f=await seed({scoped:true,clean:true}),before=await protectedState(),queries:string[]=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{queries.push(sql);return tx.query(sql,params);}}))};
 const result=await adoptPrivateComparison(observed,f.request,f.c);assert.equal(result.readiness!.flags.length,0);assert.equal(await protectedState(),before);
 const find=(text:string)=>queries.findIndex(sql=>sql.includes(text));assert(find('FROM calendar_settings')<find('FROM integration_oauth_guard'));assert(find('FROM integration_oauth_guard')<find('FROM calendar_entries'));assert(find('FROM calendar_entries')<find('FROM tasks'));
 const runtime:PublishingRuntime={enabled:false,credential_use_authorized:false,scheduler_authorized:false,now:()=>new Date('2026-10-25T18:00:00Z'),accounts:[{id:'offline-linkedin',platform:'LinkedIn',remote_id:'urn:li:person:offline',label:'Offline owner',enabled:true,verified:true,authorization_version:'offline-v1',scopes:['w_member_social'],linkedin_version:'202610'}],credential:async()=>assert.fail('No credential read permitted'),fetch:async()=>assert.fail('No network permitted')};
 const plan=await previewApprovalPlan(db,runtime,target.task_id,result.review_token);assert.equal(plan.text,f.artifacts[3].text);assert.equal(plan.scheduled_at,'2026-11-01T16:30:00.000Z');assert.equal(plan.review_token,result.review_token);assert.equal(plan.account_id,'offline-linkedin');assert.equal(plan.account_version,'offline-v1');assert.equal(plan.remote_id,'urn:li:person:offline');assert.equal(await protectedState(),before);
 const review=(await f.store.snapshot()).reviews.find((r:any)=>r.task_id===target.task_id);assert(review.contributions.roles.every((r:any)=>r.current_origin.kind==='private_comparison'));assert.equal(review.approval,null);
});
for(const change of ['revocation','source_revocation','provenance','grant','task_binding'])test('scoped '+change+' blocks adoption with unchanged model and review history',async()=>{
 const f=await seed({scoped:true});
 if(change==='revocation')await f.scoped!.policies.revoke(f.scoped!.policy.id,f.scoped!.policy.scope_hash,f.scoped!.session);
 if(change==='source_revocation')await new SourceIntake(db).revoke(target.source_id,target.source_hash);
 if(change==='provenance')await db.query("UPDATE source_provenance SET metadata=jsonb_set(metadata,'{blob_sha}',$1::jsonb)",[JSON.stringify('c'.repeat(40))]);
 if(change==='grant')await db.query("UPDATE github_source_grants SET source_hash=$1",[hash('other')]);
 if(change==='task_binding')await db.query("UPDATE tasks SET content_brief=jsonb_set(content_brief,'{source_policy,grant_id}',$1::jsonb) WHERE id=$2",[JSON.stringify(randomUUID()),target.task_id]);
 const before=await protectedState();await assert.rejects(adoptPrivateComparison(db,f.request,f.c));await assertNoAdoption();assert.equal(await protectedState(),before);
});
