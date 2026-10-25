import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import EvidencePanel from '../app/evidence-panel';
const require=createRequire(import.meta.url);
const source='😀 The workflow uses a configured window. The project retains final approval.';
const start=source.indexOf('The project'),sentences=[{start:0,end:start-1,text:source.slice(0,start-1)},{start,end:source.length,text:source.slice(start)}];
const item:any={id:'finding',role:'Writer',kind:'wording_review',claim:'The project keeps final approval.',reason:'Compare wording',artifact_hash:'artifact',span:{start:0,end:32},resolution:null};
const quality:any={binding:'binding',source_text:source,source_sentences:sentences,source_hash:'source',bundle_hash:'bundle',policy_version:'owner-policy',findings:[item]};
function nodes(n:any):any[]{return Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):typeof n==='string'?n:'';}
function harness(){const values:any[]=[];let cursor=0;const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(next:any)=>values[i]=next];},useRef:(initial:any)=>{const i=cursor++;return values[i]??={current:initial};}};const code=ts.transpileModule(readFileSync(new URL('../app/assistant-evidence-review.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports:any={};new Function('require','exports',code)((name:string)=>name==='react'?hooks:require(name),exports);return {render:(props:any)=>{cursor=0;return exports.default(props);}};}
const props=(action:(path:string,body:any)=>Promise<any>)=>({item,quality,task:'task',token:'review-token',busy:false,action});
const byType=(tree:any,type:string)=>nodes(tree).filter(n=>n.type===type);
test('no automatic comparison or preselection; exact selected source sentences use original UTF16 slices',async()=>{
 const calls:any[]=[],h=harness(),p=props(async(path,body)=>{calls.push({path,body});return true;});let tree=h.render(p);assert.equal(calls.length,0);assert.equal(byType(tree,'select')[0].props.value,'');assert.equal(byType(tree,'input')[0].props.checked,false);assert.equal(byType(tree,'button')[0].props.disabled,true);assert(text(tree).includes('not owner review or independent verification'));
 byType(tree,'select')[0].props.onChange({target:{value:'1'}});tree=h.render(p);assert(text(tree).includes(source.slice(start)));byType(tree,'textarea')[0].props.onChange({target:{value:'The quotation preserves final approval responsibility.'}});tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);assert.equal(byType(tree,'button')[0].props.disabled,false);byType(tree,'button')[0].props.onClick();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(calls[0].path,'assistant-evidence-review');assert.deepEqual(calls[0].body,{task:'task',expected:'review-token',binding:'binding',finding_id:'finding',decision:'accept',reason:'The quotation preserves final approval responsibility.',source_span:{start,end:source.length},source_quote:source.slice(start),acknowledged:true});assert.equal(calls[0].body.actor,undefined);assert.equal(calls[0].body.policy_version,undefined);
});
test('repeated clicks and lost response cannot automatically replay a comparison',async()=>{
 const h=harness(),calls:any[]=[];let reject!:(e:Error)=>void;const p=props(async(path,body)=>{calls.push({path,body});return new Promise((_,r)=>reject=r);});let tree=h.render(p);byType(tree,'select')[0].props.onChange({target:{value:'1'}});tree=h.render(p);byType(tree,'textarea')[0].props.onChange({target:{value:'Same final approval responsibility.'}});tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);const click=byType(tree,'button')[0].props.onClick;click();click();assert.equal(calls.length,1);reject(Error('lost'));await new Promise(r=>setImmediate(r));tree=h.render(p);assert.equal(byType(tree,'button')[0].props.disabled,true);assert(text(tree).includes('outcome unconfirmed'));assert.equal(calls.length,1);
});
test('changed quote or reason clears acknowledgement; hard and owner-resolved findings have no assistant controls',()=>{
 const h=harness(),p=props(async()=>assert.fail('No action'));let tree=h.render(p);byType(tree,'select')[0].props.onChange({target:{value:'1'}});tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);byType(tree,'textarea')[0].props.onChange({target:{value:'Changed reason'}});assert.equal(byType(h.render(p),'input')[0].props.checked,false);
 for(const changed of [{kind:'hard'},{category:'structure'},{resolution:{actor:'owner'}}])assert.equal(harness().render({...p,item:{...item,...changed}}),null);
});
test('assistant withdrawal targets only assistant route; owner panel never labels assistant output owner-reviewed',async()=>{
 const resolution:any={id:'assistant-row',actor:'assistant',reason:'Same meaning.',evidence:{source_quote:source.slice(start)},context:{}},calls:any[]=[],h=harness(),p={...props(async(path,body)=>{calls.push({path,body});return true;}),item:{...item,resolution}};let tree=h.render(p);assert.equal(byType(tree,'select').length,0);byType(tree,'textarea')[0].props.onChange({target:{value:'Withdraw for another comparison.'}});tree=h.render(p);byType(tree,'input')[0].props.onChange({target:{checked:true}});tree=h.render(p);byType(tree,'button')[0].props.onClick();await new Promise(r=>setImmediate(r));assert.equal(calls[0].body.decision,'withdraw');assert.equal(calls[0].path,'assistant-evidence-review');
 const html=renderToStaticMarkup(createElement(EvidencePanel,{...p,quality:{...quality,findings:[p.item]}}));assert(html.includes('Assistant-compared wording'));assert(!html.includes('Owner-reviewed wording'));assert(html.includes('Withdraw this wording decision'),'existing owner withdrawal remains available');
});
