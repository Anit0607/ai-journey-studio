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
