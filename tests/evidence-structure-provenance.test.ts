import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceQuality,evidenceFindings,EVIDENCE_POLICY,validateEvidence,evidenceBinding} from '../lib/evidence-review';
import {verifiedSourceEnvelope,bundleQuality} from '../lib/grounding';
import {ROLES,hash} from '../lib/domain';
import {variantFixture} from './variant-fixture';
const source='AI Journey Studio is my personal project for documenting my AI learning journey. I am a non-coder and use AI agents for implementation while retaining final approval. The hosted dashboard and login are working. Automatic source collection, content generation and reviewed social publishing are not yet verified end to end. This is work in progress, not a completed automation success story.';
const date='2026-10-21',context={text:source,hash:hash(source),cleared:true,reported_date:date};
const envelope='SOURCE DATE: '+date+'. SOURCE: '+source;
const critic='Unsupported claims: Review uncertain wording.\nEvidence needed: Review exact source.\nProposed advice: Inspect each version.';
const artifact=(role:string,text:string)=>({role,text,hash:hash(text)});
const bundle=(harvester:string,adapter=variantFixture())=>ROLES.map(role=>artifact(role,role==='Harvester'?harvester:role==='Platform Adapter'?adapter:role==='Critic'?critic:'Proposed approach: inspect the source.'));
function observedJson(value:string){const a='{"padding":"',b='","provenance":';const prefix=a+' '.repeat(470-a.length-b.length)+b;assert.equal(prefix.length,470);return prefix+JSON.stringify(value)+'}';}

test('observed incomplete variants stays a separate completeness blocker, never a named-entity sentence',()=>{
 const b=bundle('Proposed approach: inspect the source.','LinkedIn draft without exact platform headings');const before=JSON.stringify(b),q=evidenceQuality(b,context),f=q.findings.find(x=>x.claim==='Incomplete platform variants')!;
 assert.equal(f.category,'structure');assert.equal(f.kind,'hard');assert.deepEqual(f.span,{start:-1,end:-1});assert.match(f.reason,/headings|separate|sections/i);assert.doesNotMatch(f.reason,/named entity|capitalized/i);assert(q.flags.some(x=>x.id===f.id));assert.equal(q.status,'needs_revision');assert.throws(()=>validateEvidence(f,source,{start:0,end:source.length},source),/Only an individual/);assert.equal(JSON.stringify(b),before);
});
test('observed quoted JSON envelope at offset470 matches only exact stored provenance context',()=>{
 const text=observedJson(envelope),b=bundle(text),before=JSON.stringify(b);assert.equal(text.indexOf(JSON.stringify(envelope)),470);const q=evidenceQuality(b,context);assert.equal(q.findings.filter(x=>x.role==='Harvester').length,0);assert.equal(q.flags.length,0);assert.equal(q.status,'needs_human_review');assert.equal(JSON.stringify(b),before);
 assert.equal(verifiedSourceEnvelope(envelope,'Harvester',source,date),true);
});
test('verified internal envelope works with period, whitespace/newline separators and balanced quotes',()=>{
 for(const role of ['Harvester','Story Miner','Strategist'])for(const value of [envelope,'SOURCE DATE: '+date+' SOURCE: '+source,'SOURCE DATE: '+date+'\nSOURCE: '+source,'\u201c'+envelope+'\u201d']){
  const actual=value.replace(/\\u201c/g,'\u201c').replace(/\\u201d/g,'\u201d');assert.equal(verifiedSourceEnvelope(actual,role,source,date),true);assert.equal(evidenceFindings([artifact(role,JSON.stringify({provenance:actual}))],source,date).filter(x=>x.role===role).length,0);
 }
});
test('quoted envelope in plain internal text is atomic; surrounding genuine claims remain checked',()=>{
 const value='Provenance record: "'+envelope+'"';assert.equal(evidenceFindings([artifact('Harvester',value)],source,date).filter(x=>x.role==='Harvester').length,0);
 const extra=value+'\nI gained 500 followers.';assert(evidenceFindings([artifact('Harvester',extra)],source,date).some(x=>x.role==='Harvester'&&x.kind==='hard'&&/500/.test(x.claim)));
});
test('missing or mismatched stored date never exempts an envelope',()=>{
 for(const reported of [undefined,'2026-10-20']){const q=evidenceQuality(bundle(observedJson(envelope)),{...context,reported_date:reported});assert(q.flags.some(x=>x.role==='Harvester'&&x.kind==='hard'));assert.equal(verifiedSourceEnvelope(envelope,'Harvester',source,reported),false);}
 const wrong=envelope.replace(date,'2026-10-22');assert(evidenceQuality(bundle(observedJson(wrong)),context).flags.some(x=>x.role==='Harvester'&&x.kind==='hard'));
});
test('same date cannot launder extra figures, entities, biography or negation inside SOURCE body',()=>{
 for(const text of [envelope+' I gained 500 followers.',envelope+' Acme Corporation built the system.',envelope.replace('I am a non-coder','I am an expert engineer'),envelope.replace('retaining final approval','not retaining final approval')]){
  assert.equal(verifiedSourceEnvelope(text,'Harvester',source,date),false);assert(evidenceQuality(bundle(observedJson(text)),context).flags.some(x=>x.role==='Harvester'&&x.kind==='hard'),text);
 }
});
test('public roles and arbitrary prose do not receive provenance exemptions',()=>{
 for(const role of ['Writer','Platform Adapter']){assert.equal(verifiedSourceEnvelope(envelope,role,source,date),false);assert(evidenceFindings([artifact(role,observedJson(envelope))],source,date).some(x=>x.role===role&&x.kind==='hard'));}
 for(const text of ['I launched the system on 2026-10-21.','SOURCE DATE: 2026-10-21. Acme Corporation launched my system.'])assert(evidenceFindings([artifact('Harvester',text)],source,date).some(x=>x.role==='Harvester'&&x.kind==='hard'));
});
test('normal observed Platform Adapter paraphrase remains individually reviewable',()=>{
 const text='AI Journey Studio is an ongoing personal project focused on documenting my AI learning journey.';const fs=evidenceFindings([artifact('Platform Adapter',variantFixture(text))],source,date).filter(x=>x.claim.includes(text));assert(fs.length>0);assert(fs.every(x=>x.kind==='wording_review'&&!x.category));
});
test('dates and capitalized terms are not globally exempted by structural labels',()=>{
 const q=evidenceQuality(bundle('I founded Acme Corporation on 2026-10-21.','No separate platform sections'),context);assert(q.findings.some(x=>x.category==='structure'&&x.role==='Platform Adapter'));assert(q.flags.some(x=>x.role==='Harvester'&&x.kind==='hard'&&!x.category));
});
test('policy/date binding invalidates stale decisions without altering approval or schema logic',()=>{
 assert.equal(EVIDENCE_POLICY,'evidence-review-v3-lossless-spans');const b=bundle(observedJson(envelope));assert.notEqual(evidenceBinding(b,context),evidenceBinding(b,{...context,reported_date:'2026-10-20'}));
 assert(bundleQuality([artifact('Platform Adapter','No headings')],source,date).flags.some(x=>x.category==='structure'));
});
