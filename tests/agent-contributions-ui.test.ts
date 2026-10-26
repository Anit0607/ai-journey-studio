import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {OWNER_WRITING_PROFILE} from '../lib/owner-writing-profile';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../app/agent-contributions-panel.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports:any={};
new Function('require','exports',compiled)(require,exports);
const text=(v:any):string=>Array.isArray(v)?v.map(text).join(' '):v?.props?text(v.props.children):typeof v==='string'||typeof v==='number'?String(v):'';
const nodes=(v:any):any[]=>Array.isArray(v)?v.flatMap(nodes):v?.props?[v,...nodes(v.props.children)]:[];
const usage={attempts:0,settled:0,known_estimate_microdollars:0,estimated_microdollars:null,input_tokens:null,output_tokens:null,unresolved_reserved_microdollars:null,unknown_usage_calls:0};
const contributions={notice:'No factual pass or publication approval is inferred.',unattributed_calls:1,roles:[{role:'Writer',checkpoint:3,purpose:'Write the public draft.',current_origin:{kind:'manual_edit',revision_id:'manual-revision'},usage,runs:[{task_id:'original-task',kind:'original_run',status:'review',output:{text:'Original output kept verbatim.',hash:'saved-hash'},usage,elapsed_ms:null,attempts:[{id:'call',provider:'openai',model:'fixture',status:'unknown',completion_status:null,prepared:null}]}]}]};
test('dashboard separates manual current work, original saved output and unknown historical style/accounting without new actions',()=>{
 const tree=exports.default({contributions,profile:OWNER_WRITING_PROFILE}),shown=text(tree);
 for(const phrase of ['Manual editor change, not an agent run','Original output kept verbatim.','Historical prompt/style version not recorded','not recorded, not zero','Reservation-to-artifact elapsed:','not recorded or ambiguous','no fine-tuning','No factual pass or publication approval'])assert(shown.includes(phrase),phrase);
 assert.equal(nodes(tree).filter(n=>['button','input','textarea'].includes(n.type)).length,0);
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(page,/<AgentContributionsPanel contributions=\{review.contributions\}/);
});
test('prepared receipt never claims execution, and elapsed interval is explicitly not pure model latency',()=>{
 const value=structuredClone(contributions),run=value.roles[0].runs[0] as any;run.elapsed_ms=4798;run.attempts[0].prepared={writing_profile:{version:'old-profile',hash:'old-hash'},source_hash:'source',prior_artifacts:[],prompt_hash:'prompt'};run.attempts[0].receipt_state='prepared_not_proof_of_transmission';
 const shown=text(exports.default({contributions:value,profile:OWNER_WRITING_PROFILE}));assert(shown.includes('prepared/reserved, not proof of transmission'));assert(shown.includes('4.798 seconds, including application overhead; not pure model latency'));assert(shown.includes('old-profile'));assert(shown.includes('Raw prompt text is not stored'));
});

test('canonical note contribution displays model-selected IDs separately from exact server-rendered source evidence',()=>{
 const value=structuredClone(contributions),role=value.roles[0] as any;role.role='Story Miner';role.checkpoint=1;role.runs[0].selected_facts={decision:'selected',source_hash:'bound-source',selection_artifact_hash:'bound-selection',facts:[{id:'fact_a',start:17,end:45,text:'Exact source observation.'}]};
 const shown=text(exports.default({contributions:value,profile:OWNER_WRITING_PROFILE}));assert(shown.includes('Exact source observation.'));assert(shown.includes('fact_a'));assert(shown.includes('bound-source'));assert(shown.includes('bound-selection'));assert(shown.includes('server-rendered'));assert(shown.includes('not independent factual verification'));
});

test('comparison history labels aggregate records versus verified responses without attributing their cost to manual edits',()=>{
 const costs=[9865,10053,13050,14255,15445,30528],value={...contributions,unattributed_calls:2,private_comparisons:{notice:'Already included in overall usage and budget totals. Do not add these estimates again.',aggregate_ledger_records:2,verified_stage_responses:12,estimated_microdollars:178520,known_verified_estimate_microdollars:178520,unassigned_event_records:0,runs:[{run_id:'blocked-predecessor',status:'blocked',verification:'verified',model:'gpt-6.1-sol',estimated_microdollars:85324,recorded_stage_events:6,aggregate_ledger_records:1,unresolved_reserved_microdollars:0,stages:[]},{run_id:'corrected-comparison',status:'completed_requires_review',verification:'verified',model:'gpt-6.1-sol',estimated_microdollars:93196,recorded_stage_events:6,aggregate_ledger_records:1,unresolved_reserved_microdollars:0,stages:costs.map((cost,i)=>({role:['Harvester','Story Miner','Strategist','Writer','Platform Adapter','Critic'][i],estimated_microdollars:cost,input_tokens:100,output_tokens:100}))}]}};
 const tree=exports.default({contributions:value}),shown=text(tree).replace(/\s+/g,' ');
 for(const phrase of ['2 ledger record(s)','12 verified stage response(s)','$0.178520','$0.093196','$0.014255','Blocked predecessor output is not adoptable','Spending history only','Original-run / agent-revision usage history only','Excludes private comparisons; not the cost of the current artifact or manual edits','Manual editor change, not an agent run','Do not add these estimates again'])assert(shown.includes(phrase),phrase);
 assert.equal(shown.split('$0.178520').length-1,1);assert(!shown.includes('2 call(s) have no reliable stage attribution'));assert.equal(nodes(tree).filter(n=>['button','input','textarea'].includes(n.type)).length,0);
 const uncertain=structuredClone(value) as any;uncertain.private_comparisons.estimated_microdollars=null;uncertain.private_comparisons.runs[1]={...uncertain.private_comparisons.runs[1],verification:'uncertain',estimated_microdollars:null,unresolved_reserved_microdollars:764676,stages:[]};
 const unknown=text(exports.default({contributions:uncertain})).replace(/\s+/g,' ');assert(unknown.includes('Combined verified estimate: unknown'));assert(unknown.includes('Stage and aggregate costs are unknown, not zero'));assert(unknown.includes('$0.764676'));assert(!unknown.includes('$0.093196'));
});
