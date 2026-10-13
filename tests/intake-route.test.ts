import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {GET,POST} from "../app/api/studio/[action]/route";

test("authenticated route stages, explicitly clears and revokes an exact note without runtime calls",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"studio-intake-route-"));
  const token="isolated-route-owner-token-000000000000",origin="http://127.0.0.1:3188";
  process.env.STUDIO_ACCESS_TOKEN=token;process.env.STUDIO_ORIGIN=origin;
  process.env.STUDIO_LOCAL_DB="1";process.env.STUDIO_LOCAL_PATH=path.join(directory,"db");
  process.env.STUDIO_RUNTIME_CONFIG="{}";process.env.STUDIO_SESSION_ONLY="0";
  process.env.STUDIO_DATABASE_AUTHORIZED="0";process.env.DATABASE_URL="";
  process.env.OPENAI_API_KEY="";process.env.GEMINI_API_KEY="";
  const globals=globalThis as typeof globalThis&{studioDb?:Promise<{close():Promise<void>}>};
  delete globals.studioDb;
  const invoke=(action:string,body:unknown,authorization=token)=>POST(new Request(origin+"/api/studio/"+action,{method:"POST",headers:{Authorization:"Bearer "+authorization,Origin:origin,Host:"127.0.0.1:3188","Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
  const state=async()=>{const response=await GET(new Request(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token}}),{params:Promise.resolve({action:"state"})});assert.equal(response.status,200);return response.json();};
  try{
    assert.equal((await invoke("source-stage",{},"wrong-owner-token")).status,401);
    const input={text:"I built a content review screen and found unsupported claims during a test run. I retained final approval.",category:"project-note",reported_date:"2026-10-10"};
    const staged=await invoke("source-stage",input);assert.equal(staged.status,200);
    const source=(await staged.json()).result;assert.equal(source.cleared,false);
    assert.equal((await invoke("run",{source:source.id})).status,400);
    assert.equal((await invoke("source-clear",{source:source.id,expected_hash:source.hash,acknowledged:false})).status,400);
    assert.equal((await invoke("source-clear",{source:source.id,expected_hash:"0".repeat(64),acknowledged:true})).status,400);
    assert.equal((await invoke("source-clear",{source:source.id,expected_hash:source.hash,acknowledged:true})).status,200);
    let snapshot=await state();assert.equal(snapshot.sources[0].cleared,true);assert.equal(snapshot.live_enabled,false);
    assert.equal(snapshot.owner_cleared_sources_authorized,false);
    assert.equal((await invoke("run",{source:source.id})).status,400,"Clearance is not runtime authorization");
    assert.equal((await invoke("calendar-dispatch",{})).status,200);
    assert.equal((await invoke("source-revoke",{source:source.id,expected_hash:source.hash})).status,200);
    snapshot=await state();assert.equal(snapshot.sources[0].cleared,false);
    assert.equal(snapshot.tasks.length,0);assert.equal(snapshot.outputs.length,0);assert.equal(snapshot.ledger.length,0);
    assert.equal(snapshot.events.filter((event:any)=>event.kind==="source_cleared").length,1);
    const tooLarge=await invoke("source-stage",{...input,text:"a".repeat(40001)});assert.equal(tooLarge.status,400);
    console.log("PASS: exact owner clearance and revocation route; zero tasks/provider calls; runtime gate preserved");
  }finally{await (await (globalThis as typeof globalThis&{studioDb?:Promise<{close():Promise<void>}>}).studioDb)?.close();delete globals.studioDb;await rm(directory,{recursive:true,force:true});}
});
