import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../lib/domain';
import {verifiedSourceEnvelope,commitSummaryLessonReason,type Artifact} from '../lib/grounding';
import {criticCitationIndex,criticSuggestions,evidenceFindings,evidenceQuality,validateEvidence,EVIDENCE_POLICY,type Finding,type Decision} from '../lib/evidence-review';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-linkedin-draft-review-2026-10-24.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string;cleared:boolean};outputs:Artifact[];reviews:Array<{quality:{flags:Finding[]}}>;ledger_summary:Array<{estimated:string;status:string;finish_reason:string}>};
const {source}=observed,policy={version:1,platforms:['LinkedIn']} as const;
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
const finding=(claim:string,role='Writer'):Finding=>({id:hash(claim),kind:'wording_review',role,claim,reason:'Test exact source comparison.',artifact_hash:hash(claim),span:{start:0,end:claim.length}});
const flags=(role:string,text:string)=>evidenceFindings([artifact(role,text)],source.text,source.reported_date,policy).filter(f=>f.role===role);
const index=criticCitationIndex(observed.outputs,source),disclaimer=index.source.sentences[0],title=index.source.sentences[1];
const validate=(claim:string,quote=title,role='Writer')=>validateEvidence(finding(claim,role),source.text,{start:quote.start,end:quote.end},quote.text);

test('actual six-stage fixture remains byte/hash exact and unapprovable after only metadata recognition',()=>{
 const before=JSON.stringify(observed);assert.equal(hash(source.text),source.hash);assert.equal(source.hash,'818618f385fa1d481d81bd5dc985a768cd49742bc913a8d93ba9eee8f2c681f3');
 for(const item of observed.outputs)assert.equal(hash(item.text),item.hash);
 assert.equal(index.index_hash,'8487626016d74a7d1de40fa482d1f22fd01aa1c267eefe9c38c6cea673ea9cf7');
 assert.equal(observed.ledger_summary.reduce((sum,row)=>sum+Number(row.estimated),0),6469);
 assert(observed.ledger_summary.every(row=>row.status==='settled'&&row.finish_reason==='stop'));
 const q=evidenceQuality(observed.outputs,source,[],policy);
 assert.equal(q.status,'needs_revision');assert.equal(q.critic.valid,false);assert.equal(q.evidence_version,null);
 const excluded='(Source hash: '+source.hash+')';
 const lesson=q.flags.find(f=>f.role==='Platform Adapter'&&f.reason==='Commit-title evidence does not establish the inferred configuration lesson');assert(lesson);assert.equal(lesson.kind,'hard');
 assert.deepEqual(q.flags.filter(f=>f.id!==lesson.id).map(f=>f.id).sort(),observed.reviews[0].quality.flags.filter(f=>f.claim!==excluded).map(f=>f.id).sort());
 assert.equal(q.flags.length,13);assert(q.flags.some(f=>f.kind==='hard'&&f.role==='Critic'));
 assert(q.flags.some(f=>f.role==='Writer'&&f.kind==='hard'&&f.claim.includes('records a configuration change')));
 assert(q.flags.some(f=>f.role==='Strategist'&&f.kind==='hard'&&f.claim.includes('it is common to specialize')));
 assert.equal(JSON.stringify(observed),before);
});

for(const role of ['Harvester','Story Miner','Strategist'])test('only exact isolated internal provenance atoms are exempt: '+role,()=>{
 for(const text of ['Source hash: '+source.hash,'(Source hash: '+source.hash+')','SOURCE HASH: '+source.hash,'SOURCE DATE: '+source.reported_date,'Reported date: '+source.reported_date]){
  assert(verifiedSourceEnvelope(text,role,source.text,source.reported_date),text);
  assert.deepEqual(flags(role,text),[],text);
 }
 for(const text of [
  'Source hash: '+hash('wrong source'),'(Source hash: '+hash('wrong source')+')',
  'SOURCE DATE: 2026-10-24','Reported date: 2026-10-24','Authored date: '+source.reported_date,
  'Recorded date: '+source.reported_date,'Date: '+source.reported_date,
  'Reported date: '+source.reported_date+' proves the feature works.',
  '(Source hash: '+source.hash+') The project has 500 users.',
  'Source hash: '+source.hash+'; verified success.',
  'The commit was authored on '+source.reported_date+'.'
 ])assert(!verifiedSourceEnvelope(text,role,source.text,source.reported_date),text);
 assert(flags(role,'SOURCE DATE: 2026-10-24').some(f=>f.kind==='hard'));
 assert(flags(role,'Reported date: '+source.reported_date+'; the project has 500 users.').some(f=>f.kind==='hard'));
});

test('metadata never supplies evidence for public prose, a stronger date claim or another source',()=>{
 for(const role of ['Writer','Platform Adapter','Critic'])for(const text of ['Source hash: '+source.hash,'SOURCE DATE: '+source.reported_date])assert(!verifiedSourceEnvelope(text,role,source.text,source.reported_date));
 assert(!verifiedSourceEnvelope('Source hash: '+source.hash,'Harvester',source.text+' changed',source.reported_date));
 assert(!verifiedSourceEnvelope('Reported date: '+source.reported_date,'Harvester',source.text));
 for(const claim of ['The commit was authored on 2026-10-23.','On October 23, 2026, a commit was recorded.','Reported date: 2026-10-23']){
  assert(flags('Writer',claim).some(f=>f.kind==='hard'),claim);
  assert.throws(()=>validate(claim),/New figure/,claim);
 }
 assert.throws(()=>validateEvidence(finding('The commit was authored on 2026-10-23.'),source.text,{start:0,end:source.text.length},source.text),/New figure/);
});

for(const label of ['Audience Need','Reader Takeaway'])test('only the fixed Strategist heading label is ignored, never its body: '+label,()=>{
 for(const prefix of [label+': ','**'+label+':** ']){
  const text=prefix+'the workflow is under review.';
  const items=flags('Strategist',text);assert(items.length>0);assert(!items.some(f=>/named entity|capitalized/.test(f.reason)));
  assert.equal(items[0].claim,text);assert.equal(text.slice(items[0].span.start,items[0].span.end),text);
  for(const body of ['the workflow uses Acme Corporation.','the project has 500 users.','the workflow is guaranteed to work.'])assert(flags('Strategist',prefix+body).some(f=>f.kind==='hard'),body);
  assert.throws(()=>validate(prefix+'Acme Corporation uses this workflow.',title,'Strategist'),/New named entity/);
  assert(flags('Writer',prefix+'the workflow is under review.').some(f=>f.kind==='hard'));
 }
 assert(flags('Strategist','New '+label+': the workflow is under review.').some(f=>f.kind==='hard'));
});

test('sentence-initial For is grammatical only; later entities, figures and certainty stay checked',()=>{
 assert.doesNotThrow(()=>validate('For this workflow, owner review is needed.'));
 for(const claim of ['For Acme Corporation, the workflow is useful.','For this workflow, Acme Corporation provides support.','For this workflow, the project has 500 users.','For this workflow, success is guaranteed.','The workflow uses For Authority.'])assert.throws(()=>validate(claim),/New named entity|New figure|Added outcome/,claim);
});

test('the actual For-starting configuration lesson cannot gain a wording waiver from the entity fix',()=>{
 const raw=JSON.parse(observed.outputs.find(a=>a.role==='Critic')!.text),entry=raw.evidence.find((e:{claim_id:string})=>e.claim_id==='platform:4');
 const data={...raw,evidence:[entry]},bundle=observed.outputs.map(item=>item.role==='Critic'?artifact('Critic',JSON.stringify(data)):item);
 assert.equal(criticSuggestions(bundle,source).valid,false);
 const claim=index.artifacts[1].sentences.find(s=>s.id==='platform:4')!.text;
 assert.throws(()=>validate(claim,title,'Platform Adapter'),/inferred configuration lesson/);
 const flagged=flags('Platform Adapter',claim).find(f=>/inferred configuration lesson/.test(f.reason));assert(flagged);assert.equal(flagged.kind,'hard');
 assert.throws(()=>validateEvidence(flagged,source.text,{start:title.start,end:title.end},title.text),/Only an individual wording/);
 // This is a title-only boundary, not a generic lesson classifier for richer notes.
 assert.equal(commitSummaryLessonReason(claim,'I reviewed this configuration approach.'),null);
 assert.equal(commitSummaryLessonReason(title.text,source.text),null);
});

test('disclaimer-only evidence supports only its literal limitation, never substantive claims',()=>{
 assert.doesNotThrow(()=>validate(disclaimer.text,disclaimer));
 for(const claim of [
  'This commit sets the default for new content workflows to operate within a versioned LinkedIn-only scope.',
  'The workflow improves efficiency.',
  'No further evidence is available to explain the rationale behind this update or its practical outcomes.',
  'This example highlights the importance of aligning workflow defaults to target platforms.',
  disclaimer.text+' The feature works.'
 ])assert.throws(()=>validate(claim,disclaimer),/attribution disclaimer/,claim);
 assert.throws(()=>validateEvidence(finding(disclaimer.text),source.text,{start:1,end:disclaimer.end},source.text.slice(1,disclaimer.end)),/complete source sentences/);
 assert.doesNotThrow(()=>validate(title.text,title));
});

test('both Critic schemas reject disclaimer links; a valid literal link remains advisory',()=>{
 const raw=JSON.parse(observed.outputs.find(a=>a.role==='Critic')!.text);
 const replace=(bundle:Artifact[],data:unknown)=>bundle.map(item=>item.role==='Critic'?artifact('Critic',JSON.stringify(data)):item);
 const entry=raw.evidence.find((e:{claim_id:string})=>e.claim_id==='writer:3');
 assert.equal(criticSuggestions(replace(observed.outputs,{...raw,evidence:[entry]}),source).valid,false);
 const writer=observed.outputs.find(a=>a.role==='Writer')!,claim=index.artifacts[0].sentences[3];
 const legacy={schema:1,source_hash:source.hash,'Unsupported claims:':'Compare the claim.','Evidence needed:':'Substantive evidence.','Proposed advice:':'Correct unsupported copy.',evidence:[{role:'Writer',artifact_hash:writer.hash,start:claim.start,end:claim.end,verdict:'wording_review',source_start:disclaimer.start,source_end:disclaimer.end,source_quote:disclaimer.text}]};
 assert.equal(criticSuggestions(replace(observed.outputs,legacy),source).valid,false);
 const literal=observed.outputs.map(a=>a.role==='Writer'?artifact('Writer',disclaimer.text):a),fresh=criticCitationIndex(literal,source);
 const data={...raw,index_hash:fresh.index_hash,evidence:[{claim_id:'writer:0',source_ids:['source:0'],verdict:'wording_review',reason:'Compare the exact stated limitation.'}]};
 assert.equal(criticSuggestions(replace(literal,data),source).valid,true);
 assert.equal(evidenceQuality(replace(literal,data),source,[],policy).evidence_version,null);
 // Unsupported claims never need fabricated disclaimer support and stay hard.
 const unsupported={...raw,evidence:[{claim_id:'platform:6',source_ids:[],verdict:'unsupported',reason:'The organizational lesson is not in the source.'}]};
 const q=evidenceQuality(replace(observed.outputs,unsupported),source,[],policy);
 assert.equal(q.critic.valid,true);assert(q.flags.some(f=>f.role==='Platform Adapter'&&f.kind==='hard'&&f.claim.includes('organizational understanding')));
});

test('a matching pre-existing owner decision cannot resolve substantive wording with only a disclaimer',()=>{
 const q=evidenceQuality(observed.outputs,source,[],policy);
 const item=q.findings.find(f=>f.role==='Writer'&&f.claim.startsWith('No further evidence'))!;assert.equal(item.kind,'wording_review');
 const decision:Decision={id:'00000000-0000-4000-8000-000000000001',binding:q.binding,finding_id:item.id,decision:'accept',policy_version:EVIDENCE_POLICY,actor:'owner',reason:'Previously compared this wording.',evidence:{source_span:{start:disclaimer.start,end:disclaimer.end},source_quote:disclaimer.text},context:{source_hash:source.hash,artifact_hash:item.artifact_hash,bundle_hash:q.bundle_hash,claim_span:item.span,claim_text:item.claim,reported_date:source.reported_date}};
 const before=JSON.stringify(decision),checked=evidenceQuality(observed.outputs,source,[decision],policy);
 assert.equal(checked.findings.find(f=>f.id===item.id)!.resolution,null);assert.equal(checked.evidence_version,null);assert.equal(checked.status,'needs_revision');
 assert.equal(JSON.stringify(decision),before);assert.equal(checked.binding,q.binding);
});
