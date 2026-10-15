import test from 'node:test';
import assert from 'node:assert/strict';
import {integrationConfig,schedulerStatus} from '../lib/integration-config';
test('integration settings fail closed and never enable a scheduler by presence alone',()=>{
 for(const value of [undefined,'null','[]','nope','{}'])assert.equal(schedulerStatus(integrationConfig({STUDIO_INTEGRATIONS_CONFIG:value})).authorized,false);
 assert.equal(schedulerStatus({scheduler:{mode:'external'}}).publication_ready,false);
});
test('daily cron never claims precise publication readiness',()=>{
 const status=schedulerStatus({scheduler:{mode:'daily',authorized:true,cadence_seconds:60}});
 assert.equal(status.authorized,true);assert.equal(status.publication_ready,false);assert.equal(status.exact_time,false);
});
test('external scheduler requires explicit bounded cadence; config is not a delivery observation',()=>{
 for(const cadence of [undefined,0,1,14,301,Infinity,NaN])assert.equal(schedulerStatus({scheduler:{mode:'external',authorized:true,cadence_seconds:cadence}}).publication_ready,false);
 assert.equal(schedulerStatus({scheduler:{mode:'external',authorized:true,cadence_seconds:60}}).publication_ready,true);
});
