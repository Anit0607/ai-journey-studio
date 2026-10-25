import {Client} from 'pg';
import {performance} from 'node:perf_hooks';
import {ASSISTANT_WORDING_SCHEMA} from './assistant-wording-schema';
import {releaseMigrationDecision,ReleaseMigrationError,RELEASE_MIGRATION_LIMITS,type ReleaseMigrationClient,type ReleaseMigrationDependencies} from './release-migration';

export const ASSISTANT_WORDING_CATALOG_SQL={
 actor:`SELECT a.atttypid='pg_catalog.text'::regtype AS is_text,a.attnotnull AS not_null,a.attgenerated='' AND a.attidentity='' AS writable,
 a.attcollation=(SELECT typcollation FROM pg_catalog.pg_type WHERE oid='pg_catalog.text'::regtype) AS default_collation,
 pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,c.relkind,c.relrowsecurity,c.relpersistence
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.evidence_decisions'::regclass AND a.attname='actor' AND NOT a.attisdropped`,
 checks:`SELECT c.conname,c.convalidated,pg_catalog.pg_get_expr(c.conbin,c.conrelid) AS expression,c.conkey=ARRAY[a.attnum] AS only_actor
 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='actor'
 WHERE c.conrelid='public.evidence_decisions'::regclass AND c.contype='c' AND a.attnum=ANY(c.conkey)`,
 triggers:`SELECT t.tgname,c.relname,c.relkind,c.relrowsecurity,c.relpersistence,t.tgtype,t.tgenabled,t.tgisinternal,t.tgqual IS NULL AS no_condition,t.tgnargs,t.tgattr::text AS attributes,
 p.oid='public.studio_evidence_immutable()'::regprocedure AS correct_function,p.prorettype='pg_catalog.trigger'::regtype AS trigger_result,
 p.prosecdef,p.pronargs,p.proconfig,p.provolatile,p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AS plpgsql,p.prosrc
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 WHERE (t.tgrelid='public.evidence_decisions'::regclass AND t.tgname='evidence_decision_immutable') OR (t.tgrelid='public.evidence_approval_receipts'::regclass AND t.tgname='evidence_receipt_immutable')`
};
type Catalog=Record<keyof typeof ASSISTANT_WORDING_CATALOG_SQL,Record<string,unknown>[]>;
const OWNER="(actor = 'owner'::text)",ASSISTANT="(actor = ANY (ARRAY['owner'::text, 'assistant'::text]))";
export function verifyAssistantWordingCatalog(catalog:Catalog,phase:'before'|'after'){
 const a=catalog.actor[0],check=catalog.checks[0];
 return catalog.actor.length===1&&a.is_text===true&&a.not_null===true&&a.writable===true&&a.default_collation===true&&a.default_expression===null&&a.relkind==='r'&&a.relrowsecurity===false&&a.relpersistence==='p'&&
  catalog.checks.length===1&&check.conname==='evidence_decisions_actor_check'&&check.convalidated===true&&check.only_actor===true&&(check.expression===ASSISTANT||(phase==='before'&&check.expression===OWNER))&&
  catalog.triggers.length===2&&[['evidence_decisions','evidence_decision_immutable'],['evidence_approval_receipts','evidence_receipt_immutable']].every(([table,name])=>catalog.triggers.some(t=>t.relname===table&&t.tgname===name&&t.relkind==='r'&&t.relrowsecurity===false&&t.relpersistence==='p'&&t.tgtype===27&&t.tgenabled==='O'&&t.tgisinternal===false&&t.no_condition===true&&t.tgnargs===0&&t.attributes===''&&t.correct_function===true&&t.trigger_result===true&&t.prosecdef===false&&t.pronargs===0&&t.proconfig===null&&t.provolatile==='v'&&t.plpgsql===true&&typeof t.prosrc==='string'&&t.prosrc.replace(/\s+/g,' ').trim()==="BEGIN RAISE EXCEPTION 'Evidence audit records are immutable'; END;"));
}
async function bounded<T>(work:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}
/** Apply only migration 023 under the existing reviewed production-only migration authority. */
export async function runAssistantWordingReleaseMigration(env:Record<string,string|undefined>,deps:ReleaseMigrationDependencies={}){
 const decision=releaseMigrationDecision(env,deps.vercelBuild);if(decision!=='apply')return {status:'skipped' as const,message:'Migration 023 skipped outside authorized production; no database connection opened.'};
 let client:ReleaseMigrationClient|undefined,transaction=false,failed=false,stage='connection',error:ReleaseMigrationError|undefined;
 const deadline=performance.now()+(deps.deadlineMs??RELEASE_MIGRATION_LIMITS.total);
 const remaining=()=>{const ms=deadline-performance.now();if(failed||ms<=0)throw Error('unavailable');return ms;};
 try{
  client=(deps.createClient||(config=>new Client(config)))({connectionString:env.DATABASE_URL,connectionTimeoutMillis:RELEASE_MIGRATION_LIMITS.connect,query_timeout:RELEASE_MIGRATION_LIMITS.query,statement_timeout:RELEASE_MIGRATION_LIMITS.statement,lock_timeout:RELEASE_MIGRATION_LIMITS.lock,idle_in_transaction_session_timeout:RELEASE_MIGRATION_LIMITS.idle,application_name:'studio-migration-023'});
  client.on('error',()=>{failed=true;});await bounded(client.connect(),Math.min(remaining(),RELEASE_MIGRATION_LIMITS.connect));
  const query=async(sql:string)=>{const value=await bounded(client!.query(sql),Math.min(remaining(),RELEASE_MIGRATION_LIMITS.query));if(failed)throw Error('unavailable');return Array.isArray(value)?value.at(-1)?.rows||[]:value.rows;};
  const catalog=async()=>{const result={} as Catalog;for(const key of Object.keys(ASSISTANT_WORDING_CATALOG_SQL) as (keyof Catalog)[])result[key]=await query(ASSISTANT_WORDING_CATALOG_SQL[key]);return result;};
  stage='transaction';await query('BEGIN');transaction=true;
  await query('SET LOCAL search_path = pg_catalog, public, pg_temp');await query("SET LOCAL lock_timeout = '5s'");await query("SET LOCAL statement_timeout = '15s'");await query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
  stage='migration lock';await query('SELECT pg_catalog.pg_advisory_xact_lock(13141516,23)');
  stage='existing schema prerequisite';const prior=(await query('SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=22) AS has_v22'))[0];if(prior?.has_v22!==true)throw Error('prerequisite');
  await query('LOCK TABLE public.evidence_decisions, public.evidence_approval_receipts IN ACCESS EXCLUSIVE MODE');
  if(!verifyAssistantWordingCatalog(await catalog(),'before'))throw Error('existing schema');
  stage='additive actor constraint change';await query(ASSISTANT_WORDING_SCHEMA);
  stage='schema verification';if(!verifyAssistantWordingCatalog(await catalog(),'after')||(await query('SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=23) AS applied'))[0]?.applied!==true)throw Error('verification');
  stage='commit';await query('COMMIT');transaction=false;
 }catch{
  error=new ReleaseMigrationError(`Migration 023 failed during ${stage}; production build stopped. Inspect schema state before another release; no automatic retry was attempted.`);
  if(client&&transaction)try{await bounded(client.query('ROLLBACK'),RELEASE_MIGRATION_LIMITS.cleanup);}catch{}
 }finally{if(client)try{await bounded(client.end(),RELEASE_MIGRATION_LIMITS.cleanup);}catch{error||=new ReleaseMigrationError('Migration 023 connection cleanup was not confirmed; production build stopped.');}}
 if(failed)error||=new ReleaseMigrationError('Migration 023 connection failure; production build stopped.');if(error)throw error;
 return {status:'applied' as const,message:'Migration 023 verified and committed: owner/assistant reviewer actors permitted. Historical evidence, immutable triggers, approvals, grants and publication settings unchanged.'};
}
