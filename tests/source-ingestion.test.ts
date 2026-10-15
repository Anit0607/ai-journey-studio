import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {embedded,type Database} from "../lib/db";
import {hash,type Source} from "../lib/domain";
import {SourceIntake,sourceEligible} from "../lib/sources";
import {SOURCE_INGESTION_SCHEMA} from "../lib/source-ingestion-schema";
import {SourceIngestion,sourceIngestionStatus,parseChatExport,CHAT_IMPORT_MAX_BYTES,type SourceIngestionConfig} from "../lib/source-ingestion";

const date="2026-10-14T12:00:00.000Z",now=()=>new Date("2026-10-15T00:00:00.000Z");
const channelId="UC"+"a".repeat(22),videoId="a".repeat(11),repo="builder/studio",sha="a".repeat(40);
const config:SourceIngestionConfig={github:{enabled:true,sync_authorized:true,repositories:[repo],since:"2026-10-01T00:00:00Z"},youtube:{enabled:true,sync_authorized:true,channel_ids:[channelId]},chat:{enabled:true}};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const commit=(id=sha,message="Build source-linked draft preview")=>({sha:id,commit:{message,committer:{date}}});
const video=(description="I made a source-linked outline.",privacyStatus="public")=>({id:videoId,snippet:{channelId,title:"Agent building progress",description,publishedAt:date},status:{privacyStatus}});
const normalized=(provider="chatgpt",text="I built a working outline and checked it against my notes.")=>({format:"ai-journey-chat-v1",provider,conversations:[{id:"conversation-1",title:"Build notes",reported_date:"2026-10-14",messages:[{role:"user",text},{role:"assistant",text:"Check the outline against the source."}]}]});
async function fixture(work:(db:Database)=>Promise<void>){const db=await embedded();try{for(const statement of SOURCE_INGESTION_SCHEMA.split(";").filter(s=>s.trim()))await db.query(statement);await work(db);}finally{await db.close();}}
const githubFetch=(entries:unknown[]= [commit()]):typeof fetch=>async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,"https://api.github.com");assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
  if(url.pathname.endsWith("/commits"))return json(entries);
  return json({full_name:repo,private:false,visibility:"public"});
};
const youtubeFetch=(entries:unknown[]=[video()]):typeof fetch=>async input=>{
  const url=new URL(String(input));assert.equal(url.origin,"https://www.googleapis.com");
  if(url.pathname.endsWith("/channels"))return json({items:[{id:channelId,contentDetails:{relatedPlaylists:{uploads:"UU"+"a".repeat(22)}}}]});
  if(url.pathname.endsWith("/playlistItems"))return json({items:[{contentDetails:{videoId}}]});
  return json({items:entries});
};
async function assertStagedOnly(db:Database){const sources=await db.query<Source>("SELECT * FROM sources");assert.ok(sources.length);for(const source of sources){assert.equal(source.cleared,false);assert.equal(source.clearance_id,null);assert.equal(sourceEligible(source),false);}for(const table of ["tasks","ledger","outputs","approvals"])assert.deepEqual(await db.query("SELECT * FROM "+table),[]);}

test("disabled or unapproved source sync never requests credentials or network",()=>fixture(async db=>{
  let calls=0;const env=new Proxy({}, {get(){throw Error("credentials must not be read");}}),fetcher:typeof fetch=async()=>{calls++;throw Error("unexpected");};
  const disabled=new SourceIngestion(db,{}, {env,fetch:fetcher});assert.equal((await disabled.sync()).status,"blocked");
  const unapproved=new SourceIngestion(db,{github:{enabled:true,repositories:[repo]},youtube:{enabled:true,channel_ids:[channelId]}},{env,fetch:fetcher});assert.equal((await unapproved.sync()).status,"blocked");assert.equal(calls,0);assert.deepEqual(await db.query("SELECT * FROM source_sync_state"),[]);
  assert.equal(sourceIngestionStatus(config,{}).find(c=>c.provider==="youtube")?.reason,"youtube_api_key_missing");
}));

test("GitHub official public allowlist adapter stages exact metadata, provenance and cursor only",()=>fixture(async db=>{
  const calls:URL[]=[];const service=new SourceIngestion(db,config,{now,env:{STUDIO_SOURCE_GITHUB_TOKEN:"test-token"},fetch:async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(new Headers(init?.headers).get("authorization"),"Bearer test-token");assert.equal(new Headers(init?.headers).get("x-github-api-version"),"2026-03-10");return githubFetch()(input,init);}});
  const first=await service.sync("github");assert.equal(first.providers[0].staged,1);assert.equal(first.status,"synced");assert.equal(calls.length,2);assert.equal(calls[1].searchParams.get("since"),"2026-10-01T00:00:00.000Z");assert.equal(calls[1].searchParams.get("until"),now().toISOString());
  await assertStagedOnly(db);const source=(await db.query<Source>("SELECT * FROM sources"))[0];assert.equal(source.hash,hash(source.text));assert.equal(source.reported_date,"2026-10-14");
  const provenance=(await db.query("SELECT * FROM source_provenance"))[0];assert.equal(provenance.external_id,sha);assert.equal(provenance.source_url,`https://github.com/${repo}/commit/${sha}`);assert.equal(provenance.source_id,source.id);
  const second=await service.sync("github");assert.equal(second.providers[0].duplicates,1);assert.equal((await db.query("SELECT * FROM sources")).length,1);
  const snapshot=await service.snapshot();assert.equal(snapshot.sync.length,1);assert.equal(snapshot.recent.length,1);assert.ok(snapshot.sync[0].last_synced_at);assert.equal(JSON.stringify(snapshot).includes("test-token"),false);
}));

test("GitHub refuses nonpublic repositories and ignores remote error text",()=>fixture(async db=>{
  let calls=0;const service=new SourceIngestion(db,config,{now,env:{},fetch:async()=>{calls++;return json({full_name:repo,private:true,visibility:"private"});}});
  const result=await service.sync("github");assert.equal(result.providers[0].error,"private_repository_authorization_required");assert.equal(calls,1);assert.deepEqual(await db.query("SELECT * FROM sources"),[]);
  const failed=await new SourceIngestion(db,config,{now,env:{},fetch:async()=>json({message:"token test-secret"},403)}).sync("github");assert.equal(failed.providers[0].error,"provider_access_denied");assert.equal(JSON.stringify(await db.query("SELECT * FROM source_sync_state")).includes("test-secret"),false);
}));

test("GitHub bounded pagination resumes persisted window and does not advance on failure",()=>fixture(async db=>{
  const entries=Array.from({length:100},(_,i)=>commit(i.toString(16).padStart(40,"0"),"Build iteration "+i));const requested:number[]=[];
  const service=new SourceIngestion(db,config,{now,env:{},fetch:async(input,init)=>{const url=new URL(String(input));if(!url.pathname.endsWith("/commits"))return githubFetch()(input,init);const page=Number(url.searchParams.get("page"));requested.push(page);return json(page<=2?entries:[]);}});
  const first=await service.sync("github");assert.equal(first.providers[0].has_more,true);assert.deepEqual(requested,[1,2]);assert.equal(first.providers[0].staged,100);assert.equal(first.providers[0].duplicates,100);
  const cursor=(await db.query("SELECT cursor FROM source_sync_state"))[0].cursor;assert.equal(cursor.page,3);
  await new SourceIngestion(db,config,{now,env:{},fetch:async(input,init)=>String(input).includes("/commits")?json({},429):githubFetch()(input,init)}).sync("github");assert.deepEqual((await db.query("SELECT cursor FROM source_sync_state"))[0].cursor,cursor);
  assert.equal((await service.sync("github")).providers[0].has_more,false);assert.deepEqual(requested,[1,2,3]);
}));

test("private, credential, oversize and malformed payloads are rejected without stored raw content",()=>fixture(async db=>{
  const messages=["bank operations","client update","private plan","confidential work","OPENAI_API_KEY=sample","Bearer abcdefghijklmno","x".repeat(13000)];
  const entries=messages.map((message,i)=>commit(i.toString(16).padStart(40,"0"),message));entries.push({...commit(),sha:"invalid"});
  const result=await new SourceIngestion(db,config,{now,env:{},fetch:githubFetch(entries)}).sync("github");assert.equal(result.providers[0].rejected,8);assert.deepEqual(await db.query("SELECT * FROM sources"),[]);assert.deepEqual(await db.query("SELECT * FROM source_provenance"),[]);
  const eventText=JSON.stringify(await db.query("SELECT * FROM events"));for(const message of messages)assert.equal(eventText.includes(message),false);
  const fail=await new SourceIngestion(db,config,{now,env:{},fetch:async()=>new Response("x".repeat(2_000_001))}).sync("github");assert.equal(fail.providers[0].error,"provider_response_too_large");
}));

test("YouTube uses official metadata APIs, server key header, public status and canonical provenance",()=>fixture(async db=>{
  const calls:URL[]=[];const service=new SourceIngestion(db,config,{now,env:{STUDIO_SOURCE_YOUTUBE_API_KEY:"test-only-key"},fetch:async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(new Headers(init?.headers).get("x-goog-api-key"),"test-only-key");assert.equal(url.searchParams.has("key"),false);return youtubeFetch()(input,init);}});
  const result=await service.sync("youtube");assert.equal(result.providers[0].staged,1);assert.equal(calls.length,3);assert.deepEqual(calls.map(c=>c.pathname.split("/").pop()),["channels","playlistItems","videos"]);await assertStagedOnly(db);
  assert.equal((await db.query("SELECT source_url FROM source_provenance"))[0].source_url,"https://www.youtube.com/watch?v="+videoId);
  assert.equal((await service.sync("youtube")).providers[0].duplicates,1);
  const changed=await new SourceIngestion(db,config,{now,env:{STUDIO_SOURCE_YOUTUBE_API_KEY:"test-only-key"},fetch:youtubeFetch([video("Added a source review checklist.")])}).sync("youtube");assert.equal(changed.providers[0].staged,1);assert.equal((await db.query("SELECT * FROM source_provenance")).length,2);
}));

test("YouTube handles resolve via channels.list and unlisted/private/wrong-channel content is rejected",()=>fixture(async db=>{
  const scoped={youtube:{enabled:true,sync_authorized:true,handles:["@Studioemotune"]}};const entries=[video("Sample","private"),video("Sample","unlisted"),{...video(),snippet:{...video().snippet,channelId:"UC"+"b".repeat(22)}}];
  const result=await new SourceIngestion(db,scoped,{now,env:{STUDIO_SOURCE_YOUTUBE_API_KEY:"test-key"},fetch:async(input,init)=>{const url=new URL(String(input));if(url.pathname.endsWith("/channels"))assert.equal(url.searchParams.get("forHandle"),"@Studioemotune");return youtubeFetch(entries)(input,init);}}).sync("youtube");assert.equal(result.providers[0].rejected,3);assert.deepEqual(await db.query("SELECT * FROM sources"),[]);
}));

test("target validation blocks arbitrary endpoints, traversal and excluded scope names",()=>fixture(async db=>{
  for(const repositories of [["https://evil.test/repo"],["builder/../repo"],["builder/private-notes"],["builder/confidential"],["builder/bank"]]){
    let calls=0;const result=await new SourceIngestion(db,{github:{enabled:true,sync_authorized:true,repositories}},{env:{},fetch:async()=>{calls++;throw Error();}}).sync("github");assert.equal(result.status,"blocked");assert.equal(calls,0);
  }
}));

test("scope leases prevent concurrent duplicate fetching and are released after failure",()=>fixture(async db=>{
  let calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const service=new SourceIngestion(db,config,{now,env:{},fetch:async(input,init)=>{calls++;if(calls===1)await gate;return githubFetch()(input,init);}});
  const pending=service.sync("github");while(!calls)await new Promise(resolve=>setTimeout(resolve,5));
  const concurrent=await service.sync("github");assert.equal(concurrent.providers[0].status,"busy");assert.equal(calls,1);release();assert.equal((await pending).providers[0].staged,1);assert.equal((await db.query("SELECT lease_token FROM source_sync_state"))[0].lease_token,null);
}));

test("sync selects at most two least-recently attempted scopes and propagates abort signals",()=>fixture(async db=>{
  const repos=["builder/one","builder/two","builder/three"];const visited:string[]=[];
  const service=new SourceIngestion(db,{github:{enabled:true,sync_authorized:true,repositories:repos}},{now,env:{},fetch:async(input,init)=>{assert.ok(init?.signal);const url=new URL(String(input)),scope=url.pathname.split("/").slice(2,4).join("/");if(url.pathname.endsWith("/commits"))return json([]);visited.push(scope);return json({full_name:scope,private:false,visibility:"public"});}});
  assert.equal((await service.sync("github")).providers[0].has_more,true);assert.deepEqual(visited,["builder/one","builder/two"]);await service.sync("github");assert.equal(visited[2],"builder/three");
  const controller=new AbortController();controller.abort();let calls=0;await new SourceIngestion(db,config,{signal:controller.signal,env:{},fetch:async()=>{calls++;throw Error();}}).sync("github");assert.equal(calls,0);
}));

test("all normalized chat providers stage owner-supplied exports without clearance or paid calls",()=>fixture(async db=>{
  let calls=0;const service=new SourceIngestion(db,config,{now,env:{},fetch:async()=>{calls++;throw Error();}});
  await assert.rejects(service.importChat(normalized(),false),/owner_import_acknowledgement_required/);
  for(const provider of ["chatgpt","claude","gemini","codex","spark"]){const result=await service.importChat(normalized(provider),true);assert.equal(result.staged,1);assert.equal((await service.importChat(normalized(provider),true)).duplicates,1);}
  assert.equal(calls,0);await assertStagedOnly(db);assert.equal((await db.query("SELECT * FROM source_provenance")).length,5);
  const source=(await db.query<Source>("SELECT * FROM sources WHERE text LIKE 'Imported chatgpt%'"))[0];const cleared=await new SourceIntake(db).clear(source.id,source.hash,true);await service.importChat(normalized(),true);assert.equal((await db.query<Source>("SELECT * FROM sources WHERE id=$1",[source.id]))[0].clearance_id,cleared.clearance_id);
}));

test("chat imports reject unsafe text, unsupported formats, missing selection, huge files and future dates atomically",()=>fixture(async db=>{
  const service=new SourceIngestion(db,config,{now,env:{}});
  await assert.rejects(new SourceIngestion(db,{}).importChat(normalized(),true),/chat_import_disabled/);
  for(const text of ["client project","confidential work","password=unsafe"]){await assert.rejects(service.importChat(normalized("chatgpt",text),true),/Excluded private material/);}
  assert.throws(()=>parseChatExport({format:"gemini-takeout",data:[]},now()),/unsupported_chat_export_format/);
  assert.throws(()=>parseChatExport({format:"chatgpt-export",data:[]},now()),/selected_conversations_required/);
  assert.throws(()=>parseChatExport("x".repeat(CHAT_IMPORT_MAX_BYTES+1)),/chat_export_too_large/);
  const future=normalized();future.conversations[0].reported_date="2099-01-01";await assert.rejects(service.importChat(future,true),/Invalid source date/);
  const bulk=normalized();bulk.conversations.push({...bulk.conversations[0],id:"conversation-2",messages:[{role:"user",text:"bank plan"}]});await assert.rejects(service.importChat(bulk,true),/Excluded private material/);
  assert.deepEqual(await db.query("SELECT * FROM sources"),[]);assert.deepEqual(await db.query("SELECT * FROM source_provenance"),[]);
}));

test("ChatGPT export parser follows only selected active text branch, excludes tools/system, fails closed on attachments",()=>{
  const conversation={id:"chat-1",title:"Build notes",update_time:new Date(date).getTime()/1000,current_node:"assistant",mapping:{root:{parent:null,message:{author:{role:"system"},content:{parts:["hidden"]}}},user:{parent:"root",message:{author:{role:"user"},content:{content_type:"text",parts:["I built an outline."]}}},assistant:{parent:"user",message:{author:{role:"assistant"},content:{content_type:"text",parts:["Check every claim."]}}},other:{parent:"user",message:{author:{role:"assistant"},content:{content_type:"text",parts:["private branch"]}}}}};
  const input={format:"chatgpt-export",conversation_ids:["chat-1"],data:[conversation,{id:"unselected",title:"private unrelated"}]};const result=parseChatExport(input,now());assert.equal(result.length,1);assert.ok(result[0].input.text.includes("I built an outline."));assert.equal(result[0].input.text.includes("Check every claim."),false);assert.equal(result[0].metadata?.assistant_message_count,1);assert.equal(result[0].input.text.includes("hidden"),false);assert.equal(result[0].input.text.includes("private branch"),false);
  const missing={...input,conversation_ids:["missing"]};assert.throws(()=>parseChatExport(missing,now()),/selected_conversation_missing/);
  conversation.mapping.assistant.message.content.content_type="multimodal_text";assert.throws(()=>parseChatExport(input,now()),/unsupported_chat_attachment/);
});

test("Claude export parser imports selected human and assistant text only",()=>{
  const input={format:"claude-export",conversation_ids:["chat-1"],data:[{uuid:"chat-1",name:"Build notes",created_at:date,chat_messages:[{sender:"human",text:"I built a source-linked outline."},{sender:"assistant",text:"Check the source."}]}]};
  const parsed=parseChatExport(input,now());assert.equal(parsed.length,1);assert.equal(parsed[0].provider,"claude");assert.ok(parsed[0].input.text.includes("I built a source-linked outline."));assert.equal(parsed[0].input.reported_date,"2026-10-14");
});

test("ingestion provenance and dedup survive database reopen",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"studio-ingestion-test-"));let db=await embedded(dir);
  try{for(const statement of SOURCE_INGESTION_SCHEMA.split(";").filter(s=>s.trim()))await db.query(statement);await new SourceIngestion(db,config,{now,env:{}}).importChat(normalized(),true);await db.close();db=await embedded(dir);const result=await new SourceIngestion(db,config,{now,env:{}}).importChat(normalized(),true);assert.equal(result.duplicates,1);assert.equal((await db.query("SELECT * FROM source_provenance")).length,1);await assertStagedOnly(db);}finally{await db.close();assert.ok(path.basename(dir).startsWith("studio-ingestion-test-"));await rm(dir,{recursive:true,force:true});}
});

test("explicit private-repository read authorization requires token and selected allowlist",()=>fixture(async db=>{
  const privateConfig:SourceIngestionConfig={github:{...config.github!,private_read_authorized:true}};let commits=0;
  const fetcher:typeof fetch=async(input,init)=>{if(String(input).includes("/commits")){commits++;return githubFetch()(input,init);}return json({full_name:repo,private:true,visibility:"private",permissions:{pull:true}});};
  const missingToken=await new SourceIngestion(db,privateConfig,{now,env:{},fetch:fetcher}).sync("github");assert.equal(missingToken.providers[0].error,"private_repository_authorization_required");assert.equal(commits,0);
  const authorized=await new SourceIngestion(db,privateConfig,{now,env:{STUDIO_SOURCE_GITHUB_TOKEN:"test-only-token"},fetch:fetcher}).sync("github");assert.equal(authorized.providers[0].staged,1);assert.equal(commits,1);await assertStagedOnly(db);
  const denied=await new SourceIngestion(db,privateConfig,{now,env:{STUDIO_SOURCE_GITHUB_TOKEN:"test-only-token"},fetch:async()=>json({full_name:repo,private:true,visibility:"private",permissions:{pull:false}})}).sync("github");assert.equal(denied.providers[0].error,"repository_read_permission_required");
}));

test("assistant prose and generated conversation titles cannot become source evidence",()=>fixture(async db=>{
  const input=normalized();input.conversations[0].title="I generated $100000 revenue";input.conversations[0].messages[1].text="I generated $99999 revenue with agents";
  const service=new SourceIngestion(db,config,{now,env:{}});await service.importChat(input,true);
  const source=(await db.query<Source>("SELECT * FROM sources"))[0];assert.equal(source.text.includes("100000"),false);assert.equal(source.text.includes("99999"),false);assert.ok(source.text.includes("I built a working outline"));
  const provenance=(await db.query("SELECT metadata FROM source_provenance"))[0].metadata;assert.equal(provenance.assistant_message_count,1);assert.equal(provenance.owner_message_count,1);assert.match(provenance.assistant_content_hash,/^[a-f0-9]{64}$/);
  const onlyAssistant=normalized();onlyAssistant.conversations[0].messages=onlyAssistant.conversations[0].messages.filter(m=>m.role==="assistant");await assert.rejects(service.importChat(onlyAssistant,true),/owner_messages_required/);
}));

test("a completed GitHub sweep preserves its lower bound for newly pushed backdated commits",()=>fixture(async db=>{
  const windows:string[]=[];const service=new SourceIngestion(db,config,{now,env:{},fetch:async(input,init)=>{const url=new URL(String(input));if(url.pathname.endsWith("/commits"))windows.push(url.searchParams.get("since")!);return githubFetch()(input,init);}});
  await service.sync("github");await service.sync("github");assert.deepEqual(windows,["2026-10-01T00:00:00.000Z","2026-10-01T00:00:00.000Z"]);
}));

test("page failure reports already committed progress and preserves restart cursor",()=>fixture(async db=>{
  const entries=Array.from({length:100},(_,i)=>commit(i.toString(16).padStart(40,"0"),"Build iteration "+i));
  const service=new SourceIngestion(db,config,{now,env:{},fetch:async(input,init)=>{const url=new URL(String(input));if(!url.pathname.endsWith("/commits"))return githubFetch()(input,init);return url.searchParams.get("page")==="1"?json(entries):json({},429);}});
  const result=await service.sync("github");assert.equal(result.providers[0].status,"partial");assert.equal(result.providers[0].staged,100);assert.equal(result.providers[0].error,"provider_rate_limited");assert.equal((await db.query("SELECT cursor FROM source_sync_state"))[0].cursor.page,2);
}));

test('GitHub App resolver is allowlist-bound and called only with explicit private-read authorization',()=>fixture(async db=>{
 let credentials=0;const resolve=async(repository:string)=>{assert.equal(repository,repo);credentials++;return 'isolated-app-token';};
 const service=new SourceIngestion(db,{github:{...config.github!,private_read_authorized:true}},{now,env:{},githubCredential:resolve,fetch:async(input,init)=>{assert.equal(new Headers(init?.headers).get('authorization'),'Bearer isolated-app-token');const url=new URL(String(input));return url.pathname.endsWith('/commits')?json([commit()]):json({full_name:repo,private:true,visibility:'private',permissions:{pull:true}});}});
 assert.equal((await service.sync('github')).providers[0].staged,1);assert.equal(credentials,2);await assertStagedOnly(db);
 const publicService=new SourceIngestion(db,{github:config.github},{now,env:{},githubCredential:async()=>{throw Error('must not request app credential');},fetch:githubFetch()});assert.equal((await publicService.sync('github')).status,'synced');
}));
