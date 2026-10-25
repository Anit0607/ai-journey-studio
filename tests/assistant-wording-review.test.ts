import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {hash,ROLES} from '../lib/domain';
import {EVIDENCE_POLICY,ASSISTANT_EVIDENCE_POLICY,evidenceQuality,type AssistantEvidenceInput} from '../lib/evidence-review';
import {POST} from '../app/api/studio/[action]/route';
import {provisionOwner,handleOwnerAuth} from '../lib/owner-password';
const sourceText='The project is a drafting prototype. I use AI agents for implementation while retaining final approval.';
const paraphrase='The project owner uses AI agents for implementation while retaining final approval.';
const critic='Unsupported claims: Compare uncertain wording.\nEvidence needed: Compare meaning with the source.\nProposed advice: Inspect each claim before final approval.';
let db:Database;
before(async()=>{db=await embedded();});after(async()=>{await db.close();});beforeEach(async()=>{await db.query('TRUNCATE sources,events,budget_months,runtime CASCADE');});
async function seed(writer=paraphrase,critique=critic){
 const intake=new SourceIntake(db),staged=await intake.stage({text:sourceText,category:'project-note',reported_date:'2026-10-25'}),source=await intake.clear(staged.id,staged.hash,true),store=new Store(db),task=await store.enqueue(source.id);
 for(const [n,role] of ROLES.entries()){const text=role==='Writer'?writer:role==='Critic'?critique:role==='Platform Adapter'?'### LinkedIn\nProposed approach: inspect one cleared source.':'Proposed approach: inspect one cleared source.';await db.query('INSERT INTO outputs(id,task_id,role,text,hash,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),task.id,role,text,hash(text),new Date(Date.UTC(2026,9,25,0,0,n)).toISOString()]);}
 await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
 const review=async()=>(await store.snapshot()).reviews.find((r:any)=>r.task_id===task.id);
 const current=await review(),item=current.quality.findings.find((f:any)=>f.role==='Writer'),quote='I use AI agents for implementation while retaining final approval.',start=sourceText.indexOf(quote);
 const input:AssistantEvidenceInput={task:task.id,expected:current.token,binding:current.quality.binding,finding_id:item.id,decision:'accept',reason:'The quoted source preserves the same implementation and final approval responsibility.',source_span:{start,end:start+quote.length},source_quote:quote,acknowledged:true};
 return {source,store,task,review,current,input};
}
async function protectedState(includeTasks=true){const values:Record<string,unknown>={};for(const table of ['sources','tasks','outputs','content_revisions','approvals','revision_approvals','evidence_approval_receipts','publishing_outbox','publishing_approvals','github_source_policies','github_source_grants','ledger'])if(includeTasks||table!=='tasks')values[table]=await db.query('SELECT * FROM '+table);return JSON.stringify(values);}

test('explicit assistant comparison records truthfully and resolves only its exact wording, with no approval or publication writes',async()=>{
 const f=await seed(),before=await protectedState(),result=await f.store.reviewAssistantEvidence(f.input);assert.equal(result.actor,'assistant');assert.equal(result.policy_version,ASSISTANT_EVIDENCE_POLICY);assert.equal(await protectedState(),before);
 const r=await f.review();assert.equal(r.quality.flags.length,0);assert.equal(r.approval,null);const decision=r.quality.findings[0].resolution;assert.equal(decision.actor,'assistant');assert.equal(decision.context.review_token,f.input.expected);assert.equal(decision.context.review_token_hash,hash(f.input.expected));assert.equal(decision.context.source_quote_hash,hash(f.input.source_quote));assert.equal(r.quality.evidence_version,hash(decision.id));assert(r.quality.source_sentences.some((s:any)=>s.text===f.input.source_quote));
 await assert.rejects(db.query("UPDATE evidence_decisions SET actor='owner'"),/immutable/);await assert.rejects(db.query('DELETE FROM evidence_decisions'),/immutable/);
});
test('duplicate/concurrent acceptance yields one append-only comparison',async()=>{
 const f=await seed(),results=await Promise.allSettled([f.store.reviewAssistantEvidence(f.input),f.store.reviewAssistantEvidence(f.input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.query<any>('SELECT * FROM evidence_decisions')).length,1);
});
test('owner withdrawal dominates even a subsequently inserted assistant receipt; assistant cannot override any owner judgement',async()=>{
 const f=await seed();await f.store.reviewAssistantEvidence(f.input);const assistant=(await db.query<any>('SELECT * FROM evidence_decisions'))[0];await f.store.reviewEvidence(f.task.id,f.input.expected,{...f.input,source_span:f.input.source_span!,decision:'withdraw'});await assert.rejects(f.store.reviewAssistantEvidence(f.input),/owner decision/);
 const owner=(await db.query<any>('SELECT * FROM evidence_decisions ORDER BY sequence'))[1],later={...assistant,id:randomUUID()};const r=await f.review();const q=evidenceQuality(r.bundle,f.source,[assistant,owner,later],r.platform_policy,r.token);assert(q.flags.length);assert.equal(q.evidence_version,null);
 await f.store.reviewEvidence(f.task.id,f.input.expected,{...f.input,source_span:f.input.source_span!,decision:'accept'});assert.equal((await f.review()).quality.findings[0].resolution.actor,'owner');await assert.rejects(f.store.reviewAssistantEvidence({...f.input,decision:'withdraw',source_span:null,source_quote:''}),/owner decision/);
});
test('assistant withdrawal/recomparison invalidates prior content approval without modifying its immutable rows',async()=>{
 const f=await seed();await f.store.reviewAssistantEvidence(f.input);await f.store.approve(f.task.id,f.input.expected.slice(9));const oldApprovals=await db.query('SELECT * FROM approvals'),oldReceipts=await db.query('SELECT * FROM evidence_approval_receipts');assert((await f.review()).approval);
 const before=await protectedState(false);await f.store.reviewAssistantEvidence({...f.input,decision:'withdraw',source_span:null,source_quote:'',reason:'Withdraw pending another explicit comparison.'});assert.equal(await protectedState(false),before);assert.equal((await db.query('SELECT status FROM tasks WHERE id=$1',[f.task.id]))[0].status,'review');assert.equal((await f.review()).approval,null);
 await f.store.reviewAssistantEvidence(f.input);const r=await f.review();assert.equal(r.quality.flags.length,0);assert.equal(r.approval,null);assert.deepEqual(await db.query('SELECT * FROM approvals'),oldApprovals);assert.deepEqual(await db.query('SELECT * FROM evidence_approval_receipts'),oldReceipts);assert.equal((await db.query<any>('SELECT * FROM evidence_decisions')).length,3);
});
test('legacy owner decisions and approvals retain existing policy and exact receipt semantics',async()=>{
 const f=await seed();await f.store.reviewEvidence(f.task.id,f.input.expected,{...f.input,source_span:f.input.source_span!});const decision=(await db.query<any>('SELECT * FROM evidence_decisions'))[0];assert.equal(decision.actor,'owner');assert.equal(decision.policy_version,EVIDENCE_POLICY);assert.equal(decision.context.review_token,undefined);await f.store.approve(f.task.id,f.input.expected.slice(9));assert((await f.review()).approval);
 const r=await f.review();assert.equal(evidenceQuality(r.bundle,f.source,[decision],r.platform_policy).evidence_version,hash(decision.id));
});
test('actor/policy spoof, stale quote/span/hash/token and unsupported input never append a decision',async()=>{
 const f=await seed();for(const input of [{...f.input,actor:'owner'},{...f.input,policy_version:EVIDENCE_POLICY},{...f.input,binding:hash('wrong')},{...f.input,expected:'original:'+hash('wrong')},{...f.input,source_quote:'wrong'},{...f.input,source_span:{start:2,end:8}},{...f.input,source_span:{start:1.5,end:2}},{...f.input,source_span:{...f.input.source_span,actor:'owner'}},{...f.input,decision:'withdraw',source_span:f.input.source_span,source_quote:f.input.source_quote},{...f.input,reason:''},{...f.input,acknowledged:false}])await assert.rejects(f.store.reviewAssistantEvidence(input as any));assert.equal((await db.query<any>('SELECT * FROM evidence_decisions')).length,0);
});
test('saved assistant receipts fail closed on actor-policy mismatch, quote/context tampering, missing token, source revocation and identical-byte new revision',async()=>{
 const f=await seed();await f.store.reviewAssistantEvidence(f.input);const row=(await db.query<any>('SELECT * FROM evidence_decisions'))[0],r=await f.review();
 for(const changed of [{actor:'owner'},{policy_version:EVIDENCE_POLICY},{context:{...row.context,review_token_hash:hash('wrong')}},{context:{...row.context,source_hash:hash('wrong')}},{context:{...row.context,artifact_hash:hash('wrong')}},{context:{...row.context,bundle_hash:hash('wrong')}},{evidence:{...row.evidence,source_quote:'wrong'}},{evidence:null}])assert(evidenceQuality(r.bundle,f.source,[{...row,...changed}],r.platform_policy,r.token).flags.length);
 assert(evidenceQuality(r.bundle,f.source,[row],r.platform_policy).flags.length);assert(evidenceQuality(r.bundle,{...f.source,revoked_at:'now'},[row],r.platform_policy,r.token).flags.length);
 await f.store.revise(f.task.id,r.token,'Fresh identical-byte revision still requires its own comparison');const current=await f.review();assert.notEqual(current.token,r.token);assert(current.quality.flags.length);await assert.rejects(f.store.reviewAssistantEvidence(f.input),/Stale/);
});
for(const [name,writer,critique] of [['hard','The project has 500 users.',critic],['critic',paraphrase,'{invalid'],['editorial',paraphrase,'EDITORIAL HOLD: needs_revision\n'+critic]] as const)test(name+' hold cannot be waived by assistant wording comparison',async()=>{
 const f=await seed(writer,critique);if(name==='editorial')assert.equal(f.current.quality.editorial.blocking,true);await assert.rejects(f.store.reviewAssistantEvidence(f.input));assert.equal((await db.query<any>('SELECT * FROM evidence_decisions')).length,0);assert(f.current.quality.flags.length||f.current.quality.editorial.blocking);
});
test('pending agent revision and source revocation block assistant writes',async()=>{
 const f=await seed();await db.query("INSERT INTO tasks(id,source_id,source_hash,status,revision_parent_task_id,origin_key,revision_base_token,revision_note) VALUES($1,$2,$3,'queued',$4,'assistant-test-revision',$5,'Compare source')",[randomUUID(),f.source.id,f.source.hash,f.task.id,f.input.expected]);await assert.rejects(f.store.reviewAssistantEvidence(f.input),/pending/);await new SourceIntake(db).revoke(f.source.id,f.source.hash);await assert.rejects(f.store.reviewAssistantEvidence(f.input),/Source/);assert.equal((await db.query<any>('SELECT * FROM evidence_decisions')).length,0);
});
test('real owner-cookie route rejects bearer, CSRF and actor spoof; assistant route cannot create owner testimony',async()=>{
 const f=await seed(),origin='http://127.0.0.1:3201',secret='isolated-assistant-test-'+'x'.repeat(40),password='6728194035',globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>};globals.studioDb=Promise.resolve(db);const saved={...process.env};Object.assign(process.env,{STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret,STUDIO_RUNTIME_CONFIG:'{}',STUDIO_ACCESS_TOKEN:'isolated-worker-'+'y'.repeat(40),STUDIO_INTEGRATIONS_CONFIG:'{}'});delete process.env.VERCEL;
 try{await provisionOwner(db,password,true);const login=await handleOwnerAuth(new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})}),'login',{STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:secret},async()=>db);assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const call=(body:unknown=f.input,session=cookie,from=origin)=>POST(new Request(origin+'/api/studio/assistant-evidence-review',{method:'POST',headers:{Cookie:session,Origin:from,Authorization:'Bearer '+process.env.STUDIO_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({action:'assistant-evidence-review'})});
  assert.equal((await call(f.input,'')).status,401);assert.equal((await call(f.input,cookie+'tamper')).status,401);assert.equal((await call(f.input,cookie,'https://other.example')).status,403);assert.equal((await call({...f.input,actor:'owner'})).status,400);assert.equal((await call()).status,200);assert.equal((await db.query('SELECT actor FROM evidence_decisions'))[0].actor,'assistant');assert.equal((await db.query('SELECT * FROM evidence_approval_receipts')).length,0);
 }finally{delete globals.studioDb;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});

test('a compared wording finding never removes an unrelated hard finding',async()=>{
 const f=await seed();const text='The project has 500 users.';await db.query("UPDATE outputs SET text=$1,hash=$2 WHERE task_id=$3 AND role='Harvester'",[text,hash(text),f.task.id]);const r=await f.review(),writer=r.quality.findings.find((x:any)=>x.role==='Writer');assert(r.quality.flags.some((x:any)=>x.kind==='hard'));await f.store.reviewAssistantEvidence({...f.input,expected:r.token,binding:r.quality.binding,finding_id:writer.id});const current=await f.review();assert(current.quality.flags.some((x:any)=>x.kind==='hard'));assert.equal(current.approval,null);
});
