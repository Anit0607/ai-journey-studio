import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleQuality,groundingRules} from '../lib/grounding';
import {hash} from '../lib/domain';
test('external first-person statements never become owner claims through exact substring matching',()=>{
 for(const provider of ['GitHub','YouTube']){const source=`Attributed ${provider} evidence; this record does not establish the owner’s experience.\nI increased revenue by 30%.`;const text='I increased revenue by 30%.';const quality=bundleQuality([{role:'Writer',text,hash:hash(text)},{role:'Critic',text:'Unsupported claims: none\nEvidence needed: none\nProposed advice: none',hash:hash('critic')}],source);assert.ok(quality.flags.some(f=>f.role==='Writer'));assert.match(groundingRules(source),/third person/);}
});
