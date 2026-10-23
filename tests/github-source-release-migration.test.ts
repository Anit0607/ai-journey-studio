import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA} from '../lib/schema';
import {GITHUB_SOURCE_POLICY_SCHEMA} from '../lib/github-source-policy-schema';
import {GITHUB_POLICY_CATALOG_SQL,runGithubSourceReleaseMigration,verifyGithubPolicyCatalog} from '../lib/github-source-release-migration';
import {runReleaseMigration} from '../lib/release-migration';
import {MANUAL_PUBLICATION_SCHEMA} from '../lib/manual-publication-schema';
const env={VERCEL:'1',CI:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',NODE_ENV:'production',STUDIO_DATABASE_AUTHORIZED:'1',DATABASE_URL:'postgresql://fixture:never-log-this@db.invalid/studio'};
const names=['github_source_policy_previews','github_source_policies','github_source_grants'];
async function fixture(work:(db:PGlite)=>Promise<void>){const db=new PGlite();try{await db.exec(SCHEMA.slice(0,SCHEMA.indexOf(GITHUB_SOURCE_POLICY_SCHEMA)));await work(db);}finally{await db.close();}}
function transport(db:PGlite,intercept?:(sql:string)=>Promise<void>|void){const statements:string[]=[];let ended=0;let listener=()=>{};return {statements,get ended(){return ended;},idleError(){listener();},createClient:()=>({on(_event:'error',handler:()=>void){listener=handler;return this;},async connect(){},async query(sql:string){statements.push(sql);await intercept?.(sql);const result=await db.exec(sql);return {rows:(result.at(-1)?.rows||[]) as Record<string,unknown>[]};},async end(){ended++;}})};}
async function catalog(db:PGlite){const result={} as Record<keyof typeof GITHUB_POLICY_CATALOG_SQL,Record<string,unknown>[]>;for(const key of Object.keys(GITHUB_POLICY_CATALOG_SQL) as (keyof typeof GITHUB_POLICY_CATALOG_SQL)[])result[key]=(await db.query<Record<string,unknown>>(GITHUB_POLICY_CATALOG_SQL[key])).rows;return result;}
async function snapshot(db:PGlite){const tables=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'schema_versions' ORDER BY table_name")).rows;const value:Record<string,unknown>={};for(const t of tables)if(!names.includes(t.table_name))value[t.table_name]=(await db.query(`SELECT to_jsonb(t) AS row FROM public.${t.table_name} t ORDER BY to_jsonb(t)::text`)).rows;return value;}

test('021 skips local/test/preview without reading credentials, constructing clients or changing consent',async()=>{
 for(const initial of [{},{NODE_ENV:'test'},{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'preview'}]){
  const variables:Record<string,string|undefined>={...initial};Object.defineProperty(variables,'DATABASE_URL',{get(){throw Error('Must not read');}});let created=0;const result=await runGithubSourceReleaseMigration(variables,{createClient(){created++;throw Error('Must not connect');}});assert.equal(result.status,'skipped');assert.equal(created,0);
 }
});
test('021 applies only additive exact schema after020, validates actual catalog and leaves all legacy rows unchanged',()=>fixture(async db=>{
 await db.exec("INSERT INTO sources(id,text,category,reported_date,hash,cleared) VALUES('10000000-0000-4000-8000-000000000001','Existing note','project-note','2026-10-20','old-hash',false)");
 const before=await snapshot(db),mock=transport(db);assert.equal((await runGithubSourceReleaseMigration(env,{createClient:mock.createClient})).status,'applied');assert.equal(mock.ended,1);assert.deepEqual(await snapshot(db),before);
 assert.equal((await readFile('migrations/021_github_source_policy.sql','utf8')).trim(),GITHUB_SOURCE_POLICY_SCHEMA.trim());
 assert.equal(mock.statements.filter(s=>s===GITHUB_SOURCE_POLICY_SCHEMA).length,1);assert.equal(verifyGithubPolicyCatalog(await catalog(db)),true);
 for(const name of names)assert.equal((await db.query('SELECT * FROM '+name)).rows.length,0);
 const second=transport(db);assert.equal((await runGithubSourceReleaseMigration(env,{createClient:second.createClient})).status,'applied');assert.deepEqual(await snapshot(db),before);assert.equal((await db.query('SELECT version FROM schema_versions WHERE version=21')).rows.length,1);
}));
test('021 rejects missing prerequisite instead of bootstrapping or repairing existing data',()=>fixture(async db=>{
 await db.exec('DELETE FROM schema_versions WHERE version=20');const mock=transport(db);await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient}),/existing schema prerequisite/);assert(!mock.statements.includes(GITHUB_SOURCE_POLICY_SCHEMA));assert(!mock.statements.includes('COMMIT'));
}));
test('021 validates exact namespaces, durable tables, built-in types/collations and immediate uniqueness',()=>fixture(async db=>{
 await db.exec(GITHUB_SOURCE_POLICY_SCHEMA);const good=await catalog(db);assert(verifyGithubPolicyCatalog(good));
 for(const [section,property,value] of [['tables','relpersistence','u'],['columns','builtin_type',false],['columns','default_collation',false],['foreign_keys','public_target',false],['indexes','indimmediate',false],['indexes','indisvalid',false]] as const){const bad=structuredClone(good);if(section==='indexes')for(const row of bad.indexes)row[property]=value;else bad[section][0][property]=value;assert.equal(verifyGithubPolicyCatalog(bad),false,property);}
}));
test('021 conflicting referenced namespace fails physical catalog verification without destructive repair',()=>fixture(async db=>{
 await db.exec(GITHUB_SOURCE_POLICY_SCHEMA);await db.exec('CREATE SCHEMA shadow; CREATE TABLE shadow.events(id UUID PRIMARY KEY); ALTER TABLE github_source_policies DROP CONSTRAINT github_source_policies_receipt_id_fkey; ALTER TABLE github_source_policies ADD CONSTRAINT wrong_target FOREIGN KEY(receipt_id) REFERENCES shadow.events(id)');
 const before=await snapshot(db),mock=transport(db);await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient}),/schema verification/);assert.deepEqual(await snapshot(db),before);assert(!mock.statements.includes('COMMIT'));assert(mock.statements.includes('ROLLBACK'));
}));
test('021 incompatible preexisting defaults and uniqueness fail rather than silently enabling policy',()=>fixture(async db=>{
 await db.exec(GITHUB_SOURCE_POLICY_SCHEMA);await db.exec('ALTER TABLE github_source_policies ALTER COLUMN active SET DEFAULT true');const mock=transport(db);await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient}),/schema verification/);assert(!mock.statements.includes('COMMIT'));assert.equal((await db.query('SELECT * FROM github_source_policies')).rows.length,0);
}));
test('021 recorded idle errors cannot submit a later COMMIT or leak transport details',()=>fixture(async db=>{
 const mock=transport(db,sql=>{if(sql.includes('AS applied'))mock.idleError();});await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient}),error=>{assert(error instanceof Error);assert(!error.message.includes(env.DATABASE_URL));assert(!error.message.includes('never-log-this'));return true;});assert(!mock.statements.includes('COMMIT'));assert(mock.statements.includes('ROLLBACK'));
}));
test('021 deadline is checked before submitting the next statement, not after driver invocation',()=>fixture(async db=>{
 const mock=transport(db,async sql=>{if(sql.includes('AS applied'))await new Promise(resolve=>setTimeout(resolve,70));});await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient,deadlineMs:60}));assert(!mock.statements.includes('COMMIT'));
}));
test('021 failure after separately committed020 leaves020 valid and aborts only021',async()=>{
 const db=new PGlite();try{
  await db.exec(SCHEMA.slice(0,SCHEMA.indexOf(MANUAL_PUBLICATION_SCHEMA)));let mock=transport(db);await runReleaseMigration(env,{createClient:mock.createClient});
  mock=transport(db,sql=>{if(sql===GITHUB_SOURCE_POLICY_SCHEMA)throw Error('isolated transport failure');});await assert.rejects(runGithubSourceReleaseMigration(env,{createClient:mock.createClient}));assert.equal((await db.query('SELECT version FROM schema_versions WHERE version=20')).rows.length,1);assert.equal((await db.query('SELECT version FROM schema_versions WHERE version=21')).rows.length,0);
 }finally{await db.close();}
});
test('build hook always verifies020 before021 and does not use broad bootstrap migration',async()=>{
 const script=await readFile('scripts/release-migration.ts','utf8');assert(script.indexOf('await runReleaseMigration(')<script.indexOf('await runGithubSourceReleaseMigration('));assert(!script.includes('scripts/migrate'));assert.match(script,/process.exit\(1\)/);
});
