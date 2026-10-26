import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import EvidencePanel from '../app/evidence-panel';
import OwnerMessageContextPanel from '../app/owner-message-context-panel';
const require=createRequire(import.meta.url);
const statement="I'm building Example Studio with AI agents.",technical='The database has a configured request window.';
const context:any={eligible:true,policy_hash:'policy-hash',version:null,status:'unattached',quote:'Quick context: '+statement,statement,source_hash:'context-statement-hash',source_sentences:[{start:0,end:statement.length,text:statement}],message_reference:'owner-message-reference',authorization_reference:'drafting-authorization-reference',notice:'Exact task and original source only.'};
const item:any={id:'context-finding',role:'Writer',kind:'wording_review',claim:statement,reason:'Compare exact owner context',artifact_hash:'artifact-hash',span:{start:0,end:statement.length},resolution:null,evidence_source:'owner_message_context'};
const quality:any={binding:'current-quality-binding',source_text:technical,source_sentences:[{start:0,end:technical.length,text:technical}],source_hash:'original-source-hash',bundle_hash:'bundle-hash',policy_version:'wording-policy',findings:[item],owner_message_context:context};
const props=(action:(path:string,body:any)=>Promise<any>)=>({context,task:'task-id',token:'current-review-token',busy:false,action});
function nodes(n:any):any[]{return Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):typeof n==='string'?n:'';}
const byType=(tree:any,type:string)=>nodes(tree).filter(n=>n.type===type);
function harness(file='owner-message-context-panel'){const values:any[]=[];let cursor=0;const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(next:any)=>values[i]=next];},useRef:(initial:any)=>{const i=cursor++;return values[i]??={current:initial};}};const code=ts.transpileModule(readFileSync(new URL('../app/'+file+'.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports:any={};new Function('require','exports',code)((name:string)=>name==='react'?hooks:require(name),exports);return {render:(p:any)=>{cursor=0;return exports.default(p);}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('mount and refresh never attach context; exact server-selected reference request requires an unchecked confirmation',async()=>{
 const calls:any[]=[],h=harness(),p=props(async(path,body)=>{calls.push({path,body});return true;});let tree=h.render(p);assert.equal(calls.length,0);assert.equal(byType(tree,'input')[0].props.checked,false);assert.equal(byType(tree,'button')[0].props.disabled,true);assert(text(tree).includes('available for assistant import'));assert(text(tree).includes(context.quote));assert(text(tree).includes(context.message_reference));assert(text(tree).includes(context.authorization_reference));
 byType(tree,'button')[0].props.onClick();await flush();assert.equal(calls.length,0);tree=h.render({...p});assert.equal(calls.length,0);
 byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);assert.equal(byType(tree,'button')[0].props.disabled,false);byType(tree,'button')[0].props.onClick();await flush();assert.deepEqual(calls,[{path:'owner-message-context',body:{task:'task-id',expected:'current-review-token',policy_hash:'policy-hash',expected_context_version:null,decision:'attach',acknowledged:true}}]);assert.equal(Object.hasOwn(calls[0].body,'actor'),false);assert.equal(Object.hasOwn(calls[0].body,'quote'),false);assert.equal(Object.hasOwn(calls[0].body,'message_reference'),false);assert.equal(Object.hasOwn(calls[0].body,'approval'),false);
});

test('duplicate clicks and uncertain outcomes are latched without retry on rerender',async()=>{
 const calls:any[]=[],h=harness();let reject!:(error:Error)=>void;const p=props(async(path,body)=>{calls.push({path,body});return new Promise((_,r)=>reject=r);});let tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);const click=byType(tree,'button')[0].props.onClick;click();click();assert.equal(calls.length,1);reject(Error('lost response'));await flush();tree=h.render(p);assert.equal(byType(tree,'button')[0].props.disabled,true);assert.equal(byType(tree,'input')[0].props.checked,false);assert(text(tree).includes('outcome unconfirmed'));h.render({...p});assert.equal(calls.length,1);
});

test('rejected stale attachment is not automatically resubmitted and changed binding remounts an unchecked control',async()=>{
 const calls:any[]=[],h=harness(),p=props(async(path,body)=>{calls.push({path,body});return false;});let tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);byType(tree,'button')[0].props.onClick();await flush();tree=h.render(p);assert(text(tree).includes('not confirmed'));assert.equal(byType(tree,'button')[0].props.disabled,true);assert.equal(calls.length,1);
 const ep={...p,quality},getKey=(p:any)=>nodes(EvidencePanel(p)).find(n=>n.type===OwnerMessageContextPanel)?.key;
 const key=getKey(ep);assert.notEqual(getKey({...ep,token:'new-token'}),key);assert.notEqual(getKey({...ep,quality:{...quality,binding:'new-binding'}}),key);assert.notEqual(getKey({...ep,quality:{...quality,owner_message_context:{...context,version:'saved-version',status:'active'}}}),key);
 const fresh=harness().render({...p,token:'new-token'});assert.equal(byType(fresh,'input')[0].props.checked,false);assert.equal(byType(fresh,'button')[0].props.disabled,true);assert.equal(calls.length,1);
});

test('only eligible current contexts offer deliberate attach or revoke controls',async()=>{
 const calls:any[]=[],p=props(async(path,body)=>{calls.push({path,body});return true;});
 for(const change of [{eligible:false,status:'unavailable'},{eligible:false,status:'active'},{status:'invalid'},{policy_hash:null},{status:'active',version:null}]){const tree=harness().render({...p,context:{...context,...change}});assert.equal(byType(tree,'button').length,0);}
 const h=harness(),active={...p,context:{...context,status:'active',version:'saved-context-version'}};let tree=h.render(active);assert(text(tree).includes('Revoke owner-message context'));assert.equal(byType(tree,'input')[0].props.checked,false);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(active);byType(tree,'button')[0].props.onClick();await flush();assert.deepEqual(calls[0],{path:'owner-message-context',body:{task:'task-id',expected:'current-review-token',policy_hash:'policy-hash',expected_context_version:'saved-context-version',decision:'revoke',acknowledged:true}});
 const revoked=harness().render({...p,context:{...context,status:'revoked',version:'revoked-context-version'}});assert(text(revoked).includes('Attach owner-message context'));assert.equal(byType(revoked,'input')[0].props.checked,false);
});

test('context comparisons select the active owner statement and cannot silently cite the original technical source',async()=>{
 const calls:any[]=[],h=harness('assistant-evidence-review'),p={...props(async(path,body)=>{calls.push({path,body});return true;}),item,quality:{...quality,owner_message_context:{...context,status:'active',version:'context-version'}}};let tree=h.render(p);assert.equal(byType(tree,'select')[0].props.value,'');assert(text(tree).includes(statement));assert(!text(tree).includes(technical));assert(text(tree).includes('Evidence origin: owner self-report imported by the assistant'));
 byType(tree,'select')[0].props.onChange({target:{value:'0'}});tree=h.render(p);byType(tree,'textarea')[0].props.onChange({target:{value:'This preserves the exact owner-supplied building context without adding a technical outcome.'}});tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);byType(tree,'button')[0].props.onClick();await flush();assert.equal(calls[0].path,'assistant-evidence-review');assert.equal(calls[0].body.source_quote,statement);assert.deepEqual(calls[0].body.source_span,{start:0,end:statement.length});assert.equal(Object.hasOwn(calls[0].body,'actor'),false);assert.equal(calls[0].body.evidence_source,undefined);
 const ordinary=harness('assistant-evidence-review').render({...p,item:{...item,evidence_source:undefined}});assert(text(ordinary).includes(technical));assert(!text(ordinary).includes(statement));
 for(const change of [{status:'revoked'},{eligible:false},{statement:null},{source_hash:null}]){const blocked=harness('assistant-evidence-review').render({...p,quality:{...p.quality,owner_message_context:{...p.quality.owner_message_context,...change}}});assert.equal(byType(blocked,'button').length,0);assert(text(blocked).includes('not current'));}
});

test('contextual findings do not offer a personal owner acceptance form; ordinary source review is unchanged',()=>{
 const p={...props(async()=>assert.fail('No request')),quality:{...quality,owner_message_context:{...context,status:'active',version:'context-version'}}};const html=renderToStaticMarkup(createElement(EvidencePanel,p));assert(!html.includes('I compared this sentence with its evidence'));assert(!html.includes('Record this wording review'));assert(html.includes('Record assistant source comparison'));assert(html.includes('Owner self-report'));assert(html.includes('not a personal owner review'));
 const ordinary=renderToStaticMarkup(createElement(EvidencePanel,{...p,quality:{...p.quality,findings:[{...item,evidence_source:undefined}]}}));assert(ordinary.includes('I compared this sentence with its evidence'));assert(ordinary.includes('Record this wording review'));
 const resolution:any={id:'assistant-decision',actor:'assistant',reason:'Exact owner self-report.',evidence:{source_quote:statement},context:{}};const resolved=renderToStaticMarkup(createElement(EvidencePanel,{...p,quality:{...p.quality,findings:[{...item,resolution}]}}));assert(resolved.includes('Assistant-compared wording'));assert(!resolved.includes('Owner-reviewed wording'));assert(resolved.includes('Withdraw this wording decision'));assert(resolved.includes('without claiming a personal source comparison'));assert(!resolved.includes('I compared this sentence with its evidence'));
});

test('context version details distinguish original technical hash from owner-message statement hash',()=>{const html=renderToStaticMarkup(createElement(EvidencePanel,{task:'task-id',token:'review-token',busy:false,action:async()=>true,quality:{...quality,owner_message_context:{...context,status:'active',version:'context-version'}}}));assert(html.includes('Original technical source SHA-256:'));assert(html.includes('Owner-message statement SHA-256:'));assert(html.includes('original-source-hash'));assert(html.includes('context-statement-hash'));});
