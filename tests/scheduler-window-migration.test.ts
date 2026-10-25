import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA} from '../lib/schema';
import {SCHEDULER_WINDOW_SCHEMA} from '../lib/scheduler-window-schema';
import {runSchedulerWindowReleaseMigration,verifySchedulerWindowColumn} from '../lib/scheduler-window-release-migration';
const env={VERCEL:'1',CI:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',NODE_ENV:'production',STUDIO_DATABASE_AUTHORIZED:'1',DATABASE_URL:'postgresql://fixture:never-log@db.invalid/studio'};
async function fixture(work:(db:PGlite)=>Promise<void>){const db=new PGlite();try{await db.exec(SCHEMA.slice(0,SCHEMA.indexOf(SCHEDULER_WINDOW_SCHEMA)));await work(db);}finally{await db.close();}}
function transport(db:PGlite,intercept?:(sql:string)=>void){const statements:string[]=[];let ended=0;return {statements,get ended(){return ended;},createClient:()=>({on(){return this;},async connect(){},async query(sql:string){statements.push(sql);intercept?.(sql);return {rows:(await db.exec(sql)).at(-1)?.rows as Record<string,unknown>[]||[]};},async end(){ended++;}})};}

test('022 skips local/test/preview with zero clients and production requires the existing explicit authorization',async()=>{
 for(const vars of [{},{NODE_ENV:'test'},{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'preview'}]){let clients=0;assert.equal((await runSchedulerWindowReleaseMigration(vars,{createClient(){clients++;throw Error('No DB');}})).status,'skipped');assert.equal(clients,0);}
 for(const patch of [{STUDIO_DATABASE_AUTHORIZED:'0'},{CI:undefined},{VERCEL_ENV:'preview'}])await assert.rejects(runSchedulerWindowReleaseMigration({...env,...patch},{createClient(){throw Error('must not connect');}}),/blocked/);
});

test('022 is additive, idempotent and actual catalog verified without binding legacy rows or changing consent',()=>fixture(async db=>{
 await db.exec("INSERT INTO sources(id,text,category,reported_date,hash) VALUES('10000000-0000-4000-8000-000000000001','Legacy source','project-note','2026-10-20','old-hash'); INSERT INTO tasks(id,source_id,source_hash,status) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','old-hash','approved'); INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,source_clearance_token,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version,status) VALUES('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','old-hash','old-clearance','old-review','old-artifact','old-variant','LinkedIn','old-account','old-version','old-remote','{}','2026-10-26T16:30Z','old-intent','approved');");
 const before=(await db.query<Record<string,unknown>>('SELECT * FROM publishing_outbox')).rows[0];const mock=transport(db);assert.equal((await runSchedulerWindowReleaseMigration(env,{createClient:mock.createClient})).status,'applied');assert.equal(mock.ended,1);assert.deepEqual((await db.query('SELECT * FROM publishing_outbox')).rows[0],{...before,scheduler_policy_hash:null});
 assert.equal((await runSchedulerWindowReleaseMigration(env,{createClient:mock.createClient})).status,'applied');assert.equal((await db.query('SELECT * FROM schema_versions WHERE version=22')).rows.length,1);
 assert.equal(await readFile('migrations/022_scheduler_windows.sql','utf8'),SCHEDULER_WINDOW_SCHEMA);
 await assert.rejects(db.exec("UPDATE publishing_outbox SET scheduler_policy_hash='not-a-hash'"));assert.equal((await db.query('SELECT * FROM publishing_approvals')).rows.length,0);
}));

test('022 missing prerequisite or conflicting existing hash column aborts without destructive repair',async t=>{
 await t.test('missing 021',()=>fixture(async db=>{await db.exec('DELETE FROM schema_versions WHERE version=21');const mock=transport(db);await assert.rejects(runSchedulerWindowReleaseMigration(env,{createClient:mock.createClient}),/prerequisite/);assert(!mock.statements.includes(SCHEDULER_WINDOW_SCHEMA));assert(!mock.statements.includes('COMMIT'));}));
 await t.test('conflicting default',()=>fixture(async db=>{await db.exec("ALTER TABLE publishing_outbox ADD COLUMN scheduler_policy_hash TEXT DEFAULT 'unsafe'");const mock=transport(db);await assert.rejects(runSchedulerWindowReleaseMigration(env,{createClient:mock.createClient}),/schema verification/);assert(mock.statements.includes('ROLLBACK'));assert(!mock.statements.includes('COMMIT'));assert.equal((await db.query('SELECT * FROM schema_versions WHERE version=22')).rows.length,0);}));
});

test('022 verifier rejects fake compatible-looking default/type/check and release hook runs it after 021',async()=>{
 const good={is_text:true,not_null:false,writable:true,default_collation:true,default_expression:null},checks=[{validated:true,expression:"((scheduler_policy_hash IS NULL) OR (scheduler_policy_hash ~ '^[0-9a-f]{64}$'::text))"}];assert(verifySchedulerWindowColumn(good,checks));
 for(const patch of [{is_text:false},{not_null:true},{writable:false},{default_collation:false},{default_expression:"'generic'::text"}])assert(!verifySchedulerWindowColumn({...good,...patch},checks));
 assert(!verifySchedulerWindowColumn(good,[{...checks[0],validated:false}]));assert(!verifySchedulerWindowColumn(good,[{...checks[0],expression:'true'}]));
 const script=await readFile('scripts/release-migration.ts','utf8');assert(script.indexOf('await runGithubSourceReleaseMigration(')<script.indexOf('await runSchedulerWindowReleaseMigration('));assert(!script.includes('scripts/migrate'));
});
