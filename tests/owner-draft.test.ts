import {providerResponseFormatBytes,type ProviderArtifactContract} from '../lib/critic-response-format';
import {taskPlatformPolicyHash} from "../lib/platform-policy-binding";
import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {CAP,BUFFER,CAPSULE,ROLES,hash,istMonth,tokenCost,type RuntimeConfig,type Source,type Task} from "../lib/domain";
import {Store} from "../lib/store";
import {hostedOwnerDraftReady,type HostedEnvironment} from "../lib/hosted";
import {SourceIntake} from "../lib/sources";
import {AccountingFailure,ProviderFailure,TerminationFailure,type Completion,type providerCall} from "../lib/providers";
import {runOwnerDraft,ownerDraftSnapshot,ownerDraftConfigHash,validOwnerDraftRequest,type OwnerDraftRequest} from "../lib/owner-draft";
import {OWNER_DRAFT_STARTED,OWNER_DRAFT_FINISHED,OWNER_DRAFT_MAX_RESERVED,OWNER_DRAFT_BUDGET_MS} from "../lib/owner-draft-policy";

// Every provider is a local injected fake. PostgreSQL guards run against the
// embedded PostgreSQL implementation; no network database or credential exists.
let db:Database,store:Store,intake:SourceIntake;
before(async()=>{const local=await embedded();db={...local,kind:"postgres"};store=new Store(db);intake=new SourceIntake(db);});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.query("TRUNCATE sources,events,budget_months,runtime CASCADE");
  await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
});
function config():RuntimeConfig{return {owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"mock-only-model",pricing_version:"local-test",pricing_tier:"standard",official_pricing_url:"https://openai.com/api/pricing/",input_microdollars_per_token:"0.001",output_microdollars_per_token:"0.001"},hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,fluid_compute_verified:true,cron_authorized:false}};}
async function fixture(label="selected"){
  const staged=await intake.stage({text:`I tested an agent workflow for ${label} and reviewed its result.`,category:"build-log",reported_date:new Date().toISOString().slice(0,10)});
  const source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id);
  return {source,task};
}
function request(task:Task,source:Source,c:RuntimeConfig):OwnerDraftRequest{return {task_id:task.id,expected_source_id:source.id,expected_source_hash:source.hash,expected_clearance_id:source.clearance_id!,expected_updated:new Date(task.updated).toISOString(),expected_checkpoint:0,expected_config_hash:ownerDraftConfigHash(c),expected_platform_policy_hash:taskPlatformPolicyHash(task),acknowledged:true};}
function completion(text="I tested an agent workflow and reviewed its result."):Completion{return {text,input:1,output:1,outcome:"complete",report:{serviceTier:"default",model:"mock-only-model",requestId:"mock-request",finishReason:"stop"}};}
function runner(c:RuntimeConfig,provider:typeof providerCall,extra:Partial<Parameters<typeof runOwnerDraft>[2]>={}){return {readConfig:()=>c,isReady:()=>true,provider,...extra};}
async function rows(table:string,task:string){return db.query(`SELECT * FROM ${table} WHERE task_id=$1`,[task]);}
async function state(task:string){return (await db.query<Task>("SELECT * FROM tasks WHERE id=$1",[task]))[0];}
async function ledger(task:Task,{reserved=1,estimated=1,status="settled",month=istMonth()}: {reserved?:number;estimated?:number;status?:string;month?:string}={}){
  await db.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);
  await db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,estimated,status) VALUES($1,$2,$3,'openai','mock-only-model','{}',$4,$5,$6)",[randomUUID(),task.id,month,reserved,status==="settled"?estimated:null,status]);
}

 test("owner draft completes exactly six selected checkpoints and leaves every other queue item untouched",async()=>{
  const unrelated=await fixture("unrelated older queue entry"),selected=await fixture();
  const c=config(),calls:Array<{provider:string;prompt:string;contract?:ProviderArtifactContract}>=[];
  const result=await runOwnerDraft(db,request(selected.task,selected.source,c),runner(c,async(provider,prompt,_pricing,_transport,_credential,contract)=>{calls.push({provider,prompt,contract});return completion();}));
  assert.equal(result.status,"review");assert.equal(result.steps,6);assert.ok(result.run_id);
  assert.deepEqual(calls.map(call=>call.provider),Array(6).fill("openai"));
  assert.deepEqual(calls.map(call=>call.contract),[undefined,undefined,undefined,undefined,undefined,{artifact:"critic"}]);
  assert.ok(calls.every(call=>call.prompt.includes(selected.source.text)&&!call.prompt.includes(unrelated.source.text)));
  const saved=await state(selected.task.id);assert.equal(saved.status,"review");assert.equal(saved.checkpoint,6);
  assert.equal((await state(unrelated.task.id)).status,"queued");assert.equal((await state(unrelated.task.id)).checkpoint,0);
  assert.equal((await rows("outputs",unrelated.task.id)).length,0);assert.equal((await rows("ledger",unrelated.task.id)).length,0);
  const outputs=await rows("outputs",selected.task.id);assert.equal(outputs.length,6);assert.deepEqual(outputs.map(o=>o.role).sort(),[...ROLES].sort());
  const usage=await rows("ledger",selected.task.id);assert.equal(usage.length,6);assert.ok(usage.every(item=>item.status==="settled"));
  for(const item of usage)assert.equal(Number(item.reserved),tokenCost(c.openai!,Buffer.byteLength(calls[item.checkpoint].prompt)+providerResponseFormatBytes("openai",calls[item.checkpoint].contract)+256,1200));
  assert.ok(usage.reduce((sum,item)=>sum+Number(item.reserved),0)<=OWNER_DRAFT_MAX_RESERVED);
  assert.equal((await rows("approvals",selected.task.id)).length,0);assert.equal((await db.query("SELECT * FROM publishing_outbox")).length,0);
  assert.equal((await db.query("SELECT * FROM calendar_entries")).length,0);assert.equal((await db.query("SELECT * FROM hosted_batches")).length,0);
  assert.equal((await rows("events",selected.task.id)).filter(event=>event.kind===OWNER_DRAFT_STARTED).length,1);
  assert.equal((await rows("events",selected.task.id)).filter(event=>event.kind===OWNER_DRAFT_FINISHED).length,1);
  const snapshot=await ownerDraftSnapshot(db,c,true);assert.equal(snapshot.runs[0].status,"review");assert.equal(snapshot.runs[0].steps,6);
});

 test("concurrent and repeated clicks yield one durable attempt, never a second provider chain",async()=>{
  const {task,source}=await fixture(),c=config(),input=request(task,source,c);
  let calls=0,release!:()=>void,entered!:()=>void;
  const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  const fake:typeof providerCall=async()=>{calls++;if(calls===1){entered();await barrier;}return completion();};
  const first=runOwnerDraft(db,input,runner(c,fake));await started;
  const concurrent=await runOwnerDraft(db,input,runner(c,fake));assert.equal(concurrent.status,"duplicate");assert.equal(calls,1);
  release();assert.equal((await first).status,"review");assert.equal(calls,6);
  assert.equal((await runOwnerDraft(db,input,runner(c,fake))).status,"duplicate");assert.equal(calls,6);
  assert.equal((await rows("events",task.id)).filter(row=>row.kind===OWNER_DRAFT_STARTED).length,1);
});

 test("strict request schema rejects missing, extra, mistyped and malformed bindings",()=>{
  const input:OwnerDraftRequest={task_id:randomUUID(),expected_source_id:randomUUID(),expected_source_hash:hash("source"),expected_clearance_id:randomUUID(),expected_updated:new Date().toISOString(),expected_checkpoint:0,expected_config_hash:hash("config"),expected_platform_policy_hash:taskPlatformPolicyHash({}),acknowledged:true};
  assert.equal(validOwnerDraftRequest(input),true);
  for(const value of [null,[],{}, {...input,acknowledged:false},{...input,acknowledged:"true"},{...input,expected_checkpoint:1},{...input,expected_checkpoint:"0"},{...input,expected_updated:"invalid"},{...input,expected_config_hash:"bad"},{...input,expected_source_hash:"bad"},{...input,task_id:"bad"},{...input,expected_source_id:"bad"},{...input,expected_clearance_id:"bad"},{...input,extra:true}])assert.equal(validOwnerDraftRequest(value),false);
  for(const key of ["task_id","expected_source_id","expected_clearance_id","expected_source_hash","expected_config_hash","expected_platform_policy_hash"]){assert.equal(validOwnerDraftRequest({...input,[key]:[(input as unknown as Record<string,unknown>)[key]]}),false);}
  for(const key of Object.keys(input)){const missing={...input} as Record<string,unknown>;delete missing[key];assert.equal(validOwnerDraftRequest(missing),false);}
});

 test("stale source, hash, clearance and task timestamp fail before any provider or durable attempt",async()=>{
  const {task,source}=await fixture(),c=config(),input=request(task,source,c);let calls=0;
  for(const patch of [{expected_source_id:randomUUID()},{expected_source_hash:hash("different")},{expected_clearance_id:randomUUID()},{expected_updated:new Date(Date.parse(input.expected_updated)-1000).toISOString()},{expected_config_hash:hash("different config")},{expected_platform_policy_hash:hash("different scope")}]){
    const result=await runOwnerDraft(db,{...input,...patch},runner(c,async()=>{calls++;return completion();}));assert.equal(result.status,"blocked");
  }
  assert.equal(calls,0);assert.equal((await rows("ledger",task.id)).length,0);assert.equal((await rows("events",task.id)).filter(row=>row.kind===OWNER_DRAFT_STARTED).length,0);
  assert.equal((await state(task.id)).status,"queued");
});

 test("legacy-only, revoked, corrupted and forged clearance sources are rejected",async()=>{
  const c=config();let calls=0;const fake:typeof providerCall=async()=>{calls++;return completion();};
  const legacy=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),legacyTask=await store.enqueue(legacy.id);
  assert.equal((await runOwnerDraft(db,{...request(legacyTask,legacy,c),expected_clearance_id:randomUUID()},runner(c,fake))).status,"blocked");
  for(const [label,sql] of [["revoked","cleared=false,revoked_at=now()"],["corrupt","text='A different source text.'"],["missing ack","clearance_owner_acknowledged=false"],["wrong purpose","clearance_purpose='different-purpose'"],["wrong provider","clearance_provider='gemini'"],["bad clearance hash",`clearance_hash='${hash("other")}'`]]){
    const {task,source}=await fixture(label);await db.query("UPDATE sources SET "+sql+" WHERE id=$1",[source.id]);
    assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,fake))).status,"blocked",label);
    assert.equal((await rows("ledger",task.id)).length,0,label);
  }
  assert.equal(calls,0);
});

 test("generation off, unready runtime, missing authorization, fallback and non-Postgres all fail closed",async()=>{
  const {task,source}=await fixture();let calls=0;const fake:typeof providerCall=async()=>{calls++;return completion();};
  for(const mutate of [(c:RuntimeConfig)=>{c.owner_cleared_sources_authorized=false;},(c:RuntimeConfig)=>{c.fallback_authorized=true;},(c:RuntimeConfig)=>{c.credential_use_authorized=false;},(c:RuntimeConfig)=>{c.security_tests_passed=false;},(c:RuntimeConfig)=>{c.pricing_verified_date="2020-01-01";}]){
    const c=config();mutate(c);assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,fake))).status,"blocked");
  }
  const c=config();assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,fake,{isReady:()=>false}))).status,"blocked");
  assert.equal((await runOwnerDraft({...db,kind:"pglite"},request(task,source,c),runner(c,fake))).status,"blocked");
  await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");
  assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,fake))).status,"blocked");assert.equal(calls,0);
  assert.equal((await rows("events",task.id)).filter(row=>row.kind===OWNER_DRAFT_STARTED).length,0);
});

 test("only pristine original manual tasks are eligible; no revisions, existing outputs, ledger, or calendar links",async()=>{
  const c=config();let calls=0;const fake:typeof providerCall=async()=>{calls++;return completion();};
  for(const label of ["calendar origin","checkpoint","review","revision","prior output","prior ledger","calendar link"]){
    const {task,source}=await fixture(label);
    if(label==="calendar origin")await db.query("UPDATE tasks SET origin_key='calendar:local-test' WHERE id=$1",[task.id]);
    if(label==="checkpoint")await db.query("UPDATE tasks SET checkpoint=1 WHERE id=$1",[task.id]);
    if(label==="review")await db.query("UPDATE tasks SET status='review' WHERE id=$1",[task.id]);
    if(label==="revision")await db.query("UPDATE tasks SET revision_parent_task_id=$1 WHERE id=$1",[task.id]);
    if(label==="prior output")await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,'Harvester','mock',$3)",[randomUUID(),task.id,hash("mock")]);
    if(label==="prior ledger")await ledger(task);
    if(label==="calendar link")await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,task_id) VALUES($1,'2030-01-01','shortform',now(),now(),now(),$2)",[randomUUID(),task.id]);
    assert.equal((await runOwnerDraft(db,request(await state(task.id),source,c),runner(c,fake))).status,"blocked",label);
  }
  assert.equal(calls,0);
});

 test("reservation cap is cumulative reserved, not cheap settled cost; no retry or fallback after cap",async()=>{
  const {task,source}=await fixture(),c=config();c.openai!.output_microdollars_per_token="50.000";
  let calls=0;const fake:typeof providerCall=async(provider)=>{assert.equal(provider,"openai");calls++;return completion();};
  const result=await runOwnerDraft(db,request(task,source,c),runner(c,fake));assert.equal(result.status,"blocked");assert.equal(result.steps,2);assert.equal(calls,2);
  const usage=await rows("ledger",task.id);assert.equal(usage.length,2);assert.ok(usage.every(row=>row.status==="settled"));
  const reserved=usage.reduce((sum,row)=>sum+Number(row.reserved),0),estimated=usage.reduce((sum,row)=>sum+Number(row.estimated),0);
  assert.ok(reserved>120_000&&reserved<=130_000);assert.ok(estimated<200);assert.equal((await state(task.id)).status,"blocked");
  await assert.rejects(store.retry(task.id),/cannot be replayed/);
  assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,fake))).status,"duplicate");assert.equal(calls,2);
});

 test("Critic schema overhead can block the sixth call at the unchanged cumulative reservation cap",async()=>{
  const first=await fixture(),c=config(),prompts:string[]=[];
  assert.equal((await runOwnerDraft(db,request(first.task,first.source,c),runner(c,async(_provider,prompt)=>{prompts.push(prompt);return completion();}))).status,"review");
  const bytes=prompts.reduce((total,prompt)=>total+Buffer.byteLength(prompt)+256,0);
  c.openai!.input_microdollars_per_token=(Math.floor(129000/bytes*1000)/1000).toFixed(3);
  const oldTotal=prompts.reduce((total,prompt)=>total+tokenCost(c.openai!,Buffer.byteLength(prompt)+256,1200),0);
  const extra=tokenCost(c.openai!,Buffer.byteLength(prompts[5])+256+providerResponseFormatBytes('openai',{artifact:'critic'}),1200)-tokenCost(c.openai!,Buffer.byteLength(prompts[5])+256,1200);
  assert(oldTotal<=OWNER_DRAFT_MAX_RESERVED);assert(oldTotal+extra>OWNER_DRAFT_MAX_RESERVED);
  await db.query("TRUNCATE sources,events,budget_months,runtime CASCADE");
  const selected=await fixture();let calls=0;const run=()=>runOwnerDraft(db,request(selected.task,selected.source,c),runner(c,async()=>{calls++;return completion();}));
  const result=await run();assert.equal(result.status,"blocked");assert.equal(result.steps,5);assert.equal(calls,5);
  const usage=await rows('ledger',selected.task.id);assert.equal(usage.length,5);assert(usage.every(item=>item.status==='settled'));
  assert.equal((await run()).status,'duplicate');assert.equal(calls,5);assert.equal((await rows('approvals',selected.task.id)).length,0);
 });

 test("unresolved accounting from any task or month blocks selection, and monthly cap is not bypassed",async()=>{
  const c=config();let calls=0;const fake:typeof providerCall=async()=>{calls++;return completion();};
  for(const status of ["reserved","unknown"]){
    const other=await fixture(`other ${status}`),selected=await fixture(`selected ${status}`);
    await ledger(other.task,{status,month:"1999-01"});
    assert.equal((await runOwnerDraft(db,request(selected.task,selected.source,c),runner(c,fake))).status,"blocked");
    await db.query("DELETE FROM ledger WHERE task_id=$1",[other.task.id]);
  }
  const other=await fixture("monthly usage"),selected=await fixture("monthly selected");await ledger(other.task,{reserved:CAP-BUFFER,estimated:CAP-BUFFER});
  assert.equal((await runOwnerDraft(db,request(selected.task,selected.source,c),runner(c,fake))).status,"blocked");
  await db.query("UPDATE ledger SET estimated=$1 WHERE task_id=$2",[CAP-BUFFER-1,other.task.id]);
  const result=await runOwnerDraft(db,request(selected.task,selected.source,c),runner(c,fake));assert.equal(result.status,"blocked");assert.equal(calls,0);
  assert.equal((await rows("ledger",selected.task.id)).length,0);
});

 test("changing source consent or config after a completed checkpoint prevents every later call",async()=>{
  for(const label of ["source revoked","clearance replaced","generation disabled","config changed"]){
    const {task,source}=await fixture(label),c=config();let calls=0;
    const result=await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{
      calls++;
      if(label==="source revoked")await intake.revoke(source.id,source.hash);
      if(label==="clearance replaced"){await intake.revoke(source.id,source.hash);await intake.clear(source.id,source.hash,true);}
      if(label==="generation disabled")await db.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");
      if(label==="config changed")c.openai!.model="changed-mock-model";
      return completion();
    }));
    assert.equal(result.status,"blocked",label);assert.equal(calls,1,label);assert.equal((await rows("ledger",task.id)).length,1,label);
    assert.equal((await rows("ledger",task.id))[0].status,"settled",label);
    await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
  }
});

 test("revocation during the final in-flight response retains accounting but cannot report review success",async()=>{
  const {task,source}=await fixture(),c=config();let calls=0;
  const result=await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{calls++;if(calls===6)await intake.revoke(source.id,source.hash);return completion();}));
  assert.equal(calls,6);assert.equal((await rows("ledger",task.id)).length,6);assert.ok((await rows("ledger",task.id)).every(row=>row.status==="settled"));
  assert.equal(result.status,"blocked");assert.notEqual((await state(task.id)).status,"review");
});

 test("known provider rejection is terminal and never retries or falls back",async()=>{
  for(const status of [400,429,500,503]){
    const {task,source}=await fixture(`rejection ${status}`),c=config();let calls=0;
    const result=await runOwnerDraft(db,request(task,source,c),runner(c,async(provider)=>{calls++;assert.equal(provider,"openai");throw new ProviderFailure(status);}));
    assert.equal(calls,1);assert.equal(result.status,status>=500?"uncertain":"blocked");assert.equal((await state(task.id)).checkpoint,0);
    await assert.rejects(store.retry(task.id),/cannot be replayed/);
    assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{calls++;return completion();}))).status,"duplicate");assert.equal(calls,1);
    // Clear mock unresolved accounting to isolate the next status case.
    await db.query("DELETE FROM ledger WHERE task_id=$1",[task.id]);
  }
});

 test("unknown, accounting and termination failures retain reservation and never replay",async()=>{
  for(const error of [Error("fake transport failed"),new AccountingFailure({...completion().report,serviceTier:"priority"}),new TerminationFailure("incomplete",completion().report)]){
    const {task,source}=await fixture(error.message),c=config();let calls=0;
    const result=await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{calls++;throw error;}));
    assert.equal(result.status,"uncertain");assert.equal(result.steps,0);assert.equal(calls,1);
    assert.equal((await rows("ledger",task.id))[0].status,"unknown");assert.equal((await rows("outputs",task.id)).length,0);
    await assert.rejects(store.retry(task.id),/cannot be replayed/);assert.equal(await store.claim(),null);
    const events=JSON.stringify(await rows("events",task.id));assert.ok(!events.includes("fake transport failed"));
    await db.query("DELETE FROM ledger WHERE task_id=$1",[task.id]);
  }
});

 test("timeout consumes late transport completion without settling, checkpoint advancement or replay",async()=>{
  const {task,source}=await fixture(),c=config();let calls=0,complete!: (value:Completion)=>void;
  const late=new Promise<Completion>(resolve=>complete=resolve);
  const result=await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{calls++;return late;},{providerTimeoutMs:5}));
  assert.equal(result.status,"uncertain");assert.equal(result.steps,0);assert.equal(calls,1);
  complete(completion());await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal((await rows("ledger",task.id))[0].status,"unknown");assert.equal((await rows("outputs",task.id)).length,0);assert.equal((await state(task.id)).checkpoint,0);
  assert.equal((await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{calls++;return completion();}))).status,"duplicate");assert.equal(calls,1);
  await assert.rejects(store.retry(task.id),/cannot be replayed/);assert.equal(await store.claim(),null);
});

 test("deadline and abort gate stop before new calls, including after an already settled checkpoint",async()=>{
  const c=config(),first=await fixture("already aborted"),abort=new AbortController();abort.abort();let calls=0;
  assert.equal((await runOwnerDraft(db,request(first.task,first.source,c),runner(c,async()=>{calls++;return completion();},{signal:abort.signal}))).status,"blocked");
  assert.equal((await rows("events",first.task.id)).filter(row=>row.kind===OWNER_DRAFT_STARTED).length,0);
  const second=await fixture("elapsed");let elapsed=0;
  const result=await runOwnerDraft(db,request(second.task,second.source,c),runner(c,async()=>{calls++;elapsed=OWNER_DRAFT_BUDGET_MS;return completion();},{elapsed:()=>elapsed}));
  assert.equal(result.status,"blocked");assert.equal(calls,1);assert.equal((await rows("ledger",second.task.id))[0].status,"settled");
});

 test("generic claims and retries exclude marked tasks only, including expired in-flight leases",async()=>{
  const marked=await fixture("marked"),ordinary=await fixture("ordinary"),c=config();
  const input=request(marked.task,marked.source,c);const runId=randomUUID();
  await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[runId,marked.task.id,OWNER_DRAFT_STARTED,JSON.stringify({task_id:marked.task.id,deadline:new Date(Date.now()-1).toISOString()})]);
  assert.equal((await store.claim())?.id,ordinary.task.id);assert.equal((await state(marked.task.id)).status,"queued");
  await db.query("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()-interval '1 minute' WHERE id=$1",[marked.task.id,randomUUID()]);
  assert.equal(await store.claim(),null);assert.equal((await state(marked.task.id)).status,"running");
  await db.query("UPDATE tasks SET status='blocked',lease_token=NULL,lease_until=NULL WHERE id IN ($1,$2)",[marked.task.id,ordinary.task.id]);
  await assert.rejects(store.retry(marked.task.id),/cannot be replayed/);await store.retry(ordinary.task.id);assert.equal((await store.claim())?.id,ordinary.task.id);
  const snapshot=await ownerDraftSnapshot(db,c,true);assert.equal(snapshot.runs[0].status,"uncertain");assert.equal((await rows("events",marked.task.id)).filter(event=>event.kind===OWNER_DRAFT_FINISHED).length,0);
  assert.equal((await runOwnerDraft(db,input,runner(c,async()=>{throw Error("must not call");}))).status,"duplicate");
});

 test("terminal success revalidates source, generation and task state in its locked transaction",async()=>{
  for(const change of ["source","generation","task","platform policy"]){
    const {task,source}=await fixture(`terminal-lock ${change}`),c=config();let calls=0,injected=false;
    const transactions:string[][]=[];
    const guarded:Database={...db,transaction:work=>db.transaction(async tx=>{
      const statements:string[]=[];transactions.push(statements);
      return work({query:async<T>(sql:string,params?:unknown[])=>{
        // Deterministically represent a competing change committed just before
        // terminal lock acquisition. PGlite is not a real concurrent PG server.
        if(!injected&&sql==="SELECT * FROM tasks WHERE id=$1 FOR UPDATE"&&params?.[0]===task.id){
          const current=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0];
          if(current?.status==="review"&&current.checkpoint===6){
            injected=true;
            if(change==="source")await tx.query("UPDATE sources SET cleared=false,revoked_at=now() WHERE id=$1",[source.id]);
            if(change==="generation")await tx.query("UPDATE calendar_settings SET generation_enabled=false WHERE id=1");
            if(change==="platform policy")await tx.query("UPDATE tasks SET content_brief='{}' WHERE id=$1",[task.id]);
            if(change==="task")await tx.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[task.id]);
          }
        }
        statements.push(sql);return tx.query<T>(sql,params);
      }});
    })};
    const result=await runOwnerDraft(guarded,request(task,source,c),runner(c,async()=>{calls++;return completion();}));
    assert.equal(injected,true,change);assert.equal(calls,6,change);assert.equal(result.status,"blocked",change);
    const terminal=(await rows("events",task.id)).filter(event=>event.kind===OWNER_DRAFT_FINISHED);assert.equal(terminal.length,1);assert.equal(JSON.parse(terminal[0].detail).status,"blocked");
    assert.notEqual((await state(task.id)).status,"review");assert.ok((await rows("ledger",task.id)).every(row=>row.status==="settled"));
    assert.ok(transactions.some(statements=>statements[0]==="SET LOCAL lock_timeout='5s'"&&statements.includes("SELECT * FROM tasks WHERE id=$1 FOR UPDATE")));
    await db.query("UPDATE calendar_settings SET generation_enabled=true WHERE id=1");
  }
});

 test("approval cannot cross an unfinished or unsuccessful durable owner attempt",async()=>{
  const {task}=await fixture();await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,'{}')",[randomUUID(),task.id,OWNER_DRAFT_STARTED]);
  await assert.rejects(store.approve(task.id,hash("not-yet-approved")),/Task is not ready for approval/);
  const finishId=randomUUID();await db.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[finishId,task.id,OWNER_DRAFT_FINISHED,JSON.stringify({status:"uncertain"})]);
  await assert.rejects(store.approve(task.id,hash("not-yet-approved")),/Task is not ready for approval/);
  await db.query("UPDATE events SET detail=$2 WHERE id=$1",[finishId,JSON.stringify({status:"review"})]);
  // A successful terminal marker only opens ordinary review validation; it is
  // not an approval and cannot manufacture a valid artifact bundle.
  await assert.rejects(store.approve(task.id,hash("not-yet-approved")),/Stale artifact version/);
  assert.equal((await rows("approvals",task.id)).length,0);
});

 test("generic queue claim rechecks a newly visible marker after a stale selector row lock",async()=>{
  const task:Task={id:randomUUID(),source_id:randomUUID(),source_hash:hash("mock"),status:"queued",checkpoint:0,lease_token:null,lease_until:null,updated:new Date().toISOString(),origin_key:"manual"};
  const queries:Array<{sql:string;params?:unknown[]}>=[];
  const query:Database["query"]=async<T>(sql:string,params?:unknown[])=>{
    queries.push({sql,params});
    if(sql.startsWith("SELECT * FROM tasks WHERE status='running'"))return [];
    if(sql.startsWith("SELECT * FROM tasks WHERE status='queued'"))return [task] as T[];
    if(sql==="SELECT id FROM events WHERE task_id=$1 AND kind=$2")return [{id:randomUUID()}] as T[];
    throw Error("Unexpected write or query after marked task: "+sql);
  };
  const fake:Database={kind:"postgres",query,transaction:work=>work({query}),close:async()=>{}};
  assert.equal(await new Store(fake).claim(),null);
  const selected=queries.findIndex(item=>item.sql.startsWith("SELECT * FROM tasks WHERE status='queued'")),rechecked=queries.findIndex(item=>item.sql==="SELECT id FROM events WHERE task_id=$1 AND kind=$2");
  assert.ok(selected>=0&&rechecked>selected);assert.deepEqual(queries[rechecked].params,[task.id,OWNER_DRAFT_STARTED]);
  assert.equal(queries.some(item=>/^(UPDATE|INSERT)/.test(item.sql)),false);
});

 test("expired lease recovery rechecks a fresh marker before altering a stale selected running task",async()=>{
  const marked:Task={id:randomUUID(),source_id:randomUUID(),source_hash:hash("mock"),status:"running",checkpoint:0,lease_token:randomUUID(),lease_until:new Date(Date.now()-60000).toISOString(),updated:new Date().toISOString(),origin_key:"manual"};
  const ordinary:Task={...marked,id:randomUUID(),status:"queued",lease_token:null,lease_until:null};
  const queries:Array<{sql:string;params?:unknown[]}>=[];
  const query:Database["query"]=async<T>(sql:string,params?:unknown[])=>{
    queries.push({sql,params});
    if(sql.startsWith("SELECT * FROM tasks WHERE status='running'"))return [marked] as T[];
    if(sql.startsWith("SELECT * FROM tasks WHERE status='queued'"))return [ordinary] as T[];
    if(sql==="SELECT id FROM events WHERE task_id=$1 AND kind=$2")return (params?.[0]===marked.id?[{id:randomUUID()}]:[]) as T[];
    if(sql.startsWith("UPDATE tasks SET status='running'")){assert.equal(params?.[0],ordinary.id);return [{...ordinary,status:"running",lease_token:params?.[1]}] as T[];}
    if(sql.startsWith("INSERT INTO events")){assert.equal(params?.[1],ordinary.id);return [];}
    throw Error("Unexpected expired task recovery: "+sql);
  };
  const fake:Database={kind:"postgres",query,transaction:work=>work({query}),close:async()=>{}};
  assert.equal((await new Store(fake).claim())?.id,ordinary.id);
  const selected=queries.findIndex(item=>item.sql.startsWith("SELECT * FROM tasks WHERE status='running'")),rechecked=queries.findIndex(item=>item.sql==="SELECT id FROM events WHERE task_id=$1 AND kind=$2"&&item.params?.[0]===marked.id);
  assert.ok(selected>=0&&rechecked>selected);
  assert.equal(queries.some(item=>/^(UPDATE|INSERT)/.test(item.sql)&&item.params?.includes(marked.id)),false);
});

 test("real owner-draft readiness is independent of cron consent but fails every required hosted safety gate",()=>{
  const c=config(),env:HostedEnvironment={VERCEL:"1",VERCEL_ENV:"production",STUDIO_HOSTED_ENABLED:"1",STUDIO_AUTH_SECRET:"mock-only-owner-auth-secret-not-a-real-secret",STUDIO_ORIGIN:"https://studio.example.test",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL:"postgresql://example.invalid/mock-only-database",OPENAI_API_KEY:"mock-only-provider-key-not-a-real-key"};
  assert.equal(env.CRON_SECRET,undefined);assert.equal(c.hosted!.cron_authorized,false);
  assert.equal(hostedOwnerDraftReady(c,env),true,"deliberate owner execution does not require cron consent or credentials");
  const noCron=structuredClone(c);delete noCron.hosted!.cron_authorized;delete noCron.fallback_authorized;
  assert.equal(hostedOwnerDraftReady(noCron,env),true,"omitted cron and disabled-by-absence fallback remain valid");
  for(const patch of [
    {VERCEL:undefined},{VERCEL:"0"},{VERCEL_ENV:"preview"},{STUDIO_HOSTED_ENABLED:"0"},
    {STUDIO_AUTH_SECRET:undefined},{STUDIO_AUTH_SECRET:"short"},{STUDIO_ORIGIN:"http://studio.example.test"},{STUDIO_ORIGIN:"https://studio.example.test/path"},
    {STUDIO_DATABASE_AUTHORIZED:"0"},{STUDIO_LOCAL_DB:"1"},{DATABASE_URL:undefined},{DATABASE_URL:"postgresql:///missing-network-host"},
    {DATABASE_URL:"postgresql://example.invalid/mock?host=%2Ftmp"},{OPENAI_API_KEY:undefined},{OPENAI_API_KEY:""},
  ])assert.equal(hostedOwnerDraftReady(c,{...env,...patch}),false,JSON.stringify(Object.keys(patch)));
  const changes:Array<[string,(value:RuntimeConfig)=>void]>=[
    ["hosted disabled",value=>{value.hosted!.enabled=false;}],
    ["owner auth not authorized",value=>{value.hosted!.owner_auth_authorized=false;}],
    ["persistent key not authorized",value=>{value.hosted!.persistent_key_authorized=false;}],
    ["Fluid not verified",value=>{value.hosted!.fluid_compute_verified=false;}],
    ["owner source authorization missing",value=>{value.owner_cleared_sources_authorized=false;}],
    ["credential consent missing",value=>{value.credential_use_authorized=false;}],
    ["security tests missing",value=>{value.security_tests_passed=false;}],
    ["pricing stale",value=>{value.pricing_verified_date="2020-01-01";}],
    ["unapproved pricing extension",value=>{value.pricing_verified_date="2020-01-01";value.pricing_valid_until="2099-01-01";value.pricing_window_authorized=false;}],
    ["fallback enabled",value=>{value.fallback_authorized=true;}],
    ["provider pricing absent",value=>{delete value.openai;}],
    ["model missing",value=>{value.openai!.model="";}],
    ["pricing version missing",value=>{value.openai!.pricing_version="";}],
    ["pricing reference invalid",value=>{value.openai!.official_pricing_url="http://example.invalid";}],
    ["rate invalid",value=>{value.openai!.input_microdollars_per_token="NaN";}],
  ];
  for(const [label,change] of changes){const altered=structuredClone(c);change(altered);assert.equal(hostedOwnerDraftReady(altered,env),false,label);}
});

 test("consent, runtime or global accounting change after reservation is rechecked before first transport",async()=>{
  for(const change of ["source","config","other accounting"]){
    const {task,source}=await fixture(`before transport ${change}`),other=await fixture(`other reservation ${change}`),c=config();let injected=false,calls=0;
    const guarded:Database={...db,transaction:async work=>{
      let reserved=false;
      const result=await db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const rows=await tx.query<T>(sql,params);if(sql.startsWith("INSERT INTO ledger"))reserved=true;return rows;}}));
      // Mutation occurs after the reservation transaction commits, so it is
      // visible to the independently locked immediately-before-provider guard.
      if(reserved&&!injected){injected=true;if(change==="source")await intake.revoke(source.id,source.hash);if(change==="config")c.openai!.model="changed-mock-only";if(change==="other accounting")await ledger(other.task,{status:"unknown",month:"1999-01"});}
      return result;
    }};
    const result=await runOwnerDraft(guarded,request(task,source,c),runner(c,async()=>{calls++;return completion();}));
    assert.equal(injected,true,change);assert.equal(calls,0,change);assert.equal(result.status,"uncertain",change);assert.equal((await rows("ledger",task.id))[0].status,"unknown");assert.equal((await rows("outputs",task.id)).length,0);
    await db.query("DELETE FROM ledger WHERE task_id IN ($1,$2)",[task.id,other.task.id]);
  }
});


test("persisted platform scope cannot change between one-shot checkpoints",async()=>{
 const {task,source}=await fixture("scope change"),c=config();let calls=0;
 const result=await runOwnerDraft(db,request(task,source,c),runner(c,async()=>{
  calls++;await db.query("UPDATE tasks SET content_brief='{}' WHERE id=$1",[task.id]);return completion();
 }));
 assert.equal(calls,1);assert.equal(result.status,"blocked");assert.equal((await rows("ledger",task.id)).length,1);
 assert.equal((await rows("approvals",task.id)).length,0);assert.equal((await db.query("SELECT * FROM publishing_outbox")).length,0);
});
