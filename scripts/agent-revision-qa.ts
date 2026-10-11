// Isolated automated fixture only. No user DB, credential or network provider.
import {chromium,type Browser,type Page} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {CAPSULE,ROLES,hash,type RuntimeConfig} from "../lib/domain";
import {step} from "../lib/workflow";
import type {Completion} from "../lib/providers";

const directory=await mkdtemp(path.join(os.tmpdir(),"studio-agent-browser-")),location=path.join(directory,"db");
const origin="http://127.0.0.1:3104",token="isolated-agent-browser-owner-token-000000000";
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:"isolated-browser-fixture",pricing_version:"mock-only",pricing_tier:"standard",official_pricing_url:"https://example.test/mock",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"}};
const critique="Unsupported claims: none\nEvidence needed: none for quoted statements\nProposed advice: isolated automated QA fixture; review each draft";
let server:ChildProcess|undefined,browser:Browser|undefined,calls=0;
const errors:string[]=[];
async function stop(){if(!server)return;const child=server;server=undefined;child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once("exit",()=>resolve());});}
async function start(){
  server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3104"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:location,STUDIO_RUNTIME_CONFIG:JSON.stringify(config),STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
  for(let attempt=0;attempt<120;attempt++){try{if((await fetch(origin)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw Error("Isolated QA server not ready");
}
async function inbox():Promise<Page>{
  const page=await browser!.newPage({viewport:{width:1400,height:1100}});page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);await page.getByLabel("Session access token").fill(token);await page.getByRole("button",{name:"Unlock studio"}).click();await page.getByRole("button",{name:"Approval inbox",exact:true}).click();return page;
}
async function mockSteps(count:number){
  const db=await embedded(location);try{const store=new Store(db);
    for(let index=0;index<count;index++){
      const result=await step(store,config,async(provider,prompt):Promise<Completion>=>{calls++;assert.equal(provider,"openai");assert(prompt.includes(CAPSULE));return {text:prompt.startsWith("You are Critic.")?critique:"I learn by doing.\nProposed approach: isolated automated QA fixture; review one draft.",input:10,output:10,outcome:"complete",report:{serviceTier:"default",model:"isolated-browser-fixture",requestId:"mock-"+calls,finishReason:"stop"}};},true);assert.equal(result.status,"step_saved");
    }
  }finally{await db.close();}
}
try{
  const db=await embedded(location);let original:string,parent:string;
  try{const store=new Store(db),intake=new SourceIntake(db);const source=await intake.stage({text:CAPSULE,category:"user-reported-notes",reported_date:"2026-10-09"});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);parent=task.id;
    for(const role of ROLES){const text=role==="Critic"?critique:"Proposed approach: isolated automated QA fixture; inspect one source.";await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),parent,role,text,hash(text)]);}
    await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[parent]);original=JSON.stringify((await store.snapshot()).outputs);
  }finally{await db.close();}
  browser=await chromium.launch({headless:true,...(process.argv.includes("--edge")?{channel:"msedge"}:{})});
  await start();let page=await inbox();await page.getByRole("button",{name:"Approve these exact versions",exact:true}).click();
  await page.getByLabel("Revision note").fill("Shorten the structure while preserving supported facts.");await page.getByRole("button",{name:"Request agent revision",exact:true}).click();
  await page.getByRole("button",{name:"Cancel agent revision",exact:true}).waitFor();assert(await page.getByRole("button",{name:"Request agent revision",exact:true}).isDisabled());
  let state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.equal(state.ledger.length,0);assert.equal(state.tasks.length,2);const historical=JSON.stringify(state.approvals);
  await page.close();await stop();await mockSteps(3);
  await start();page=await inbox();await page.getByRole("button",{name:"Cancel agent revision",exact:true}).waitFor();state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.equal(state.reviews[0].pending_agent_revision.checkpoint,3);assert.equal(state.ledger.length,3);assert.equal(state.reviews[0].history.length,0);
  await page.close();await stop();await mockSteps(3);
  await start();page=await inbox();const approve=page.getByRole("button",{name:"Approve this exact revision",exact:true});await approve.waitFor();assert(await approve.isDisabled());
  await page.getByRole("checkbox").check();await approve.click();await page.getByText("revision approved",{exact:true}).waitFor();
  await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/agent-revision-qa.png",fullPage:true});
  state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();assert.equal(calls,6);assert.equal(state.ledger.length,6);assert(state.ledger.every((row:any)=>row.status==="settled"));assert.equal(state.budget.unresolved_reservations,0);assert.equal(JSON.stringify(state.outputs.filter((row:any)=>row.task_id===parent!)),original!);assert.equal(JSON.stringify(state.approvals),historical);assert.equal(state.reviews[0].history.length,1);assert(state.reviews[0].approval);assert.deepEqual(errors,[]);
  console.log("PASS: rendered agent feedback queues once; isolated worker resumes at checkpoint 3 after restart; six mock completions settle; fresh exact approval; originals preserved; zero real provider calls");
}finally{await browser?.close();await stop();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith("studio-agent-browser-"));await rm(directory,{recursive:true,force:true});}
