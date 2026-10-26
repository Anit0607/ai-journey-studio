import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../lib/domain';
import {COMPARISON_PROMPT_POLICY_FILES,COMPARISON_PROMPT_POLICY_HASH} from '../lib/private-comparison-prompt-policy-manifest';
import {currentComparisonPromptPolicyHash,CORRECTED_COMPARISON_SCOPE,comparisonPolicy,comparisonPolicyAuthorized,CORRECTED_COMPARISON_SCOPE_HASH} from '../lib/private-comparison-scopes';
test('compiled prompt policy matches every exact canonical-LF integrated source file',()=>{
 const paths=COMPARISON_PROMPT_POLICY_FILES.map(f=>f.path);assert.deepEqual(paths,[...paths].sort());assert.equal(new Set(paths).size,18);assert(paths.includes('lib/owner-message-context.ts'));assert(paths.includes('lib/owner-message-context-policy.ts'));
 const actual=COMPARISON_PROMPT_POLICY_FILES.map(({path})=>({path,sha256:hash(readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n'))}));
 assert.deepEqual(actual,COMPARISON_PROMPT_POLICY_FILES);assert.equal(hash(JSON.stringify(actual)),COMPARISON_PROMPT_POLICY_HASH);assert.equal(currentComparisonPromptPolicyHash(),COMPARISON_PROMPT_POLICY_HASH);
 assert.equal(CORRECTED_COMPARISON_SCOPE.prompt_policy_hash,'a92c37461e9d2b3d904ceb831cd498aebb7a9863a534865d94d56aac474dbf0a');assert.equal(CORRECTED_COMPARISON_SCOPE.permission_status,'approved');assert.equal(CORRECTED_COMPARISON_SCOPE.consent_reference,'Sentinel_5fe38455d5bc8191ad426a18b4a923a4');assert.equal(comparisonPolicyAuthorized(comparisonPolicy(CORRECTED_COMPARISON_SCOPE_HASH)!,COMPARISON_PROMPT_POLICY_HASH),false,'New voice policy cannot reuse spent historical permission');
});
