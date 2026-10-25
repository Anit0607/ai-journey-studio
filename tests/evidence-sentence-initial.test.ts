import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROLES,hash} from '../lib/domain';
import {EVIDENCE_POLICY,criticCitationIndex,evidenceFindings,evidenceQuality,sourceEvidenceSpans,validateEvidence,type Finding,type Decision} from '../lib/evidence-review';
import {variantFixture} from './variant-fixture';

const source=readFileSync(new URL('./fixtures/private-comparison-source.txt',import.meta.url),'utf8');
const context={text:source,hash:hash(source),cleared:true};
const atoms=sourceEvidenceSpans(source);
const artifact=(role:string,text:string)=>({role,text,hash:hash(text)});
const finding=(claim:string,role='Writer'):Finding=>({id:'fixture',kind:'wording_review',role,claim,reason:'Individual comparison required',artifact_hash:hash(claim),span:{start:0,end:claim.length}});
const selected=(start:number,end=start)=>({start:atoms[start].start,end:atoms[end].end});
function validate(claim:string,quote:string,role='Writer'){
 return validateEvidence(finding(claim,role),quote,{start:0,end:quote.length},quote);
}
const actualPairs=[
 {role:'Platform Adapter',claim:'Separately, Upstash metadata recorded a scheduled integration wake as successful.',ids:[14,14],span:{start:1801,end:2071}},
 {role:'Writer',claim:'Those findings have a limit: they do not establish that the scheduled request made no SQL queries, or that the database stayed asleep continuously.',ids:[14,17],span:{start:1801,end:2568}},
 // Exact saved Writer wording; no Critic citation was supplied for this sentence.
 {role:'Writer',claim:'So the practical method here is worth separating from the unmeasured outcome: check whether the request is inside its permitted work window before letting it access the database.',ids:[10,10],span:{start:1108,end:1277}},
];
for(const pair of actualPairs)test('saved Sol sentence permits only bounded individual comparison: '+pair.claim.split(/[ ,]/)[0],()=>{
 assert.equal(context.hash,'b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603');
 const span=selected(pair.ids[0],pair.ids[1]);assert.deepEqual(span,pair.span);
 const before=JSON.stringify(pair),quote=source.slice(span.start,span.end);
 assert.doesNotThrow(()=>validateEvidence(finding(pair.claim,pair.role),source,span,quote));
 assert.equal(JSON.stringify(pair),before);
 assert.throws(()=>validateEvidence(finding(pair.claim,pair.role),source,{start:span.start+1,end:span.end},quote.slice(1)),/complete source sentences/);
 assert.throws(()=>validateEvidence(finding(pair.claim,pair.role),source,span,quote+' '),/Exact source passage/);
});

test('synthetic How at sentence start is grammar, including a leading quotation',()=>{
 const quote='The project uses AI agents for implementation.';
 for(const claim of ['How the project uses AI agents remains a point for review.','“How the project uses AI agents remains a point for review.”'])assert.doesNotThrow(()=>validate(claim,quote));
});

for(const word of ['So','How','Those','Separately'])test(word+' exemption is initial-only and retains multiword names and factual guards',()=>{
 const quote='The project uses AI agents for implementation. The project is under review.';
 assert.throws(()=>validate('The project uses '+word+' for implementation.',quote),/New named entity/);
 // Both component words are individually allowed/sourced; the proper-name phrase is not.
 assert.throws(()=>validate(word+' Systems uses AI agents for implementation.','Systems uses AI agents for implementation.'),/New named entity requires new cleared evidence/);
 for(const claim of [
  word+', the project uses Tesla for implementation.',
  word+', Rohit uses AI agents for implementation.',
  word+', the project uses Acme Corporation for implementation.',
  word+', the project has 500 users.',
  word+', the project is guaranteed to work.',
  word+', the project does not use AI agents for implementation.',
  word+', the project will use AI agents for implementation.',
 ])assert.throws(()=>validate(claim,quote),/New named entity|New figure|Added outcome|negation reversal|Changed timing/,claim);
});

test('unsupported initial names and unlisted capitalized terms remain hard findings',()=>{
 const quote='The project uses AI agents for implementation.';
 for(const claim of ['Tesla uses AI agents for implementation.','Rohit uses AI agents for implementation.','Zyphora uses AI agents for implementation.']){
  assert.throws(()=>validate(claim,quote),/New named entity/);
  assert(evidenceFindings([artifact('Writer',claim)],quote).some(item=>item.claim===claim&&item.kind==='hard'));
 }
});

test('the frozen writer:2 citation still cannot borrow an absent project name from outside source:10',()=>{
 const claim='In AI Journey Studio, the documented change was to validate signed integration requests, then return before database access if the request fell outside the configured source-intake and publishing windows.';
 const span=selected(10),quote=source.slice(span.start,span.end);
 assert(!quote.includes('AI Journey Studio'));
 assert.throws(()=>validateEvidence(finding(claim),source,span,quote),/New named entity/);
});

test('reclassified findings require fresh decisions and do not mutate historical acceptance',()=>{
 const claim=actualPairs[1].claim;
 const bundle=ROLES.map(role=>artifact(role,role==='Writer'?claim:role==='Platform Adapter'?variantFixture():role==='Critic'?'Unsupported claims: Review uncertain wording.\nEvidence needed: Compare exact source.\nProposed advice: Review each version.':'Proposed approach: inspect one cleared source.'));
 const q=evidenceQuality(bundle,context),item=q.findings.find(item=>item.role==='Writer'&&item.claim===claim)!;
 assert.equal(item.kind,'wording_review');assert.equal(item.resolution,null);
 const oldId=hash(JSON.stringify({policy:EVIDENCE_POLICY,role:item.role,artifact_hash:item.artifact_hash,span:item.span,claim:item.claim,reason:'New named entity or unsupported capitalized term requires correction',kind:'hard'}));
 assert.notEqual(item.id,oldId);
 const span=selected(14,17);
 const historical:Decision={id:'historical-decision',binding:q.binding,finding_id:oldId,decision:'accept',policy_version:EVIDENCE_POLICY,actor:'owner',reason:'Historical record must remain unchanged',evidence:{source_span:span,source_quote:source.slice(span.start,span.end)},context:{source_hash:context.hash,artifact_hash:item.artifact_hash,bundle_hash:q.bundle_hash,claim_span:item.span,claim_text:item.claim}};
 const before=JSON.stringify({bundle,historical});
 const current=evidenceQuality(bundle,context,[historical]);
 assert.equal(current.findings.find(f=>f.id===item.id)!.resolution,null);
 assert(current.flags.some(f=>f.id===item.id));assert.equal(current.status,'needs_revision');assert.equal(current.evidence_version,null);
 assert.equal(JSON.stringify({bundle,historical}),before);
});

test('queue-check exclusion remains a hard Critic correction, never a wording acceptance',()=>{
 const queueClaim='The condition matters: this checked the configured work window—not whether an actual queued job was due.';
 const bundle=ROLES.map(role=>artifact(role,role==='Writer'?actualPairs[1].claim:role==='Platform Adapter'?variantFixture(queueClaim):role==='Critic'?'Unsupported claims: Review.\nEvidence needed: Compare source.\nProposed advice: Correct the exclusion.':'Proposed approach: inspect one cleared source.'));
 const index=criticCitationIndex(bundle,context),platform=index.artifacts.find(x=>x.role==='Platform Adapter')!;
 const claim=platform.sentences.find(x=>x.text===queueClaim)!;
 const critic={schema:2,source_hash:context.hash,index_hash:index.index_hash,'Unsupported claims:':'The LinkedIn variant turns an evidence boundary into a categorical claim that queued-job due checks were absent.','Evidence needed:':'The note establishes configured-window gating, not whether other queue checks existed.','Proposed advice:':'Correct the categorical exclusion before approval.',evidence:[{claim_id:claim.id,source_ids:[],verdict:'unsupported',reason:'The note describes configured-window gating but does not establish the absence of other checks.'}]};
 const reviewed=bundle.map(item=>item.role==='Critic'?artifact('Critic',JSON.stringify(critic)):item);
 const q=evidenceQuality(reviewed,context);
 assert.equal(q.critic.valid,true);
 const hard=q.flags.find(item=>item.claim===queueClaim&&item.reason==='Critic identifies unsupported content; correct it before approval');
 assert(hard);assert.equal(hard.kind,'hard');assert.equal(hard.resolution,null);
 assert.throws(()=>validateEvidence(hard,source,selected(10),atoms[10].text),/Only an individual wording/);
 assert.equal(q.status,'needs_revision');assert.equal(q.evidence_version,null);
});
