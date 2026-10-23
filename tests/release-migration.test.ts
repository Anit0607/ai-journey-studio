import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {EventEmitter} from "node:events";
import {PGlite} from "@electric-sql/pglite";
import type {ClientConfig} from "pg";
import {SCHEMA} from "../lib/schema";
import {MANUAL_PUBLICATION_SCHEMA} from "../lib/manual-publication-schema";
import {releaseMigrationDecision,runReleaseMigration,RELEASE_MIGRATION_LIMITS} from "../lib/release-migration";

// Synthetic configuration only. Every production-path test injects a local transport.
const PASSWORD="synthetic-test-password-not-a-credential";
const DATABASE_URL=`postgresql://isolated:${PASSWORD}@db.example.invalid/studio`;
const PRODUCTION={VERCEL:"1",CI:"1",VERCEL_ENV:"production",VERCEL_TARGET_ENV:"production",NODE_ENV:"production",STUDIO_DATABASE_AUTHORIZED:"1",DATABASE_URL};
type Env=Record<string,string|undefined>;
type Client={on(event:"error",listener:()=>void):unknown;connect():Promise<void>;query(sql:string):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>};
const OMITTED=Symbol("omitted");
function changed(key:string,value:string|typeof OMITTED):Env {
  const env:Env={...PRODUCTION};if(value===OMITTED)delete env[key];else env[key]=value;return env;
}
function assertSanitized(error:unknown){
  assert(error instanceof Error);
  const visible=[String(error),error.stack,JSON.stringify(error)].join("\n");
  for(const secret of [PASSWORD,DATABASE_URL,"RAW_DRIVER_DETAIL","SELECT private_secret"])assert(!visible.includes(secret),`Failure output must not expose ${secret}`);
  assert.equal((error as Error&{cause?:unknown}).cause,undefined,"Do not retain a raw driver error as an exposed cause");
  return true;
}

test("release gate applies only to an explicitly authorized production Vercel build",()=>{
  assert.equal(releaseMigrationDecision(PRODUCTION),"apply");
  for(const [key,value] of [
    ["VERCEL",OMITTED],["VERCEL","true"],["CI",OMITTED],["CI","true"],
    ["VERCEL_ENV",OMITTED],["VERCEL_ENV","Production"],["VERCEL_TARGET_ENV",OMITTED],["VERCEL_TARGET_ENV","preview"],
    ["STUDIO_DATABASE_AUTHORIZED",OMITTED],["STUDIO_DATABASE_AUTHORIZED","true"],["STUDIO_LOCAL_DB","1"],
    ["DATABASE_URL",OMITTED],["DATABASE_URL",""],["DATABASE_URL","not-a-url"],
    ["DATABASE_URL","https://db.example.invalid/studio"],
    ["DATABASE_URL","postgresql://db.example.invalid"],
    ["DATABASE_URL","postgresql://db.example.invalid/studio?host=%2Fvar%2Frun%2Fpostgresql"],
  ] as [string,string|typeof OMITTED][]){
    assert.throws(()=>releaseMigrationDecision(changed(key,value)),assertSanitized,`${key}=${String(value)} must fail closed`);
  }
});

test("explicit Vercel build context rejects absent and malformed system markers before secrets or clients",async()=>{
  for(const initial of [{},{NODE_ENV:"test"},{CI:"1"},{VERCEL_ENV:"production"},{VERCEL:"1",CI:"1",VERCEL_ENV:"preview"},{VERCEL:"1",VERCEL_ENV:"development",VERCEL_TARGET_ENV:"preview"}]){
    const env:Env={...initial};let clients=0;
    for(const name of ["DATABASE_URL","STUDIO_DATABASE_AUTHORIZED"]){Object.defineProperty(env,name,{get(){throw Error(`Gate read ${name}`);}});}
    assert.throws(()=>releaseMigrationDecision(env,true),assertSanitized);
    await assert.rejects(runReleaseMigration(env,{vercelBuild:true,createClient(){clients++;throw Error("Must not be called");}}),assertSanitized);
    assert.equal(clients,0);
  }
  assert.equal(releaseMigrationDecision(PRODUCTION,true),"apply");
  assert.equal(releaseMigrationDecision({VERCEL:"1",VERCEL_ENV:"preview",VERCEL_TARGET_ENV:"preview"},true),"skip-nonproduction");
});

test("local, test and preview builds never read database configuration or create a client",async()=>{
  const environments:Env[]=[{}, {NODE_ENV:"development"}, {CI:"1"},
    {NODE_ENV:"test"},
    {VERCEL:"1",CI:"1",VERCEL_ENV:"preview",VERCEL_TARGET_ENV:"preview"},
    {VERCEL:"1",VERCEL_ENV:"development",VERCEL_TARGET_ENV:"development"},
    {VERCEL:"1",CI:"1",VERCEL_ENV:"preview",VERCEL_TARGET_ENV:"branch-sandbox"},
  ];
  for(const initial of environments){
    const env:Env={...initial};
    for(const name of ["DATABASE_URL","STUDIO_DATABASE_AUTHORIZED"]){
      Object.defineProperty(env,name,{get(){throw Error(`Skipped builds must not read ${name}`);}});
    }
    let clients=0;
    const result=await runReleaseMigration(env,{createClient(){clients++;throw Error("Client must not be constructed");}});
    assert.equal(result.status,"skipped");assert.equal(clients,0);
  }
});

test("a hosted production test flag cannot silently bypass the migration gate",async()=>{
  const env:Env={...PRODUCTION,NODE_ENV:"test"};let clients=0;
  for(const name of ["DATABASE_URL","STUDIO_DATABASE_AUTHORIZED"]){Object.defineProperty(env,name,{get(){throw Error(`Gate read ${name}`);}});}
  await assert.rejects(runReleaseMigration(env,{createClient(){clients++;throw Error("Must not create a client");}}),error=>{
    assertSanitized(error);assert(error instanceof Error);assert.match(error.message,/production build markers/);return true;
  });
  assert.equal(clients,0);
});

test("invalid production configuration fails before client construction and never leaks its URL",async()=>{
  for(const env of [changed("STUDIO_DATABASE_AUTHORIZED","0"),changed("VERCEL_TARGET_ENV","preview"),changed("DATABASE_URL",`https://isolated:${PASSWORD}@db.example.invalid/studio`)]){
    let clients=0;
    await assert.rejects(runReleaseMigration(env,{createClient(){clients++;throw Error("Must not be called");}}),assertSanitized);
    assert.equal(clients,0);
  }
});

const SOURCE="10000000-0000-4000-8000-000000000001",TASK="10000000-0000-4000-8000-000000000002";
const OUTBOX="10000000-0000-4000-8000-000000000003",REQUEST="10000000-0000-4000-8000-000000000004";
const APPROVAL="10000000-0000-4000-8000-000000000005",ATTEMPT="10000000-0000-4000-8000-000000000006",CLAIM="10000000-0000-4000-8000-000000000007";
async function seedLegacy(instance:PGlite){
  await instance.query("INSERT INTO sources(id,text,category,reported_date,hash,cleared) VALUES($1,'Existing cleared source','user-reported-notes','2026-10-20','existing-source-hash',true)",[SOURCE]);
  await instance.query("INSERT INTO tasks(id,source_id,source_hash,status,checkpoint) VALUES($1,$2,'existing-source-hash','approved',6)",[TASK,SOURCE]);
  await instance.query("INSERT INTO publishing_outbox(id,request_id,task_id,source_id,source_hash,source_clearance_token,review_token,artifact_hash,variant_hash,platform,account_id,account_version,remote_id,payload,scheduled_at,version,status,provider_id,receipt) VALUES($1,$2,$3,$4,'existing-source-hash','clearance-v1','review-v1','artifact-hash','variant-hash','LinkedIn','existing-account','consent-v1','existing-remote','{\"text\":\"Existing approved draft\"}','2026-10-20T08:00:00Z','existing-approval-hash','approved','preserved-provider-id','{\"preserve\":true}')",[OUTBOX,REQUEST,TASK,SOURCE]);
  await instance.query("INSERT INTO publishing_requests(request_id,outbox_id,version) VALUES($1,$2,'existing-approval-hash')",[REQUEST,OUTBOX]);
  await instance.query("INSERT INTO publishing_approvals(id,outbox_id,version,acknowledgement) VALUES($1,$2,'existing-approval-hash','Existing exact approval acknowledgement')",[APPROVAL,OUTBOX]);
  await instance.query("INSERT INTO publishing_attempts(id,outbox_id,claim_token,stage,state,http_status,provider_id) VALUES($1,$2,$3,'existing-stage','received',201,'preserved-attempt-id')",[ATTEMPT,OUTBOX,CLAIM]);
}
async function fixture(work:(instance:PGlite)=>Promise<void>){
  const instance=new PGlite();
  try{assert(SCHEMA.includes(MANUAL_PUBLICATION_SCHEMA));await instance.exec(SCHEMA.slice(0,SCHEMA.indexOf(MANUAL_PUBLICATION_SCHEMA)));await work(instance);}
  finally{await instance.close();}
}
function transport(instance:PGlite,intercept?:(sql:string)=>void|Promise<void>){
  const sql:string[]=[];let connects=0,ends=0;let config:ClientConfig|undefined;
  const client:Client={on(){return this;},async connect(){connects++;},async query(statement){
    sql.push(statement);await intercept?.(statement);
    const results=await instance.exec(statement);return {rows:(results.at(-1)?.rows??[]) as Record<string,unknown>[]};
  },async end(){ends++;}};
  return {sql,client,createClient(options:ClientConfig){config=options;return client;},get config(){return config;},get connects(){return connects;},get ends(){return ends;}};
}
async function tableSnapshot(instance:PGlite){
  const tables=(await instance.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'schema_versions' ORDER BY table_name")).rows;
  const snapshot:Record<string,unknown>={};
  for(const {table_name} of tables){
    const expression=table_name==="publishing_outbox"?"to_jsonb(t)-'delivery_mode'":"to_jsonb(t)";
    snapshot[table_name]=(await instance.query(`SELECT ${expression} AS row FROM public."${table_name}" t ORDER BY ${expression}::text`)).rows;
  }
  return snapshot;
}

test("production hook runs only exact migration 020, preserves all legacy rows, and is idempotent",()=>fixture(async instance=>{
  await seedLegacy(instance);
  const before=await tableSnapshot(instance),beforeVersions=(await instance.query("SELECT * FROM schema_versions ORDER BY version")).rows;
  const beforeColumns=(await instance.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const mock=transport(instance);
  const result=await runReleaseMigration(PRODUCTION,{createClient:mock.createClient});
  assert.equal(result.status,"applied");assert.equal(mock.connects,1);assert.equal(mock.ends,1);
  assert.equal(mock.config?.connectionString,DATABASE_URL);
  assert(Number(mock.config?.connectionTimeoutMillis)>0&&Number(mock.config?.connectionTimeoutMillis)<=15000,"Connection establishment must be bounded");
  const migrationFile=await readFile(new URL("../migrations/020_manual_publication.sql",import.meta.url),"utf8");
  assert.equal(migrationFile.trim(),MANUAL_PUBLICATION_SCHEMA.trim());
  assert.equal(mock.sql.filter(sql=>sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim()).length,1);
  assert(!mock.sql.some(sql=>sql.includes("CREATE TABLE")||sql.includes("CREATE OR REPLACE")||sql.includes("DROP TABLE")),"The build hook must not replay broad bootstrap schema or repair tables");
  assert.deepEqual(await tableSnapshot(instance),before);
  assert.deepEqual((await instance.query("SELECT * FROM schema_versions WHERE version<>20 ORDER BY version")).rows,beforeVersions);
  assert.deepEqual((await instance.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND NOT(table_name='publishing_outbox' AND column_name='delivery_mode') ORDER BY table_name,ordinal_position")).rows,beforeColumns);
  assert.deepEqual((await instance.query("SELECT delivery_mode,version,status FROM publishing_outbox")).rows,[{delivery_mode:"scheduled",version:"existing-approval-hash",status:"approved"}]);
  const second=transport(instance);assert.equal((await runReleaseMigration(PRODUCTION,{createClient:second.createClient})).status,"applied");
  assert.deepEqual(await tableSnapshot(instance),before);
  assert.deepEqual((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows,[{version:20}]);
  assert.equal(second.ends,1);
  for(const mode of ["manual","scheduled"]){await instance.query("UPDATE publishing_outbox SET delivery_mode=$1 WHERE id=$2",[mode,OUTBOX]);}
  for(const mode of [null,"other",""]){await assert.rejects(instance.query("UPDATE publishing_outbox SET delivery_mode=$1 WHERE id=$2",[mode,OUTBOX]));}
}));

test("migration 020 is bracketed by transaction, bounded settings, advisory lock, readback and commit",()=>fixture(async instance=>{
  const mock=transport(instance);await runReleaseMigration(PRODUCTION,{createClient:mock.createClient});
  const statements=mock.sql.map(sql=>sql.trim());
  const begin=statements.findIndex(sql=>/^BEGIN\b/i.test(sql)),lock=statements.findIndex(sql=>/pg_advisory_xact_lock\(/i.test(sql));
  const migration=statements.findIndex(sql=>sql===MANUAL_PUBLICATION_SCHEMA.trim()),commit=statements.findIndex(sql=>/^COMMIT\b/i.test(sql));
  assert(begin>=0&&lock>begin&&migration>lock&&commit>migration);
  for(const setting of ["search_path","lock_timeout","statement_timeout","idle_in_transaction_session_timeout"]){
    assert(statements.slice(begin+1,lock).some(sql=>sql.includes(setting)),`${setting} must be set before taking the lock`);
  }
  assert(statements.slice(migration+1,commit).some(sql=>/pg_attribute|information_schema\.columns/i.test(sql)),"Verify the physical column before commit");
  assert(statements.slice(migration+1,commit).some(sql=>/schema_versions/i.test(sql)),"Verify marker 20 before commit");
  assert(!statements.some(sql=>/^ROLLBACK\b/i.test(sql)));
}));

test("a preexisting version 20 marker without delivery_mode still requires actual migration and catalog verification",()=>fixture(async instance=>{
  await seedLegacy(instance);await instance.exec("INSERT INTO schema_versions(version) VALUES(20)");
  const marker=(await instance.query("SELECT * FROM schema_versions WHERE version=20")).rows,before=await tableSnapshot(instance),mock=transport(instance);
  assert.equal((await instance.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='publishing_outbox' AND column_name='delivery_mode'")).rows.length,0);
  assert.equal((await runReleaseMigration(PRODUCTION,{createClient:mock.createClient})).status,"applied");
  assert.equal(mock.sql.filter(sql=>sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim()).length,1);
  assert(mock.sql.some(sql=>sql.includes("pg_attribute")),"The marker cannot substitute for physical catalog validation");
  assert.deepEqual((await instance.query("SELECT delivery_mode FROM publishing_outbox")).rows,[{delivery_mode:"scheduled"}]);
  assert.deepEqual((await instance.query("SELECT * FROM schema_versions WHERE version=20")).rows,marker);
  assert.deepEqual(await tableSnapshot(instance),before);assert.equal(mock.ends,1);
}));

test("a preexisting version 20 marker cannot make an incompatible delivery_mode pass validation",()=>fixture(async instance=>{
  await seedLegacy(instance);
  await instance.exec("ALTER TABLE publishing_outbox ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'manual' CHECK(delivery_mode IN ('scheduled','manual')); INSERT INTO schema_versions(version) VALUES(20)");
  const marker=(await instance.query("SELECT * FROM schema_versions WHERE version=20")).rows,before=await tableSnapshot(instance),mock=transport(instance);
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert.deepEqual((await instance.query("SELECT * FROM schema_versions WHERE version=20")).rows,marker);
  assert.deepEqual((await instance.query("SELECT delivery_mode FROM publishing_outbox")).rows,[{delivery_mode:"manual"}]);
  assert.deepEqual(await tableSnapshot(instance),before);
  assert(!mock.sql.some(sql=>/DROP\s|ALTER\s+COLUMN|UPDATE\s+publishing_outbox/i.test(sql)));
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert(!mock.sql.some(sql=>/^COMMIT\b/i.test(sql.trim())));assert.equal(mock.ends,1);
}));

for(const [name,definition] of [
  ["wrong type","INTEGER NOT NULL DEFAULT 0"],
  ["generated constant","TEXT GENERATED ALWAYS AS ('scheduled'::text) STORED NOT NULL CHECK(delivery_mode IN ('scheduled','manual'))"],
  ["nullable","TEXT DEFAULT 'scheduled' CHECK(delivery_mode IN ('scheduled','manual'))"],
  ["wrong default","TEXT NOT NULL DEFAULT 'manual' CHECK(delivery_mode IN ('scheduled','manual'))"],
  ["whitespace inside default literal","TEXT NOT NULL DEFAULT ' scheduled ' CHECK(delivery_mode IN ('scheduled','manual'))"],
  ["missing check","TEXT NOT NULL DEFAULT 'scheduled'"],
  ["permissive check","TEXT NOT NULL DEFAULT 'scheduled' CHECK(delivery_mode IN ('scheduled','manual','other'))"],
  ["whitespace inside check literal","TEXT NOT NULL DEFAULT 'scheduled' CHECK(delivery_mode IN ('scheduled','man ual'))"],
])test(`incompatible existing delivery_mode (${name}) fails without destructive repair`,()=>fixture(async instance=>{
  await seedLegacy(instance);
  if(name==="whitespace inside default literal"){
    await instance.exec("ALTER TABLE publishing_outbox ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK(delivery_mode IN ('scheduled','manual')); ALTER TABLE publishing_outbox ALTER COLUMN delivery_mode SET DEFAULT ' scheduled ';");
  }else await instance.exec(`ALTER TABLE publishing_outbox ADD COLUMN delivery_mode ${definition}`);
  const before=await tableSnapshot(instance),mock=transport(instance);
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert.deepEqual(await tableSnapshot(instance),before);
  assert.equal((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows.length,0);
  assert(!mock.sql.some(sql=>/DROP\s|ALTER\s+COLUMN|UPDATE\s+publishing_outbox/i.test(sql)),"Do not fix incompatible existing data or columns");
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert.equal(mock.ends,1);
}));

test("an unvalidated delivery_mode constraint cannot count as migration success",()=>fixture(async instance=>{
  await instance.exec("ALTER TABLE publishing_outbox ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'scheduled'; ALTER TABLE publishing_outbox ADD CONSTRAINT unvalidated_mode CHECK(delivery_mode IN ('scheduled','manual')) NOT VALID;");
  const mock=transport(instance);await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert.equal((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows.length,0);assert.equal(mock.ends,1);
}));

for(const missing of ["v19 marker","outbox table","version table"])test(`missing prerequisite ${missing} fails instead of bootstrapping`,()=>fixture(async instance=>{
  if(missing==="v19 marker")await instance.exec("DELETE FROM schema_versions WHERE version=19");
  if(missing==="outbox table")await instance.exec("DROP TABLE publishing_outbox CASCADE");
  if(missing==="version table")await instance.exec("DROP TABLE schema_versions");
  const mock=transport(instance);await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert(!mock.sql.some(sql=>sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim()),"Missing prerequisites must prevent the migration body");
  assert(!mock.sql.some(sql=>/CREATE TABLE/i.test(sql)));assert.equal(mock.ends,1);
}));

test("lock timeout aborts, rolls back and closes without applying migration or exposing driver data",()=>fixture(async instance=>{
  const mock=transport(instance,sql=>{if(/pg_advisory_xact_lock/.test(sql))throw Object.assign(Error(`RAW_DRIVER_DETAIL ${DATABASE_URL} SELECT private_secret`),{code:"55P03"});});
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert(!mock.sql.some(sql=>sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim()));
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert.equal(mock.ends,1);
  assert.equal((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows.length,0);
}));

test("statement timeout rolls back partial migration changes and does not leak driver data",()=>fixture(async instance=>{
  let applied=false;
  const mock=transport(instance,sql=>{if(applied&&!/^ROLLBACK/i.test(sql.trim()))throw Object.assign(Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`),{code:"57014"});if(sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim())applied=true;});
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert.equal((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows.length,0);
  assert.equal((await instance.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='publishing_outbox' AND column_name='delivery_mode'")).rows.length,0);
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert.equal(mock.ends,1);
}));

test("successful-looking migration with missing readback marker must roll back",()=>fixture(async instance=>{
  const mock=transport(instance);const original=mock.client.query;
  mock.client.query=async sql=>{
    const result=await original(sql);
    if(sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim())await instance.exec("DELETE FROM schema_versions WHERE version=20");
    return result;
  };
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert(!mock.sql.some(sql=>/^COMMIT\b/i.test(sql.trim())));assert.equal(mock.ends,1);
}));

function hangingClient(stage:"connect"|"query"|"end"){
  let ends=0;const never=new Promise<never>(()=>{});
  const client:Client={on(){return this;},async connect(){if(stage==="connect")await never;},async query(){if(stage==="query")await never;throw Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`);},async end(){ends++;if(stage==="end")await never;}};
  return {client,get ends(){return ends;}};
}
for(const stage of ["connect","query","end"] as const)test(`a stalled ${stage} is bounded and sanitized`,async()=>{
  const mock=hangingClient(stage),start=performance.now();
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:()=>mock.client,deadlineMs:40}),assertSanitized);
  assert(performance.now()-start<2500,"The test deadline and cleanup must be bounded");assert.equal(mock.ends,1);
});

test("client construction and connection failures are sanitized, and failed connects are closed",async()=>{
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient(){throw Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`);}}),assertSanitized);
  let ends=0,queries=0;
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:()=>({on(){return this;},async connect(){throw Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`);},async query(){queries++;return {rows:[]};},async end(){ends++;}})}),assertSanitized);
  assert.equal(queries,0);assert.equal(ends,1);
});

test("a migration promise resolving after the deadline cannot resume verification or commit",async()=>{
  let release!:(value:{rows:Record<string,unknown>[]})=>void;let ends=0;
  const pending=new Promise<{rows:Record<string,unknown>[]}>(resolve=>{release=resolve;});const sql:string[]=[];
  const client:Client={on(){return this;},async connect(){},async query(statement){
    sql.push(statement);
    if(statement.trim()===MANUAL_PUBLICATION_SCHEMA.trim())return pending;
    if(statement.includes("AS has_v19"))return {rows:[{has_v19:true,outbox_kind:"r"}]};
    return {rows:[]};
  },async end(){ends++;}};
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:()=>client,deadlineMs:50}),assertSanitized);
  const countAtFailure=sql.length;release({rows:[]});await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(sql.length,countAtFailure,"Late driver completion must not schedule more SQL");
  assert(sql.some(statement=>statement.trim()===MANUAL_PUBLICATION_SCHEMA.trim()));
  assert(sql.some(statement=>/^ROLLBACK\b/i.test(statement.trim())));
  assert(!sql.some(statement=>/^COMMIT\b/i.test(statement.trim())));assert.equal(ends,1);
});

test("rollback and cleanup remain bounded even when both transports stop responding",async()=>{
  const never=new Promise<never>(()=>{});let ends=0;let rollback=false;
  const client:Client={on(){return this;},async connect(){},async query(sql){
    if(sql==="BEGIN")return {rows:[]};
    if(sql==="ROLLBACK"){rollback=true;return never;}
    throw Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`);
  },async end(){ends++;return never;}};
  const start=performance.now();
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:()=>client,deadlineMs:50}),assertSanitized);
  assert(performance.now()-start<RELEASE_MIGRATION_LIMITS.cleanup*2+1000);
  assert(rollback);assert.equal(ends,1);
});

test("an idle client error is caught and sanitized before any further SQL can commit",()=>fixture(async instance=>{
  const events=new EventEmitter(),mock=transport(instance);const originalQuery=mock.client.query,originalConnect=mock.client.connect;
  let registeredBeforeConnect=false,emittedNormally=false;
  mock.client.on=(event,listener)=>events.on(event,listener);
  mock.client.connect=async()=>{registeredBeforeConnect=events.listenerCount("error")>0;await originalConnect();};
  mock.client.query=async sql=>{
    const result=await originalQuery(sql);
    if(sql.trim()===MANUAL_PUBLICATION_SCHEMA.trim()){
      events.emit("error",Error(`RAW_DRIVER_DETAIL ${DATABASE_URL}`));emittedNormally=true;
    }
    return result;
  };
  await assert.rejects(runReleaseMigration(PRODUCTION,{createClient:mock.createClient}),assertSanitized);
  assert(registeredBeforeConnect,"Idle errors must have a listener before connect starts");
  assert(emittedNormally,"The error event must be consumed rather than throw into the query rejection path");
  assert(mock.sql.some(sql=>/^ROLLBACK\b/i.test(sql.trim())));assert(!mock.sql.some(sql=>/^COMMIT\b/i.test(sql.trim())));
  assert.equal(mock.ends,1);assert.equal((await instance.query("SELECT version FROM schema_versions WHERE version=20")).rows.length,0);
}));

test("both package and Vercel build configuration gate Next.js behind migration success",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  const cli=await readFile(new URL("../scripts/release-migration.ts",import.meta.url),"utf8");
  assert.equal(manifest.scripts.build,"node --import tsx scripts/release-migration.ts && next build");
  assert.equal(manifest.scripts["build:vercel"],"node --import tsx scripts/release-migration.ts --vercel-build && next build");
  assert.equal(vercel.buildCommand,"npm run build:vercel");
  assert.match(cli,/runReleaseMigration\(process\.env,/);
  assert.match(cli,/vercelBuild:args\[0\]==="--vercel-build"/);
  assert.match(cli,/args\.some\(arg=>arg!=="--vercel-build"\)\|\|args\.length>1/);
  assert.match(cli,/process\.exit\(1\)/,"A failed release must stop before Next.js and abandon lingering driver handles");
  assert(!cli.includes("scripts/migrate"));assert(!cli.includes("DATABASE_URL"),"CLI logging must not expose database configuration");
});
