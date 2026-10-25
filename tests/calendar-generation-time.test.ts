import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {type RuntimeConfig,type Source} from '../lib/domain';
import {GithubSourcePolicies,type PolicySession} from '../lib/github-source-policy';
import {githubSelectionPool} from '../lib/github-source-selection';
import {SourceIngestion} from '../lib/source-ingestion';
import {SCOPED_GITHUB_REPOSITORY} from '../lib/github-source-boundary';
import {OWNER_ID} from '../lib/owner-password';
import {NORMALIZATION_IDS} from '../lib/calendar-legacy-normalization';
import {APPROVAL_PLAN_ACK} from '../lib/approval-plan-contract';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {Store} from '../lib/store';
import {Calendar} from '../lib/calendar';
import {advanceGenerationNow,generationTimePreview,generationRowSQL,identifiableGenerationHistory,validGenerationTimeInput,GENERATION_ADVANCED,type GenerationTimeInput} from '../lib/calendar-generation-time';
const HOUR=3_600_000,now=new Date(),date=now.toISOString().slice(0,10);
const config:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:date,fallback_authorized:false,openai:{model:'isolated-generation-time',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/pricing',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'}};
async function seed(db:Database){
 await db.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',\'owner@studio.local\',true,now(),now())',[OWNER_ID]);
 const session:PolicySession={owner_id:OWNER_ID,session_id:randomUUID()};await db.query('INSERT INTO studio_auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[session.session_id,OWNER_ID,randomUUID(),new Date(now.getTime()+8*HOUR)]);
 const policies=new GithubSourcePolicies(db,config,()=>now),preview=await policies.preview({repository:SCOPED_GITHUB_REPOSITORY,commit_summaries:true,note_paths:[],start_date:date},session);
 const policy=await policies.activate({preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true},session);
 const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 await new SourceIngestion(db,{github:{enabled:true,sync_authorized:true,repositories:[SCOPED_GITHUB_REPOSITORY],since:date+'T00:00:00Z'}},{now:()=>now,env:{},fetch:async url=>new URL(String(url)).pathname.endsWith('/commits')?json([{sha:'a'.repeat(40),commit:{message:'Added deterministic window checks with separate owner approval for LinkedIn drafting',committer:{date:now.toISOString()}}}]):json({full_name:SCOPED_GITHUB_REPOSITORY,private:false,visibility:'public'})}).sync('github');
 await db.query('UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=120 WHERE id=1');
 const id=randomUUID(),post=new Date(now.getTime()+124*HOUR),review=new Date(post.getTime()-48*HOUR),due=new Date(now.getTime()+4*HOUR),schedule={platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}};
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6)",[id,post.toISOString().slice(0,10),post,review,due,JSON.stringify(schedule)]);
 const entry=(await db.query<any>(`SELECT ${generationRowSQL('e')} AS snapshot FROM calendar_entries e WHERE id=$1`,[id]))[0].snapshot,settings=(await db.query<any>(`SELECT ${generationRowSQL('s')} AS snapshot FROM calendar_settings s WHERE id=1`))[0].snapshot,selection=await githubSelectionPool(db,config,now),source=(await db.query<Source>('SELECT * FROM sources'))[0];
 const p=generationTimePreview(entry,settings,selection,config,true,now);assert.equal(p.eligible,true,p.reason||'');
 const input:GenerationTimeInput={entry_id:id,expected_preview:p.expected_preview!,requested_generation_time:'server_now',acknowledged:true};
 return {db,id,entry,settings,selection,source,input,policies,policy,session};
}
async function fixture(work:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){const db=await embedded();try{await work(await seed(db));}finally{await db.close();}}
const options=()=>({readConfig:()=>config,isReady:()=>true,clock:()=>now});

test('request accepts only exact entry/preview/server_now acknowledgement, never a caller clock or source-review claim',()=>{
 const good={entry_id:randomUUID(),expected_preview:'a'.repeat(64),requested_generation_time:'server_now',acknowledged:true};assert(validGenerationTimeInput(good));
 for(const bad of [null,[],{...good,acknowledged:false},{...good,requested_generation_time:'2026-10-25T08:00Z'},{...good,now:'forged'},{...good,source_reviewed:true},{...good,expected_preview:'bad'},{...good,entry_id:'wrong'}])assert.equal(validGenerationTimeInput(bad),false);
});

test('preview is exact-state bound, requires policy provenance and preserves the real lead/review limits',()=>fixture(async f=>{
 for(const [entry,settings,selection,c,ready,clock,history] of [
  [{...f.entry,id:NORMALIZATION_IDS[0]},f.settings,f.selection,config,true,now,false],
  [{...f.entry,source_id:f.source.id},f.settings,f.selection,config,true,now,false],
  [{...f.entry,task_id:randomUUID()},f.settings,f.selection,config,true,now,false],
  [f.entry,f.settings,f.selection,config,true,now,true],
  [{...f.entry,platform_schedule:{LinkedIn:f.entry.platform_schedule.LinkedIn}},f.settings,f.selection,config,true,now,false],
  [f.entry,{...f.settings,generation_enabled:false},f.selection,config,true,now,false],
  [f.entry,f.settings,{...f.selection,policy:undefined},config,true,now,false],
  [f.entry,f.settings,{...f.selection,candidates:[]},config,true,now,false],
  [f.entry,f.settings,f.selection,{...config,fallback_authorized:true},true,now,false],
  [f.entry,f.settings,f.selection,config,false,now,false],
  [f.entry,f.settings,f.selection,config,true,new Date(now.getTime()+4*HOUR+1),false],
  [f.entry,f.settings,f.selection,config,true,new Date(now.getTime()-213*HOUR),false],
  [{...f.entry,review_due:new Date(now.getTime()+1000)},f.settings,f.selection,config,true,now,false],
 ] as any[])assert.equal(generationTimePreview(entry,settings,selection,c,ready,clock,history).eligible,false);
 const changed=generationTimePreview({...f.entry,updated:f.entry.updated.replace(/(\d)Z$/,(digit:string)=>String((Number(digit[0])+1)%10)+'Z')},f.settings,f.selection,config,true,now);assert.notEqual(changed.expected_preview,f.input.expected_preview);
 assert.match(generationTimePreview(f.entry,f.settings,f.selection,config,true,now).notice,/No source is personally reviewed/);
}));

test('one explicit write advances only generation_due, preserves every other plan/source/setting and queues no work',()=>fixture(async f=>{
 const sourceBefore=JSON.stringify(f.source),settingsBefore=JSON.stringify(f.settings),result=await advanceGenerationNow(f.db,f.input,options());
 assert.equal(result.generation_due,now.toISOString());assert.equal(result.queued,false);assert.equal(result.paid_execution,false);
 const after=(await f.db.query<any>(`SELECT ${generationRowSQL('e')} AS snapshot FROM calendar_entries e WHERE id=$1`,[f.id]))[0].snapshot;
 for(const key of Object.keys(f.entry).filter(key=>!['generation_due','updated'].includes(key)))assert.deepEqual(after[key],f.entry[key],key);
 assert.equal(new Date(after.generation_due).toISOString(),now.toISOString());
 assert.equal(JSON.stringify((await f.db.query<Source>('SELECT * FROM sources'))[0]),sourceBefore);
 assert.equal(JSON.stringify((await f.db.query<any>(`SELECT ${generationRowSQL('s')} AS snapshot FROM calendar_settings s WHERE id=1`))[0].snapshot),settingsBefore);
 for(const table of ['tasks','calendar_jobs','github_source_grants','ledger','approvals','publishing_outbox'])assert.equal((await f.db.query('SELECT * FROM '+table)).length,0,table);
 const receipt=JSON.parse((await f.db.query<{detail:string}>('SELECT detail FROM events WHERE kind=$1',[GENERATION_ADVANCED]))[0].detail);assert.equal(receipt.previous_generation_due,f.entry.generation_due);assert.equal(receipt.requested_generation_time,'server_now');assert.match(receipt.note,/No personal source-review claim/);
}));

test('same-preview repeated/concurrent writes return one old receipt and never move time twice',()=>fixture(async f=>{
 const results=await Promise.all([advanceGenerationNow(f.db,f.input,options()),advanceGenerationNow(f.db,f.input,options())]);assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(results[0].receipt_id,results[1].receipt_id);
 const later=await advanceGenerationNow(f.db,f.input,{...options(),clock:()=>new Date(now.getTime()+HOUR)});assert.equal(later.duplicate,true);assert.equal(later.generation_due,now.toISOString());
 await assert.rejects(advanceGenerationNow(f.db,{...f.input,expected_preview:'f'.repeat(64)},options()),/already has a generation-time change/);
 assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,1);
}));

test('entry, settings, source and provenance changes invalidate the preview without mutations',()=>fixture(async f=>{
 const scenarios=[
  async()=>{await f.db.query('UPDATE calendar_entries SET updated=updated+interval \'1 second\' WHERE id=$1',[f.id]);},
  async()=>{await f.db.query('UPDATE calendar_settings SET generation_lead_hours=121 WHERE id=1');},
  async()=>{await f.db.query('UPDATE sources SET revoked_at=now() WHERE id=$1',[f.source.id]);},
  async()=>{await f.db.query("UPDATE source_provenance SET metadata=jsonb_set(metadata,'{evidence_digest}','\"changed\"'::jsonb) WHERE source_id=$1",[f.source.id]);},
 ];
 for(const mutate of scenarios){
  const beforeSettings=await f.db.query<any>('SELECT * FROM calendar_settings WHERE id=1');const beforeSource=await f.db.query<any>('SELECT * FROM sources WHERE id=$1',[f.source.id]);const beforeProvenance=await f.db.query<any>('SELECT * FROM source_provenance WHERE source_id=$1',[f.source.id]);await mutate();await assert.rejects(advanceGenerationNow(f.db,f.input,options()));await f.db.query('UPDATE calendar_entries SET updated=$2 WHERE id=$1',[f.id,f.entry.updated]);await f.db.query('UPDATE calendar_settings SET generation_lead_hours=$1 WHERE id=1',[beforeSettings[0].generation_lead_hours]);await f.db.query('UPDATE sources SET revoked_at=$2 WHERE id=$1',[f.source.id,beforeSource[0].revoked_at]);await f.db.query('UPDATE source_provenance SET metadata=$2 WHERE source_id=$1',[f.source.id,JSON.stringify(beforeProvenance[0].metadata)]);
 }
 assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,0);
}));

test('policy revocation or model/runtime changes cannot advance a plan under old scope',()=>fixture(async f=>{
 await assert.rejects(advanceGenerationNow(f.db,f.input,{...options(),readConfig:()=>({...config,openai:{...config.openai!,model:'changed'}})}));
 await f.policies.revoke(f.policy.id,f.policy.scope_hash,f.session);await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/active matching GitHub policy/);
 assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,0);
}));

test('a concurrent due intent or identifiable origin task cannot be overwritten',()=>fixture(async f=>{
 await f.db.query("INSERT INTO calendar_jobs(id,entry_id,status) VALUES($1,$2,'blocked')",[randomUUID(),f.id]);await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/retained execution history/);
 await f.db.query('DELETE FROM calendar_jobs WHERE entry_id=$1',[f.id]);
 await f.db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key) VALUES($1,$2,$3,'cancelled',$4)",[randomUUID(),f.source.id,f.source.hash,'calendar:'+f.id]);await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/retained execution history/);
 assert.equal(new Date((await f.db.query<any>('SELECT generation_due FROM calendar_entries WHERE id=$1',[f.id]))[0].generation_due).toISOString(),new Date(f.entry.generation_due).toISOString());
}));

test('clock or runtime crossing during final writes rolls back generation time and receipt',()=>fixture(async f=>{
 let delayed=false;const proxy:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async<T>(sql:string,params?:unknown[])=>{const out=await tx.query<T>(sql,params);if(sql.startsWith('INSERT INTO events'))delayed=true;return out;}}))};
 await assert.rejects(advanceGenerationNow(proxy,f.input,{...options(),clock:()=>new Date(now.getTime()+(delayed?5*HOUR:0))}),/guards changed before completion/);
 assert.equal(new Date((await f.db.query<any>('SELECT generation_due FROM calendar_entries WHERE id=$1',[f.id]))[0].generation_due).toISOString(),new Date(f.entry.generation_due).toISOString());assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,0);
}));

test('existing policy dispatch works afterward without manual source clearance or model calls',()=>fixture(async f=>{
 const calendar=new Calendar(f.db,120);assert.equal((await calendar.dispatchDue(config,true,now,{hostedScopedOnly:true})).queued,0);
 const before=JSON.stringify((await f.db.query<Source>('SELECT * FROM sources'))[0]);await advanceGenerationNow(f.db,f.input,options());
 const dispatched=await calendar.dispatchDue(config,true,now,{hostedScopedOnly:true});assert.equal(dispatched.queued,1);
 const state=await new Store(f.db).snapshot(),task=state.tasks[0],source=state.sources[0];assert.equal(task.origin_key,'calendar:'+f.id);assert.equal(task.status,'queued');assert.equal(task.checkpoint,0);assert.deepEqual(task.content_brief.platform_policy,NEW_PLATFORM_POLICY);assert(source.scoped_authorization);assert.notEqual(source.clearance_owner_acknowledged,true);
 assert.equal(JSON.stringify((await f.db.query<Source>('SELECT * FROM sources'))[0]),before);
 for(const table of ['ledger','outputs','approvals','publishing_outbox'])assert.equal((await f.db.query('SELECT * FROM '+table)).length,0,table);
 assert.equal((await f.db.query('SELECT * FROM github_source_grants')).length,1);
}));

test('microsecond-only row changes are stale and owner preview is independent of daily-cron readiness',()=>fixture(async f=>{
 const state=await new Store(f.db).snapshot(),snapshot=await new Calendar(f.db,120).snapshot(state,config,false,now,true);
 assert.equal(snapshot.entries.find((entry:any)=>entry.id===f.id).generation_time_preview.eligible,true);
 await f.db.query("UPDATE calendar_entries SET updated=updated+interval '0.000001 seconds' WHERE id=$1",[f.id]);
 await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/preview changed/);
 assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,0);
}));

test('retained publication/recovery receipts block even without current links and malformed/oversized history fails closed',()=>fixture(async f=>{
 const id=randomUUID();
 const publish={outbox_id:randomUUID(),entry_id:f.id,calendar_binding:'a'.repeat(64),plan_version:'b'.repeat(64),scheduler_policy_hash:null,acknowledgement:APPROVAL_PLAN_ACK};
 const recover={old_entry:f.id,old_task:randomUUID(),old_version:'a'.repeat(64),new_entry:randomUUID(),source_id:f.source.id,source_hash:f.source.hash,reason:'Fixture recovery',intended_post:now.toISOString(),generation_due:now.toISOString(),review_due:now.toISOString(),note:'Fixture history'};
 for(const [kind,detail] of [...[[],[f.id],{value:f.id},null].map(value=>['calendar_publication_approved',JSON.stringify({...publish,entry_id:value})]),...['old_entry','new_entry'].map(key=>['calendar_draft_replanned',JSON.stringify({...recover,[key]:[f.id]})]),['calendar_publication_approved',JSON.stringify(publish)],['calendar_draft_replanned',JSON.stringify(recover)],[GENERATION_ADVANCED,'{"entry_id":"one","entry_id":"two"}'],[GENERATION_ADVANCED,'x'.repeat(4097)]]){
  assert.equal(identifiableGenerationHistory([{id,kind,detail}],f.id),true);await f.db.query('INSERT INTO events(id,kind,detail) VALUES($1,$2,$3)',[id,kind,detail]);await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/history|receipt/);await f.db.query('DELETE FROM events WHERE id=$1',[id]);
 }
 assert.equal((await f.db.query('SELECT id FROM events WHERE kind=$1',[GENERATION_ADVANCED])).length,0);
}));

test('tampered replay receipt cannot masquerade as a successful current timing change',()=>fixture(async f=>{
 const result=await advanceGenerationNow(f.db,f.input,options());
 const saved=JSON.parse((await f.db.query<{detail:string}>('SELECT detail FROM events WHERE id=$1',[result.receipt_id]))[0].detail);
 for(const value of [[f.id],{value:f.id},null]){const detail=JSON.stringify({...saved,entry_id:value});assert.equal(identifiableGenerationHistory([{id:result.receipt_id,kind:GENERATION_ADVANCED,detail}],f.id),true);await f.db.query('UPDATE events SET detail=$2 WHERE id=$1',[result.receipt_id,detail]);await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/Malformed generation-time receipt/);}
 await f.db.query("UPDATE events SET detail=$2 WHERE id=$1",[result.receipt_id,JSON.stringify({schema:1,entry_id:f.id,expected_preview:f.input.expected_preview,requested_generation_time:'server_now',generation_due:now.toISOString()})]);
 await assert.rejects(advanceGenerationNow(f.db,f.input,options()),/Malformed generation-time receipt/);
}));
