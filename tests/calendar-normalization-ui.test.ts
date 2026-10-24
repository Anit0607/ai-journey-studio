import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import ts from "typescript";
import {NORMALIZATION_ACK,NORMALIZATION_IDS,NORMALIZATION_EVENT,type LegacyNormalizationPreview} from "../lib/calendar-legacy-normalization";
const require=createRequire(import.meta.url),STORAGE="calendar-legacy-normalization-pending-v1",auditId="11111111-2222-4333-8444-555555555555";
const canonical=(value:any):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const fullRow=(change:any,side:"before"|"after")=>({id:change.id,kind:change.kind,planned_date:change.planned_date,source_id:null,task_id:null,updated:side==="before"?"2026-10-23T02:47:37.846123Z":"2026-10-24T19:00:00.123456Z",...change[side]});
const cases=[["e15dbb66-c3f9-4141-8b94-544e14349b46","2026-11-02","03:30","16:30"],["c2aed4a0-1257-4faa-ac59-090e5d838a28","2026-11-04","04:30","10:30"],["b57e284f-ffc5-4162-9b9d-8398b554eb39","2026-11-06","03:30","09:30"],["183af62f-c135-474b-b6d6-0fe77dc24c4e","2026-11-08","03:30","16:30"]];
const shift=(post:string,hours:number)=>new Date(Date.parse(post)+hours*3600000).toISOString(),micro=(value:string)=>value.replace("Z","000Z"),part=(post:string)=>({intended_post:post,draft_due:shift(post,-48),review_due:shift(post,-48)});
function fixture():LegacyNormalizationPreview{
 const changes=cases.map(([id,date,old,li])=>{const post=date+"T"+old+":00.000Z",linkedin=part(date+"T"+li+":00.000Z"),plan=(value:string)=>({intended_post:micro(value),draft_due:micro(shift(value,-48)),review_due:micro(shift(value,-48)),generation_due:micro(shift(value,-120))});return {id,planned_date:date,kind:date==="2026-11-08"?"longform":"shortform",before:{...plan(post),platform_schedule:{LinkedIn:linkedin,X:part(post),Instagram:part(post)}},after:{...plan(linkedin.intended_post),platform_schedule:{LinkedIn:linkedin,platform_policy:{version:1,platforms:["LinkedIn"]}}}};}).sort((a,b)=>a.id.localeCompare(b.id));
 return {schema:1,settings_hash:"a".repeat(64),settings:{generation_enabled:false,generation_lead_hours:120},entries:changes.map(change=>({id:change.id,row_hash:createHash("sha256").update(canonical(fullRow(change,"before"))).digest("hex"),updated:"2026-10-23T02:47:37.846123Z"})),changes,preview_fingerprint:"c".repeat(64),acknowledgement:NORMALIZATION_ACK,paid_execution:false};
}
function state(preview:LegacyNormalizationPreview){return {events:[{id:auditId,kind:NORMALIZATION_EVENT,detail:canonical({schema:1,settings_hash:preview.settings_hash,entries:preview.entries,preview_fingerprint:preview.preview_fingerprint,acknowledgement:preview.acknowledgement,changes:preview.changes,before:preview.changes.map(c=>fullRow(c,"before")),after:preview.changes.map(c=>fullRow(c,"after"))})}]};}
const success=(p:LegacyNormalizationPreview)=>Response.json({result:{status:"applied",audit_id:auditId,preview_fingerprint:p.preview_fingerprint,changes:p.changes,paid_execution:false}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetcher:typeof fetch,storage=new Map<string,string>()){
 const values:any[]=[];let cursor=0,cleanup:(()=>void)|undefined,effect:(()=>void)|undefined;
 const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(next:any)=>{values[i]=typeof next==="function"?next(values[i]):next;}];},useRef:(initial:any)=>{const i=cursor++;return values[i]??={current:initial};},useEffect:(run:()=>any)=>{if(!effect)effect=()=>{cleanup=run();};}};
 const source=readFileSync(new URL("../app/calendar-normalization-form.tsx",import.meta.url),"utf8"),output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports:any={};
 const sessionStorage={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>{storage.delete(key);}};
 new Function("require","exports","fetch","AbortSignal","sessionStorage",output)((name:string)=>name==="react"?hooks:require(name),exports,fetcher,{timeout:()=>new AbortController().signal},sessionStorage);
 let props={busy:false,snapshot:"original"},tree:any;
 const render=()=>{cursor=0;tree=exports.default(props);return tree;};render();effect!();render();
 const settle=async()=>{const deadline=Date.now()+3000;await flush();while(values[3]){assert(Date.now()<deadline,"UI request did not settle");await new Promise(resolve=>setTimeout(resolve,5));}render();};
 const h={storage,sessionStorage,render,settle,unmount:()=>cleanup?.(),update:(next:Partial<typeof props>)=>{props={...props,...next};return render();},text:()=>text(tree),nodes:()=>nodes(tree),button:(name:string)=>nodes(tree).find(n=>n.type==="button"&&text(n)===name),checkbox:()=>nodes(tree).find(n=>n.type==="input"),click:async(name:string)=>{const button=h.button(name);assert(button,"Missing button: "+name);button.props.onClick();await settle();},approve:()=>{h.checkbox().props.onChange({target:{checked:true}});render();}};
 return h;
}
function nodes(n:any):any[]{return Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(""):n?.props?text(n.props.children):typeof n==="string"?n:"";}
const ready=async(fetcher?:typeof fetch,storage?:Map<string,string>)=>{const preview=fixture(),calls:any[]=[];const h=harness(async(url,init)=>{calls.push({url,init});return fetcher?fetcher(url,init):Response.json({result:preview});},storage);await h.click("Preview four-entry repair");return {h,preview,calls};};

test("owner Calendar exposes a deliberate preview, not an automatic request, repair or post approval",()=>{
 const h=harness(async()=>assert.fail("No automatic request"));assert.equal(h.button("Preview four-entry repair").props.disabled,false);assert.equal(h.checkbox(),undefined);h.update({busy:true});assert.equal(h.button("Preview four-entry repair").props.disabled,true);h.button("Preview four-entry repair").props.onClick();
 const calendar=readFileSync(new URL("../app/calendar-panel.tsx",import.meta.url),"utf8"),page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"),source=readFileSync(new URL("../app/calendar-normalization-form.tsx",import.meta.url),"utf8");
 assert.match(calendar,/<CalendarNormalizationForm busy=/);assert.match(page,/!state\?<section className="login"/);assert.match(source,/import type \{LegacyNormalizationPreview\}/);assert.doesNotMatch(source,/<aside/);assert.doesNotMatch(calendar,/<aside/);assert.doesNotMatch(source,/from "(?:node:|.*db")/);assert.match(h.text(),/nothing is approved for publication/);
});
test("exact four-row diff and full acknowledgement precede an exact unchanged proof submission; double clicks send once",async()=>{
 const preview=fixture();let finish!:(r:Response)=>void;const {h,calls}=await ready(async(_url,init)=>JSON.parse(String(init?.body)).action==="preview"?Response.json({result:preview}):new Promise(resolve=>{finish=resolve;}));
 assert.deepEqual(preview.entries.map(e=>e.id).sort(),[...NORMALIZATION_IDS]);assert.equal(h.nodes().filter(n=>n.type==="tr").length,5);
 for(const change of preview.changes){assert(h.text().includes(change.id));for(const side of ["before","after"] as const)for(const key of ["intended_post","draft_due","review_due","generation_due"])assert(h.text().includes(change[side][key]));}
 assert(h.text().includes(NORMALIZATION_ACK));assert.equal(h.button("Apply exactly these four repairs").props.disabled,true);h.button("Apply exactly these four repairs").props.onClick();assert.equal(calls.length,1);
 h.approve();const click=h.button("Apply exactly these four repairs").props.onClick;click();click();h.render();assert.equal(calls.length,2);assert(h.storage.has(STORAGE));assert.equal(h.checkbox(),undefined);
 assert.deepEqual(JSON.parse(calls[1].init.body),{action:"commit",settings_hash:preview.settings_hash,entries:preview.entries,preview_fingerprint:preview.preview_fingerprint,acknowledged:true});assert.equal(calls[1].init.credentials,"same-origin");
 finish(success(preview));await h.settle();assert.match(h.text(),/all four entries/);assert(h.text().includes(auditId));assert(!h.storage.has(STORAGE));assert.equal(h.button("Preview four-entry repair"),undefined);
});
test("stale local snapshot disables consent and commit; Close and fresh preview reset consent",async()=>{
 const {h,calls}=await ready();h.approve();h.update({snapshot:"new"});assert.equal(h.checkbox().props.disabled,true);assert.equal(h.button("Apply exactly these four repairs").props.disabled,true);h.button("Apply exactly these four repairs").props.onClick();assert.equal(calls.length,1);assert.match(h.text(),/Calendar state changed/);
 await h.click("Request a fresh repair preview");assert.equal(h.checkbox().props.checked,false);h.approve();await h.click("Close without changes");assert.equal(h.checkbox(),undefined);await h.click("Preview four-entry repair");assert.equal(h.checkbox().props.checked,false);
});
test("stale or busy HTTP 409 clears prior proof and consent, preserves the actionable blocker and never retries",async()=>{
 for(const error of ["Stale normalization preview; inspect the exact current rows again","Calendar entries are busy; no changes were saved. Let the current operation finish, then request a fresh preview."]){
  const {h,calls}=await ready(async(_url,init)=>JSON.parse(String(init?.body)).action==="preview"?Response.json({result:fixture()}):Response.json({error},{status:409}));h.approve();await h.click("Apply exactly these four repairs");assert.equal(calls.length,2);assert(h.text().includes(error));assert.equal(h.checkbox(),undefined);assert(!h.storage.has(STORAGE));assert.equal(h.button("Preview four-entry repair").props.disabled,false);
 }
});
test("malformed, partial, wrong-ID, wrong-scope and wrong-acknowledgement previews fail closed",async()=>{
 const variants=[null,{},({...fixture(),changes:[]}),({...fixture(),acknowledgement:"Approve publication"}),({...fixture(),paid_execution:true}),({...fixture(),entries:[fixture().entries[0],...fixture().entries.slice(0,3)]})];
 for(const mutate of [(p:any)=>{p.changes[0].after.platform_schedule.LinkedIn.intended_post="2026-11-09T00:00:00Z";},(p:any)=>{p.changes[0].after.generation_due=p.changes[0].after.intended_post;},(p:any)=>{p.changes[0].after.platform_schedule.platform_policy.platforms.push("X");}]){const p=fixture();mutate(p);variants.push(p);}
 for(const invalid of variants){const {h,calls}=await ready(async()=>Response.json({result:invalid}));assert.equal(calls.length,1);assert.equal(h.checkbox(),undefined);assert.match(h.text(),/Invalid repair preview/);}
});
test("a lost commit response reads the matching saved audit once, never replays POST, and confirms all four",async()=>{
 const p=fixture();const {h,calls}=await ready(async(_url,init)=>{if(!init?.method)return Response.json(state(p));if(JSON.parse(String(init.body)).action==="preview")return Response.json({result:p});throw Error("Lost response");});h.approve();await h.click("Apply exactly these four repairs");assert.equal(calls.length,3);assert.equal(calls[2].url,"/api/studio/state");assert.equal(calls[2].init.cache,"no-store");assert(h.text().includes(auditId));assert.match(h.text(),/historical receipt, not publication approval/);assert(!h.storage.has(STORAGE));
});
test("invalid success and 503 responses remain uncertain and locked until read-only audit verification",async()=>{
 for(const result of [Response.json({result:{status:"applied"}}),Response.json({error:"Unavailable"},{status:503}),new Response("not JSON",{status:200})]){
  let audit=false;const p=fixture();const {h,calls}=await ready(async(_url,init)=>!init?.method?Response.json(audit?state(p):{events:[]}):JSON.parse(String(init.body)).action==="preview"?Response.json({result:p}):result);
  h.approve();await h.click("Apply exactly these four repairs");assert.equal(calls.length,3);assert(h.storage.has(STORAGE));assert.match(h.text(),/outcome is not confirmed/);assert.equal(h.button("Preview four-entry repair"),undefined);assert.equal(h.button("Apply exactly these four repairs"),undefined);
  audit=true;await h.click("Check saved repair audit only");assert.equal(calls.length,4);assert(!h.storage.has(STORAGE));assert(h.text().includes(auditId));
 }
});
test("ambiguous or mismatched saved audit cannot turn uncertainty into a success claim",async()=>{
 const p=fixture();for(const mutate of [(s:any)=>s.events.push({...s.events[0]}),(s:any)=>{const a=JSON.parse(s.events[0].detail);a.preview_fingerprint="f".repeat(64);s.events[0].detail=canonical(a);},(s:any)=>{const a=JSON.parse(s.events[0].detail);a.after.pop();s.events[0].detail=canonical(a);},(s:any)=>{const a=JSON.parse(s.events[0].detail);a.after[0].generation_due=a.after[0].intended_post;s.events[0].detail=canonical(a);}]){
  const saved=state(p);mutate(saved);const storage=new Map([[STORAGE,JSON.stringify(p)]]),h=harness(async()=>Response.json(saved),storage);await h.settle();assert(storage.has(STORAGE));assert.match(h.text(),/outcome is not confirmed/);assert(!h.text().includes("Saved audit confirms"));
 }
});
test("readback rejects incomplete full rows, changed bindings, wrong old hashes and duplicate decoded keys",async()=>{
 const p=fixture();
 const mutations=[
  (audit:any)=>{delete audit.before[0].kind;},
  (audit:any)=>{audit.after[0].source_id="unexpected-source";},
  (audit:any)=>{audit.after[0].task_id="unexpected-task";},
  (audit:any)=>{audit.before[0].updated="2026-10-23T02:47:37.846124Z";},
  (audit:any)=>{audit.before[0].planned_date="2026-11-09";},
  (audit:any)=>{audit.after[0].extra=true;},
  (audit:any)=>{audit.after[0].updated="not-a-timestamp";},
  (audit:any)=>{audit.extra=true;}
 ];
 for(const mutate of mutations){const saved=state(p),audit=JSON.parse(saved.events[0].detail);mutate(audit);saved.events[0].detail=canonical(audit);const storage=new Map([[STORAGE,JSON.stringify(p)]]),h=harness(async()=>Response.json(saved),storage);await h.settle();assert(storage.has(STORAGE));assert.match(h.text(),/outcome is not confirmed/);}
 const wrong=fixture();wrong.entries[0].row_hash="e".repeat(64);
 const duplicate=state(p),escaped=state(p);
 duplicate.events[0].detail=duplicate.events[0].detail.replace('{','{"schema":1,');
 escaped.events[0].detail=escaped.events[0].detail.replace('{',String.raw`{"\u0073chema":1,`);
 for(const [expected,saved] of [[wrong,state(wrong)],[p,duplicate],[p,escaped]] as const){
  const storage=new Map([[STORAGE,JSON.stringify(expected)]]),h=harness(async()=>Response.json(saved),storage);await h.settle();assert(storage.has(STORAGE));assert.match(h.text(),/outcome is not confirmed/);
 }
});
test("interrupted commit persists the exact proof; remount performs GET only and never repeats the write",async()=>{
 let finish!:(r:Response)=>void;const p=fixture(),{h,calls}=await ready(async(_url,init)=>JSON.parse(String(init?.body)).action==="preview"?Response.json({result:p}):new Promise(resolve=>{finish=resolve;}));h.approve();h.button("Apply exactly these four repairs").props.onClick();assert.equal(calls.length,2);h.unmount();finish(success(p));await flush();assert(h.storage.has(STORAGE));
 const reads:any[]=[],next=harness(async(url,init)=>{reads.push({url,init});return Response.json(state(p));},h.storage);await next.settle();assert.equal(reads.length,1);assert.equal(reads[0].url,"/api/studio/state");assert.equal(reads[0].init.method,undefined);assert(next.text().includes(auditId));assert(!h.storage.has(STORAGE));
});
test("late preview after navigation is ignored; no durable pending write is invented",async()=>{
 let finish!:(r:Response)=>void;const h=harness(async()=>new Promise(resolve=>{finish=resolve;}));h.button("Preview four-entry repair").props.onClick();h.unmount();finish(Response.json({result:fixture()}));await flush();h.render();assert.equal(h.checkbox(),undefined);assert.equal(h.storage.size,0);
});
test("storage failure stops commit before transmission; bad saved state starts locked",async()=>{
 const {h,calls}=await ready();h.approve();h.sessionStorage.setItem=()=>{throw Error("Disabled storage");};await h.click("Apply exactly these four repairs");assert.equal(calls.length,1);assert.match(h.text(),/No changes were sent/);
 const bad=harness(async()=>assert.fail("No request for invalid saved state"),new Map([[STORAGE,"{}"]]));assert.match(bad.text(),/Saved repair state is invalid/);assert.equal(bad.button("Preview four-entry repair"),undefined);
});
test("readback errors keep pending proof and read-again double clicks never create multiple requests",async()=>{
 const storage=new Map([[STORAGE,JSON.stringify(fixture())]]);let count=0,finish!:(r:Response)=>void;const h=harness(async()=>{count++;if(count===1)throw Error("Offline");return new Promise(resolve=>{finish=resolve;});},storage);await h.settle();assert.match(h.text(),/readback is unavailable/);const click=h.button("Check saved repair audit only").props.onClick;click();click();assert.equal(count,2);finish(Response.json({events:[]}));await h.settle();assert(storage.has(STORAGE));assert.match(h.text(),/outcome is not confirmed/);
});
