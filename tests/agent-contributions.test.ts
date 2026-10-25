import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentContributions} from '../lib/agent-contributions';
import {draftPromptMetadata,DRAFT_PROMPT_PREPARED,DRAFT_OUTPUT_RECORDED} from '../lib/draft-run-receipt';
import {buildDraftPrompt} from '../lib/draft-prompt';
import {hash,ROLES,type Task,type Source} from '../lib/domain';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
const source={id:randomUUID(),text:'I asked the agent to list the background timers.',hash:hash('I asked the agent to list the background timers.'),cleared:true,category:'project-note',reported_date:'2026-10-25'} as Source;
const task={id:randomUUID(),source_id:source.id,source_hash:source.hash,status:'review',checkpoint:6,lease_token:null,lease_until:null,updated:'2026-10-25T00:01:00Z',content_brief:{platforms:['LinkedIn'],platform_policy:NEW_PLATFORM_POLICY}} as Task;
const outputs=ROLES.map((role,i)=>({id:randomUUID(),task_id:task.id,role,text:'Saved '+role,hash:hash('Saved '+role),created:new Date(Date.UTC(2026,9,25,0,0,i+2)).toISOString()}));
const ledger=ROLES.map((role,i)=>({id:randomUUID(),task_id:task.id,role,checkpoint:i,status:'settled',completion_status:'complete',provider:'openai',model:'fixture',estimated:10,input_tokens:20,output_tokens:30,reserved:100,created:new Date(Date.UTC(2026,9,25,0,0,i)).toISOString()}));
const bundle=outputs.map(({role,text,hash})=>({role,text,hash}));
const project=(history:any[]=[],current=bundle,rows:any[]=ledger,events:any[]=[],tasks:any[]=[task],saved:any[]=outputs)=>agentContributions(task,tasks,saved,rows,events,history,current);
test('six actual outputs and stage accounting are separate from role responsibilities and quality',()=>{
 const result=project();assert.equal(result.roles.length,6);
 for(const item of result.roles){assert.equal(item.usage.attempts,1);assert.equal(item.current_origin.kind,'saved_original');assert.equal(item.runs[0].elapsed_ms,2000);assert.equal(item.runs[0].attempts[0].receipt_state,'not_recorded');assert.equal(item.runs[0].attempts[0].prepared,null);}
 assert.match(result.notice,/not evaluations/);assert.match(result.notice,/No style score, factual pass or publication approval/);
});
test('manual edits stay manual, unchanged cloned roles keep their provenance, and returning to old model text is still a manual edit',()=>{
 const changed=bundle.map(a=>a.role==='Writer'?{...a,text:'Manual replacement',hash:hash('Manual replacement')}:a);
 const one={id:randomUUID(),sequence:1,parent_id:null,bundle:changed,created:'2026-10-25T01:00:00Z'},copy={id:randomUUID(),sequence:2,parent_id:one.id,bundle:changed,created:'2026-10-25T01:01:00Z'};
 let result=project([one,copy],changed);assert.equal(result.roles[3].current_origin.kind,'manual_edit');assert.equal(result.roles[3].current_origin.revision_id,one.id);assert.equal(result.roles[0].current_origin.kind,'saved_original');assert.equal(result.roles[3].usage.attempts,1);
 result=project([one,copy,{id:randomUUID(),sequence:3,parent_id:copy.id,bundle,created:'2026-10-25T01:02:00Z'}]);assert.equal(result.roles[3].current_origin.kind,'manual_edit');
});
test('agent revision attribution needs the exact linked child output; unrelated jobs and corrupted current text are never credited',()=>{
 const child={...task,id:randomUUID(),revision_parent_task_id:task.id},saved=outputs.map(o=>({...o,id:randomUUID(),task_id:child.id}));
 const revision={id:randomUUID(),sequence:1,parent_id:null,agent_task_id:child.id,bundle,created:'2026-10-25T01:00:00Z'};
 assert(project([revision],bundle,ledger,[],[task,child],[...outputs,...saved]).roles.every(r=>r.current_origin.kind==='agent_revision'));
 assert(project([revision]).roles.every(r=>r.current_origin.kind==='unknown'));
 const corrupted=bundle.map(a=>a.role==='Writer'?{...a,text:'tampered'}:a);assert.equal(project([],corrupted).roles[3].current_origin.kind,'unknown');
});
test('missing or malformed accounting stays unknown, and ambiguous timing never becomes model latency',()=>{
 let r=project([],bundle,[]).roles[0];assert.equal(r.usage.estimated_microdollars,null);assert.equal(r.usage.input_tokens,null);assert.equal(r.usage.output_tokens,null);assert.equal(r.usage.unresolved_reserved_microdollars,null);assert.equal(r.runs[0].elapsed_ms,null);
 for(const value of [null,[],false,{},'not a number']){r=project([],bundle,[{...ledger[0],status:'unknown',estimated:value,reserved:value,input_tokens:value,output_tokens:value}]).roles[0];assert.equal(r.usage.estimated_microdollars,null);assert.equal(r.usage.input_tokens,null);assert.equal(r.usage.unresolved_reserved_microdollars,null);}
 assert.equal(project([],bundle,[...ledger,{...ledger[0],id:randomUUID()}]).roles[0].runs[0].elapsed_ms,null);
 const times=ledger.map((r,i)=>i===0?{...r,created:new Date('2026-10-25T00:00:00.123Z')}:r),saved=outputs.map((o,i)=>i===0?{...o,created:new Date('2026-10-25T00:00:04.921Z')}:o);
 assert.equal(project([],bundle,times,[],[task],saved).roles[0].runs[0].elapsed_ms,4798);
});
test('prepared style receipts are not retroactive transmission claims; exact completed output linkage is required',()=>{
 const t={...task,checkpoint:3},prompt=buildDraftPrompt(t,source,bundle.slice(0,3)),meta=draftPromptMetadata(t,source,bundle.slice(0,3),prompt),row=ledger[3];
 const prepared={task_id:task.id,kind:DRAFT_PROMPT_PREPARED,detail:JSON.stringify({reservation_id:row.id,...meta})};
 let result=project([],bundle,ledger,[prepared]).roles[3].runs[0].attempts[0];assert.equal(result.receipt_state,'prepared_not_proof_of_transmission');assert.equal(result.prepared.prompt_hash,hash(prompt));
 const saved={task_id:task.id,kind:DRAFT_OUTPUT_RECORDED,detail:JSON.stringify({schema:1,reservation_id:row.id,checkpoint:3,role:'Writer',artifact_hash:bundle[3].hash})};
 result=project([],bundle,ledger,[prepared,saved]).roles[3].runs[0].attempts[0];assert.equal(result.receipt_state,'saved_output_recorded');
 for(const bad of [{...prepared,detail:JSON.stringify({...meta,reservation_id:[row.id]})},{...prepared,detail:prepared.detail.replace('{','{"schema":0,')},{...prepared,task_id:randomUUID()}])assert.equal(project([],bundle,ledger,[bad,saved]).roles[3].runs[0].attempts[0].prepared,null);
 assert.equal(project([],bundle,ledger,[prepared,prepared,saved]).roles[3].runs[0].attempts[0].prepared,null);
});
