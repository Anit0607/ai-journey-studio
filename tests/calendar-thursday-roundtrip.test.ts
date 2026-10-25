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
 const mockRequire=(name:string)=>name==="../lib/schedule-presets"?require("../lib/schedule-presets"):name==="react"?hooks:name==="react/jsx-runtime"?require(name):name.endsWith("/execution-readiness")?{executionReadiness:()=>({})}:{__esModule:true,default:()=>null};
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

import {embedded} from "../lib/db";
import {Calendar} from "../lib/calendar";
import {BENCHMARK_PRESET} from "../lib/schedule-presets";
test("adding Thursday through the actual Calendar handlers preserves its time in the request and database",async()=>{
 const db=await embedded();try{
 const initial={start_date:"2026-10-26",post_time:null,short_days:[1,3,5],long_day:0,generation_lead_hours:120,timing_mode:"per_platform" as const,platform_times:{LinkedIn:{...BENCHMARK_PRESET.times.LinkedIn}},timing_basis:BENCHMARK_PRESET.id,generation_enabled:true};
 const calendar=new Calendar(db,120);await calendar.configure(initial);
 const h=ui("../app/calendar-panel.tsx");let body:any;
 const props={calendar:{settings:await calendar.settings(),entries:[],minimum_generation_lead_hours:120,configuration_needed:false},sources:[],tasks:[],busy:false,action:async(path:string,input:any)=>{assert.equal(path,"calendar-configure");body=input;await calendar.configure(input);}};
 const render=()=>h.render(h.exports.default,props);
 let tree=render();const thursday=nodes(tree).find(n=>n.type==="label"&&text(n)==="Thursday")!;assert.ok(thursday);nodes(thursday).find(n=>n.type==="input")!.props.onChange({target:{checked:true}});
 tree=render();const input=nodes(tree).find(n=>n.props["aria-label"]==="LinkedIn Thursday time IST")!;assert.ok(input);input.props.onChange({target:{value:"16:00"}});
 tree=render();assert.match(text(tree),/Timing basis: Custom \/ unset/);assert.equal(nodes(tree).find(n=>n.props["aria-label"]==="LinkedIn Thursday time IST")!.props.value,"16:00");
 nodes(tree).find(n=>n.type==="button"&&text(n)==="Save calendar settings")!.props.onClick();await new Promise(r=>setTimeout(r,50));
 assert.equal(body.platform_times.LinkedIn[4],"16:00");assert.equal(body.timing_basis,"custom");const saved=await calendar.settings();assert.equal(saved.platform_times.LinkedIn[4],"16:00");assert.deepEqual(saved.short_days,[1,3,5,4]);
 await calendar.plan(1);const entry=(await db.query<any>("SELECT * FROM calendar_entries WHERE planned_date='2026-10-29'"))[0];assert.ok(entry);assert.equal(new Date(entry.intended_post).toISOString(),"2026-10-29T10:30:00.000Z");assert.equal(new Date(entry.review_due).toISOString(),"2026-10-27T10:30:00.000Z");assert.equal(new Date(entry.generation_due).toISOString(),"2026-10-24T10:30:00.000Z");
 }finally{await db.close();}
});
