// Credential-free compiled-route regression. No process environments or live tokens are read.
import {spawn} from "node:child_process";
import {request as httpRequest} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {CAPSULE,hash} from "../lib/domain";
import {preparePilot} from "../lib/pilot";
const root=path.resolve("../bootstrap-qa-temp");
const directory=await mkdtemp(root+"-");
const origin="http://127.0.0.1:3101",token="isolated-bootstrap-owner-token-0000000000";
const config={source_approved:true,approved_source_hash:hash(CAPSULE)};
const server=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3101"],{stdio:"ignore",env:{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_LOCAL_DB:"1",STUDIO_LOCAL_PATH:path.join(directory,"db"),STUDIO_RUNTIME_CONFIG:JSON.stringify(config),STUDIO_DATABASE_AUTHORIZED:"0",STUDIO_SESSION_ONLY:"0"}});
try{
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  assert(ready,"Isolated compiled server did not start");
  const transport:typeof fetch=async(url,options)=>{
    const result=await fetch(url,options);
    if(String(url).endsWith("/state")){
      assert.equal(result.status,200);
      const state=await result.json();assert.equal(state.live_enabled,false);
      // Only readiness is mocked. Source/run hit the real compiled route with the launcher's exact headers.
      return Response.json({...state,live_enabled:true});
    }
    assert.equal(result.status,200,"Launcher request rejected: "+new URL(String(url)).pathname);
    return result;
  };
  assert.equal(await preparePilot(origin,token,transport),true);
  const headers={Authorization:"Bearer "+token,Origin:origin,"Content-Type":"application/json"};
  assert.equal((await fetch(origin+"/api/studio/source",{method:"POST",headers:{...headers,Origin:"http://localhost:3101"},body:"{}"})).status,403);
  // fetch normalizes Host; use the HTTP client to send the hostile Host on the wire.
  const hostileHostStatus=await new Promise<number>((resolve,reject)=>{
    const request=httpRequest(origin+"/api/studio/source",{method:"POST",headers:{...headers,Host:"evil.test:3101"}},result=>{result.resume();resolve(result.statusCode!);});
    request.on("error",reject);request.end("{}");
  });
  assert.equal(hostileHostStatus,403);
  assert.equal((await fetch(origin+"/api/studio/source",{method:"POST",headers:{...headers,Authorization:"Bearer wrong-isolated-token"},body:"{}"})).status,401);
  const stepResponse=await fetch(origin+"/api/studio/step",{method:"POST",headers,body:"{}"});
  assert.equal(stepResponse.status,200);assert.equal((await stepResponse.json()).result.status,"blocked");
  const state=await (await fetch(origin+"/api/studio/state",{headers})).json();
  assert.equal(state.sources.length,1);assert.equal(state.tasks.length,1);
  assert.equal(state.tasks[0].status,"queued");
  assert.equal(state.outputs.length,0);assert.equal(state.ledger.length,0);
  console.log("PASS: exact launcher requests create isolated source/task; wrong origin/token rejected; zero provider calls");
}finally{
  server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});
  assert.equal(path.dirname(directory),path.dirname(root));assert(path.basename(directory).startsWith("bootstrap-qa-temp-"));
  await rm(directory,{recursive:true,force:true});
}
