import {Client,type ClientConfig} from 'pg';
import {performance} from 'node:perf_hooks';
import {releaseMigrationDecision,ReleaseMigrationError,RELEASE_MIGRATION_LIMITS,type ReleaseMigrationClient,type ReleaseMigrationDependencies} from './release-migration';
import {GITHUB_SOURCE_POLICY_SCHEMA} from './github-source-policy-schema';

const TABLES=['github_source_policy_previews','github_source_policies','github_source_grants'];
const expectedColumns:Record<string,Record<string,[string,boolean,string|null]>>={
 github_source_policy_previews:{id:['uuid',true,null],owner_id:['text',true,null],session_id:['text',true,null],scope:['jsonb',true,null],scope_hash:['text',true,null],runtime_binding:['text',true,null],preview_hash:['text',true,null],expires_at:['timestamptz',true,null],consumed_at:['timestamptz',false,null],created:['timestamptz',true,'now()']},
 github_source_policies:{id:['uuid',true,null],scope:['jsonb',true,null],scope_hash:['text',true,null],runtime_binding:['text',true,null],receipt_id:['uuid',true,null],active:['bool',true,'false'],created:['timestamptz',true,'now()'],revoked_at:['timestamptz',false,null]},
 github_source_grants:{id:['uuid',true,null],policy_id:['uuid',true,null],policy_hash:['text',true,null],provenance_id:['uuid',true,null],provenance_hash:['text',true,null],source_id:['uuid',true,null],source_hash:['text',true,null],evidence_key:['text',true,null],entry_id:['uuid',true,null],task_id:['uuid',false,null],created:['timestamptz',true,'now()']}
};
const expectedForeignKeys=[['github_source_policies','id','github_source_policy_previews'],['github_source_policies','receipt_id','events'],['github_source_grants','id','events'],['github_source_grants','policy_id','github_source_policies'],['github_source_grants','provenance_id','source_provenance'],['github_source_grants','source_id','sources'],['github_source_grants','entry_id','calendar_entries'],['github_source_grants','task_id','tasks']];
const expectedUnique=[['github_source_policy_previews','id'],['github_source_policies','id'],['github_source_policies','receipt_id'],['github_source_grants','id'],['github_source_grants','source_id'],['github_source_grants','evidence_key'],['github_source_grants','entry_id'],['github_source_grants','task_id']];
const names=TABLES.map(t=>`'${t}'`).join(',');
export const GITHUB_POLICY_CATALOG_SQL={
 tables:`SELECT c.relname,c.relkind,c.relrowsecurity,c.relpersistence FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names})`,
 columns:`SELECT c.relname,a.attname,t.typname,t.typnamespace='pg_catalog'::regnamespace AS builtin_type,a.attcollation=t.typcollation AS default_collation,a.attnotnull,a.attgenerated,a.attidentity,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname IN (${names}) AND a.attnum>0 AND NOT a.attisdropped`,
 foreign_keys:`SELECT c.relname,a.attname,ref.relname AS target,ref.relnamespace='public'::regnamespace AS public_target,ra.attname AS target_column,k.convalidated,k.condeferrable,k.confdeltype,k.confupdtype FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class ref ON ref.oid=k.confrelid JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND k.conkey=ARRAY[a.attnum] JOIN pg_catalog.pg_attribute ra ON ra.attrelid=ref.oid AND k.confkey=ARRAY[ra.attnum] WHERE n.nspname='public' AND c.relname IN (${names}) AND k.contype='f'`,
 indexes:`SELECT c.relname,a.attname,i.indisunique,i.indisvalid,i.indisprimary,i.indimmediate,pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND i.indkey::text=a.attnum::text WHERE n.nspname='public' AND c.relname IN (${names}) AND i.indexprs IS NULL`,
 checks:`SELECT c.relname,k.convalidated,pg_catalog.pg_get_expr(k.conbin,k.conrelid) AS expression FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names}) AND k.contype='c'`
};
export function verifyGithubPolicyCatalog(catalog:Record<keyof typeof GITHUB_POLICY_CATALOG_SQL,Record<string,unknown>[]>){
 if(catalog.tables.length!==3||TABLES.some(name=>!catalog.tables.some(t=>t.relname===name&&t.relkind==='r'&&t.relrowsecurity===false&&t.relpersistence==='p')))return false;
 const expected=Object.entries(expectedColumns).flatMap(([table,columns])=>Object.entries(columns).map(([column,definition])=>({table,column,definition})));
 if(catalog.columns.length!==expected.length||expected.some(({table,column,definition:[type,required,defaultValue]})=>!catalog.columns.some(c=>c.relname===table&&c.attname===column&&c.typname===type&&c.builtin_type===true&&c.default_collation===true&&c.attnotnull===required&&c.attgenerated===''&&c.attidentity===''&&c.default_expression===defaultValue)))return false;
 if(catalog.foreign_keys.length!==expectedForeignKeys.length||expectedForeignKeys.some(([table,column,target])=>!catalog.foreign_keys.some(f=>f.relname===table&&f.attname===column&&f.target===target&&f.public_target===true&&f.target_column==='id'&&f.convalidated===true&&f.condeferrable===false&&f.confdeltype==='a'&&f.confupdtype==='a')))return false;
 if(expectedUnique.some(([table,column])=>!catalog.indexes.some(i=>i.relname===table&&i.attname===column&&i.indisunique===true&&i.indisvalid===true&&i.indimmediate===true&&i.predicate===null&&(column!=='id'||i.indisprimary===true))))return false;
 if(!catalog.indexes.some(i=>i.relname==='github_source_policies'&&i.attname==='active'&&i.indisunique===true&&i.indisvalid===true&&i.indimmediate===true&&i.predicate==='active'))return false;
 return catalog.checks.some(c=>c.relname==='github_source_policies'&&c.convalidated===true&&typeof c.expression==='string'&&c.expression.replace(/[()\s]/g,'')==='NOTactiveORrevoked_atISNULL');
}
async function bounded<T>(promise:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}
/** Separate additive transaction after the existing independently verified 020 step. */
export async function runGithubSourceReleaseMigration(env:Record<string,string|undefined>,deps:ReleaseMigrationDependencies={}){
 const decision=releaseMigrationDecision(env,deps.vercelBuild);if(decision!=='apply')return {status:'skipped' as const,message:'Migration 021 skipped outside authorized production; no database connection opened.'};
 let client:ReleaseMigrationClient|undefined,transaction=false,failed=false,stage='connection',error:ReleaseMigrationError|undefined;
 const end=performance.now()+(deps.deadlineMs??RELEASE_MIGRATION_LIMITS.total);
 const remaining=()=>{const ms=end-performance.now();if(failed||ms<=0)throw Error('unavailable');return ms;};
 try{
  client=(deps.createClient||((options:ClientConfig)=>new Client(options)))({connectionString:env.DATABASE_URL,connectionTimeoutMillis:RELEASE_MIGRATION_LIMITS.connect,query_timeout:RELEASE_MIGRATION_LIMITS.query,statement_timeout:RELEASE_MIGRATION_LIMITS.statement,lock_timeout:RELEASE_MIGRATION_LIMITS.lock,idle_in_transaction_session_timeout:RELEASE_MIGRATION_LIMITS.idle,application_name:'studio-migration-021'});
  client.on('error',()=>{failed=true;});const connectTime=remaining();await bounded(client.connect(),Math.min(connectTime,RELEASE_MIGRATION_LIMITS.connect));
  const query=async(sql:string)=>{const time=remaining();const value=await bounded(client!.query(sql),Math.min(time,RELEASE_MIGRATION_LIMITS.query));if(failed)throw Error('unavailable');return Array.isArray(value)?value.at(-1)?.rows||[]:value.rows;};
  stage='transaction';await query('BEGIN');transaction=true;
  await query('SET LOCAL search_path = pg_catalog, public, pg_temp');await query("SET LOCAL lock_timeout = '5s'");await query("SET LOCAL statement_timeout = '15s'");await query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
  stage='migration lock';await query('SELECT pg_catalog.pg_advisory_xact_lock(13141516,21)');
  stage='existing schema prerequisite';const prior=(await query("SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=20) AS has_v20, (SELECT relkind::text FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.source_provenance')) AS provenance_kind, (SELECT relkind::text FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.calendar_entries')) AS calendar_kind"))[0];
  if(prior?.has_v20!==true||prior.provenance_kind!=='r'||prior.calendar_kind!=='r')throw Error('prerequisite');
  stage='additive schema change';await query(GITHUB_SOURCE_POLICY_SCHEMA);
  // Lock only these new policy tables while validating, never rewrite legacy rows.
  await query('LOCK TABLE public.github_source_policy_previews, public.github_source_policies, public.github_source_grants IN SHARE MODE');
  stage='schema verification';const catalog={} as Record<keyof typeof GITHUB_POLICY_CATALOG_SQL,Record<string,unknown>[]>;
  for(const key of Object.keys(GITHUB_POLICY_CATALOG_SQL) as (keyof typeof GITHUB_POLICY_CATALOG_SQL)[])catalog[key]=await query(GITHUB_POLICY_CATALOG_SQL[key]);
  const version=(await query('SELECT EXISTS(SELECT 1 FROM public.schema_versions WHERE version=21) AS applied'))[0];if(!verifyGithubPolicyCatalog(catalog)||version?.applied!==true)throw Error('verification');
  stage='commit';await query('COMMIT');transaction=false;
 }catch{
  error=new ReleaseMigrationError(`Migration 021 failed during ${stage}; production build stopped. Inspect schema state before another release; no automatic retry was attempted.`);
  if(client&&transaction)try{await bounded(client.query('ROLLBACK'),RELEASE_MIGRATION_LIMITS.cleanup);}catch{}
 }finally{if(client)try{await bounded(client.end(),RELEASE_MIGRATION_LIMITS.cleanup);}catch{error||=new ReleaseMigrationError('Migration 021 connection cleanup was not confirmed; production build stopped.');}}
 if(failed)error||=new ReleaseMigrationError('Migration 021 connection failure; production build stopped.');if(error)throw error;
 return {status:'applied' as const,message:'Migration 021 verified and committed. Source policies and grants are additive; no existing consent, source, task, approval or scheduler setting was changed.'};
}
