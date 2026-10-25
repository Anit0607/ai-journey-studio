import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {publicationTimeIso} from '../app/publication-panel';

const require=createRequire(import.meta.url);
type Node={type:any;key?:string;props:Record<string,any>};
// Exercise component handlers with isolated hooks and mocked actions. This is
// not a rendered-browser check; no server, database or provider is contacted.
function ui(file:string,search='',fetcher?:(path:string,init?:RequestInit)=>Promise<unknown>){
 const values:any[]=[],effects:(()=>void)[]=[],timeouts:number[]=[];let cursor=0;
 const hooks={
  useState:(initial:any)=>{const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],(next:any)=>{values[index]=typeof next==='function'?next(values[index]):next;}];},
  useRef:(initial:any)=>{const index=cursor++;return values[index]??=( {current:initial});},
  useEffect:(effect:()=>void)=>effects.push(effect)
 };
 const output=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports:Record<string,any>={};
 const mockRequire=(name:string)=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name.endsWith('/execution-readiness')?{executionReadiness:()=>({})}:{__esModule:true,default:()=>null};
 new Function('require','exports','window','fetch','AbortSignal',output)(mockRequire,exports,{location:{search}},fetcher|| (async(path:string)=>{assert.equal(path,'/api/auth/status');return {json:async()=>({authenticated:false})};}),{timeout:(ms:number)=>{timeouts.push(ms);return new AbortController().signal;}});
 return {exports,values,effects,timeouts,reset:()=>{values.length=0;effects.length=0;},render:(component:any,props:Record<string,any>={})=>{cursor=0;return component(props) as Node;}};
}
function nodes(node:any):Node[]{
 if(Array.isArray(node))return node.flatMap(nodes);
 if(!node||typeof node!=='object'||!node.props)return [];
 return [node,...nodes(node.props.children)];
}
function text(node:any):string{
 if(Array.isArray(node))return node.map(text).join('');
 if(node&&typeof node==='object')return text(node.props?.children);
 return typeof node==='string'||typeof node==='number'?String(node):'';
}
function button(tree:Node,label:string){const found=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,`Missing button: ${label}`);return found;}
const plan={id:'plan-id',version:'exact-v1',status:'staged',task_id:'task-id',review_token:'original:approved',platform:'Instagram',account_id:'ig-account',remote_id:'123',scheduled_at:'2026-10-20T08:00:00Z',payload:{text:'Exact approved caption',media:[{url:'https://media.example.test/card.jpg',sha256:'a'.repeat(64),mime_type:'image/jpeg'}]}};
function jobUi(action:(path:string,body:any)=>Promise<boolean>,job=plan){
 const harness=ui('../app/publication-panel.tsx');
 const panel=harness.render(harness.exports.default,{publishing:{jobs:[job],accounts:[],acknowledgement:'Exact plan acknowledgement'},media:{},reviews:[],busy:false,action});
 const child=nodes(panel).find(n=>typeof n.type==='function'&&n.type.name==='PublicationJob');assert.ok(child);harness.reset();
 const render=()=>harness.render(child.type,child.props);
 return {...harness,child,render};
}
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));};

test('publication local time rejects missing, malformed and normalized dates and uses browser timezone',()=>{
 for(const value of ['', 'not-a-date','2026-02-30T12:00','2026-13-01T12:00','2026-01-01T24:00','0000-01-01T12:00','2026-01-01T12:00Z'])assert.equal(publicationTimeIso(value),null,value);
 const previous=process.env.TZ;
 try{
  process.env.TZ='Asia/Kolkata';assert.equal(publicationTimeIso('2099-04-02T10:30'),'2099-04-02T05:00:00.000Z');
  process.env.TZ='America/New_York';assert.equal(publicationTimeIso('2026-03-08T02:30'),null,'DST gap must not normalize to another time');
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('reschedule controls follow the existing editable statuses without any automatic action',()=>{
 for(const status of ['staged','approved','invalidated','missed','claimed','uncertain','published','failed','cancelled']){
  const harness=jobUi(async()=>{assert.fail('Rendering must not act');},{...plan,status});
  const found=nodes(harness.render()).filter(n=>n.type==='button'&&text(n)==='Reschedule publication');
  assert.equal(found.length,['staged','approved','invalidated','missed'].includes(status)?1:0,status);
 }
});

test('reschedule blocks missing, past, unchanged and impossible dates; dismissal sends nothing',()=>{
 let calls=0;const harness=jobUi(async()=>{calls++;return false;});
 button(harness.render(),'Reschedule publication').props.onClick();
 for(const value of ['', '2026-02-30T12:00','2000-01-01T12:00']){
  const input=nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!;input.props.onChange({target:{value}});
  const save=button(harness.render(),'Save new time for review');assert.equal(save.props.disabled,true);save.props.onClick();
 }
 button(harness.render(),'Keep current time').props.onClick();assert.equal(calls,0);
 button(harness.render(),'Reschedule publication').props.onClick();assert.equal(nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!.props.value,'');
 const scheduled='2099-04-02T10:30',same=jobUi(async()=>{assert.fail('Unchanged time must not submit');},{...plan,scheduled_at:publicationTimeIso(scheduled)!});
 button(same.render(),'Reschedule publication').props.onClick();nodes(same.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!.props.onChange({target:{value:scheduled}});
 const save=button(same.render(),'Save new time for review');assert.equal(save.props.disabled,true);save.props.onClick();
});

test('rescheduling sends one exact version-bound revise request and requires fresh review, never approval',async()=>{
 const calls:{path:string;body:any}[]=[];let finish!:(ok:boolean)=>void;
 const harness=jobUi(async(path,body)=>{calls.push({path,body});return new Promise<boolean>(resolve=>{finish=resolve;});});
 nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='checkbox')!.props.onChange({target:{checked:true}});
 assert.equal(button(harness.render(),'Approve this exact plan').props.disabled,false);
 button(harness.render(),'Reschedule publication').props.onClick();assert.equal(button(harness.render(),'Approve this exact plan').props.disabled,true);
 const scheduled='2099-04-02T10:30';nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!.props.onChange({target:{value:scheduled}});
 assert.match(text(harness.render()),/browser timezone/);assert.match(text(harness.render()),/UTC:/);
 const save=button(harness.render(),'Save new time for review');assert.equal(save.props.disabled,false);save.props.onClick();save.props.onClick();
 assert.deepEqual(calls,[{path:'publication-revise',body:{id:plan.id,expected_version:plan.version,plan:{task_id:plan.task_id,review_token:plan.review_token,platform:plan.platform,account_id:plan.account_id,payload:plan.payload,scheduled_at:publicationTimeIso(scheduled)}}}]);
 finish(true);await settle();assert.equal(button(harness.render(),'Approve this exact plan').props.disabled,true);assert.match(text(harness.render()),/Refresh to review the new exact plan/);
 assert.equal(harness.child.key,plan.id+':'+plan.version);
 const fresh=jobUi(async()=>{assert.fail('Fresh version must not auto-approve');},{...plan,version:'exact-v2'});assert.notEqual(fresh.child.key,harness.child.key);assert.equal(button(fresh.render(),'Approve this exact plan').props.disabled,true);
});

test('failed rescheduling retains the selected time and leaves approval unchecked',async()=>{
 let calls=0;const harness=jobUi(async()=>{calls++;return false;});button(harness.render(),'Reschedule publication').props.onClick();
 const selected='2099-04-02T10:30';nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!.props.onChange({target:{value:selected}});
 button(harness.render(),'Save new time for review').props.onClick();await settle();assert.equal(calls,1);
 assert.equal(nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='datetime-local')!.props.value,selected);assert.equal(button(harness.render(),'Approve this exact plan').props.disabled,true);
 button(harness.render(),'Keep current time').props.onClick();assert.equal(nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='checkbox')!.props.checked,false);
});

test('all supported OAuth callback names open Connections, while unrelated queries stay on Overview',async()=>{
 for(const provider of ['x','linkedin','instagram_facebook','unknown','']){
  const harness=ui('../app/page.tsx','?connection='+provider);harness.render(harness.exports.default);for(const effect of harness.effects)effect();await settle();
  assert.equal(harness.values.includes('Connections'),['x','linkedin','instagram_facebook'].includes(provider),provider);
 }
});

test('manual delivery is an explicit staging choice and never renders a publish control for ineligible jobs',()=>{
 const harness=ui('../app/publication-panel.tsx');
 const panel=harness.render(harness.exports.default,{publishing:{jobs:[],accounts:[]},media:{},reviews:[],busy:false,action:async()=>assert.fail('Rendering must not act')});
 const delivery=nodes(panel).find(n=>n.type==='select'&&nodes(n).some(option=>option.type==='option'&&option.props.value==='manual'));assert.ok(delivery);assert.equal(delivery.props.value,'scheduled');
 for(const job of [
  {...plan,delivery_mode:'scheduled',status:'approved',manual_ready:true},
  {...plan,delivery_mode:'manual',status:'staged',manual_ready:true},
  {...plan,delivery_mode:'manual',status:'approved',manual_ready:false},
  {...plan,delivery_mode:'manual',status:'uncertain',manual_ready:true},
  {...plan,delivery_mode:'manual',status:'published',manual_ready:true},
 ]){
  const jobHarness=jobUi(async()=>assert.fail('Rendering must not act'),job);
  assert.equal(nodes(jobHarness.render()).filter(n=>n.type==='button'&&text(n)==='Publish this exact approved plan now').length,0);
 }
});

test('manual publish requires a fresh visible acknowledgement and sends only this exact job once',async()=>{
 const calls:{path:string;body:any}[]=[];let finish!:(ok:boolean)=>void;
 const job={...plan,delivery_mode:'manual',status:'approved',manual_ready:true,scheduled_at:new Date(Date.now()-1000).toISOString()};
 const harness=jobUi(async(path,body)=>{calls.push({path,body});return new Promise(resolve=>{finish=resolve;});},job);
 let tree=harness.render();assert.match(text(tree),/exact text, media, account, version and approved time/);assert.match(text(tree),/No scheduler delivers this plan/);
 assert.equal(button(tree,'Publish this exact approved plan now').props.disabled,true);button(tree,'Publish this exact approved plan now').props.onClick();assert.equal(calls.length,0);
 const ack=nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox')!;assert.equal(ack.props.checked,false);ack.props.onChange({target:{checked:true}});
 tree=harness.render();const publish=button(tree,'Publish this exact approved plan now');assert.equal(publish.props.disabled,false);publish.props.onClick();publish.props.onClick();
 assert.deepEqual(calls,[{path:'publication-publish',body:{id:job.id,expected_version:job.version,expected_account_id:job.account_id,acknowledged:true}}]);
 assert.equal(button(harness.render(),'Publish this exact approved plan now').props.disabled,true);
 finish(false);await settle();button(harness.render(),'Publish this exact approved plan now').props.onClick();assert.equal(calls.length,1);assert.match(text(harness.render()),/uncertain result must not be replayed/);
 const fresh=jobUi(async()=>assert.fail('New exact version must not inherit acknowledgement'),{...job,version:'exact-v2'});assert.equal(button(fresh.render(),'Publish this exact approved plan now').props.disabled,true);
});

test('stale manual readiness cannot publish future or expired jobs and editing clears confirmation',()=>{
 for(const scheduled_at of [new Date(Date.now()+60_000).toISOString(),new Date(Date.now()-301_000).toISOString()]){
  const harness=jobUi(async()=>assert.fail('Time window must be rechecked'),{...plan,delivery_mode:'manual',status:'approved',manual_ready:true,scheduled_at} as typeof plan);
  nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='checkbox')!.props.onChange({target:{checked:true}});
  button(harness.render(),'Publish this exact approved plan now').props.onClick();
 }
 const harness=jobUi(async()=>assert.fail('Editing must not publish'),{...plan,delivery_mode:'manual',status:'approved',manual_ready:true,scheduled_at:new Date(Date.now()-1000).toISOString()} as typeof plan);
 nodes(harness.render()).find(n=>n.type==='input'&&n.props.type==='checkbox')!.props.onChange({target:{checked:true}});
 button(harness.render(),'Reschedule publication').props.onClick();assert.equal(nodes(harness.render()).filter(n=>n.type==='button'&&text(n)==='Publish this exact approved plan now').length,0);
 button(harness.render(),'Keep current time').props.onClick();assert.equal(button(harness.render(),'Publish this exact approved plan now').props.disabled,true);
});

function pageActionHarness(fetcher:(path:string,init?:RequestInit)=>Promise<unknown>){
 const harness=ui('../app/page.tsx','',fetcher);
 harness.render(harness.exports.default);
 harness.values[0]=true;
 harness.values[2]={budget:{committed_microdollars:0,warning:false},analyst:{status:'insufficient-data'},blockers:[],sources:[],tasks:[],outputs:[],reviews:[],events:[],ledger:[],integrations:{publishing:{jobs:[]},media:{}}};
 harness.values[7]='Publishing';
 const tree=harness.render(harness.exports.default);
 const panel=nodes(tree).find(n=>n.props.publishing);assert.ok(panel);
 return {...harness,action:panel.props.action as (path:string,body:unknown)=>Promise<boolean>};
}

test('page publishing request waits beyond the server deadline and does not post twice while pending',async()=>{
 const calls:string[]=[];let resolve!:(response:Response)=>void;
 const harness=pageActionHarness(async path=>{calls.push(path);if(path.endsWith('/publication-publish'))return new Promise<Response>(done=>{resolve=done;});return Response.json({integrations:{publishing:{jobs:[]}},reviews:[],budget:{committed_microdollars:0}});});
 const pending=harness.action('publication-publish',{id:'exact-job'});
 assert.deepEqual(harness.timeouts,[170_000]);assert.equal(await harness.action('publication-publish',{id:'other-job'}),false);assert.deepEqual(calls,['/api/studio/publication-publish']);
 resolve(Response.json({result:{status:'published',id:'exact-job'}}));assert.equal(await pending,true);
 assert.deepEqual(calls,['/api/studio/publication-publish','/api/studio/state']);assert.deepEqual(harness.timeouts,[170_000,10_000]);
});

test('page network loss warns of unconfirmed delivery and refreshes durable status without retrying',async()=>{
 const calls:string[]=[];
 const state={integrations:{publishing:{jobs:[{id:'exact-job',status:'uncertain'}]}},reviews:[],budget:{committed_microdollars:0}};
 const harness=pageActionHarness(async path=>{calls.push(path);if(path.endsWith('/publication-publish'))throw new TypeError('Failed to fetch');return Response.json(state);});
 assert.equal(await harness.action('publication-publish',{id:'exact-job'}),false);
 assert.deepEqual(calls,['/api/studio/publication-publish','/api/studio/state']);assert.match(harness.values[8],/outcome is not confirmed/);assert.match(harness.values[8],/server may still be completing/);assert.match(harness.values[8],/do not retry/);assert.deepEqual(harness.values[2],state);
});

test('page preserves a known uncertain server result and warns if its status refresh also fails',async()=>{
 const calls:string[]=[];
 const harness=pageActionHarness(async path=>{calls.push(path);if(path.endsWith('/publication-publish'))return Response.json({error:'Provider outcome uncertain. Do not retry; reconcile the provider receipt first.',result:{status:'uncertain'}},{status:409});throw new Error('Status unavailable');});
 assert.equal(await harness.action('publication-publish',{id:'exact-job'}),false);
 assert.deepEqual(calls,['/api/studio/publication-publish','/api/studio/state']);assert.match(harness.values[8],/Provider outcome uncertain/);assert.match(harness.values[6],/previous state may be stale/);
});

test('manual publication retains its separate lateness allowance while scheduled jobs display the scheduled clamp',()=>{
 const h=ui('../app/publication-panel.tsx'),manual={...plan,id:'manual',delivery_mode:'manual'},scheduled={...plan,id:'scheduled',delivery_mode:'scheduled'};
 for(const manualLimit of [3600,undefined]){
  const panel=h.render(h.exports.default,{publishing:{jobs:[manual,scheduled],accounts:[],max_lateness_seconds:300,...(manualLimit!==undefined?{manual_max_lateness_seconds:manualLimit}:{})},media:{},reviews:[],busy:false,action:async()=>assert.fail('Rendering cannot act')});
  assert.equal(nodes(panel).find(n=>n.props.job===manual)!.props.maxLateness,manualLimit??300);assert.equal(nodes(panel).find(n=>n.props.job===scheduled)!.props.maxLateness,300);
 }
});
