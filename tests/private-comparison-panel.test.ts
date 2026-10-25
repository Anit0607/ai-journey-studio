import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {ComparisonResult} from '../app/private-comparison-panel';

test('dashboard renders unchanged candidate and retained review failures, with no edit, run or publish control',()=>{
 const text='A sleeping database can still receive unnecessary checks.\n\n<script>untrusted text</script>',state:any={scope_hash:'scope',history:[{id:'start',kind:'private_comparison_started',detail:{run_id:'run',scope_hash:'scope'}},{id:'1',kind:'private_comparison_stage',detail:{run_id:'run',role:'Platform Adapter',text,hash:'offline-hash'}},{id:'2',kind:'private_comparison_finished',detail:{run_id:'run',status:'completed_requires_review',assessment:{flags:[{reason:'Unsupported claim remains blocked'}]}}}],notice:'Private comparison only.'};
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

test('result selects the explicit active run and never substitutes an older candidate',()=>{
 const state:any={scope_hash:'new',history:[{id:'old',kind:'private_comparison_started',detail:{scope_hash:'old',run_id:'old'}},{id:'old-stage',kind:'private_comparison_stage',detail:{run_id:'old',role:'Platform Adapter',text:'OLD CANDIDATE',hash:'old'}},{id:'new',kind:'private_comparison_started',detail:{scope_hash:'new',run_id:'new'}},{id:'new-stage',kind:'private_comparison_stage',detail:{run_id:'new',role:'Platform Adapter',text:'NEW CANDIDATE',hash:'new'}}],notice:'Read only'};
 const html=renderToStaticMarkup(createElement(ComparisonResult,{state}));const candidate=html.split('<article>')[1]?.split('</article>')[0];assert(candidate?.includes('NEW CANDIDATE'));assert(!candidate?.includes('OLD CANDIDATE'));
});
