import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash,CAPSULE} from '../lib/domain';
import {bundleQuality,groundingRules,SUPPORTED_SENTENCES,type Artifact} from '../lib/grounding';
import {evidenceFindings,validateEvidence} from '../lib/evidence-review';
import {attributedCommitSummary,sourceDraftingContract,sourceRoleGoal} from '../lib/drafting-contract';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-owner-draft-blocked-2026-10-24.json',import.meta.url),'utf8')) as {task_id:string;status:string;checkpoint:number;source:{text:string;hash:string;reported_date:string};bundle:Artifact[];calls:Array<{cost_microdollars:number}>;later_calls:number};
const {source}=observed;
const title='Add owner-only exact-task bounded draft execution';
const artifact=(text:string,role='Story Miner'):Artifact=>({role,text,hash:hash(text)});
const flags=(text:string,s=source.text)=>bundleQuality([artifact(text)],s,source.reported_date).flags.filter(flag=>flag.role==='Story Miner');
const inference=(text:string,s=source.text)=>flags(text,s).filter(flag=>/Commit-summary evidence/.test(flag.reason));

test('the observed blocked run fixture preserves source, artifacts and two settled calls exactly',()=>{
 assert.equal(source.hash,'064eb775176b872071baba7eef52bd36a2f119d078e9f5d972eb7fa0dc66f2f5');assert.equal(hash(source.text),source.hash);
 assert.equal(source.text.length,273);for(const item of observed.bundle)assert.equal(hash(item.text),item.hash);
 assert.equal(observed.bundle[0].hash,'293d42534dd3f78125a7339c9713d27219d79b64d9472ef3839805661a461c04');
 assert.equal(observed.bundle[1].hash,'5d875dd920a0d55c95d50abdf24987b585c324b646c944b4ae8da6f9abd6c306');
 assert.equal(observed.bundle[1].text.slice(558,571),'authorization');
 assert.equal(observed.status,'blocked');assert.equal(observed.checkpoint,2);assert.equal(observed.later_calls,0);
 assert.equal(observed.calls.reduce((total,call)=>total+call.cost_microdollars,0),1168);
 const before=JSON.stringify(observed),findings=evidenceFindings(observed.bundle,source.text,source.reported_date);
 for(const claim of ['This commit shows an effort','This indicates a focus','This addition suggests a learning step','Scope: Restricting draft execution']){
  const finding=findings.find(flag=>flag.kind==='hard'&&flag.claim.includes(claim));assert(finding,claim);
  assert.throws(()=>validateEvidence(finding,source.text,{start:0,end:source.text.length},source.text),/Only an individual wording/);
 }
 assert.equal(JSON.stringify(observed),before);
});

test('attributed prompts do not supply capsule biography or an affirmative learning-story goal',()=>{
 const ordinary='Find an honest learning-story angle supported by the source.';
 for(const provider of ['GitHub','YouTube']){
  const text=source.text.replace('Attributed GitHub','Attributed '+provider);
  const goal=sourceRoleGoal(1,text,ordinary),rules=groundingRules(text);
  assert(!goal.includes(ordinary));assert.match(goal,/concise attributed source update/);
  assert.match(rules,/third person/);assert.match(rules,/Prior|prior artifact/);
  for(const personal of SUPPORTED_SENTENCES)assert(!rules.includes(personal),personal);
 }
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const contract=sourceDraftingContract(checkpoint,source.text);
  assert.match(contract,/not code, a diff, tests or deployment results/);
  assert.match(contract,/quote the title exactly/);assert.match(contract,/complete SOURCE including its attribution disclaimer/);
  assert.match(contract,/never interpreted Scope/);
 }
 assert(!sourceDraftingContract(0,source.text).includes('Do not rewrite the facts into third person.'));
 assert.match(sourceDraftingContract(0,'I reviewed a draft.'),/Do not rewrite the facts into third person/);
 assert.equal(sourceRoleGoal(1,'I reviewed a draft.',ordinary),ordinary);
 assert.equal(sourceRoleGoal(1,CAPSULE,ordinary),ordinary);
 assert.equal(sourceRoleGoal(0,source.text,'Extract facts.'),'Extract facts.');
 assert.match(groundingRules(CAPSULE),/I am a non-coder/);
});

test('title-only evidence cannot become learning, intent, security benefits or working capabilities',()=>{
 for(const text of [
  'This commit shows an effort to implement a feature.',
  'This indicates a focus on precise control, aiming to enhance security.',
  'This addition suggests a learning step in managing task boundaries.',
  'The change demonstrates role-based access in complex development environments.',
  'The feature restricts draft execution to the owner.',
  'The workflow enforces exact-task boundaries.',
  'The feature is tested.',
  'The workflow was successfully deployed.',
  'Scope: Restricting draft execution rights to the owner.'
 ]){
  assert(inference(text).length>0,text);
  assert(evidenceFindings([artifact(text)],source.text).some(flag=>flag.kind==='hard'),text);
 }
 // The narrow detector does not treat a correctly qualified evidence gap as proof.
 for(const text of ['The commit title does not prove that the feature works.','Evidence needed: test results are not supplied.','The feature is not verified by this title.'])assert.deepEqual(inference(text),[],text);
});

test('verbatim evidence means actual source lines, not a model-supplied label',()=>{
 const good='**Verbatim evidence:**\n'+source.text.split('\n').map(line=>'- '+line).join('\n');
 assert(!flags(good).some(flag=>/Verbatim evidence/.test(flag.reason)));
 for(const text of [
  '**Verbatim evidence:**\n- Scope: Restricting draft execution rights to the owner.',
  'Verbatim evidence:\n- '+title+' safely and reliably',
  '### Verbatim evidence:\n- Author/Committer: Anit0607',
  '**Verbatim evidence:**\n- '+title+'.',
  '# Verbatim evidence\n- '+title+'\n\n- Scope: Restricting draft execution rights to the owner.',
  '**Verbatim evidence**\n'+title+'\n\nThe feature works.'
 ])assert(flags(text).some(flag=>/Verbatim evidence/.test(flag.reason)),text);
 assert(!flags('## Verbatim evidence\n'+title+'\n\n## Proposed angle\nDiscuss the repository update.').some(flag=>/Verbatim evidence/.test(flag.reason)));
 assert.deepEqual(inference(title),[]);
 assert.deepEqual(inference('The commit message is "'+title+'".'),[]);
 assert.deepEqual(flags('SOURCE: '+source.text),[]);
});

test('commit-only additions do not reclassify owner notes, build notes, other providers or legacy checks',()=>{
 assert.equal(attributedCommitSummary(source.text),title);
 const buildNote='Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: anit0607/ai-journey-studio\nCommit: '+ 'a'.repeat(40)+'\nNote: docs/build-notes/test.md\n\n## Verified progress\nThe workflow was tested.';
 for(const text of ['I reviewed a draft.',CAPSULE,buildNote,source.text.replace('Attributed GitHub','Attributed YouTube')]){
  assert.equal(attributedCommitSummary(text),null);assert.deepEqual(inference('This addition suggests a learning step.',text),[]);
 }
 // No new rule resolves or removes pre-existing personal/numerical safeguards.
 for(const text of ['I learned to manage agent workflows.','The project has 500 users.'])assert(flags(text).length>0,text);
});
