import test from "node:test";
import assert from "node:assert/strict";
import {executionReadiness} from "../lib/execution-readiness";

test("runtime readiness does not hide hosted drafting being off",()=>{
  const value=executionReadiness({liveEnabled:true,hosted:true,generationEnabled:false});
  assert.equal(value.badge,"Hosted drafting paused");
  assert.equal(value.hostedPaused,true);
  assert.match(value.notice,/will not run/);
});
test("blocked runtime takes precedence while the pause remains visible",()=>{
  const value=executionReadiness({liveEnabled:false,hosted:true,generationEnabled:false});
  assert.equal(value.badge,"Runtime checks blocked");
  assert.match(value.notice,/OFF/);
});
test("an opt-in never claims that a scheduler is active",()=>{
  const value=executionReadiness({liveEnabled:true,hosted:true,generationEnabled:true});
  assert.equal(value.badge,"Runtime checks passed");
  assert.match(value.title,/worker still required/);
  assert.match(value.notice,/does not prove/);
});
test("local manual work is not falsely described as blocked by scheduled opt-out",()=>{
  const value=executionReadiness({liveEnabled:true,hosted:false,generationEnabled:false});
  assert.equal(value.hostedPaused,false);
  assert.match(value.notice,/local worker may process manually queued/);
});
