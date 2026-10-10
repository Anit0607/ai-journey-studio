// Isolated automated fixtures only. Never opens the user's persisted workspace.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {CAPSULE,ROLES,hash} from "../lib/domain";
const root=path.resolve("../revision-qa-temp-"),directory=await mkdtemp(root);
const db=await embedded(path.join(directory,"db")),store=new Store(db);
const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await store.enqueue(source.id);
for(const role of ROLES){const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a cleared project note\nProposed advice: review drafts":"Proposed approach: inspect one output. Isolated automated QA fixture.";await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
const original=(await store.snapshot()).outputs;await store.approve(task.id,hash(original.map((item:any)=>item.hash).join("|")));await db.close();
const origin="http://127.0.0.1:3102",token="isolated-revision-owner-token-0000000000";
const server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3102"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:path.join(directory,"db"),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready);
  assert.equal((await fetch(origin+"/api/studio/revise",{method:"POST",headers:{Authorization:"Bearer "+token},body:"{}"})).status,403);
  assert.equal((await fetch(origin+"/api/studio/revise",{method:"POST",headers:{Origin:origin,Authorization:"Bearer wrong"},body:"{}"})).status,401);
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(origin);await page.getByLabel("Session access token").fill(token);await page.getByRole("button",{name:"Unlock studio"}).click();
    await page.getByRole("button",{name:"Approval inbox",exact:true}).click();
    await page.getByLabel("Revision note").fill("Isolated QA: replace generic text");await page.getByRole("button",{name:"Request changes",exact:true}).click();
    await page.getByRole("button",{name:"Edit revision",exact:true}).waitFor();await page.getByRole("button",{name:"Edit revision",exact:true}).click();
    await page.getByLabel("Revision note").fill("Isolated QA manual correction");await page.getByLabel("Revised text").fill("I am a non-coder.\nProposed approach: review one output. Isolated automated QA fixture.");
    await page.getByRole("button",{name:"Save new revision",exact:true}).click();
    const approve=page.getByRole("button",{name:"Approve this exact revision",exact:true});await approve.waitFor();assert(await approve.isDisabled());
    await page.getByRole("checkbox").check();await approve.click();await page.getByText("revision approved",{exact:true}).waitFor();
    await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/revision-qa.png",fullPage:true});assert.deepEqual(errors,[]);
    const state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.equal(state.ledger.length,0);assert.deepEqual(state.outputs,JSON.parse(JSON.stringify(original)));assert.equal(state.approvals.length,1);assert.equal(state.reviews[0].history.length,2);assert(state.reviews[0].approval);
    console.log("PASS: isolated browser request/edit/fresh approval; originals preserved; wrong origin/token rejected; no provider calls");
  }finally{await browser.close();}
}finally{
  server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});
  assert.equal(path.dirname(directory),path.dirname(root));assert(path.basename(directory).startsWith("revision-qa-temp-"));await rm(directory,{recursive:true,force:true});
}
