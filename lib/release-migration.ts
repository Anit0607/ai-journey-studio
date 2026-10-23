import {Client, type ClientConfig} from "pg";
import {performance} from "node:perf_hooks";
import {MANUAL_PUBLICATION_SCHEMA} from "./manual-publication-schema";

type Environment=Record<string,string|undefined>;
export type ReleaseMigrationDecision="apply"|"skip-local"|"skip-test"|"skip-nonproduction";
export class ReleaseMigrationError extends Error {
  constructor(message:string){super(message);this.name="ReleaseMigrationError";}
}
const denied=(message:string):never=>{throw new ReleaseMigrationError(message);};

// Build-only policy. Neither deployment markers nor a preview's inherited URL
// establish permission to change a production database from a preview build.
export function releaseMigrationDecision(env:Environment,vercelBuild=false):ReleaseMigrationDecision {
  const hosted=["VERCEL","VERCEL_ENV","VERCEL_TARGET_ENV","VERCEL_URL"].some(key=>env[key]!==undefined);
  if(!hosted&&!vercelBuild)return env.NODE_ENV==="test"?"skip-test":"skip-local";
  const production=env.VERCEL_ENV==="production"||env.VERCEL_TARGET_ENV==="production";
  if(!production&&env.VERCEL==="1"&&
    ((env.VERCEL_ENV==="preview"&&!!env.VERCEL_TARGET_ENV)||
     (env.VERCEL_ENV==="development"&&env.VERCEL_TARGET_ENV==="development")))return "skip-nonproduction";
  if(env.VERCEL!=="1"||env.CI!=="1"||env.VERCEL_ENV!=="production"||env.VERCEL_TARGET_ENV!=="production"||env.NODE_ENV==="test")
    return denied("Migration 020 blocked: verify Vercel production build markers (VERCEL, CI, VERCEL_ENV and VERCEL_TARGET_ENV); no database connection was opened.");
  if(env.STUDIO_DATABASE_AUTHORIZED!=="1"||env.STUDIO_LOCAL_DB==="1"||!env.DATABASE_URL)
    return denied("Migration 020 blocked: an existing authorized production database is required; no database connection was opened.");
  try {
    const url=new URL(env.DATABASE_URL);
    if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||!url.pathname.slice(1)||
      /[\s/\\]/.test(decodeURIComponent(url.hostname))||
      url.searchParams.getAll("host").some(host=>!host||/[\s/\\]/.test(decodeURIComponent(host))))throw Error();
  }catch{return denied("Migration 020 blocked: the configured database must be a valid network PostgreSQL target; no database connection was opened.");}
  return "apply";
}

export interface ReleaseMigrationClient {
  on(event:"error",listener:()=>void):unknown;
  connect():Promise<unknown>;
  query(sql:string):Promise<{rows:Record<string,unknown>[]} | {rows:Record<string,unknown>[]}[]>;
  end():Promise<void>;
}
export interface ReleaseMigrationDependencies {
  createClient?:(config:ClientConfig)=>ReleaseMigrationClient;
  /** Build context only, never authorization. Requires exact production gates. */
  vercelBuild?:boolean;
  /** Test seam only; the CLI never accepts a timeout override. */
  deadlineMs?:number;
}
export const RELEASE_MIGRATION_LIMITS={connect:5000,lock:5000,statement:15000,query:20000,idle:15000,total:60000,cleanup:2000} as const;

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
 WHERE a.attrelid='public.publishing_outbox'::regclass AND a.attname='delivery_mode' AND NOT a.attisdropped`;
const CHECK_SQL=`SELECT c.convalidated AS validated,pg_catalog.pg_get_expr(c.conbin,c.conrelid) AS expression
 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='delivery_mode'
 WHERE c.conrelid='public.publishing_outbox'::regclass AND c.contype='c' AND c.conkey=ARRAY[a.attnum]`;
// Ignore formatting whitespace only, never whitespace inside enum literals.
const EXPECTED_CHECK=/^\(\s*delivery_mode\s*=\s*ANY\s*\(\s*ARRAY\s*\[\s*'scheduled'::text\s*,\s*'manual'::text\s*\]\s*\)\s*\)$/;

/** Apply only the reviewed additive migration 020, never historical bootstrap. */
export async function runReleaseMigration(env:Environment,deps:ReleaseMigrationDependencies={}):Promise<{status:"applied"|"skipped";message:string}>{
  const decision=releaseMigrationDecision(env,deps.vercelBuild);
  if(decision!=="apply")return {status:"skipped",message:decision==="skip-nonproduction"?
    "Migration 020 skipped: non-production build; preview database isolation has not been established.":
    "Migration 020 skipped: local/test build; no database connection opened."};
  let client:ReleaseMigrationClient|undefined,transaction=false,connectionFailed=false,stage="connection",failure:ReleaseMigrationError|undefined;
  const deadline=performance.now()+(deps.deadlineMs??RELEASE_MIGRATION_LIMITS.total);
  const remaining=()=>{const time=deadline-performance.now();if(connectionFailed||time<=0)throw Error("connection unavailable");return time;};
  try {
    client=(deps.createClient||(config=>new Client(config)))({connectionString:env.DATABASE_URL,
      connectionTimeoutMillis:RELEASE_MIGRATION_LIMITS.connect,query_timeout:RELEASE_MIGRATION_LIMITS.query,
      statement_timeout:RELEASE_MIGRATION_LIMITS.statement,lock_timeout:RELEASE_MIGRATION_LIMITS.lock,
      idle_in_transaction_session_timeout:RELEASE_MIGRATION_LIMITS.idle,application_name:"studio-migration-020"});
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
    stage="migration lock";await query("SELECT pg_catalog.pg_advisory_xact_lock(13141516,20)");
    stage="existing schema prerequisite";
    const prior=(await query(`SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=19) AS has_v19,
      (SELECT relkind::text FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.publishing_outbox')) AS outbox_kind`))[0];
    if(prior?.has_v19!==true||prior?.outbox_kind!=="r")throw Error("prerequisite");
    // Bound table-lock contention too, and keep catalog validation and DDL in
    // one locked transaction. Concurrent builds share the advisory lock above.
    await query("LOCK TABLE public.publishing_outbox IN ACCESS EXCLUSIVE MODE");
    stage="additive schema change";await query(MANUAL_PUBLICATION_SCHEMA);
    stage="schema verification";
    const column=(await query(COLUMN_SQL))[0],checks=await query(CHECK_SQL);
    const version=(await query("SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=20) AS applied"))[0];
    if(column?.is_text!==true||column?.not_null!==true||column?.writable!==true||column?.default_collation!==true||column?.default_expression!=="'scheduled'::text"||
      !checks.some(check=>check.validated===true&&typeof check.expression==="string"&&EXPECTED_CHECK.test(check.expression))||version?.applied!==true)throw Error("verification");
    stage="commit";await query("COMMIT");transaction=false;
  }catch{
    // Never include driver errors, query data, URLs or a nested cause in logs.
    failure=new ReleaseMigrationError(`Migration 020 failed during ${stage}; production build stopped. Inspect schema state before another release; no automatic retry was attempted.`);
    if(client&&transaction){try{await bounded(client.query("ROLLBACK"),RELEASE_MIGRATION_LIMITS.cleanup);}catch{/* Closing the connection aborts any uncommitted transaction. */}}
  }finally{
    if(client){try{await bounded(client.end(),RELEASE_MIGRATION_LIMITS.cleanup);}catch{failure||=new ReleaseMigrationError("Migration 020 connection cleanup was not confirmed; production build stopped. Inspect schema state before another release.");}}
  }
  if(connectionFailed)failure||=new ReleaseMigrationError("Migration 020 connection failure; production build stopped. Inspect schema state before another release.");
  if(failure)throw failure;
  return {status:"applied",message:"Migration 020 verified and committed: delivery_mode text NOT NULL, scheduled default, validated scheduled/manual constraint, schema version 20. Publishing settings unchanged."};
}
