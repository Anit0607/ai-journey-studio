import test from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../app/api/integrations/tick/route';
import {POST as ownerPost} from '../app/api/studio/[action]/route';
test('scheduler rejects unauthenticated and query-only invocations before database access',async()=>{
 for(const request of [new Request('https://studio.test/api/integrations/tick'),new Request('https://studio.test/api/integrations/tick?secret=not-authority')]){const result=await GET(request);assert.equal(result.status,401);assert.equal(result.headers.get('cache-control'),'no-store');}
});
test('integration and publication mutations require owner authentication',async()=>{
 for(const action of ['integration-sync','integration-import','publication-enqueue','publication-approve','publication-cancel','publication-revise']){const result=await ownerPost(new Request('https://studio.test/api/studio/'+action,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{params:Promise.resolve({action})});assert.equal(result.status,401);}
});
