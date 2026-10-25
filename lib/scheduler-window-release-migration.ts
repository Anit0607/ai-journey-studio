import {Client} from 'pg';
import {performance} from 'node:perf_hooks';
import {SCHEDULER_WINDOW_SCHEMA} from './scheduler-window-schema';
import {releaseMigrationDecision,ReleaseMigrationError,RELEASE_MIGRATION_LIMITS,type ReleaseMigrationClient,type ReleaseMigrationDependencies} from './release-migration';
type Environment=Record<string,string|undefined>;

async function bounded<T>(work:Promise<T>,milliseconds:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("deadline")),Math.max(1,milliseconds));})]);}
  finally{clearTimeout(timer);}
}
function rows(result:Awaited<ReturnType<ReleaseMigrationClient["query"]>>):Record<string,unknown>[] {
  if(Array.isArray(result))return result.at(-1)?.rows||[];
  return result.rows;
}
const COLUMN_SQL=`SELECT a.atttypid='pg_catalog.text'::regtype AS is_text,a.attnotnull AS not_null,
 a.attgenerated='' AND a.attidentity='' AS writable,
 a.attcollation=(SELECT typcollation FROM pg_catalog.pg_type WHERE oid='pg_catalog.text'::regtype) AS default_collation,
 pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM pg_catalog.pg_attribute a
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.publishing_outbox'::regclass AND a.attname='scheduler_policy_hash' AND NOT a.attisdropped`;
const CHECK_SQL=`SELECT c.convalidated AS validated,pg_catalog.pg_get_expr(c.conbin,c.conrelid) AS expression
 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='scheduler_policy_hash'
 WHERE c.conrelid='public.publishing_outbox'::regclass AND c.contype='c' AND c.conkey=ARRAY[a.attnum]`;
// Ignore formatting whitespace only, never whitespace inside enum literals.
const EXPECTED_CHECK=/^\(\s*\(scheduler_policy_hash IS NULL\)\s+OR\s+\(scheduler_policy_hash ~ '\^\[0-9a-f\]\{64\}\$'::text\)\s*\)$/;
export function verifySchedulerWindowColumn(column:Record<string,unknown>|undefined,checks:Record<string,unknown>[]){
 return column?.is_text===true&&column?.not_null===false&&column?.writable===true&&column?.default_collation===true&&column?.default_expression===null&&checks.some(check=>check.validated===true&&typeof check.expression==='string'&&EXPECTED_CHECK.test(check.expression));
}

/** Apply only the reviewed additive migration 022, never historical bootstrap. */
export async function runSchedulerWindowReleaseMigration(env:Environment,deps:ReleaseMigrationDependencies={}):Promise<{status:"applied"|"skipped";message:string}>{
  const decision=releaseMigrationDecision(env,deps.vercelBuild);
  if(decision!=="apply")return {status:"skipped",message:decision==="skip-nonproduction"?
    "Migration 022 skipped: non-production build; preview database isolation has not been established.":
    "Migration 022 skipped: local/test build; no database connection opened."};
  let client:ReleaseMigrationClient|undefined,transaction=false,connectionFailed=false,stage="connection",failure:ReleaseMigrationError|undefined;
  const deadline=performance.now()+(deps.deadlineMs??RELEASE_MIGRATION_LIMITS.total);
  const remaining=()=>{const time=deadline-performance.now();if(connectionFailed||time<=0)throw Error("connection unavailable");return time;};
  try {
    client=(deps.createClient||(config=>new Client(config)))({connectionString:env.DATABASE_URL,
      connectionTimeoutMillis:RELEASE_MIGRATION_LIMITS.connect,query_timeout:RELEASE_MIGRATION_LIMITS.query,
      statement_timeout:RELEASE_MIGRATION_LIMITS.statement,lock_timeout:RELEASE_MIGRATION_LIMITS.lock,
      idle_in_transaction_session_timeout:RELEASE_MIGRATION_LIMITS.idle,application_name:"studio-migration-022"});
    // pg can emit an idle socket error independently of any query promise.
    // Consume it before connecting, retain no payload, and stop later steps.
    client.on("error",()=>{connectionFailed=true;});
    await bounded(client.connect(),Math.min(remaining(),RELEASE_MIGRATION_LIMITS.connect));
    const query=async(sql:string)=>{const time=remaining();const result=await bounded(client!.query(sql),Math.min(time,RELEASE_MIGRATION_LIMITS.query));if(connectionFailed)throw Error("connection unavailable");return rows(result);};
    stage="transaction";await query("BEGIN");transaction=true;
    await query("SET LOCAL search_path = pg_catalog, public, pg_temp");
    await query("SET LOCAL lock_timeout = '5s'");
    await query("SET LOCAL statement_timeout = '15s'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    stage="migration lock";await query("SELECT pg_catalog.pg_advisory_xact_lock(13141516,22)");
    stage="existing schema prerequisite";
    const prior=(await query(`SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=21) AS has_v21,
      (SELECT relkind::text FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.publishing_outbox')) AS outbox_kind`))[0];
    if(prior?.has_v21!==true||prior?.outbox_kind!=="r")throw Error("prerequisite");
    // Bound table-lock contention too, and keep catalog validation and DDL in
    // one locked transaction. Concurrent builds share the advisory lock above.
    await query("LOCK TABLE public.publishing_outbox IN ACCESS EXCLUSIVE MODE");
    stage="additive schema change";await query(SCHEDULER_WINDOW_SCHEMA);
    stage="schema verification";
    const column=(await query(COLUMN_SQL))[0],checks=await query(CHECK_SQL);
    const version=(await query("SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=22) AS applied"))[0];
    if(!verifySchedulerWindowColumn(column,checks)||version?.applied!==true)throw Error("verification");
    stage="commit";await query("COMMIT");transaction=false;
  }catch{
    // Never include driver errors, query data, URLs or a nested cause in logs.
    failure=new ReleaseMigrationError(`Migration 022 failed during ${stage}; production build stopped. Inspect schema state before another release; no automatic retry was attempted.`);
    if(client&&transaction){try{await bounded(client.query("ROLLBACK"),RELEASE_MIGRATION_LIMITS.cleanup);}catch{/* Closing the connection aborts any uncommitted transaction. */}}
  }finally{
    if(client){try{await bounded(client.end(),RELEASE_MIGRATION_LIMITS.cleanup);}catch{failure||=new ReleaseMigrationError("Migration 022 connection cleanup was not confirmed; production build stopped. Inspect schema state before another release.");}}
  }
  if(connectionFailed)failure||=new ReleaseMigrationError("Migration 022 connection failure; production build stopped. Inspect schema state before another release.");
  if(failure)throw failure;
  return {status:"applied",message:"Migration 022 verified and committed: nullable scheduler policy hash, validated SHA-256 constraint, schema version 22. No existing approvals or settings were changed."};
}
