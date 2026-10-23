import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";

const require=createRequire(import.meta.url);
type Node={type:any;key?:string;props:Record<string,any>};
// As in publication-controls.test.ts, exercise real component handlers with
// isolated hooks and mocked actions. No browser, server or provider is called.
function ui(file:string,fetcher?:(path:string,init?:RequestInit)=>Promise<unknown>){
 const values:any[]=[],effects:(()=>void)[]=[],timeouts:number[]=[];let cursor=0;
 const hooks={
  useState:(initial:any)=>{const index=cursor++;if(!(index in values))values[index]=typeof initial==="function"?initial():initial;return [values[index],(next:any)=>{values[index]=typeof next==="function"?next(values[index]):next;}];},
  useRef:(initial:any)=>{const index=cursor++;return values[index]??={current:initial};},
  useEffect:(effect:()=>void)=>effects.push(effect)
 };
 const output=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports:Record<string,any>={};
 const mockRequire=(name:string)=>name==="react"?hooks:name==="react/jsx-runtime"?require(name):name.endsWith("/execution-readiness")?{executionReadiness:()=>({})}:{__esModule:true,default:()=>null};
 new Function("require","exports","window","fetch","AbortSignal",output)(mockRequire,exports,{location:{search:""}},fetcher|| (async()=>assert.fail("Unexpected request")),{timeout:(ms:number)=>{timeouts.push(ms);return new AbortController().signal;}});
 return {exports,values,effects,timeouts,reset:()=>{values.length=0;effects.length=0;},render:(component:any,props:Record<string,any>={})=>{cursor=0;return component(props) as Node;}};
}
function nodes(node:any):Node[]{
 if(Array.isArray(node))return node.flatMap(nodes);
 if(!node||typeof node!=="object"||!node.props)return [];
 return [node,...nodes(node.props.children)];
}
function text(node:any):string{
 if(Array.isArray(node))return node.map(text).join("");
 if(node&&typeof node==="object")return text(node.props?.children);
 return typeof node==="string"||typeof node==="number"?String(node):"";
}
const runLabel="Run this exact draft once · max $0.13";
function button(tree:Node){const found=nodes(tree).find(n=>n.type==="button"&&text(n)===runLabel);assert.ok(found,"Missing exact-draft action");return found;}
function checkbox(tree:Node){const found=nodes(tree).find(n=>n.type==="input"&&n.props.type==="checkbox");assert.ok(found,"Missing deliberate acknowledgement");return found;}
const task={platform_policy_hash:"a".repeat(64),id:"00000000-0000-4000-8000-000000000001",source_id:"00000000-0000-4000-8000-000000000002",source_hash:"a".repeat(64),status:"queued",checkpoint:0,origin_key:"manual",revision_parent_task_id:null,updated:"2026-10-23T12:00:00.000Z"};
const source={id:task.source_id,hash:task.source_hash,text:"I tested one cleared workflow and reviewed the result.",cleared:true,clearance_id:"00000000-0000-4000-8000-000000000003",revoked_at:null};
const execution={runtime_ready:true,config_hash:"b".repeat(64),model:"isolated-model",runs:[]};
const props={task,source,execution,generationEnabled:true,busy:false};
function draftUi(action:(path:string,body:any)=>Promise<boolean>,initial:Record<string,any>={}){
 const harness=ui("../app/owner-draft-control.tsx");let current={...props,action,...initial},key:string|undefined;
 const render=(patch:Record<string,any>={})=>{
  current={...current,...patch};const child=harness.render(harness.exports.default,current);
  // React remounts the inner component when the exact consent binding changes.
  if(child.key!==key){harness.reset();key=child.key;}
  return harness.render(child.type,child.props);
 };
 return {...harness,render,key:()=>key};
}
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));};

test("owner draft requires unchecked deliberate consent and sends one exact task/source/clearance/runtime binding",async()=>{
 const calls:{path:string;body:any}[]=[];let finish!:(ok:boolean)=>void;
 const harness=draftUi(async(path,body)=>{calls.push({path,body});return new Promise<boolean>(resolve=>{finish=resolve;});});
 let tree=harness.render();assert.equal(checkbox(tree).props.checked,false);assert.equal(button(tree).props.disabled,true);
 assert.match(text(tree),/No scheduler or other queued task is invoked/);assert.match(text(tree),/six OpenAI calls/);assert.match(text(tree),/does not publish anything/);
 for(const exact of [task.id,source.id,source.hash,source.clearance_id,source.text,execution.model])assert.ok(text(tree).includes(exact),"Exact binding must be visible: "+exact);
 button(tree).props.onClick();assert.equal(calls.length,0);
 checkbox(tree).props.onChange({target:{checked:true}});tree=harness.render();assert.equal(button(tree).props.disabled,false);
 const click=button(tree).props.onClick;click();click();
 assert.deepEqual(calls,[{path:"owner-draft-run",body:{task_id:task.id,expected_source_id:source.id,expected_source_hash:source.hash,expected_clearance_id:source.clearance_id,expected_updated:task.updated,expected_checkpoint:0,expected_config_hash:execution.config_hash,expected_platform_policy_hash:task.platform_policy_hash,acknowledged:true}}]);
 assert.equal(checkbox(harness.render()).props.checked,false);assert.equal(button(harness.render()).props.disabled,true);
 // Page reports a failed network response as false. That cannot unlock a retry.
 finish(false);await settle();tree=harness.render();assert.equal(button(tree).props.disabled,true);assert.equal(checkbox(tree).props.disabled,true);
 checkbox(tree).props.onChange({target:{checked:true}});button(harness.render()).props.onClick();assert.equal(calls.length,1);
 assert.match(text(tree),/do not retry if the response is interrupted/);
});

test("rerendering a changed clearance, source, task or runtime clears prior consent",()=>{
 const patches=[
  {source:{...source,clearance_id:"00000000-0000-4000-8000-000000000004"}},
  {source:{...source,id:"00000000-0000-4000-8000-000000000005"}},
  {source:{...source,hash:"c".repeat(64)}},
  {source:{...source,cleared:false}},
  {source:{...source,revoked_at:"2026-10-23T12:01:00.000Z"}},
  {task:{...task,id:"00000000-0000-4000-8000-000000000006"}},
  {task:{...task,updated:"2026-10-23T12:02:00.000Z"}},
  {task:{...task,platform_policy_hash:"f".repeat(64)}},
  {execution:{...execution,config_hash:"d".repeat(64)}}
 ];
 for(const patch of patches){
  const harness=draftUi(async()=>assert.fail("Changed consent must not execute"));checkbox(harness.render()).props.onChange({target:{checked:true}});
  assert.equal(button(harness.render()).props.disabled,false);const before=harness.key();const next=harness.render(patch);
  assert.notEqual(harness.key(),before);assert.equal(checkbox(next).props.checked,false);assert.equal(button(next).props.disabled,true);button(next).props.onClick();
 }
});

test("wrong source, disabled runtime/drafting, busy and previously attempted tasks cannot execute",()=>{
 for(const patch of [
  {source:undefined},{source:{...source,hash:"e".repeat(64)}},{source:{...source,cleared:false}},
  {source:{...source,clearance_id:null}},{source:{...source,revoked_at:"2026-10-23T12:01:00.000Z"}},
  {task:{...task,platform_policy_hash:undefined}},{execution:{...execution,runtime_ready:false}},{generationEnabled:false},{busy:true}
 ]){
  const harness=draftUi(async()=>assert.fail("Ineligible selection must not execute"),patch);const first=harness.render();
  assert.equal(checkbox(first).props.disabled,true);checkbox(first).props.onChange({target:{checked:true}});const tree=harness.render();assert.equal(button(tree).props.disabled,true);button(tree).props.onClick();
 }
 for(const status of ["running","review","blocked","uncertain","duplicate"]){
  const harness=draftUi(async()=>assert.fail("Existing attempt must not execute"),{execution:{...execution,runs:[{task_id:task.id,status,steps:2}]}});
  const tree=harness.render();assert.equal(nodes(tree).some(n=>n.type==="button"),false);assert.match(text(tree),/one-shot attempt cannot be replayed/);assert.ok(text(tree).includes(status));
 }
});

test("non-manual, revision, nonzero-checkpoint and nonqueued tasks do not offer an execution action",()=>{
 for(const patch of [{origin_key:"calendar:entry"},{revision_parent_task_id:"parent"},{checkpoint:1},{status:"running"},{status:"review"},{status:"blocked"},{status:"approved"},{status:"cancelled"}]){
  const harness=draftUi(async()=>assert.fail("Wrong task kind must not execute"),{task:{...task,...patch}});assert.equal(harness.render(),null);
 }
 const otherRun=draftUi(async()=>true,{execution:{...execution,runs:[{task_id:"another-task",status:"review",steps:6}]}});
 assert.ok(button(otherRun.render()),"An unrelated completed run must not select or replace this task");
});

function pageActionHarness(fetcher:(path:string,init?:RequestInit)=>Promise<unknown>){
 const harness=ui("../app/page.tsx",fetcher);harness.render(harness.exports.default);harness.values[0]=true;
 harness.values[2]={updated:task.updated,budget:{committed_microdollars:0,warning:false},analyst:{status:"insufficient-data"},blockers:[],sources:[source],tasks:[task],outputs:[],reviews:[],events:[],ledger:[],calendar:{settings:{generation_enabled:true}},hosted:{daily_batches:[]},owner_draft:execution};
 const tree=harness.render(harness.exports.default),control=nodes(tree).find(n=>n.props.task===task&&n.props.execution===execution);assert.ok(control,"Hosted exact-draft control must receive Page action");
 assert.equal(control.props.source,source);assert.equal(control.props.generationEnabled,true);
 return {...harness,action:control.props.action as (path:string,body:unknown)=>Promise<boolean>};
}

test("Page owner draft deadline exceeds the 300s route and blocks concurrent POSTs",async()=>{
 const calls:{path:string;init?:RequestInit}[]=[];let resolve!:(response:Response)=>void;
 const harness=pageActionHarness(async(path,init)=>{calls.push({path,init});if(path.endsWith("/owner-draft-run"))return new Promise<Response>(done=>{resolve=done;});return Response.json({owner_draft:{runs:[{task_id:task.id,status:"review"}]}});});
 const body={task_id:task.id};const pending=harness.action("owner-draft-run",body);
 assert.deepEqual(harness.timeouts,[320_000]);const route=readFileSync(new URL("../app/api/studio/[action]/route.ts",import.meta.url),"utf8");assert.match(route,/maxDuration=300/);assert.ok(harness.timeouts[0]>300_000);
 assert.equal(await harness.action("owner-draft-run",{task_id:"another-task"}),false);assert.equal(calls.length,1);
 assert.equal(calls[0].init?.method,"POST");assert.equal(calls[0].init?.credentials,"same-origin");assert.deepEqual(JSON.parse(String(calls[0].init?.body)),body);
 resolve(Response.json({result:{status:"review"}}));assert.equal(await pending,true);
 assert.deepEqual(calls.map(call=>[call.path,call.init?.method]),[["/api/studio/owner-draft-run","POST"],["/api/studio/state","GET"]]);assert.deepEqual(harness.timeouts,[320_000,10_000]);
});

test("Page network loss refreshes durable owner run via GET without retrying or enqueueing",async()=>{
 const calls:{path:string;method:string|undefined}[]=[],state={owner_draft:{runs:[{task_id:task.id,status:"uncertain",steps:null}]}};
 const harness=pageActionHarness(async(path,init)=>{calls.push({path,method:init?.method});if(path.endsWith("/owner-draft-run"))throw new TypeError("Failed to fetch");return Response.json(state);});
 assert.equal(await harness.action("owner-draft-run",{task_id:task.id}),false);
 assert.deepEqual(calls,[{path:"/api/studio/owner-draft-run",method:"POST"},{path:"/api/studio/state",method:"GET"}]);
 assert.match(harness.values[8],/outcome is not confirmed/);assert.match(harness.values[8],/server may still be working/);assert.match(harness.values[8],/do not retry or enqueue a replacement/);
 assert.deepEqual(harness.values[2],state);assert.equal(harness.values[6],"Check saved draft run status and usage");
});

test("Page preserves server uncertainty when durable-state refresh also fails",async()=>{
 const calls:{path:string;method:string|undefined}[]=[];
 const harness=pageActionHarness(async(path,init)=>{calls.push({path,method:init?.method});if(path.endsWith("/owner-draft-run"))return Response.json({error:"Draft execution outcome uncertain. Check saved run and ledger; do not retry.",result:{status:"uncertain"}},{status:409});throw Error("Status unavailable");});
 assert.equal(await harness.action("owner-draft-run",{task_id:task.id}),false);
 assert.deepEqual(calls,[{path:"/api/studio/owner-draft-run",method:"POST"},{path:"/api/studio/state",method:"GET"}]);assert.match(harness.values[8],/outcome uncertain/);assert.match(harness.values[8],/do not retry/);assert.match(harness.values[6],/previous state may be stale/);
});
