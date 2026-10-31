import test from "node:test";
import assert from "node:assert/strict";
import {zipSync,strToU8} from "fflate";
import {embedded} from "../lib/db";
import {SourceIntake,sourceEligible,STANDING_CHAT_CONSENT_ACKNOWLEDGEMENT} from "../lib/sources";
import {parseExport} from "../lib/chat-export-parse";
import {parseChatImport,chatSourceTexts,importOwnerChats,standingChatConsent} from "../lib/chat-import";

const today="2026-10-31",t=(iso:string)=>Date.parse(iso)/1000;
const mine1="I spent the whole evening trying to make the scheduler sleep, and it kept waking up every two minutes.";
const mine2="What finally worked was checking the clock before touching the database, which felt obvious afterwards.";
const chatgpt=[{id:"c1",title:"Scheduler at my bank job",mapping:{
 a:{message:{author:{role:"user"},create_time:t("2026-10-24T10:00:00Z"),content:{parts:[mine1]}}},
 b:{message:{author:{role:"assistant"},create_time:t("2026-10-24T10:01:00Z"),content:{parts:["Here is a long assistant answer that must never be imported as the owner's words."]}}},
 c:{message:{author:{role:"user"},create_time:t("2026-10-24T10:05:00Z"),content:{parts:["ok thanks"]}}},
 d:{message:{author:{role:"user"},create_time:t("2026-10-24T10:06:00Z"),content:{parts:["const x = {a: 1, b: [2, 3]}; function f(){ return x.a + x.b[0]; } // {}[]=;"]}}},
 e:{message:{author:{role:"user"},create_time:t("2026-10-24T10:07:00Z"),content:{parts:["Can you check this config from my client project before I share it with the team tomorrow?"]}}},
 f:{message:{author:{role:"user"},create_time:t("2026-10-25T09:00:00Z"),content:{parts:[mine2]}}}
}}];

test('a ChatGPT export zip yields only the owner\'s own prose, with every exclusion counted',()=>{
 const zip=zipSync({"conversations.json":strToU8(JSON.stringify(chatgpt)),"chat.html":strToU8("<html></html>")});
 const parsed=parseExport(zip,"export.zip",today);
 assert.equal(parsed.provider,"chatgpt");assert.equal(parsed.conversations.length,1);
 const conv=parsed.conversations[0];
 assert.deepEqual(conv.messages.map(m=>m.text),[mine1,mine2]);assert.equal(conv.reported_date,"2026-10-25");
 assert.equal(conv.title,"","a title with a private word is dropped");
 assert.deepEqual(parsed.skipped,{ai:1,short:1,code:1,private:1});
});

test('Claude.ai and Gemini (Takeout) exports keep owner turns and prompts only',()=>{
 const claude=[{uuid:"u1",name:"Learning agents",chat_messages:[{sender:"human",text:mine1,created_at:"2026-10-20T08:00:00Z"},{sender:"assistant",text:"Assistant prose that is excluded from the owner's words entirely.",created_at:"2026-10-20T08:01:00Z"},{sender:"human",text:mine2,created_at:"2026-10-21T08:00:00Z"}]}];
 const c=parseExport(strToU8(JSON.stringify(claude)),"conversations.json",today);
 assert.equal(c.provider,"claude");assert.deepEqual(c.conversations[0].messages.map(m=>m.text),[mine1,mine2]);assert.equal(c.skipped.ai,1);
 const gemini=[{header:"Gemini Apps",title:"Prompted "+mine1,time:"2026-10-22T05:00:00Z"},{header:"Gemini Apps",title:"Prompted "+mine2,time:"2026-10-22T06:00:00Z"},{header:"Gemini Apps",title:"Used Gemini Apps",time:"2026-10-22T07:00:00Z"}];
 const g=parseExport(zipSync({"Takeout/My Activity/Gemini Apps/MyActivity.json":strToU8(JSON.stringify(gemini))}),"takeout.zip",today);
 assert.equal(g.provider,"gemini");assert.equal(g.conversations.length,1);assert.equal(g.conversations[0].title,"Gemini prompts on 2026-10-22");assert.equal(g.skipped.ai,1);
});

test('owner-chat sources quote the owner verbatim, stay under the size limit and split long conversations',()=>{
 const conv={provider:"chatgpt" as const,id:"c",title:"Sleep",reported_date:"2026-10-25",messages:[{text:mine1,date:"2026-10-24"},{text:mine2,date:"2026-10-25"}]};
 const [one]=chatSourceTexts(conv);
 assert.equal(one.text,'Owner messages from a ChatGPT conversation titled "Sleep", 2026-10-24 to 2026-10-25. Only the owner\'s own words; AI replies are excluded.\n\nMy message (2026-10-24): '+mine1+"\n\nMy message (2026-10-25): "+mine2);
 const long={...conv,messages:Array.from({length:30},(_,i)=>({text:"x".repeat(1000)+" "+i,date:"2026-10-25"}))};
 const parts=chatSourceTexts(long);assert(parts.length>1);assert(parts.every(p=>p.text.length<=12_000&&/\(part \d of \d\)/.test(p.text)));
});

test('import needs the recorded standing consent, clears under it honestly and never duplicates',async()=>{
 assert.equal(standingChatConsent({sources:{chat:{enabled:true,standing_consent:"2026-10-31"}}} as never),true);
 assert.equal(standingChatConsent({sources:{chat:{enabled:true}}} as never),false);
 const db=await embedded();try{
  const body={conversations:[{provider:"claude-code",id:"s1",title:"Building the studio",reported_date:"2026-10-30",messages:[{text:mine1,date:"2026-10-30"},{text:mine2,date:"2026-10-30"}]}]};
  await assert.rejects(importOwnerChats(db,body,new Date("2026-10-31T06:00:00Z"),false),/not enabled/);
  assert.deepEqual(await importOwnerChats(db,body,new Date("2026-10-31T06:00:00Z"),true),{conversations:1,added:1,existing:0});
  assert.deepEqual(await importOwnerChats(db,body,new Date("2026-10-31T06:00:00Z"),true),{conversations:1,added:0,existing:1});
  const source=(await db.query<any>("SELECT * FROM sources"))[0];
  assert.equal(source.category,"owner-chat");assert.equal(source.clearance_acknowledgement,STANDING_CHAT_CONSENT_ACKNOWLEDGEMENT);assert.equal(sourceEligible(source),true);
  const event=(await db.query<any>("SELECT detail FROM events WHERE kind='source_cleared'"))[0];assert.match(JSON.stringify(event.detail),/owner-standing-consent/);
  // The standing acknowledgement never clears any other kind of source.
  assert.equal(sourceEligible({...source,category:"user-reported-notes"}),false);
  const intake=new SourceIntake(db),note=await intake.stage({text:"I reviewed one draft and kept the review notes short.",category:"project-note",reported_date:"2026-10-30"});
  await assert.rejects(intake.clearStanding(note.id,note.hash),/imported chat messages only/);
 }finally{await db.close();}
});

test('the import request accepts only prepared owner messages',()=>{
 const good={provider:"chatgpt",id:"c",title:"t",reported_date:"2026-10-30",messages:[{text:mine1,date:"2026-10-30"}]};
 assert.equal(parseChatImport({conversations:[good]},today).length,1);
 for(const bad of [{conversations:[]},{conversations:[{...good,provider:"slack"}]},{conversations:[{...good,messages:[{text:"short",date:"2026-10-30"}]}]},{conversations:[{...good,messages:[{text:mine1,date:"2026-11-30"}]}]},{conversations:[{...good,extra:1}]},{conversations:[good],more:1}])assert.throws(()=>parseChatImport(bad,today),/Invalid chat import/);
});

test('the assistant collector path accepts Claude Code sessions only',async()=>{
 const {importClaudeCodeChats}=await import('../lib/chat-import');
 const db=await embedded();try{
  const conv=(provider:string)=>({conversations:[{provider,id:"s",title:"",reported_date:"2026-10-30",messages:[{text:mine1,date:"2026-10-30"},{text:mine2,date:"2026-10-30"}]}]});
  await assert.rejects(importClaudeCodeChats(db,conv("chatgpt"),new Date("2026-10-31T06:00:00Z"),true),/Invalid chat import/);
  assert.equal((await importClaudeCodeChats(db,conv("claude-code"),new Date("2026-10-31T06:00:00Z"),true)).added,1);
 }finally{await db.close();}
});
