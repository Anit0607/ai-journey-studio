// Isolated browser test; no provider credentials, tokens from users or live DB access.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root=path.resolve("../calendar-qa-temp-"),directory=await mkdtemp(root),origin="http://127.0.0.1:3103",token="isolated-calendar-owner-token-0000000000";
const server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3103"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:path.join(directory,"db"),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready);
  assert.equal((await fetch(origin+"/api/studio/calendar-plan",{method:"POST",headers:{Authorization:"Bearer "+token},body:'{"weeks":1}'})).status,403);
  assert.equal((await fetch(origin+"/api/studio/calendar-configure",{method:"POST",headers:{Origin:origin,Authorization:"Bearer wrong"},body:"{}"})).status,401);
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(origin);await page.getByLabel("Session access token").fill(token);await page.getByRole("button",{name:"Unlock studio"}).click();await page.getByRole("button",{name:"Calendar",exact:true}).click();
    await page.getByRole("heading",{name:"No calendar entries yet"}).waitFor();assert.equal(await page.getByLabel("Calendar start date").inputValue(),"");assert.equal(await page.getByLabel("X Wednesday time IST").inputValue(),"");assert(await page.getByRole("button",{name:"Create or update planned dates"}).isDisabled());
    await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/calendar-unset-qa.png",fullPage:true});
    await page.locator("summary").filter({hasText:"India-first engagement benchmark"}).click();await page.getByRole("button",{name:"Load benchmark into form — not saved",exact:true}).click();assert.equal(await page.getByLabel("X Wednesday time IST").inputValue(),"10:00");const unsaved=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.deepEqual(unsaved.calendar.settings.platform_times,{});assert.equal(unsaved.calendar.settings.start_date,null);await page.getByLabel("Calendar start date").fill("2026-10-14");await page.getByLabel("Generation lead hours").fill("72");await page.getByRole("button",{name:"Save calendar settings",exact:true}).click();
    await page.getByRole("button",{name:"Create or update planned dates"}).click();await page.getByRole("heading",{name:/2026-10-14/}).waitFor();
    await page.getByRole("button",{name:/Check due queue/}).click();await page.screenshot({path:"artifacts/calendar-planned-qa.png",fullPage:true});
    const state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.equal(state.calendar.entries.length,4);assert(state.calendar.entries.every((entry:any)=>entry.source_id===null&&entry.task_id===null));assert.equal(state.tasks.length,0);assert.equal(state.outputs.length,0);assert.equal(state.ledger.length,0);assert.equal(state.calendar.paid_activation,false);assert.deepEqual(errors,[]);
    console.log("PASS: unset timing, explicit saved cadence/IST dates, four isolated intents, auth/origin rejection, zero content/model calls");
  }finally{await browser.close();}
}finally{server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});assert.equal(path.dirname(directory),path.dirname(root));assert(path.basename(directory).startsWith("calendar-qa-temp-"));await rm(directory,{recursive:true,force:true});}
