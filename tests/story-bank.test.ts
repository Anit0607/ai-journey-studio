import test from "node:test";
import assert from "node:assert/strict";
import {embedded} from "../lib/db";
import {composeStory,saveStory,blockedWords,STORY_MARKER,STORY_SETS} from "../lib/story-bank";

const answers={topic:"Teaching my app to sleep",when:"25 October 2026",wrong:"I assumed the database slept on its own."};
const now=new Date("2026-10-31T06:00:00Z");

test('a story keeps the owner\'s exact answers, in question order, under a clear marker',()=>{
 const text=composeStory("post",answers,"2026-10-31");
 assert(text.startsWith(STORY_MARKER+" (Prepare one post), answered by the owner on 2026-10-31."));
 assert(text.includes("Question: "+STORY_SETS.post.questions[0].q+"\nMy answer: Teaching my app to sleep"));
 assert(text.indexOf("My answer: Teaching")<text.indexOf("My answer: 25 October")&&text.indexOf("My answer: 25 October")<text.indexOf("My answer: I assumed"));
 assert.throws(()=>composeStory("post",{topic:"Only one"},"2026-10-31"),/at least two/);
 assert.throws(()=>composeStory("post",{...answers,unknown:"x"},"2026-10-31"),/Invalid story/);
 assert.throws(()=>composeStory("post",{...answers,tried:"x".repeat(1501)},"2026-10-31"),/1,500/);
 assert.throws(()=>composeStory("other" as never,answers,"2026-10-31"),/Invalid story/);
});

test('blocked words are named so the owner can remove them',()=>{
 assert.deepEqual(blockedWords(composeStory('bank',{building:'An app.',told:'How it slept.'},'2026-10-31')),[],'the saved header never trips the privacy filter');
 assert.deepEqual(blockedWords("At the bank, my clients saw a private demo."),["bank","clients","private"]);
 assert.deepEqual(blockedWords("I built a calendar."),[]);
});

test('saving clears the story as the owner\'s source for the autopilot; nothing is queued, drafted or approved',async()=>{
 const db=await embedded();try{
  await assert.rejects(saveStory(db,{set:"post",answers,acknowledged:false},now),/Confirm that these answers/);
  await assert.rejects(saveStory(db,{set:"post",answers:{...answers,tried:"I demoed it at the bank."},acknowledged:true},now),/Remove these words before saving: bank/);
  assert.equal((await db.query("SELECT * FROM sources")).length,0,'refused stories save nothing');
  const saved=await saveStory(db,{set:"post",answers,acknowledged:true},now);
  const source=(await db.query<any>("SELECT * FROM sources WHERE id=$1",[saved.source]))[0];
  assert.equal(source.category,"user-reported-notes");assert.equal(source.cleared,true);assert.equal(source.clearance_owner_acknowledged,true);assert.equal(source.reported_date,"2026-10-31");
  assert.deepEqual(saved,{source:saved.source});assert.equal((await db.query("SELECT * FROM tasks")).length,0,"the autopilot, not saving, queues drafts");
  for(const table of ["outputs","ledger","approvals","publishing_outbox"])assert.equal((await db.query("SELECT * FROM "+table)).length,0,table);
 }finally{await db.close();}
});
