import test from "node:test";
import assert from "node:assert/strict";
import {preparePilot} from "../lib/pilot";
test("automatic pilot never queues a source before all readiness gates",async()=>{
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return Response.json({live_enabled:false});};
  assert.equal(await preparePilot("http://isolated.test","isolated-owner-token",transport),false);
  assert.equal(calls,1);
});
test("automatic pilot queues only the server-approved capsule after readiness",async()=>{
  const paths:string[]=[];
  const transport:typeof fetch=async(url,options)=>{
    const pathname=new URL(String(url)).pathname;paths.push(pathname);
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer isolated-owner-token");
    if(pathname.endsWith("state"))return Response.json({live_enabled:true});
    if(pathname.endsWith("source")){assert.equal(options?.body,"{}");return Response.json({result:{id:"isolated-source"}});}
    assert.deepEqual(JSON.parse(String(options?.body)),{source:"isolated-source"});return Response.json({result:{id:"isolated-task"}});
  };
  assert.equal(await preparePilot("http://isolated.test","isolated-owner-token",transport),true);
  assert.deepEqual(paths,["/api/studio/state","/api/studio/source","/api/studio/run"]);
});
