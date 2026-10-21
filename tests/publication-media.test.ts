import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import sharp from "sharp";
import type {Database} from "../lib/db";
import {PGlite} from "@electric-sql/pglite";
import {SCHEMA} from "../lib/schema";
import {MEDIA_SCHEMA} from "../lib/publication-media-schema";
import {renderInstagramCard,renderApprovedInstagram,getPrivateMedia,approvePublicMedia,readApprovedPublicMedia,PUBLIC_MEDIA_ACKNOWLEDGEMENT,safeMediaError} from "../lib/publication-media";
import {SourceIntake} from "../lib/sources";
import {Store} from "../lib/store";
import {hash,ROLES,type Output} from "../lib/domain";
import {variantFixture} from "./variant-fixture";
const TEXT="Proposed approach: build one small agent workflow. Keep the source note beside the draft, inspect each claim, and improve one step at a time.";
const ORIGIN="https://isolated.public.blob.vercel-storage.com";
async function fixture(work:(db:Database)=>Promise<void>){
  const local=new PGlite();await local.exec(SCHEMA+MEDIA_SCHEMA);
  const db:Database={kind:"pglite",query:async<T>(sql:string,params:unknown[]=[])=> (await local.query<T>(sql,params)).rows,transaction:work=>local.transaction(tx=>work({query:async<T>(sql:string,params:unknown[]=[])=> (await tx.query<T>(sql,params)).rows})),close:()=>local.close()};
  try{await work(db);}finally{await db.close();}
}
async function seed(db:Database,approve=true,text=TEXT){
  const intake=new SourceIntake(db),store=new Store(db),source=await intake.stage({text:"I built a source-linked outline and reviewed each generated statement.",category:"build-log",reported_date:new Date().toISOString().slice(0,10)});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
  for(const role of ROLES){const value=role==="Platform Adapter"?variantFixture(text):role==="Critic"?"Unsupported claims: none\nEvidence needed: no personal claims in proposed advice\nProposed advice: inspect the source":text;await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,value,hash(value)]);}
  await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);const outputs=await db.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]),version=hash(outputs.map(row=>row.hash).join("|"));if(approve)await store.approve(task.id,version);return {task,source,intake,store,version,token:"original:"+version};
}

test("local text-card rendering is deterministic JPEG, XML-safe, bounded and contains no remote assets",async()=>{
  let network=0;const original=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error("No network allowed");};
  try{const first=await renderInstagramCard(TEXT),again=await renderInstagramCard(TEXT);assert.equal(first.sha256,again.sha256);assert.deepEqual(first.bytes,again.bytes);assert.equal(first.sha256,createHash("sha256").update(first.bytes).digest("hex"));const metadata=await sharp(first.bytes).metadata();assert.equal(metadata.format,"jpeg");assert.equal(metadata.width,1080);assert.equal(metadata.height,1350);assert.equal(metadata.hasAlpha,false);assert.equal(first.mime_type,"image/jpeg");assert.equal(network,0);
    const escaped=await renderInstagramCard('Proposed approach: compare A < B & write "evidence"; do not run <script> tags.');assert.notEqual(escaped.sha256,first.sha256);assert.equal((await sharp(escaped.bytes).metadata()).format,"jpeg");
    await writeFile("/tmp/ai-journey-media-preview.jpg",first.bytes);
  }finally{globalThis.fetch=original;}
});

test("graphic validation rejects unsafe text, unsupported glyphs and oversized input without truncation",async()=>{
  for(const text of ["", "x".repeat(2201),"line\n".repeat(42),"bad\u0000text"])await assert.rejects(renderInstagramCard(text),/Instagram graphic needs/);
  await assert.rejects(renderInstagramCard("Proposed approach: a private workflow"),/Excluded private/);
  await assert.rejects(renderInstagramCard("Proposed approach: build a rocket 🚀"),/unsupported by the graphic font/);
});

test("only approved exact final Instagram variants render and private staging grants no public consent",()=>fixture(async db=>{
  const {task,store,source,version,token}=await seed(db,false);await assert.rejects(renderApprovedInstagram(db,task.id,token),/Approve the exact final content/);
  await store.approve(task.id,version);await assert.rejects(renderApprovedInstagram(db,task.id,"original:"+hash("stale")),/Final content changed/);
  const card=await renderApprovedInstagram(db,task.id,token);assert.equal(card.caption,TEXT);assert.equal(card.caption_hash,hash(TEXT));assert.equal(card.task_id,task.id);assert.equal(card.source_id,source.id);assert.equal(card.source_hash,source.hash);assert.ok(card.source_clearance_id);assert.equal(card.width,1080);assert.equal(card.height,1350);
  const duplicate=await renderApprovedInstagram(db,task.id,token);assert.equal(card.id,duplicate.id);assert.deepEqual(card.bytes,duplicate.bytes);const download=await getPrivateMedia(db,card.id);assert.deepEqual(card.bytes,download.bytes);
  assert.deepEqual(await db.query("SELECT * FROM media_public_approvals"),[]);assert.deepEqual(await db.query("SELECT * FROM publishing_outbox"),[]);
  await assert.rejects(readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,token),/Separate exact public-media consent/);
  await assert.rejects(db.query("UPDATE media_artifacts SET caption='changed' WHERE id=$1",[card.id]),/immutable/);await assert.rejects(db.query("DELETE FROM media_artifacts WHERE id=$1",[card.id]),/immutable/);
}));

test("public Blob consent binds exact media bytes, origin, current review and source clearance",()=>fixture(async db=>{
  const {task,source,intake,store,token}=await seed(db),card=await renderApprovedInstagram(db,task.id,token);
  await assert.rejects(approvePublicMedia(db,card.id,card.sha256,ORIGIN,false),/Explicit public Vercel Blob/);
  await assert.rejects(approvePublicMedia(db,card.id,hash("other"),ORIGIN,true),/Media changed/);
  for(const origin of ["http://isolated.public.blob.vercel-storage.com","https://evil.test","https://isolated.public.blob.vercel-storage.com/path","https://user:pass@isolated.public.blob.vercel-storage.com"])await assert.rejects(approvePublicMedia(db,card.id,card.sha256,origin,true),/configured public Vercel Blob/);
  const consent=await approvePublicMedia(db,card.id,card.sha256,ORIGIN,true);assert.equal(consent.acknowledgement,PUBLIC_MEDIA_ACKNOWLEDGEMENT);assert.equal(consent.sha256,card.sha256);assert.equal(consent.source_clearance_id,card.source_clearance_id);assert.equal((await approvePublicMedia(db,card.id,card.sha256,ORIGIN,true)).id,consent.id);
  assert.equal((await readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,token)).id,card.id);await assert.rejects(readApprovedPublicMedia(db,card.sha256,"https://other.public.blob.vercel-storage.com",task.id,token),/Separate exact public-media consent/);
  await assert.rejects(db.query("DELETE FROM media_public_approvals WHERE id=$1",[consent.id]),/immutable/);
  await intake.revoke(source.id,source.hash);await assert.rejects(getPrivateMedia(db,card.id),/Current exact owner source clearance/);await assert.rejects(readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,token),/Current exact owner source clearance/);
  await intake.clear(source.id,source.hash,true);await assert.rejects(readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,token),/factual review/);await assert.rejects(renderApprovedInstagram(db,task.id,token),/factual review/);await store.revise(task.id,token,"Review content against renewed source clearance");const current=(await store.snapshot()).reviews.find((review:any)=>review.task_id===task.id);await store.approveRevision(task.id,current.token,true);await assert.rejects(readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,current.token),/Separate exact public-media consent/);const refreshed=await renderApprovedInstagram(db,task.id,current.token);assert.notEqual(refreshed.id,card.id);assert.notEqual(refreshed.source_clearance_id,card.source_clearance_id);assert.equal(refreshed.sha256,card.sha256);
}));

test("a new content revision invalidates older private media and its public approval",()=>fixture(async db=>{
  const {task,store,token}=await seed(db),card=await renderApprovedInstagram(db,task.id,token);await approvePublicMedia(db,card.id,card.sha256,ORIGIN,true);
  await store.revise(task.id,token,"Review the revised proposal",{role:"Writer",text:"Proposed approach: inspect every source sentence."});
  await assert.rejects(getPrivateMedia(db,card.id),/Final content changed/);await assert.rejects(readApprovedPublicMedia(db,card.sha256,ORIGIN,task.id,token),/Final content changed/);
  assert.equal(safeMediaError(new Error("secret error")),null);
}));
