import test from "node:test";
import assert from "node:assert/strict";
import {sourceDraftingContract,ownerChatRecord,OWNER_CHAT_HARVEST} from "../lib/drafting-contract";
import {chatSourceTexts} from "../lib/chat-import";

const conv=(provider:"chatgpt"|"claude"|"gemini"|"claude-code")=>({provider,id:"c",title:"Travel planner app",reported_date:"2026-10-25",messages:[{text:"I tried to make the planner load faster and it broke the map twice before I fixed it.",date:"2026-10-25"}]});

test('every imported chat source gets the bounded Harvester instruction; other sources keep full extraction',()=>{
 for(const provider of ["chatgpt","claude","gemini","claude-code"] as const){
  const [{text}]=chatSourceTexts(conv(provider));
  assert(ownerChatRecord(text),provider);
  const harvester=sourceDraftingContract(0,text);
  assert(harvester.includes(OWNER_CHAT_HARVEST));assert.match(harvester,/under 2,500 characters/);
  assert(!harvester.includes("Extract complete verbatim source sentences"),'no instruction to copy the whole long chat');
  assert(!sourceDraftingContract(3,text).includes(OWNER_CHAT_HARVEST),'later stages are unchanged');
 }
 const note="I reviewed one draft and kept the review notes short.";
 assert(!ownerChatRecord(note));assert.match(sourceDraftingContract(0,note),/Extract complete verbatim source sentences/);
 assert(!ownerChatRecord("Owner story interview (Post). "+note),'Story Bank answers are short and keep full extraction');
});
