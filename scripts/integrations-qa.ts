// Disposable test workspace only. No provider calls, real account or user records.
import {chromium,type Browser} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {provisionOwner} from "../lib/owner-password";
const folder=await mkdtemp(path.join(os.tmpdir(),"studio-integrations-qa-")),location=path.join(folder,"db"),port="3117",origin="http://127.0.0.1:"+port,password="4729183065";
let server:ChildProcess|undefined,browser:Browser|undefined;
try{
 const db=await embedded(location);try{await provisionOwner(db,password,true);}finally{await db.close();}
 server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",port],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:"isolated-completion-worker-"+"k".repeat(32),STUDIO_AUTH_SECRET:"isolated-completion-auth-"+"s".repeat(32),STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:location,STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:JSON.stringify({sources:{chat:{enabled:true}}}),STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready,"Isolated server ready");
 browser=await chromium.launch({headless:true,...(process.argv.includes("--edge")?{channel:"msedge"}:process.argv.includes("--system-chromium")?{executablePath:"/usr/bin/chromium"}:{})});const context=await browser.newContext({viewport:{width:1360,height:1100}}),page=await context.newPage(),errors:string[]=[],outgoing:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));page.on("request",request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith("data:"))outgoing.push(request.url());});
 await page.goto(origin);await page.getByLabel("Owner password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.getByRole("button",{name:"Sign out",exact:true}).waitFor();
 const tab=async(name:string)=>{await page.getByRole("button",{name,exact:true}).click();await page.getByRole("heading",{name,exact:true,level:1}).waitFor();};
 const state=async()=>{const response=await page.request.get(origin+"/api/studio/state");assert.equal(response.status(),200);return response.json();};
 await tab("Connections");await page.getByRole("heading",{name:"Source connections",exact:true}).waitFor();
 const input={format:"ai-journey-chat-v1",provider:"chatgpt",conversations:[{id:"isolated-chat",title:"Isolated test",reported_date:new Date().toISOString().slice(0,10),messages:[{role:"user",text:"I built a small dashboard."},{role:"assistant",text:"An assistant suggestion is not owner evidence."}]}]};
 const importButton=page.getByRole("button",{name:"Stage selected conversations",exact:true});assert(await importButton.isDisabled());
 await page.getByLabel("Selected chat JSON",{exact:true}).fill(JSON.stringify(input));await page.getByRole("checkbox",{name:/I reviewed and selected/}).check();await importButton.click();
 await page.waitForFunction(async()=>{const r=await fetch('/api/studio/state');const s=await r.json();return s.sources?.length===1;});
 let snapshot=await state();assert.equal(snapshot.sources.length,1);assert.equal(snapshot.sources[0].cleared,false);assert(!snapshot.sources[0].text.includes("assistant suggestion"));assert.equal(snapshot.tasks.length,0);assert.equal(snapshot.ledger.length,0);
 await importButton.click();snapshot=await state();assert.equal(snapshot.sources.length,1);
 await tab("Publishing");await page.getByRole("heading",{name:"Publication plans",exact:true}).waitFor();assert(await page.getByRole("button",{name:"Stage exact publication plan",exact:true}).isDisabled());await page.getByText("No publication plans or receipts yet.",{exact:true}).waitFor();
 await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/integrations-publishing-qa.png",fullPage:true});
 await tab("Connections");await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:"artifacts/integrations-connections-mobile-qa.png",fullPage:true});
 await page.reload();await page.getByRole("button",{name:"Sign out",exact:true}).waitFor();assert.equal((await state()).sources.length,1);assert.deepEqual(errors,[]);assert.deepEqual(outgoing,[]);
 await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByLabel("Owner password",{exact:true}).waitFor();assert.equal((await page.request.get(origin+"/api/studio/state")).status(),401);
 console.log("PASS: isolated auth, selected chat staging/dedup, assistant evidence exclusion, no automatic clearance/tasks/cost, blocked publication, mobile layout, reload and signout; zero external calls");
}finally{
 await browser?.close();if(server){const child=server;child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once("exit",()=>resolve());});}
 assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith("studio-integrations-qa-"));await rm(folder,{recursive:true,force:true});
}
