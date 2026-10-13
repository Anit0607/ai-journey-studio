import test from "node:test";
import assert from "node:assert/strict";
import {interruptionMessage,inspectInterruptedWorker} from "../lib/worker-observer";
test("completed real-shaped task plus idle disconnect is review-ready, not unknown usage",()=>{
  const message=interruptionMessage({tasks:[{status:"review",checkpoint:6}],ledger:Array.from({length:6},()=>({status:"settled"}))},"idle");
  assert.match(message,/ready for review/);assert.match(message,/no unresolved reservations/);assert.doesNotMatch(message,/unknown/i);
});
test("unknown reservations and running work remain blocked even after an idle response",()=>{
  for(const state of [{tasks:[],ledger:[{status:"unknown"}]},{tasks:[],ledger:[{status:"reserved"}]},{tasks:[{status:"running"}],ledger:[]}]){
    assert.match(interruptionMessage(state,"idle"),/Do not retry until reconciled/);
  }
});
test("unavailable state never infers completion or releases reservations",()=>{
  const message=interruptionMessage(null,"idle");assert.match(message,/after idle polling/);assert.match(message,/could not be verified/);assert.doesNotMatch(message,/no unresolved/);
});
test("interruption inspection makes one authenticated read-only call and never replays a step",async()=>{
  const calls:string[]=[];
  const transport:typeof fetch=async(url,options)=>{
    calls.push(String(url));assert.equal(options?.method,undefined);assert.equal(options?.body,undefined);
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer isolated-worker-token");
    return Response.json({tasks:[{status:"review"}],ledger:[{status:"settled"}]});
  };
  assert.match(await inspectInterruptedWorker("http://isolated.test","isolated-worker-token","idle",transport),/ready for review/);
  assert.deepEqual(calls,["http://isolated.test/api/studio/state"]);
});
test("state read failure gives a conservative stopped message without retry",async()=>{
  let calls=0;const transport:typeof fetch=async()=>{calls++;throw Error("isolated network failure");};
  assert.match(await inspectInterruptedWorker("http://isolated.test","isolated-worker-token","idle",transport),/could not be verified/);
  assert.equal(calls,1);
});
