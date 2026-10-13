// Isolated owner password fixture only. Never opens real data or calls providers.
import {chromium,type Browser} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {provisionOwner} from "../lib/owner-password";
const folder=await mkdtemp(path.join(os.tmpdir(),"studio-password-qa-")),location=path.join(folder,"db"),origin="http://127.0.0.1:3112",password="4729183065";
let server:ChildProcess|undefined,browser:Browser|undefined;const errors:string[]=[];
async function stop(){if(!server)return;const child=server;server=undefined;child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once("exit",()=>resolve());});}
async function start(){server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3112"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:"isolated-worker-fixture-"+"k".repeat(32),STUDIO_AUTH_SECRET:"isolated-password-fixture-"+"s".repeat(32),STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:location,STUDIO_RUNTIME_CONFIG:"{}",STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});for(let attempt=0;attempt<120;attempt++){try{if((await fetch(origin)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw Error("Isolated password server not ready");}
async function fixtureEdit(work:(db:Awaited<ReturnType<typeof embedded>>)=>Promise<void>){assert(!server);const db=await embedded(location);try{await work(db);}finally{await db.close();}}
try{
 await fixtureEdit(async db=>{await provisionOwner(db,password,true);});await start();
 browser=await chromium.launch({headless:true,...(process.argv.includes("--edge")?{channel:"msedge"}:{})});const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
 const login=async(value:string)=>{await page.getByLabel("Owner password",{exact:true}).fill(value);await page.getByRole("button",{name:"Sign in",exact:true}).click();};
 assert.equal((await fetch(origin+"/api/studio/state")).status,401);await page.goto(origin);await page.getByRole("button",{name:"Sign in",exact:true}).waitFor();assert.equal(await page.getByLabel("Session access token").count(),0);assert.equal((await page.content()).includes("no remote deployment"),false);
 await login("8273645910");await page.getByRole("alert").filter({hasText:"Invalid password"}).waitFor();assert.equal(await page.getByLabel("Owner password",{exact:true}).inputValue(),"");
 await login(password);await page.getByRole("heading",{name:"Secure setup is pending",exact:true}).waitFor();await page.getByText("No tasks or drafts yet",{exact:true}).waitFor();
 assert((await context.cookies()).some(cookie=>cookie.httpOnly&&cookie.sameSite==="Strict"));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.equal((await page.request.post(origin+"/api/studio/source-stage",{headers:{Origin:"https://other.example","Content-Type":"application/json"},data:{text:"Isolated fixture",category:"project-note",reported_date:"2026-10-10"}})).status(),403);
 assert.equal((await page.request.post(origin+"/api/auth/sign-up/email",{data:{email:"other@example.test",password}})).status(),404);
 await stop();await start();await page.reload();await page.getByRole("heading",{name:"Secure setup is pending",exact:true}).waitFor();
 await stop();await fixtureEdit(async db=>{await db.query('UPDATE studio_auth_session SET "expiresAt"=$1',[new Date(0)]);});await start();await page.reload();await page.getByLabel("Owner password",{exact:true}).waitFor();assert.equal((await page.request.get(origin+"/api/studio/state")).status(),401);
 await login(password);await page.getByRole("button",{name:"Sign out",exact:true}).waitFor();await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByLabel("Owner password",{exact:true}).waitFor();assert.equal((await page.request.get(origin+"/api/studio/state")).status(),401);
 const attempts=await Promise.all(Array.from({length:9},(_value,index)=>page.request.post(origin+"/api/auth/login",{headers:{Origin:origin,"X-Forwarded-For":"192.0.2."+(index+1)},data:{password:"8273645910"}})));assert(attempts.some(result=>result.status()===401));assert(attempts.some(result=>result.status()===429));assert(attempts.every(result=>[401,429].includes(result.status())));
 await stop();await fixtureEdit(async db=>{assert.equal((await db.query<{attempts:number}>("SELECT attempts FROM studio_owner_login_guard"))[0].attempts,5);});await start();assert.equal((await page.request.post(origin+"/api/auth/login",{headers:{Origin:origin},data:{password}})).status(),429);
 await page.reload();await login(password);await page.getByRole("alert").filter({hasText:"Too many attempts"}).waitFor();await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/password-lockout-qa.png",fullPage:true});
 await stop();await fixtureEdit(async db=>{await db.query("UPDATE studio_owner_login_guard SET window_started=$1",[new Date(Date.now()-16*60000)]);await db.query("DELETE FROM studio_auth_rate_limit");});await start();await page.reload();await login(password);await page.getByRole("heading",{name:"Secure setup is pending",exact:true}).waitFor();
 const state=await (await page.request.get(origin+"/api/studio/state")).json();for(const table of ["sources","tasks","outputs","ledger","approvals","events"])assert.equal(state[table].length,0);assert.equal(state.live_enabled,false);assert.deepEqual(errors,[]);await page.screenshot({path:"artifacts/password-empty-qa.png",fullPage:true});
 await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByLabel("Owner password",{exact:true}).waitFor();
 console.log("PASS: rendered ten-digit login, failed attempts, cookie reload/restart, expired cookies, logout, CSRF, unauthenticated API, cross-IP concurrent lockout and restart persistence; zero content/provider calls");
}finally{await browser?.close();await stop();assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith("studio-password-qa-"));await rm(folder,{recursive:true,force:true});}
