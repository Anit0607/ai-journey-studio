import test from 'node:test';
import assert from 'node:assert/strict';
import {embedded,type Database} from '../lib/db';
import {Integrations} from '../lib/integrations';
import {fixedSettings} from './scheduler-window-fixture';

test('idle and invalid fixed-mode ticks do not open database, refresh accounts, poll source or dispatch publication',async()=>{
 const db={query:async()=>assert.fail('Unexpected database access')} as unknown as Database;
 for(const config of [fixedSettings(),{scheduler:{...fixedSettings().scheduler,window_policy:null}}]){
  const service=new Integrations(db,config,{});service.ready=async()=>assert.fail('Unexpected account read');service.sources.sync=async()=>assert.fail('Unexpected source poll');service.publishing.dispatch=async()=>assert.fail('Unexpected publishing');
  assert(['idle','disabled'].includes((await service.tick(new Date('2026-10-26T12:15:00Z'))).status));
 }
});

test('hourly intake uses next fixed UTC boundary, lease and cadence; posting never runs overdue source work',async()=>{
 const db=await embedded();try{
  const service=new Integrations(db,fixedSettings(),{});let sources=0,posts=0,ready=0;
  service.ready=async()=>{ready++;return service;};service.sources.sync=async()=>{sources++;await new Promise(resolve=>setTimeout(resolve,5));return {status:'disabled',providers:[]} as any;};service.publishing.dispatch=async()=>{posts++;return {status:'idle'};};
  assert.equal((await service.tick(new Date('2026-10-26T12:03:00Z'))).status,'completed');
  assert.equal(new Date((await db.query('SELECT next_source_sync FROM integration_ticks'))[0].next_source_sync).toISOString(),'2026-10-26T13:00:00.000Z');
  await service.tick(new Date('2026-10-26T12:03:30Z'));assert.equal(sources,1);assert.equal(posts,0);assert.equal(ready,0);
  const both=await Promise.all([service.tick(new Date('2026-10-26T13:00:00Z')),service.tick(new Date('2026-10-26T13:00:00Z'))]);assert.equal(sources,2);assert(both.some(value=>value.status==='already-running'));assert.equal(posts,0);
  await db.query("UPDATE integration_ticks SET next_source_sync='2026-10-20T00:00:00Z'");
  await service.tick(new Date('2026-10-26T18:00:00Z'));assert.equal(sources,2,'Overdue source must never run before publication');assert.equal(posts,1);assert.equal(ready,1);
  await service.tick(new Date('2026-10-26T17:00:00Z'));assert.equal(sources,3);assert.equal(posts,1);
 }finally{await db.close();}
});
