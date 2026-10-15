import test from 'node:test';
import assert from 'node:assert/strict';
import {embedded} from '../lib/db';
import {Integrations} from '../lib/integrations';
test('disabled scheduler performs no work and persists no false delivery success',async()=>{
 const db=await embedded();try{const service=new Integrations(db,{},{});assert.deepEqual(await service.tick(),{status:'disabled'});const rows=await db.query<{last_status:string}>('SELECT last_status FROM integration_ticks');assert.equal(rows[0].last_status,'never-run');}finally{await db.close();}
});
test('durable tick lease makes simultaneous deliveries harmless',async()=>{
 const db=await embedded();try{const service=new Integrations(db,{scheduler:{authorized:true,mode:'daily'}},{});let runs=0;service.sources.sync=async()=>{runs++;await new Promise(r=>setTimeout(r,25));return {status:'disabled',providers:[]} as any;};service.publishing.dispatch=async()=>({status:'disabled'} as any);
 const results=await Promise.all([service.tick(),service.tick()]);assert.equal(runs,1);assert.ok(results.some(r=>r.status==='already-running'));assert.ok(results.some(r=>r.status==='completed'));
 const next=await service.tick();assert.equal(next.status,'completed');assert.equal(runs,1,'Source cadence prevents repeated polling');
 }finally{await db.close();}
});
test('failed tick is recorded without exposing exception secrets',async()=>{
 const db=await embedded();try{const service=new Integrations(db,{scheduler:{authorized:true,mode:'daily'}},{});service.sources.sync=async()=>{throw Error('sensitive backend content');};assert.equal((await service.tick()).status,'failed');const rows=await db.query('SELECT * FROM integration_ticks');assert.equal(rows[0].lease_token,null);assert.equal(rows[0].last_status,'failed');assert.doesNotMatch(JSON.stringify(rows),/sensitive backend/);}finally{await db.close();}
});
