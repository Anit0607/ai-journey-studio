import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile} from 'node:fs/promises';
import GithubSourcePolicyPanel from '../app/github-source-policy-panel';
import {recoverGithubPolicyStatus} from '../lib/github-policy-ui-state';

test('source scope control defaults empty and off, exposes bounded consent and never claims a scheduler',()=>{
 const html=renderToStaticMarkup(createElement(GithubSourcePolicyPanel));
 assert.match(html,/Every final post still needs your approval/);assert.match(html,/No folder wildcard or automatic discovery/);assert.match(html,/Preview exact consent/);assert.doesNotMatch(html,/Source consent ON/);assert.doesNotMatch(html,/Activate this source scope/);
});
for(const active of [true,false])test(`lost ${active?'activation':'revocation'} response reads saved status without replaying write`,async()=>{
 let reads=0;const writes=1;const result=await recoverGithubPolicyStatus(async()=>{reads++;return {available:true,active:active?{id:'saved-policy'}:null};});
 assert.equal(result.uncertain,false);assert.equal(!!result.status?.active,active);assert.equal(reads,1);assert.equal(writes,1);assert.match(result.notice,/no write was retried/);
});
test('lost write and status responses produce unconfirmed status, not stale OFF or ON',async()=>{
 const result=await recoverGithubPolicyStatus(async()=>{throw Error('offline');});assert.equal(result.status,null);assert.equal(result.uncertain,true);assert.match(result.notice,/Consent may be ON or OFF/);
});
test('UI clears acknowledgements and requires read-only status recovery after an unconfirmed write',async()=>{
 const source=await readFile('app/github-source-policy-panel.tsx','utf8');assert.match(source,/setAck\(false\);setRevokeAck\(false\)/);assert.match(source,/recoverGithubPolicyStatus\(readStatus\)/);assert.match(source,/setStatus\(recovered.status\)/);assert.match(source,/Refresh saved status/);assert.match(source,/disabled=\{busy\|\|uncertain/);
});
