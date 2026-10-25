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
const entryId='00000000-0000-4000-8000-000000000001',preview={eligible:true,expected_preview:'a'.repeat(64),notice:'Make generation due at the real server time when saved. No model call or publication.'};
const label='Make this draft due now · no model call';
const checkbox=(tree:Node)=>{const item=nodes(tree).find(n=>n.type==='input');assert(item);return item;};
const button=(tree:Node)=>{const item=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert(item);return item;};
function form(action:(path:string,body:any)=>Promise<void>){const h=ui('../app/calendar-generation-form.tsx');let props={entryId,preview,busy:false,action},key:string|undefined;return {...h,render:(patch:any={})=>{props={...props,...patch};const child=h.render(h.exports.default,props);if(child.key!==key){h.reset();key=child.key;}return h.render(child.type,child.props);}};}
test('timing form is unchecked, sends only exact server-now request and prevents repeated/uncertain submission',async()=>{
 const calls:any[]=[];let finish!:()=>void;const h=form(async(path,body)=>{calls.push({path,body});await new Promise<void>(resolve=>finish=resolve);});let tree=h.render();
 assert.equal(checkbox(tree).props.checked,false);assert(button(tree).props.disabled);button(tree).props.onClick();assert.equal(calls.length,0);
 assert.match(text(tree),/not a claim that you personally reviewed a source/);assert.match(text(tree),/Keep its posting and review times unchanged/i);
 checkbox(tree).props.onChange({target:{checked:true}});tree=h.render();const click=button(tree).props.onClick;click();click();assert.deepEqual(calls,[{path:'calendar-generation-now',body:{entry_id:entryId,expected_preview:preview.expected_preview,requested_generation_time:'server_now',acknowledged:true}}]);
 finish();await new Promise(resolve=>setImmediate(resolve));tree=h.render();assert(button(tree).props.disabled);assert.match(text(tree),/uncertain response/);checkbox(tree).props.onChange({target:{checked:true}});button(h.render()).props.onClick();assert.equal(calls.length,1);
});
test('changed preview remount clears acknowledgement, absent eligibility hides action, busy never writes',()=>{
 const h=form(async()=>assert.fail('No action'));checkbox(h.render()).props.onChange({target:{checked:true}});assert.equal(button(h.render()).props.disabled,false);
 let tree=h.render({preview:{...preview,expected_preview:'b'.repeat(64)}});assert.equal(checkbox(tree).props.checked,false);assert(button(tree).props.disabled);
 assert.equal(h.render({preview:{...preview,eligible:false}}),null);assert.equal(h.render({preview:null}),null);
 tree=h.render({preview,busy:true});checkbox(tree).props.onChange({target:{checked:true}});tree=h.render();assert(button(tree).props.disabled);button(tree).props.onClick();
});
