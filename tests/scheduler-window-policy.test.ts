import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXED_WEEKLY_UTC,OPTIONAL_DATED_UTC,schedulerWindowPolicy,schedulerWindowPhase,exactSchedulerAnchor,nextUtcIntakeBoundary} from '../lib/scheduler-window-policy';
import {integrationConfig,schedulerStatus} from '../lib/integration-config';
import {fixedSettings} from './scheduler-window-fixture';

test('fixed mode is explicitly opt-in, strict, canonical and independent of current UI time',()=>{
 const config=fixedSettings(),policy=schedulerWindowPolicy(config.scheduler);assert.equal(policy.mode,'fixed-cadence-v1');assert.match(policy.hash!,/^[a-f0-9]{64}$/);
 assert.equal(schedulerStatus(config).publication_ready,true);
 const reversed=fixedSettings();(reversed.scheduler!.window_policy as any).weekly_utc.reverse();assert.equal(schedulerWindowPolicy(reversed.scheduler).hash,policy.hash);
 assert.notEqual(schedulerWindowPolicy(fixedSettings(false).scheduler).hash,policy.hash);
 assert.equal(schedulerWindowPolicy({}).mode,'generic');assert.equal(schedulerStatus({scheduler:{authorized:true,mode:'external',cadence_seconds:60}}).publication_ready,true);
 for(const bad of [null,undefined,[],{},true,'fixed-cadence-v1',{kind:'fixed-cadence-v2',weekly_utc:FIXED_WEEKLY_UTC,exceptions_utc:[]},{kind:'fixed-cadence-v1',weekly_utc:FIXED_WEEKLY_UTC,exceptions_utc:[],unknown:true},{kind:'fixed-cadence-v1',weekly_utc:[...FIXED_WEEKLY_UTC,'Thu10:30'],exceptions_utc:[]},{kind:'fixed-cadence-v1',weekly_utc:[{},...FIXED_WEEKLY_UTC.slice(1)],exceptions_utc:[]},{kind:'fixed-cadence-v1',weekly_utc:FIXED_WEEKLY_UTC,exceptions_utc:['2026-11-05T10:30:00Z']},{kind:'fixed-cadence-v1',weekly_utc:FIXED_WEEKLY_UTC,exceptions_utc:[OPTIONAL_DATED_UTC,OPTIONAL_DATED_UTC]}]){
  const invalid={scheduler:{...config.scheduler,window_policy:bad}};assert.equal(schedulerWindowPolicy(invalid.scheduler).mode,'invalid');assert.equal(schedulerStatus(invalid).authorized,false);assert.equal(schedulerStatus(invalid).publication_ready,false);
 }
 for(const patch of [{provider:'external-bearer'},{mode:'daily'},{cadence_seconds:60},{source_interval_minutes:30}])assert.equal(schedulerWindowPolicy({...config.scheduler,...patch}).mode,'invalid');
 for(const raw of ['nope','null','[]','{"scheduler":{"window_policy":'])assert.equal(schedulerStatus(integrationConfig({STUDIO_INTEGRATIONS_CONFIG:raw})).authorized,false);
});

test('UTC exact anchors also accept equivalent IST instants, never the surrounding wake window',()=>{
 const policy=schedulerWindowPolicy(fixedSettings().scheduler);
 for(const at of ['2026-10-26T22:00:00+05:30','2026-10-28T16:00:00+05:30','2026-10-30T15:00:00+05:30','2026-11-01T22:00:00+05:30',OPTIONAL_DATED_UTC])assert.equal(exactSchedulerAnchor(policy,at),true,at);
 for(const at of ['2026-10-26T16:26:00Z','2026-10-26T16:30:00.001Z','2026-10-26T16:32:00Z','2026-10-27T16:30:00Z','2026-11-05T10:30:00Z','invalid'])assert.equal(exactSchedulerAnchor(policy,at),false,at);
 assert.equal(exactSchedulerAnchor(schedulerWindowPolicy(fixedSettings(false).scheduler),OPTIONAL_DATED_UTC),false);
});

test('intake half-open and posting inclusive boundaries are deterministic UTC, including dated exception',()=>{
 const policy=schedulerWindowPolicy(fixedSettings().scheduler);
 for(const [at,phase] of [['2026-10-26T12:00:00Z','intake'],['2026-10-26T12:03:59.999Z','intake'],['2026-10-26T12:04:00Z','idle'],['2026-10-26T16:25:59.999Z','idle'],['2026-10-26T16:26:00Z','publication'],['2026-10-26T16:36:00Z','publication'],['2026-10-26T16:36:00.001Z','idle'],['2026-10-29T10:26:00Z','publication'],['2026-11-05T10:30:00Z','idle']])assert.equal(schedulerWindowPhase(policy,new Date(at)),phase,at);
 assert.equal(nextUtcIntakeBoundary(new Date('2026-10-26T12:03:59Z')).toISOString(),'2026-10-26T13:00:00.000Z');
 assert.equal(schedulerWindowPhase(policy,new Date(NaN)),'invalid');
 assert.equal(schedulerWindowPhase(schedulerWindowPolicy({}),new Date('2026-10-26T12:15:00Z')),'generic');
});
