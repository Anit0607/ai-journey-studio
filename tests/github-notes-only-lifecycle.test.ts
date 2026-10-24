import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {embedded} from '../lib/db';
import {SourceIngestion,type SourceIngestionConfig} from '../lib/source-ingestion';
import {SourceIntake,ownerSourceEligible} from '../lib/sources';
import {hash,type Source,type RuntimeConfig} from '../lib/domain';
import {githubEvidenceEligibility,normalizeGithubScope,type Provenance} from '../lib/github-source-policy';
import {SCOPED_GITHUB_REPOSITORY as repository,GITHUB_HASH_PINNED_TEXT_PATH as path,GITHUB_HASH_PINNED_TEXT_SHA256 as digest} from '../lib/github-source-boundary';
const raw=readFileSync(new URL('./fixtures/github-hash-pinned-progress-2026-10-24.txt',import.meta.url),'utf8');
const sha='a'.repeat(40),root='d'.repeat(40),docs='e'.repeat(40),notes='f'.repeat(40),date='2026-10-24T06:00:00Z',now=()=>new Date('2026-10-24T07:00:00Z');
const config:SourceIngestionConfig={github:{enabled:true,sync_authorized:true,private_read_authorized:true,repositories:[repository],intake_mode:'notes_only',notes:{enabled:true,paths:[path],commit_sha:sha,profile:{kind:'hash_pinned_text',path,sha256:digest}}}};
const bytes=Buffer.from(raw),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const fetcher:typeof fetch=async input=>{
 const url=new URL(String(input));assert(!url.pathname.endsWith('/commits'));assert.equal(url.origin,'https://api.github.com');
 if(url.pathname===`/repos/${repository}`)return json({full_name:repository,private:false,visibility:'public'});
 if(url.pathname===`/repos/${repository}/git/commits/${sha}`)return json({sha,tree:{sha:root},committer:{date}});
 if(url.pathname.includes('/git/trees/')){const id=url.pathname.split('/').at(-1);return json({sha:id,truncated:false,tree:id===root?[{path:'docs',mode:'040000',type:'tree',sha:docs}]:id===docs?[{path:'build-notes',mode:'040000',type:'tree',sha:notes}]:id===notes?[{path:path.split('/').at(-1),mode:'100644',type:'blob',sha:blob}]:assert.fail('Unexpected tree')});}
 assert.equal(url.pathname,`/repos/${repository}/contents/${path}`);assert.equal(url.search,`?ref=${sha}`);return json({path,type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64'),sha:blob});
};
test('real SQL import preserves exact provenance and demands separate full-source clearance; duplicate/revocation never grant it',async()=>{
 const db=await embedded();try{
  const service=new SourceIngestion(db,config,{now,env:{},fetch:fetcher}),intake=new SourceIntake(db);
  assert.equal((await service.sync('github')).providers[0].staged,1);
  let source=(await db.query<Source>('SELECT * FROM sources'))[0];const provenance=(await db.query<Provenance>('SELECT * FROM source_provenance'))[0];
  assert.equal(source.cleared,false);assert.equal(source.clearance_id,null);assert.equal(source.hash,hash(source.text));assert(source.text.endsWith(raw));assert.notEqual(source.hash,digest);assert.equal(ownerSourceEligible(source,source.hash,'openai',now()),false);
  const scope=normalizeGithubScope({repository,commit_summaries:false,note_paths:[path],start_date:'2026-10-24'},now());assert.equal(githubEvidenceEligibility(source,provenance,scope,now()).eligible,false);
  for(const table of ['tasks','ledger','outputs','approvals','github_source_grants'])assert.deepEqual(await db.query('SELECT * FROM '+table),[]);
  await assert.rejects(intake.clear(source.id,digest,true),/changed|hash/i);await assert.rejects(intake.clear(source.id,source.hash,false),/acknowledgement/i);
  const cleared=await intake.clear(source.id,source.hash,true);assert.equal(ownerSourceEligible(cleared,source.hash,'openai',now()),true);assert.equal((await service.sync('github')).providers[0].duplicates,1);assert.deepEqual((await db.query<Source>('SELECT * FROM sources'))[0],cleared);
  await intake.revoke(source.id,source.hash);const revoked=(await db.query<Source>('SELECT * FROM sources'))[0];assert(revoked.revoked_at);assert.equal((await service.sync('github')).providers[0].duplicates,1);source=(await db.query<Source>('SELECT * FROM sources'))[0];assert.deepEqual(source,revoked);assert.equal(ownerSourceEligible(source,source.hash,'openai',now()),false);
  assert.equal((await db.query('SELECT * FROM sources')).length,1);assert.equal((await db.query('SELECT * FROM source_provenance')).length,1);assert.deepEqual(await db.query('SELECT * FROM github_source_grants'),[]);assert.deepEqual(await db.query('SELECT * FROM ledger'),[]);
 }finally{await db.close();}
});

test('exact imported file runs only after full-source owner clearance, with intake OFF and six bounded mocked LinkedIn checkpoints',async()=>{
 const local=await embedded(),db={...local,kind:'postgres' as const};
 try{
  const {Store}=await import('../lib/store'),{runOwnerDraft,ownerDraftConfigHash}=await import('../lib/owner-draft'),{taskPlatformPolicyHash}=await import('../lib/platform-policy-binding'),{OWNER_DRAFT_MAX_RESERVED}=await import('../lib/owner-draft-policy');
  const intake=new SourceIntake(db),store=new Store(db),service=new SourceIngestion(db,config,{now,env:{},fetch:fetcher});assert.equal((await service.sync('github')).providers[0].staged,1);
  let source=(await db.query<Source>('SELECT * FROM sources'))[0];assert.equal(source.cleared,false);await assert.rejects(store.enqueue(source.id),/clear|source/i);
  const provenance=(await db.query<Provenance>('SELECT * FROM source_provenance'))[0],scope=normalizeGithubScope({repository,commit_summaries:false,note_paths:[path],start_date:'2026-10-24'},now());assert.equal(githubEvidenceEligibility(source,provenance,scope,now()).eligible,false);
  source=await intake.clear(source.id,source.hash,true);
  const off=new SourceIngestion(db,{github:{...config.github!,enabled:false,sync_authorized:false}},{env:{},fetch:async()=>assert.fail('Intake OFF must not fetch')});assert.equal((await off.sync('github')).status,'blocked');assert.equal(ownerSourceEligible((await db.query<Source>('SELECT * FROM sources'))[0],source.hash),true);
  const task=await store.enqueue(source.id);const c:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:new Date().toISOString().slice(0,10),fallback_authorized:false,openai:{model:'isolated-note-owner-run',pricing_version:'fixture',pricing_tier:'standard',official_pricing_url:'https://example.test/fixture',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'},hosted:{enabled:true,persistent_key_authorized:true,owner_auth_authorized:true,fluid_compute_verified:true,cron_authorized:false}};
  await db.query('UPDATE calendar_settings SET generation_enabled=true WHERE id=1');
  const input={task_id:task.id,expected_source_id:source.id,expected_source_hash:source.hash,expected_clearance_id:source.clearance_id!,expected_updated:new Date(task.updated).toISOString(),expected_checkpoint:0 as const,expected_config_hash:ownerDraftConfigHash(c),expected_platform_policy_hash:taskPlatformPolicyHash(task),acknowledged:true as const};
  let calls=0;
  // The unchanged manual-clearance gate binds source/envelope bytes and the exact receipt.
  for(const [column,bad,original] of [['text',source.text+' changed',source.text],['clearance_hash',digest,source.hash],['clearance_owner_acknowledged',false,true]] as const){
   await db.query('UPDATE sources SET '+column+'=$2 WHERE id=$1',[source.id,bad]);
   const denied=await runOwnerDraft(db,input,{readConfig:()=>c,isReady:()=>true,provider:async()=>{calls++;throw Error('No paid attempt allowed');}});assert.equal(denied.status,'blocked');assert.equal(calls,0);assert.deepEqual(await db.query('SELECT * FROM ledger'),[]);
   await db.query('UPDATE sources SET '+column+'=$2 WHERE id=$1',[source.id,original]);
  }
  const marker='\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ';
  const result=await runOwnerDraft(db,input,{readConfig:()=>c,isReady:()=>true,provider:async(provider,prompt)=>{
   assert.equal(provider,'openai');assert(prompt.includes(source.text));const checkpoint=calls++;let text=checkpoint<3?'SOURCE: '+source.text:checkpoint===3?'The progress note reports a six-stage LinkedIn draft test.':'### LinkedIn\nThe progress note reports a six-stage LinkedIn draft test.';
   if(checkpoint===4){assert(prompt.includes('Produce the LinkedIn variant only.'));assert(!prompt.includes('Produce LinkedIn, X and Instagram variants.'));}
   if(checkpoint===5){const index=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));text=JSON.stringify({schema:2,source_hash:source.hash,index_hash:index.index_hash,'Unsupported claims:':'Owner comparison remains required.','Evidence needed:':'Compare the exact attributed progress note.','Proposed advice:':'Review before approval.',evidence:[]});}
   return {text,input:10,output:20,outcome:'complete',report:{serviceTier:'default',model:c.openai!.model,requestId:'isolated-note-'+checkpoint,finishReason:'stop'}};
  }});
  assert.equal(result.status,'review');assert.equal(result.steps,6);assert.equal(calls,6);const usage=await db.query<{status:string;reserved:string}>('SELECT status,reserved FROM ledger');assert.equal(usage.length,6);assert(usage.every(x=>x.status==='settled'));assert.equal(OWNER_DRAFT_MAX_RESERVED,130000);assert(usage.reduce((n,x)=>n+Number(x.reserved),0)<=130000);
  const state=await store.snapshot();assert.deepEqual(state.reviews[0].platform_policy.platforms,['LinkedIn']);assert.equal(state.reviews[0].approval,null);assert.deepEqual(await db.query('SELECT * FROM approvals'),[]);assert.deepEqual(await db.query('SELECT * FROM publishing_outbox'),[]);assert.deepEqual(await db.query('SELECT * FROM github_source_grants'),[]);
 }finally{await local.close();}
});
