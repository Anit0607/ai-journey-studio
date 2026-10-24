import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync} from 'node:crypto';
import type {Connection,Database} from '../lib/db';
import {hash,type Source} from '../lib/domain';
import {SourceIngestion,sourceIngestionStatus,type SourceIngestionConfig,type SourceIngestionDependencies} from '../lib/source-ingestion';
import {createGitHubAppCredentialResolver,GITHUB_APP_PRIVATE_KEY_ENV} from '../lib/github-app-auth';
import {SCOPED_GITHUB_REPOSITORY as repository,GITHUB_HASH_PINNED_TEXT_PATH as path,GITHUB_HASH_PINNED_TEXT_SHA256 as digest,GITHUB_HASH_PINNED_TEXT_PROFILE,validateGithubBuildNote,validateGithubHashPinnedText} from '../lib/github-source-boundary';
import {githubEvidenceEligibility,normalizeGithubScope,type Provenance} from '../lib/github-source-policy';
const raw=readFileSync(new URL('./fixtures/github-hash-pinned-progress-2026-10-24.txt',import.meta.url),'utf8');
const sha='a'.repeat(40),root='d'.repeat(40),docs='e'.repeat(40),notes='f'.repeat(40),timestamp='2026-10-24T06:00:00.000Z',now=()=>new Date('2026-10-24T07:00:00.000Z');
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
const blob=(text=raw)=>{const b=Buffer.from(text);return {type:'file',path,encoding:'base64',size:b.length,content:b.toString('base64'),sha:createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'),download_url:'https://do-not-follow.invalid/file'};};
const config=():SourceIngestionConfig=>({github:{enabled:true,sync_authorized:true,private_read_authorized:true,repositories:[repository],intake_mode:'notes_only',notes:{enabled:true,paths:[path],commit_sha:sha,profile:{kind:'hash_pinned_text',path,sha256:digest}}}});
/** Lightweight storage double: exercises the real intake without a PGlite VM. */
class MemoryDatabase implements Database{
  kind="pglite" as const;
  sources:Source[]=[];
  provenance:Record<string,any>[]=[];
  events:unknown[]=[];
  state:Record<string,any>|undefined;
  async close(){}
  async transaction<T>(work:(tx:Connection)=>Promise<T>):Promise<T>{return work(this);}
  async query<T=Record<string,any>>(sql:string,params:unknown[]=[]):Promise<T[]>{
    let result:unknown[]=[];
    if(sql.startsWith("SELECT provider,scope,last_attempted_at"))result=this.state?[this.state]:[];
    else if(sql.startsWith("INSERT INTO source_sync_state"))this.state||={provider:params[0],scope:params[1],cursor:{}};
    else if(sql.startsWith("UPDATE source_sync_state SET lease_token")){this.state={...this.state,lease_token:params[2]};result=[this.state];}
    else if(sql.startsWith("SELECT * FROM source_sync_state"))result=this.state?[this.state]:[];
    else if(sql.startsWith("UPDATE source_sync_state SET cursor"))this.state!.cursor=JSON.parse(String(params[3]));
    else if(sql.startsWith("UPDATE source_sync_state SET last_synced_at"))this.state!.lease_token=null;
    else if(sql.startsWith("UPDATE source_sync_state SET last_error")){this.state!.last_error=params[3];this.state!.lease_token=null;}
    else if(sql.startsWith("SELECT pg_advisory_xact_lock"))result=[];
    else if(sql.startsWith("SELECT id FROM source_provenance"))result=this.provenance.filter(row=>row.provider===params[0]&&row.scope===params[1]&&row.external_id===params[2]&&row.content_hash===params[3]);
    else if(sql.startsWith("SELECT * FROM sources WHERE hash"))result=this.sources.filter(row=>row.hash===params[0]);
    else if(sql.startsWith("INSERT INTO sources")){
      const existing=this.sources.find(row=>row.hash===params[4]);
      if(!existing){const row={id:String(params[0]),text:String(params[1]),category:String(params[2]),reported_date:String(params[3]),cleared:false,hash:String(params[4])};this.sources.push(row);result=[row];}
    }else if(sql.startsWith("INSERT INTO source_provenance")){
      const row={id:params[0],source_id:params[1],provider:params[2],scope:params[3],external_id:params[4],content_hash:params[5],source_url:params[6],metadata:JSON.parse(String(params[7]))};this.provenance.push(row);result=[row];
    }else if(sql.startsWith("INSERT INTO events"))this.events.push(JSON.parse(String(params.length===3?params[2]:params[1])));
    else throw Error("Unexpected test SQL: "+sql);
    return result as T[];
  }
}


async function ingest(options:{config?:SourceIngestionConfig;db?:MemoryDatabase;text?:string;transform?:(url:URL,payload:Record<string,any>)=>Response;deps?:Omit<SourceIngestionDependencies,'fetch'>}={}){
 const db=options.db||new MemoryDatabase(),calls:URL[]=[],c=options.config||config(),file=blob(options.text);
 const service=new SourceIngestion(db,c,{now,env:{},...options.deps,fetch:async(input,init)=>{
  const url=new URL(String(input));calls.push(url);assert.equal(url.origin,'https://api.github.com');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  assert(!url.pathname.endsWith('/commits'),'No list-commits endpoint in file-only mode');assert(!/\/repos\/[^/]+\/[^/]+\/commits\//.test(url.pathname),'No patch-bearing commit endpoint');
  let payload:Record<string,any>;
  if(url.pathname===`/repos/${repository}`)payload={id:101,full_name:repository,private:false,visibility:'public'};
  else if(url.pathname===`/repos/${repository}/git/commits/${sha}`)payload={sha,committer:{date:timestamp},tree:{sha:root},message:'NOT IMPORTED',author:{email:'not imported'}};
  else if(url.pathname.includes('/git/trees/')){assert.equal(url.search,'');const id=url.pathname.split('/').at(-1);payload={sha:id,truncated:false,tree:id===root?[{path:'docs',mode:'040000',type:'tree',sha:docs}]:id===docs?[{path:'build-notes',mode:'040000',type:'tree',sha:notes}]:id===notes?[{path:path.split('/').at(-1),mode:'100644',type:'blob',sha:file.sha},{path:'other.md',mode:'100644',type:'blob',sha:'9'.repeat(40)}]:assert.fail('Unexpected tree')};}
  else {assert.equal(url.pathname,`/repos/${repository}/contents/${path}`);assert.equal(url.search,`?ref=${sha}`);payload=file;}
  return options.transform?.(url,payload)||json(payload);
 }});
 return {db,calls,result:await service.sync('github')};
}

test('exact approved paragraph has its original 501 bytes/hash and remains outside the structured parser',()=>{
 assert.equal(Buffer.byteLength(raw),501);assert.equal(hash(raw),digest);assert.equal(blob().sha,'25385171b69e4adfc922c4e0d78f873a9431bd1f');
 assert.equal(validateGithubHashPinnedText(raw,repository,sha,path,digest),raw);assert.throws(()=>validateGithubBuildNote(raw,repository,sha),/sections_invalid/);
 for(const changed of [raw.trim(),raw+'\n',raw.replace('25','26'),'\ufeff'+raw])assert.throws(()=>validateGithubHashPinnedText(changed,repository,sha,path,digest),/raw_hash_mismatch/);
});

test('notes-only stages exactly the pinned file with authentic profile provenance, no commits, clearance or cursor advance',async()=>{
 const db=new MemoryDatabase();const cursor={configuration:'old',since:'2026-10-01T00:00:00.000Z',page:2};db.state={provider:'github',scope:repository,cursor};
 const {calls,result}=await ingest({db});assert.equal(result.status,'synced');assert.equal(result.providers[0].staged,1);assert.equal(result.providers[0].has_more,false);assert.deepEqual(db.state.cursor,cursor);
 assert.deepEqual(result.providers[0].github_read_counts,{repository:1,commit_pages:0,commit_resolution:1,tree_metadata:3,note_contents:1,total:6});assert.equal(calls.length,6);
 assert.equal(db.sources.length,1);assert.equal(db.provenance.length,1);const s=db.sources[0],p=db.provenance[0];assert.equal(s.cleared,false);assert.equal(s.clearance_id,undefined);
 const prefix=`Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: ${repository}\nCommit: ${sha}\nNote: ${path}\n\n`;
 assert.equal(s.text,prefix+raw);assert.equal(hash(s.text.slice(prefix.length)),digest);assert.equal(p.source_url,`https://github.com/${repository}/blob/${sha}/${path}`);assert.equal(p.external_id,`${sha}:${path}`);
 assert.equal(p.metadata.content_kind,'hash_pinned_text');assert.equal(p.metadata.content_profile,GITHUB_HASH_PINNED_TEXT_PROFILE);assert.equal(p.metadata.profile_path,path);assert.equal(p.metadata.expected_raw_sha256,digest);assert.equal(p.metadata.raw_sha256,digest);assert.equal(p.metadata.raw_bytes,501);assert.equal(p.metadata.blob_sha,blob().sha);assert.equal(p.metadata.root_tree_sha,root);assert.equal(p.metadata.content_digest,s.hash);assert.equal(p.metadata.evidence_digest,digest);
 assert(!JSON.stringify(db).includes('NOT IMPORTED'));assert(!JSON.stringify(db).includes('not imported'));assert(!JSON.stringify(db).includes('do-not-follow'));
 const again=await ingest({db});assert.equal(again.result.providers[0].duplicates,1);assert.equal(db.sources.length,1);assert.equal(db.provenance.length,1);assert.deepEqual(db.state.cursor,cursor);
});

test('unknown mode/profile, missing immutable pin, wrong hash/path or extra paths fail before credentials/network',async()=>{
 const changes:((c:SourceIngestionConfig)=>void)[]=[c=>{c.github!.intake_mode='unknown' as never;},c=>{delete c.github!.notes!.commit_sha;},c=>{c.github!.notes!.commit_sha='main';},c=>{c.github!.notes!.enabled=false;},c=>{c.github!.notes!.paths=[];},c=>{c.github!.notes!.paths=[path,'docs/build-notes/other.md'];},c=>{c.github!.notes!.paths=['docs/build-notes/*.md'];},c=>{c.github!.notes!.profile!.kind='unknown' as never;},c=>{c.github!.notes!.profile!.sha256='0'.repeat(64);},c=>{c.github!.notes!.profile!.path='docs/build-notes/other.md';},c=>{Object.assign(c.github!.notes!.profile!,{cleared:true});},c=>{c.github!.intake_mode='commits_and_notes';},c=>{delete c.github!.intake_mode;},c=>{c.github!.private_read_authorized=false;},c=>{c.github!.sync_authorized=false;},c=>{c.github!.repositories=[repository,'other/repo'];}];
 for(const change of changes){const c=config();change(c);assert.equal(sourceIngestionStatus(c)[0].ready,false);const result=await ingest({config:c,deps:{githubCredential:async()=>assert.fail('No credential access')}});assert.equal(result.result.status,'blocked');assert.equal(result.calls.length,0);assert.equal(result.db.sources.length,0);}
});

test('wrong content, BOM, changed newline and valid but wrong Git blob never stage or fall back to structured/plain imports',async()=>{
 for(const text of [raw.trim(),raw+'\n',raw.replace('25','26'),'\ufeff'+raw,'private client material']){const x=await ingest({text});assert.equal(x.result.providers[0].staged,0);assert.equal(x.result.providers[0].rejected_reasons?.github_note_raw_hash_mismatch,1);assert.equal(x.db.sources.length,0);assert.equal(x.calls.length,6);}
 const plain=config();delete plain.github!.notes!.profile;const x=await ingest({config:plain});assert.equal(x.db.sources.length,0);assert.equal(x.result.providers[0].rejected_reasons?.github_note_sections_invalid,1);
});

test('structured notes-only mode reuses the unmodified parser and does not import commits',async()=>{
 const c=config();delete c.github!.notes!.profile;const text=`## Verified progress\n- Verified one source-linked draft.\n\n## Evidence\n- https://github.com/${repository}/commit/${sha}`;
 const x=await ingest({config:c,text});assert.equal(x.result.providers[0].staged,1);assert.equal(x.db.provenance[0].metadata.content_kind,'build_note');assert.equal(x.db.provenance[0].metadata.content_profile,undefined);assert.equal(x.calls.length,6);
});

test('commit identity/date, tree/blob authority, regular file type and transport bounds fail closed',async()=>{
 const changes:[string,(p:Record<string,any>)=>Record<string,any>][]=[['/git/commits/',p=>({...p,sha:'b'.repeat(40)})],['/git/commits/',p=>({...p,committer:{date:'2099-01-01T00:00:00Z'}})],['/git/commits/',p=>({...p,tree:{sha:'main'}})],['/git/trees/',p=>({...p,truncated:true})],['/git/trees/',p=>({...p,tree:p.tree.map((x:object)=>({...x,mode:'120000',type:'blob'}))})],['/git/trees/',p=>({...p,tree:p.tree.map((x:object)=>({...x,mode:'160000',type:'commit'}))})],['/contents/',p=>({...p,path:'docs/build-notes/other.md'})],['/contents/',p=>({...p,target:'../../other'})],['/contents/',p=>({...p,submodule_git_url:'https://example.invalid'})],['/contents/',p=>({...p,size:8193})],['/contents/',p=>({...p,sha:'9'.repeat(40)})],['/contents/',p=>({...p,content:'not base64'})]];
 for(const [part,change] of changes){const x=await ingest({transform:(u,p)=>json(u.pathname.includes(part)?change(p):p)});assert.equal(x.db.sources.length,0);assert.equal(x.db.provenance.length,0);assert(!x.calls.some(u=>u.pathname.endsWith('/commits')));}
 for(const status of [401,403])for(const part of ['/git/commits/','/git/trees/','/contents/']){const x=await ingest({transform:(u,p)=>u.pathname.includes(part)?json({message:'not stored'},status):json(p)});assert.equal(x.result.providers[0].error,'provider_access_denied');assert.equal(x.db.sources.length,0);assert(!JSON.stringify(x.db).includes('not stored'));}
});

test('hash-pinned provenance cannot inherit a structured-note auto-clearance grant or be forged into one',async()=>{
 const x=await ingest(),source=x.db.sources[0],p=x.db.provenance[0] as Provenance,scope=normalizeGithubScope({repository,commit_summaries:false,note_paths:[path],start_date:'2026-10-24'},now());
 assert.deepEqual(githubEvidenceEligibility(source,p,scope,now()),{eligible:false,reason:'Hash-pinned text requires separate exact owner source clearance'});
 for(const metadata of [{...p.metadata,content_profile:'unknown'},{...p.metadata,raw_sha256:'0'.repeat(64)},{...p.metadata,expected_raw_sha256:'0'.repeat(64)},{...p.metadata,profile_path:'other'},{...p.metadata,raw_bytes:1},{...p.metadata,content_kind:'build_note'},{...p.metadata,content_kind:'build_note',content_profile:undefined}])assert.equal(githubEvidenceEligibility(source,{...p,metadata},scope,now()).eligible,false);
 assert.equal(source.cleared,false);
});

test('notes-only preserves branded App repository authority and rejects wrong ID or unbranded pull:false without fallback',async()=>{
 const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString(),app={authorized:true,app_id:7,installation_id:9,selected_repository_ids:[101]};
 const credential=createGitHubAppCredentialResolver(app,[repository],{now,env:{[GITHUB_APP_PRIVATE_KEY_ENV]:pem},fetch:async(_input,init)=>init?.method==='POST'?json({token:'fixture-app-token',expires_at:'2026-10-24T08:00:00Z',permissions:{contents:'read',metadata:'read'},repository_selection:'selected',repositories:[{id:101,full_name:repository,owner:{login:'anit0607',id:11}}]},201):json({id:9,app_id:7,account:{login:'anit0607',id:11,type:'User'},suspended_at:null,repository_selection:'selected'})});
 for(const id of [101,999]){const x=await ingest({deps:{githubCredential:credential,env:{STUDIO_SOURCE_GITHUB_TOKEN:'fixture-default-token'}},transform:(u,p)=>json(u.pathname===`/repos/${repository}`?{...p,id,private:true,visibility:'private',permissions:{pull:false}}:p)});assert.equal(x.db.sources.length,id===101?1:0);if(id!==101){assert.equal(x.result.providers[0].error,'github_app_repository_response_mismatch');assert.equal(x.calls.length,1);}}
 const bad=await ingest({deps:{githubCredential:async()=> 'fixture-unbranded'},transform:(u,p)=>json(u.pathname===`/repos/${repository}`?{...p,private:true,visibility:'private',permissions:{pull:false}}:p)});assert.equal(bad.result.providers[0].error,'repository_read_permission_required');assert.equal(bad.calls.length,1);assert.equal(bad.db.sources.length,0);
});
