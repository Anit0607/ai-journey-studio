import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as domain from '../lib/domain';
import * as scopes from '../lib/private-comparison-scopes';
import {COMPARISON_PRICING} from '../lib/private-comparison-policy';
const require=createRequire(import.meta.url),clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
/** Unit-only authorization/config-digest mocks. Production constants stay pending.
 * Full historical task/source/calendar/original data reproduces the real state
 * digest without a state-hash stub. It proves historical binding, not fresh live
 * readiness: the authenticated read-only preflight must establish that later. */
function harness(){
 const events=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-2026-10-25.json',import.meta.url),'utf8')) as any[];
 const config:any={mode:'offline-finite-successor'},policyHash=domain.hash('offline compiled prompt policy'),configBytes=JSON.stringify(config);
 const context=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-context-2026-10-25.json',import.meta.url),'utf8')).context;
 assert.equal(domain.hash(JSON.stringify(context)),scopes.COMPARISON_PREDECESSOR.state_hash);
 const {task,source,calendar,original}=clone(context);
 const stages=events.filter(e=>e.kind==='private_comparison_stage').map(e=>JSON.parse(e.detail));
 const ledger:any[]=[{id:scopes.COMPARISON_PREDECESSOR.run_id,task_id:task.id,month:domain.istMonth(),provider:'openai',model:COMPARISON_PRICING.model,pricing:COMPARISON_PRICING,status:'settled',completion_status:'blocked',reserved:850000,estimated:85324,input_tokens:stages.reduce((n,s)=>n+s.input,0),output_tokens:stages.reduce((n,s)=>n+s.output,0),role:null,checkpoint:null,requested_service_tier:'default',pricing_anomaly:false}];
 const before=JSON.stringify({events,ledger});let ready=true,approved=true,currentPolicyHash=policyHash,calls=0,mutate:()=>void=()=>{};const sql:string[]=[];
 const query=async(statement:string,p:any[]=[])=>{
  sql.push(statement);if(statement.startsWith('SET ')||statement.includes('budget_months'))return [];
  if(statement.startsWith('SELECT * FROM tasks'))return [clone(task)];if(statement.startsWith('SELECT * FROM sources'))return [clone(source)];if(statement.startsWith('SELECT * FROM calendar_entries'))return [clone(calendar)];if(statement.startsWith('SELECT * FROM outputs'))return clone(original);
  if(statement.startsWith('SELECT * FROM events')||statement.startsWith('SELECT id,kind,detail FROM events'))return clone(events);
  if(statement.startsWith('SELECT id FROM events WHERE task_id'))return events.filter(e=>e.task_id===p[0]&&e.kind===p[1]).map(e=>({id:e.id}));
  if(statement.startsWith('SELECT id FROM events WHERE id'))return events.filter(e=>e.id===p[0]&&e.kind===p[1]).map(e=>({id:e.id}));
  if(statement.startsWith('SELECT * FROM ledger ORDER BY'))return clone(ledger);
  if(statement.startsWith('SELECT COALESCE'))return [{used:String(ledger.filter(r=>r.month===p[0]||r.status!=='settled').reduce((n,r)=>n+Number(r.status==='settled'?r.estimated:r.reserved),0)),unresolved:String(ledger.filter(r=>r.status!=='settled'||r.estimated===null||r.estimated<0).length)}];
  if(statement.startsWith('SELECT id FROM ledger WHERE id!='))return ledger.filter(r=>r.id!==p[0]&&r.status!=='settled').map(r=>({id:r.id}));
  if(statement.startsWith('SELECT status FROM ledger'))return ledger.filter(r=>r.id===p[0]).map(r=>({status:r.status}));
  if(statement.startsWith('SELECT id FROM ledger'))return ledger.filter(r=>r.id===p[0]).map(r=>({id:r.id}));
  if(statement.startsWith('INSERT INTO ledger')){ledger.push({id:p[0],task_id:p[1],month:p[2],provider:'openai',model:p[3],pricing:JSON.parse(p[4]),reserved:p[5],status:'reserved',estimated:null,input_tokens:null,output_tokens:null,completion_status:null,pricing_anomaly:false,role:null,checkpoint:null,requested_service_tier:'default'});return [];}
  if(statement.startsWith('INSERT INTO events')){events.push({id:p[0],task_id:p[1],kind:p[2],detail:p[3]});return [];}
  if(statement.startsWith('UPDATE ledger')){const row=ledger.find(r=>r.id===p[0]);if(row?.status==='reserved')Object.assign(row,{status:p[1],estimated:p[2],input_tokens:p[3],output_tokens:p[4],completion_status:p[5],pricing_anomaly:p[6]});return [];}
  throw Error('Unhandled offline SQL '+statement);
 };
 let tail=Promise.resolve();const db:any={kind:'postgres',close:async()=>{},query,transaction:(work:any)=>{const result=tail.then(()=>work({query}));tail=result.then(()=>{},()=>{});return result;}};
 const modules:any={
  './domain':{...domain,hash:(text:string)=>text===configBytes?scopes.COMPARISON_PREDECESSOR.config_hash:domain.hash(text)},
  './private-comparison-scopes':{...scopes,currentComparisonPromptPolicyHash:()=>currentPolicyHash,comparisonPolicyAuthorized:(p:any,h:string)=>!p.corrected||approved&&h===policyHash},
  './sources':{sourceAuthorized:()=>true,draftSourceEligible:()=>true},'./github-source-policy':{resolveScopedSource:async(_tx:any,s:any)=>s},'./scoped-source-proof':{scopedTaskMatches:()=>true},
  './draft-prompt':{buildDraftPrompt:()=> 'Offline bounded prompt'},'./critic-response-format':{draftArtifactContract:()=>undefined,providerResponseFormatBytes:()=>0},'./note-fact-selection':{noteStageIssue:()=>null},'./editorial-review':{editorialReview:()=>({blocking:false})},'./evidence-review':{evidenceQuality:()=>({status:'needs_human_review'})},'./platform-policy':{taskPlatformPolicy:()=>({version:'offline'})}
 };
 const exports:any={},code=ts.transpileModule(readFileSync(new URL('../lib/private-comparison.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:(name:string)=>modules[name]??require(name.startsWith('./')?'../lib/'+name.slice(2):name),Buffer,Date,setTimeout,clearTimeout});
 const options={readConfig:()=>config,ready:()=>ready,provider:async()=>{calls++;mutate();return {text:'Exact mocked output '+calls,input:10,output:10,complete:true,report:{model:COMPARISON_PRICING.model,tier:'default',finish_reason:'stop'},raw:{}};}};
 const input=async()=>({expected_state_hash:(await exports.comparisonContext(db,config,false,scopes.CORRECTED_COMPARISON_SCOPE_HASH)).state_hash,scope_hash:scopes.CORRECTED_COMPARISON_SCOPE_HASH,acknowledged:true});
 return {events,ledger,original,task,source,calendar,config,sql,before,read:()=>({calls}),setMutation:(f:()=>void)=>{mutate=f;},revoke:()=>{approved=false;},driftPolicy:()=>{currentPolicyHash=domain.hash('changed policy');},closeGate:()=>{ready=false;},run:async()=>exports.runPrivateComparison(db,await input(),options),runWith:(i:any)=>exports.runPrivateComparison(db,i,options),snapshot:()=>exports.comparisonSnapshot(db,config,scopes.CORRECTED_COMPARISON_SCOPE_HASH),input};
}
test('mock-authorized successor serializes one reservation, six stages and no third attempt',async()=>{
 const h=harness(),input=await h.input(),results=await Promise.all([h.runWith(input),h.runWith(input)]);assert.equal(results.filter(r=>r.status==='completed_requires_review').length,1);assert.equal(h.read().calls,6);assert.equal(h.ledger.length,2);assert.equal(h.ledger[1].reserved,764676);assert.equal(h.ledger[1].estimated,750);assert.equal(h.ledger[0].estimated,85324);assert.equal(h.ledger[0].completion_status,'blocked');
 assert.notEqual((await h.runWith(input)).status,'completed_requires_review');assert.equal(h.read().calls,6);assert.equal(h.events.filter(e=>e.kind==='private_comparison_started').length,2);
 assert.equal(JSON.stringify({events:h.events.slice(0,14),ledger:[h.ledger[0]]}),h.before);
 assert(!h.sql.some(s=>/^(INSERT|UPDATE|DELETE).*\b(tasks|outputs|calendar_entries|approvals|publishing_outbox)\b/.test(s)));
});
for(const kind of ['source','calendar','task','config','permission','prompt','gate'] as const)test('mock-authorized successor stops before a second paid stage after '+kind+' drift',async()=>{
 const h=harness();h.setMutation(()=>{if(kind==='source')h.source.text+=' changed';if(kind==='calendar')h.calendar.changed=true;if(kind==='task')h.task.changed=true;if(kind==='config')h.config.changed=true;if(kind==='permission')h.revoke();if(kind==='prompt')h.driftPolicy();if(kind==='gate')h.closeGate();});
 const result=await h.run();assert.notEqual(result.status,'completed_requires_review');assert.equal(h.read().calls,1);assert.equal(h.ledger[1].estimated,125);assert.equal(h.ledger[0].estimated,85324);
});
test('read-only corrected preflight writes nothing and requires exact legacy state plus global budget',async()=>{
 const h=harness();assert.equal((await h.snapshot()).admission_preflight.eligible,true);assert(!h.sql.some(s=>/^(INSERT|UPDATE|DELETE|SET)/.test(s)));assert(!h.sql.some(s=>s.includes('FOR UPDATE')));assert.equal(h.read().calls,0);
 h.calendar.changed=true;assert.equal((await h.snapshot()).admission_preflight.eligible,false);assert.equal((await h.run()).status,'blocked');assert.equal(h.read().calls,0);assert.equal(h.ledger.length,1);
 const high=harness();high.ledger.push({...high.ledger[0],id:'other',estimated:13_500_000});assert.equal((await high.snapshot()).admission_preflight.eligible,false);assert.equal((await high.run()).status,'blocked');assert.equal(high.read().calls,0);
});
