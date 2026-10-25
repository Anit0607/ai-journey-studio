import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash,ROLES} from '../lib/domain';
import {criticCitationIndex,criticSuggestions,evidenceQuality} from '../lib/evidence-review';
import type {Artifact} from '../lib/grounding';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-natural-draft-2026-10-25.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string;cleared:boolean};bundle:Artifact[]};
const {source}=observed;
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
const claim='The workflow protects every private artifact.';
const bundle=ROLES.map(role=>artifact(role,role==='Writer'?claim:role==='Platform Adapter'?'### LinkedIn\n'+claim:role==='Critic'?'Unsupported claims: Review required.\nEvidence needed: Code and tests.\nProposed advice: Correct unsupported claims.':'SOURCE: '+source.text));
const index=criticCitationIndex(bundle,source);
const data={schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'The claimed behavior is unsupported.','Evidence needed:':'No code or test results are supplied.','Proposed advice:':'Retain only attributed source facts.',evidence:[{claim_id:'writer:0',source_ids:[],verdict:'unsupported',reason:'The title does not demonstrate behavior.'}]};
const withCritic=(text:string,b=bundle)=>b.map(item=>item.role==='Critic'?artifact('Critic',text):item);
const fence=(text:string,language='json')=>'```'+language+'\n'+text+'\n```';

test('bare JSON and one complete JSON fence receive identical strict citation validation without changing saved bytes',()=>{
 for(const text of [JSON.stringify(data),fence(JSON.stringify(data)),fence(JSON.stringify(data),''),' \n'+fence(JSON.stringify(data),'JSON').replace(/\n/g,'\r\n')+'\n ']){
  const b=withCritic(text),before=JSON.stringify(b),result=criticSuggestions(b,source);
  assert.equal(result.legacy,false);assert.equal(result.valid,true);assert.equal(result.suggestions.length,1);
  const quality=evidenceQuality(b,source,[],NEW_PLATFORM_POLICY);
  assert(quality.flags.some(flag=>flag.kind==='hard'&&flag.reason==='Critic identifies unsupported content; correct it before approval'&&flag.claim===claim));
  assert.equal(quality.status,'needs_revision');assert.equal(quality.evidence_version,null);assert.equal(JSON.stringify(b),before);
 }
});

test('malformed structured envelopes never fall back to valid legacy prose',()=>{
 const json=JSON.stringify(data);
 for(const text of [fence('{broken'),fence(json).slice(0,-3),fence(json)+'\nExtra prose.','Review:\n'+fence(json),fence(json)+'\n'+fence(json),fence(json,'javascript'),'~~~json\n'+json+'\n~~~','Review: '+json,'['+json+']',fence('null'),fence('[]')]){
  const result=criticSuggestions(withCritic(text),source);assert.equal(result.legacy,false,text);assert.equal(result.valid,false,text);assert.deepEqual(result.suggestions,[]);
  assert(evidenceQuality(withCritic(text),source,[],NEW_PLATFORM_POLICY).flags.some(flag=>flag.claim==='Invalid structured evidence review'));
 }
});

test('a valid fence cannot bypass source hashes, index IDs, unsupported verdict rules or schema validation',()=>{
 for(const invalid of [{...data,source_hash:hash('foreign source')},{...data,index_hash:hash('stale index')},{...data,evidence:[{...data.evidence[0],claim_id:'writer:999'}]},{...data,evidence:[{...data.evidence[0],source_ids:['source:1']}]},{...data,extra:true},{...data,schema:3}]){
  const result=criticSuggestions(withCritic(fence(JSON.stringify(invalid))),source);assert.equal(result.legacy,false);assert.equal(result.valid,false);assert.deepEqual(result.suggestions,[]);
 }
});

test('genuine legacy prose retains compatibility',()=>{
 const result=criticSuggestions(bundle,source);assert.equal(result.legacy,true);assert.equal(result.valid,true);assert.deepEqual(result.suggestions,[]);
 const prose='Unsupported claims: Compare [draft wording] with the source.\nEvidence needed: Owner review.\nProposed advice: Retain attribution.';
 assert.deepEqual(criticSuggestions(withCritic(prose),source),{legacy:true,valid:true,suggestions:[]});
});

test('structured attempts appended to otherwise valid legacy sections cannot bypass review using different key spellings',()=>{
 const legacy=bundle.find(item=>item.role==='Critic')!.text;
 const exact=ROLES.map(role=>artifact(role,role==='Critic'?legacy:role==='Platform Adapter'?'### LinkedIn\n'+source.text:source.text));
 assert.equal(evidenceQuality(exact,source,[],NEW_PLATFORM_POLICY).flags.length,0);
 for(const attempted of ['{schema:2, source_hash:"wrong", evidence:[]}','{"Schema":2,"Source_Hash":"wrong"}','{"\\u0073chema":2,"\\u0073ource_hash":"wrong"}','{"bad":true}','{broken','[]','[false]','["unsupported"]','[invalid]']){
  for(const text of [legacy+'\nReview result:\n'+attempted,...(attempted==='[invalid]'?[]:[legacy+'\nReview result: '+attempted])]){
   const b=withCritic(text,exact),result=criticSuggestions(b,source);
   assert.equal(result.legacy,false,text);assert.equal(result.valid,false,text);assert.deepEqual(result.suggestions,[]);
   const quality=evidenceQuality(b,source,[],NEW_PLATFORM_POLICY);assert.equal(quality.status,'needs_revision');assert.equal(quality.evidence_version,null);
   assert.equal(quality.flags.length,1);assert.equal(quality.flags[0].claim,'Invalid structured evidence review');
  }
 }
});

test('the exact natural run remains blocked and its malformed fenced citations become visible, not repaired or accepted',()=>{
 const before=JSON.stringify(observed);assert.equal(hash(source.text),source.hash);for(const item of observed.bundle)assert.equal(hash(item.text),item.hash);
 const result=criticSuggestions(observed.bundle,source);assert.equal(result.legacy,false);assert.equal(result.valid,false);assert.deepEqual(result.suggestions,[]);
 const quality=evidenceQuality(observed.bundle,source,[],NEW_PLATFORM_POLICY);assert.equal(quality.status,'needs_revision');assert.equal(quality.evidence_version,null);
 assert.equal(quality.flags.length,26);assert(quality.flags.some(flag=>flag.claim==='Invalid structured evidence review'));
 assert(quality.flags.some(flag=>flag.kind==='hard'&&flag.claim.includes('2026-10-24')));
 assert(quality.flags.some(flag=>flag.kind==='hard'&&flag.claim.includes('This update highlights')));
 assert.equal(JSON.stringify(observed),before);
});
