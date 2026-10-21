import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleQuality,groundingRules} from '../lib/grounding';
import {hash} from '../lib/domain';
import {platformVariants,hasInternalReviewMetadata,PLATFORM_FORMAT} from '../lib/platform-variants';
const first='AI Journey Studio is my personal project for documenting my AI learning journey.';
const second='I am a non-coder and use AI agents for implementation while retaining final approval.';
const source=first+' '+second+' The hosted dashboard and login are working. Automatic source collection, content generation and reviewed social publishing are not yet verified end to end. This is work in progress, not a completed automation success story.';
const artifact=(role:string,text:string)=>({role,text,hash:hash(text)});
const critic=artifact('Critic','Unsupported claims: none\nEvidence needed: end-to-end verification remains pending\nProposed advice: inspect each component.');
const flags=(role:string,text:string)=>bundleQuality([artifact(role,text),critic],source,'2026-10-21').flags.filter(f=>f.role===role);

test('JSON evidence values and straight/curly quoted source sentences match formatting only',()=>{
 for(const text of [JSON.stringify({claims:[first,second],provenance:{source_date:'2026-10-21',source}}),'- \u201c'+first+'\u201d\n- \u201c'+second+'\u201d','1. "'+first+'"\n2. "'+second+'"','> **'+first+'**'])assert.deepEqual(flags('Harvester',text),[],text);
 assert.deepEqual(flags('Strategist','- \u201c'+first+'\u201d\n- \u201c'+second+'\u201d'),[]);
});
test('complete exact-source provenance fields are structural, not blanket SOURCE prefixes',()=>{
 assert.deepEqual(flags('Harvester','SOURCE DATE: 2026-10-21\nSOURCE: '+source),[]);
 assert.deepEqual(flags('Harvester',JSON.stringify({provenance:'SOURCE DATE: 2026-10-21 SOURCE: '+source})),[]);
 assert.ok(flags('Harvester','SOURCE: '+first+' I gained 500 followers.').length>0);
 assert.ok(flags('Harvester','SOURCE: I am a trained developer.').length>0);
});
test('format repair cannot erase appended claims, negation reversal, figures or new biography',()=>{
 const unsupported=[first+' I gained 500 followers.',second.replace('I am a non-coder','I am a coder'),second.replace('retaining final approval','not retaining final approval'),first.replace('personal project','personal project with 500 users'),'I am an experienced software engineer.'];
 for(const text of unsupported){assert.ok(flags('Writer','"'+text+'"').length>0,text);assert.ok(flags('Harvester',JSON.stringify({claims:[text]})).length>0,text);}
 assert.ok(flags('Harvester',JSON.stringify({claims:[first],extra:'I made 100 posts.'})).length>0);
 assert.ok(flags('Harvester',JSON.stringify({claims:[first],followers:500})).some(f=>/figure/.test(f.reason)));
 assert.ok(flags('Writer',first+' The project reached 500 users.').some(f=>/figure/.test(f.reason)));
 assert.ok(flags('Writer',first+' Revenue increased 40%.').some(f=>/figure/.test(f.reason)));
 const external='Attributed GitHub evidence; this record does not establish the owner\'s experience.\n'+second;assert.ok(bundleQuality([artifact('Writer','"'+second+'"'),critic],external).flags.some(f=>f.role==='Writer'));
});
test('the actual unsupported paraphrases remain gated, not globally whitelisted',()=>{
 for(const text of ['AI Journey Studio is an ongoing personal project focused on documenting my AI learning journey.','As a non-coder, I rely on AI agents to assist with implementation, while retaining final approval over outputs.','AI Journey Studio is my personal AI learning journey.','AI Journey Studio documents my AI learning journey as a non-coder using AI agents with my final approval.'])assert.ok(flags('Writer',text).length>0,text);
 assert.ok(flags('Writer','This experience highlights the importance of iterative progress and human oversight.').some(f=>/Experiential lesson/.test(f.reason)));
});
test('review metadata stays internal and contaminated variants fail without mutating bytes',()=>{
 const copy='### LinkedIn\n'+first+'\n### X\n'+first+'\n### Instagram\n'+first;
 assert.equal(platformVariants(artifact('Platform Adapter',copy)).complete,true);
 for(const metadata of ['Unsupported claims: None.','**Evidence needed:** Verify stability.','*Proposed advice:* Check components.','*Source: Owner-cleared statements as of 2026-10-21.*','SOURCE DATE: 2026-10-21']){
  assert.equal(hasInternalReviewMetadata(metadata),true,metadata);const text=copy.replace('\n### X','\n'+metadata+'\n### X'),saved=artifact('Platform Adapter',text),before=JSON.stringify(saved);const parsed=platformVariants(saved);assert.equal(parsed.complete,false);assert.match(parsed.reason||'',/Internal reviewer metadata/);assert.equal(JSON.stringify(saved),before);
  assert.ok(bundleQuality([saved,critic],source).flags.some(f=>f.role==='Platform Adapter'));
 }
 assert.deepEqual(flags('Platform Adapter',copy),[]);assert.equal(critic.text.includes('Evidence needed:'),true);assert.match(PLATFORM_FORMAT,/internal artifacts/);assert.match(groundingRules(source),/Writer and Platform Adapter return public prose only/);
});

test('contaminated saved copy cannot be approved and evidence notes remain intact',async()=>{
 const {embedded}=await import('../lib/db');const {Store}=await import('../lib/store');const {SourceIntake}=await import('../lib/sources');const {ROLES}=await import('../lib/domain');const {randomUUID}=await import('node:crypto');const db=await embedded();
 try{const store=new Store(db),intake=new SourceIntake(db),s=await intake.stage({text:'I reviewed a draft.',category:'project-note',reported_date:new Date().toISOString().slice(0,10)});await intake.clear(s.id,s.hash,true);const task=await store.enqueue(s.id);
  const copy='### LinkedIn\nI reviewed a draft.\nEvidence needed: end-to-end verification.\n### X\nI reviewed a draft.\n### Instagram\nI reviewed a draft.';
  for(const role of ROLES){const text=role==='Platform Adapter'?copy:role==='Critic'?critic.text:'I reviewed a draft.';await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,role,text,hash(text)]);}await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);const rows=await db.query<{role:string;text:string;hash:string}>('SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]);const version=hash(rows.map(row=>row.hash).join('|'));
  await assert.rejects(()=>store.approve(task.id,version),/source-grounding|flags|Resolve/);assert.equal((await db.query('SELECT * FROM approvals')).length,0);const saved=(await db.query<{text:string;hash:string}>("SELECT text,hash FROM outputs WHERE task_id=$1 AND role='Platform Adapter'",[task.id]))[0];assert.equal(saved.text,copy);assert.equal(saved.hash,hash(copy));assert.equal((await db.query<{text:string}>("SELECT text FROM outputs WHERE task_id=$1 AND role='Critic'",[task.id]))[0].text,critic.text);
 }finally{await db.close();}
});
