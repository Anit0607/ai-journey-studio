import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {criticCitationIndex,criticSuggestions,evidenceFindings,evidenceQuality,validateEvidence,evidenceApprovalCurrent,EVIDENCE_POLICY,type Finding,type Decision} from '../lib/evidence-review';
import {hash,ROLES} from '../lib/domain';
import type {Artifact} from '../lib/grounding';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-rich-note-draft-2026-10-25.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string};outputs:Artifact[]};
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
const critic='Unsupported claims: Compare the source.\nEvidence needed: Owner review remains required.\nProposed advice: Keep exact evidence.';
function bundle(text:string){return ROLES.map(role=>artifact(role,role==='Critic'?critic:role==='Platform Adapter'?'### LinkedIn\n'+text:text));}
const source=(text:string)=>({text,hash:hash(text)});

test('actual richer-note source and all six saved artifact bytes retain their captured hashes',()=>{
 assert.equal(hash(observed.source.text),observed.source.hash);
 for(const output of observed.outputs)assert.equal(hash(output.text),output.hash);
 assert.equal(observed.outputs.length,6);
});

test('citation sentence spans preserve decimals, URLs, unpunctuated lines and exact UTF-16 offsets',()=>{
 const text='Repository: owner/repo\nThe batch 🧪 ran at 00:15:20.411 UTC. The cost was $1.25.\nNote: docs/build-notes/progress.md\n- https://github.com/owner/repo\nThe job was not approved';
 const index=criticCitationIndex(bundle(text),source(text));
 assert.deepEqual(index.source.sentences.map(atom=>atom.text),[
  'Repository: owner/repo','The batch 🧪 ran at 00:15:20.411 UTC.','The cost was $1.25.',
  'Note: docs/build-notes/progress.md','- https://github.com/owner/repo','The job was not approved'
 ]);
 const covered=Array(text.length).fill(false);
 for(const atom of index.source.sentences){assert.equal(text.slice(atom.start,atom.end),atom.text);for(let n=atom.start;n<atom.end;n++)covered[n]=true;}
 for(let n=0;n<text.length;n++)assert(/\s/.test(text[n])||covered[n],`Lost source character ${n}`);
});

test('actual richer-note timestamps remain complete; fractional suffixes never become new figure findings',()=>{
 const index=criticCitationIndex(observed.outputs,observed.source);
 assert(index.source.sentences.some(atom=>atom.text.includes('00:15:03.207 to 00:15:20.411 UTC')));
 assert(index.source.sentences.some(atom=>atom.text.includes('25 findings when inspected at 00:17:35.351 UTC')));
 assert(index.source.sentences.some(atom=>atom.text.includes('00:40:01.724 UTC')&&atom.text.includes('00:40:27.714 UTC')));
 const quality=evidenceQuality(observed.outputs,observed.source,[],NEW_PLATFORM_POLICY);
 assert(!quality.flags.some(flag=>/^(?:411|351|714) UTC/.test(flag.claim)));
 assert.equal(quality.status,'needs_revision');assert.equal(quality.critic.valid,false);
 assert.equal(quality.evidence_version,null);
});

test('correct timestamp precision is retained; changed or shortened clocks and amounts are not silently certified',()=>{
 const text='The batch ran at 00:15:20.411 UTC and cost $1.25.';
 assert.equal(evidenceQuality(bundle(text),source(text),[],NEW_PLATFORM_POLICY).flags.length,0);
 for(const change of [text.replace('20.411','20.412'),text.replace('20.411','21.411'),text.replace('20.411','20'),text.replace('$1.25','$1.26'),text.replace('$1.25','$1')]){
  const flags=evidenceFindings(bundle(change),text,undefined,NEW_PLATFORM_POLICY);
  assert(flags.some(flag=>flag.role==='Writer'&&flag.kind==='hard'),change);
 }
});

test('recovered newline/decimal prefixes cannot hide new certainty, figures or reversed negation',()=>{
 for(const [text,claim] of [
  ['The workflow is not reliable.','The workflow is reliable\nThe cost was $9.50.'],
  ['The project has 15 users.','The project has 1 user.'],
  ['I use AI agents for implementation.','I do not use AI agents for implementation.'],
  ['The workflow was inspected.','The workflow will work after release.']
 ])assert(evidenceFindings(bundle(claim),text,undefined,NEW_PLATFORM_POLICY).some(flag=>flag.role==='Writer'&&flag.kind==='hard'),claim);
});

test('actual qualitative embellishments remain unresolved; parser repair does not auto-approve them',()=>{
 const quality=evidenceQuality(observed.outputs,observed.source,[],NEW_PLATFORM_POLICY);
 for(const phrase of ['testing for this repository change was thorough','Offline testing was thorough','smooth automated workflows and robust testing']){
  assert(quality.flags.some(flag=>flag.claim.includes(phrase)&&flag.resolution===null),phrase);
 }
});

test('unchanged actual Critic remains invalid, and repairing punctuation never repairs unsupported source IDs or stale indexes',()=>{
 const parsed=JSON.parse(observed.outputs.find(output=>output.role==='Critic')!.text);
 const withCritic=(data:unknown)=>observed.outputs.map(output=>output.role==='Critic'?artifact('Critic',JSON.stringify(data)):output);
 assert.equal(criticSuggestions(observed.outputs,observed.source).valid,false);
 const fixed={...parsed};for(const label of ['Unsupported claims','Evidence needed','Proposed advice']){fixed[label+':']=fixed[label];delete fixed[label];}
 assert.equal(criticSuggestions(withCritic(fixed),observed.source).valid,false);
 fixed.index_hash=criticCitationIndex(observed.outputs,observed.source).index_hash;
 assert.equal(criticSuggestions(withCritic(fixed),observed.source).valid,false);
});

test('a valid current citation is advisory only and cannot auto-waive faithful paraphrases',()=>{
 const text='The workflow is a project for review.',claim='The project workflow is for review.',b=bundle(claim),s=source(text),index=criticCitationIndex(b,s);
 const data={schema:2,source_hash:s.hash,index_hash:index.index_hash,'Unsupported claims:':'Compare the wording.','Evidence needed:':'Owner review required.','Proposed advice:':'Retain the source meaning.',evidence:[{claim_id:'writer:0',source_ids:['source:0'],verdict:'wording_review',reason:'Owner comparison is still required.'}]};
 b[5]=artifact('Critic',JSON.stringify(data));const q=evidenceQuality(b,s,[],NEW_PLATFORM_POLICY);
 assert.equal(q.critic.valid,true);assert.equal(q.status,'needs_revision');assert.equal(q.evidence_version,null);
 const finding=q.findings.find(f=>f.role==='Writer') as Finding;assert.equal(finding.kind,'wording_review');validateEvidence(finding,text,{start:0,end:text.length},text);
});

test('old policy decisions and approval bindings never carry forward, including receiptless legacy approval',async()=>{
 const text='The workflow is a project for review.',claim='The project workflow is for review.',b=bundle(claim),s=source(text),q=evidenceQuality(b,s,[],NEW_PLATFORM_POLICY),f=q.findings.find(f=>f.role==='Writer')!;
 const old:Decision={id:'offline-old-decision',binding:q.binding,finding_id:f.id,decision:'accept',policy_version:'evidence-review-v2',actor:'owner',reason:'Historical wording comparison.',evidence:{source_span:{start:0,end:text.length},source_quote:text},context:{source_hash:s.hash,artifact_hash:f.artifact_hash,bundle_hash:q.bundle_hash,claim_span:f.span,claim_text:f.claim}};
 const before=JSON.stringify(old),checked=evidenceQuality(b,s,[old],NEW_PLATFORM_POLICY);
 assert.notEqual(EVIDENCE_POLICY,old.policy_version);assert(checked.flags.some(item=>item.id===f.id));assert.equal(checked.evidence_version,null);assert.equal(JSON.stringify(old),before);
 const exact=evidenceQuality(bundle(text),s,[],NEW_PLATFORM_POLICY);assert.equal(exact.flags.length,0);
 const token='original:offline-version';
 for(const rows of [[],[{binding:hash('old policy'),evidence_version:'',review_token:token}]])assert.equal(await evidenceApprovalCurrent({query:async<T>()=>rows as T[]},'offline-task',token,exact,null),false);
 assert.equal(await evidenceApprovalCurrent({query:async<T>()=>[{binding:exact.binding,evidence_version:'',review_token:token}] as T[]},'offline-task',token,exact,null),true);
});
