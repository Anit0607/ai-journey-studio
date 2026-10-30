import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {Publishing,type PublishingRuntime,type PublishInput} from '../lib/publishing';
import {Store} from '../lib/store';
import {CAPSULE,ROLES,hash} from '../lib/domain';
import {enqueueLegacy} from './legacy-task-fixture';
import {variantFixture} from './variant-fixture';
import {schedulerWindowPolicy} from '../lib/scheduler-window-policy';
import {fixedSettings} from './scheduler-window-fixture';
const POST='2026-10-26T18:00:00.000Z',TEXT='Proposed approach: inspect one cleared source.';
async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
async function seed(db:Database){
 const store=new Store(db),source=await store.source(CAPSULE,'user-reported-notes','2026-10-09',true),task=await enqueueLegacy(store,source.id);
 for(const role of ROLES){const text=role==='Critic'?'Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: inspect a draft':role==='Platform Adapter'?variantFixture(TEXT):TEXT;await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,role,text,hash(text)]);}
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);const outputs=await db.query<{hash:string}>('SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]),version=hash(outputs.map(item=>item.hash).join('|'));await store.approve(task.id,version);
 let now=new Date(POST),calls=0,credentials=0;
 const runtime:PublishingRuntime={scheduler_window_policy:schedulerWindowPolicy(fixedSettings().scheduler),now:()=>now,enabled:true,credential_use_authorized:true,scheduler_authorized:true,scheduler_interval_seconds:120,max_lateness_seconds:300,accounts:[{id:'window-li',platform:'LinkedIn',remote_id:'urn:li:person:12345',label:'Isolated account',enabled:true,verified:true,authorization_version:'test-v1',scopes:['w_member_social'],linkedin_version:'202610'}],credential:async()=>{credentials++;return 'offline-test-only';},fetch:async()=>{calls++;return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:12345'}});}};
 const input:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:'original:'+version,platform:'LinkedIn',account_id:'window-li',scheduled_at:POST,payload:{text:TEXT}};
 return {db,store,source,task,runtime,input,publisher:new Publishing(db,runtime),setNow:(value:string)=>{now=new Date(value);},counts:()=>({calls,credentials})};
}

test('scheduled enqueue/revise/approval enforce exact anchors and immutable policy binding',()=>fixture(async f=>{
 for(const at of ['2026-10-26T17:56:00Z','2026-10-26T18:02:00Z','2026-11-05T10:30:00Z'])await assert.rejects(f.publisher.enqueue({...f.input,scheduled_at:at}),/exact configured UTC anchor/);
 const row=await f.publisher.enqueue(f.input);assert.equal(row.scheduler_policy_hash,f.runtime.scheduler_window_policy!.hash);await f.publisher.approve(row.id,row.version,true);
 await assert.rejects(f.publisher.revise(row.id,row.version,{...f.input,scheduled_at:'2026-10-27T16:30:00Z'}),/exact configured UTC anchor/);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy(fixedSettings(false).scheduler);await assert.rejects(f.publisher.approve(row.id,row.version,true),/Scheduler policy changed/);
 const revised=await f.publisher.revise(row.id,row.version,f.input);assert.notEqual(revised.version,row.version);assert.equal(revised.status,'staged');await f.publisher.approve(revised.id,revised.version,true);
 assert.equal((await f.publisher.dispatch(new Date(POST))).status,'published');assert.deepEqual(f.counts(),{calls:1,credentials:1});
}));

test('removing policy and adopting fixed mode both require fresh approval; generic hashes and manual plans remain compatible',()=>fixture(async f=>{
 const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);delete f.runtime.scheduler_window_policy;
 await assert.rejects(f.publisher.approve(row.id,row.version,true),/Scheduler policy changed/);assert.equal((await f.publisher.dispatch(new Date(POST))).status,'blocked');assert.equal(f.counts().calls,0);
 const generic=await f.publisher.revise(row.id,row.version,f.input);await f.publisher.approve(generic.id,generic.version,true);assert.equal(generic.scheduler_policy_hash,null);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy({});const same=await f.publisher.revise(generic.id,generic.version,f.input);assert.equal(same.version,generic.version);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy(fixedSettings().scheduler);await assert.rejects(f.publisher.approve(generic.id,generic.version,true),/Scheduler policy changed/);
 const manual=await f.publisher.enqueue({...f.input,request_id:randomUUID(),delivery_mode:'manual',scheduled_at:'2026-10-27T12:15:00Z'});assert.equal(manual.scheduler_policy_hash,null);await f.publisher.approve(manual.id,manual.version,true);
 f.runtime.scheduler_window_policy=schedulerWindowPolicy({window_policy:null});await f.publisher.approve(manual.id,manual.version,true);f.setNow('2026-10-27T12:15:00Z');assert.equal((await f.publisher.publishNow(manual.id,manual.version,f.input.account_id,true)).status,'published');
}));

test('all stale unattempted backlog is retired before the current anchor can publish; manual and terminal rows are untouched',()=>fixture(async f=>{
 for(let weeks=1;weeks<=12;weeks++){const at=new Date(Date.parse(POST)-weeks*7*86400000).toISOString(),row=await f.publisher.enqueue({...f.input,request_id:randomUUID(),scheduled_at:at});await f.publisher.approve(row.id,row.version,true);}
 const manual=await f.publisher.enqueue({...f.input,request_id:randomUUID(),delivery_mode:'manual',scheduled_at:'2026-10-20T12:15:00Z'});await f.publisher.approve(manual.id,manual.version,true);
 const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);assert.equal((await f.publisher.dispatch(new Date(POST))).status,'published');
 assert.equal((await f.db.query("SELECT * FROM publishing_outbox WHERE status='missed'")).length,12);assert.equal((await f.db.query('SELECT status FROM publishing_outbox WHERE id=$1',[manual.id]))[0].status,'approved');assert.equal(f.counts().calls,1);
}));

test('no early, intake, off-window, unapproved, duplicate or over-five-minute-late provider calls',async t=>{
 await t.test('unapproved and duplicate',()=>fixture(async f=>{const row=await f.publisher.enqueue(f.input);assert.equal((await f.publisher.dispatch(new Date(POST))).status,'idle');await f.publisher.approve(row.id,row.version,true);const both=await Promise.all([f.publisher.dispatch(new Date(POST)),f.publisher.dispatch(new Date(POST))]);assert.equal(both.filter(result=>result.status==='published').length,1);assert.equal(f.counts().calls,1);}));
 for(const at of ['2026-10-26T17:30:00Z','2026-10-26T17:45:00Z','2026-10-26T17:56:00Z','2026-10-26T18:05:00.001Z','2026-10-26T18:06:00Z','2026-10-26T18:06:00.001Z'])await t.test(at,()=>fixture(async f=>{const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);f.runtime.max_lateness_seconds=3600;f.setNow(at);await f.publisher.dispatch(new Date(at));assert.equal(f.counts().calls,0);assert.equal(f.counts().credentials,0);}));
 await t.test('exact five-minute boundary allowed',()=>fixture(async f=>{const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);f.setNow('2026-10-26T18:05:00Z');assert.equal((await f.publisher.dispatch(new Date('2026-10-26T18:05:00Z'))).status,'published');}));
});

test('failed, uncertain, claimed and published deliveries never auto-replay',async t=>{
 for(const status of ['failed','uncertain','claimed','published'])await t.test(status,()=>fixture(async f=>{const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);await f.db.query('UPDATE publishing_outbox SET status=$2 WHERE id=$1',[row.id,status]);await f.publisher.dispatch(new Date(POST));assert.equal(f.counts().calls,0);await assert.rejects(f.publisher.revise(row.id,row.version,f.input),/terminal/);await assert.rejects(f.publisher.enqueue({...f.input,request_id:randomUUID(),scheduled_at:'2026-10-28T14:00:00Z'}),/reconciliation|replay/);}));
});

test('late clock or policy change during credential retrieval is revalidated before provider I/O',async t=>{
 for(const kind of ['clock','policy','source'])await t.test(kind,()=>fixture(async f=>{const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);f.runtime.credential=async()=>{if(kind==='clock')f.setNow('2026-10-26T18:05:00.001Z');if(kind==='policy')f.runtime.scheduler_window_policy=schedulerWindowPolicy(fixedSettings(false).scheduler);if(kind==='source')await f.db.query('UPDATE sources SET cleared=false WHERE id=$1',[f.source.id]);return 'offline-test-only';};assert.notEqual((await f.publisher.dispatch(new Date(POST))).status,'published');assert.equal(f.counts().calls,0);assert.equal((await f.db.query('SELECT * FROM publishing_attempts')).length,0);}));
});


test('fixed scheduled mode rejects non-LinkedIn and cancelled prior attempt history cannot authorize replay',()=>fixture(async f=>{
 await assert.rejects(f.publisher.enqueue({...f.input,platform:'X'}),/LinkedIn-only/);
 await assert.rejects(f.publisher.enqueue({...f.input,platform:'Instagram'}),/LinkedIn-only/);
 const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);f.runtime.fetch=async()=>new Response(null,{status:403});assert.equal((await f.publisher.dispatch(new Date(POST))).status,'failed');
 await assert.rejects(f.publisher.cancel(row.id,row.version),/reconciliation/);
 // Emulate a pre-existing cancellation under the generic/legacy behavior. Attempt evidence remains authoritative.
 await f.db.query("UPDATE publishing_outbox SET status='cancelled' WHERE id=$1",[row.id]);
 await assert.rejects(f.publisher.enqueue({...f.input,request_id:randomUUID(),scheduled_at:'2026-10-28T14:00:00Z'}),/reconciliation|replay/);
}));


test('clock crossing deadline after admission transaction still prevents the actual provider call',()=>fixture(async f=>{
 const row=await f.publisher.enqueue(f.input);await f.publisher.approve(row.id,row.version,true);f.setNow('2026-10-26T18:04:59.999Z');
 const slow:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const result=await tx.query<T>(sql,params);if(sql.startsWith('INSERT INTO publishing_attempts')){await new Promise(resolve=>setTimeout(resolve,1));f.setNow('2026-10-26T18:05:01Z');}return result;}}))};
 assert.equal((await new Publishing(slow,f.runtime).dispatch(new Date(POST))).status,'failed');assert.equal(f.counts().calls,0);
 assert.equal((await f.db.query('SELECT state FROM publishing_attempts'))[0].state,'rejected');
}));
