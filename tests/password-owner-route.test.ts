import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {GET,POST} from "../app/api/studio/[action]/route";

test("real studio route uses cookies, rejects tampering/CSRF, and never bypasses source clearance",async()=>{
 const db=await embedded(),origin="http://127.0.0.1:3111",password="6728194035",secret="isolated-route-auth-secret-"+"x".repeat(32);
 const globals=globalThis as typeof globalThis&{studioDb?:Promise<any>};globals.studioDb=Promise.resolve(db);
 process.env.STUDIO_ORIGIN=origin;process.env.STUDIO_AUTH_SECRET=secret;process.env.STUDIO_RUNTIME_CONFIG="{}";process.env.STUDIO_ACCESS_TOKEN="isolated-worker-token-"+"b".repeat(32);process.env.OPENAI_API_KEY="";process.env.GEMINI_API_KEY="";
 try{
  await provisionOwner(db,password,true);
  const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3111","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",{STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret},async()=>db);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const get=(value:string)=>GET(new Request(origin+"/api/studio/state",{headers:{Cookie:value,Host:"127.0.0.1:3111"}}),{params:Promise.resolve({action:"state"})});
  assert.equal((await get(cookie)).status,200);assert.equal((await get(cookie+"corrupt")).status,401);
  const stage=(from:string)=>POST(new Request(origin+"/api/studio/source-stage",{method:"POST",headers:{Cookie:cookie,Origin:from,Host:"127.0.0.1:3111","Content-Type":"application/json"},body:JSON.stringify({text:"Isolated cookie-authentication test fixture.",category:"project-note",reported_date:"2026-10-10"})}),{params:Promise.resolve({action:"source-stage"})});
  assert.equal((await stage("https://other.example")).status,403);assert.equal((await stage(origin)).status,200);
  const source=(await db.query<any>("SELECT * FROM sources"))[0];assert.equal(source.cleared,false);assert.equal((await db.query("SELECT * FROM ledger")).length,0);
  process.env.STUDIO_AUTH_SECRET="different-isolated-secret-"+"z".repeat(32);assert.equal((await get(cookie)).status,401);
 }finally{delete globals.studioDb;await db.close();}
});
