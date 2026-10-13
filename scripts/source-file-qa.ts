// Isolated chooser regression QA; no real note, DB, key, clearance or provider.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const directory=await mkdtemp(path.join(os.tmpdir(),"sourcefile-browser-")),origin="http://127.0.0.1:3105",token="isolated-sourcefile-token-000000000000000";
const server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3105"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:path.join(directory,"db"),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
try{
 let ready=false;for(let n=0;n<120;n++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready);
 const browser=await chromium.launch({headless:true,...(process.argv.includes("--edge")?{channel:"msedge"}:{})});try{
  const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);await page.getByLabel("Session access token").fill(token);await page.getByRole("button",{name:"Unlock studio"}).click();await page.getByRole("button",{name:"Sources",exact:true}).click();
  const text=page.getByLabel("Project note",{exact:true}),date=page.getByLabel("Reported date",{exact:true}),kind=page.getByLabel("Note type",{exact:true}),chooser=page.getByLabel("Choose a prepared source file (.txt or .json)");
  const initial="Isolated automated QA fixture: preserve my typed note.",imported="Isolated automated QA fixture: a reviewed source stays uncleared.";
  await text.fill(initial);await date.fill("2026-10-10");await kind.selectOption("build-log");
  const state=async()=>await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();
  async function select(name:string,content:string){await chooser.setInputFiles({name,mimeType:name.endsWith(".json")?"application/json":"text/plain",buffer:Buffer.from(content)});}
  await select("fixture.txt",imported);await page.getByRole("heading",{name:"File preview: fixture.txt",exact:true}).waitFor();assert.equal(await text.inputValue(),initial);assert(await page.getByRole("button",{name:"Use this file in the form",exact:true}).isDisabled());assert.equal((await state()).sources.length,0);
  await page.getByRole("button",{name:"Discard file preview",exact:true}).click();assert.equal(await text.inputValue(),initial);assert.equal(await date.inputValue(),"2026-10-10");assert.equal(await kind.inputValue(),"build-log");
  await select("fixture.txt",imported);await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Use this file in the form",exact:true}).click();assert.equal(await text.inputValue(),imported);assert.equal(await date.inputValue(),"2026-10-10");assert.equal(await kind.inputValue(),"build-log");assert.equal((await state()).sources.length,0);
  await select("fixture.json",JSON.stringify({text:initial,category:"project-note",reported_date:"2026-10-11"}));await page.getByRole("heading",{name:"File preview: fixture.json",exact:true}).waitFor();assert(await page.getByRole("button",{name:"Use this file in the form",exact:true}).isDisabled());await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Use this file in the form",exact:true}).click();assert.equal(await text.inputValue(),initial);assert.equal(await date.inputValue(),"2026-10-11");assert.equal(await kind.inputValue(),"project-note");
  for(const content of ["{",JSON.stringify({text:imported,category:"project-note",reported_date:"2026-10-11",unexpected:true}),"x".repeat(100000)]){
    await select("invalid.json",content);await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).waitFor();assert.equal(await text.inputValue(),initial);assert.equal(await date.inputValue(),"2026-10-11");assert.equal(await kind.inputValue(),"project-note");assert.equal((await state()).sources.length,0);
  }
  await page.getByRole("button",{name:/Stage note/}).click();await page.getByRole("button",{name:"Clear this exact note for OpenAI",exact:true}).waitFor();const snapshot=await state();assert.equal(snapshot.sources.length,1);assert.equal(snapshot.sources[0].text,initial);assert.equal(snapshot.sources[0].cleared,false);assert.equal(snapshot.sources[0].clearance_id,null);for(const table of ["tasks","outputs","ledger","approvals"])assert.equal(snapshot[table].length,0);assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].kind,"source_staged");assert.deepEqual(errors,[]);
  // Regression: successful staging clears an earlier import failure, not just the form.
  await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).waitFor({state:"hidden"});assert.deepEqual((await page.getByRole("alert").allTextContents()).filter(message=>message.trim()),[]);
  await select("invalid.json","{");await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).waitFor();
  await select("valid.json",JSON.stringify({text:imported,category:"project-note",reported_date:"2026-10-11"}));await page.getByRole("heading",{name:"File preview: valid.json",exact:true}).waitFor();assert.deepEqual((await page.getByRole("alert").allTextContents()).filter(message=>message.trim()),[]);
  await page.getByRole("button",{name:"Use this file in the form",exact:true}).click();assert.equal(await text.inputValue(),imported);assert.deepEqual((await page.getByRole("alert").allTextContents()).filter(message=>message.trim()),[]);
  // A failed stage must preserve both the current validation error and form.
  await select("invalid.json","{");await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).waitFor();await text.fill("Isolated QA fixture: bank operations");
  await page.getByRole("button",{name:/Stage note/}).click();await page.getByRole("alert").filter({hasText:"Excluded private material"}).waitFor();assert.equal(await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).count(),1);assert.equal(await text.inputValue(),"Isolated QA fixture: bank operations");assert.equal((await state()).sources.length,1);
  await text.fill(imported);await page.getByRole("button",{name:/Stage note/}).click();await page.getByRole("button",{name:"Clear this exact note for OpenAI",exact:true}).nth(1).waitFor();await page.getByRole("alert").filter({hasText:"Your current form is unchanged."}).waitFor({state:"hidden"});assert.deepEqual((await page.getByRole("alert").allTextContents()).filter(message=>message.trim()),[]);
  const finalState=await state();assert.equal(finalState.sources.length,2);assert(finalState.sources.every((source:any)=>source.cleared===false&&source.clearance_id===null));for(const table of ["tasks","outputs","ledger","approvals"])assert.equal(finalState[table].length,0);assert.equal(finalState.events.length,2);assert.deepEqual(errors,[]);
  await page.screenshot({path:"artifacts/source-file-qa.png",fullPage:true});console.log("PASS: isolated chooser preserves form; valid import and successful staging clear obsolete errors; failed staging preserves active errors/text; two uncleared fixtures only; zero calls");
 }finally{await browser.close();}
}finally{server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith("sourcefile-browser-"));await rm(directory,{recursive:true,force:true});}


