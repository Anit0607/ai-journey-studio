import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {hash} from "../lib/domain";
import {Calendar} from "../lib/calendar";
import {APPROVAL_PLAN_ACK,APPROVAL_PLAN_CONTRACT_V2} from "../lib/approval-plan-contract";
import {previewLegacyNormalization,commitLegacyNormalization,NORMALIZATION_EVENT,type LegacyNormalizationPreview} from "../lib/calendar-legacy-normalization";

// Independent golden inputs from the reviewed nonsecret capture. These are
// isolated database fixtures, never a connection to the captured application.
const cases=[
 ["e15dbb66-c3f9-4141-8b94-544e14349b46","2026-11-02","shortform","03:30","16:30","13:30",13],
 ["c2aed4a0-1257-4faa-ac59-090e5d838a28","2026-11-04","shortform","04:30","10:30","06:30",6],
 ["b57e284f-ffc5-4162-9b9d-8398b554eb39","2026-11-06","shortform","03:30","09:30","16:30",6],
 ["183af62f-c135-474b-b6d6-0fe77dc24c4e","2026-11-08","longform","03:30","16:30","15:30",13]
] as const;
const now=()=>new Date("2026-10-24T17:51:37.414Z"),shift=(post:string,h:number)=>new Date(Date.parse(post)+h*3600000).toISOString(),times={LinkedIn:{"0":"22:00","1":"22:00","3":"16:00","5":"15:00"}};
const part=(post:string)=>({draft_due:shift(post,-48),intended_post:post,review_due:shift(post,-48)});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const presentation=(value:any[])=>value.map(row=>{const copy=structuredClone(row);for(const field of ["intended_post","draft_due","review_due","generation_due","updated"])copy[field]=new Date(copy[field]).toISOString();return copy;});
const request=(p:LegacyNormalizationPreview)=>({settings_hash:p.settings_hash,entries:p.entries,preview_fingerprint:p.preview_fingerprint,acknowledged:true});
async function rows(db:Database){return plain(await db.query("SELECT * FROM calendar_entries ORDER BY id"));}
async function seed(db:Database){
 await db.query("UPDATE calendar_settings SET timezone='Asia/Kolkata',short_days='[1,3,5]',long_day=0,review_hours=48,start_date='2026-11-02',post_time=NULL,generation_lead_hours=120,generation_enabled=false,timing_mode='per_platform',platform_times=$1::jsonb,timing_basis='india-first-buffer-hypothesis-v1',updated='2026-10-24T07:27:03.211Z' WHERE id=1",[JSON.stringify(times)]);
 for(const [id,date,kind,old,li,ig] of cases){const post=date+"T"+old+":00.000Z",schedule={Instagram:part(date+"T"+ig+":00.000Z"),LinkedIn:part(date+"T"+li+":00.000Z"),X:part(post)};await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule,updated) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'2026-10-23T02:47:37.846Z')",[id,date,kind,post,shift(post,-48),shift(post,-120),JSON.stringify(schedule)]);}
}
async function fixture(work:(db:Database)=>Promise<void>){const db=await embedded();try{await seed(db);await work(db);}finally{await db.close();}}
async function noAudit(db:Database){assert.equal((await db.query("SELECT id FROM events WHERE kind=$1",[NORMALIZATION_EVENT])).length,0);}
async function source(db:Database){const id=randomUUID(),text="Isolated history fixture.";await db.query("INSERT INTO sources(id,text,category,reported_date,cleared,hash) VALUES($1,$2,'project-note','2026-10-20',false,$3)",[id,text,hash(text)]);return {id,hash:hash(text)};}
async function grant(db:Database,entry:string){
 const s=await source(db),preview=randomUUID(),receipt=randomUUID(),id=randomUUID(),provenance=randomUUID(),sha=hash("isolated");
 for(const event of [receipt,id])await db.query("INSERT INTO events(id,kind,detail) VALUES($1,'fixture_history','Isolated synthetic history')",[event]);
 await db.query("INSERT INTO github_source_policy_previews(id,owner_id,session_id,scope,scope_hash,runtime_binding,preview_hash,expires_at) VALUES($1,'fixture','fixture','{}',$2,$2,$2,'2030-01-01')",[preview,sha]);
 await db.query("INSERT INTO github_source_policies(id,scope,scope_hash,runtime_binding,receipt_id,active) VALUES($1,'{}',$2,$2,$3,false)",[preview,sha,receipt]);
 await db.query("INSERT INTO source_provenance(id,source_id,provider,scope,external_id,content_hash) VALUES($1,$2,'github','fixture','fixture',$3)",[provenance,s.id,sha]);
 await db.query("INSERT INTO github_source_grants(id,policy_id,policy_hash,provenance_id,provenance_hash,source_id,source_hash,evidence_key,entry_id) VALUES($1,$2,$3,$4,$3,$5,$6,$7,$8)",[id,preview,sha,provenance,s.id,s.hash,"fixture:"+id,entry]);
}
function publicationReceipt(entry:string){return JSON.stringify({outbox_id:randomUUID(),entry_id:entry,calendar_binding:hash("calendar"),plan_version:hash("plan"),acknowledgement:APPROVAL_PLAN_ACK});}
async function event(db:Database,detail:string){await db.query("INSERT INTO events(id,kind,detail) VALUES($1,'calendar_publication_approved',$2)",[randomUUID(),detail]);}

test("read-only preview binds actual rows/settings and displays the real six/thirteen-hour timestamp corrections",()=>fixture(async db=>{
 const before=await rows(db),settings=plain(await db.query("SELECT * FROM calendar_settings")),p=await previewLegacyNormalization(db,now);
 assert.equal(p.entries.length,4);assert.match(p.settings_hash,/^[a-f0-9]{64}$/);assert.match(p.preview_fingerprint,/^[a-f0-9]{64}$/);assert.equal(p.settings.generation_enabled,false);
 for(const item of cases){const change=p.changes.find(row=>row.id===item[0])!;assert.equal((Date.parse(change.after.intended_post)-Date.parse(change.before.intended_post))/3600000,item[6]);assert.deepEqual(change.after.platform_schedule.LinkedIn,change.before.platform_schedule.LinkedIn);assert.equal(new Date(change.after.generation_due).toISOString(),shift(change.after.intended_post,-120));assert.equal(new Date(change.after.draft_due).toISOString(),shift(change.after.intended_post,-48));assert.equal(change.after.review_due,change.after.draft_due);}
 assert(p.entries.every(row=>/\.\d{6}Z$/.test(row.updated)),"Snapshot tokens retain database microseconds");
 assert.deepEqual(await rows(db),before);assert.deepEqual(plain(await db.query("SELECT * FROM calendar_settings")),settings);assert.equal((await db.query("SELECT * FROM events")).length,0);
}));

test("one transaction normalizes exactly four rows, preserves LinkedIn/identity/settings, audits old/new, and makes replay side-effect-free",()=>fixture(async db=>{
 const before=await rows(db),settings=plain(await db.query("SELECT * FROM calendar_settings")),p=await previewLegacyNormalization(db,now),body=request(p);
 const sqls:string[]=[];const traced:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{sqls.push(sql);return tx.query(sql,params);}}))};
 const [first,replay]=await Promise.all([commitLegacyNormalization(traced,body,now),commitLegacyNormalization(traced,body,now)]);assert.equal(first.status,"applied");assert.equal(replay.status,"already_applied");assert.equal(first.audit_id,replay.audit_id);
 assert.match(sqls[0],/calendar_settings.*FOR UPDATE OF s$/);assert.match(sqls[1],/calendar_entries.*ORDER BY e.id FOR UPDATE OF e NOWAIT$/);
 const after=await rows(db);for(const row of after){const original=before.find((old:any)=>old.id===row.id);for(const key of ["id","kind","planned_date","source_id","task_id"])assert.equal(row[key],original[key]);assert.deepEqual(row.platform_schedule,{LinkedIn:original.platform_schedule.LinkedIn,platform_policy:{version:1,platforms:["LinkedIn"]}});assert.equal(row.intended_post,original.platform_schedule.LinkedIn.intended_post);assert.equal(row.generation_due,shift(row.intended_post,-120));}
 assert.deepEqual(plain(await db.query("SELECT * FROM calendar_settings")),settings);
 const auditRows=await db.query<{detail:string}>("SELECT detail FROM events WHERE kind=$1",[NORMALIZATION_EVENT]);assert.equal(auditRows.length,1);const audit=JSON.parse(auditRows[0].detail);assert.deepEqual(presentation(audit.before),before);assert.deepEqual(presentation(audit.after),after);assert.deepEqual(audit.changes,p.changes);assert(!("active_platforms" in audit.before[0]));assert(audit.after.every((row:any)=>/\.\d{6}Z$/.test(row.updated)));
 const saved=await rows(db);await commitLegacyNormalization(db,body,now);assert.deepEqual(await rows(db),saved);assert.equal((await db.query("SELECT * FROM events")).length,1);
 for(const table of ["sources","tasks","calendar_jobs","github_source_grants","ledger","approvals","publishing_outbox","publishing_approvals","publishing_attempts"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table);
}));

test("stale previews reject newly created jobs, Calendar tasks, grants, receipts, bindings, settings and changed legacy JSON",async t=>{
 for(const change of ["job","task","grant","receipt","escaped-receipt","duplicate-keys","source-link","updated","micro-updated","settings","micro-settings","linkedin","unknown-json"] as const)await t.test(change,()=>fixture(async db=>{
  const p=await previewLegacyNormalization(db,now),id=cases[0][0];
  if(change==="job"){const result=await new Calendar(db).prepareDue(new Date("2026-10-28T04:00Z"));assert.equal(result.inserted,1);}
  if(change==="task"){const s=await source(db);await db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key) VALUES($1,$2,$3,'queued',$4)",[randomUUID(),s.id,s.hash,"calendar:"+id]);}
  if(change==="grant")await grant(db,id);
  if(change==="receipt")await event(db,publicationReceipt(id));
  if(change==="escaped-receipt")await event(db,publicationReceipt(id).replace('"entry_id":','"\\u0065ntry_id":').replace(id,"\\u0065"+id.slice(1)));
  if(change==="duplicate-keys")await event(db,publicationReceipt(id).replace('"entry_id":','"entry_id":"'+randomUUID()+'","\\u0065ntry_id":'));
  if(change==="source-link"){const s=await source(db);await db.query("UPDATE calendar_entries SET source_id=$2 WHERE id=$1",[id,s.id]);}
  if(change==="updated")await db.query("UPDATE calendar_entries SET updated=updated+interval '1 second' WHERE id=$1",[id]);
  if(change==="micro-updated")await db.query("UPDATE calendar_entries SET updated=updated+interval '1 microsecond' WHERE id=$1",[id]);
  if(change==="settings")await db.query("UPDATE calendar_settings SET generation_enabled=true");
  if(change==="micro-settings")await db.query("UPDATE calendar_settings SET updated=updated+interval '1 microsecond'");
  if(change==="linkedin")await db.query("UPDATE calendar_entries SET platform_schedule=jsonb_set(platform_schedule,'{LinkedIn,intended_post}','\"2026-11-02T16:31:00.000Z\"') WHERE id=$1",[id]);
  if(change==="unknown-json")await db.query("UPDATE calendar_entries SET platform_schedule=platform_schedule||'{\"platform_policy\":null}' WHERE id=$1",[id]);
  const changed=await rows(db);await assert.rejects(commitLegacyNormalization(db,request(p),now));assert.deepEqual(await rows(db),changed);await noAudit(db);
 }));
});

test("all four row updates and the audit roll back together on mid-batch, audit or clock-boundary failure",()=>fixture(async db=>{
 const p=await previewLegacyNormalization(db,now),before=await rows(db);let updates=0;
 const broken:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{if(sql.startsWith("UPDATE public.calendar_entries")&&++updates===3)throw Error("Injected third-row failure");return tx.query(sql,params);}}))};
 await assert.rejects(commitLegacyNormalization(broken,request(p),now),/Injected/);assert.deepEqual(await rows(db),before);await noAudit(db);
 const auditFailure:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{if(sql.startsWith("INSERT INTO public.events"))throw Error("Injected audit failure");return tx.query(sql,params);}}))};
 await assert.rejects(commitLegacyNormalization(auditFailure,request(p),now),/Injected/);assert.deepEqual(await rows(db),before);await noAudit(db);
 let ticks=0;await assert.rejects(commitLegacyNormalization(db,request(p),()=>++ticks>=3?new Date("2026-11-02T03:30Z"):now()),/future/);assert.deepEqual(await rows(db),before);await noAudit(db);
}));

test("sorted NOWAIT entry contention 55P03 fails closed without retries, entry writes or audit",()=>fixture(async db=>{
 const p=await previewLegacyNormalization(db,now),before=await rows(db);let attempts=0,writes=0,audits=0;
 const busy:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{
  if(sql.includes("FROM public.calendar_entries")){assert.match(sql,/ORDER BY e.id FOR UPDATE OF e NOWAIT$/);attempts++;throw Object.assign(Error("Simulated entry contention"),{code:"55P03"});}
  if(sql.startsWith("UPDATE public.calendar_entries"))writes++;if(sql.startsWith("INSERT INTO public.events"))audits++;return tx.query(sql,params);
 }}))};
 await assert.rejects(previewLegacyNormalization(busy,now),/entries are busy.*fresh preview/);
 await assert.rejects(commitLegacyNormalization(busy,request(p),now),/entries are busy.*fresh preview/);
 assert.equal(attempts,2,"Each owner request gets one attempt, with no automatic retry");assert.equal(writes,0);assert.equal(audits,0);assert.deepEqual(await rows(db),before);await noAudit(db);
}));

test("an unlisted Calendar row is never changed by the fixed four-row repair",()=>fixture(async db=>{
 const id=randomUUID(),post="2026-11-09T16:30:00.000Z";await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,platform_schedule) VALUES($1,'2026-11-09','shortform',$2,$3,$3,$4)",[id,post,shift(post,-48),JSON.stringify({LinkedIn:part(post),platform_policy:{version:1,platforms:["LinkedIn"]}})]);
 const before=plain(await db.query("SELECT * FROM calendar_entries WHERE id=$1",[id])),p=await previewLegacyNormalization(db,now);await commitLegacyNormalization(db,request(p),now);assert.deepEqual(plain(await db.query("SELECT * FROM calendar_entries WHERE id=$1",[id])),before);
}));

test("arbitrary IDs, duplicate IDs, missing acknowledgement and tampered snapshot tokens cannot authorize a repair",()=>fixture(async db=>{
 const p=await previewLegacyNormalization(db,now),body=request(p),before=await rows(db);
 const duplicate=structuredClone(body);duplicate.entries[0]=duplicate.entries[1];const arbitrary=structuredClone(body);arbitrary.entries[0].id=randomUUID();
 for(const input of [{...body,acknowledged:false},{...body,force:true},{...body,settings_hash:hash("wrong")},{...body,preview_fingerprint:hash("wrong")},duplicate,arbitrary,{...body,entries:body.entries.map((row,index)=>index?row:{...row,row_hash:hash("wrong")})},{...body,entries:body.entries.map((row,index)=>index?row:{...row,updated:"2026-10-23T02:47:38.846Z"})}])await assert.rejects(commitLegacyNormalization(db,input,now));
 assert.deepEqual(await rows(db),before);await noAudit(db);await assert.rejects(previewLegacyNormalization(db,()=>new Date("2026-12-01")),/future/);
}));

test("receipt inspection caps count and UTF-8 bytes before loading; malformed TEXT and unknown fields fail closed",()=>fixture(async db=>{
 const id=cases[0][0],unrelated=randomUUID();
 for(const mode of ["count","single-bytes","total-bytes","malformed","unknown"] as const){
  await db.query("DELETE FROM events WHERE kind='calendar_publication_approved'");
  const count=mode==="count"?1025:mode==="total-bytes"?17:1,detail=mode==="single-bytes"?"x".repeat(65537):mode==="total-bytes"?" ".repeat(65536):mode==="malformed"?'{"entry_id":':mode==="unknown"?JSON.stringify({entry_id:id}):publicationReceipt(unrelated);
  await db.query("INSERT INTO events(id,kind,detail) SELECT id::uuid,'calendar_publication_approved',$2 FROM unnest($1::text[]) AS fixture(id)",[Array.from({length:count},()=>randomUUID()),detail]);
  let loaded=false;const traced:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{if(sql.startsWith("SELECT id,detail")&&params?.[0]==="calendar_publication_approved")loaded=true;return tx.query(sql,params);}}))};
  await assert.rejects(previewLegacyNormalization(traced,now));if(["count","single-bytes","total-bytes"].includes(mode))assert.equal(loaded,false,mode+" must fail before loading TEXT history");await noAudit(db);
 }
}));


test("V2 and legacy scheduled publication receipts remain recognizable without rewriting their history",()=>fixture(async db=>{
 const unrelated=randomUUID();
 for(const receipt of [JSON.parse(publicationReceipt(unrelated)),{...JSON.parse(publicationReceipt(unrelated)),scheduler_policy_hash:null},{...JSON.parse(publicationReceipt(unrelated)),scheduler_policy_hash:null,...APPROVAL_PLAN_CONTRACT_V2}])await event(db,JSON.stringify(receipt));
 const before=await db.query("SELECT * FROM events ORDER BY id");
 await previewLegacyNormalization(db,now);
 assert.deepEqual(await db.query("SELECT * FROM events ORDER BY id"),before,"Read-only compatibility does not migrate legacy or V2 consent");
 await event(db,JSON.stringify({...JSON.parse(publicationReceipt(cases[0][0])),scheduler_policy_hash:null,...APPROVAL_PLAN_CONTRACT_V2}));
 await assert.rejects(previewLegacyNormalization(db,now),/publication approval history blocks/);await noAudit(db);
}));
