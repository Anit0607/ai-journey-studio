import {enqueueLegacy} from "./legacy-task-fixture";
import {variantFixture} from "./variant-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {CAPSULE,ROLES,hash} from "../lib/domain";
import {bundleQuality,GROUNDING_RULES} from "../lib/grounding";
const critique="Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: review each draft before use";
async function fixture(work:(store:Store,task:string)=>Promise<void>,approveOriginal=true){
  const db=await embedded();try{
    const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await enqueueLegacy(store,source.id);
    for(const role of ROLES){const text=role==="Critic"?critique:role==="Platform Adapter"?variantFixture():"Proposed approach: review a small agent task.";await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
    await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
    const original=(await store.snapshot()).outputs;if(approveOriginal)await store.approve(task.id,hash(original.map((item:any)=>item.hash).join("|")));
    await work(store,task.id);
  }finally{await db.close();}
}
test("short source cannot establish personal discovery or wins; Critic endorsement conflicts",()=>{
  const result=bundleQuality([{role:"Story Miner",text:"Anit discovered a better method.",hash:""},{role:"Platform Adapter",text:"I've learned that this works. A journey of gradual wins.",hash:""},{role:"Critic",text:"All claims are supported. No unsupported claims.",hash:""}],CAPSULE);
  assert.equal(result.status,"needs_revision");assert(result.flags.some(flag=>flag.role==="Critic"));assert(result.flags.some(flag=>flag.role==="Story Miner"));
  assert.match(GROUNDING_RULES,/Prior artifacts are not independent evidence/);
});
test("supported personal statements and labeled proposed advice still require human review",()=>{
  const quality=bundleQuality([{role:"Writer",text:"I am a non-coder. I learn by doing.\nProposed approach: check one draft.",hash:""},{role:"Critic",text:critique,hash:""}],CAPSULE);
  assert.equal(quality.status,"needs_human_review");assert.equal(quality.flags.length,0);
});
test("request, edit and fresh approval preserve original artifacts and every historical approval",()=>fixture(async(store,task)=>{
  const original=await store.snapshot(),initial=original.reviews[0];
  await store.revise(task,initial.token,"Replace generic advice with source-faithful text");
  let state=await store.snapshot(),review=state.reviews[0];assert.equal(review.approval,null);assert.deepEqual(state.outputs,original.outputs);assert.deepEqual(state.approvals,original.approvals);assert.equal(state.tasks[0].status,"approved");
  await store.revise(task,review.token,"Use only supported role and intent",{role:"Writer",text:"I am a non-coder. I retain final approval.\nProposed approach: review one agent output."});
  state=await store.snapshot();review=state.reviews[0];assert.equal(review.approval,null);
  await assert.rejects(store.approveRevision(task,initial.token,true),/Stale revision/);
  await assert.rejects(store.approveRevision(task,review.token,false),/acknowledgement/);
  await store.approveRevision(task,review.token,true);await store.approveRevision(task,review.token,true);
  state=await store.snapshot();assert(state.reviews[0].approval);assert.equal(state.events.filter((item:any)=>item.kind==="revision_approved").length,1);
  await store.revise(task,state.reviews[0].token,"Change proposed advice",{role:"Writer",text:"I learn by doing.\nProposed approach: check a draft against the source."});
  state=await store.snapshot();assert.equal(state.reviews[0].approval,null);assert(state.reviews[0].history[1].approval);assert.deepEqual(state.outputs,original.outputs);assert.deepEqual(state.approvals,original.approvals);assert.equal(state.ledger.length,0);
}));
test("concurrent edits reject stale versions, privacy exclusions and source invalidation",()=>fixture(async(store,task)=>{
  let review=(await store.snapshot()).reviews[0];await store.revise(task,review.token,"Request changes");review=(await store.snapshot()).reviews[0];
  const edits=await Promise.allSettled([store.revise(task,review.token,"First edit",{role:"Writer",text:"Proposed approach: inspect one output."}),store.revise(task,review.token,"Second edit",{role:"Writer",text:"Proposed approach: check one source."})]);
  assert.equal(edits.filter(result=>result.status==="fulfilled").length,1);
  review=(await store.snapshot()).reviews[0];await assert.rejects(store.revise(task,review.token,"Private material",{role:"Writer",text:"Bandhan Bank client note"}),/Excluded/);
  await store.db.query("UPDATE sources SET cleared=false");await assert.rejects(store.approveRevision(task,review.token,true),/Source invalidated/);
}));
test("unsupported revision cannot receive fresh approval, even with acknowledgement",()=>fixture(async(store,task)=>{
  const initial=(await store.snapshot()).reviews[0];await store.revise(task,initial.token,"Remove invented lessons",{role:"Writer",text:"I've learned that agent teams always succeed."});
  const review=(await store.snapshot()).reviews[0];assert.equal(review.quality.status,"needs_revision");await assert.rejects(store.approveRevision(task,review.token,true),/source-grounding/);
  assert.equal((await store.snapshot()).ledger.length,0);
}));
test("an original approval endpoint cannot bypass an outstanding revision",()=>fixture(async(store,task)=>{
  const state=await store.snapshot();await store.revise(task,state.reviews[0].token,"Request a corrected version");
  await assert.rejects(store.approve(task,hash(state.outputs.map((item:any)=>item.hash).join("|"))),/Fresh revision approval required/);
  assert.equal((await store.snapshot()).approvals.length,0);
},false));
