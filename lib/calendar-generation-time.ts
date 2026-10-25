import {randomUUID} from 'node:crypto';
import type {Connection,Database} from './db';
import {configReady,hash,type RuntimeConfig} from './domain';
import {calendarPlatformPolicy} from './platform-policy';
import {githubSelectionPool} from './github-source-selection';
import {githubProvenanceHash,stableJson} from './github-source-policy';
import {parseLegacyNormalizationRequest as parseBoundedJSON,NORMALIZATION_IDS} from './calendar-legacy-normalization';
import {validApprovalPlanReceipt} from './approval-plan-receipt';

const HOUR=3_600_000;
export const GENERATION_ADVANCED='calendar_generation_advanced';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const isUuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const isHash=(value:unknown):value is string=>typeof value==='string'&&SHA.test(value);
const TIME_KEYS=['intended_post','draft_due','review_due','generation_due','updated'];
const MICRO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/** Fixed internal aliases only. Preserve DB microseconds, not driver Date rounding. */
export const generationRowSQL=(alias:'s'|'e')=>`(to_jsonb(${alias})||jsonb_build_object(${(alias==='s'?['updated']:TIME_KEYS).map(key=>`'${key}',to_char(${alias}.${key} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`).join(',')}))`;
export class GenerationTimeError extends Error{}
type Selection=Awaited<ReturnType<typeof githubSelectionPool>>;
export type GenerationTimeInput={entry_id:string;expected_preview:string;requested_generation_time:'server_now';acknowledged:true};
export function validGenerationTimeInput(value:unknown):value is GenerationTimeInput{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const b=value as GenerationTimeInput;
 return Object.keys(b).length===4&&Object.keys(b).every(key=>['entry_id','expected_preview','requested_generation_time','acknowledged'].includes(key))&&typeof b.entry_id==='string'&&UUID.test(b.entry_id)&&typeof b.expected_preview==='string'&&SHA.test(b.expected_preview)&&b.requested_generation_time==='server_now'&&b.acknowledged===true;
}
export function parseGenerationTimeRequest(text:string):GenerationTimeInput{
 let value:unknown;try{value=parseBoundedJSON(text);}catch{return fail('Invalid or ambiguous generation-time JSON');}
 if(!validGenerationTimeInput(value))return fail('Exact generation-time acknowledgement required');return value;
}
const iso=(value:unknown)=>new Date(value as string).toISOString();
const milliseconds=(value:unknown)=>new Date(value as string).getTime();
const exactStamp=(value:unknown)=>{if(typeof value!=='string'||!MICRO.test(value)||iso(value).slice(0,19)!==value.slice(0,19))return fail('Exact database timing precision is required');return value;};
const fail=(message:string):never=>{throw new GenerationTimeError(message);};
const HISTORY=[GENERATION_ADVANCED,'calendar_publication_approved','calendar_draft_replanned'];
const NOTE='Owner requested drafting at the actual server write time. Posting/review times and source policy unchanged. No personal source-review claim, source selection, task, paid call or publication.';
const keys=(value:Record<string,any>,expected:string[])=>Object.keys(value).sort().join('|')===[...expected].sort().join('|');
const storedStamp=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value)&&Number.isFinite(milliseconds(value))&&iso(value).slice(0,19)===value.slice(0,19);
type HistoryEvent={id:string;kind:string;detail:string};
function validatedHistory(events:HistoryEvent[]){
 const selected=events.filter(event=>HISTORY.includes(event.kind));
 if(selected.length>1024||selected.reduce((sum,event)=>sum+Buffer.byteLength(event.detail),0)>1_048_576)return fail('Calendar timing history exceeds safe inspection limits');
 return selected.map(event=>{
  let receipt:Record<string,any>;try{receipt=parseBoundedJSON(event.detail);}catch{return fail('Malformed or ambiguous Calendar timing history');}
  if(!isUuid(event.id))return fail('Malformed Calendar timing receipt');
  if(event.kind===GENERATION_ADVANCED){
   if(!keys(receipt,['schema','entry_id','expected_preview','requested_generation_time','generation_due','previous_generation_due','intended_post','draft_due','review_due','policy_id','policy_hash','actor','note'])||receipt.schema!==1||receipt.requested_generation_time!=='server_now'||receipt.actor!=='owner'||receipt.note!==NOTE||!isUuid(receipt.entry_id)||!isUuid(receipt.policy_id)||!isHash(receipt.expected_preview)||!isHash(receipt.policy_hash)||!['generation_due','previous_generation_due','intended_post','draft_due','review_due'].every(key=>storedStamp(receipt[key])))return fail('Malformed generation-time receipt');
   const lead=milliseconds(receipt.intended_post)-milliseconds(receipt.generation_due);
   if(lead<120*HOUR||lead>336*HOUR||milliseconds(receipt.previous_generation_due)<=milliseconds(receipt.generation_due)||milliseconds(receipt.draft_due)!==milliseconds(receipt.review_due)||milliseconds(receipt.intended_post)-milliseconds(receipt.review_due)!==48*HOUR)return fail('Inconsistent generation-time receipt');
  }else if(event.kind==='calendar_publication_approved'){
   if(!validApprovalPlanReceipt(receipt))return fail('Unknown Calendar publication receipt shape');
  }else if(!keys(receipt,['old_entry','old_task','old_version','new_entry','source_id','source_hash','reason','intended_post','generation_due','review_due','note'])||!['old_entry','new_entry','old_task','source_id'].every(key=>isUuid(receipt[key]))||!isHash(receipt.old_version)||!isHash(receipt.source_hash)||!['intended_post','generation_due','review_due'].every(key=>storedStamp(receipt[key]))||typeof receipt.reason!=='string'||!receipt.reason.trim()||receipt.reason.length>1000||typeof receipt.note!=='string')return fail('Unknown Calendar recovery receipt shape');
  return {...event,receipt};
 });
}
export function identifiableGenerationHistory(events:HistoryEvent[],entryId:string){
 try{return validatedHistory(events).some(event=>[event.receipt.entry_id,event.receipt.old_entry,event.receipt.new_entry].includes(entryId));}catch{return true;}
}
async function readHistory(tx:Connection){
 const size=(await tx.query<{count:string;bytes:string;largest:string}>('SELECT count(*)::text AS count,COALESCE(sum(octet_length(detail)),0)::text AS bytes,COALESCE(max(octet_length(detail)),0)::text AS largest FROM events WHERE kind=ANY($1::text[])',[HISTORY]))[0];
 if(!size||![size.count,size.bytes,size.largest].every(value=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)))||Number(size.count)>1024||Number(size.bytes)>1_048_576||Number(size.largest)>4096)return fail('Calendar timing history exceeds safe inspection limits');
 const events=await tx.query<HistoryEvent>('SELECT id,kind,detail FROM events WHERE kind=ANY($1::text[]) ORDER BY id LIMIT 1025',[HISTORY]);
 if(events.length!==Number(size.count)||events.reduce((sum,event)=>sum+Buffer.byteLength(event.detail),0)!==Number(size.bytes))return fail('Calendar timing history changed during inspection');
 return validatedHistory(events);
}
/** Read-only preview. The requested target is a mode, never a caller-supplied clock. */
export function generationTimePreview(entry:any,settings:any,selection:Selection,config:RuntimeConfig,runtimeReady:boolean,now=new Date(),hasHistory=false){
 try{
  if(!Number.isFinite(now.getTime()))return fail('Current server time is unavailable');
  if(!entry||!isUuid(entry.id)||!calendarPlatformPolicy(entry))return fail('Only a current LinkedIn-only plan can bring drafting forward');
  // Those four historical repairs retain their distinct reviewed timing history.
  if(NORMALIZATION_IDS.includes(entry.id))return fail('Previously normalized historical plans are not eligible for this new-plan action');
  if(entry.source_id||entry.task_id||hasHistory)return fail('This plan has a source, task or retained execution history; it cannot be retimed here');
  for(const key of TIME_KEYS)exactStamp(entry[key]);exactStamp(settings?.updated);
  const post=milliseconds(entry.intended_post),draft=milliseconds(entry.draft_due),review=milliseconds(entry.review_due),due=milliseconds(entry.generation_due);
  const schedule=entry.platform_schedule?.LinkedIn;
  if(![post,draft,review,due].every(Number.isFinite)||!schedule||!['intended_post','draft_due','review_due'].every(key=>storedStamp(schedule[key]))||Date.parse(schedule.intended_post)!==post||Date.parse(schedule.draft_due)!==draft||Date.parse(schedule.review_due)!==review||draft!==review||post-review!==48*HOUR)return fail('Existing posting and 48-hour review timing must remain intact');
  if(due<=now.getTime())return fail('Generation is already due; use the existing due queue without changing its time');
  if(post-now.getTime()<120*HOUR||post-now.getTime()>336*HOUR||Math.min(draft,review)-now.getTime()<HOUR)return fail('Current time must retain 120–336 hours of posting lead and the review cushion');
  if(settings?.generation_enabled!==true)return fail('Scheduled drafting must already be enabled; this action does not enable it');
  if(!runtimeReady||!configReady(config,now)||config.owner_cleared_sources_authorized!==true||config.fallback_authorized===true)return fail('Current approved OpenAI-only runtime is required');
  if(!selection.policy||!selection.candidates.length)return fail('An active matching GitHub policy and eligible unused evidence are required');
  const policy=selection.policy;
  const binding={schema:1,requested_generation_time:'server_now',entry,settings,policy:{id:policy.id,scope_hash:policy.scope_hash,runtime_binding:policy.runtime_binding,receipt_id:policy.receipt_id},config_hash:hash(stableJson(config)),candidates:selection.candidates.map(candidate=>({source_id:candidate.source.id,source_hash:candidate.source.hash,provenance_hash:githubProvenanceHash(candidate.provenance),evidence_key:candidate.evidence_key}))};
  return {eligible:true,reason:null,expected_preview:hash(stableJson(binding)),requested_generation_time:'server_now' as const,policy_id:policy.id,policy_hash:policy.scope_hash,eligible_candidates:selection.candidates.length,notice:'Make generation due at the real server time when saved. Posting time, the 48-hour review deadline and source policy stay unchanged. No source is personally reviewed, no task is queued and no model call or publication is made by this action.'};
 }catch(error){return {eligible:false,reason:error instanceof GenerationTimeError?error.message:'Calendar timing or source-policy preview is unavailable',expected_preview:null,requested_generation_time:'server_now' as const,policy_id:null,policy_hash:null,eligible_candidates:0,notice:'No timing, source clearance or paid work has changed.'};}
}
/** One explicit owner operation. Existing policy selection and bounded runner remain separate. */
export async function advanceGenerationNow(db:Database,input:GenerationTimeInput,options:{readConfig:()=>RuntimeConfig;isReady:(config:RuntimeConfig)=>boolean;clock?:()=>Date}){
 if(!validGenerationTimeInput(input))return fail('Exact generation-time acknowledgement required');
 const clock=options.clock||(()=>new Date());
 return db.transaction(async tx=>{
  await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='10s'");
  // Match plan/link/dispatch/recovery: settings first, then the exact entry.
  const settings=(await tx.query<any>(`SELECT ${generationRowSQL('s')} AS snapshot FROM calendar_settings s WHERE id=1 FOR UPDATE OF s`))[0]?.snapshot;
  const entry=(await tx.query<any>(`SELECT ${generationRowSQL('e')} AS snapshot FROM calendar_entries e WHERE id=$1 FOR UPDATE OF e`,[input.entry_id]))[0]?.snapshot;
  if(!entry)return fail('Unknown calendar entry');
  const history=await readHistory(tx);
  const receipts:Array<Record<string,any>&{id:string}>=history.filter(event=>event.kind===GENERATION_ADVANCED&&event.receipt.entry_id===entry.id).map(event=>({...event.receipt,id:event.id}));
  if(receipts.length){
   if(receipts.length!==1||receipts[0].expected_preview!==input.expected_preview||receipts[0].requested_generation_time!=='server_now')return fail('This entry already has a generation-time change; refresh its saved result');
   return {entry_id:entry.id,receipt_id:receipts[0].id,generation_due:receipts[0].generation_due,duplicate:true,historical:true,queued:false,paid_execution:false};
  }
  const jobs=await tx.query('SELECT id FROM calendar_jobs WHERE entry_id=$1 FOR UPDATE',[entry.id]);
  const tasks=await tx.query('SELECT id FROM tasks WHERE origin_key=$1 FOR UPDATE',['calendar:'+entry.id]);
  const grants=await tx.query('SELECT id FROM github_source_grants WHERE entry_id=$1 FOR UPDATE',[entry.id]);
  const hasHistory=!!(jobs.length||tasks.length||grants.length)||history.some(event=>[event.receipt.entry_id,event.receipt.old_entry,event.receipt.new_entry].includes(entry.id));
  const config=options.readConfig(),firstSelection=await githubSelectionPool(tx,config,clock());
  // Lock the existing eligible evidence against clearance/revocation/provenance
  // edits while checking this preview. No evidence is selected or reserved here;
  // later dispatch still performs its own current-policy selection transaction.
  const sourceIds=firstSelection.candidates.map(candidate=>candidate.source.id).sort(),provenanceIds=firstSelection.candidates.map(candidate=>candidate.provenance.id).sort();
  if(sourceIds.length)await tx.query('SELECT id FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[sourceIds]);
  if(provenanceIds.length)await tx.query('SELECT id FROM source_provenance WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[provenanceIds]);
  const selection=await githubSelectionPool(tx,config,clock());
  const preview=generationTimePreview(entry,settings,selection,config,options.isReady(config),clock(),hasHistory);
  if(!preview.eligible)return fail(preview.reason!);
  if(preview.expected_preview!==input.expected_preview)return fail('Generation-time preview changed; refresh before saving');
  // No asynchronous operation may intervene between the fresh clock/config check
  // and the single update. Caller timestamps and artificial now are not inputs.
  const currentConfig=options.readConfig(),appliedAt=clock();
  const final=generationTimePreview(entry,settings,selection,currentConfig,options.isReady(currentConfig),appliedAt,hasHistory);
  if(!final.eligible)return fail(final.reason!);
  if(final.expected_preview!==input.expected_preview)return fail('Generation-time preview changed; refresh before saving');
  const generationDue=appliedAt.toISOString(),receiptId=randomUUID();
  await tx.query('UPDATE calendar_entries SET generation_due=$2,updated=now() WHERE id=$1',[entry.id,generationDue]);
  await tx.query('INSERT INTO events(id,task_id,kind,detail) VALUES($1,NULL,$2,$3)',[receiptId,GENERATION_ADVANCED,JSON.stringify({schema:1,entry_id:entry.id,expected_preview:input.expected_preview,requested_generation_time:'server_now',generation_due:generationDue,previous_generation_due:entry.generation_due,intended_post:entry.intended_post,draft_due:entry.draft_due,review_due:entry.review_due,policy_id:final.policy_id,policy_hash:final.policy_hash,actor:'owner',note:NOTE})]);
  const finishConfig=options.readConfig(),finish=generationTimePreview(entry,settings,selection,finishConfig,options.isReady(finishConfig),clock(),hasHistory);
  if(!finish.eligible||finish.expected_preview!==input.expected_preview)return fail('Generation-time guards changed before completion; refresh before saving');
  return {entry_id:entry.id,receipt_id:receiptId,generation_due:generationDue,duplicate:false,historical:false,queued:false,paid_execution:false};
 });
}
