import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {embedded,type Database} from "../lib/db";
import {provisionOwner,handleOwnerAuth,passwordOwnerAuthenticated} from "../lib/owner-password";
import {response} from "../lib/auth";
import * as normalization from "../lib/calendar-legacy-normalization";

const origin="http://127.0.0.1:3196",clock=()=>new Date("2026-10-24T17:51:37.414Z");
const cases=[
 ["e15dbb66-c3f9-4141-8b94-544e14349b46","2026-11-02","shortform","03:30","16:30","13:30"],
 ["c2aed4a0-1257-4faa-ac59-090e5d838a28","2026-11-04","shortform","04:30","10:30","06:30"],
 ["b57e284f-ffc5-4162-9b9d-8398b554eb39","2026-11-06","shortform","03:30","09:30","16:30"],
 ["183af62f-c135-474b-b6d6-0fe77dc24c4e","2026-11-08","longform","03:30","16:30","15:30"]
];
const shift=(post:string,h:number)=>new Date(Date.parse(post)+h*3600000).toISOString(),part=(post:string)=>({draft_due:shift(post,-48),intended_post:post,review_due:shift(post,-48)});
async function seed(db:Database){
 await db.query("UPDATE calendar_settings SET timezone='Asia/Kolkata',short_days='[1,3,5]',long_day=0,review_hours=48,start_date='2026-11-02',post_time=NULL,generation_lead_hours=120,generation_enabled=false,timing_mode='per_platform',platform_times=$1::jsonb,timing_basis='india-first-buffer-hypothesis-v1',updated='2026-10-24T07:27:03.211Z' WHERE id=1",[JSON.stringify({LinkedIn:{"0":"22:00","1":"22:00","3":"16:00","5":"15:00"}})]);
 for(const [id,date,kind,old,li,ig] of cases){const post=date+"T"+old+":00.000Z";await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule,updated) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'2026-10-23T02:47:37.846Z')",[id,date,kind,post,shift(post,-48),shift(post,-120),JSON.stringify({Instagram:part(date+"T"+ig+":00.000Z"),LinkedIn:part(date+"T"+li+":00.000Z"),X:part(post)})]);}
}

test("preview and commit require the actual live owner cookie and exact Origin; exact commit/replay never invokes providers",async()=>{
 const db=await embedded(),oldOrigin=process.env.STUDIO_ORIGIN,oldFetch=globalThis.fetch;
 const env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-normalization-owner-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-normalization-worker-"+"y".repeat(40)};
 process.env.STUDIO_ORIGIN=origin;globalThis.fetch=async()=>assert.fail("No network request is permitted");
 try{
  await seed(db);const password="6728194035";await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3196","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  // Run the real route and owner authentication. Only its DB provider and helper
  // clock are injected, so the fixed one-off November scope stays deterministic.
  let previews=0,commits=0,busy=false;
  const busyDb:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{if(sql.includes("FROM public.calendar_entries")&&sql.endsWith("NOWAIT"))throw Object.assign(Error("Simulated contention"),{code:"55P03"});return tx.query(sql,params);}}))};
  const compiled=ts.transpileModule(readFileSync(new URL("../app/api/calendar/normalize-legacy/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,exports:Record<string,any>={};
  new Function("require","exports",compiled)((name:string)=>{
   if(name.endsWith("/owner-password"))return {passwordOwnerAuthenticated:(request:Request)=>passwordOwnerAuthenticated(request,env,async()=>db)};
   if(name.endsWith("/db"))return {database:async()=>busy?busyDb:db};if(name.endsWith("/auth"))return {response};
   if(name.endsWith("/calendar-legacy-normalization"))return {...normalization,previewLegacyNormalization:(value:Database)=>{previews++;return normalization.previewLegacyNormalization(value,clock);},commitLegacyNormalization:(value:Database,body:unknown)=>{commits++;return normalization.commitLegacyNormalization(value,body,clock);}};
   throw Error("Unexpected route import");
  },exports);
  const call=(payload:unknown,session=cookie,from=origin,worker=false,method="POST")=>exports.POST(new Request(origin+"/api/calendar/normalize-legacy",{method,headers:{Cookie:session,Origin:from,Host:"127.0.0.1:3196","Content-Type":"application/json",...(worker?{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN}:{})},...(method==="POST"?{body:typeof payload==="string"?payload:JSON.stringify(payload)}:{})})) as Promise<Response>;
  for(const payload of [{action:"preview"},{action:"commit",acknowledged:true}]){
   assert.equal((await call(payload,"")).status,401);assert.equal((await call(payload,"",origin,true)).status,401);assert.equal((await call(payload,cookie+"corrupt")).status,401);
   assert.equal((await call(payload,cookie,"https://other.example.test")).status,403);assert.equal((await call(payload,cookie,"")).status,403);
  }
  assert.equal(previews,0);assert.equal(commits,0);assert.equal((await call({},cookie,origin,false,"GET")).status,405);
  for(const payload of [null,[],{},"{",'{"action":"preview","action":"preview"}',{action:"preview",ids:[randomUUID()]},{action:"unknown"}," ".repeat(4097)])assert.equal((await call(payload)).status,409);
  const preview=await call({action:"preview"});assert.equal(preview.status,200);const p=(await preview.json()).result;
  const body={action:"commit",settings_hash:p.settings_hash,entries:p.entries,preview_fingerprint:p.preview_fingerprint,acknowledged:true};
  busy=true;for(const payload of [{action:"preview"},body]){const locked=await call(payload);assert.equal(locked.status,409);assert.match((await locked.json()).error,/entries are busy.*fresh preview/);}busy=false;
  assert.equal((await call({...body,acknowledged:false})).status,409);assert.equal((await call({...body,enable_generation:true})).status,409);
  const arbitrary=structuredClone(body);arbitrary.entries[0].id=randomUUID();assert.equal((await call(arbitrary)).status,409);
  assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[normalization.NORMALIZATION_EVENT])).length,0);
  const first=await call(body);assert.equal(first.status,200);const result=(await first.json()).result;assert.equal(result.status,"applied");assert.equal(result.paid_execution,false);
  const saved=JSON.stringify(await db.query("SELECT * FROM calendar_entries ORDER BY id")),replay=await call(body);assert.equal(replay.status,200);const repeated=(await replay.json()).result;assert.equal(repeated.status,"already_applied");assert.equal(repeated.audit_id,result.audit_id);assert.equal(JSON.stringify(await db.query("SELECT * FROM calendar_entries ORDER BY id")),saved);
  assert.equal((await db.query("SELECT * FROM events WHERE kind=$1",[normalization.NORMALIZATION_EVENT])).length,1);assert.equal((await db.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings"))[0].generation_enabled,false);
  for(const table of ["sources","tasks","ledger","calendar_jobs","github_source_grants","approvals","publishing_outbox","publishing_approvals","publishing_attempts"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table);
  const logout=await handleOwnerAuth(new Request(origin+"/api/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:"{}"}),"logout",env,async()=>db);assert.equal(logout.status,200);assert.equal((await call({action:"preview"})).status,401);assert.equal((await call(body)).status,401);
 }finally{globalThis.fetch=oldFetch;if(oldOrigin===undefined)delete process.env.STUDIO_ORIGIN;else process.env.STUDIO_ORIGIN=oldOrigin;await db.close();}
});
