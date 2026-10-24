import {Calendar} from "../lib/calendar";
import {runHostedBatch} from "../lib/hosted-batch";
import {HOSTED_BATCH_SCHEMA} from "../lib/hosted-schema";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {type RuntimeConfig,type Task} from "../lib/domain";
import {step} from "../lib/workflow";
import {queueAgentRevision} from "../lib/agent-revisions";
import {SCOPED_REVISION_REQUEST,HOSTED_CANDIDATE_LIMIT,HostedCalendarScanExhausted} from "../lib/hosted-calendar-policy";
import {SourceIntake} from "../lib/sources";
import {scopedFixture,parentBundle} from "./hosted-calendar-fixture";
const pricing={model:"gpt-test",pricing_version:"isolated",pricing_tier:"standard" as const,official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.125",output_microdollars_per_token:"0.750"};
const config=():RuntimeConfig=>({owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:pricing});
async function fixture(work:(db:Database,store:Store,c:RuntimeConfig,prepared:Awaited<ReturnType<typeof scopedFixture>>)=>Promise<void>){const db=await embedded();try{const c=config();await work(db,new Store(db),c,await scopedFixture(db,c));}finally{await db.close();}}
async function manual(db:Database,store:Store){const intake=new SourceIntake(db),s=await intake.stage({text:"I built a separate manual outline and checked the exact supported facts.",category:"project-note",reported_date:new Date().toISOString().slice(0,10)});await intake.clear(s.id,s.hash,true);return store.enqueue(s.id);}
const row=(db:Database,id:string)=>db.query<Task>("SELECT * FROM tasks WHERE id=$1",[id]).then(rows=>rows[0]);
const mock=async()=>({text:"Proposed approach: inspect one exact source.",input:10,output:10,outcome:"complete" as const,report:{serviceTier:"default",model:pricing.model,requestId:"isolated-test",finishReason:"stop"}});

test("hosted policy excludes unrelated queued and expired manual rows before recovery and claim",()=>fixture(async(db,store,c,{task})=>{
 const queued=await manual(db,store),expired=(await db.query<Task>("INSERT INTO tasks(id,source_id,source_hash,status,origin_key,lease_token,lease_until) VALUES($1,$2,$3,'running','manual-expired',$4,now()-interval '1 hour') RETURNING *",[randomUUID(),queued.source_id,queued.source_hash,randomUUID()]))[0];
 const before=await db.query("SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id",[[queued.id,expired.id]]),events=await db.query("SELECT * FROM events WHERE task_id=ANY($1::uuid[]) ORDER BY id",[[queued.id,expired.id]]);
 assert.equal((await store.claim(undefined,{config:c}))?.id,task.id);
 assert.deepEqual(await db.query("SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id",[[queued.id,expired.id]]),before);assert.deepEqual(await db.query("SELECT * FROM events WHERE task_id=ANY($1::uuid[]) ORDER BY id",[[queued.id,expired.id]]),events);
 // Unscoped local behavior still claims the manual queue normally.
 assert.equal((await store.claim())?.id,queued.id);
}));

test("genuine scoped initial and receipted owner revision execute mocked checkpoints",()=>fixture(async(db,store,c,{task})=>{
 assert.equal((await step(store,c,mock,true,{hostedScopedCalendar:true,ownerClearedOnly:true,minimumGenerationLeadHours:120})).status,"step_saved");
 await db.query("DELETE FROM outputs WHERE task_id=$1",[task.id]);const token=await parentBundle(db,task);
 const child=await queueAgentRevision(store,c,task.id,token,"  Shorten the supported proposal.  ");assert.equal(child.revision_note,"Shorten the supported proposal.");
 assert.equal((await db.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[child.id,SCOPED_REVISION_REQUEST])).length,1);
 assert.equal((await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal.")).id,child.id);
 for(let n=0;n<6;n++)assert.equal((await step(store,c,mock,true,{hostedScopedCalendar:true,ownerClearedOnly:true,minimumGenerationLeadHours:120})).status,"step_saved");
 assert.equal((await row(db,child.id)).status,"review");assert.equal((await db.query("SELECT id FROM content_revisions WHERE agent_task_id=$1",[child.id])).length,1);assert.equal((await db.query("SELECT * FROM approvals")).length,0);
}));

test("revision receipt is exact, unique, unbackfilled and rejects feedback, base, ancestry and binding tampering",()=>fixture(async(db,store,c,{task})=>{
 const token=await parentBundle(db,task),child=await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal.");
 const receipt=(await db.query<any>("SELECT * FROM events WHERE task_id=$1 AND kind=$2",[child.id,SCOPED_REVISION_REQUEST]))[0];
 const original=await row(db,child.id);
 for(const change of [{revision_note:"Altered feedback"},{revision_base_token:"original:wrong"},{revision_parent_task_id:child.id},{source_hash:"f".repeat(64)},{content_brief:{...child.content_brief,source_policy:{}}}]){
   for(const [key,value] of Object.entries(change))await db.query("UPDATE tasks SET "+key+"=$2 WHERE id=$1",[child.id,key==="content_brief"?JSON.stringify(value):value]);
   const before=await row(db,child.id);assert.equal(await store.claim(undefined,{config:c}),null);assert.deepEqual(await row(db,child.id),before);
   await db.query("UPDATE tasks SET revision_note=$2,revision_base_token=$3,revision_parent_task_id=$4,source_hash=$5,content_brief=$6 WHERE id=$1",[child.id,original.revision_note,original.revision_base_token,original.revision_parent_task_id,original.source_hash,JSON.stringify(original.content_brief)]);
 }
 for(const key of ["child_id","parent_id","root_id","base_token","feedback_hash","source_id","source_hash","grant_id","policy_id","policy_hash","runtime_binding","entry_id","job_id","brief_hash","version"]){
   const parsed=JSON.parse(receipt.detail);parsed[key]="tampered";await db.query("UPDATE events SET detail=$2 WHERE id=$1",[receipt.id,JSON.stringify(parsed)]);assert.equal(await store.claim(undefined,{config:c}),null,key);
 }
 await db.query("UPDATE events SET detail=$2 WHERE id=$1",[receipt.id,receipt.detail]);
 const duplicate=randomUUID();await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[duplicate,child.id,SCOPED_REVISION_REQUEST,receipt.detail]);assert.equal(await store.claim(undefined,{config:c}),null);await db.query("DELETE FROM events WHERE id=$1",[duplicate]);
 await db.query("DELETE FROM events WHERE id=$1",[receipt.id]);assert.equal((await queueAgentRevision(store,c,task.id,token,child.revision_note!)).id,child.id);assert.equal((await db.query("SELECT * FROM events WHERE task_id=$1 AND kind=$2",[child.id,SCOPED_REVISION_REQUEST])).length,0);assert.equal(await store.claim(undefined,{config:c}),null);
}));

test("changed parent bundle, source proof, runtime, grant, entry and job never mutate queued work",()=>fixture(async(db,store,c,{task,entry})=>{
 const token=await parentBundle(db,task),child=await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal.");
 assert.equal(await store.claim(undefined,{config:{...c,openai:{...pricing,model:"changed"}}}),null);
 const mutations=[
  ["UPDATE calendar_jobs SET source_hash=$2 WHERE entry_id=$1",entry,"f".repeat(64)],
  ["UPDATE calendar_entries SET review_due=review_due+interval '1 second' WHERE id=$1",entry],
  ["UPDATE github_source_grants SET policy_hash=$2 WHERE task_id=$1",task.id,"f".repeat(64)],
  ["UPDATE outputs SET hash=$2 WHERE task_id=$1",task.id,"f".repeat(64)]
 ] as const;
 for(const statement of mutations){
  // Roll back fixture tampering while committing no claim mutation.
  await assert.rejects(db.transaction(async tx=>{await tx.query(statement[0],statement.slice(1));const scopedStore=new Store({...db,query:tx.query,transaction:work=>work(tx)});assert.equal(await scopedStore.claim(undefined,{config:c}),null);throw Error("rollback fixture");}),/rollback fixture/);
 }
 assert.equal((await row(db,child.id)).status,"queued");
}));

test("policy/source revocation and future/expired timing leave excluded tasks byte unchanged",()=>fixture(async(db,store,c,{task,policy,policies,session})=>{
 const original=await row(db,task.id);
 await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");assert.equal(await store.claim(undefined,{config:c}),null);await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
 await policies.revoke(policy.id,policy.scope_hash,session);assert.equal(await store.claim(undefined,{config:c}),null);assert.deepEqual(await row(db,task.id),original);
}));

test("eligible expiry resumes safely, unresolved usage blocks recovery without replay",()=>fixture(async(db,store,c,{task})=>{
 await db.query("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()-interval '1 hour' WHERE id=$1",[task.id,randomUUID()]);assert.equal((await store.claim(undefined,{config:c}))?.id,task.id);
 await db.query("UPDATE tasks SET lease_until=now()-interval '1 hour' WHERE id=$1",[task.id]);
 await db.query("INSERT INTO budget_months(month) VALUES('2020-01') ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status) VALUES($1,$2,'2020-01','openai','gpt-test',$3,100,'unknown')",[randomUUID(),task.id,JSON.stringify(pricing)]);
 assert.equal(await store.claim(undefined,{config:c}),null);assert.equal((await row(db,task.id)).status,"blocked");assert.equal((await db.query<any>("SELECT status FROM ledger"))[0].status,"unknown");
}));


test("future generation and expired review/post remain excluded even with matching frozen timing",()=>fixture(async(db,store,c,{task,entry})=>{
 for(const shift of [1,-100,-121])await assert.rejects(db.transaction(async tx=>{
  const e=(await tx.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[entry]))[0];
  const shifted=(value:Date|string)=>new Date(+new Date(value)+shift*3_600_000).toISOString();
  const post=shifted(e.intended_post),review=shifted(e.review_due),generation=shifted(e.generation_due);
  const schedule={platform_policy:{version:1,platforms:["LinkedIn"]},LinkedIn:{intended_post:post,draft_due:review,review_due:review}};
  await tx.query("UPDATE calendar_entries SET intended_post=$2,draft_due=$3,review_due=$3,generation_due=$4,platform_schedule=$5 WHERE id=$1",[entry,post,review,generation,JSON.stringify(schedule)]);
  await tx.query("UPDATE tasks SET content_brief=$2 WHERE id=$1",[task.id,JSON.stringify({...task.content_brief,intended_post:post,review_due:review,generation_due:generation})]);
  const scopedStore=new Store({...db,query:tx.query,transaction:work=>work(tx)}),before=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0];
  assert.equal(await scopedStore.claim(undefined,{config:c}),null);assert.deepEqual((await tx.query<Task>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0],before);throw Error("rollback fixture");
 }),/rollback fixture/);
}));

test("revoked source and stale parent token never admit revision requests",()=>fixture(async(db,store,c,{task,source})=>{
 const token=await parentBundle(db,task),child=await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal.");
 await store.revise(task.id,token,"Owner changed the reviewed base.");assert.equal(await store.claim(undefined,{config:c}),null);assert.equal((await row(db,child.id)).status,"queued");
 await new SourceIntake(db).revoke(source.id,source.hash);assert.equal(await store.claim(undefined,{config:c}),null);
}));

test("final hosted admission revalidates receipt before provider IO",()=>fixture(async(db,store,c,{task})=>{
 const token=await parentBundle(db,task),child=await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal.");let calls=0;
 const result=await step(store,c,async()=>{calls++;return mock();},true,{hostedScopedCalendar:true,ownerClearedOnly:true,minimumGenerationLeadHours:120,beforeProvider:async()=>{await db.query("DELETE FROM events WHERE task_id=$1 AND kind=$2",[child.id,SCOPED_REVISION_REQUEST]);}});
 assert.equal(result.status,"blocked");assert.equal(calls,0);const ledger=(await db.query<any>("SELECT * FROM ledger"))[0];assert.equal(ledger.status,"settled");assert.equal(Number(ledger.estimated),0);
}));


test("hosted dispatch and daily runner preserve manual/legacy rows while scoped work progresses",()=>fixture(async(db,store,c,{task,entry})=>{
 const manualTask=await manual(db,store),e=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[entry]))[0];
 const manualEntry=randomUUID(),legacyEntry=randomUUID(),boundEntry=randomUUID();
 for(const [id,offset,source,linked,schedule] of [[manualEntry,1,manualTask.source_id,null,e.platform_schedule],[legacyEntry,2,null,null,{}],[boundEntry,3,manualTask.source_id,manualTask.id,e.platform_schedule]] as const){
   await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id,task_id,platform_schedule) VALUES($1,($2::date+$3::integer)::text,'shortform',$4,$5,$5,$6,$7,$8,$9)",[id,e.planned_date,offset,e.intended_post,e.review_due,e.generation_due,source,linked,JSON.stringify(schedule)]);
 }
 const manualJob=randomUUID();await db.query("INSERT INTO calendar_jobs(id,entry_id,status,task_id,source_id,source_hash) VALUES($1,$2,'linked',$3,$4,$5)",[manualJob,boundEntry,manualTask.id,manualTask.source_id,manualTask.source_hash]);
 const excluded=[manualEntry,legacyEntry,boundEntry],before=await db.query("SELECT * FROM calendar_entries WHERE id=ANY($1::uuid[]) ORDER BY id",[excluded]),jobs=await db.query("SELECT * FROM calendar_jobs WHERE entry_id=ANY($1::uuid[]) ORDER BY id",[excluded]),manualBefore=await row(db,manualTask.id);
 await new Calendar(db,120).dispatchDue(c,true,new Date(),{hostedScopedOnly:true});
 assert.deepEqual(await db.query("SELECT * FROM calendar_entries WHERE id=ANY($1::uuid[]) ORDER BY id",[excluded]),before);assert.deepEqual(await db.query("SELECT * FROM calendar_jobs WHERE entry_id=ANY($1::uuid[]) ORDER BY id",[excluded]),jobs);assert.deepEqual(await row(db,manualTask.id),manualBefore);
 for(const statement of HOSTED_BATCH_SCHEMA.split(";").filter(sql=>sql.trim()))await db.query(statement);
 let calls=0;const result=await runHostedBatch(new Store({...db,kind:"postgres"}),c,{isReady:()=>true,provider:async()=>{calls++;return mock();}});
 assert.equal(result.status,"idle");assert.equal(result.steps,6);assert.equal(calls,6);assert.equal((await row(db,task.id)).status,"review");assert.deepEqual(await row(db,manualTask.id),manualBefore);
 assert.deepEqual(await db.query("SELECT * FROM calendar_entries WHERE id=ANY($1::uuid[]) ORDER BY id",[excluded]),before);assert.deepEqual(await db.query("SELECT * FROM calendar_jobs WHERE entry_id=ANY($1::uuid[]) ORDER BY id",[excluded]),jobs);assert.equal((await db.query("SELECT * FROM publishing_outbox")).length,0);
}));

test("hosted automatic selection creates only scoped work and skips stale scoped bindings",()=>fixture(async(db,store,c,{task,entry})=>{
 // Release only this isolated fixture's setup records, then exercise hosted dispatch itself.
 await db.query("DELETE FROM github_source_grants WHERE task_id=$1",[task.id]);await db.query("DELETE FROM calendar_jobs WHERE entry_id=$1",[entry]);await db.query("UPDATE calendar_entries SET task_id=NULL,source_id=NULL WHERE id=$1",[entry]);await db.query("DELETE FROM events WHERE task_id=$1",[task.id]);await db.query("DELETE FROM tasks WHERE id=$1",[task.id]);
 const result=await new Calendar(db,120).dispatchDue(c,true,new Date(),{hostedScopedOnly:true});assert.equal(result.queued,1);
 const fresh=(await db.query<Task>("SELECT * FROM tasks"))[0];assert.equal((await store.claim(undefined,{config:c}))?.id,fresh.id);
 await db.query("UPDATE calendar_jobs SET source_hash=$2 WHERE entry_id=$1",[entry,"f".repeat(64)]);
 const before=await db.query("SELECT * FROM calendar_jobs WHERE entry_id=$1",[entry]);await new Calendar(db,120).dispatchDue(c,true,new Date(),{hostedScopedOnly:true});assert.deepEqual(await db.query("SELECT * FROM calendar_jobs WHERE entry_id=$1",[entry]),before);
}));


test("hosted dispatch rejects revision ancestry without any task row lock after sources",()=>fixture(async(db,store,c,{task,entry})=>{
 const parent=await manual(db,store);await db.query("UPDATE tasks SET revision_parent_task_id=$2 WHERE id=$1",[task.id,parent.id]);
 const statements:string[]=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{statements.push(sql);return tx.query(sql,params);}}))};
 const before=await db.query("SELECT * FROM calendar_jobs WHERE entry_id=$1",[entry]);
 await new Calendar(observed,120).dispatchDue(c,true,new Date(),{hostedScopedOnly:true});
 assert.deepEqual(await db.query("SELECT * FROM calendar_jobs WHERE entry_id=$1",[entry]),before);
 assert(statements.some(sql=>/FROM sources.*FOR UPDATE/.test(sql)));
 assert(!statements.some(sql=>/FROM tasks.*FOR UPDATE/.test(sql)));
 const settings=statements.findIndex(sql=>sql==="SELECT * FROM calendar_settings WHERE id=1 FOR UPDATE"),entries=statements.findIndex(sql=>/FROM calendar_entries.*FOR UPDATE/.test(sql)),jobs=statements.findIndex(sql=>/FROM calendar_jobs.*FOR UPDATE/.test(sql)),sources=statements.findIndex(sql=>/FROM sources.*FOR UPDATE/.test(sql));
 assert(settings<entries&&entries<jobs&&jobs<sources);
}));

test("scoped request and claim take Calendar locks before child/root/source/policy",()=>fixture(async(db,store,c,{task})=>{
 const token=await parentBundle(db,task),statements:Array<{sql:string;params?:unknown[]}>=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{statements.push({sql,params});return tx.query(sql,params);}}))},scopedStore=new Store(observed);
 const child=await queueAgentRevision(scopedStore,c,task.id,token,"Shorten the supported proposal.");
 const requestSettings=statements.findIndex(item=>/FROM calendar_settings.*FOR UPDATE/.test(item.sql)),requestRoot=statements.findIndex(item=>/FROM tasks.*FOR UPDATE/.test(item.sql)&&item.params?.[0]===task.id);assert(requestSettings>=0&&requestSettings<requestRoot);
 statements.length=0;assert.equal((await scopedStore.claim(undefined,{config:c}))?.id,child.id);
 const index=(table:string,id?:string)=>statements.findIndex(item=>item.sql.includes("FROM "+table)&&item.sql.includes("FOR ")&&(!id||item.params?.[0]===id));
 const settings=index("calendar_settings"),entry=index("calendar_entries"),job=index("calendar_jobs"),childLock=index("tasks",child.id),rootLock=index("tasks",task.id),source=index("sources"),policy=index("github_source_policies");
 assert(settings>=0&&settings<entry&&entry<job&&job<childLock&&childLock<rootLock&&rootLock<source&&source<policy);
 assert(!statements.some(item=>/FROM publishing_outbox|FROM budget_months/.test(item.sql)));
}));


test("rejected scoped candidates release all locks before reaching the next valid candidate",()=>fixture(async(db,store,c,{task})=>{
 const invalid=randomUUID();await db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key,revision_parent_task_id,content_brief,updated) VALUES($1,$2,$3,'queued','invalid-scoped-child',$4,$5,now()-interval '1 hour')",[invalid,task.source_id,task.source_hash,task.id,JSON.stringify(task.content_brief)]);
 const before=await row(db,invalid),groups:Array<Array<{sql:string;params?:unknown[]}>>=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>{const statements:Array<{sql:string;params?:unknown[]}>=[];groups.push(statements);return work({query:async(sql,params)=>{statements.push({sql,params});return tx.query(sql,params);}});})};
 assert.equal((await new Store(observed).claim(undefined,{config:c}))?.id,task.id);assert.equal(groups.length,2);
 assert.deepEqual(await row(db,invalid),before);assert.equal((await db.query("SELECT * FROM events WHERE task_id=$1",[invalid])).length,0);
 for(const statements of groups){const source=statements.findIndex(item=>/FROM sources.*FOR UPDATE/.test(item.sql));assert(source>=0);assert(!statements.slice(source+1).some(item=>/FROM tasks.*FOR UPDATE/.test(item.sql)));}
}));

test("nested revision requests reject before any late root/source lock",()=>fixture(async(db,store,c,{task})=>{
 const token=await parentBundle(db,task),child=await queueAgentRevision(store,c,task.id,token,"Shorten the supported proposal."),statements:Array<{sql:string;params?:unknown[]}>=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{statements.push({sql,params});return tx.query(sql,params);}}))};
 await assert.rejects(queueAgentRevision(new Store(observed),c,child.id,token,"Another request."),/not ready|parent content/);
 assert(!statements.some(item=>/FROM sources.*FOR UPDATE/.test(item.sql)));assert(!statements.some(item=>/FROM tasks.*FOR UPDATE/.test(item.sql)&&item.params?.[0]===task.id));
 assert.equal((await db.query("SELECT * FROM events WHERE task_id=$1 AND kind=$2",[child.id,SCOPED_REVISION_REQUEST])).length,1);
}));

test("bounded scan filters many expired/manual/invalid-checkpoint rows before valid scoped work",()=>fixture(async(db,store,c,{task})=>{
 const old=await scopedFixture(db,c,new Date(),2);
 await db.query("UPDATE calendar_entries SET intended_post=now()-interval '1 day',review_due=now()-interval '3 days',draft_due=now()-interval '3 days' WHERE id=$1",[old.entry]);
 const own=await manual(db,store);
 for(let n=0;n<HOSTED_CANDIDATE_LIMIT*3;n++){
   for(const [root,checkpoint] of [[old.task,0],[task,6],[own,0]] as const)await db.query("INSERT INTO tasks(id,source_id,source_hash,status,checkpoint,origin_key,revision_parent_task_id,content_brief,updated) VALUES($1,$2,$3,'queued',$4,$5,$6,$7,now()-interval '1 hour')",[randomUUID(),root.source_id,root.source_hash,checkpoint,'historical:'+n+':'+root.id,root.id,JSON.stringify(root.content_brief||{})]);
 }
 const before=await db.query("SELECT * FROM tasks WHERE id!=$1 ORDER BY id",[task.id]);
 assert.equal((await store.claim(undefined,{config:c}))?.id,task.id);assert.deepEqual(await db.query("SELECT * FROM tasks WHERE id!=$1 ORDER BY id",[task.id]),before);
}));

test("eligible scan exhaustion is explicitly blocked without mutating excluded work or calling a provider",()=>fixture(async(db,store,c,{task})=>{
 for(let n=0;n<HOSTED_CANDIDATE_LIMIT+1;n++)await db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key,revision_parent_task_id,content_brief,updated) VALUES($1,$2,$3,'queued',$4,$5,$6,now()-interval '1 hour')",[randomUUID(),task.source_id,task.source_hash,'unreceipted:'+n,task.id,JSON.stringify(task.content_brief)]);
 const before=await db.query("SELECT * FROM tasks ORDER BY id"),events=await db.query("SELECT * FROM events ORDER BY id");
 await assert.rejects(store.claim(undefined,{config:c}),HostedCalendarScanExhausted);
 assert.deepEqual(await db.query("SELECT * FROM tasks ORDER BY id"),before);assert.deepEqual(await db.query("SELECT * FROM events ORDER BY id"),events);
 for(const statement of HOSTED_BATCH_SCHEMA.split(";").filter(sql=>sql.trim()))await db.query(statement);
 let calls=0;const result=await runHostedBatch(new Store({...db,kind:"postgres"}),c,{isReady:()=>true,provider:async()=>{calls++;return mock();}});
 assert.equal(result.status,"blocked");assert.equal(result.reason,"scoped_scan_exhausted");assert.equal(result.steps,0);assert.equal(calls,0);assert.deepEqual(await db.query("SELECT * FROM tasks ORDER BY id"),before);
}));


test("expired uncertain scoped recovery commits before the next candidate transaction",()=>fixture(async(db,store,c,{task})=>{
 const next=await scopedFixture(db,c,new Date(),2);
 await db.query("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()-interval '1 hour',updated=now()-interval '1 day' WHERE id=$1",[task.id,randomUUID()]);
 await db.query("INSERT INTO budget_months(month) VALUES('2020-01') ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status) VALUES($1,$2,'2020-01','openai','gpt-test',$3,100,'unknown')",[randomUUID(),task.id,JSON.stringify(pricing)]);
 const groups:string[][]=[],observed:Database={...db,transaction:work=>db.transaction(tx=>{const statements:string[]=[];groups.push(statements);return work({query:async(sql,params)=>{statements.push(sql);return tx.query(sql,params);}});})};
 assert.equal((await new Store(observed).claim(undefined,{config:c}))?.id,next.task.id);assert.equal(groups.length,2);assert.equal((await row(db,task.id)).status,"blocked");assert.equal((await db.query<any>("SELECT status FROM ledger"))[0].status,"unknown");
 assert.equal((await db.query("SELECT id FROM events WHERE task_id=$1 AND kind='lease_expired'",[task.id])).length,1);
 for(const statements of groups){const source=statements.findIndex(sql=>/FROM sources.*FOR UPDATE/.test(sql));assert(source>=0);assert(!statements.slice(source+1).some(sql=>/FROM tasks.*FOR UPDATE/.test(sql)));}
}));
