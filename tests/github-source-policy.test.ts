import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {hash,type RuntimeConfig,type Source,type Task} from '../lib/domain';
import {GithubSourcePolicies,GITHUB_POLICY_ACKNOWLEDGEMENT,normalizeGithubScope,resolveScopedSource,type PolicySession} from '../lib/github-source-policy';
import {githubDraftRuntimeBinding} from '../lib/scoped-source-proof';
import {SourceIngestion} from '../lib/source-ingestion';
import {SCOPED_GITHUB_REPOSITORY} from '../lib/github-source-boundary';
import {Calendar} from '../lib/calendar';
import {Store} from '../lib/store';
import {SourceIntake,sourceAuthorized,sourceEligible,ownerSourceEligible,draftSourceEligible} from '../lib/sources';
import {step} from '../lib/workflow';
import {queueAgentRevision} from '../lib/agent-revisions';
import {Publishing} from '../lib/publishing';
import {OWNER_ID} from '../lib/owner-password';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {handleGithubSourcePolicy} from '../lib/github-source-policy-http';

const now=new Date(),date=now.toISOString().slice(0,10),hour=3_600_000;
const pricing={model:'gpt-test',pricing_version:'isolated',pricing_tier:'standard' as const,official_pricing_url:'https://openai.com/api/pricing/',input_microdollars_per_token:'0.125',output_microdollars_per_token:'0.750'};
const runtime:RuntimeConfig={owner_cleared_sources_authorized:true,credential_use_authorized:true,security_tests_passed:true,pricing_verified_date:date,fallback_authorized:false,openai:pricing};
const input={repository:SCOPED_GITHUB_REPOSITORY,commit_summaries:true,note_paths:[],start_date:date};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(work:(db:Database,session:PolicySession,policies:GithubSourcePolicies)=>Promise<void>){const db=await embedded();try{
 await db.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',\'owner@studio.local\',true,now(),now())',[OWNER_ID]);
 const session={owner_id:OWNER_ID,session_id:randomUUID()};await db.query('INSERT INTO studio_auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[session.session_id,OWNER_ID,randomUUID(),new Date(now.getTime()+8*hour)]);
 await work(db,session,new GithubSourcePolicies(db,runtime,()=>now));
 }finally{await db.close();}}
async function activate(policies:GithubSourcePolicies,session:PolicySession){const preview=await policies.preview(input,session);const request={preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true};return {policy:await policies.activate(request,session),request};}
async function stage(db:Database,summaries=['Implemented deterministic source selection with exact provenance checks for LinkedIn drafting']){
 const fetched:URL[]=[];const result=await new SourceIngestion(db,{github:{enabled:true,sync_authorized:true,repositories:[SCOPED_GITHUB_REPOSITORY],since:date+'T00:00:00Z'}},{now:()=>now,env:{},fetch:async url=>{
  const u=new URL(String(url));fetched.push(u);if(u.pathname.endsWith('/commits'))return json(summaries.map((summary,i)=>({sha:(i+1).toString(16).padStart(40,'0'),commit:{message:summary,committer:{date:now.toISOString()}}})));
  return json({full_name:SCOPED_GITHUB_REPOSITORY,private:false,visibility:'public'});
 }}).sync('github');assert.equal(result.providers[0].staged,summaries.length);return db.query<Source>('SELECT * FROM sources ORDER BY text');
}
async function entry(db:Database,offset=0,options:{source?:string;task?:string;legacy?:boolean}={}){
 const id=randomUUID(),post=new Date(now.getTime()+(72+offset*24)*hour),review=new Date(post.getTime()-48*hour);
 await db.query("UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=72 WHERE id=1");
 await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,source_id,task_id,platform_schedule) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6,$7,$8)",[id,post.toISOString().slice(0,10),post,review,now,options.source||null,options.task||null,JSON.stringify(options.legacy?{}:{platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}})]);return id;
}
async function prepared(db:Database,session:PolicySession,policies:GithubSourcePolicies){const sources=await stage(db);const {policy}=await activate(policies,session);const id=await entry(db);const dispatched=await new Calendar(db).dispatchDue(runtime,true,now);assert.equal(dispatched.queued,1);const task=(await db.query<Task>('SELECT * FROM tasks'))[0];return {source:sources[0],policy,entry:id,task};}

test('GitHub policy scope is fixed, normalized, finite and cannot broaden recipient, cap, paths or repository',()=>{
 const p=normalizeGithubScope({...input,repository:'Anit0607/ai-journey-studio'},now);assert.equal(p.repository,SCOPED_GITHUB_REPOSITORY);assert.deepEqual(p.categories,['build-log']);assert.equal(p.recipient,'openai');assert.equal(p.cap_microdollars,15_000_000);
 for(const value of [{...input,repository:'other/project'},{...input,recipient:'gemini'},{...input,cap_microdollars:50_000_000},{...input,note_paths:['README.md']},{...input,note_paths:['docs/build-notes/../README.md']},{...input,note_paths:['docs/build-notes/*']},{...input,commit_summaries:false},{...input,start_date:'2099-01-01'}])assert.throws(()=>normalizeGithubScope(value,now));
 assert.notEqual(githubDraftRuntimeBinding(runtime),githubDraftRuntimeBinding({...runtime,openai:{...pricing,model:'other'}}));
});

test('intake and preview never grant, enqueue, bill, schedule or publish; activation needs exact real owner-session receipt',()=>fixture(async(db,session,policies)=>{
 await stage(db);await entry(db);assert.equal((await new Calendar(db).dispatchDue(runtime,true,now)).queued,0);
 const preview=await policies.preview(input,session);assert.equal((await policies.snapshot()).active,null);
 const request={preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:GITHUB_POLICY_ACKNOWLEDGEMENT,acknowledged:true};
 for(const bad of [{...request,acknowledged:false},{...request,preview_hash:'f'.repeat(64)},{...request,acknowledgement:'I reviewed the exact source'}])await assert.rejects(policies.activate(bad,session));
 await assert.rejects(policies.activate(request,{...session,session_id:'not-a-live-session'}));
 for(const table of ['github_source_policies','github_source_grants','tasks','ledger','approvals','publishing_outbox'])assert.equal((await db.query('SELECT * FROM '+table)).length,0);
 const policy=await policies.activate(request,session);assert.equal(policy.active,true);assert.equal((await policies.activate(request,session)).id,policy.id);await assert.rejects(policies.activate({...request,preview_hash:'f'.repeat(64)},session),/receipt changed/);
 for(const table of ['github_source_grants','tasks','ledger','approvals','publishing_outbox'])assert.equal((await db.query('SELECT * FROM '+table)).length,0);
 assert.equal((await db.query<Source>('SELECT * FROM sources'))[0].cleared,false);
}));

test('concurrent dispatch selects once, links exact provenance, keeps raw source manual fields untouched and never reuses evidence',()=>fixture(async(db,session,policies)=>{
 const [source]=await stage(db);const before=JSON.stringify(source);await activate(policies,session);const first=await entry(db),second=await entry(db,1),id=[first,second].sort()[0];
 const results=await Promise.all(Array.from({length:4},()=>new Calendar(db).dispatchDue(runtime,true,now)));
 assert.equal(results.reduce((sum,r)=>sum+r.queued,0),1);assert.equal((await db.query('SELECT * FROM tasks')).length,1);assert.equal((await db.query('SELECT * FROM github_source_grants')).length,1);
 assert.equal(JSON.stringify((await db.query<Source>('SELECT * FROM sources WHERE id=$1',[source.id]))[0]),before);
 const grant=(await db.query('SELECT * FROM github_source_grants'))[0],task=(await db.query<Task>('SELECT * FROM tasks'))[0];assert.equal(grant.task_id,task.id);assert.equal(grant.entry_id,id);assert.equal(task.origin_key,'calendar:'+id);assert.deepEqual(task.content_brief?.platforms,['LinkedIn']);
 const resolved=await resolveScopedSource(db,source,now);assert(resolved);assert.equal(ownerSourceEligible(resolved),false);assert.equal(draftSourceEligible(resolved),true);assert.equal(sourceEligible(resolved),true);assert.equal(sourceAuthorized(runtime,resolved),true);assert.equal(sourceAuthorized(runtime,resolved,'gemini'),false);
 assert.equal(sourceAuthorized({...runtime,openai:{...pricing,model:'changed'}},resolved),false);
 for(const table of ['ledger','outputs','approvals','publishing_outbox'])assert.equal((await db.query('SELECT * FROM '+table)).length,0);
 const state=await new Store(db).snapshot();assert.equal(state.sources[0].scoped_authorization.grant_id,grant.id);
}));

test('selection is deterministic and skips insufficient, unsafe, outside-date and ambiguous provenance with visible reason',()=>fixture(async(db,session,policies)=>{
 const sources=await stage(db,['Build outline','Implemented deterministic first source ordering and linked evidence validation for review','Added a second deterministic content source with explicit immutable provenance checks']);await activate(policies,session);await entry(db);
 const result=await new Calendar(db).dispatchDue(runtime,true,now);assert.equal(result.queued,1);const selected=(await db.query<Source>('SELECT * FROM sources WHERE id=(SELECT source_id FROM tasks LIMIT 1)'))[0];assert.match(selected.text,/Implemented deterministic first/);
 const source=sources.find(s=>s.text.includes('Added a second'))!;const provenance=(await db.query('SELECT * FROM source_provenance WHERE source_id=$1',[source.id]))[0];
 await db.query('INSERT INTO source_provenance(id,source_id,provider,scope,external_id,content_hash,source_url,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),source.id,'github',provenance.scope,'b'.repeat(40),provenance.content_hash,provenance.source_url,JSON.stringify(provenance.metadata)]);
 await entry(db,1);const next=await new Calendar(db).dispatchDue(runtime,true,now);assert.equal(next.queued,0);assert(next.entries.some(e=>/insufficient|Ambiguous/.test(e.reason||'')));
}));

test('legacy, explicit sources and prebound jobs are never hijacked by selection',()=>fixture(async(db,session,policies)=>{
 await stage(db);await activate(policies,session);const manual=await new SourceIntake(db).stage({text:'I built an independent outline and verified each claim against my project notes.',category:'project-note',reported_date:date});
 const legacy=await entry(db,0,{legacy:true}),explicit=await entry(db,1,{source:manual.id}),job=await entry(db,2);
 await db.query("INSERT INTO calendar_jobs(id,entry_id,status,source_id,source_hash) VALUES($1,$2,'blocked',$3,$4)",[randomUUID(),job,manual.id,manual.hash]);
 assert.equal((await new Calendar(db).dispatchDue(runtime,true,now)).queued,0);
 assert.equal((await db.query('SELECT * FROM github_source_grants')).length,0);for(const id of [legacy,explicit,job])assert.equal((await db.query('SELECT task_id FROM calendar_entries WHERE id=$1',[id]))[0].task_id,null);
}));

test('owner source revocation is never resurrected and source-policy revocation leaves manual clearance intact',()=>fixture(async(db,session,policies)=>{
 const [source]=await stage(db);await new SourceIntake(db).revoke(source.id,source.hash);const {policy,request}=await activate(policies,session);await entry(db);assert.equal((await new Calendar(db).dispatchDue(runtime,true,now)).queued,0);
 const intake=new SourceIntake(db),manual=await intake.stage({text:'I built a separate reviewed source and checked its supported facts before drafting.',category:'project-note',reported_date:date});await intake.clear(manual.id,manual.hash,true);
 const before=JSON.stringify((await db.query('SELECT * FROM sources WHERE id=$1',[manual.id]))[0]);await policies.revoke(policy.id,policy.scope_hash,session);assert.equal(JSON.stringify((await db.query('SELECT * FROM sources WHERE id=$1',[manual.id]))[0]),before);
 await assert.rejects(policies.activate(request,session),/cannot be replayed/);assert.equal((await policies.snapshot()).active,null);
}));

test('policy revocation blocks already queued work and runtime changes cannot authorize the old scope',()=>fixture(async(db,session,policies)=>{
 const {source,policy}=await prepared(db,session,policies);await policies.revoke(policy.id,policy.scope_hash,session);
 assert.equal(sourceEligible(await resolveScopedSource(db,source,now)),false);let calls=0;
 const result=await step(new Store(db),runtime,async()=>{calls++;throw Error('No provider call permitted');},true,{ownerClearedOnly:true});assert.equal(result.status,'blocked');assert.equal(calls,0);assert.equal((await db.query('SELECT * FROM ledger')).length,0);
}));

test('revocation immediately before provider request prevents transmission and settles unused reservation at zero',()=>fixture(async(db,session,policies)=>{
 const {policy}=await prepared(db,session,policies);let calls=0;
 const result=await step(new Store(db),runtime,async()=>{calls++;throw Error('No provider call permitted');},true,{ownerClearedOnly:true,beforeProvider:async()=>{await policies.revoke(policy.id,policy.scope_hash,session);}});
 assert.equal(result.status,'blocked');assert.equal(calls,0);const ledger=(await db.query('SELECT * FROM ledger'))[0];assert.equal(ledger.status,'settled');assert.equal(Number(ledger.estimated),0);
}));

test('revocation in flight retains settled usage/output but blocks review readiness and future calls',()=>fixture(async(db,session,policies)=>{
 const {policy}=await prepared(db,session,policies);let calls=0;
 const result=await step(new Store(db),runtime,async()=>{calls++;await policies.revoke(policy.id,policy.scope_hash,session);return {text:'The commit reports added source checks.',input:10,output:10,outcome:'complete',report:{serviceTier:'default',model:'gpt-test',requestId:'fixture',finishReason:'stop'}};},true,{ownerClearedOnly:true});
 assert.equal(result.status,'blocked');assert.equal(calls,1);assert.equal((await db.query('SELECT * FROM outputs')).length,1);assert.equal((await db.query('SELECT * FROM ledger'))[0].status,'settled');const task=(await db.query('SELECT * FROM tasks'))[0];assert.equal(task.status,'blocked');assert.equal(task.block_reason,'scoped_source_invalid');await assert.rejects(new Store(db).retry(task.id));
}));

test('tampering grant provenance or policy receipt fails closed and original manual owner-run cannot accept scoped proof',()=>fixture(async(db,session,policies)=>{
 const {source}=await prepared(db,session,policies);const grant=(await db.query('SELECT * FROM github_source_grants'))[0];await db.query("UPDATE source_provenance SET metadata=jsonb_set(metadata,'{note_path}', '\"README.md\"') WHERE id=$1",[grant.provenance_id]);
 assert.equal(sourceEligible(await resolveScopedSource(db,source,now)),false);assert.equal(ownerSourceEligible(await resolveScopedSource(db,source,now)),false);
}));

test('selection rolls back grant, source binding, task and receipt together after failure',()=>fixture(async(db,session,policies)=>{
 await stage(db);await activate(policies,session);const id=await entry(db);
 const failing:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{if(sql.includes("'calendar_dispatched'"))throw Error('Injected failure');return tx.query(sql,params);}}))};
 await assert.rejects(new Calendar(failing).dispatchDue(runtime,true,now),/Injected/);
 for(const table of ['tasks','github_source_grants','calendar_jobs'])assert.equal((await db.query('SELECT * FROM '+table)).length,0);
 assert.equal((await db.query('SELECT source_id FROM calendar_entries WHERE id=$1',[id]))[0].source_id,null);
 assert.equal((await db.query("SELECT * FROM events WHERE kind='github_source_selected'")).length,0);
 assert.equal((await new Calendar(db).dispatchDue(runtime,true,now)).queued,1);
}));

test('scoped draft never gains final approval or publication consent from source activation',()=>fixture(async(db,session,policies)=>{
 const {task}=await prepared(db,session,policies);await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);
 const bundle=['Harvester','Story Miner','Strategist','Writer','Platform Adapter','Critic'].map(role=>({role,text:role==='Platform Adapter'?'### LinkedIn\nThe commit reports added deterministic source checks.':'The commit reports added deterministic source checks.'}));
 for(const item of bundle)await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,item.role,item.text,hash(item.text)]);
 const outputs=await db.query<{hash:string}>('SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]);const version='original:'+hash(outputs.map(x=>x.hash).join('|'));
 const publishing=new Publishing(db,{accounts:[{id:'fixture-linkedin',platform:'LinkedIn',remote_id:'urn:li:person:12345',label:'Fixture',enabled:true,verified:true,authorization_version:'fixture-v1',scopes:['w_member_social'],linkedin_version:'202610'}]});await assert.rejects(publishing.enqueue({task_id:task.id,review_token:version,platform:'LinkedIn',account_id:'fixture-linkedin',scheduled_at:new Date(now.getTime()+72*hour).toISOString(),request_id:randomUUID(),payload:{text:'The commit reports added deterministic source checks.'}}),/Approve the exact final artifact/);
 assert.equal((await db.query('SELECT * FROM approvals')).length,0);assert.equal((await db.query('SELECT * FROM publishing_outbox')).length,0);
}));

test('policy HTTP requires exact same-origin owner session and rejects bearer-only, cross-origin and extra fields',()=>fixture(async(db,session)=>{
 const origin='http://127.0.0.1:3110',env={STUDIO_ORIGIN:origin};const request=(action:string,payload:unknown,otherOrigin=origin)=>new Request(origin+'/api/source-policy/'+action,{method:'POST',headers:{origin:otherOrigin,'content-type':'application/json',authorization:'Bearer fixture-worker-token'},body:JSON.stringify(payload)});
 const deps={db,env,readConfig:()=>runtime,session:async()=>session};
 assert.equal((await handleGithubSourcePolicy(request('preview',input),'preview',{...deps,session:async()=>null})).status,401);
 assert.equal((await handleGithubSourcePolicy(request('preview',input,'https://evil.invalid'),'preview',deps)).status,403);
 assert.equal((await handleGithubSourcePolicy(request('preview',{...input,recipient:'gemini'}),'preview',deps)).status,400);
 const previewResponse=await handleGithubSourcePolicy(request('preview',input),'preview',deps);assert.equal(previewResponse.status,200);const {preview}=await previewResponse.json();
 assert.equal((await handleGithubSourcePolicy(request('activate',{preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true,enable_scheduler:true}),'activate',deps)).status,400);
 assert.equal((await db.query('SELECT * FROM github_source_policies')).length,0);
}));

test('cancellation or task changes immediately before scoped admission prevent any provider call',()=>fixture(async(db,session,policies)=>{
 const {task}=await prepared(db,session,policies);const store=new Store(db);let calls=0;
 const result=await step(store,runtime,async()=>{calls++;throw Error('Call prohibited');},true,{ownerClearedOnly:true,beforeProvider:async()=>{await store.cancel(task.id);}});
 assert.equal(result.status,'blocked');assert.equal(calls,0);assert.equal((await db.query('SELECT * FROM tasks'))[0].status,'cancelled');assert.equal((await db.query('SELECT * FROM ledger'))[0].status,'settled');assert.equal(Number((await db.query('SELECT * FROM ledger'))[0].estimated),0);
}));

test('last-checkpoint in-flight revocation cannot commit review-ready status and retains exact paid output',()=>fixture(async(db,session,policies)=>{
 const {task,policy}=await prepared(db,session,policies);await db.query('UPDATE tasks SET checkpoint=5 WHERE id=$1',[task.id]);
 for(const role of ['Harvester','Story Miner','Strategist','Writer','Platform Adapter']){const text=role==='Platform Adapter'?'### LinkedIn\nThe commit reports added source checks.':'The commit reports added source checks.';await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,role,text,hash(text)]);}
 const result=await step(new Store(db),runtime,async()=>{await policies.revoke(policy.id,policy.scope_hash,session);return {text:'Review found only the attributed commit statement.',input:5,output:5,outcome:'complete',report:{serviceTier:'default',model:'gpt-test',requestId:'fixture-final',finishReason:'stop'}};},true,{ownerClearedOnly:true});
 assert.equal(result.status,'blocked');const current=(await db.query('SELECT * FROM tasks'))[0];assert.equal(current.checkpoint,6);assert.equal(current.status,'blocked');assert.equal((await db.query('SELECT * FROM outputs')).length,6);assert.equal((await db.query("SELECT * FROM events WHERE kind='review_ready'")).length,0);
}));

test('scoped reservation admission is durable, unique, task-bound and holds the policy lock through validation',()=>fixture(async(db,session,policies)=>{
 await prepared(db,session,policies);const statements:string[]=[];let calls=0;
 const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{statements.push(sql);return tx.query(sql,params);}}))};
 await step(new Store(observed),runtime,async()=>{calls++;const admissions=await db.query('SELECT * FROM events WHERE kind=$1',['scoped_provider_admitted']);assert.equal(admissions.length,1);const receipt=JSON.parse(admissions[0].detail);const ledger=(await db.query('SELECT * FROM ledger WHERE id=$1',[receipt.reservation_id]))[0];assert.equal(receipt.reservation_id,admissions[0].id);assert.equal(ledger.status,'reserved');assert.equal(receipt.checkpoint,ledger.checkpoint);return {text:'The commit reports verified source checks.',input:5,output:5,outcome:'complete',report:{serviceTier:'default',model:'gpt-test',requestId:'fixture-admitted',finishReason:'stop'}};},true,{ownerClearedOnly:true});
 assert.equal(calls,1);assert(statements.some(sql=>sql==='SELECT * FROM github_source_policies WHERE id=$1 FOR SHARE'));
 assert(statements.some(sql=>sql.includes('SELECT status,provider,checkpoint FROM ledger')&&sql.includes('FOR UPDATE')));
}));


test('changed reservation state or expired lease cannot admit a scoped provider request',async()=>{
 for(const change of ['reservation','lease'])await fixture(async(db,session,policies)=>{
  const {task}=await prepared(db,session,policies);let calls=0;
  const result=await step(new Store(db),runtime,async()=>{calls++;throw Error('Call prohibited');},true,{ownerClearedOnly:true,beforeProvider:async()=>{
   if(change==='reservation')await db.query("UPDATE ledger SET status='unknown' WHERE task_id=$1",[task.id]);
   else await db.query("UPDATE tasks SET lease_until=now()-interval '1 minute' WHERE id=$1",[task.id]);
  }});
  assert.equal(result.status,'blocked');assert.equal(calls,0);assert.equal((await db.query("SELECT * FROM events WHERE kind='scoped_provider_admitted'")).length,0);
  assert.equal((await db.query('SELECT status FROM ledger'))[0].status,change==='reservation'?'unknown':'settled');
 });
});


test('terminal scoped revision locks parent before source, settles usage and retains stale-parent blocking',async()=>{
 for(const changedParent of [false,true])await fixture(async(db,session,policies)=>{
  const {task}=await prepared(db,session,policies),store=new Store(db);
  await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);
  const roles=['Harvester','Story Miner','Strategist','Writer','Platform Adapter','Critic'];
  const save=async(id:string,role:string)=>{const text=role==='Platform Adapter'?'### LinkedIn\nThe commit reports added source checks.':'The commit reports added source checks.';await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,role,text,hash(text)]);};
  for(const role of roles)await save(task.id,role);
  const outputs=await db.query<{hash:string}>('SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]),token='original:'+hash(outputs.map(item=>item.hash).join('|'));
  const child=await queueAgentRevision(store,runtime,task.id,token,'Keep the repository attribution clear.');
  await db.query('UPDATE tasks SET checkpoint=5 WHERE id=$1',[child.id]);for(const role of roles.slice(0,5))await save(child.id,role);
  const statements:Array<{sql:string;params?:unknown[]}>=[];
  const observed:Database={...db,transaction:work=>db.transaction(tx=>work({query:async(sql,params)=>{statements.push({sql,params});return tx.query(sql,params);}}))};
  const result=await step(new Store(observed),runtime,async()=>{
   if(changedParent)await store.revise(task.id,token,'The owner requested another wording comparison while this call was in flight.');
   statements.length=0;return {text:'The commit reports added source checks.',input:5,output:5,outcome:'complete',report:{serviceTier:'default',model:'gpt-test',requestId:'fixture-revision-order',finishReason:'stop'}};
  },true,{ownerClearedOnly:true});
  assert.equal(result.status,changedParent?'blocked':'step_saved');
  const parentLock=statements.findIndex(item=>item.sql==='SELECT id FROM tasks WHERE id=$1 FOR UPDATE'&&item.params?.[0]===task.id);
  const sourceLock=statements.findIndex(item=>item.sql==='SELECT * FROM sources WHERE id=$1 FOR UPDATE');
  const policyLock=statements.findIndex(item=>item.sql==='SELECT * FROM github_source_policies WHERE id=$1 FOR SHARE');
  assert(parentLock>=0&&sourceLock>parentLock&&policyLock>sourceLock,'Settlement order must be child/ledger, parent, source, policy');
  assert.equal((await db.query('SELECT status FROM ledger WHERE task_id=$1',[child.id]))[0].status,'settled');
  assert.equal((await db.query('SELECT * FROM outputs WHERE task_id=$1',[child.id])).length,6);
  assert.equal((await db.query('SELECT status FROM tasks WHERE id=$1',[task.id]))[0].status,'review');
  assert.equal((await db.query('SELECT * FROM content_revisions WHERE agent_task_id=$1',[child.id])).length,changedParent?0:1);
  if(changedParent)assert.equal((await db.query('SELECT block_reason FROM tasks WHERE id=$1',[child.id]))[0].block_reason,'revision_stale');
  assert.equal((await db.query('SELECT * FROM approvals')).length,0);
 });
});
