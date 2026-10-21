import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {embedded,type Database} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {evidenceQuality,type Finding} from "../lib/evidence-review";
import type {Artifact} from "../lib/grounding";
import {variantFixture} from "./variant-fixture";

// Fictional local fixtures only. No application database, credentials or provider calls.
const sourceText="The project is a drafting prototype. I use AI agents for implementation while retaining final approval. The dashboard and login are working. Automatic publishing is not yet verified end to end.";
const responsibility="I use AI agents for implementation while retaining final approval.";
const dashboard="The dashboard and login are working.";
const writer="The project owner uses AI agents for implementation while retaining final approval.\nThe project has a working dashboard and login.";
const critic="Unsupported claims: Compare uncertain wording against the cleared note.\nEvidence needed: Review each individual sentence.\nProposed advice: Retain final human review.";
const plainBundle=(bundle:Artifact[])=>bundle.map(({role,text,hash})=>({role,text,hash}));

async function seed(db:Database,needsFiveEdits=false){
  const store=new Store(db),intake=new SourceIntake(db);
  const staged=await intake.stage({text:sourceText,category:"project-note",reported_date:"2026-10-20"});
  const source=await intake.clear(staged.id,staged.hash,true),task=await store.enqueue(source.id);
  for(const role of ROLES){
    const text=role==="Harvester"?"SOURCE: "+sourceText
      :needsFiveEdits?(role==="Critic"?"No unsupported claims.":role==="Platform Adapter"?variantFixture("The project has 500 users."):"The project has 500 users.")
      :role==="Writer"?writer:role==="Critic"?critic:role==="Platform Adapter"?variantFixture():"Proposed approach: inspect one cleared source.";
    await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);
  }
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  return {store,source,task};
}

function decision(quality:ReturnType<typeof evidenceQuality>,finding:Finding){
  const quote=finding.claim.includes("dashboard")?dashboard:responsibility,start=sourceText.indexOf(quote);
  return {binding:quality.binding,finding_id:finding.id,decision:"accept",reason:"The wording retains the cleared sentence's responsibility and qualification.",source_span:{start,end:start+quote.length},source_quote:quote,acknowledged:true};
}

async function assertNoExecution(db:Database){
  for(const table of ["ledger","publishing_outbox","publishing_requests","publishing_approvals","publishing_attempts","media_artifacts","media_public_approvals","calendar_jobs","runtime"]){
    assert.equal((await db.query(`SELECT * FROM ${table}`)).length,0,table+" must remain empty");
  }
  assert.equal((await db.query("SELECT * FROM tasks")).length,1,"manual review must not create an agent job");
}

test("five cumulative manual saves persist all roles, show latest flags, and require every evidence comparison before exact approval",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"studio-manual-flow-"));
  let db=await embedded(directory);
  try{
    const fixture=await seed(db,true),id=fixture.task.id;
    let store=fixture.store,state=await store.snapshot(),review=state.reviews[0];
    const originalOutputs=state.outputs,originalApprovals=state.approvals,originalToken=review.token;
    assert(review.quality.flags.length>0);
    const requested=await store.revise(id,review.token,"Prepare corrections without a model call");
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.token,`revision:${requested.id}:${requested.version}`);
    assert.equal(review.history.length,1);
    assert.deepEqual(plainBundle(review.bundle),plainBundle(originalOutputs));

    const edits=[
      {role:"Story Miner",text:"SOURCE: "+sourceText},
      {role:"Strategist",text:"Proposed approach: compare each sentence with the cleared source."},
      {role:"Writer",text:writer},
      {role:"Platform Adapter",text:variantFixture(responsibility)},
      {role:"Critic",text:critic}
    ];
    const savedBundles:Artifact[][]=[plainBundle(review.bundle)],savedTokens:string[]=[review.token];
    for(const [index,edit] of edits.entries()){
      const before=review,oldBundle=plainBundle(before.bundle);
      const saved=await store.revise(id,before.token,`Correct ${edit.role}`,edit);
      state=await store.snapshot();review=state.reviews[0];
      assert.equal(review.token,`revision:${saved.id}:${saved.version}`);
      assert.equal(review.latest_revision,saved.id);
      assert.equal(review.history.length,index+2);
      assert.equal(review.history.at(-1).sequence,index+2);
      assert.equal(review.history.at(-1).parent_id,before.latest_revision);
      assert.equal(review.history.at(-1).base_token,before.token);
      for(const item of oldBundle){
        const current=review.bundle.find((row:Artifact)=>row.role===item.role);
        assert.deepEqual(current,item.role===edit.role?{role:edit.role,text:edit.text,hash:hash(edit.text)}:item);
      }
      assert.deepEqual(review.history.slice(0,-1).map((row:{bundle:Artifact[]})=>row.bundle),savedBundles);
      assert.deepEqual(state.outputs,originalOutputs);
      assert.deepEqual(state.approvals,originalApprovals);
      assert.equal(review.approval,null);
      const recalculated=evidenceQuality(review.bundle,fixture.source);
      assert.deepEqual(review.quality.flags,recalculated.flags,"flags must be calculated from the current bundle only");
      if(edit.role!=="Writer")assert(!review.quality.flags.some((flag:Finding)=>flag.role===edit.role),"corrected role must lose historical findings");
      await assert.rejects(store.approveRevision(id,review.token,true),/source-grounding/);
      const historyCount=review.history.length;
      await assert.rejects(store.revise(id,before.token,"Reject stale edit",{role:"Writer",text:"The project is a drafting prototype."}),/Stale revision/);
      assert.equal((await store.snapshot()).reviews[0].history.length,historyCount);
      savedBundles.push(plainBundle(review.bundle));savedTokens.push(review.token);
    }
    assert.equal(review.quality.flags.length,2,"only the two current Writer comparisons should remain");
    assert(review.quality.flags.every((flag:Finding)=>flag.role==="Writer"&&flag.kind==="wording_review"));
    assert.equal(state.events.filter((event:{kind:string})=>event.kind==="manual_revision_saved").length,5);
    assert.equal(state.events.filter((event:{kind:string})=>event.kind==="changes_requested").length,1);
    await assertNoExecution(db);

    // Fixture-only clock skew: timestamps must not override the append sequence.
    await db.query("UPDATE content_revisions SET created=TIMESTAMPTZ '2020-01-02 00:00:00+00'-(sequence * INTERVAL '1 hour') WHERE task_id=$1",[id]);
    const byTimestamp=await db.query<{id:string}>("SELECT id FROM content_revisions WHERE task_id=$1 ORDER BY created DESC",[id]);
    assert.equal(byTimestamp[0].id,requested.id);
    assert.equal((await store.snapshot()).reviews[0].latest_revision,review.latest_revision,"highest sequence, not newest timestamp, selects the current revision");

    // Reopen a real disposable PGlite directory to check persisted history, not component state.
    const savedToken=review.token;
    await db.close();db=await embedded(directory);store=new Store(db);
    state=await store.snapshot();review=state.reviews[0];
    assert.equal(review.token,savedToken);
    assert.deepEqual(review.history.map((row:{sequence:number})=>row.sequence),[1,2,3,4,5,6]);
    assert.deepEqual(review.history.map((row:{bundle:Artifact[]})=>row.bundle),savedBundles);
    assert.deepEqual(plainBundle(review.bundle),savedBundles.at(-1));
    assert.equal(review.quality.flags.length,2);
    assert.deepEqual(state.outputs,originalOutputs);
    await assert.rejects(store.approve(id,originalToken.slice("original:".length)),/Fresh revision approval required/);
    await assert.rejects(store.approveRevision(id,savedTokens[1],true),/Stale revision/);

    const first=review.quality.findings[0];
    await store.reviewEvidence(id,review.token,decision(review.quality,first));
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.token,savedToken,"evidence review must not rewrite content");
    assert.equal(review.quality.flags.length,1);
    assert.equal(review.quality.findings.filter((finding:{resolution:unknown})=>finding.resolution).length,1);
    assert.equal(review.approval,null);
    await assert.rejects(store.approveRevision(id,review.token,true),/source-grounding/);
    await store.reviewEvidence(id,review.token,decision(review.quality,review.quality.flags[0]));
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.quality.flags.length,0);
    assert.equal(review.approval,null,"wording decisions alone must not approve content");
    await assert.rejects(store.approveRevision(id,review.token,false),/acknowledgement/);
    await store.approveRevision(id,review.token,true);
    await store.approveRevision(id,review.token,true);
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.approval.revision_id,review.latest_revision);
    assert.equal((await db.query("SELECT * FROM revision_approvals")).length,1);
    assert.equal((await db.query("SELECT * FROM evidence_approval_receipts")).length,1);
    await assertNoExecution(db);
  }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});

test("content edits, individual withdrawal and source reclearance invalidate exact-version decisions and approval",async()=>{
  const db=await embedded();
  try{
    const {store,source,task}=await seed(db),id=task.id;
    let review=(await store.snapshot()).reviews[0];
    await store.revise(id,review.token,"Prepare the version for review");
    review=(await store.snapshot()).reviews[0];
    for(const finding of review.quality.flags)await store.reviewEvidence(id,review.token,decision(review.quality,finding));
    await store.approveRevision(id,review.token,true);
    review=(await store.snapshot()).reviews[0];
    const approvedRevision=review.latest_revision,approvedToken=review.token,oldBinding=review.quality.binding;
    const oldDecision=decision(review.quality,review.quality.findings[0]);
    await store.reviewEvidence(id,review.token,{...oldDecision,decision:"withdraw"});
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.approval,null);assert.equal(review.quality.flags.length,1);
    await assert.rejects(store.approveRevision(id,review.token,true),/source-grounding/);
    await store.reviewEvidence(id,review.token,decision(review.quality,review.quality.flags[0]));
    review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);
    await store.approveRevision(id,review.token,true);
    assert((await store.snapshot()).reviews[0].approval);

    await store.revise(id,approvedToken,"Change only the proposed approach",{role:"Strategist",text:"Proposed approach: inspect the current draft carefully."});
    review=(await store.snapshot()).reviews[0];
    assert.notEqual(review.token,approvedToken);assert.notEqual(review.quality.binding,oldBinding);
    assert.equal(review.approval,null);assert.equal(review.quality.flags.length,2);
    assert.equal(review.quality.findings.filter((finding:{resolution:unknown})=>finding.resolution).length,0);
    assert(review.history.find((row:{id:string})=>row.id===approvedRevision).approval,"historical approval must remain stored");
    await assert.rejects(store.approveRevision(id,approvedToken,true),/Stale revision/);
    await assert.rejects(store.reviewEvidence(id,review.token,oldDecision),/Stale evidence review/);
    for(const finding of review.quality.flags)await store.reviewEvidence(id,review.token,decision(review.quality,finding));
    await store.approveRevision(id,review.token,true);

    const intake=new SourceIntake(db),contentToken=review.token;
    await intake.revoke(source.id,source.hash);
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.approval,null);
    await assert.rejects(store.approveRevision(id,contentToken,true),/Source invalidated/);
    await intake.clear(source.id,source.hash,true);
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.token,contentToken,"unchanged content token must not preserve source-clearance approval");
    assert.equal(review.approval,null);assert.equal(review.quality.flags.length,2);
    assert.equal(review.quality.findings.filter((finding:{resolution:unknown})=>finding.resolution).length,0);
    await assert.rejects(store.approveRevision(id,contentToken,true),/source-grounding/);
    assert.equal((await db.query("SELECT * FROM revision_approvals")).length,2);
    await assertNoExecution(db);
  }finally{await db.close();}
});

test("changed source hash and corrupted stored artifact hashes cannot reuse review or approval",async()=>{
  const db=await embedded();
  try{
    const {store,source,task}=await seed(db),id=task.id;
    let review=(await store.snapshot()).reviews[0];
    await store.revise(id,review.token,"Prepare an exact version");
    review=(await store.snapshot()).reviews[0];
    for(const finding of review.quality.flags)await store.reviewEvidence(id,review.token,decision(review.quality,finding));
    await store.approveRevision(id,review.token,true);
    review=(await store.snapshot()).reviews[0];assert(review.approval);
    const validToken=review.token,changedSource=sourceText+" Proposed approach: inspect another draft.";
    // Deliberate fixture corruption: this is never a supported source-edit operation.
    await db.query("UPDATE sources SET text=$2,hash=$3 WHERE id=$1",[source.id,changedSource,hash(changedSource)]);
    review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);
    await assert.rejects(store.approveRevision(id,validToken,true),/Source invalidated/);
    await assert.rejects(store.reviewEvidence(id,validToken,decision(review.quality,review.quality.findings[0])),/Source invalidated/);
    await db.query("UPDATE sources SET text=$2,hash=$3 WHERE id=$1",[source.id,sourceText,source.hash]);

    const damaged=plainBundle(review.bundle);damaged[0].hash="0".repeat(64);
    await db.query("UPDATE content_revisions SET bundle=$2 WHERE id=$1",[review.latest_revision,JSON.stringify(damaged)]);
    review=(await store.snapshot()).reviews[0];
    assert.equal(review.approval,null);assert(review.quality.flags.some((finding:Finding)=>finding.role==="Source"));
    await assert.rejects(store.approveRevision(id,validToken,true),/Invalid artifact bundle/);
    await assertNoExecution(db);
  }finally{await db.close();}
});
