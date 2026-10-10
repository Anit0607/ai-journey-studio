import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm,mkdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const directory=await mkdtemp(path.join(os.tmpdir(),"studio-qa-"));
const origin="http://127.0.0.1:3100",token=randomBytes(32).toString("base64url");
const server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3100"],{stdio:"ignore",env:{...process.env,NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:path.join(directory,"db"),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:"",OPENAI_API_KEY:"",GEMINI_API_KEY:""}});
try{
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  assert(ready,"Web server did not become ready");
  assert.equal((await fetch(origin+"/api/studio/state")).status,401);
  const stateResponse=await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}});
  if(!stateResponse.ok)throw Error("Authenticated state failed: "+stateResponse.status+" "+JSON.stringify(await stateResponse.json()));
  assert.equal((await fetch(origin+"/api/studio/run",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:"{}"})).status,403);
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1050}});
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await mkdir("artifacts",{recursive:true});
    await page.goto(origin);
    await page.getByRole("heading",{name:"A private space for real work."}).waitFor();
    await page.screenshot({path:"artifacts/web-auth.png",fullPage:true});
    await page.getByLabel("Session access token").fill("wrong-token");
    await page.getByRole("button",{name:"Unlock studio"}).click();
    await page.getByRole("alert").filter({hasText:"Private access required"}).waitFor();
    await page.getByLabel("Session access token").fill(token);
    await page.getByRole("button",{name:"Unlock studio"}).click();
    await page.getByRole("heading",{name:"Secure setup is pending"}).waitFor();
    await page.getByText("No tasks or drafts yet").waitFor();
    await page.screenshot({path:"artifacts/web-empty-blocked.png",fullPage:true});
    await page.getByRole("button",{name:"Sources",exact:true}).click();
    await page.getByRole("heading",{name:"No sources saved"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Save approved capsule"}).isDisabled(),true);
    await page.getByRole("button",{name:"Usage",exact:true}).click();
    await page.getByRole("heading",{name:"No calls or costs recorded"}).waitFor();
    await page.screenshot({path:"artifacts/web-usage-empty.png",fullPage:true});
    await page.getByRole("button",{name:"Events",exact:true}).click();
    await page.getByRole("heading",{name:"No execution events"}).waitFor();
    await page.getByRole("button",{name:"Approval inbox",exact:true}).click();
    await page.getByRole("heading",{name:"No tasks or drafts yet"}).waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:"artifacts/web-mobile-empty.png",fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.getByRole("button",{name:"Sign out"}).click();
    await page.getByRole("heading",{name:"A private space for real work."}).waitFor();
    assert.deepEqual(errors,[]);
    const state=await (await fetch(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}})).json();
    for(const table of ["sources","tasks","outputs","events","ledger","approvals"])assert.equal(state[table].length,0);
    assert.equal(state.live_enabled,false);
    console.log("PASS: rendered auth/error/blocked/empty views; source consent disabled; navigation; mobile overflow; sign-out; zero workspace records; no page errors");
  }finally{await browser.close();}
}finally{
  server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()),"Cleanup target must remain in the temporary root");
  assert(path.basename(directory).startsWith("studio-qa-"),"Cleanup target must be this QA directory");
  await rm(directory,{recursive:true,force:true});
}
