import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {APPROVAL_PLAN_ACK,APPROVAL_PLAN_CONTRACT_V2,currentApprovalPlanContract,type ApprovalPlan} from "../lib/approval-plan-contract";
const require=createRequire(import.meta.url);
function harness(file="../app/approval-plan-panel.tsx",fetcher?:typeof fetch){
 const values:any[]=[];let cursor=0;
 const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(next:any)=>{values[i]=next;}];},useRef:(initial:any)=>{const i=cursor++;return values[i]??={current:initial};},useEffect:()=>{}};
 const source=readFileSync(new URL(file,import.meta.url),"utf8"),output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports:any={};
 new Function("require","exports","window","fetch","AbortSignal",output)((name:string)=>name==="react"?hooks:name.endsWith("/approval-plan-contract")?{currentApprovalPlanContract}:name.endsWith("/execution-readiness")?{executionReadiness:()=>({})}:name.endsWith("/lib/post-status")?{currentDelivery:()=>null,deliveryLocksApproval:()=>false}:name.startsWith(".")?{default:()=>null}:require(name),exports,{location:{search:""}},fetcher, {timeout:()=>new AbortController().signal});
 return {values,render:(component:any,props:any)=>{cursor=0;return component(props);},outer:exports.default,reset:()=>{values.length=0;}};
}
function nodes(n:any):any[]{return Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(""):n?.props?text(n.props.children):typeof n==="string"?n:"";}
const plan={...APPROVAL_PLAN_CONTRACT_V2,task_id:"task",review_token:"revision:fixture:hash",entry_id:"entry",calendar_binding:"calendar",source_hash:"source-hash",clearance_id:"clearance",quality_binding:"quality",evidence_version:null,account_id:"fixture-linkedin",account_version:"v1",account_label:"Fictional owner",remote_id:"urn:li:person:12345",scheduled_at:"2030-10-15T04:30:00.000Z",timezone:"UTC",delivery_mode:"scheduled",text:"Exact approved text\nwith its original newline.",variant_hash:"variant-hash",scheduler_policy_hash:null,version:"plan-hash"} satisfies ApprovalPlan;

test("full exact plan is visible; deliberate acknowledgement sends only the bound approval once",async()=>{
 const h=harness(),calls:any[]=[];let finish!:(value:boolean)=>void;
 const props={preview:{plan},busy:false,action:async(path:string,body:unknown)=>{calls.push({path,body});return new Promise<boolean>(resolve=>{finish=resolve;});}};
 const child=h.render(h.outer,props);let tree=h.render(child.type,child.props);
 const checkbox=()=>nodes(tree).find(n=>n.type==="input"),button=()=>nodes(tree).find(n=>n.type==="button");
 for(const value of [plan.text,plan.account_label,plan.remote_id,plan.account_version,plan.scheduled_at,plan.source_hash,plan.review_token,plan.acknowledgement])assert(text(tree).includes(value),value);
 assert.equal(checkbox().props.checked,false);assert.equal(button().props.disabled,true);button().props.onClick();assert.equal(calls.length,0);
 checkbox().props.onChange({target:{checked:true}});tree=h.render(child.type,child.props);const click=button().props.onClick;click();click();
 assert.deepEqual(calls,[{path:"approval-plan-approve",body:{...APPROVAL_PLAN_CONTRACT_V2,task_id:plan.task_id,review_token:plan.review_token,expected_plan:plan.version,acknowledged:true}}]);
 tree=h.render(child.type,child.props);assert.equal(checkbox().props.checked,false);assert.equal(button().props.disabled,true);
 finish(false);await new Promise(resolve=>setImmediate(resolve));tree=h.render(child.type,child.props);assert.equal(button().props.disabled,true,"Failed response must not retain consent or automatically repost");
 const changed=h.render(h.outer,{...props,preview:{plan:{...plan,version:"new-plan"}}});assert.notEqual(child.key,changed.key,"Changed plan remounts unchecked confirmation");
 assert.match(text(tree),/Factual checks alone do not establish content quality/);assert.match(text(tree),/specific supported problem, decision or method/);
 assert.match(text(tree),/OFF switches continue to block/);assert.match(text(tree),/not a delivery receipt/);
});

test("missing configuration exposes the blocker without a default time, destination or approval action",()=>{
 const h=harness(),tree=h.render(h.outer,{preview:{plan:null,reason:"Exactly one existing calendar slot must be linked to this task"},busy:false,action:async()=>assert.fail("No action")});
 assert.match(text(tree),/Exactly one existing calendar slot/);assert.match(text(tree),/assistant must resolve/);assert.equal(nodes(tree).filter(n=>n.type==="button"||n.type==="input").length,0);
 const source=readFileSync(new URL("../app/approval-plan-panel.tsx",import.meta.url),"utf8");assert.doesNotMatch(source,/from ["']\.\.\/lib\/(?:approval-plan|publishing)["']/);
 const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");assert.match(page,/<ApprovalPlanPanel preview=/);
});

test("a lost approval response inspects durable state with GET and never automatically sends another POST",async()=>{
 const calls:any[]=[],state={updated:"2030-01-01T00:00Z",budget:{committed_microdollars:0},analyst:{status:"insufficient-data"},blockers:[],sources:[],tasks:[{id:plan.task_id,status:"review",updated:"2030-01-01T00:00Z"}],outputs:[],reviews:[],events:[],ledger:[],calendar:{settings:{}},approval_plans:[{task_id:plan.task_id,plan}]};
 const h=harness("../app/page.tsx",async(url,init)=>{calls.push({path:String(url),method:init?.method});if(init?.method==="POST")throw new TypeError("Simulated lost response");return Response.json({...state,recovered:true});});
 h.render(h.outer,{});h.values[0]=true;h.values[2]=state;
 const tree=h.render(h.outer,{}),panel=nodes(tree).find(n=>n.props.preview?.plan===plan);assert(panel);
 assert.equal(await panel.props.action("approval-plan-approve",{expected_plan:plan.version}),false);
 assert.deepEqual(calls,[{path:"/api/studio/approval-plan-approve",method:"POST"},{path:"/api/studio/state",method:"GET"}]);assert.equal(h.values[2].recovered,true);assert.match(h.values[8],/Approval outcome is not confirmed/);assert.match(h.values[8],/no automatic resubmission/);
});

test("approval preview exposes exact scheduler binding and changed policy remounts unchecked consent",()=>{
 const h=harness(),fixed={...plan,scheduler_policy_hash:"fixed-policy-hash",version:"fixed-plan-version"};const child=h.render(h.outer,{preview:{plan:fixed},busy:false,action:async()=>assert.fail("Rendering cannot approve")}),tree=h.render(child.type,child.props);assert(text(tree).includes(fixed.scheduler_policy_hash));
 const changed=h.render(h.outer,{preview:{plan:{...fixed,scheduler_policy_hash:"changed-policy-hash",version:"changed-plan-version"}},busy:false,action:async()=>false});assert.notEqual(changed.key,child.key);
});


test("only current V2 acknowledgement is actionable; legacy or altered cached previews render refresh without consent",()=>{
 const legacy=Object.fromEntries(Object.entries(plan).filter(([key])=>!key.startsWith("acknowledgement")));
 for(const stale of [legacy,{...plan,acknowledgement_version:1,acknowledgement:APPROVAL_PLAN_ACK},{...plan,acknowledgement_version:3},{...plan,acknowledgement:"Other consent"},{...plan,acknowledgement_hash:"changed"}]){
  const h=harness(),tree=h.render(h.outer,{preview:{plan:stale},busy:false,action:async()=>assert.fail("Stale contract must not approve")});
  assert.match(text(tree),/Refresh.*current final-post approval/);assert.equal(nodes(tree).filter(n=>n.type==="button"||n.type==="input").length,0);
 }
});

test("final post, account and explicit IST/UTC times are shown without a source-review attestation",()=>{
 const h=harness(),props={preview:{plan},busy:false,action:async()=>assert.fail("Rendering never approves")};
 const child=h.render(h.outer,props),tree=h.render(child.type,child.props),visible=text(tree);
 assert.match(visible,/IST · Asia\/Kolkata/);assert.match(visible,/15 Oct 2030, 10:00:00/);assert(visible.includes(plan.scheduled_at));
 assert.match(visible,/Factual-review status:.*no unresolved flags/);assert.match(visible,/not independent factual verification/);assert.match(visible,/Six-stage artifacts and source details are optional context/);
 assert.doesNotMatch(visible,/I reviewed all six|reviewed.*against the cleared source/);
 assert(nodes(tree).some(node=>node.type==="details"&&text(node).includes("Optional exact-version details")));
 assert.equal(nodes(tree).find(node=>node.type==="input").props.checked,false);
});
