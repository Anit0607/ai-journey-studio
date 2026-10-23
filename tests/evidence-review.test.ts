import {enqueueLegacy} from "./legacy-task-fixture";
import {Publishing} from "../lib/publishing";
import {renderApprovedInstagram} from "../lib/publication-media";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {evidenceQuality,evidenceFindings,validateEvidence,criticSuggestions,EVIDENCE_POLICY,CRITIC_CONTRACT} from "../lib/evidence-review";
import type {Artifact} from "../lib/grounding";
import {variantFixture} from "./variant-fixture";
const sourceText="AI Journey Studio is my personal project for documenting my AI learning journey. I am a non-coder and use AI agents for implementation while retaining final approval. The hosted dashboard and login are working. Automatic source collection, content generation and reviewed social publishing are not yet verified end to end.";
const source={text:sourceText,hash:hash(sourceText),cleared:true};
const paraphrase="The project owner identifies as a non-coder and uses AI agents for implementation while retaining final approval.";
const critic="Unsupported claims: Review uncertain wording.\nEvidence needed: Confirm meaning against the cleared note.\nProposed advice: Review each version before use.";
function bundle(writer=paraphrase):Artifact[]{return ROLES.map(role=>{const text=role==='Writer'?writer:role==='Critic'?critic:role==='Platform Adapter'?variantFixture():"Proposed approach: inspect one cleared source.";return {role,text,hash:hash(text)};});}
const evidence=()=>{const quote=sourceText.split('. ')[1]+'.';const start=sourceText.indexOf(quote);return {source_span:{start,end:start+quote.length},source_quote:quote};};
test('faithful third-person paraphrase requires individual evidence review, never automatic certification',()=>{
 const q=evidenceQuality(bundle(),source);const f=q.findings.find(x=>x.role==='Writer')!;assert.equal(f.kind,'wording_review');assert(q.flags.length);validateEvidence(f,sourceText,evidence().source_span,evidence().source_quote);assert.equal(q.status,'needs_revision');
});
test('exact source sentences need human content review without lexical waiver',()=>{const q=evidenceQuality(bundle(sourceText),source);assert.equal(q.flags.length,0);assert.equal(q.status,'needs_human_review');});
for(const [label,text] of Object.entries({negation:"I do not use AI agents for implementation while retaining final approval.",certainty:"The dashboard is functioning as intended.",result:"Automatic source collection is verified and working.",number:"The project has 500 users.",biography:"The project owner is an expert engineer.",entity:"The project uses Acme Corporation."}))test('hard change cannot become a wording waiver: '+label,()=>{const fs=evidenceFindings(bundle(text),sourceText);assert(fs.some(f=>f.role==='Writer'&&f.kind==='hard'),JSON.stringify(fs));});
test('source span bounds, exact quote and relevance checked',()=>{const f=evidenceFindings(bundle(),sourceText).find(x=>x.role==='Writer')!;for(const span of [{start:-1,end:10},{start:0,end:999999},{start:0.1,end:2},{start:4,end:2}])assert.throws(()=>validateEvidence(f,sourceText,span,'bad'));assert.throws(()=>validateEvidence(f,sourceText,evidence().source_span,'not the selected quote'));assert.throws(()=>validateEvidence(f,'unrelated',{start:0,end:9},'unrelated'));});
test('partial decision cannot cover another claim; hashes/policy/actor must match',()=>{const b=bundle(paraphrase+'\nAI Journey Studio documents my ongoing learning journey.');const q=evidenceQuality(b,source),f=q.findings[0];const row={id:randomUUID(),binding:q.binding,finding_id:f.id,decision:'accept' as const,policy_version:EVIDENCE_POLICY,actor:'owner',reason:'Same role and approval responsibility',context:{source_hash:source.hash,artifact_hash:f.artifact_hash,bundle_hash:q.bundle_hash,claim_span:f.span,claim_text:f.claim},evidence:evidence()};assert(evidenceQuality(b,source,[row]).flags.length>0);for(const changed of [{binding:'bad'},{policy_version:'old'},{actor:'agent'},{finding_id:'bad'}])assert.equal(evidenceQuality(bundle(),source,[{...row,...changed}]).findings.filter(x=>x.resolution).length,0);});
test('privacy and artifact integrity remain hard gates',()=>{const b=bundle('Bandhan Bank client material');assert(evidenceQuality(b,source).flags.some(f=>f.kind==='hard'));const broken=bundle();broken[0].text+='changed';assert(evidenceQuality(broken,source).flags.some(f=>f.role==='Source'));});
test('structured Critic schema checks source hash, spans and quotations; legacy drafts still reviewable',()=>{
 const b=bundle();assert.equal(criticSuggestions(b,source).legacy,true);const a=b.find(x=>x.role==='Writer')!,ev=evidence();const data={schema:1,source_hash:source.hash,'Unsupported claims:':'Owner review required','Evidence needed:':'Compare meaning','Proposed advice:':'Review each claim',evidence:[{role:'Writer',artifact_hash:a.hash,start:0,end:a.text.length,source_start:ev.source_span.start,source_end:ev.source_span.end,source_quote:ev.source_quote,verdict:'wording_review'}]};
 const set=(v:unknown)=>{const a=b.find(x=>x.role==='Critic')!;a.text=JSON.stringify(v);a.hash=hash(a.text);};set(data);assert.equal(criticSuggestions(b,source).valid,true);assert(evidenceQuality(b,source).flags.length);set({...data,source_hash:'bad'});assert.equal(criticSuggestions(b,source).valid,false);assert(evidenceQuality(b,source).flags.some(x=>x.role==='Critic'));set({...data,evidence:Array(9).fill(data.evidence[0])});assert.equal(criticSuggestions(b,source).valid,false);assert.match(CRITIC_CONTRACT,/1200/);
});
async function fixture(work:(store:Store,id:string)=>Promise<void>){const db=await embedded();try{const store=new Store(db),intake=new SourceIntake(db);const staged=await intake.stage({text:sourceText,category:'project-note',reported_date:'2026-10-21'});const cleared=await intake.clear(staged.id,staged.hash,true),task=await enqueueLegacy(store,cleared.id);for(const x of bundle())await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,x.role,x.text,x.hash]);await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);await work(store,task.id);}finally{await db.close();}}
function input(q:ReturnType<typeof evidenceQuality>,id:string){return {binding:q.binding,finding_id:id,decision:'accept',reason:'The same role and final approval responsibility are retained.',...evidence(),acknowledged:true};}
test('old draft gets unpaid individual review, audit and separate approval; withdrawal invalidates approval',()=>fixture(async(store,id)=>{
 let state=await store.snapshot(),review=state.reviews[0];assert.equal(state.ledger.length,0);assert.equal(review.quality.findings.length,1);await assert.rejects(store.approve(id,review.token.slice(9)),/grounding/);
 const f=review.quality.findings[0];await store.reviewEvidence(id,review.token,input(review.quality,f.id));state=await store.snapshot();review=state.reviews[0];assert.equal(review.quality.flags.length,0);assert.equal(review.approval,null);assert.equal(state.ledger.length,0);assert.equal(state.events.filter((x:any)=>x.kind==='evidence_review_saved').length,1);
 await store.approve(id,review.token.slice(9));review=(await store.snapshot()).reviews[0];assert(review.approval);
 await store.reviewEvidence(id,review.token,{...input(review.quality,f.id),decision:'withdraw'});review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);assert(review.quality.flags.length);
 assert.equal((await store.db.query('SELECT * FROM evidence_decisions')).length,2);assert.equal((await store.db.query('SELECT * FROM approvals')).length,1);
}));
test('concurrent edits invalidate resolution inputs and never approve stale content',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];await store.revise(id,review.token,'Prepare an edited version');review=(await store.snapshot()).reviews[0];const pending=input(review.quality,review.quality.findings[0].id);
 const results=await Promise.allSettled([store.revise(id,review.token,'Correct the wording',{role:'Writer',text:sourceText}),store.reviewEvidence(id,review.token,pending)]);assert.equal(results[0].status,'fulfilled');
 const current=(await store.snapshot()).reviews[0];assert.notEqual(current.quality.binding,review.quality.binding);await assert.rejects(store.reviewEvidence(id,review.token,pending),/Stale/);assert.equal(current.approval,null);
}));
test('duplicate decisions are blocked; revoked clearance invalidates evidence review',()=>fixture(async(store,id)=>{
 const review=(await store.snapshot()).reviews[0],v=input(review.quality,review.quality.findings[0].id);const results=await Promise.allSettled([store.reviewEvidence(id,review.token,v),store.reviewEvidence(id,review.token,v)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const s=(await store.snapshot()).sources[0];await new SourceIntake(store.db).revoke(s.id,s.hash);await assert.rejects(store.reviewEvidence(id,review.token,v),/Source invalidated/);const q=(await store.snapshot()).reviews[0].quality;assert(q.flags.length);assert.equal(q.findings.filter((x:any)=>x.resolution).length,0);
}));

test('partial-word evidence, new timing and number substrings cannot waive claims',()=>{
 const f=evidenceFindings(bundle(),sourceText).find(x=>x.role==='Writer')!;const start=sourceText.indexOf('agents');assert.throws(()=>validateEvidence(f,sourceText,{start,end:start+6},'agents'),/complete/);
 assert(evidenceFindings(bundle('The project will use AI agents for implementation.'),sourceText).some(x=>x.kind==='hard'));
 assert(evidenceFindings(bundle('The project has 1 user.'),'The project has 15 users.').some(x=>x.kind==='hard'));
});
test('exact JSON strings and matching structural source fields remain supported',()=>{
 const b=bundle(sourceText);b[0].text=JSON.stringify({facts:sourceText.split('. ').map(x=>x.endsWith('.')?x:x+'.')});b[0].hash=hash(b[0].text);assert.equal(evidenceQuality(b,source).flags.length,0);
 b[0].text='SOURCE DATE: 2026-10-21\nSOURCE: '+sourceText;b[0].hash=hash(b[0].text);assert.equal(evidenceQuality(b,{...source,reported_date:'2026-10-21'}).flags.length,0);
});
test('public Writer metadata and malformed structured critic stay hard blocked',()=>{
 assert(evidenceQuality(bundle(sourceText+'\nUnsupported claims: None.'),source).flags.some(x=>x.kind==='hard'&&x.role==='Writer'));
 const b=bundle(sourceText);b[5].text='{bad JSON';b[5].hash=hash(b[5].text);assert(evidenceQuality(b,source).flags.some(x=>x.kind==='hard'&&x.role==='Critic'));
});
test('evidence approval receipts survive withdrawal/reapproval; source reclearance requires fresh decisions',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];await store.reviewEvidence(id,review.token,input(review.quality,review.quality.findings[0].id));review=(await store.snapshot()).reviews[0];await store.approve(id,review.token.slice(9));const original=await store.db.query('SELECT * FROM approvals');
 await store.reviewEvidence(id,review.token,{...input(review.quality,review.quality.findings[0].id),decision:'withdraw'});review=(await store.snapshot()).reviews[0];await store.reviewEvidence(id,review.token,input(review.quality,review.quality.findings[0].id));review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);await store.approve(id,review.token.slice(9));assert((await store.snapshot()).reviews[0].approval);assert.deepEqual(await store.db.query('SELECT * FROM approvals'),original);assert.equal((await store.db.query('SELECT * FROM evidence_approval_receipts')).length,2);
 await assert.rejects(store.db.query('DELETE FROM evidence_decisions'),/immutable/);await assert.rejects(store.db.query("UPDATE evidence_approval_receipts SET evidence_version='changed'"),/immutable/);
 const src=(await store.snapshot()).sources[0],intake=new SourceIntake(store.db);await intake.revoke(src.id,src.hash);await intake.clear(src.id,src.hash,true);review=(await store.snapshot()).reviews[0];assert.equal(review.approval,null);assert(review.quality.flags.length);
}));

test('wording resolution never grants content/publication approval; withdrawal blocks staged delivery and media',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];const version=review.token.slice(9);await store.db.query('INSERT INTO approvals(task_id,version) VALUES($1,$2)',[id,version]);
 const publisher=new Publishing(store.db,{enabled:false,accounts:[{id:'isolated-li',platform:'LinkedIn',remote_id:'urn:li:person:12345',label:'Isolated account',enabled:true,verified:true,authorization_version:'isolated-v1',scopes:['w_member_social'],linkedin_version:'202609'}]});
 const payload={request_id:randomUUID(),task_id:id,review_token:review.token,platform:'LinkedIn' as const,account_id:'isolated-li',scheduled_at:new Date(Date.now()+3600000).toISOString(),payload:{text:'Proposed approach: inspect one cleared source.'}};
 await assert.rejects(publisher.enqueue(payload),/grounding/);await assert.rejects(renderApprovedInstagram(store.db,id,review.token),/factual review/);
 await store.reviewEvidence(id,review.token,input(review.quality,review.quality.findings[0].id));review=(await store.snapshot()).reviews[0];await assert.rejects(publisher.enqueue(payload),/grounding/);await store.approve(id,version);const row=await publisher.enqueue(payload);assert.equal(row.status,'staged');assert.equal((await publisher.dispatch()).status,'disabled');
 await store.reviewEvidence(id,review.token,{...input(review.quality,review.quality.findings[0].id),decision:'withdraw'});await assert.rejects(publisher.approve(row.id,row.version,true),/grounding/);await assert.rejects(renderApprovedInstagram(store.db,id,review.token),/factual review/);assert.equal((await store.snapshot()).ledger.length,0);
}));

test('long legacy flags cover the full claim rather than accepting a truncated prefix',()=>{
 const text='I use AI agents for implementation '+('with careful review '.repeat(32))+'and achieved 500 users.';const fs=evidenceFindings(bundle(text),sourceText);const f=fs.find(x=>x.role==='Writer')!;assert.equal(f.claim,text);assert.equal(f.span.end,text.length);assert.equal(f.kind,'hard');
 assert(evidenceFindings(bundle('This draft uses only the exact sentences and facts and contains no added assumptions.'),sourceText).some(x=>x.kind==='hard'));
});
