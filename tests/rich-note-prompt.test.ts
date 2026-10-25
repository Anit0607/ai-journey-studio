import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {draftingGuidance} from '../lib/drafting-guidance';
import {sourceDraftingContract} from '../lib/drafting-contract';
import {CRITIC_CONTRACT} from '../lib/evidence-review';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
const observed=JSON.parse(readFileSync(new URL('./fixtures/github-rich-note-draft-2026-10-25.json',import.meta.url),'utf8')) as {source:{text:string}};
const source=observed.source.text;
test('progress-note evidence limits do not replace the practical LinkedIn writing guidance',()=>{
 for(const checkpoint of [3,4]){
  const guidance=draftingGuidance(checkpoint,NEW_PLATFORM_POLICY,source);
  assert.equal(guidance,draftingGuidance(checkpoint,NEW_PLATFORM_POLICY));
  assert.doesNotMatch(guidance,/Do not require a hook|no manufactured hook|Keep limitations and advice internal/);
 }
 assert.match(draftingGuidance(2,NEW_PLATFORM_POLICY,source),/allowed opening and reader-action labels/);
 assert.match(draftingGuidance(3,NEW_PLATFORM_POLICY,source),/deliver its payoff promptly/);
 assert.match(draftingGuidance(4,NEW_PLATFORM_POLICY,source),/immediate payoff, evidence, useful takeaway/);
 assert.equal(draftingGuidance(3,NEW_PLATFORM_POLICY,'I reviewed my draft.'),draftingGuidance(3,NEW_PLATFORM_POLICY));
});
test('progress-note roles keep exact evidence, limited scope and timestamps without turning historical reports into assertions',()=>{
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const contract=sourceDraftingContract(checkpoint,source);
  assert.match(contract,/Harvester returns the exact source binding and complete canonical fact-ID list/);
  assert.match(contract,/Do not round, truncate or reformat timestamps/);
  assert.match(contract,/thorough, robust or smooth/);
  assert.match(contract,/type checking, lint and builds are separate checks/);
 }
 assert.match(sourceDraftingContract(5,source),/Reporting that an earlier draft made unsupported claims is not asserting those claims/);
 assert.match(CRITIC_CONTRACT,/exact key names, including their trailing colons/);
 assert.match(CRITIC_CONTRACT,/unsupported.*source_ids=\[\]/);
});
test('the structured note envelope never supplies an unstated observer or assistant actor',()=>{
 const other=source.slice(0,source.indexOf('## Verified progress'))+'## Verified progress\n- The maintainer inspected the workflow.\n\n## Evidence\n- https://github.com/owner/repository';
 for(let checkpoint=0;checkpoint<6;checkpoint++){
  const contract=sourceDraftingContract(checkpoint,other);
  assert.match(contract,/Preserve the observer and actor explicitly stated in SOURCE/);
  assert.doesNotMatch(contract,/This is an assistant-observed|assistant-observed repository update/);
 }
});
