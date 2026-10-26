import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {usageSummary} from '../lib/usage';
const require=createRequire(import.meta.url),exports:any={};
const source=readFileSync(new URL('../app/usage-panel.tsx',import.meta.url),'utf8');
new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(require,exports);
test('usage counters describe ledger records without changing numeric/API accounting or introducing stage counts',()=>{
 const rows=[85324,93196].map((estimated,i)=>({id:'aggregate-'+i,month:'2026-10',role:null,checkpoint:null,status:'settled',reserved:850000,estimated,input_tokens:100,output_tokens:100}));
 const usage=usageSummary(rows,'2026-10'),before=JSON.stringify(usage),html=renderToStaticMarkup(createElement(exports.default,{usage,tasks:[],outputs:[]}));
 assert(html.includes('2 ledger records'));assert(html.includes('records, not provider calls'));assert(html.includes('already included here'));assert(!html.includes('2 attempts'));assert(!html.includes('calls with unknown usage'));assert(!html.includes('12 verified'));assert.equal(usage.lifetime_total.estimated_microdollars,178520);assert.equal(JSON.stringify(usage),before);
});
