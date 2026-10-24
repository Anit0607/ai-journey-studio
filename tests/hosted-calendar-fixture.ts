import {randomUUID} from "node:crypto";
import type {Database} from "../lib/db";
import {type RuntimeConfig,type Source,type Task,ROLES,hash} from "../lib/domain";
import {SourceIngestion} from "../lib/source-ingestion";
import {GithubSourcePolicies} from "../lib/github-source-policy";
import {SCOPED_GITHUB_REPOSITORY} from "../lib/github-source-boundary";
import {OWNER_ID} from "../lib/owner-password";
import {Calendar} from "../lib/calendar";
import {NEW_PLATFORM_POLICY} from "../lib/platform-policy";

export async function scopedFixture(db:Database,config:RuntimeConfig,now=new Date(),ordinal=1){
  const date=now.toISOString().slice(0,10),session={owner_id:OWNER_ID,session_id:randomUUID()};
  await db.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',\'owner@studio.local\',true,now(),now()) ON CONFLICT DO NOTHING',[OWNER_ID]);
  await db.query('INSERT INTO studio_auth_session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[session.session_id,OWNER_ID,randomUUID(),new Date(now.getTime()+8*3_600_000)]);
  const policies=new GithubSourcePolicies(db,config,()=>now);
  const preview=ordinal===1?await policies.preview({repository:SCOPED_GITHUB_REPOSITORY,commit_summaries:true,note_paths:[],start_date:date},session):undefined;
  const policy=preview?await policies.activate({preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true},session):(await db.query<any>("SELECT * FROM github_source_policies WHERE active=true"))[0];
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
  await new SourceIngestion(db,{github:{enabled:true,sync_authorized:true,repositories:[SCOPED_GITHUB_REPOSITORY],since:date+"T00:00:00Z"}},{now:()=>now,env:{},fetch:async url=>new URL(String(url)).pathname.endsWith('/commits')?json([{sha:ordinal.toString(16).padStart(40,'0'),commit:{message:'Implemented deterministic source selection with exact provenance checks for LinkedIn drafting '+ordinal,committer:{date:now.toISOString()}}}]):json({full_name:SCOPED_GITHUB_REPOSITORY,private:false,visibility:'public'})}).sync('github');
  const id=randomUUID(),post=new Date(now.getTime()+(120+(ordinal-1)*24)*3_600_000),review=new Date(post.getTime()-48*3_600_000);
  await db.query("UPDATE calendar_settings SET generation_enabled=true,generation_lead_hours=120 WHERE id=1");
  await db.query("INSERT INTO calendar_entries(id,planned_date,kind,intended_post,draft_due,review_due,generation_due,platform_schedule) VALUES($1,$2,'shortform',$3,$4,$4,$5,$6)",[id,post.toISOString().slice(0,10),post,review,now,JSON.stringify({platform_policy:NEW_PLATFORM_POLICY,LinkedIn:{intended_post:post.toISOString(),draft_due:review.toISOString(),review_due:review.toISOString()}})]);
  await new Calendar(db,120).dispatchDue(config,true,now);
  const task=(await db.query<Task>("SELECT * FROM tasks WHERE origin_key=$1",['calendar:'+id]))[0];
  if(!task)throw Error("Scoped fixture failed dispatch");
  const source=(await db.query<Source>("SELECT * FROM sources WHERE id=$1",[task.source_id]))[0];
  return {task,source,entry:id,policy,policies,session};
}
export async function parentBundle(db:Database,task:Task){
  const hashes=[];
  for(const role of ROLES){const text="Proposed approach: inspect one exact source. "+role;hashes.push(hash(text));await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  return "original:"+hash(hashes.join('|'));
}
