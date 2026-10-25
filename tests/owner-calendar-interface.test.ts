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
const taskId="00000000-0000-4000-8000-000000000001";
const preview={task_id:taskId,mode:"initial",version:"a".repeat(64),source:{id:"source-id",hash:"b".repeat(64),text:"An exact permitted progress note."},model:"mock-model",entry_id:"entry-id",policy_id:"policy-id",grant_id:"grant-id",generation_due:"2026-10-24T00:00:00Z",review_due:"2026-10-27T00:00:00Z",intended_post:"2026-10-29T00:00:00Z",parent_id:null,parent_token:null,feedback:null};
const execution={runtime_ready:true,previews:[preview],runs:[]};
const label="Run this Calendar draft once · max $0.13";
const checkbox=(tree:Node)=>{const n=nodes(tree).find(n=>n.type==="input"&&n.props.type==="checkbox");assert.ok(n);return n;};
const button=(tree:Node)=>{const n=nodes(tree).find(n=>n.type==="button"&&text(n)===label);assert.ok(n);return n;};
function calendarUi(action:(path:string,body:any)=>Promise<boolean>,initial:Record<string,any>={}){
 const h=ui("../app/owner-calendar-control.tsx");let props={taskId,execution,busy:false,action,...initial},key:string|undefined;
 return {...h,render:(patch:Record<string,any>={})=>{props={...props,...patch};const child=h.render(h.exports.default,props);if(child.key!==key){h.reset();key=child.key;}return h.render(child.type,child.props);}};
}
test("exact Calendar preview is visible, deliberately unchecked, and double click/interrupted response never retries",async()=>{
 const calls:any[]=[];let finish!:(ok:boolean)=>void;const h=calendarUi(async(path,body)=>{calls.push({path,body});return new Promise<boolean>(r=>finish=r);});let tree=h.render();
 assert.equal(checkbox(tree).props.checked,false);assert.equal(button(tree).props.disabled,true);button(tree).props.onClick();assert.equal(calls.length,0);
 for(const item of [taskId,preview.source.id,preview.source.hash,preview.source.text,preview.policy_id,preview.grant_id,preview.generation_due,preview.review_due,preview.intended_post,preview.model])assert(text(tree).includes(item));
 assert.match(text(tree),/No source selection, schedule changes, daily-batch reset, retries, approval or publishing/);
 checkbox(tree).props.onChange({target:{checked:true}});tree=h.render();const click=button(tree).props.onClick;click();click();assert.deepEqual(calls,[{path:"owner-calendar-run",body:{task_id:taskId,expected_preview:preview.version,acknowledged:true}}]);
 finish(false);await new Promise(r=>setImmediate(r));tree=h.render();assert(button(tree).props.disabled);checkbox(tree).props.onChange({target:{checked:true}});button(h.render()).props.onClick();assert.equal(calls.length,1);assert.match(text(tree),/do not retry if the response is interrupted/);
});
test("fresh preview or runtime binding resets acknowledgement; ineligible/missing previews and existing runs cannot execute",()=>{
 const h=calendarUi(async()=>assert.fail("No call"));checkbox(h.render()).props.onChange({target:{checked:true}});assert.equal(button(h.render()).props.disabled,false);
 const changed=h.render({execution:{...execution,previews:[{...preview,version:"c".repeat(64),source:{...preview.source,text:"Changed exact note."}}]}});assert.equal(checkbox(changed).props.checked,false);assert(button(changed).props.disabled);
 for(const initial of [{execution:{...execution,previews:[]}},{taskId:"other-id"}])assert.equal(calendarUi(async()=>assert.fail("No call"),initial).render(),null);
 for(const initial of [{busy:true},{execution:{...execution,runtime_ready:false}}]){const x=calendarUi(async()=>assert.fail("No call"),initial);let t=x.render();checkbox(t).props.onChange({target:{checked:true}});t=x.render();assert(button(t).props.disabled);button(t).props.onClick();}
 for(const status of ["running","review","blocked","uncertain"]){const t=calendarUi(async()=>assert.fail("No call"),{execution:{...execution,runs:[{task_id:taskId,status,steps:3}]}}).render();assert(!nodes(t).some(n=>n.type==="button"));assert.match(text(t),/one-shot attempt cannot be replayed/);}
});
test("revision preview shows exact parent/base and feedback, not an initial or arbitrary queue action",()=>{
 const p={...preview,mode:"revision",parent_id:"parent-id",parent_token:"original:exact-base",feedback:"Keep only attributed facts."};const tree=calendarUi(async()=>true,{execution:{...execution,previews:[p]}}).render();
 for(const value of [p.parent_id,p.parent_token,p.feedback])assert(text(tree).includes(value));assert.match(text(tree),/current parent content stays unchanged/);assert.match(text(tree),/Fresh approval is required/);
});
function pageHarness(fetcher:(path:string,init?:RequestInit)=>Promise<unknown>){
 const h=ui("../app/page.tsx",fetcher);h.render(h.exports.default);h.values[0]=true;const task={id:taskId,source_id:preview.source.id,status:"queued",checkpoint:0,updated:"2026-10-25T00:00:00Z"};
 h.values[2]={updated:task.updated,budget:{committed_microdollars:0,warning:false},analyst:{status:"insufficient-data"},blockers:[],sources:[],tasks:[task],outputs:[],reviews:[],events:[],ledger:[],calendar:{settings:{generation_enabled:true}},hosted:{daily_batches:[]},owner_calendar:execution};
 const tree=h.render(h.exports.default),control=nodes(tree).find(n=>n.props.taskId===taskId&&n.props.execution===execution);assert.ok(control);return {...h,action:control.props.action as (path:string,body:unknown)=>Promise<boolean>};
}
test("Page uses long request timeout, blocks concurrent POST and refreshes durable state without retry after network loss",async()=>{
 const calls:any[]=[],state={owner_calendar:{runs:[{task_id:taskId,status:"uncertain"}]}};let release!:(r:Response)=>void;
 const h=pageHarness(async(path,init)=>{calls.push([path,init?.method]);if(path.endsWith('/owner-calendar-run'))return new Promise<Response>(r=>release=r);return Response.json(state);});
 const pending=h.action("owner-calendar-run",{task_id:taskId});assert.deepEqual(h.timeouts,[320000]);assert.equal(await h.action("owner-calendar-run",{task_id:"other"}),false);assert.equal(calls.length,1);release(Response.json({error:"Calendar draft outcome uncertain. Check saved run and ledger; do not retry."},{status:409}));assert.equal(await pending,false);
 assert.deepEqual(calls,[["/api/studio/owner-calendar-run","POST"],["/api/studio/state","GET"]]);assert.match(h.values[8],/do not retry/);assert.deepEqual(h.values[2],state);
 const interrupted:any[]=[];const h2=pageHarness(async(path,init)=>{interrupted.push([path,init?.method]);if(path.endsWith('/owner-calendar-run'))throw Error("Network lost");return Response.json(state);});assert.equal(await h2.action("owner-calendar-run",{task_id:taskId}),false);assert.equal(interrupted.length,2);assert.match(h2.values[8],/do not retry or enqueue a replacement/);
});
