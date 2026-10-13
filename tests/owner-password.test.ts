import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {embedded,type Database} from "../lib/db";
import {OWNER_ID,provisionOwner,createOwnerAuth,handleOwnerAuth,passwordOwnerAuthenticated,consumeOwnerLogin} from "../lib/owner-password";
import {PASSWORD_SCHEMA} from "../lib/password-schema";
import {assertSchemaParity} from "./schema-parity";
const origin="http://127.0.0.1:3110",password="4729183065",env={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-auth-signing-fixture-"+"a".repeat(32)};
const request=(action:string,body:unknown={},cookie?:string,from=origin)=>new Request(origin+"/api/auth/"+action,{method:"POST",headers:{Origin:from,Host:"127.0.0.1:3110","Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
async function fixture(work:(db:Database)=>Promise<void>){const db=await embedded();try{await work(db);}finally{await db.close();}}
const login=(db:Database,chosen=password)=>handleOwnerAuth(request("login",{password:chosen}),"login",env,async()=>db);
function cookie(result:Response){return result.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");}

test("password schema is additive, exact apart from CRLF, and never seeds an owner",()=>fixture(async db=>{
 assertSchemaParity(await readFile("migrations/010_owner_password.sql","utf8"),PASSWORD_SCHEMA);assert.doesNotMatch(PASSWORD_SCHEMA,/DROP|DELETE|TRUNCATE/);assert.equal((await db.query("SELECT * FROM studio_auth_user")).length,0);assert.equal((await db.query("SELECT * FROM studio_auth_session")).length,0);
}));
test("setup requires explicit authorization and stores salted hashes; concurrent setup cannot overwrite",()=>fixture(async db=>{
 await assert.rejects(provisionOwner(db,password,false),/authorization/);await assert.rejects(provisionOwner(db,"123",true),/ten digits/);
 const results=await Promise.allSettled([provisionOwner(db,password,true),provisionOwner(db,"9182736450",true)]);assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
 const accounts=await db.query<{password:string}>("SELECT password FROM studio_auth_account");assert.equal(accounts.length,1);assert.notEqual(accounts[0].password,password);assert.match(accounts[0].password,/^[a-f0-9]{32}:[a-f0-9]{128}$/);await assert.rejects(provisionOwner(db,password,true),/already exists/);
 assert.equal((await db.query("SELECT * FROM sources")).length,0);
}));
test("missing setup and public signup fail closed, without granting first visitor ownership",()=>fixture(async db=>{
 assert.equal((await login(db)).status,503);assert.equal((await handleOwnerAuth(request("sign-up",{password}),"sign-up",env,async()=>db)).status,404);
 assert.equal((await handleOwnerAuth(new Request(origin+"/api/auth/status"),"status",{},async()=>db)).status,503);assert.equal((await db.query("SELECT * FROM studio_auth_user")).length,0);
}));
test("library login issues HttpOnly strict cookies; JSON hides tokens/password; session expires and logout revokes",()=>fixture(async db=>{
 await provisionOwner(db,password,true);assert.equal((await login(db,"8273645910")).status,401);
 const result=await login(db);assert.equal(result.status,200);const payload=JSON.stringify(await result.clone().json());assert.equal(payload.includes(password),false);assert.equal(payload.includes("token"),false);assert(result.headers.getSetCookie().some(value=>/HttpOnly/i.test(value)&&/SameSite=Strict/i.test(value)));
 const savedCookie=cookie(result),protectedRequest=new Request(origin+"/api/studio/state",{headers:{Cookie:savedCookie,Host:"127.0.0.1:3110"}});assert(await passwordOwnerAuthenticated(protectedRequest,env,async()=>db));
 const session=(await db.query<any>('SELECT * FROM studio_auth_session'))[0];assert(new Date(session.expiresAt).getTime()-new Date(session.createdAt).getTime()<=8*3600000+1000);assert.equal(session.userId,OWNER_ID);
 await db.query('UPDATE studio_auth_session SET "expiresAt"=$1',[new Date(0)]);assert.equal(await passwordOwnerAuthenticated(protectedRequest,env,async()=>db),false);
 const second=await login(db),secondCookie=cookie(second);assert.equal((await handleOwnerAuth(request("logout",{},secondCookie),"logout",env,async()=>db)).status,200);assert.equal(await passwordOwnerAuthenticated(new Request(origin+"/api/studio/state",{headers:{Cookie:secondCookie}}),env,async()=>db),false);
}));
test("exact origin/host rejects login/logout CSRF without consuming allowance or granting a session",()=>fixture(async db=>{
 await provisionOwner(db,password,true);const auth=async(input:Request)=>handleOwnerAuth(input,"login",env,async()=>db);
 assert.equal((await auth(request("login",{password},undefined,"https://evil.example"))).status,403);
 assert.equal((await auth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"evil.example"},body:JSON.stringify({password})}))).status,403);
 const count=(await db.query<{attempts:number}>("SELECT attempts FROM studio_owner_login_guard"))[0].attempts;assert.equal(count,0);assert.equal((await db.query("SELECT * FROM studio_auth_session")).length,0);
}));
test("global durable login allowance is atomic across instances, cannot be bypassed by IP, and survives restart",async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),"owner-auth-test-"));let db=await embedded(path.join(folder,"db"));try{
  const results=await Promise.all(Array.from({length:12},()=>consumeOwnerLogin(db)));assert.equal(results.filter(result=>result.allowed).length,5);assert(results.filter(result=>!result.allowed).every(result=>result.retryAfter>0));await db.close();db=await embedded(path.join(folder,"db"));assert.equal((await consumeOwnerLogin(db)).allowed,false);const started=(await db.query<any>("SELECT window_started FROM studio_owner_login_guard"))[0].window_started;assert.equal((await consumeOwnerLogin(db,new Date(new Date(started).getTime()+900001))).allowed,true);
 }finally{await db.close();await rm(folder,{recursive:true,force:true});}
});
test("unknown endpoints cannot bypass global guard and hosted auth never falls back to PGlite or weak secret",()=>fixture(async db=>{
 await provisionOwner(db,password,true);for(const action of ["sign-in/email","sign-up/email","reset-password","change-password"]){assert.equal((await handleOwnerAuth(request(action,{password}),action,env,async()=>db)).status,404);}
 assert.throws(()=>createOwnerAuth(db,{...env,STUDIO_AUTH_SECRET:password}),/setup missing/);
 assert.throws(()=>createOwnerAuth(db,{...env,VERCEL:"1",VERCEL_ENV:"production",STUDIO_LOCAL_DB:"1"}),/setup missing/);
}));
