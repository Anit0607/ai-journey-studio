import test from "node:test";
import assert from "node:assert/strict";
import {bundleQuality,groundingRules} from "../lib/grounding";
const source="I built a content review screen. I found unsupported claims during a test run. I retained final approval.";
const critic={role:"Critic",text:"Unsupported claims: none\nEvidence needed: none for these exact quotations\nProposed advice: review the source",hash:""};
test("concrete cleared source supports exact events while preserving human factual review",()=>{
 const result=bundleQuality([{role:"Writer",text:source,hash:""},critic],source);
 assert.equal(result.flags.length,0);assert.equal(result.status,"needs_human_review");
 assert.match(groundingRules(source),/exact owner-cleared source/);
});
test("new notes cannot inherit unsupported legacy assertions or invented feelings",()=>{
 const result=bundleQuality([{role:"Writer",text:"I am a non-coder. I felt proud. I discovered a guaranteed method.",hash:""},critic],source);
 assert(result.flags.some(item=>item.claim.includes("non-coder")));assert(result.flags.some(item=>item.claim.includes("felt proud")));assert(result.flags.some(item=>item.claim.includes("discovered")));
});
