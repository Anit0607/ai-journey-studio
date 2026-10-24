import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {hash} from "./domain";
import {NEW_PLATFORM_POLICY} from "./platform-policy";
import {APPROVAL_PLAN_ACK} from "./approval-plan-contract";

export const NORMALIZATION_EVENT="calendar_legacy_normalized_v1";
export const NORMALIZATION_ACK="I approve normalizing only these four unbound legacy Calendar entries, including the displayed old/new aggregate timestamps and LinkedIn-only scope, without enabling generation, import, source clearance, model execution or publication.";
export const NORMALIZATION_IDS=Object.freeze(["e15dbb66-c3f9-4141-8b94-544e14349b46","c2aed4a0-1257-4faa-ac59-090e5d838a28","b57e284f-ffc5-4162-9b9d-8398b554eb39","183af62f-c135-474b-b6d6-0fe77dc24c4e"].sort());
const verified=[
 ["e15dbb66-c3f9-4141-8b94-544e14349b46","2026-11-02","shortform","03:30","16:30","13:30"],
 ["c2aed4a0-1257-4faa-ac59-090e5d838a28","2026-11-04","shortform","04:30","10:30","06:30"],
 ["b57e284f-ffc5-4162-9b9d-8398b554eb39","2026-11-06","shortform","03:30","09:30","16:30"],
 ["183af62f-c135-474b-b6d6-0fe77dc24c4e","2026-11-08","longform","03:30","16:30","15:30"]
] as const;
const verifiedSettings={generation_enabled:false,generation_lead_hours:120,id:1,long_day:0,platform_times:{LinkedIn:{"0":"22:00","1":"22:00","3":"16:00","5":"15:00"}},post_time:null,review_hours:48,short_days:[1,3,5],start_date:"2026-11-02",timezone:"Asia/Kolkata",timing_basis:"india-first-buffer-hypothesis-v1",timing_mode:"per_platform",updated:"2026-10-24T07:27:03.211Z"};
const ROW_KEYS=["id","planned_date","kind","intended_post","draft_due","review_due","generation_due","source_id","task_id","platform_schedule","updated"];
const TIME_KEYS=["intended_post","draft_due","review_due","generation_due","updated"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[0-9a-f]{64}$/;
const UTC_MICROS=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_HISTORY_ROWS=1024,MAX_HISTORY_BYTES=1_048_576,MAX_DETAIL_BYTES=65_536;
type Row=Record<string,any>;
export type EntryProof={id:string;row_hash:string;updated:string};
type Change={id:string;kind:string;planned_date:string;before:Row;after:Row};
export type LegacyNormalizationPreview={schema:1;settings_hash:string;settings:Row;entries:EntryProof[];changes:Change[];preview_fingerprint:string;acknowledgement:string;paid_execution:false};
type CommitInput={settings_hash:string;entries:EntryProof[];preview_fingerprint:string;acknowledged:true};
type Audit={schema:1;settings_hash:string;entries:EntryProof[];preview_fingerprint:string;acknowledgement:string;before:Row[];after:Row[];changes:Change[]};
export class LegacyNormalizationError extends Error{}
function fail(message:string):never{throw new LegacyNormalizationError(message);}
function object(value:unknown):value is Row{return !!value&&typeof value==="object"&&!Array.isArray(value)&&!(value instanceof Date);}
function keys(value:unknown,expected:readonly string[]):value is Row{return object(value)&&Object.keys(value).sort().join("|")===([...expected].sort().join("|"));}
function iso(value:unknown):string{if(!(value instanceof Date)&&typeof value!=="string")fail("Invalid Calendar timestamp");const date=new Date(value as string);if(!Number.isFinite(date.getTime()))fail("Invalid Calendar timestamp");return date.toISOString();}
function canonical(value:any):string{
 const normalize=(item:any):any=>{if(item instanceof Date)return iso(item);if(Array.isArray(item))return item.map(normalize);if(object(item))return Object.fromEntries(Object.keys(item).sort().map(key=>[key,normalize(item[key])]));if(item===null||typeof item==="string"||typeof item==="boolean"||typeof item==="number"&&Number.isFinite(item))return item;return fail("Unsupported Calendar snapshot value");};
 return JSON.stringify(normalize(value));
}
const reviewedSnapshot=(row:Row,timeKeys:readonly string[])=>{const copy=JSON.parse(canonical(row));for(const key of timeKeys)copy[key]=iso(copy[key]);return copy as Row;};
function microstamp(value:unknown):string{if(typeof value!=="string"||!UTC_MICROS.test(value)||iso(value).slice(0,19)!==value.slice(0,19))fail("Exact database timestamp precision is required");return value;}
function snapshot(row:Row,timeKeys:readonly string[]){const copy=JSON.parse(canonical(row));for(const key of timeKeys)copy[key]=microstamp(copy[key]);return copy as Row;}
// Only fixed identifiers are passed here. SQL JSON retains all native columns;
// explicit UTC microseconds avoid the JS driver's Date precision truncation.
const rowSQL=(alias:string,timeKeys:readonly string[])=>`(to_jsonb(${alias})||jsonb_build_object(${timeKeys.map(key=>`'${key}',to_char(${alias}.${key} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`).join(",")}))`;
const newStamp=(value:string)=>iso(value).slice(0,-1)+"000Z";
const shift=(post:string,hours:number)=>new Date(Date.parse(post)+hours*3600000).toISOString();
const schedule=(post:string)=>({draft_due:shift(post,-48),intended_post:post,review_due:shift(post,-48)});
function expectedRow(id:string){
 const target=verified.find(row=>row[0]===id);if(!target)return fail("Only the four reviewed Calendar IDs are allowed");
 const [,date,kind,old,linkedin,instagram]=target,post=date+"T"+old+":00.000Z";
 return {id,planned_date:date,kind,intended_post:post,draft_due:shift(post,-48),review_due:shift(post,-48),generation_due:shift(post,-120),source_id:null,task_id:null,updated:"2026-10-23T02:47:37.846Z",platform_schedule:{Instagram:schedule(date+"T"+instagram+":00.000Z"),LinkedIn:schedule(date+"T"+linkedin+":00.000Z"),X:schedule(post)}};
}
function normalizedFields(row:Row){const linkedin=row.platform_schedule.LinkedIn;return {intended_post:newStamp(linkedin.intended_post),draft_due:newStamp(linkedin.draft_due),review_due:newStamp(linkedin.review_due),generation_due:newStamp(shift(linkedin.intended_post,-120)),platform_schedule:{LinkedIn:linkedin,platform_policy:NEW_PLATFORM_POLICY}};}
function timestampPlan(row:Row){return {intended_post:row.intended_post,draft_due:row.draft_due,review_due:row.review_due,generation_due:row.generation_due,platform_schedule:row.platform_schedule};}
function future(rows:Row[],clock:()=>Date){const now=clock().getTime();if(!Number.isFinite(now)||rows.some(row=>Date.parse(row.intended_post)<=now||Date.parse(row.platform_schedule.LinkedIn.intended_post)<=now))fail("All four reviewed Calendar posts must still be in the future");}

/** Bounded JSON parser rejects duplicate decoded keys, including escaped keys.
 * JSON.parse alone discards duplicates and could hide a historical target ID. */
function receiptJSON(text:string):Row{
 let at=0,nodes=0;const white=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const string=()=>{const start=at;if(text[at++]!=='"')throw Error();while(at<text.length){const char=text[at++];if(char==='"')return JSON.parse(text.slice(start,at)) as string;if(char==="\\")at++;}throw Error();};
 const value=(depth:number):any=>{if(depth>16||++nodes>8192)throw Error();white();const char=text[at];if(char==='"')return string();if(char==="{"||char==="["){
  at++;const array=char==="[",out:any=array?[]:Object.create(null),seen=new Set<string>();white();if(text[at]===(array?"]":"}")){at++;return out;}
  for(;;){white();if(array)out.push(value(depth+1));else{const key=string();if(seen.has(key))throw Error();seen.add(key);white();if(text[at++]!==":")throw Error();out[key]=value(depth+1);}white();const end=text[at++];if(end===(array?"]":"}"))return out;if(end!==",")throw Error();}
 }
 const start=at;while(at<text.length&&!/[ \t\r\n,\]}]/.test(text[at]))at++;if(at===start)throw Error();return JSON.parse(text.slice(start,at));};
 try{const parsed=value(0);white();if(at!==text.length||!object(parsed))throw Error();return parsed;}catch{return fail("Malformed or ambiguous Calendar receipt history");}
}
export function parseLegacyNormalizationRequest(text:string):Row{
 if(Buffer.byteLength(text,"utf8")>4096)fail("Normalization request exceeds 4096 bytes");
 try{return receiptJSON(text);}catch{return fail("Invalid or ambiguous normalization JSON");}
}
async function history(tx:Connection,kind:string){
 const size=(await tx.query<{count:string;bytes:string;largest:string}>("SELECT count(*)::text AS count,COALESCE(sum(octet_length(detail)),0)::text AS bytes,COALESCE(max(octet_length(detail)),0)::text AS largest FROM public.events WHERE kind=$1",[kind]))[0];
 const counts=size&&[size.count,size.bytes,size.largest].map(value=>/^\d+$/.test(String(value))?Number(value):NaN);
 if(!counts||counts.some(value=>!Number.isSafeInteger(value))||counts[0]>MAX_HISTORY_ROWS||counts[1]>MAX_HISTORY_BYTES||counts[2]>MAX_DETAIL_BYTES)fail("Calendar receipt history exceeds safe inspection limits");
 const rows=await tx.query<{id:string;detail:string}>("SELECT id,detail FROM public.events WHERE kind=$1 ORDER BY id LIMIT $2",[kind,MAX_HISTORY_ROWS+1]);
 if(rows.length!==counts[0]||rows.reduce((sum,row)=>sum+Buffer.byteLength(row.detail,"utf8"),0)!==counts[1])fail("Calendar receipt history changed during inspection");
 return rows.map(row=>({id:row.id,receipt:receiptJSON(row.detail)}));
}
async function assertUnused(tx:Connection){
 if((await tx.query("SELECT id FROM public.calendar_jobs WHERE entry_id=ANY($1::uuid[]) LIMIT 1",[NORMALIZATION_IDS])).length)fail("A Calendar job now exists; normalization is blocked");
 if((await tx.query("SELECT id FROM public.tasks WHERE origin_key=ANY($1::text[]) LIMIT 1",[NORMALIZATION_IDS.map(id=>"calendar:"+id)])).length)fail("Calendar-origin task history blocks normalization");
 if((await tx.query("SELECT id FROM public.github_source_grants WHERE entry_id=ANY($1::uuid[]) LIMIT 1",[NORMALIZATION_IDS])).length)fail("Calendar source-grant history blocks normalization");
 for(const {receipt} of await history(tx,"calendar_publication_approved")){
  if(!keys(receipt,["outbox_id","entry_id","calendar_binding","plan_version","acknowledgement"])||typeof receipt.entry_id!=="string"||!UUID.test(receipt.entry_id)||typeof receipt.outbox_id!=="string"||!UUID.test(receipt.outbox_id)||typeof receipt.calendar_binding!=="string"||!SHA.test(receipt.calendar_binding)||typeof receipt.plan_version!=="string"||!SHA.test(receipt.plan_version)||receipt.acknowledgement!==APPROVAL_PLAN_ACK)fail("Unknown Calendar publication receipt shape");
  if(NORMALIZATION_IDS.includes(receipt.entry_id.toLowerCase()))fail("Calendar publication approval history blocks normalization");
 }
}
async function locked(tx:Connection){
 const settings=(await tx.query<{snapshot:Row}>(`SELECT ${rowSQL("s",["updated"])} AS snapshot FROM public.calendar_settings s WHERE s.id=1 FOR UPDATE OF s`))[0]?.snapshot;if(!settings)fail("Calendar settings are unavailable");
 let rows:Row[];
 try{rows=(await tx.query<{snapshot:Row}>(`SELECT ${rowSQL("e",TIME_KEYS)} AS snapshot FROM public.calendar_entries e WHERE e.id=ANY($1::uuid[]) ORDER BY e.id FOR UPDATE OF e NOWAIT`,[NORMALIZATION_IDS])).map(row=>row.snapshot);}
 catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="55P03")fail("Calendar entries are busy; no changes were saved. Let the current operation finish, then request a fresh preview.");throw error;}
 if(rows.length!==4||rows.map(row=>row.id).join("|")!==NORMALIZATION_IDS.join("|"))fail("The exact four reviewed Calendar rows are required");
 return {settings:snapshot(settings,["updated"]),rows:rows.map(row=>snapshot(row,TIME_KEYS))};
}
function settingsHash(settings:Row){if(canonical(reviewedSnapshot(settings,["updated"]))!==canonical(verifiedSettings))fail("Verified Calendar settings changed; normalization is blocked");return hash(canonical(settings));}
async function prepare(tx:Connection,settings:Row,rows:Row[],clock:()=>Date):Promise<LegacyNormalizationPreview>{
 const settings_hash=settingsHash(settings);
 for(const row of rows)if(!keys(row,ROW_KEYS)||canonical(reviewedSnapshot(row,TIME_KEYS))!==canonical(expectedRow(row.id)))fail("Reviewed legacy Calendar row or platform JSON changed");
 future(rows,clock);await assertUnused(tx);
 const entries=rows.map(row=>({id:row.id,row_hash:hash(canonical(row)),updated:row.updated})),changes=rows.map(row=>({id:row.id,kind:row.kind,planned_date:row.planned_date,before:timestampPlan(row),after:normalizedFields(row)}));
 const binding={schema:1 as const,settings_hash,entries,changes};
 return {...binding,settings,preview_fingerprint:hash(canonical(binding)),acknowledgement:NORMALIZATION_ACK,paid_execution:false};
}
function commitInput(value:unknown):CommitInput{
 if(!keys(value,["settings_hash","entries","preview_fingerprint","acknowledged"])||value.acknowledged!==true||typeof value.settings_hash!=="string"||!SHA.test(value.settings_hash)||typeof value.preview_fingerprint!=="string"||!SHA.test(value.preview_fingerprint)||!Array.isArray(value.entries)||value.entries.length!==4)fail("Exact four-row normalization acknowledgement is required");
 const entries=value.entries.map((entry:unknown)=>{if(!keys(entry,["id","row_hash","updated"])||typeof entry.id!=="string"||!NORMALIZATION_IDS.includes(entry.id)||typeof entry.row_hash!=="string"||!SHA.test(entry.row_hash)||typeof entry.updated!=="string"||microstamp(entry.updated)!==entry.updated)fail("Exact Calendar row hashes and updated values are required");return entry as EntryProof;}).sort((a:EntryProof,b:EntryProof)=>a.id.localeCompare(b.id));
 if(entries.map((entry:EntryProof)=>entry.id).join("|")!==NORMALIZATION_IDS.join("|"))fail("Only the exact four reviewed IDs may be normalized");
 return {...value,entries} as CommitInput;
}
function auditReceipt(value:Row):Audit{
 if(!keys(value,["schema","settings_hash","entries","preview_fingerprint","acknowledgement","before","after","changes"])||value.schema!==1||value.acknowledgement!==NORMALIZATION_ACK||!Array.isArray(value.before)||value.before.length!==4||!Array.isArray(value.after)||value.after.length!==4||!Array.isArray(value.changes)||value.changes.length!==4)fail("Malformed normalization audit history");
 const request=commitInput({settings_hash:value.settings_hash,entries:value.entries,preview_fingerprint:value.preview_fingerprint,acknowledged:true});
 for(let n=0;n<4;n++){
  const before=value.before[n],after=value.after[n],proof=request.entries[n];
  if(!keys(before,ROW_KEYS)||!keys(after,ROW_KEYS)||canonical(reviewedSnapshot(before,TIME_KEYS))!==canonical(expectedRow(proof.id))||hash(canonical(before))!==proof.row_hash||before.updated!==proof.updated||canonical({...after,updated:before.updated})!==canonical({...before,...normalizedFields(before)})||microstamp(after.updated)!==after.updated)fail("Normalization audit snapshots are inconsistent");
 }
 const changes=value.before.map((row:Row)=>({id:row.id,kind:row.kind,planned_date:row.planned_date,before:timestampPlan(row),after:normalizedFields(row)}));
 if(canonical(changes)!==canonical(value.changes)||hash(canonical({schema:1,settings_hash:value.settings_hash,entries:request.entries,changes}))!==value.preview_fingerprint)fail("Normalization audit fingerprint is inconsistent");
 return value as Audit;
}
/** Preview is read-only; API presentation rows are never accepted as DB tokens. */
export async function previewLegacyNormalization(db:Database,clock:()=>Date=()=>new Date()){
 return db.transaction(async tx=>{const state=await locked(tx);if((await history(tx,NORMALIZATION_EVENT)).length)fail("Normalization already has an audit receipt; inspect its saved outcome");return prepare(tx,state.settings,state.rows,clock);});
}
/** No source, task, setting, approval or activation is written by this repair. */
export async function commitLegacyNormalization(db:Database,value:unknown,clock:()=>Date=()=>new Date()){
 const input=commitInput(value);
 return db.transaction(async tx=>{
  const state=await locked(tx),currentSettingsHash=settingsHash(state.settings);
  const prior=await history(tx,NORMALIZATION_EVENT);if(prior.length>1)fail("Ambiguous normalization audit history");
  if(prior.length){const audit=auditReceipt(prior[0].receipt);if(audit.preview_fingerprint!==input.preview_fingerprint||audit.settings_hash!==input.settings_hash||audit.settings_hash!==currentSettingsHash||canonical(audit.entries)!==canonical(input.entries))fail("Normalization already applied to a different exact request");return {status:"already_applied",audit_id:prior[0].id,preview_fingerprint:audit.preview_fingerprint,changes:audit.changes,paid_execution:false};}
  const preview=await prepare(tx,state.settings,state.rows,clock);
  if(preview.settings_hash!==input.settings_hash||preview.preview_fingerprint!==input.preview_fingerprint||canonical(preview.entries)!==canonical(input.entries))fail("Stale normalization preview; inspect the exact current rows again");
  const after:Row[]=[];
  for(const row of state.rows){
   future(state.rows,clock);const change=normalizedFields(row);
   const result=(await tx.query<{snapshot:Row}>(`UPDATE public.calendar_entries AS e SET intended_post=$2,draft_due=$3,review_due=$4,generation_due=$5,platform_schedule=$6::jsonb,updated=now() WHERE e.id=$1 RETURNING ${rowSQL("e",TIME_KEYS)} AS snapshot`,[row.id,change.intended_post,change.draft_due,change.review_due,change.generation_due,JSON.stringify(change.platform_schedule)]))[0]?.snapshot;
   if(!result)fail("Calendar row disappeared; normalization rolled back");const saved=snapshot(result,TIME_KEYS);
   if(!keys(saved,ROW_KEYS)||canonical({...saved,updated:row.updated})!==canonical({...row,...change}))fail("Unexpected Calendar update; normalization rolled back");after.push(saved);
  }
  future(state.rows,clock);
  const audit:Audit={schema:1,settings_hash:preview.settings_hash,entries:preview.entries,preview_fingerprint:preview.preview_fingerprint,acknowledgement:NORMALIZATION_ACK,before:state.rows,after,changes:preview.changes},detail=canonical(audit),audit_id=randomUUID();
  if(Buffer.byteLength(detail,"utf8")>MAX_DETAIL_BYTES)fail("Normalization audit exceeds its size limit");
  await tx.query("INSERT INTO public.events(id,task_id,kind,detail) VALUES($1,NULL,$2,$3)",[audit_id,NORMALIZATION_EVENT,detail]);
  return {status:"applied",audit_id,preview_fingerprint:preview.preview_fingerprint,changes:preview.changes,paid_execution:false};
 });
}
