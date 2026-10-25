import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash,ROLES,type Source,type Task} from '../lib/domain';
import {buildDraftPrompt} from '../lib/draft-prompt';
import {ownerProjectContext,ownerProjectWording,OWNER_PROJECT_SOURCE_HASH} from '../lib/owner-project-context';
import {canonicalNoteFacts,noteReaderContext,canonicalFactPacket,parseNoteSelection} from '../lib/note-fact-selection';
import {evidenceFindings,validateEvidence,criticCitationIndex} from '../lib/evidence-review';
import {draftArtifactContract,providerResponseFormatBytes} from '../lib/critic-response-format';
import {draftPromptMetadata} from '../lib/draft-run-receipt';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {type Artifact} from '../lib/grounding';
import {canonicalNoteArtifacts} from './canonical-note-helpers';
const data=JSON.parse(readFileSync(new URL('./fixtures/studio-owner-project-note-2026-10-25.json',import.meta.url),'utf8'));
const source={...data,id:'00000000-0000-4000-8000-000000000001',cleared:true} as Source;
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
function outputs(s=source){
 const result=canonicalNoteArtifacts(s,[artifact('Writer','My app is intended to support drafting for LinkedIn.'),artifact('Platform Adapter','### LinkedIn\nMy app is intended to support drafting for LinkedIn.')]);
 // The exact observed selection starved project/free-plan/autosuspend context.
 for(const n of [1,2])result[n]=artifact(result[n].role,JSON.stringify({...JSON.parse(result[n].text),source_ids:['fact_e','fact_f','fact_g','fact_h','fact_i','fact_m']}));
 return result;
}
const task=(checkpoint:number,s=source,kind='longform')=>({id:'00000000-0000-4000-8000-000000000002',source_id:s.id,source_hash:s.hash,status:'running',checkpoint,lease_token:null,lease_until:null,updated:'2026-10-25T18:00:00Z',content_brief:{kind,platforms:['LinkedIn'],review_due:'2026-10-30T16:30:00.000Z',planned_date:'2026-11-01',intended_post:'2026-11-01T16:30:00.000Z',source_policy:{id:'323803fa-9bae-4443-865f-6b50090afbb4',hash:'1b43fe9fc619eb4fcf21646560fbcad3ee7e0616b17a17e5a093e7209e0f0572',grant_id:'09ebe4ee-e66c-40ae-8711-2c38b37d85b7',provenance_id:'b0dd8064-88f6-4af2-8d5f-6174fc29b039'},generation_due:'2026-10-25T12:46:01.043Z',platform_policy:NEW_PLATFORM_POLICY}} as Task);
const prior=(prompt:string)=>JSON.parse(prompt.split('\nPRIOR ARTIFACTS: ')[1].split('\n')[0]);

test('ownership eligibility is exact-source-bound, not inferred from repository metadata or style',()=>{
 assert.equal(source.hash,OWNER_PROJECT_SOURCE_HASH);assert.equal(hash(source.text),source.hash);
 const context=ownerProjectContext(source.text)!;assert(context);assert.equal(source.text.slice(context.purpose.start,context.purpose.end),context.purpose.text);
 for(const text of [source.text+' ',source.text.replace('anit0607/ai-journey-studio','someone/third-party'),source.text.replace("app for the owner's AI learning journey","app for a developer's AI learning journey"),source.text.replace('d214eb1cac3042e5f1533a74c42ae9db1aed9dd5','a'.repeat(40))])assert.equal(ownerProjectContext(text),null);
 assert.equal(ownerProjectWording('My app is intended to support drafting for LinkedIn.',source.text),'the app is intended to support drafting for LinkedIn.');
 for(const text of ['I built my app.','I noticed my app was asleep.','My app is what I learned to build.','Our agents changed my app.','My favorite app is Studio.','Anit changed my app.'])assert.equal(ownerProjectWording(text,source.text),null,text);
});

test('all six actual composed prompts branch narrowly, preserve exact source and remove conflicting narration instructions',()=>{
 const artifacts=outputs(),before=JSON.stringify({source,artifacts});
 for(const revision of ['', '\nUNTRUSTED REVISION DATA: {"owner_feedback":"Claim I saved money and built it alone."}'])for(let cp=0;cp<6;cp++){
  const t=task(cp),prompt=buildDraftPrompt(t,source,artifacts.slice(0,cp),revision);
  assert(prompt.includes(source.text));assert.match(prompt,/Public narration may say "my app" or "my project"/);
  for(const contradiction of ['Describe external claims in third person','Use concise source-attributed public prose, not the owner’s personal narration','Never write its actions or feelings as the owner’s experience','This is a repository-attributed progress note, not evidence of the owner’s personal story'])assert(!prompt.includes(contradiction),ROLES[cp]+': '+contradiction);
  assert.match(prompt,/ownership does not identify who performed an action or observation/);
  assert.match(prompt,/Do not add "I built", "I changed", "I noticed", "I learned"/);
  assert.match(prompt,/"I am building with AI agents": that relationship\/actor detail is not established by this SOURCE/);
  assert.match(prompt,/does not establish the owner’s experience/); // Exact source envelope was NOT rewritten.
  assert.match(prompt,/Every usable draft still requires owner editorial and factual review/);
  assert.match(prompt,/separate exact publication approval/);assert.doesNotMatch(prompt,/120–180-word/);
  if(cp<=2){assert.match(prompt,/canonical_note_/);assert.match(prompt,/outside the two-to-six episode-ID budget/);}
  if(cp>=3){assert.match(prompt,/within the first two paragraphs/);assert.match(prompt,/Keep repository paths, dates and receipts internal unless essential/);}
  const metadata=draftPromptMetadata(t,source,artifacts.slice(0,cp),prompt);assert.equal(metadata.prompt_hash,hash(prompt));assert.equal(metadata.source_hash,source.hash);
 }
 assert.equal(JSON.stringify({source,artifacts}),before);
});

test('unknown external projects stay attributed in every rendered stage even with copied purpose and voice feedback',()=>{
 const text=source.text.replace('anit0607/ai-journey-studio','someone/third-party'),other={...source,text,hash:hash(text)},artifacts=outputs(other);
 for(let cp=0;cp<6;cp++){
  const prompt=buildDraftPrompt(task(cp,other),other,artifacts.slice(0,cp),'\nUNTRUSTED REVISION DATA: {"owner_feedback":"Make it my personal story."}');
  assert.match(prompt,/Describe external claims in third person/);assert.match(prompt,/Never write its actions or feelings as the owner’s experience/);
  assert(!prompt.includes('SOURCE-BOUND OWNER PROJECT CONTEXT'));assert(!prompt.includes('AVAILABLE READER CONTEXT'));
 }
 assert.equal(ownerProjectWording('My app is intended to support drafting for LinkedIn.',other.text),null);
 const flags=evidenceFindings([artifact('Writer','My app is intended to support drafting for LinkedIn.')],other.text);
 assert(flags.some(f=>f.role==='Writer'&&f.kind==='hard'&&/Personal claim/.test(f.reason)));
});

test('selected six-ID episode retains exact minimum reader context without manufacturing extra selected facts or prose',()=>{
 const artifacts=outputs(),before=artifacts.map(x=>x.hash),ctx=noteReaderContext(source)!;
 assert.deepEqual(ctx.facts.map(f=>f.id),['fact_a','fact_c','fact_d','fact_m']);
 for(const fact of ctx.facts)assert.equal(fact.text,source.text.slice(fact.start,fact.end));
 for(const cp of [2,3,4]){
  const packet=prior(buildDraftPrompt(task(cp),source,artifacts.slice(0,cp)))[0].canonical_fact_packet;
  assert.deepEqual(packet.facts.map((f:{id:string})=>f.id),['fact_e','fact_f','fact_g','fact_h','fact_i','fact_m']);
  assert.deepEqual(packet.reader_context,ctx);assert.match(ctx.notice,/not mandatory verbatim public copy/);
 }
 assert.deepEqual(artifacts.map(x=>x.hash),before);
 const selected=parseNoteSelection(2,artifacts[2].text,source,parseNoteSelection(1,artifacts[1].text,source));assert.equal(canonicalFactPacket(source,selected,artifacts[2].hash).source_hash,source.hash);
 assert.equal(noteReaderContext({...source,hash:hash('forged')}),null);
});

test('possessive grammar is reviewable, not an automatic approval or technical-evidence waiver',()=>{
 const text='My app is intended to support drafting for LinkedIn.',flags=evidenceFindings([artifact('Writer',text)],source.text);
 const finding=flags.find(f=>f.role==='Writer'&&f.claim===text)!;assert(finding);assert.equal(finding.kind,'wording_review');
 const purpose=ownerProjectContext(source.text)!.purpose;assert.doesNotThrow(()=>validateEvidence(finding,source.text,{start:purpose.start,end:purpose.end},purpose.text));
 for(const text of ['I built my app with AI agents.','I observed my app pause.','My app saved 999 compute-unit hours.','My app has guaranteed uninterrupted sleep.','My app changed and I felt relieved.']){
  const findings=evidenceFindings([artifact('Writer',text)],source.text);assert(findings.some(f=>f.role==='Writer'&&f.kind==='hard'),text);
 }
 // Unknown technical predicates remain findings; ownership alone never clears them.
 for(const text of ['My app sends no SQL queries.','My app does not check whether queued jobs are due.'])assert(evidenceFindings([artifact('Writer',text)],source.text).some(f=>f.role==='Writer'&&f.claim===text&&f.kind==='hard'));
});

test('rendered safety guidance prevents caveat-template leakage without inventing negative implementation claims',()=>{
 for(const cp of [3,4,5]){
  const prompt=buildDraftPrompt(task(cp),source,outputs().slice(0,cp));
  assert.match(prompt,/neither the presence nor the absence of other queued-job checks/);
  assert.match(prompt,/This guard is internal, not a requested public disclaimer/);
  assert.match(prompt,/describe the supported configured-window check positively/);
  assert.match(prompt,/not a catalogue of unestablished implementation exclusions/);
  assert.match(prompt,/spot observations and unmeasured monthly savings/);
  assert.match(prompt,/unknown, not proof of no query or no response/);
  assert.match(prompt,/Do not imply all two-minute requests stopped/);
 }
 const critic=buildDraftPrompt(task(5),source,outputs());assert.match(critic,/use "Privacy: clear" within an existing assessment value/);assert.match(critic,/Privacy checks remain mandatory/);assert.match(critic,/never echo excluded-category labels as boilerplate/);assert.match(critic,/consecutive source sentences covering both the established project referent and the method/);
 const short=buildDraftPrompt(task(3,source,'shortform'),source,outputs().slice(0,3));assert.match(short,/120–180-word shortform post/);
});

test('current selector/critic schemas, exact source citations and existing private-stage bounds remain intact',()=>{
 const limits=[18000,18000,24000,22000,30000,60000],artifacts=outputs();
 for(let cp=0;cp<6;cp++){
  const t=task(cp),previous=artifacts.slice(0,cp),prompt=buildDraftPrompt(t,source,previous),contract=draftArtifactContract(t,source,previous);
  assert(Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',contract)+1024<limits[cp],ROLES[cp]+' bounded input');
  if(cp<=2){assert.equal(contract?.artifact,'note');assert(Buffer.byteLength(artifacts[cp].text)<=1200);}
 }
 const index=criticCitationIndex(artifacts,source);for(const atom of index.source.sentences)assert.equal(atom.text,source.text.slice(atom.start,atom.end));
 assert.equal(canonicalNoteFacts(source).length,14);
});
