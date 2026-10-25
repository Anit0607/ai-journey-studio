import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {hash,ROLES} from '../lib/domain';
import {COMPARISON_SCOPE,COMPARISON_SCOPE_HASH} from '../lib/private-comparison-policy';
import {CORRECTED_COMPARISON_SCOPE,CORRECTED_COMPARISON_SCOPE_HASH} from '../lib/private-comparison-scopes';
const require=createRequire(import.meta.url),run='11111111-1111-1111-1111-111111111111';
function fixture(completed=false){
 const target=COMPARISON_SCOPE.target,history:any[]=completed?[{id:run,kind:'private_comparison_started',detail:{run_id:run,scope_hash:COMPARISON_SCOPE_HASH}},...ROLES.map((role,checkpoint)=>({id:'stage-'+checkpoint,kind:'private_comparison_stage',detail:{run_id:run,role,checkpoint,text:'Exact '+role,hash:hash('Exact '+role),report:{model:'gpt-6.1-sol',tier:'default',finish_reason:'stop'},raw:{choices:[{finish_reason:'stop',message:{content:'Exact '+role}}]}}})),{id:'end',kind:'private_comparison_finished',detail:{run_id:run,status:'completed_requires_review',steps:6,reservation_retained:false}}]:[];
 return {comparison:{execution_ready:true,scope:COMPARISON_SCOPE,scope_hash:COMPARISON_SCOPE_HASH,preview:{state_hash:hash('state')},history,notice:'No publication approval.'},studio:{tasks:[{id:target.task_id,status:'review',checkpoint:6,source_id:target.source_id,source_hash:target.source_hash}],sources:[{id:target.source_id,hash:target.source_hash,text:'Exact cleared source.'}],reviews:[{task_id:target.task_id,token:'original:'+hash('review')}],ledger:completed?[{id:run,status:'settled',completion_status:'completed_requires_review',provider:'openai',model:'gpt-6.1-sol',pricing_anomaly:false}]:[],events:[] as any[]}};
}
function harness(value=fixture(),storage=new Map<string,string>()){
 const values:any[]=[],effects:Array<()=>void>=[],calls:{url:string;init?:RequestInit}[]=[];let cursor=0,read=value,post:(url:string,init?:RequestInit)=>Promise<Response>=async()=>Response.json({result:{status:'completed_requires_review'}});
 const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(next:any)=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useRef:(initial:any)=>{const i=cursor++;return values[i]??={current:initial};},useCallback:(callback:any)=>{cursor++;return callback;},useEffect:(effect:()=>void)=>{cursor++;effects.push(effect);}};
 const source=readFileSync(new URL('../app/private-comparison-panel.tsx',import.meta.url),'utf8'),output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,exports:any={};
 const fetcher=async(url:string,init?:RequestInit)=>{calls.push({url,init});if(init?.method==='POST')return post(url,init);return Response.json(url==='/api/private-comparison'?read.comparison:read.studio);};
 new Function('require','exports','fetch','sessionStorage','crypto','TextEncoder',output)((name:string)=>name==='react'?hooks:require(name),exports,fetcher,{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,v:string)=>storage.set(key,v)},webcrypto,TextEncoder);
 const render=()=>{cursor=0;return exports.default({refreshKey:'same-events'});},flush=async()=>{for(let n=0;n<3;n++)await new Promise(resolve=>setTimeout(resolve,20));};
 return {render,flush,calls,storage,exports,setRead:(v:typeof value)=>{read=v;},setPost:(fn:typeof post)=>{post=fn;},mount:async()=>{render();effects[0]();await flush();return render();}};
}
function nodes(n:any):any[]{return Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):typeof n==='string'?n:'';}
const button=(tree:any,label:string)=>nodes(tree).find(n=>n.type==='button'&&text(n).includes(label));
function confirm(h:ReturnType<typeof harness>){let tree=h.render();const check=nodes(tree).find(n=>n.type==='input');assert(check);check.props.onChange({target:{checked:true}});tree=h.render();return tree;}
const posts=(h:ReturnType<typeof harness>)=>h.calls.filter(c=>c.init?.method==='POST');

test('mount and refresh only GET; exact source/model/$0.85 confirmation is initially unchecked',async()=>{
 const h=harness();let tree=await h.mount();assert.equal(posts(h).length,0);assert(text(tree).includes('gpt-6.1-sol'));assert(text(tree).includes('0.85'));assert(text(tree).includes('Exact cleared source.'));assert(text(tree).includes(COMPARISON_SCOPE.target.source_hash));assert.equal(button(tree,'Run private').props.disabled,true);button(tree,'Run private').props.onClick();await h.flush();assert.equal(posts(h).length,0);
 button(tree,'Refresh saved').props.onClick();await h.flush();tree=h.render();assert.equal(posts(h).length,0);assert.equal(nodes(tree).find(n=>n.type==='input').props.checked,false);
});
test('a deliberate run click posts exact binding only once, including repeated clicks and lost response/reload',async()=>{
 const h=harness();await h.mount();let release!:()=>void;h.setPost(async()=>new Promise<Response>((_resolve,reject)=>{release=()=>reject(Error('lost response'));}));
 const click=button(confirm(h),'Run private').props.onClick;click();click();await h.flush();assert.equal(posts(h).length,1);assert.deepEqual(JSON.parse(String(posts(h)[0].init!.body)),{expected_state_hash:hash('state'),scope_hash:COMPARISON_SCOPE_HASH,acknowledged:true});assert.equal(posts(h)[0].url,'/api/private-comparison');assert(text(h.render()).includes('in progress'));
 release();await h.flush();assert(text(h.render()).includes('Outcome unconfirmed'));assert.equal(button(h.render(),'Run private'),undefined);button(h.render(),'Refresh saved').props.onClick();await h.flush();assert.equal(posts(h).length,1);
 const reloaded=harness(fixture(),h.storage);assert.equal(button(await reloaded.mount(),'Run private'),undefined);assert.equal(posts(reloaded).length,0);
});
test('changed run preview is read and displayed without POST or carried-forward confirmation',async()=>{
 const h=harness();await h.mount();const tree=confirm(h),fresh=fixture();fresh.comparison.preview.state_hash=hash('new-state');h.setRead(fresh);button(tree,'Run private').props.onClick();await h.flush();assert.equal(posts(h).length,0);assert(text(h.render()).includes('confirm again'));assert.equal(nodes(h.render()).find(n=>n.type==='input').props.checked,false);
});
test('only complete settled matching evidence exposes review preparation; terminal failure/unsettled/tamper never does',async()=>{
 for(const change of ['failed','unsettled','hash','raw','pending','started']){
  const f=fixture(true);if(change==='failed')f.comparison.history.at(-1)!.detail.status='incomplete';if(change==='unsettled')f.studio.ledger[0].status='unknown';if(change==='hash')f.comparison.history[1].detail.hash=hash('wrong');if(change==='raw')f.comparison.history[1].detail.raw.choices[0].message.content='wrong';if(change==='pending')(f.studio.reviews[0] as any).pending_agent_revision={id:'pending'};if(change==='started')f.comparison.history=f.comparison.history.slice(0,1);
  const h=harness(f),tree=await h.mount();assert.equal(button(tree,'Prepare for final'),undefined,change);assert.equal(button(tree,'Run private'),undefined);assert.equal(posts(h).length,0);
 }
});
test('review preparation uses fresh state token, preserves raw text, prevents duplicates and never approves',async()=>{
 const f=fixture(true),h=harness(f);let tree=await h.mount();assert(button(tree,'Prepare for final'));assert(text(tree).includes('not approval'));assert.equal(button(tree,'Prepare for final').props.disabled,true);
 h.setPost(async()=>{f.studio.events.push({task_id:COMPARISON_SCOPE.target.task_id,kind:'private_comparison_adopted',detail:JSON.stringify({run_id:run})});return Response.json({result:{status:'adopted_requires_review'}});});const click=button(confirm(h),'Prepare for final').props.onClick;click();click();await h.flush();assert.equal(posts(h).length,1);assert.equal(posts(h)[0].url,'/api/private-comparison/adopt');assert.deepEqual(JSON.parse(String(posts(h)[0].init!.body)),{run_id:run,task_id:COMPARISON_SCOPE.target.task_id,scope_hash:COMPARISON_SCOPE_HASH,expected_review_token:'original:'+hash('review')});assert.equal(f.comparison.history[5].detail.text,'Exact Platform Adapter');tree=h.render();assert(text(tree).includes('Already prepared'));assert.equal(button(tree,'Prepare for final'),undefined);assert(!h.calls.some(c=>/approve|publish|enqueue/.test(c.url)));
});
test('stale review token blocks before adoption; server rejection or lost reply stays locked with read-only recovery',async()=>{
 const f=fixture(true),h=harness(f);await h.mount();const tree=confirm(h),fresh=fixture(true);fresh.studio.reviews[0].token='original:'+hash('new-review');h.setRead(fresh);button(tree,'Prepare for final').props.onClick();await h.flush();assert.equal(posts(h).length,0);assert(text(h.render()).includes('confirm again'));
 h.setPost(async()=>Response.json({error:'binding rejected'},{status:409}));button(confirm(h),'Prepare for final').props.onClick();await h.flush();assert.equal(posts(h).length,1);assert(text(h.render()).includes('not confirmed'));assert.equal(button(h.render(),'Prepare for final'),undefined);button(h.render(),'Refresh saved').props.onClick();await h.flush();assert.equal(posts(h).length,1);
});

test('closed release readiness has no run control and successful run requires fresh review confirmation',async()=>{
 const closed=fixture();closed.comparison.execution_ready=false;const blocked=harness(closed);assert.equal(button(await blocked.mount(),'Run private'),undefined);assert.equal(posts(blocked).length,0);
 const h=harness();await h.mount();h.setPost(async()=>{h.setRead(fixture(true));return Response.json({result:{status:'completed_requires_review'}});});button(confirm(h),'Run private').props.onClick();await h.flush();const tree=h.render();assert.equal(posts(h).length,1);assert.equal(button(tree,'Run private'),undefined);assert(button(tree,'Prepare for final'));assert.equal(button(tree,'Prepare for final').props.disabled,true);assert.equal(nodes(tree).find(n=>n.type==='input').props.checked,false);
});

test('lost review-preparation response remains locked after remount with no automatic replay',async()=>{
 const h=harness(fixture(true));await h.mount();h.setPost(async()=>{throw Error('lost response');});button(confirm(h),'Prepare for final').props.onClick();await h.flush();assert.equal(posts(h).length,1);assert(text(h.render()).includes('Outcome unconfirmed'));assert.equal(button(h.render(),'Prepare for final'),undefined);
 const reloaded=harness(fixture(true),h.storage);assert.equal(button(await reloaded.mount(),'Prepare for final'),undefined);assert.equal(posts(reloaded).length,0);
});

test('pending successor displays exact remaining cap and immutable prior history without paid controls',async()=>{
 const f:any=fixture();f.comparison.scope=CORRECTED_COMPARISON_SCOPE;f.comparison.scope_hash=CORRECTED_COMPARISON_SCOPE_HASH;f.comparison.execution_ready=false;f.comparison.prior_history=fixture(true).comparison.history;f.comparison.selected_run_id=null;
 const h=harness(f),tree=await h.mount();assert(text(tree).includes('0.764676'));assert(text(tree).includes('pending; execution remains disabled'));assert(text(tree).includes('Earlier immutable comparison'));assert(text(tree).includes(CORRECTED_COMPARISON_SCOPE_HASH));assert.equal(button(tree,'Run private'),undefined);assert.equal(button(tree,'Prepare for final'),undefined);assert.equal(posts(h).length,0);
 button(tree,'Refresh saved').props.onClick();await h.flush();assert.equal(posts(h).length,0);
});
