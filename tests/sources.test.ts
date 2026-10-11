import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {embedded,type Database} from "../lib/db";
import {CAPSULE,configReady,hash,type Pricing,type RuntimeConfig,type Source} from "../lib/domain";
import {SourceIntake,SOURCE_CLEARANCE_ACKNOWLEDGEMENT,SOURCE_MAX_LENGTH,sourceEligible,sourceAuthorized,ownerSourceEligible,validateSourceInput,assertSourcePrivacy} from "../lib/sources";
import {BASE_SCHEMA,PREFLIGHT_SCHEMA,REVISION_SCHEMA,CALENDAR_SCHEMA,PLATFORM_TIMING_SCHEMA,SOURCE_CLEARANCE_SCHEMA} from "../lib/schema";

const text="I built a local outline tool and caught an unsupported claim during review. The next version keeps each generated point attached to a source note.";
const input={text,category:"project-note",reported_date:"2026-10-10"};
const pricing:Pricing={model:"isolated-source-fixture",pricing_version:"test-only",pricing_tier:"standard",official_pricing_url:"https://example.test/pricing",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const standing:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),openai:pricing};
const legacy:RuntimeConfig={...standing,owner_cleared_sources_authorized:false,source_approved:true,approved_source_hash:hash(CAPSULE),transmission_authorized:true};
async function fixture(work:(sources:SourceIntake,db:Database)=>Promise<void>){const db=await embedded();try{await work(new SourceIntake(db),db);}finally{await db.close();}}

test("staging is local, preserves exact text, and does not grant clearance or enqueue work",()=>fixture(async(sources,db)=>{
  const exact={...input,text:"  "+text+"\n"};
  const source=await sources.stage(exact);
  assert.equal(source.text,exact.text);assert.equal(source.hash,hash(exact.text));assert.equal(source.cleared,false);
  assert.equal(source.clearance_id,null);assert.equal(source.clearance_owner_acknowledged,false);
  assert.equal(sourceEligible(source),false);assert.equal(sourceAuthorized(standing,source),false);
  for(const table of ["tasks","ledger","outputs"])assert.deepEqual(await db.query("SELECT * FROM "+table),[]);
  const events=await db.query<{kind:string;detail:string}>("SELECT * FROM events");assert.equal(events.length,1);assert.equal(events[0].kind,"source_staged");assert.equal(events[0].detail.includes(exact.text),false);
}));

test("source intake rejects excluded material, malformed metadata and oversize text before writing",()=>fixture(async(sources,db)=>{
  const excluded=["Bandhan note","bank operations","banking report","banks report","client update","clients note","private plan","confidential project","credentials sample","password=sample","API_KEY=sample","OPENAI_API_KEY=sample","DB_PASSWORD=sample","DATABASE_URL=sample",'"OPENAI_API_KEY": "sample"',"postgresql://user:value@host/db","access_token:sample","Bearer abcdefghijklmnop","sk-abcdefghijklmnop","AIza"+"a".repeat(25),"AKIA"+"A".repeat(16),"ghp_"+"a".repeat(25),"-----BEGIN RSA PRIVATE KEY-----","eyJabcdefghijk.abcdefghijkl.abcdefghijkl"];
  for(const value of excluded){assert.throws(()=>assertSourcePrivacy(value),/Excluded private/);await assert.rejects(sources.stage({...input,text:value}),/Excluded private/);}
  for(const value of [""," \n ","a".repeat(SOURCE_MAX_LENGTH+1),"界".repeat(11000),"bad\u0000note"])await assert.rejects(sources.stage({...input,text:value}),/Invalid source text/);
  for(const reported_date of ["2026-02-30","2026-13-01","2026-1-01","2026-10-10T12:00:00Z","2099-01-01"])await assert.rejects(sources.stage({...input,reported_date}),/Invalid source date/);
  for(const category of ["client-notes","private","",null])await assert.rejects(sources.stage({...input,category:category as string}),/Invalid source category/);
  validateSourceInput({...input,reported_date:"2024-02-29"});
  assert.deepEqual(await db.query("SELECT * FROM sources"),[]);assert.deepEqual(await db.query("SELECT * FROM events"),[]);
}));

test("exact hash and explicit owner acknowledgement are required and persisted with audit provenance",()=>fixture(async(sources,db)=>{
  const staged=await sources.stage(input);
  await assert.rejects(sources.clear(staged.id,staged.hash,false),/Explicit owner/);
  await assert.rejects(sources.clear(staged.id,staged.hash,"true" as unknown as boolean),/Explicit owner/);
  await assert.rejects(sources.clear(staged.id,hash("other"),true),/Stale source hash/);
  await assert.rejects(sources.clear(staged.id,"",true),/Exact source hash/);
  const cleared=await sources.clear(staged.id,staged.hash,true);
  assert.equal(cleared.cleared,true);assert.equal(cleared.clearance_hash,staged.hash);assert.equal(cleared.clearance_provider,"openai");assert.equal(cleared.clearance_purpose,"content-drafts-revisions");assert.equal(cleared.clearance_owner_acknowledged,true);assert.equal(cleared.clearance_acknowledgement,SOURCE_CLEARANCE_ACKNOWLEDGEMENT);assert.ok(cleared.cleared_at);assert.ok(cleared.clearance_id);
  assert.equal(sourceEligible(cleared,staged.hash),true);assert.equal(sourceEligible(cleared,hash("other")),false);assert.equal(sourceEligible(cleared,""),false);assert.equal(sourceEligible(cleared,staged.hash,"gemini"),false);
  const event=(await db.query<{kind:string;detail:string}>("SELECT * FROM events WHERE id=$1",[cleared.clearance_id]))[0];assert.equal(event.kind,"source_cleared");const detail=JSON.parse(event.detail);assert.equal(detail.actor,"owner");assert.equal(detail.owner_acknowledged,true);assert.equal(detail.source_hash,staged.hash);assert.equal(detail.provider,"openai");assert.equal(detail.acknowledgement,SOURCE_CLEARANCE_ACKNOWLEDGEMENT);
}));

test("clearance cannot be synthesized from a cleared flag or incomplete provenance",()=>fixture(async(sources,db)=>{
  const staged=await sources.stage(input);
  await db.query("UPDATE sources SET cleared=true WHERE id=$1",[staged.id]);
  const forged=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[staged.id]))[0];assert.equal(sourceEligible(forged),false);assert.equal(sourceAuthorized(standing,forged),false);
  const cleared=await sources.clear(staged.id,staged.hash,true);
  for(const patch of [{text:cleared.text+" altered"},{hash:hash("other")},{clearance_id:null},{clearance_hash:hash("other")},{clearance_provider:"gemini"},{clearance_purpose:"publishing"},{clearance_owner_acknowledged:false},{clearance_acknowledgement:"accepted"},{cleared_at:null},{cleared_at:"invalid"},{revoked_at:new Date().toISOString()},{cleared:false}])assert.equal(sourceEligible({...cleared,...patch}),false,JSON.stringify(patch));
  await db.query("UPDATE sources SET text=$2 WHERE id=$1",[staged.id,staged.text+" changed"]);
  const tampered=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[staged.id]))[0];assert.equal(sourceEligible(tampered),false);await assert.rejects(sources.clear(staged.id,staged.hash,true),/Stale source hash/);
}));

test("repeated actions are idempotent; revoke preserves provenance and requires a new explicit clearance",()=>fixture(async(sources,db)=>{
  const staged=await sources.stage(input),duplicate=await sources.stage(input);assert.equal(duplicate.id,staged.id);
  await assert.rejects(sources.stage({...input,category:"build-log"}),/different metadata/);
  const cleared=await sources.clear(staged.id,staged.hash,true),same=await sources.clear(staged.id,staged.hash,true);assert.equal(same.clearance_id,cleared.clearance_id);
  await assert.rejects(sources.revoke(staged.id,hash("other")),/Stale source hash/);
  const revoked=await sources.revoke(staged.id,staged.hash);assert.equal(revoked.cleared,false);assert.ok(revoked.revoked_at);assert.equal(revoked.clearance_id,cleared.clearance_id);assert.equal(sourceEligible(revoked),false);assert.equal(sourceAuthorized(standing,revoked),false);
  await sources.revoke(staged.id,staged.hash);
  const restaged=await sources.stage(input);assert.equal(restaged.cleared,false);assert.equal(restaged.clearance_id,cleared.clearance_id);
  await assert.rejects(sources.clear(staged.id,staged.hash,false),/Explicit owner/);
  const again=await sources.clear(staged.id,staged.hash,true);assert.equal(sourceEligible(again),true);assert.notEqual(again.clearance_id,cleared.clearance_id);assert.equal(again.revoked_at,null);
  const events=await db.query<{kind:string}>("SELECT * FROM events ORDER BY created,id");assert.deepEqual(events.map(event=>event.kind),["source_staged","source_cleared","source_clearance_revoked","source_cleared"]);
}));

test("standing readiness never broadens legacy source consent or enables unreviewed sources",()=>fixture(async(sources)=>{
  assert.equal(configReady(standing),true);assert.equal(configReady(legacy),true);assert.equal(configReady({...standing,owner_cleared_sources_authorized:false}),false);
  assert.equal(configReady({...standing,owner_cleared_sources_authorized:"true" as unknown as boolean}),false);
  for(const patch of [{credential_use_authorized:false},{security_tests_passed:false},{pricing_verified_date:"2000-01-01"},{openai:undefined},{openai:{...pricing,pricing_tier:"priority"}}])assert.equal(configReady({...standing,...patch} as RuntimeConfig),false);
  const staged=await sources.stage(input),cleared=await sources.clear(staged.id,staged.hash,true);
  assert.equal(sourceAuthorized(standing,cleared),true);assert.equal(ownerSourceEligible(cleared),true);assert.equal(sourceAuthorized(standing,cleared,"unknown"),false);assert.equal(sourceAuthorized(standing,cleared,"gemini"),false);assert.equal(sourceAuthorized({...standing,fallback_authorized:true,gemini:pricing},cleared,"gemini"),false);assert.equal(sourceAuthorized(legacy,cleared),false);
  const capsule:Source={id:randomUUID(),text:CAPSULE,category:"user-reported-notes",reported_date:"2026-10-09",hash:hash(CAPSULE),cleared:true};
  assert.equal(sourceEligible(capsule),true);assert.equal(ownerSourceEligible(capsule),false);assert.equal(sourceAuthorized(legacy,capsule),true);assert.equal(sourceAuthorized(legacy,capsule,"gemini"),false);assert.equal(sourceAuthorized({...legacy,fallback_authorized:true,gemini:pricing},capsule,"gemini"),true);assert.equal(sourceAuthorized(standing,capsule),false);
  assert.equal(sourceAuthorized({...legacy,approved_source_hash:hash("other")},capsule),false);assert.equal(sourceAuthorized({...legacy,transmission_authorized:false},capsule),false);
  for(const patch of [{category:"project-note"},{reported_date:"2026-10-10"},{text:CAPSULE+" extra"},{hash:hash("other")}])assert.equal(sourceEligible({...capsule,...patch}),false);
  const stagedCapsule=await sources.stage({text:CAPSULE,category:"user-reported-notes",reported_date:"2026-10-09"});const ownerCapsule=await sources.clear(stagedCapsule.id,stagedCapsule.hash,true);assert.equal(sourceAuthorized(standing,ownerCapsule),true);
  assert.equal(sourceAuthorized(legacy,ownerCapsule),false);assert.equal(sourceEligible(ownerCapsule,ownerCapsule.hash,"gemini"),false);assert.equal(sourceAuthorized({...legacy,owner_cleared_sources_authorized:true,fallback_authorized:true,gemini:pricing},ownerCapsule,"gemini"),false);
  assert.equal(sourceEligible({...capsule,clearance_owner_acknowledged:true}),false);assert.equal(sourceAuthorized(legacy,{...capsule,clearance_hash:hash(CAPSULE)}),false);
}));

test("source clearance migration matches schema and upgrades old databases without granting clearance",async()=>{
  assert.equal(await readFile("migrations/006_source_clearance.sql","utf8"),SOURCE_CLEARANCE_SCHEMA);
  const db=new PGlite();try{
    await db.exec(BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA+CALENDAR_SCHEMA+PLATFORM_TIMING_SCHEMA);
    const legacyId=randomUUID(),unsafeId=randomUUID();
    await db.query("INSERT INTO sources(id,text,category,reported_date,cleared,hash) VALUES($1,$2,'user-reported-notes','2026-10-09',true,$3),($4,$5,'project-note','2026-10-10',true,$6)",[legacyId,CAPSULE,hash(CAPSULE),unsafeId,text,hash(text)]);
    const before=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[legacyId])).rows[0];
    await db.exec(SOURCE_CLEARANCE_SCHEMA);await db.exec(SOURCE_CLEARANCE_SCHEMA);
    const after=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[legacyId])).rows[0];for(const [key,value] of Object.entries(before))assert.deepEqual(after[key as keyof Source],value);
    assert.equal(after.clearance_owner_acknowledged,false);assert.equal(after.clearance_id,null);assert.equal(sourceEligible(after),true);
    const unsafe=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[unsafeId])).rows[0];assert.equal(sourceEligible(unsafe),false);
    assert.equal((await db.query("SELECT * FROM events")).rows.length,0);assert.equal((await db.query("SELECT * FROM schema_versions WHERE version=6")).rows.length,1);
  }finally{await db.close();}
});

test("cleared source and revoked evidence survive isolated close and reopen",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"studio-source-test-"));let db=await embedded(dir);
  try{
    let sources=new SourceIntake(db);const staged=await sources.stage(input),cleared=await sources.clear(staged.id,staged.hash,true);
    await db.close();db=await embedded(dir);sources=new SourceIntake(db);
    const restored=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[staged.id]))[0];assert.equal(restored.clearance_id,cleared.clearance_id);assert.equal(sourceAuthorized(standing,restored),true);
    await sources.revoke(staged.id,staged.hash);await db.close();db=await embedded(dir);
    const revoked=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[staged.id]))[0];assert.equal(revoked.cleared,false);assert.equal(sourceEligible(revoked),false);assert.equal(revoked.clearance_id,cleared.clearance_id);assert.equal((await db.query("SELECT * FROM events")).length,3);
  }finally{await db.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith("studio-source-test-"));await rm(dir,{recursive:true,force:true});}
});

test("concurrent duplicate stage, clear and revoke retain one audit event per state change",()=>fixture(async(sources,db)=>{
  const staged=await Promise.all(Array.from({length:8},()=>sources.stage(input)));assert.equal(new Set(staged.map(source=>source.id)).size,1);
  const source=staged[0],cleared=await Promise.all(Array.from({length:8},()=>sources.clear(source.id,source.hash,true)));assert.equal(new Set(cleared.map(item=>item.clearance_id)).size,1);
  await Promise.all(Array.from({length:8},()=>sources.revoke(source.id,source.hash)));
  const events=await db.query<{kind:string}>("SELECT kind FROM events ORDER BY created,id");assert.deepEqual(events.map(event=>event.kind),["source_staged","source_cleared","source_clearance_revoked"]);
}));

test("embedded reopen applies the additive clearance schema to a persisted pre-clearance database",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"studio-source-upgrade-test-"));const old=new PGlite(dir);let db:Database|undefined;
  try{
    await old.exec(BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA+CALENDAR_SCHEMA+PLATFORM_TIMING_SCHEMA);
    const id=randomUUID();await old.query("INSERT INTO sources(id,text,category,reported_date,cleared,hash) VALUES($1,$2,'user-reported-notes','2026-10-09',true,$3)",[id,CAPSULE,hash(CAPSULE)]);await old.close();
    db=await embedded(dir);const legacySource=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[id]))[0];
    assert.equal(legacySource.text,CAPSULE);assert.equal(legacySource.cleared,true);assert.equal(legacySource.clearance_id,null);assert.equal(legacySource.clearance_owner_acknowledged,false);assert.equal(sourceAuthorized(legacy,legacySource),true);assert.equal(sourceAuthorized(standing,legacySource),false);assert.deepEqual(await db.query("SELECT * FROM events"),[]);
  }finally{if(db)await db.close();else if(!old.closed)await old.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith("studio-source-upgrade-test-"));await rm(dir,{recursive:true,force:true});}
});
