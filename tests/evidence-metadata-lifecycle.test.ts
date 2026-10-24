import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {embedded} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {hash,type Output} from '../lib/domain';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-linkedin-draft-review-2026-10-24.json',import.meta.url),'utf8')) as {source:{text:string;hash:string;category:string;reported_date:string};outputs:Output[]};
test('actual saved bundle remains unapprovable and immutable in an isolated database',async()=>{
 const db=await embedded();
 try{
  const store=new Store(db),intake=new SourceIntake(db),source=await intake.stage(observed.source);
  await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
  for(const item of observed.outputs)await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,item.role,item.text,item.hash]);
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  const before=await db.query<Output>('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]);
  const review=(await store.snapshot()).reviews.find((r:{task_id:string})=>r.task_id===task.id);
  assert.equal(review.quality.status,'needs_revision');assert.equal(review.quality.flags.length,13);assert.equal(review.quality.critic.valid,false);
  const version=hash(before.map(item=>item.hash).join('|'));
  await assert.rejects(store.approve(task.id,version),/Resolve source-grounding/);
  assert.deepEqual(await db.query('SELECT * FROM approvals'),[]);assert.deepEqual(await db.query('SELECT * FROM evidence_approval_receipts'),[]);
  assert.deepEqual(await db.query('SELECT * FROM ledger'),[]);assert.deepEqual(await db.query('SELECT * FROM publishing_outbox'),[]);
  assert.deepEqual(await db.query('SELECT role,text,hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]),before);
  assert.equal((await db.query<{hash:string}>('SELECT hash FROM sources WHERE id=$1',[source.id]))[0].hash,observed.source.hash);
 }finally{await db.close();}
});
