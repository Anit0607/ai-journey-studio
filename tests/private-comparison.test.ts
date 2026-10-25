import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {SourceIntake} from '../lib/sources';
import {hash,istMonth,CAP,BUFFER,tokenCost,type RuntimeConfig,type Task} from '../lib/domain';
import * as policy from '../lib/private-comparison-policy';
import {runPrivateComparison,comparisonSnapshot} from '../lib/private-comparison';
import {newTaskPlatformBrief} from '../lib/platform-policy';
import type {ComparisonCompletion,comparisonProvider} from '../lib/private-comparison-provider';
import {canonicalNoteArtifacts} from './canonical-note-helpers';
import {buildDraftPrompt} from '../lib/draft-prompt';
import {draftArtifactContract,providerResponseFormatBytes} from '../lib/critic-response-format';

// Real fixed target and exact hash-reconstructed repository source. PostgreSQL
// semantics run offline; only provider transport is replaced, never source gates.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/database-note-draft-2026-10-25.json',import.meta.url),'utf8'));
let db:Database;
before(async()=>{const local=await embedded();db={...local,kind:'postgres'};});
after(async()=>{await db.close();});
beforeEach(async()=>{await db.query('TRUNCATE sources,events,budget_months,runtime CASCADE');});
function config():RuntimeConfig{return {owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{...policy.COMPARISON_PRICING,model:'unchanged-production-model'}};}
async function seed(){
 const c=config(),intake=new SourceIntake(db),text=readFileSync(new URL('./fixtures/private-comparison-source.txt',import.meta.url),'utf8');
 assert.equal(hash(text),policy.COMPARISON_TARGET.source_hash);
 const staged=await intake.stage({text,category:'project-note',reported_date:'2026-10-25'});
 await db.query('UPDATE sources SET id=$1 WHERE id=$2',[policy.COMPARISON_TARGET.source_id,staged.id]);
 const source=await intake.clear(policy.COMPARISON_TARGET.source_id,staged.hash,true);
 await db.query("INSERT INTO tasks(id,source_id,source_hash,status,checkpoint,content_brief) VALUES($1,$2,$3,'review',6,$4)",[policy.COMPARISON_TARGET.task_id,source.id,source.hash,JSON.stringify({...newTaskPlatformBrief(),kind:'shortform'})]);
 const task=(await db.query<Task>('SELECT * FROM tasks WHERE id=$1',[policy.COMPARISON_TARGET.task_id]))[0];
 const artifacts=canonicalNoteArtifacts(source,fixture.outputs);
 for(const [n,o] of artifacts.entries())await db.query('INSERT INTO outputs(id,task_id,role,text,hash,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),task.id,o.role,o.text,o.hash,new Date(Date.UTC(2026,9,25,0,0,n)).toISOString()]);
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 const calendar=policy.COMPARISON_TARGET.calendar_id;await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,source_id,task_id) VALUES($1,'2026-10-27','shortform','2026-10-27T12:00:00Z','2026-10-26T12:00:00Z','2026-10-26T12:00:00Z',$2,$3)",[calendar,source.id,task.id]);
 const exports={runPrivateComparison,comparisonSnapshot},target=policy.COMPARISON_TARGET;
 const preview=await exports.comparisonSnapshot(db,c);assert(preview.preview);
 const input={expected_state_hash:preview.preview.state_hash,scope_hash:policy.COMPARISON_SCOPE_HASH,acknowledged:true as const};
 let calls=0;const prompts:string[]=[];
 const fake:typeof comparisonProvider=async(prompt)=>{const n=calls++;prompts.push(prompt);return completion(artifacts[n].text);};
 const options={readConfig:()=>c,ready:()=>true,provider:fake};
 return {db,c,source,task,target,exports,input,options,artifacts,prompts,calls:()=>calls};
}
function completion(text:string):ComparisonCompletion{return {text,input:100,output:100,complete:true,report:{model:policy.COMPARISON_PRICING.model,tier:'default',request_id:'offline',finish_reason:'stop'},raw:{id:'offline',text}};}
async function originalState(){const state:Record<string,unknown>={};for(const table of ['tasks','sources','outputs','calendar_entries','approvals','publishing_outbox','hosted_batches'])state[table]=await db.query('SELECT * FROM '+table);return JSON.stringify(state);}

test('fixed production target, model consent and conservative six-stage reservation fit the approved cap',()=>{
 assert.equal(policy.COMPARISON_TARGET.source_hash,'b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603');
 assert.equal(policy.COMPARISON_SCOPE_HASH,hash(JSON.stringify(policy.COMPARISON_SCOPE)));
 assert.equal(policy.COMPARISON_PLAN.reduce((sum,x)=>sum+x.maximum_microdollars,0),675760);
 assert.equal(policy.COMPARISON_INPUT_BOUNDS.reduce((sum,bound)=>sum+tokenCost(policy.COMPARISON_PRICING,bound,4096),0),675760);
 assert(675760<policy.COMPARISON_CAP);assert.equal(policy.COMPARISON_CAP,850000);
 assert(policy.COMPARISON_PLAN.every(x=>x.model==='gpt-6.1-sol'&&x.reasoning_effort==='low'));
});
test('six unchanged outputs and critic failures are retained, with no task, Calendar, grant, approval or publication writes',async(t)=>{
 const f=await seed(),before=await originalState(),configuration=JSON.stringify(f.c);
 const result=await f.exports.runPrivateComparison(db,f.input,f.options);
 assert.equal(result.status,'completed_requires_review');assert.equal(result.steps,6);assert.equal(f.calls(),6);
 assert.equal(await originalState(),before);assert.equal(JSON.stringify(f.c),configuration);
 const snapshot=await f.exports.comparisonSnapshot(db,f.c),stages=snapshot.history.filter(e=>e.kind==='private_comparison_stage');
 assert.equal(stages.length,6);for(const [n,s] of stages.entries()){assert.equal(s.detail.text,f.artifacts[n].text);assert.equal(s.detail.hash,hash(f.artifacts[n].text));assert.equal(s.detail.raw.text,f.artifacts[n].text);}
 const end=snapshot.history.find(e=>e.kind==='private_comparison_finished')!;assert(end.detail.assessment.flags.length>0,'fixture failures must remain visible');
 const ledger=await db.query('SELECT * FROM ledger');assert.equal(ledger.length,1);assert.equal(ledger[0].status,'settled');assert.equal(Number(ledger[0].reserved),850000);assert.equal(Number(ledger[0].estimated),7500);
 for(let n=0;n<6;n++){const prompt=buildDraftPrompt({...f.task,checkpoint:n},f.source,f.artifacts.slice(0,n));assert.equal(f.prompts[n],prompt);assert(Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',draftArtifactContract({...f.task,checkpoint:n},f.source,f.artifacts.slice(0,n)))+1024<=policy.COMPARISON_INPUT_BOUNDS[n]);}
 t.diagnostic('Exact source / offline fixture prompt bounds, including schema and framing: '+JSON.stringify(f.prompts.map((prompt,n)=>({role:policy.COMPARISON_PLAN[n].role,input_bound:Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',draftArtifactContract({...f.task,checkpoint:n},f.source,f.artifacts.slice(0,n)))+1024}))));
});
test('concurrent and later attempts cannot start another provider chain',async()=>{
 const f=await seed();let release!:()=>void,entered!:()=>void,count=0;const barrier=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const provider:typeof comparisonProvider=async()=>{const n=count++;if(!n){entered();await barrier;}return completion(f.artifacts[n].text);};
 const first=f.exports.runPrivateComparison(db,f.input,{...f.options,provider});await started;
 assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'duplicate');release();await first;
 assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'duplicate');assert.equal(count,6);
});
test('strict request cannot change model, target, provider, cap or scope',async()=>{
 const f=await seed();
 for(const input of [null,{},[],{...f.input,acknowledged:false},{...f.input,scope_hash:hash('other')},{...f.input,model:'gpt-6-astra'},{...f.input,expected_state_hash:22}]){assert.equal(policy.validComparisonRequest(input),false);assert.equal((await f.exports.runPrivateComparison(db,input as any,f.options)).status,'blocked');}
 assert.equal(f.calls(),0);assert.equal((await db.query('SELECT * FROM ledger')).length,0);
});
test('stale snapshot, disabled release, local database and changed production config stop before reservation',async()=>{
 const f=await seed();
 assert.equal((await f.exports.runPrivateComparison(db,{...f.input,expected_state_hash:hash('stale')},f.options)).status,'blocked');
 assert.equal((await f.exports.runPrivateComparison(db,f.input,{...f.options,ready:()=>false})).status,'blocked');
 assert.equal((await f.exports.runPrivateComparison({...db,kind:'pglite'},f.input,f.options)).status,'blocked');
 f.c.openai!.model='changed';assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'blocked');
 assert.equal(f.calls(),0);assert.equal((await db.query('SELECT * FROM ledger')).length,0);
});
for(const [label,sql] of [['source revocation',"UPDATE sources SET cleared=false,revoked_at=now()"],['artifact tamper',"UPDATE outputs SET text='changed' WHERE role='Writer'"],['calendar change',"UPDATE calendar_entries SET intended_post='2026-10-28T12:00:00Z'"],['task cancellation',"UPDATE tasks SET status='cancelled'"]])test(label+' during a call saves raw output and cost, then stops without a second call',async()=>{
 const f=await seed();let calls=0;
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{calls++;await db.query(sql);return completion(f.artifacts[0].text);}});
 assert.equal(result.status,'blocked');assert.equal(calls,1);const snap=await f.exports.comparisonSnapshot(db,f.c);assert.equal(snap.history.filter(e=>e.kind==='private_comparison_stage').length,1);assert.equal((await db.query('SELECT status FROM ledger'))[0].status,'settled');
});
for(const change of ['model','tier','tokens','network'])test('uncertain '+change+' retains full reservation and never retries',async()=>{
 const f=await seed();let calls=0;
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{calls++;if(change==='network')throw Error('do not persist credential-bearing exception');const value=completion(f.artifacts[0].text);if(change==='model')value.report.model='wrong-model';if(change==='tier')value.report.tier='priority';if(change==='tokens')value.input=999999;return value;}});
 assert.equal(result.status,'uncertain');assert.equal(calls,1);const row=(await db.query('SELECT * FROM ledger'))[0];assert.equal(row.status,'unknown');assert.equal(Number(row.reserved),850000);assert.equal(row.estimated,null);assert.equal(row.pricing_anomaly,change!=='network');
 assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'duplicate');
 assert(!JSON.stringify(await f.exports.comparisonSnapshot(db,f.c)).includes('credential-bearing'));
});
test('incomplete output retains exact raw text and known cost, without advancing another role',async()=>{
 const f=await seed(),value={...completion('partial original output'),complete:false};
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>value});assert.equal(result.status,'incomplete');assert.equal(result.steps,1);assert.equal((await db.query('SELECT status FROM ledger'))[0].status,'settled');
 const snap=await f.exports.comparisonSnapshot(db,f.c);assert.equal(snap.history.find(e=>e.kind==='private_comparison_stage')!.detail.text,value.text);
});
test('invalid canonical selection is retained and blocks the next paid stage',async()=>{
 const f=await seed();let calls=0;const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{calls++;return completion('{"made_up_fact":true}');}});assert.equal(result.status,'contract_failed');assert.equal(calls,1);
});
test('monthly cap, prior-month unknown usage and missing estimated amounts block before any provider',async()=>{
 const f=await seed();
 for(const [status,reserved,estimated,month] of [['settled',CAP,CAP-BUFFER-policy.COMPARISON_CAP+1,istMonth()],['unknown',1,null,'2026-09'],['reserved',1,null,istMonth()],['settled',1,null,istMonth()]] as const){
  await db.query('INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING',[month]);await db.query('INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,estimated,status) VALUES($1,$2,$3,\'openai\',\'original\',\'{}\',$4,$5,$6)',[randomUUID(),f.task.id,month,reserved,estimated,status]);
  assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'blocked');await db.query('DELETE FROM ledger');
 }
 assert.equal(f.calls(),0);
});
test('oversized generated context is retained, never silently truncated or sent to another role',async()=>{
 const f=await seed();let count=0;const huge='A'.repeat(50000),provider:typeof comparisonProvider=async()=>{const n=count++;return completion(n===3?huge:f.artifacts[n].text);};
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider});assert.equal(result.status,'blocked');assert.equal(count,4);const snap=await f.exports.comparisonSnapshot(db,f.c);assert.equal(snap.history.find(e=>e.kind==='private_comparison_stage'&&e.detail.checkpoint===3)!.detail.text,huge);
});
test('read-only snapshots never reconcile reservations or resume interrupted runs',async()=>{
 const f=await seed(),before=await originalState();await f.exports.comparisonSnapshot(db,f.c);await f.exports.comparisonSnapshot(db,f.c);assert.equal(f.calls(),0);assert.equal(await originalState(),before);assert.equal((await db.query('SELECT * FROM ledger')).length,0);
});
test('a timed-out transport retains reservation and a late response cannot settle or save output',async(t)=>{
 const f=await seed();let entered!:()=>void,release!:(value:ComparisonCompletion)=>void;
 const started=new Promise<void>(r=>entered=r),pending=new Promise<ComparisonCompletion>(r=>release=r);
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const run=f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{entered();return pending;}});
  await started;t.mock.timers.tick(35001);assert.equal((await run).status,'uncertain');
  release(completion(f.artifacts[0].text));await Promise.resolve();
  const snapshot=await f.exports.comparisonSnapshot(db,f.c);assert.equal(snapshot.history.filter(e=>e.kind==='private_comparison_stage').length,0);assert.equal((await db.query('SELECT status FROM ledger'))[0].status,'unknown');
 }finally{t.mock.timers.reset();}
});
test('runtime revocation or request cancellation while in flight saves known usage and stops',async()=>{
 for(const kind of ['config','abort']){
  if(kind==='abort')await db.query('TRUNCATE sources,events,budget_months,runtime CASCADE');
  const f=await seed(),controller=new AbortController();let calls=0;
  const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,signal:controller.signal,provider:async()=>{calls++;if(kind==='config')f.c.credential_use_authorized=false;else controller.abort();return completion(f.artifacts[0].text);}});
  assert.equal(result.status,'blocked');assert.equal(calls,1);assert.equal((await db.query('SELECT status FROM ledger'))[0].status,'settled');
 }
});
test('uncleared private format-context material cannot enter the comparison prompt',async()=>{
 const f=await seed();await db.query("UPDATE tasks SET content_brief=content_brief||$1::jsonb WHERE id=$2",[JSON.stringify({editorial_note:'Bandhan Bank material is excluded'}),f.task.id]);
 assert.equal((await f.exports.comparisonSnapshot(db,f.c)).preview,null);assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'blocked');assert.equal(f.calls(),0);assert.equal((await db.query('SELECT * FROM ledger')).length,0);
});


test('privacy rejection retains a fixed diagnosis and simultaneous Critic editorial hold without clearing either',async()=>{
 const f=await seed(),before=await originalState(),critic=JSON.parse(f.artifacts[5].text);
 critic['Proposed advice:']='EDITORIAL HOLD: needs_revision. No bank/client material or invented personal experience is apparent.';
 const criticText=JSON.stringify(critic);let count=0;
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{const n=count++;return completion(n===5?criticText:f.artifacts[n].text);}});
 assert.equal(result.status,'privacy_hold');assert.equal(result.steps,6);assert.equal(count,6);assert.equal(await originalState(),before);
 const snapshot=await f.exports.comparisonSnapshot(db,f.c),end=snapshot.history.find(e=>e.kind==='private_comparison_finished')!.detail;
 assert.equal(end.assessment.issue,'artifact_privacy_blocked');assert.equal(end.assessment.checkpoint,5);assert.equal(end.assessment.role,'Critic');assert.equal(end.assessment.editorial.blocking,true);assert.equal(end.assessment.editorial.status,'needs_editorial_revision');
 assert.equal(end.reservation_retained,false);assert.equal(end.known_microdollars,7500);
 const saved=snapshot.history.find(e=>e.kind==='private_comparison_stage'&&e.detail.checkpoint===5)!.detail;assert.equal(saved.text,criticText);assert.equal(saved.hash,hash(criticText));assert.equal(saved.raw.text,criticText);
 assert(!JSON.stringify(end.assessment).includes('bank/client'));assert.equal((await db.query('SELECT status FROM ledger'))[0].status,'settled');
 assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'duplicate');assert.equal(count,6);
 const {verifiedComparisonRun}=await import('../lib/private-comparison-record'),eventRows=await db.query('SELECT * FROM events'),ledger=await db.query('SELECT * FROM ledger');assert.throws(()=>verifiedComparisonRun(eventRows,ledger,result.run_id!));
});

test('genuine credential-shaped generated material still stops the chain without exposing it in diagnostics',async()=>{
 const f=await seed(),before=await originalState(),unsafe='password=synthetic-fixture-value';let count=0;
 const result=await f.exports.runPrivateComparison(db,f.input,{...f.options,provider:async()=>{const n=count++;return completion(n===3?unsafe:f.artifacts[n].text);}});
 assert.equal(result.status,'privacy_hold');assert.equal(count,4);assert.equal(await originalState(),before);
 const snapshot=await f.exports.comparisonSnapshot(db,f.c),end=snapshot.history.find(e=>e.kind==='private_comparison_finished')!.detail;
 assert.equal(end.assessment.issue,'artifact_privacy_blocked');assert.equal(end.assessment.checkpoint,3);assert.equal(end.assessment.editorial.blocking,false);assert(!JSON.stringify(end.assessment).includes(unsafe));
 const saved=snapshot.history.find(e=>e.kind==='private_comparison_stage'&&e.detail.checkpoint===3)!.detail;assert.equal(saved.text,unsafe);assert.equal(saved.hash,hash(unsafe));
 assert.equal((await f.exports.runPrivateComparison(db,f.input,f.options)).status,'duplicate');assert.equal(count,4);
});
