import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA} from '../lib/schema';
import {ASSISTANT_WORDING_SCHEMA} from '../lib/assistant-wording-schema';
import {ASSISTANT_WORDING_CATALOG_SQL,verifyAssistantWordingCatalog,runAssistantWordingReleaseMigration} from '../lib/assistant-wording-release-migration';
import type {ReleaseMigrationClient} from '../lib/release-migration';
const env={VERCEL:'1',CI:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',STUDIO_DATABASE_AUTHORIZED:'1',DATABASE_URL:'postgresql://offline.invalid/studio'};
let db:PGlite;
const catalogs=async()=>{const out:any={};for(const [key,sql] of Object.entries(ASSISTANT_WORDING_CATALOG_SQL))out[key]=(await db.query(sql)).rows;return out;};
before(async()=>{db=new PGlite();await db.exec(SCHEMA.slice(0,-ASSISTANT_WORDING_SCHEMA.length));});
after(async()=>{await db.close();});
function client(){const statements:string[]=[];let opened=0,closed=0;const value:ReleaseMigrationClient={on:()=>{},connect:async()=>{opened++;},query:async sql=>{statements.push(sql);return db.exec(sql);},end:async()=>{closed++;}};return {createClient:()=>value,statements,counts:()=>({opened,closed})};}

test('migration SQL matches bootstrap bytes; prior owner records and both immutable triggers survive migration/replay',async()=>{
 assert.equal(readFileSync(new URL('../migrations/023_assistant_wording_review.sql',import.meta.url),'utf8'),ASSISTANT_WORDING_SCHEMA);
 const old=await catalogs();assert(verifyAssistantWordingCatalog(old,'before'));assert(!verifyAssistantWordingCatalog(old,'after'));
 const source=randomUUID(),task=randomUUID(),owner=randomUUID(),receipt=randomUUID();
 await db.query("INSERT INTO sources(id,text,category,reported_date,hash) VALUES($1,'Offline source','project-note','2026-10-25','offline-source')",[source]);
 await db.query("INSERT INTO tasks(id,source_id,source_hash,status) VALUES($1,$2,'offline-source','review')",[task,source]);
 await db.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,'binding','finding','accept','evidence-review-v3-lossless-spans','owner','Original owner judgement','{}','{}')",[owner,task]);
 await db.query("INSERT INTO evidence_approval_receipts(id,task_id,binding,evidence_version,review_token) VALUES($1,$2,'binding','original-evidence','original:offline')",[receipt,task]);
 const originalOwner=(await db.query('SELECT * FROM evidence_decisions')).rows,originalReceipt=(await db.query('SELECT * FROM evidence_approval_receipts')).rows;
 const c=client();assert.equal((await runAssistantWordingReleaseMigration(env,c)).status,'applied');assert.deepEqual(c.counts(),{opened:1,closed:1});
 assert(c.statements.includes('SELECT pg_catalog.pg_advisory_xact_lock(13141516,23)'));assert(c.statements.indexOf('LOCK TABLE public.evidence_decisions, public.evidence_approval_receipts IN ACCESS EXCLUSIVE MODE')<c.statements.indexOf(ASSISTANT_WORDING_SCHEMA));
 const current=await catalogs();assert(verifyAssistantWordingCatalog(current,'after'));assert.deepEqual(current.triggers,old.triggers);
 assert.deepEqual((await db.query('SELECT * FROM evidence_decisions')).rows,originalOwner);assert.deepEqual((await db.query('SELECT * FROM evidence_approval_receipts')).rows,originalReceipt);
 const assistant=randomUUID();await db.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,'binding','other','accept','assistant-wording-comparison-v1','assistant','Explicit assistant comparison','{}','{}')",[assistant,task]);
 for(const sql of ["UPDATE evidence_decisions SET actor='owner' WHERE actor='assistant'",'DELETE FROM evidence_decisions','DELETE FROM evidence_approval_receipts'])await assert.rejects(db.exec(sql),/immutable/);
 await assert.rejects(db.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,'binding','invalid','accept','any','robot','Invalid actor','{}','{}')",[randomUUID(),task]),/check constraint/);
 const rows=(await db.query('SELECT * FROM evidence_decisions ORDER BY sequence')).rows;await runAssistantWordingReleaseMigration(env,client());assert.deepEqual((await db.query('SELECT * FROM evidence_decisions ORDER BY sequence')).rows,rows);
 assert.equal((await db.query('SELECT version FROM schema_versions WHERE version=23')).rows.length,1);
});

test('unexpected actor checks, disabled/changed immutable triggers and altered function bodies fail closed',async()=>{
 for(const sql of [
  "ALTER TABLE evidence_decisions DROP CONSTRAINT evidence_decisions_actor_check; ALTER TABLE evidence_decisions ADD CONSTRAINT evidence_decisions_actor_check CHECK(actor IN ('owner','assistant','robot'))",
  "ALTER TABLE evidence_decisions ADD CONSTRAINT extra_actor_check CHECK(actor!='robot')",
  'ALTER TABLE evidence_decisions DISABLE TRIGGER evidence_decision_immutable',
  'DROP TRIGGER evidence_receipt_immutable ON evidence_approval_receipts',
  "CREATE OR REPLACE FUNCTION studio_evidence_immutable() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql",
  "ALTER TABLE evidence_decisions ALTER COLUMN actor SET DEFAULT 'owner'",
 ]){
  await db.exec('BEGIN');try{await db.exec(sql);await assert.rejects(db.exec(ASSISTANT_WORDING_SCHEMA),/differs|ambiguous/);}finally{await db.exec('ROLLBACK');}
  assert(verifyAssistantWordingCatalog(await catalogs(),'after'));
 }
});

test('operational owner-only NOT VALID guard blocks new assistant rows without touching historical records',async()=>{
 const before=(await db.query('SELECT * FROM evidence_decisions ORDER BY sequence')).rows,task=(before[0] as any).task_id;
 await db.exec('BEGIN');try{
  await db.exec("ALTER TABLE evidence_decisions ADD CONSTRAINT evidence_decisions_owner_only_rollback CHECK(actor='owner') NOT VALID");
  assert.deepEqual((await db.query('SELECT * FROM evidence_decisions ORDER BY sequence')).rows,before);
  await assert.rejects(db.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,'binding','new','accept','assistant-wording-comparison-v1','assistant','No new assistant row after rollback','{}','{}')",[randomUUID(),task]),/check constraint/);
 }finally{await db.exec('ROLLBACK');}
 assert.deepEqual((await db.query('SELECT * FROM evidence_decisions ORDER BY sequence')).rows,before);
});

test('catalog validation rejects column, constraint, trigger and immutable-function drift',async()=>{
 const original=await catalogs();for(const change of [
  (x:any)=>x.actor[0].not_null=false,(x:any)=>x.actor[0].is_text=false,(x:any)=>x.actor[0].relrowsecurity=true,
  (x:any)=>x.checks[0].convalidated=false,(x:any)=>x.checks[0].expression="(actor = ANY (ARRAY['owner'::text, 'assis tant'::text]))",(x:any)=>x.checks.push({...x.checks[0]}),
  (x:any)=>x.triggers[0].tgtype=25,(x:any)=>x.triggers[0].prosecdef=true,(x:any)=>x.triggers[0].no_condition=false,(x:any)=>x.triggers[0].prosrc='BEGIN RETURN NEW; END;',
 ]){const changed=structuredClone(original);change(changed);assert.equal(verifyAssistantWordingCatalog(changed,'before'),false);assert.equal(verifyAssistantWordingCatalog(changed,'after'),false);}
});

test('local/test/preview release checks open no connection; malformed production authority is rejected',async()=>{
 let connections=0;const deps={createClient:()=>{connections++;throw Error('must not connect');}};
 for(const e of [{},{NODE_ENV:'test'},{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'preview'}])assert.equal((await runAssistantWordingReleaseMigration(e,deps)).status,'skipped');
 for(const e of [{...env,CI:'0'},{...env,STUDIO_DATABASE_AUTHORIZED:'0'},{...env,DATABASE_URL:'postgresql:///socket'}])await assert.rejects(runAssistantWordingReleaseMigration(e,deps));
 assert.equal(connections,0);
});

test('release DDL/catalog/commit failure rolls back once, closes once and redacts transport details without retry',async()=>{
 const catalog=await catalogs();
 for(const failure of ['DDL','catalog','postcatalog','COMMIT']){
  const queries:string[]=[];let closed=0,created=0;
  const c:ReleaseMigrationClient={on:()=>{},connect:async()=>{},end:async()=>{closed++;},query:async sql=>{
   queries.push(sql);if(sql===ASSISTANT_WORDING_SCHEMA&&failure==='DDL'||sql==='COMMIT'&&failure==='COMMIT')throw Error('secret-db-url credential-value');
   if(sql.includes('AS has_v22'))return {rows:[{has_v22:true}]};if(sql.includes('AS applied'))return {rows:[{applied:true}]};
   const key=(Object.keys(ASSISTANT_WORDING_CATALOG_SQL) as Array<keyof typeof ASSISTANT_WORDING_CATALOG_SQL>).find(key=>ASSISTANT_WORDING_CATALOG_SQL[key]===sql);
   if(key){const rows=structuredClone(catalog[key]);if((failure==='catalog'||failure==='postcatalog'&&queries.includes(ASSISTANT_WORDING_SCHEMA))&&key==='checks')rows[0].convalidated=false;return {rows};}return {rows:[]};
  }};
  await assert.rejects(runAssistantWordingReleaseMigration(env,{createClient:()=>{created++;return c;}}),error=>{assert(error instanceof Error);assert(!error.message.includes('secret'));assert(!error.message.includes('credential-value'));assert.match(error.message,/Migration 023 failed/);return true;});
  assert.equal(created,1);assert.equal(closed,1);assert.equal(queries.filter(q=>q==='ROLLBACK').length,1);assert.equal(queries.filter(q=>q===ASSISTANT_WORDING_SCHEMA).length,failure==='catalog'?0:1);
 }
});

test('build hook includes the independently bounded 023 step after 022, and schema bootstrap appends only its SQL',()=>{
 const hook=readFileSync(new URL('../scripts/release-migration.ts',import.meta.url),'utf8');assert(hook.indexOf('console.log((await runSchedulerWindowReleaseMigration')<hook.indexOf('console.log((await runAssistantWordingReleaseMigration'));assert(SCHEMA.endsWith(ASSISTANT_WORDING_SCHEMA));assert(!ASSISTANT_WORDING_SCHEMA.includes('CREATE TRIGGER'));assert(!ASSISTANT_WORDING_SCHEMA.includes('UPDATE evidence_decisions'));assert(!ASSISTANT_WORDING_SCHEMA.includes('DELETE FROM evidence_decisions'));
});

test('connection timeout and idle connection error stay bounded, close once and never retry',async()=>{
 const catalog=await catalogs();for(const mode of ['timeout','idle']){
  let listener=()=>{},created=0,closed=0;const queries:string[]=[];
  const c:ReleaseMigrationClient={on:(_event,fn)=>{listener=fn;},connect:async()=>{if(mode==='timeout')await new Promise(()=>{});},end:async()=>{closed++;},query:async sql=>{
   queries.push(sql);if(sql===ASSISTANT_WORDING_SCHEMA&&mode==='idle'){listener();return {rows:[]};}
   if(sql.includes('AS has_v22'))return {rows:[{has_v22:true}]};
   const key=(Object.keys(ASSISTANT_WORDING_CATALOG_SQL) as Array<keyof typeof ASSISTANT_WORDING_CATALOG_SQL>).find(k=>ASSISTANT_WORDING_CATALOG_SQL[k]===sql);return {rows:key?catalog[key]:[]};
  }};
  await assert.rejects(runAssistantWordingReleaseMigration(env,{deadlineMs:mode==='timeout'?10:60000,createClient:()=>{created++;return c;}}),/Migration 023/);assert.equal(created,1);assert.equal(closed,1);assert.equal(queries.filter(q=>q===ASSISTANT_WORDING_SCHEMA).length,mode==='idle'?1:0);assert(!queries.includes('COMMIT'));
 }
});
