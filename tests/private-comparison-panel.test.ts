import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {ComparisonResult} from '../app/private-comparison-panel';

test('dashboard renders unchanged candidate and retained review failures, with no edit, run or publish control',()=>{
 const text='A sleeping database can still receive unnecessary checks.\n\n<script>untrusted text</script>',state:any={history:[{id:'1',kind:'private_comparison_stage',detail:{role:'Platform Adapter',text,hash:'offline-hash'}},{id:'2',kind:'private_comparison_finished',detail:{status:'completed_requires_review',assessment:{flags:[{reason:'Unsupported claim remains blocked'}]}}}],notice:'Private comparison only.'};
 const html=renderToStaticMarkup(createElement(ComparisonResult,{state}));
 assert(html.includes('A sleeping database'));assert(html.includes('&lt;script&gt;untrusted text&lt;/script&gt;'));assert(!html.includes('<script>'));assert(html.includes('Unsupported claim remains blocked'));assert(html.includes('factual and editorial review required'));assert(!/<button|<form|<textarea|<input/.test(html));
});
test('empty comparison stays absent and interrupted work is clearly unconfirmed',()=>{
 assert.equal(renderToStaticMarkup(createElement(ComparisonResult,{state:{history:[]} as any})), '');
 const html=renderToStaticMarkup(createElement(ComparisonResult,{state:{history:[{id:'1',kind:'private_comparison_started',detail:{}}],notice:'No automatic retry.'} as any}));assert(html.includes('outcome unconfirmed'));assert(html.includes('do not retry'));
});
test('result refresh follows existing workspace events without a polling timer',()=>{
 const source=readFileSync(new URL('../app/private-comparison-panel.tsx',import.meta.url),'utf8'),page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert(source.includes('[refreshKey,refresh,invalidate]'));assert(page.includes('PrivateComparisonPanel refreshKey={state.events.map'));assert(!/setInterval|setTimeout/.test(source));
});
