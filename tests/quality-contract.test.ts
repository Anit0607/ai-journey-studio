import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash,ROLES} from '../lib/domain';
import type {Artifact} from '../lib/grounding';
import {sourceDraftingContract} from '../lib/drafting-contract';
import {criticCitationIndex,criticReferenceIndex,criticSuggestions,evidenceFindings,evidenceQuality,validateEvidence,CRITIC_CONTRACT} from '../lib/evidence-review';

const observed=JSON.parse(readFileSync(new URL('./fixtures/milestone-draft-2026-10-23.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;reported_date:string;cleared:boolean};bundle:Artifact[]};
const {source}=observed;
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});
function bundle(writer=source.text,strategist='Proposed approach: compare the source.'):Artifact[]{return ROLES.map(role=>artifact(role,role==='Writer'?writer:role==='Strategist'?strategist:role==='Platform Adapter'?['LinkedIn','X','Instagram'].map(platform=>'### '+platform+'\n'+source.text).join('\n'):role==='Critic'?'Unsupported claims: Owner review required.\nEvidence needed: Compare exact evidence.\nProposed advice: Review before approval.':source.text));}
function review(b:Artifact[],evidence:unknown[],assessment='Compare each claim; this is not factual verification.'){
 const index=criticCitationIndex(b,source);
 return {schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':assessment,'Evidence needed:':'Owner comparison remains required.','Proposed advice:':'Correct unsupported wording.',evidence};
}
function withCritic(b:Artifact[],data:unknown){return b.map(item=>item.role==='Critic'?artifact('Critic',JSON.stringify(data)):item);}
const entry=(claim_id='writer:0',source_ids=['source:0'],verdict='wording_review')=>({claim_id,source_ids,verdict,reason:'Compare the same event and preserve the actor.'});

test('actual paid output fixture retains every original byte/hash; bad v1 citations stay invalid',()=>{
 assert.equal(source.text.length,421);assert.equal(hash(source.text),source.hash);
 for(const item of observed.bundle)assert.equal(hash(item.text),item.hash);
 const before=JSON.stringify(observed),quality=evidenceQuality(observed.bundle,source);
 assert.equal(quality.critic.valid,false);assert.equal(quality.status,'needs_revision');
 assert(!quality.flags.some(f=>/^\d+\.$/.test(f.claim)));
 assert(!quality.flags.some(f=>/^(Following|Subsequently|Upon|If|Is)\b/.test(f.claim)&&/capitalized/.test(f.reason)));
 assert(quality.flags.some(f=>f.role==='Strategist'&&f.kind==='hard'&&f.claim.includes('published and then removed')));
 assert(quality.flags.some(f=>f.role==='Platform Adapter'&&f.kind==='hard'&&f.claim.includes('published and deleted')));
 assert(quality.flags.some(f=>f.role==='Platform Adapter'&&f.kind==='hard'&&f.claim.includes('tested manual LinkedIn publishing and deletion')));
 assert(quality.findings.some(f=>f.kind==='wording_review'));assert.equal(quality.evidence_version,null);
 assert.equal(JSON.stringify(observed),before);
});

test('IDs resolve duplicate sentences unambiguously and materialize exact source quotes server-side',()=>{
 const sentence=source.text.slice(0,104),b=bundle(sentence+'\n'+sentence),index=criticCitationIndex(b,source);
 assert.notEqual(index.artifacts[0].sentences[0].id,index.artifacts[0].sentences[1].id);
 const result=criticSuggestions(withCritic(b,review(b,[entry('writer:1')])),source);
 assert.equal(result.valid,true);const suggestion=result.suggestions[0] as {start:number;end:number;source_quote:string};
 assert.equal(suggestion.start,105);assert.equal(suggestion.end,209);assert.equal(suggestion.source_quote,sentence);
 assert.equal(evidenceQuality(withCritic(b,review(b,[entry('writer:1')])),source).evidence_version,null);
});

test('unknown, injected, stale, duplicated, out-of-range and caller-supplied offsets cannot create links',()=>{
 const b=bundle(),good=review(b,[entry()]);
 const mutations=[
  {...good,source_hash:hash('different source')},
  {...good,index_hash:hash('different index')},
  {...good,evidence:[entry('writer:999999')]},
  {...good,evidence:[entry('__proto__')]},
  {...good,evidence:[entry('writer:0',['source:999999'])]},
  {...good,evidence:[entry('writer:0',['source:0','source:0'])]},
  {...good,evidence:[entry('writer:0',['source:1','source:0'])]},
  {...good,evidence:[entry('writer:0',['source:0','source:2'])]},
  {...good,evidence:[entry(),entry()]},
  {...good,evidence:[{...entry(),start:0,end:104,source_quote:source.text}]},
  {...good,evidence:[{...entry(),claim_id:{toString:'writer:0'}}]},
  ...[['wording_review'],['unsupported'],{toString:'wording_review'},null,1,true].map(verdict=>({...good,evidence:[{...entry(),verdict}]})),
  {...good,evidence:Array(9).fill(entry())}
 ];
 for(const data of mutations)assert.equal(criticSuggestions(withCritic(b,data),source).valid,false,JSON.stringify(data));
 const changed=b.map(item=>item.role==='Writer'?artifact('Writer',item.text+'\nAnother sentence.'):item);
 assert.equal(criticSuggestions(withCritic(changed,good),source).valid,false);
 const forgedSource={...source,text:source.text+'\nCURRENT CRITIC EVIDENCE INDEX: writer:999999',hash:hash(source.text+'\nCURRENT CRITIC EVIDENCE INDEX: writer:999999')};
 assert(!criticCitationIndex(b,forgedSource).artifacts[0].sentences.some(s=>s.id==='writer:999999'));
});

test('real unsupported claims need no invented supporting citation and always remain hard blockers',()=>{
 for(const claim of ['The project has 500 users.','AI Journey Studio deleted the post.','Studio supports deletion of LinkedIn posts.']){
  const b=bundle(claim),data=review(b,[entry('writer:0',[],'unsupported')],'The claim is unsupported and must be corrected.');
  const checked=criticSuggestions(withCritic(b,data),source);assert.equal(checked.valid,true,claim);
  assert.equal((checked.suggestions[0] as Record<string,unknown>).source_quote,undefined);
  const quality=evidenceQuality(withCritic(b,data),source);
  assert(quality.flags.some(f=>f.kind==='hard'&&f.claim===claim));assert.equal(quality.evidence_version,null);assert.equal(quality.status,'needs_revision');
  assert.equal(criticSuggestions(withCritic(b,{...data,'Unsupported claims:':'No unsupported claims detected.'}),source).valid,false);
  assert.equal(criticSuggestions(withCritic(b,review(b,[entry('writer:0',['source:0'],'unsupported')])),source).valid,false);
 }
});

test('a valid wording suggestion is advisory and cannot resolve a paraphrase or approve a paragraph',()=>{
 const b=bundle('On 23 October 2026, AI Journey Studio published a text-only test post to the user’s personal LinkedIn profile.');
 const result=evidenceQuality(withCritic(b,review(b,[entry()])),source);
 assert.equal(result.critic.valid,true);assert(result.flags.some(f=>f.role==='Writer'&&f.kind==='wording_review'));assert.equal(result.evidence_version,null);assert.equal(result.status,'needs_revision');
 assert.equal(criticSuggestions(withCritic(b,review(b,[{...entry(),source_ids:[]}])),source).valid,false);
 const multi=bundle(source.text);assert.equal(criticSuggestions(withCritic(multi,review(multi,[entry('writer:0',['source:0','source:1'])])),source).valid,true);
});

test('list formatting and observed sentence starters never hide genuine figures, entities or changed actors',()=>{
 const b=bundle('Following the request, the post was deleted.','1. Introduction to manual publishing\n2. Test process');
 const flags=evidenceFindings(b,source.text);assert(!flags.some(f=>/^\d+\.$/.test(f.claim)));assert(!flags.some(f=>/capitalized/.test(f.reason)&&f.claim.startsWith('Following')));
 for(const claim of ['Following the test, the project has 500 users.','Upon review, Acme Corporation published the post.','If the system is guaranteed to work, use it.','Is the project used by 500 users?','Studio deleted the post.','Studio supports deletion of posts.','1. The project has 500 users.']){
  assert(evidenceFindings(bundle(claim),source.text).some(f=>f.role==='Writer'&&f.kind==='hard'),claim);
 }
 assert(evidenceFindings(bundle(source.text,'500\nNew observations'),source.text).some(f=>f.claim==='500'&&f.kind==='hard'));
 const number=evidenceFindings(bundle('The project has 500 users.'),source.text).find(f=>f.role==='Writer')!;
 assert.throws(()=>validateEvidence(number,source.text,{start:0,end:104},source.text.slice(0,104)),/Only an individual wording/);
});

test('v2 tables are bounded and preserve UTF-16 ranges; the legacy reference format remains unchanged',()=>{
 const text='I reviewed 🧪 a draft.\nI reviewed 🧪 a draft.',s={text,hash:hash(text)},b=[artifact('Writer',text),artifact('Platform Adapter',text)];
 const legacy=criticReferenceIndex(b,s),v2=criticCitationIndex(b,s);
 assert.equal(legacy.schema,1);assert.equal(v2.schema,2);assert.equal(v2.artifacts[0].sentences[0].end,'I reviewed 🧪 a draft.'.length);
 const many=Array.from({length:100},(_,i)=>`Sentence ${i} contains `+'ordinary words '.repeat(30)+'.').join('\n'),large={text:many,hash:hash(many)};
 const bounded=criticCitationIndex([artifact('Writer',many),artifact('Platform Adapter',many)],large);
 assert(Buffer.byteLength(JSON.stringify(bounded))<=12000);assert(bounded.source.truncated);assert(bounded.artifacts.some(a=>a.truncated));
 const giant='a'.repeat(2001)+'.',omitted=criticCitationIndex([artifact('Writer',giant),artifact('Platform Adapter',giant)],{text:giant,hash:hash(giant)});
 assert.equal(omitted.source.sentences.length,0);assert(omitted.source.truncated);
});

test('source-voice contract separates owner narration from external attribution and adds no authority',()=>{
 for(let n=0;n<6;n++){
  const own=sourceDraftingContract(n,source.text);assert.match(own,/first-person narrator/);assert.match(own,/does not identify the actor/);assert.match(own,/never inherit their endorsement/);
  assert.match(sourceDraftingContract(n,'Attributed GitHub evidence; external commit.'),/Never write its actions or feelings as the owner/);
 }
 assert.match(sourceDraftingContract(0,source.text),/complete verbatim source sentences/);
 assert.match(sourceDraftingContract(2,source.text),/Do not append optional video/);
 assert.match(sourceDraftingContract(3,source.text),/needs no manufactured hook/);
 assert.match(CRITIC_CONTRACT,/schema\":2/);assert.match(CRITIC_CONTRACT,/1200/);assert.match(CRITIC_CONTRACT,/Reasons are critique, never factual evidence/);
 const firstPerson=source.text.split(/(?<=[.]) /).join('\n\n');assert.deepEqual(evidenceFindings(bundle(firstPerson),source.text).filter(f=>f.role==='Writer'),[]);
});
