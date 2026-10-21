import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceQuality} from '../lib/evidence-review';
import {verifiedSourceEnvelope} from '../lib/grounding';
import {Store} from '../lib/store';
import {ROLES,hash} from '../lib/domain';
import type {Database} from '../lib/db';
const source='AI Journey Studio is my personal project for documenting my AI learning journey. I am a non-coder and use AI agents for implementation while retaining final approval. The hosted dashboard and login are working. Automatic source collection, content generation and reviewed social publishing are not yet verified end to end. This is work in progress, not a completed automation success story.';
const date='2026-10-21',envelope='SOURCE DATE: 2026-10-21, SOURCE: '+source;
const prefixA='{"padding":"',prefixB='","provenance":';
const prefix=prefixA+' '.repeat(470-prefixA.length-prefixB.length)+prefixB;
const harvester=prefix+JSON.stringify(envelope)+'}';
const bundle=ROLES.map(role=>{const text=role==='Harvester'?harvester:role==='Critic'?'Unsupported claims: Review wording.\nEvidence needed: Review source.\nProposed advice: Inspect each version.':role==='Platform Adapter'?['LinkedIn','X','Instagram'].map(p=>'### '+p+'\nProposed approach: inspect the source.').join('\n\n'):'Proposed approach: inspect the source.';return {role,text,hash:hash(text)};});
const context={text:source,hash:hash(source),cleared:true,reported_date:date};

test('exact comma-delimited screenshot fixture at offsets470–895 is verified only by matching source metadata',()=>{
 assert.equal(harvester.indexOf(JSON.stringify(envelope)),470);assert.equal(470+JSON.stringify(envelope).length,895);assert.equal(verifiedSourceEnvelope(envelope,'Harvester',source,date),true);
 const before=JSON.stringify(bundle),q=evidenceQuality(bundle,context);assert.equal(q.findings.filter(x=>x.role==='Harvester').length,0);assert.equal(q.flags.length,0);assert.equal(q.status,'needs_human_review');assert.equal(JSON.stringify(bundle),before);
});
test('comma fixture remains blocked for missing, mismatched or noncanonical date serialization',()=>{
 for(const reported of [undefined,'2026-10-20','2026-10-21T00:00:00.000Z']){const q=evidenceQuality(bundle,{...context,reported_date:reported});assert(q.flags.some(x=>x.role==='Harvester'&&x.kind==='hard'));assert.equal(verifiedSourceEnvelope(envelope,'Harvester',source,reported),false);}
});
test('comma is only a separator; wrong source, extra entities/figures and public-role wrappers are not exempt',()=>{
 for(const value of [envelope+' I gained 500 followers.',envelope.replace('my personal project','my Acme Corporation project'),envelope.replace(date,'2026-10-22')])assert.equal(verifiedSourceEnvelope(value,'Harvester',source,date),false);
 assert.equal(verifiedSourceEnvelope(envelope,'Writer',source,date),false);assert.equal(verifiedSourceEnvelope(envelope,'Platform Adapter',source,date),false);
 const body='I launched my project on 2026-10-21.';const changed=bundle.map(x=>x.role==='Harvester'?{...x,text:body,hash:hash(body)}:x);assert(evidenceQuality(changed,context).flags.some(x=>x.role==='Harvester'&&x.kind==='hard'));
});
async function snapshotWith(reported:unknown){
 const sourceRow={id:'isolated-source',...context,reported_date:reported,category:'project-note',created:'2026-10-21T00:00:00.000Z'};
 const taskRow={id:'isolated-task',source_id:sourceRow.id,source_hash:sourceRow.hash,status:'review',checkpoint:6,updated:'2026-10-21T00:00:00.000Z'};
 const outputs=bundle.map((x,i)=>({...x,id:'isolated-output-'+i,task_id:taskRow.id,created:'2026-10-21T00:00:00.000Z'}));let writes=0;
 const db:Database={kind:'postgres',async query<T>(sql:string){if(!/^\s*(SELECT|WITH)\b/i.test(sql)){writes++;throw Error('Writes forbidden in caller-shape test');}const table=/SELECT \* FROM (\w+)/i.exec(sql)?.[1];const rows=table==='sources'?[sourceRow]:table==='tasks'?[taskRow]:table==='outputs'?outputs:[];return rows as T[];},async transaction(){writes++;throw Error('Transactions forbidden in caller-shape test');},async close(){}};
 const state=await new Store(db).snapshot();assert.equal(writes,0);return JSON.parse(JSON.stringify(state));
}
test('actual Store.snapshot caller passes ISO text metadata unchanged through API JSON shape, without DB writes',async()=>{
 const state=await snapshotWith(date);assert.equal(typeof state.sources[0].reported_date,'string');assert.equal(state.sources[0].reported_date,date);assert.equal(state.reviews[0].quality.flags.length,0);assert.equal(state.reviews[0].approval,null);
});
test('actual snapshot caller does not fill or normalize missing/mismatched source metadata',async()=>{
 for(const reported of [undefined,'2026-10-20','2026-10-21T00:00:00.000Z']){const state=await snapshotWith(reported);assert(state.reviews[0].quality.flags.some((x:{role:string;kind:string})=>x.role==='Harvester'&&x.kind==='hard'));assert.equal(state.reviews[0].approval,null);}
});
