import {providerResponseFormatBytes,type ProviderArtifactContract} from '../lib/critic-response-format';
import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {CAP,BUFFER,hash,istMonth,tokenCost,type RuntimeConfig,type Task} from "../lib/domain";
import {Store} from "../lib/store";
import {queueAgentRevision} from "../lib/agent-revisions";
import {scopedFixture,parentBundle} from "./hosted-calendar-fixture";
import {runOwnerCalendar,ownerCalendarSnapshot,validOwnerCalendarRequest,type OwnerCalendarRequest} from "../lib/owner-calendar";
import {OWNER_CALENDAR_STARTED,OWNER_CALENDAR_FINISHED,OWNER_CALENDAR_MAX_RESERVED,OWNER_CALENDAR_BUDGET_MS} from "../lib/owner-calendar-policy";
import {ProviderFailure,AccountingFailure,TerminationFailure,type Completion,type providerCall} from "../lib/providers";
import {SourceIntake} from "../lib/sources";
import {runOwnerDraft} from "../lib/owner-draft";

let db:Database,store:Store;
before(async()=>{db={...await embedded(),kind:"postgres"};store=new Store(db);});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries,hosted_batches CASCADE");await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");});
function config():RuntimeConfig{return {owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"gpt-test",pricing_version:"isolated",pricing_tier:"standard",official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.001",output_microdollars_per_token:"0.001"}};}
async function fixture(revision=false){const c=config(),parent=await scopedFixture(db,c);const token=revision?await parentBundle(db,parent.task):null;const task=revision?await queueAgentRevision(store,c,parent.task.id,token!,"Keep only exact supported attribution."):parent.task;const preview=(await ownerCalendarSnapshot(db,c,true)).previews.find(p=>p.task_id===task.id)!;assert.ok(preview);return {...parent,c,task,parent:parent.task,token,preview,input:{task_id:task.id,expected_preview:preview.version,acknowledged:true} as OwnerCalendarRequest};}
const completion=(text="Proposed approach: inspect one exact source."):Completion=>({text,input:1,output:1,outcome:"complete",report:{serviceTier:"default",model:"gpt-test",requestId:"local-fake",finishReason:"stop"}});
const row=async(id:string)=>(await db.query<Task>("SELECT * FROM tasks WHERE id=$1",[id]))[0];
const rows=(table:string,id:string)=>db.query<any>(`SELECT * FROM ${table} WHERE task_id=$1`,[id]);
function runner(c:RuntimeConfig,provider:typeof providerCall,extra:Partial<Parameters<typeof runOwnerCalendar>[2]>={}){return {readConfig:()=>c,isReady:()=>true,provider,...extra};}
async function otherLedger(taskId:string,status="unknown",estimated=1){const id=randomUUID();await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[istMonth()]);await db.query("INSERT INTO ledger(id,month,provider,model,pricing,reserved,estimated,status,task_id) VALUES($1,$2,'openai','gpt-test','{}',$3,$3,$4,$5)",[id,istMonth(),estimated,status,taskId]);return id;}

test("initial one-shot completes only the previewed task, leaves the daily claim and unrelated queue unchanged, never approves",async()=>{
 const f=await fixture();const other=await scopedFixture(db,f.c,new Date(),2),daily={day:new Date().toISOString().slice(0,10),status:"idle"};
 await db.query("INSERT INTO hosted_batches(day,status,attempts,steps,reason,lease_token,started_at,heartbeat,finished_at) VALUES($1,$2,6,6,'daily_already_attempted',$3,now(),now(),now())",[daily.day,daily.status,randomUUID()]);
 const before=await db.query("SELECT * FROM hosted_batches"),unrelated=await row(other.task.id);let calls=0;const requests:Array<{prompt:string;contract?:ProviderArtifactContract}>=[];
 const result=await runOwnerCalendar(db,f.input,runner(f.c,async(provider,prompt,_pricing,_transport,_credential,contract)=>{requests.push({prompt,contract});calls++;assert.equal(provider,"openai");assert.ok(prompt.includes(f.source.text));assert.ok(!prompt.includes(other.source.text));return completion();}));
 assert.deepEqual(requests.map(request=>request.contract),[undefined,undefined,undefined,undefined,undefined,{artifact:"critic"}]);
 assert.equal(result.status,"review");assert.equal(result.steps,6);assert.equal(calls,6);assert.equal((await row(f.task.id)).status,"review");assert.equal((await row(f.task.id)).checkpoint,6);
 assert.deepEqual(await row(other.task.id),unrelated);assert.deepEqual(await db.query("SELECT * FROM hosted_batches"),before);
 assert.equal((await rows("outputs",f.task.id)).length,6);const ledger=await rows("ledger",f.task.id);assert.equal(ledger.length,6);assert(ledger.every(x=>x.status==="settled"));for(const item of ledger)assert.equal(Number(item.reserved),tokenCost(f.c.openai!,Buffer.byteLength(requests[item.checkpoint].prompt)+providerResponseFormatBytes("openai",requests[item.checkpoint].contract)+256,1200));assert(ledger.reduce((n,x)=>n+Number(x.reserved),0)<=OWNER_CALENDAR_MAX_RESERVED);
 for(const table of ["approvals","revision_approvals","publishing_outbox","content_revisions"])assert.equal((await db.query("SELECT * FROM "+table)).length,0);
 assert.equal((await ownerCalendarSnapshot(db,f.c,true)).runs[0].status,"review");
});

test("revision publishes one new parent version only in the successful terminal transaction, with fresh approval",async()=>{
 const f=await fixture(true);let calls=0;
 const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;assert.equal((await db.query("SELECT * FROM content_revisions")).length,0);return completion();}));
 assert.equal(result.status,"review");assert.equal(calls,6);const revisions=await rows("content_revisions",f.parent.id);assert.equal(revisions.length,1);assert.equal(revisions[0].agent_task_id,f.task.id);assert.equal(revisions[0].base_token,f.token);
 assert.equal((await rows("outputs",f.parent.id)).length,6);assert.equal((await rows("outputs",f.task.id)).length,6);
 for(const table of ["approvals","revision_approvals","publishing_outbox"])assert.equal((await db.query("SELECT * FROM "+table)).length,0);
});

test("strict request schema has no source/mode override and rejects malformed or additional values",()=>{
 const b={task_id:randomUUID(),expected_preview:hash("preview"),acknowledged:true};assert.equal(validOwnerCalendarRequest(b),true);
 for(const value of [null,[],{}, {...b,acknowledged:false},{...b,expected_preview:"bad"},{...b,task_id:[]},{...b,mode:"initial"},{...b,source_id:randomUUID()}])assert.equal(validOwnerCalendarRequest(value),false);
 for(const key of Object.keys(b)){const missing={...b} as Record<string,unknown>;delete missing[key];assert.equal(validOwnerCalendarRequest(missing),false);}
});

test("preview changes, wrong task kinds and already started checkpoints fail without a durable start or provider",async()=>{
 const f=await fixture(true);let calls=0;const run=(input=f.input)=>runOwnerCalendar(db,input,runner(f.c,async()=>{calls++;return completion();}));
 assert.equal((await run({...f.input,expected_preview:hash("wrong")})).status,"blocked");
 for(const [sql,params] of [["UPDATE tasks SET updated=updated+interval '1 second' WHERE id=$1",[f.task.id]],["UPDATE tasks SET revision_note='Changed feedback' WHERE id=$1",[f.task.id]]] as Array<[string,unknown[]]>){await db.query(sql,params);assert.equal((await run()).status,"blocked");}
 assert.equal(calls,0);assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[OWNER_CALENDAR_STARTED])).length,0);
 const intake=new SourceIntake(db),source=await intake.stage({text:"I inspected a permitted local workflow.",category:"build-log",reported_date:new Date().toISOString().slice(0,10)});await intake.clear(source.id,source.hash,true);const manual=await store.enqueue(source.id);
 assert.equal((await run({...f.input,task_id:manual.id})).status,"blocked");
 assert.equal((await runOwnerDraft(db,{task_id:f.task.id} as never,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked");assert.equal(calls,0);
});

test("concurrent and repeated owner clicks plus daily/generic worker claims cannot duplicate selected work",async()=>{
 const f=await fixture(true);let calls=0,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const fake:typeof providerCall=async()=>{if(++calls===1){entered();await gate;}return completion();};
 const first=runOwnerCalendar(db,f.input,runner(f.c,fake));await started;
 assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,fake))).status,"duplicate");assert.equal(await store.claim(undefined,{config:f.c}),null);assert.equal(await store.claim(),null);assert.equal(calls,1);
 release();assert.equal((await first).status,"review");assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,fake))).status,"duplicate");assert.equal(calls,6);
 assert.equal((await db.query("SELECT * FROM events WHERE task_id=$1 AND kind=$2",[f.task.id,OWNER_CALENDAR_STARTED])).length,1);
});

test("daily worker winning the lease makes the one-shot decline without stealing or marking the task",async()=>{
 const f=await fixture();const claimed=await store.claim(undefined,{config:f.c});assert.equal(claimed?.id,f.task.id);let calls=0;
 assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked");assert.equal(calls,0);assert.deepEqual(await row(f.task.id),claimed);
 assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[OWNER_CALENDAR_STARTED])).length,0);
});

test("future generation, elapsed review, altered entry and source grant fail before transport",async()=>{
 const f=await fixture();let calls=0;
 const changes=["generation_due=now()+interval '1 hour'","review_due=now()-interval '1 minute',draft_due=now()-interval '1 minute'","intended_post=intended_post+interval '1 minute'"];
 const entry=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[f.entry]))[0];
 for(const patch of changes){await db.query("UPDATE calendar_entries SET "+patch+" WHERE id=$1",[f.entry]);assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked");await db.query("UPDATE calendar_entries SET generation_due=$2,review_due=$3,draft_due=$3,intended_post=$4 WHERE id=$1",[f.entry,entry.generation_due,entry.review_due,entry.intended_post]);}
 await db.query("UPDATE github_source_grants SET source_hash=$2 WHERE task_id=$1",[f.task.id,hash("wrong")]);assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked");assert.equal(calls,0);
});

test("global unknown accounting and cap gate prevent the durable attempt; aggregate reservation ceiling prevents spend",async()=>{
 const f=await fixture();let calls=0;const run=()=>runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}));
 const other=(await scopedFixture(db,f.c,new Date(),2)).task;const unknown=await otherLedger(other.id);assert.equal((await run()).status,"blocked");await db.query("DELETE FROM ledger WHERE id=$1",[unknown]);
 const cap=await otherLedger(other.id,"settled",CAP-BUFFER);assert.equal((await run()).status,"blocked");await db.query("DELETE FROM ledger WHERE id=$1",[cap]);
 f.c.openai!.input_microdollars_per_token="100";const preview=(await ownerCalendarSnapshot(db,f.c,true)).previews[0];assert.ok(preview);f.input.expected_preview=preview.version;
 assert.equal((await run()).status,"blocked");assert.equal(calls,0);assert.equal((await rows("ledger",f.task.id)).length,0);
});

test("parent edit, policy revocation, generation disable and runtime change after one settled call stop all later calls",async()=>{
 for(const change of ["parent","policy","generation","runtime"]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture(true);let calls=0;
  const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;
   if(change==="parent")await store.revise(f.parent.id,f.token!,"Owner edits while generation is in flight.");
   if(change==="policy")await db.query("UPDATE github_source_policies SET active=false,revoked_at=now()");
   if(change==="generation")await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");
   if(change==="runtime")f.c.openai!.model="changed";
   return completion();
  }));
  assert.equal(result.status,"blocked",change);assert.equal(calls,1,change);assert.equal((await rows("ledger",f.task.id))[0].status,"settled");assert.equal((await db.query("SELECT * FROM content_revisions WHERE agent_task_id=$1",[f.task.id])).length,0);
 }
});

test("last response cannot publish a parent revision or reviewable initial task after final source/Calendar invalidation",async()=>{
 for(const revision of [false,true]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture(revision);let calls=0;
  const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{if(++calls===6)await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");return completion();}));
  assert.equal(result.status,"blocked");assert.equal(calls,6);assert.equal((await row(f.task.id)).status,"blocked");assert.equal((await rows("outputs",f.task.id)).length,6);assert((await rows("ledger",f.task.id)).every(x=>x.status==="settled"));assert.equal((await db.query("SELECT * FROM content_revisions WHERE agent_task_id=$1",[f.task.id])).length,0);
 }
});

test("known rejection, unknown billing and safety termination retain accounting and prohibit retry/recovery",async()=>{
 for(const error of [new ProviderFailure(429),new ProviderFailure(503),Error("private transport detail"),new AccountingFailure({...completion().report,serviceTier:"priority"}),new TerminationFailure("incomplete",completion().report)]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture();let calls=0;const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;throw error;}));
  assert.equal(calls,1);assert.equal(result.status,error instanceof ProviderFailure&&error.status===429?"blocked":"uncertain");
  await assert.rejects(store.retry(f.task.id),/cannot be replayed/);assert.equal(await store.claim(),null);assert.equal(await store.claim(undefined,{config:f.c}),null);assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"duplicate");assert.equal(calls,1);assert(!JSON.stringify(await rows("events",f.task.id)).includes("private transport detail"));
 }
});

test("deadline and late provider timeout never resume or settle a late result",async()=>{
 const f=await fixture();let calls=0,complete!:(c:Completion)=>void;const pending=new Promise<Completion>(r=>complete=r);
 const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return pending;},{providerTimeoutMs:5}));assert.equal(result.status,"uncertain");complete(completion());await new Promise(r=>setTimeout(r,25));
 assert.equal((await rows("outputs",f.task.id)).length,0);assert.equal((await rows("ledger",f.task.id))[0].status,"unknown");assert.equal(calls,1);
});

test("cancellation and elapsed deadline after a paid checkpoint retain usage but never advance another call",async()=>{
 const f=await fixture(true);let calls=0,elapsed=0;
 const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;elapsed=OWNER_CALENDAR_BUDGET_MS;await store.cancel(f.task.id);return completion();},{elapsed:()=>elapsed}));
 assert.equal(result.status,"blocked");assert.equal(calls,1);assert.equal((await row(f.task.id)).status,"cancelled");assert.equal((await rows("ledger",f.task.id))[0].status,"settled");assert.equal((await db.query("SELECT * FROM content_revisions")).length,0);
});

test("final review state and terminal receipt commit in one transaction with Calendar-first locks",async()=>{
 const f=await fixture(true);const groups:string[][]=[];
 const observed:Database={...db,transaction:work=>db.transaction(tx=>{const statements:string[]=[];groups.push(statements);return work({query:async<T>(sql:string,params?:unknown[])=>{statements.push(sql);return tx.query<T>(sql,params);}});})};
 assert.equal((await runOwnerCalendar(observed,f.input,runner(f.c,async()=>completion()))).status,"review");
 const final=groups.find(g=>g.includes("UPDATE tasks SET status='review',updated=now() WHERE id=$1"))!;assert.ok(final);assert(final.some(s=>s.startsWith("INSERT INTO content_revisions")));assert(final.some(s=>s.startsWith("INSERT INTO events")));
 const firstLock=final.find(s=>s.includes("FOR UPDATE"));assert.match(firstLock!,/calendar_settings/);
 assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[OWNER_CALENDAR_FINISHED])).length,1);
});

test("post-reservation Calendar/source/accounting changes fail before provider admission",async()=>{
 for(const change of ["entry","policy","runtime","accounting"]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture(true),other=(await scopedFixture(db,f.c,new Date(),2)).task;let injected=false,calls=0;
  const guarded:Database={...db,transaction:async work=>{let reserved=false;const value=await db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const rows=await tx.query<T>(sql,params);if(sql.startsWith("INSERT INTO ledger"))reserved=true;return rows;}}));
   if(reserved&&!injected){injected=true;if(change==="entry")await db.query("UPDATE calendar_entries SET intended_post=intended_post+interval '1 minute' WHERE id=$1",[f.entry]);if(change==="policy")await db.query("UPDATE github_source_policies SET active=false,revoked_at=now()");if(change==="runtime")f.c.openai!.model="changed";if(change==="accounting")await otherLedger(other.id);}
   return value;
  }};
  const result=await runOwnerCalendar(guarded,f.input,runner(f.c,async()=>{calls++;return completion();}));assert(injected);assert.equal(calls,0,change);assert.equal(result.status,"uncertain",change);assert.equal((await rows("ledger",f.task.id))[0].status,"unknown");assert.equal((await db.query("SELECT * FROM content_revisions")).length,0);
 }
});

test("process loss after durable claim leaves an uncertain nonreplayable run even with an expired lease",async()=>{
 const f=await fixture();await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[randomUUID(),f.task.id,OWNER_CALENDAR_STARTED,JSON.stringify({deadline:new Date(Date.now()-1).toISOString()})]);
 await db.query("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()-interval '1 minute' WHERE id=$1",[f.task.id,randomUUID()]);const before=await row(f.task.id);
 assert.equal(await store.claim(),null);assert.equal(await store.claim(undefined,{config:f.c}),null);assert.deepEqual(await row(f.task.id),before);
 assert.equal((await ownerCalendarSnapshot(db,f.c,true)).runs[0].status,"uncertain");assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>assert.fail("No replay")))).status,"duplicate");
 await db.query("UPDATE tasks SET status='blocked',lease_token=NULL,lease_until=NULL WHERE id=$1",[f.task.id]);await assert.rejects(store.retry(f.task.id),/cannot be replayed/);
});

test("stale generic selectors recheck a newly visible Calendar claim before writes or expired-lease recovery",async()=>{
 for(const expired of [false,true]){
  const task:Task={id:randomUUID(),source_id:randomUUID(),source_hash:hash("fixture"),status:expired?"running":"queued",checkpoint:0,lease_token:expired?randomUUID():null,lease_until:expired?new Date(Date.now()-1000).toISOString():null,updated:new Date().toISOString()};
  const statements:string[]=[];
  const query:Database["query"]=async<T>(sql:string,params?:unknown[])=>{statements.push(sql);if(sql.startsWith("SELECT * FROM tasks WHERE status='running'"))return (expired?[task]:[]) as T[];if(sql.startsWith("SELECT * FROM tasks WHERE status='queued'"))return (expired?[]:[task]) as T[];if(sql==="SELECT id FROM events WHERE task_id=$1 AND kind=$2")return (params?.[1]===OWNER_CALENDAR_STARTED?[{id:randomUUID()}]:[]) as T[];throw Error("Unexpected write "+sql);};
  const fake:Database={kind:"postgres",query,transaction:work=>work({query}),close:async()=>{}};assert.equal(await new Store(fake).claim(),null);assert(!statements.some(s=>/^(UPDATE|INSERT)/.test(s)));
 }
});

test("a stale daily candidate snapshot cannot claim a subsequently owner-marked task",async()=>{
 const f=await fixture();let injected=false;
 const observed:Database={...db,query:async<T>(sql:string,params?:unknown[])=>{const rows=await db.query<T>(sql,params);if(sql.startsWith("SELECT t.id FROM tasks t")&&!injected){injected=true;await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,'{}')",[randomUUID(),f.task.id,OWNER_CALENDAR_STARTED]);}return rows;}};
 const before=await row(f.task.id);assert.equal(await new Store(observed).claim(undefined,{config:f.c}),null);assert(injected);assert.deepEqual(await row(f.task.id),before);assert.equal((await rows("ledger",f.task.id)).length,0);
});

test("lost final commit acknowledgement is reconciled by the durable finish receipt, never by blocking or replaying the saved revision",async()=>{
 const f=await fixture(true);let injected=false,calls=0;
 const observed:Database={...db,transaction:async work=>{let final=false;const result=await db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const rows=await tx.query<T>(sql,params);if(sql==="UPDATE tasks SET status='review',updated=now() WHERE id=$1")final=true;return rows;}}));if(final&&!injected){injected=true;throw Error("Simulated lost COMMIT acknowledgement");}return result;}};
 const result=await runOwnerCalendar(observed,f.input,runner(f.c,async()=>{calls++;return completion();}));assert(injected);assert.equal(result.status,"review");assert.equal(result.steps,6);assert.equal(calls,6);assert.equal((await row(f.task.id)).status,"review");assert.equal((await db.query("SELECT * FROM content_revisions WHERE agent_task_id=$1",[f.task.id])).length,1);
 assert.equal((await db.query("SELECT * FROM events WHERE task_id=$1 AND kind=$2",[f.task.id,OWNER_CALENDAR_FINISHED])).length,1);
});

test("each task/runtime preview edit independently invalidates the exact acknowledged preview",async()=>{
 const f=await fixture(true),original=await row(f.task.id);let calls=0;
 for(const patch of [
  {revision_note:"Different feedback"},{revision_base_token:"original:"+hash("different")},{revision_parent_task_id:f.task.id},{origin_key:"manual"},{checkpoint:1},{status:"blocked"},{source_hash:hash("different source")},{content_brief:{...original.content_brief,kind:"longform"}}
 ]){
  for(const [key,value] of Object.entries(patch))await db.query("UPDATE tasks SET "+key+"=$2 WHERE id=$1",[f.task.id,key==="content_brief"?JSON.stringify(value):value]);
  assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked",JSON.stringify(patch));
  for(const key of Object.keys(patch)){const value=(original as any)[key];await db.query("UPDATE tasks SET "+key+"=$2 WHERE id=$1",[f.task.id,key==="content_brief"?JSON.stringify(value):value]);}
 }
 f.c.openai!.pricing_version="changed-pricing";assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();}))).status,"blocked");
 assert.equal(calls,0);assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[OWNER_CALENDAR_STARTED])).length,0);
});

test("aborted request and disabled real runtime cannot claim a task or call providers",async()=>{
 const f=await fixture();const abort=new AbortController();abort.abort();let calls=0;
 for(const extra of [{signal:abort.signal},{isReady:()=>false}])assert.equal((await runOwnerCalendar(db,f.input,runner(f.c,async()=>{calls++;return completion();},extra))).status,"blocked");
 assert.equal(calls,0);assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[OWNER_CALENDAR_STARTED])).length,0);assert.equal((await row(f.task.id)).status,"queued");
});

test("completed six-call run may use reserved finalization headroom, but cannot cross the overall deadline",async()=>{
 for(const finalElapsed of [200_000,OWNER_CALENDAR_BUDGET_MS]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture(true);let calls=0,elapsed=0;
  const result=await runOwnerCalendar(db,f.input,runner(f.c,async()=>{if(++calls===6)elapsed=finalElapsed;return completion();},{elapsed:()=>elapsed}));
  assert.equal(calls,6);assert.equal(result.status,finalElapsed<OWNER_CALENDAR_BUDGET_MS?"review":"blocked");assert.equal((await db.query("SELECT * FROM content_revisions WHERE agent_task_id=$1",[f.task.id])).length,finalElapsed<OWNER_CALENDAR_BUDGET_MS?1:0);assert((await rows("ledger",f.task.id)).every(x=>x.status==="settled"));
 }
});

test("post-admission delay, abort or runtime change prevents the actual transport",async()=>{
 for(const change of ["deadline","abort","runtime"]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture();let injected=false,calls=0,elapsed=0;const abort=new AbortController();
  const observed:Database={...db,transaction:async work=>{let admitted=false;const result=await db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const rows=await tx.query<T>(sql,params);if(sql.includes("'scoped_provider_admitted'"))admitted=true;return rows;}}));if(admitted&&!injected){injected=true;if(change==="deadline")elapsed=170_000;if(change==="abort")abort.abort();if(change==="runtime")f.c.openai!.model="changed-after-admission";}return result;}};
  const result=await runOwnerCalendar(observed,f.input,runner(f.c,async()=>{calls++;return completion();},{elapsed:()=>elapsed,signal:abort.signal}));assert(injected);assert.equal(calls,0,change);assert.equal(result.status,"uncertain",change);assert.equal((await rows("ledger",f.task.id))[0].status,"unknown");assert.equal((await rows("outputs",f.task.id)).length,0);
 }
});

test("deadline, abort or runtime change during final revision writes rolls back review and parent revision",async()=>{
 for(const change of ["deadline","abort","runtime","receipt deadline"]){
  await db.query("TRUNCATE sources,events,budget_months,runtime,studio_auth_user,github_source_policies,calendar_entries CASCADE");
  const f=await fixture(true);let injected=false,calls=0,elapsed=0;const abort=new AbortController();
  const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const rows=await tx.query<T>(sql,params);const final=change==="receipt deadline"?sql.startsWith("INSERT INTO events")&&params?.[2]===OWNER_CALENDAR_FINISHED:sql.startsWith("INSERT INTO content_revisions");if(final&&!injected){injected=true;if(change.includes("deadline"))elapsed=OWNER_CALENDAR_BUDGET_MS;if(change==="abort")abort.abort();if(change==="runtime")f.c.openai!.model="changed-during-finalization";}return rows;}}))};
  const result=await runOwnerCalendar(observed,f.input,runner(f.c,async()=>{calls++;return completion();},{elapsed:()=>elapsed,signal:abort.signal}));assert(injected);assert.equal(calls,6);assert.equal(result.status,"blocked",change);assert.equal((await row(f.task.id)).status,"blocked");assert.equal((await db.query("SELECT * FROM content_revisions WHERE agent_task_id=$1",[f.task.id])).length,0);assert((await rows("ledger",f.task.id)).every(x=>x.status==="settled"));
  const terminal=(await db.query<any>("SELECT detail FROM events WHERE task_id=$1 AND kind=$2",[f.task.id,OWNER_CALENDAR_FINISHED]))[0];assert.equal(JSON.parse(terminal.detail).status,"blocked");
 }
});
