import {enqueueLegacy} from "./legacy-task-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {SourceIntake} from "../lib/sources";
import {ROLES,hash} from "../lib/domain";
import {evidenceQuality,OWNER_ATTESTATION_POLICY,OWNER_ATTESTATION_REASON,OUTDATED_CRITIC_NOTE} from "../lib/evidence-review";
import type {Artifact} from "../lib/grounding";
import {variantFixture} from "./variant-fixture";
const sourceText="AI Journey Studio is my personal project for documenting my AI learning journey. I am a non-coder and use AI agents for implementation while retaining final approval. The hosted dashboard and login are working. Automatic source collection, content generation and reviewed social publishing are not yet verified end to end.";
const source={text:sourceText,hash:hash(sourceText),cleared:true};
const paraphrase="The project owner identifies as a non-coder and uses AI agents for implementation while retaining final approval.\nAI Journey Studio documents my ongoing learning journey.";
const critic="Unsupported claims: Review uncertain wording.\nEvidence needed: Confirm meaning against the cleared note.\nProposed advice: Review each version before use.";
function bundle(writer=paraphrase):Artifact[]{return ROLES.map(role=>{const text=role==='Writer'?writer:role==='Critic'?critic:role==='Platform Adapter'?variantFixture():"Proposed approach: inspect one cleared source.";return {role,text,hash:hash(text)};});}
async function fixture(work:(store:Store,id:string)=>Promise<void>,writer?:string){const db=await embedded();try{const store=new Store(db),intake=new SourceIntake(db);const staged=await intake.stage({text:sourceText,category:'project-note',reported_date:'2026-10-21'});const cleared=await intake.clear(staged.id,staged.hash,true),task=await enqueueLegacy(store,cleared.id);for(const x of bundle(writer))await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,x.role,x.text,x.hash]);await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);await work(store,task.id);}finally{await db.close();}}

test('one owner confirmation resolves every wording flag of the exact bundle and then allows approval',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];const open=review.quality.flags.length;assert(open>=2,'fixture needs several wording flags');assert(review.quality.flags.every((f:any)=>f.kind==='wording_review'));
 await assert.rejects(store.approve(id,review.token.slice(9)),/grounding/);
 assert.deepEqual(await store.attestFinalPost(id,review.token,{binding:review.quality.binding,acknowledged:true}),{confirmed:open});
 const state=await store.snapshot();review=state.reviews[0];assert.equal(review.quality.flags.length,0);assert.equal(review.approval,null,'confirmation is not content approval');
 const rows=await store.db.query<any>('SELECT * FROM evidence_decisions');assert.equal(rows.length,open);assert(rows.every(r=>r.actor==='owner'&&r.policy_version===OWNER_ATTESTATION_POLICY&&r.reason===OWNER_ATTESTATION_REASON));
 assert.equal(state.events.filter((x:any)=>x.kind==='owner_final_post_attested').length,1);
 await store.approve(id,review.token.slice(9));assert((await store.snapshot()).reviews[0].approval);
}));

test('confirmation needs the explicit acknowledgement and the current binding',()=>fixture(async(store,id)=>{
 const review=(await store.snapshot()).reviews[0];
 await assert.rejects(store.attestFinalPost(id,review.token,{binding:review.quality.binding,acknowledged:false}),/Confirm that you read/);
 await assert.rejects(store.attestFinalPost(id,review.token,{binding:'stale',acknowledged:true}),/Stale evidence review/);
 assert.equal((await store.db.query('SELECT * FROM evidence_decisions')).length,0);
}));

test('hard findings cannot be confirmed away',()=>fixture(async(store,id)=>{
 const review=(await store.snapshot()).reviews[0];assert(review.quality.flags.some((f:any)=>f.kind==='hard'));
 await assert.rejects(store.attestFinalPost(id,review.token,{binding:review.quality.binding,acknowledged:true}),/Fix the marked corrections first/);
 assert.equal((await store.db.query('SELECT * FROM evidence_decisions')).length,0);
},"The project has 500 users."));

test('an edit after confirmation reopens review; nothing carries over to changed text',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];await store.attestFinalPost(id,review.token,{binding:review.quality.binding,acknowledged:true});
 review=(await store.snapshot()).reviews[0];assert.equal(review.quality.flags.length,0);
 const writer=review.bundle.find((a:any)=>a.role==='Writer').text.replace('ongoing','continuing');
 await store.revise(id,review.token,'Owner wording change',{role:'Writer',text:writer});
 review=(await store.snapshot()).reviews[0];assert(review.quality.flags.length>0);
}));

test('an owner withdrawal after confirmation reopens that sentence',()=>fixture(async(store,id)=>{
 let review=(await store.snapshot()).reviews[0];await store.attestFinalPost(id,review.token,{binding:review.quality.binding,acknowledged:true});
 review=(await store.snapshot()).reviews[0];const f=review.quality.findings[0];
 await store.reviewEvidence(id,review.token,{binding:review.quality.binding,finding_id:f.id,decision:'withdraw',reason:'On reflection this is not accurate.',source_span:{start:0,end:0},source_quote:'',acknowledged:true});
 review=(await store.snapshot()).reviews[0];assert.equal(review.quality.flags.length,1);assert.equal(review.quality.flags[0].id,f.id);
}));

test('forged or mismatched confirmation rows resolve nothing',()=>{
 const b=bundle(),q=evidenceQuality(b,source);
 const row=(f:any,extra:Record<string,unknown>={})=>({id:randomUUID(),binding:q.binding,finding_id:f.id,decision:'accept' as const,policy_version:OWNER_ATTESTATION_POLICY,actor:'owner',reason:OWNER_ATTESTATION_REASON,evidence:{source_span:{start:-1,end:-1},source_quote:''},context:{source_hash:source.hash,artifact_hash:f.artifact_hash,bundle_hash:q.bundle_hash,claim_span:f.span,claim_text:f.claim},...extra});
 assert.equal(evidenceQuality(b,source,q.flags.map(f=>row(f))).flags.length,0);
 assert.equal(evidenceQuality(b,source,q.flags.map(f=>row(f,{reason:'Looks fine'}))).flags.length,q.flags.length);
 assert.equal(evidenceQuality(b,source,q.flags.map(f=>row(f,{actor:'assistant'}))).flags.length,q.flags.length);
 assert.equal(evidenceQuality(b,source,q.flags.map(f=>row(f,{binding:'other'}))).flags.length,q.flags.length);
 assert.equal(evidenceQuality(b,source,q.flags.map(f=>({...row(f),context:{...row(f).context,bundle_hash:'old'}}))).flags.length,q.flags.length);
});

test('a spelled-out source number supports the same digit; a genuinely new number stays hard',()=>{
 const src='The endpoint used a five-minute autosuspend delay and two-minute integration requests.',s={text:src,hash:hash(src),cleared:true};
 const flags=(writer:string)=>evidenceQuality(bundle(writer),s).findings.filter(f=>f.role==='Writer');
 assert(flags('The database slept after 5 minutes of idle time and requests came every 2 minutes.').every(f=>f.kind==='wording_review'));
 assert(flags('The database slept after 400 hours of running time.').some(f=>f.kind==='hard'&&/New figure/.test(f.reason)));
});

test('ordinary words starting a sentence need owner review, not a hard block; unknown mid-sentence names stay hard',()=>{
 const flags=(writer:string)=>evidenceQuality(bundle(writer),source).findings.filter(f=>f.role==='Writer');
 for(const text of ['But the hosted dashboard and login are working.','Posting has its own approval.'])assert(flags(text).every(f=>f.kind==='wording_review'),text);
 assert(flags('The hosted dashboard was reviewed by Microsoft.').some(f=>f.kind==='hard'));
 assert(flags('Microsoft reviewed the hosted dashboard.').some(f=>f.kind==='hard'),'an unknown name starting a public sentence is hard, never skipped');
 assert(flags('Acme Corporation reviewed the hosted dashboard.').some(f=>f.kind==='hard'),'multiword names stay hard anywhere');
});

test('an owner edit to public copy replaces a structured Critic with a plain out-of-date note; other edits keep it',async()=>{
 const run=async(role:string,critic:string)=>{const db=await embedded();try{const store=new Store(db),intake=new SourceIntake(db);const staged=await intake.stage({text:sourceText,category:'project-note',reported_date:'2026-10-21'});const cleared=await intake.clear(staged.id,staged.hash,true),task=await enqueueLegacy(store,cleared.id);
  for(const x of bundle().map(a=>a.role==='Critic'?{role:a.role,text:critic,hash:hash(critic)}:a))await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,x.role,x.text,x.hash]);await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  const review=(await store.snapshot()).reviews[0],current=review.bundle.find((a:any)=>a.role===role).text;
  await store.revise(task.id,review.token,'Owner wording change',{role,text:current+'\nAI Journey Studio documents my learning.'});
  return (await store.snapshot()).reviews[0].bundle.find((a:any)=>a.role==='Critic').text;}finally{await db.close();}};
 const structured='{"schema":2,"source_hash":"stale"}';
 assert.equal(await run('Writer',structured),OUTDATED_CRITIC_NOTE);
 assert.equal(await run('Strategist',structured),structured,'internal-only edits leave the Critic untouched');
 assert.equal(await run('Writer',critic),critic,'a plain-prose Critic is kept');
 const q=evidenceQuality(bundle().map(a=>a.role==='Critic'?{role:a.role,text:OUTDATED_CRITIC_NOTE,hash:hash(OUTDATED_CRITIC_NOTE)}:a),source);
 assert.equal(q.critic.legacy,true);assert(q.flags.every(f=>f.kind==='wording_review'),'the note itself raises no hard finding');
});
