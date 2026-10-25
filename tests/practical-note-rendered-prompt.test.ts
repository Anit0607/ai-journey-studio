import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildDraftPrompt,projectDraftContext} from '../lib/draft-prompt';
import {sourceDraftingContract,sourceRoleGoal} from '../lib/drafting-contract';
import {draftingGuidance} from '../lib/drafting-guidance';
import {hash,type Source,type Task} from '../lib/domain';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {criticCitationIndex,evidenceQuality} from '../lib/evidence-review';
import {providerResponseFormatBytes} from '../lib/critic-response-format';
import {type Artifact} from '../lib/grounding';

const fixture=JSON.parse(await readFile(new URL('./fixtures/database-note-draft-2026-10-25.json',import.meta.url),'utf8'));
const source={...fixture.source,id:'00000000-0000-4000-8000-000000000001',cleared:true} as Source;
const outputs:Artifact[]=fixture.outputs;
const task=(checkpoint:number)=>({id:'00000000-0000-4000-8000-000000000002',source_id:source.id,source_hash:source.hash,status:'running',checkpoint,lease_token:null,lease_until:null,updated:'2026-10-25T08:51:00.000Z',content_brief:{kind:'shortform',platforms:['LinkedIn'],platform_policy:NEW_PLATFORM_POLICY}} as Task);
const render=(checkpoint:number,previous=outputs.slice(0,checkpoint))=>buildDraftPrompt(task(checkpoint),source,previous);
const prior=(prompt:string)=>JSON.parse(prompt.split('\nPRIOR ARTIFACTS: ')[1].split('\n')[0]);

test('actual progress-note Writer and Adapter retain useful LinkedIn guidance with no competing report instruction',()=>{
 for(const checkpoint of [3,4]){
  const prompt=render(checkpoint);
  assert(prompt.includes(source.text),'Exact cleared source remains factual authority');
  assert.match(prompt,/ONE supported choice or method/);
  assert.match(prompt,/not a system-status report/);
  assert.match(prompt,/Never write its actions or feelings as the owner’s experience/);
  assert.match(prompt,/suggested reader actions from factual claims/);
  assert.match(prompt,/not a claim that it was performed, tested, or experienced by the owner/);
  assert.match(prompt,/120–180-word shortform post/);
  const longform=buildDraftPrompt({...task(checkpoint),content_brief:{...task(checkpoint).content_brief,kind:'longform'}},source,outputs.slice(0,checkpoint));
  assert.doesNotMatch(longform,/120–180/);
  assert.match(longform,/longform means a structured deeper piece using only supplied evidence/);
  assert.match(longform,/Follow the active format guidance; do not pad the story beyond its evidence/);
  assert.match(longform,/ONE supported choice or method/);
  assert(longform.includes(source.text));
  assert.match(longform,/Never write its actions or feelings as the owner’s experience/);
  for(const bad of ['Do not require a hook, payoff','audience need, reader takeaway, advice or generalized benefit','A concise milestone update','Keep limitations and advice internal','no manufactured hook, payoff, advice','Attributed source update'])assert(!prompt.includes(bad),'Conflicting rendered phrase: '+bad);
 }
 assert.match(render(3),/Use an evidence-backed question or specific tension as the opening; deliver its payoff promptly/);
 assert.match(render(3),/Keep paragraphs short and one idea per beat/);
 assert.match(render(4),/One clear opening, immediate payoff, evidence, useful takeaway/);
 assert.match(render(4),/Keep the single LinkedIn section/);
});

test('actual source-note selection is one concise labeled episode, not a narrative or a whole-log retelling',()=>{
 const miner=render(1),strategist=render(2);
 assert.match(miner,/Select ONE specific source-supported episode or method, not a summary of the entire note/);
 assert.match(miner,/under 120 words, followed by two to four complete verbatim source sentences/);
 assert.match(strategist,/concise labeled brief/);
 assert.match(strategist,/truthful opening/);
 assert.match(strategist,/proposed instruction/);
 assert.match(strategist,/audience need, evidence gap and reader takeaway/);
 assert.deepEqual(prior(miner),[]);
 assert.deepEqual(prior(strategist).map((x:Artifact)=>x.role),['Story Miner']);
});

test('public writing sees selected brief, not repeated Harvester and Story Miner narratives',()=>{
 assert.deepEqual(prior(render(3)).map((x:Artifact)=>x.role),['Strategist']);
 assert.deepEqual(prior(render(4)).map((x:Artifact)=>x.role),['Strategist','Writer']);
 assert.equal(prior(render(3))[0].text,outputs.find(x=>x.role==='Strategist')!.text);
 assert(!render(3).includes('indicating the autosuspend was active without manual intervention'),'Actual erroneous Story Miner narrative is not copied into Writer context');
 assert(!render(4).includes('indicating the autosuspend was active without manual intervention'));
 assert.match(render(3),/selected editorial brief below proposes framing, not new facts/);
});

test('omitted upstream holds remain explicit without copying their narrative or clearing them',()=>{
 const text='EDITORIAL HOLD: needs_source\nLong internal narrative marker that must not be copied.';
 const previous=outputs.slice(0,3).map(x=>x.role==='Story Miner'?{role:x.role,text,hash:hash(text)}:x);
 const prompt=render(3,previous);
 assert(!prompt.includes('Long internal narrative marker'));
 assert.match(prompt,/PRIOR EDITORIAL HOLDS.*"Story Miner","status":"needs_source"/);
 assert.match(prompt,/shorter context projection does not clear them/);
 assert.deepEqual(prior(prompt).map((x:Artifact)=>x.role),['Strategist']);
});

test('Critic still sees exact current artifacts and current index; format accounting and caps stay explicit',()=>{
 const prompt=render(5),index=criticCitationIndex(outputs.slice(0,5),source);
 assert.deepEqual(prior(prompt),outputs.slice(0,5));
 assert(prompt.includes(JSON.stringify(index)));
 assert.match(prompt,/Never attach source IDs to an unsupported verdict/);
 assert.match(prompt,/At most 8 entries and 600 characters per reason/);
 assert.match(prompt,/1200 output-token cap/);
 for(let checkpoint=0;checkpoint<6;checkpoint++)assert(Buffer.byteLength(render(checkpoint))+providerResponseFormatBytes('openai',checkpoint===5?{artifact:'critic'}:undefined)<48000);
 const q=evidenceQuality(outputs,source,[],NEW_PLATFORM_POLICY);
 assert.equal(q.flags.filter(x=>x.kind==='hard').length,20);
 assert.equal(q.flags.filter(x=>x.kind==='wording_review').length,9);
 assert.equal(q.critic.valid,false);
 assert.equal(q.editorial.status,'editorial_review_required');
});

test('context projection does not modify historical non-note prompts or manufacture approval',()=>{
 assert.equal(projectDraftContext(3,outputs,'I reviewed the agent plan.'),outputs);
 assert.equal(projectDraftContext(5,outputs,source.text),outputs);
 const heldText='EDITORIAL HOLD: needs_source\nPreserve this exact non-note hold.';
 for(const item of nonNoteBaseline){
  const nonNoteSource={...source,text:item.text,hash:hash(item.text)};
  for(let checkpoint=2;checkpoint<6;checkpoint++){
   const previous=outputs.slice(0,checkpoint).map(x=>x.role==='Story Miner'?{...x,text:heldText,hash:hash(heldText)}:x);
   const prompt=buildDraftPrompt(task(checkpoint),nonNoteSource,previous);
   assert.deepEqual(prior(prompt),previous);
   assert(prompt.includes(JSON.stringify(heldText)));
   assert(!prompt.includes('PRIOR EDITORIAL HOLDS'));
  }
 }
 assert.match(render(3),/Every usable draft still requires owner editorial and factual review/);
 assert.match(render(3),/separate exact publication approval/);
});

// Byte-exact PR43 non-note contracts: protects the scope of this note-only repair.
const nonNoteBaseline=[
  {
    "kind": "manual owner note",
    "text": "I reviewed the agent plan. I asked for a list of background timers.",
    "role_hashes": [
      "dfd0ec9e774cbf492d22b787e2bb99a9eb37b63ce1be7823c21952be27438fcf",
      "6445a1b2b64c656e38172bacf8ff9bb7c31cc048604ee78dae58198c9b7bca31",
      "02632610be52bba7c218fb4613bd16f9cd4ad8e2cda294799880d178147baccb",
      "05986f17cf1bea5635da8fb1146e322d516d7815338f91213281da49196b8ca7",
      "b18fb239bc61e8d20eb6018e4fd035e9ee16df339f3897d59c518c0a0c389b88",
      "54245e82977ac45fdcda677cc61cccaf06dfc1adb2903b8320ef25d17f5eab8a"
    ]
  },
  {
    "kind": "commit title",
    "text": "Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: anit0607/ai-journey-studio\nAuthor account: Anit0607\nCommitter account: Anit0607\nCommit: 067afeffd058fe077c2eeaeedd262a8143781f6a\nfix: distinguish artifact privacy and ground attributed commit summaries",
    "role_hashes": [
      "1abb9ea861378c5ce4a6a26b63b491f89152edd45f509358bae903c2e9286e67",
      "a50a05dbec25c9ef7f31c92e41d7a24c0c2a46c18dde6c4ca2c7bae668b84c13",
      "770a4e7c38ea113b7741127e68b2c20a8e6a26118754b9e9250e990f7a9995d7",
      "c58deafabfff2b0708f1d472bdf5a50e43e4009f5c836f9f374da8db2871571f",
      "993fb98e985272bab1fc688a642eb184f56ba3a43847613047f9a59791277b00",
      "3863ad600b4d32ae1f73080a6a40f54ec00ecb7bf3ba1afefffcf0ccba8297b4"
    ]
  },
  {
    "kind": "YouTube attribution",
    "text": "Attributed YouTube evidence; this record does not establish the owner’s experience.\nChannel: Fixture Channel\nThe presenter demonstrated a background timer.",
    "role_hashes": [
      "7f7590953ad68361bc190a0e81d56d762b3d5322b32a8f4b058d3b5797ce5f2d",
      "5a6cdf7c306b0ee26068668cb2126c0f3b37bf1ece51b3422315d4e83d38a271",
      "a56f11de187ec51e0fc4be9c339b816413cfbe3cf3f000a6045463391d267d85",
      "16a69fed577ff83ae8bf03a03b1b4a962c9907ece1dab00b19fc937368875ae6",
      "847700c0ea2ff2279e5bffaf45def9116514ad1dd4dadb5bfcf350594bfc93ef",
      "1ceeaa2455062edaa4e84e10392cdbfe95ac3820148525b7f64c0134ddc1e21d"
    ]
  }
];
test('all six manual, commit-title and YouTube role contracts remain byte-identical to PR43',()=>{
 for(const item of nonNoteBaseline)for(let checkpoint=0;checkpoint<6;checkpoint++)assert.equal(hash(JSON.stringify({contract:sourceDraftingContract(checkpoint,item.text),goal:sourceRoleGoal(checkpoint,item.text,'ordinary role goal'),linkedin:draftingGuidance(checkpoint,NEW_PLATFORM_POLICY,item.text),legacy:draftingGuidance(checkpoint,undefined,item.text)})),item.role_hashes[checkpoint],item.kind+' checkpoint '+checkpoint);
});
