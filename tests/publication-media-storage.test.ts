import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embedded,type Database} from '../lib/db';
import {Store} from '../lib/store';
import {SourceIntake} from '../lib/sources';
import {hash,ROLES,type Output} from '../lib/domain';
import {variantFixture} from './variant-fixture';
import {renderApprovedInstagram,approvePublicMedia} from '../lib/publication-media';
import {Publishing,type PublishRow} from '../lib/publishing';
import {PublicationMediaStorage,mediaPublicUrl,mediaStorageStatus,type MediaStorageConfig} from '../lib/publication-media-storage';
const origin='https://isolated.public.blob.vercel-storage.com',caption='Proposed approach: review one small workflow.';
const config:MediaStorageConfig={enabled:true,upload_authorized:true,credential_use_authorized:true,public_origin:origin,auth_mode:'token',credential_env:'STUDIO_MEDIA_OWNER_TOKEN',sentinel_path:'studio-store.txt',hobby_plan_verified:true,monthly_upload_limit:100,monthly_byte_limit:10000000};
const env={STUDIO_MEDIA_OWNER_TOKEN:'isolated-fixture'};
async function seed(db:Database){
 const intake=new SourceIntake(db),store=new Store(db),source=await intake.stage({text:'I built a small workflow and reviewed the source.',category:'build-log',reported_date:new Date().toISOString().slice(0,10)});await intake.clear(source.id,source.hash,true);const task=await store.enqueue(source.id);
 for(const role of ROLES){const text=role==='Platform Adapter'?variantFixture(caption):role==='Critic'?'Unsupported claims: none\nEvidence needed: none\nProposed advice: review the source':caption;await db.query('INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)',[randomUUID(),task.id,role,text,hash(text)]);}
 await db.query("UPDATE tasks SET checkpoint=6,status='review' WHERE id=$1",[task.id]);const outputs=await db.query<Output>('SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]),version=hash(outputs.map(r=>r.hash).join('|'));await store.approve(task.id,version);const token='original:'+version;
 const media=await renderApprovedInstagram(db,task.id,token),payload={text:caption,media:[{url:mediaPublicUrl(config,media.sha256)!,sha256:media.sha256,mime_type:'image/jpeg' as const}]};
 const publishing=new Publishing(db,{accounts:[{id:'instagram_owner',platform:'Instagram',remote_id:'123',label:'Isolated',enabled:true,verified:true,authorization_version:'one',scopes:[]}]});
 const row=await publishing.enqueue({request_id:randomUUID(),task_id:task.id,review_token:token,platform:'Instagram',account_id:'instagram_owner',scheduled_at:new Date().toISOString(),payload});
 await publishing.approve(row.id,row.version,true);const claimed=(await db.query<PublishRow>("UPDATE publishing_outbox SET status='claimed',claim_token=$2 WHERE id=$1 RETURNING *",[row.id,randomUUID()]))[0];return {media,payload,claimed,intake,source};
}
test('storage configuration requires bounded spend/plan and exact approved authentication route',()=>{
 assert.equal(mediaStorageStatus(config,env).ready,true);assert.equal(mediaStorageStatus({...config,hobby_plan_verified:false},env).ready,false);assert.equal(mediaStorageStatus({...config,sentinel_path:'https://wrong.test'},env).ready,false);assert.equal(mediaStorageStatus(config,{...env,VERCEL_BLOB_API_URL:'https://wrong.test'}).ready,false);
 assert.equal(mediaStorageStatus({...config,auth_mode:'oidc',store_id:'store_isolated'},{VERCEL_OIDC_TOKEN:'isolated-token'}).ready,true);assert.equal(mediaStorageStatus({...config,auth_mode:'oidc',store_id:'other'},{VERCEL_OIDC_TOKEN:'isolated-token'}).ready,false);
});
test('exact public consent and claimed publication are required before upload; bytes and no-overwrite verified',async()=>{
 const db=await embedded();try{const f=await seed(db);let uploads=0;const storage=new PublicationMediaStorage(db,config,env,{head:async()=>({url:origin+'/studio-store.txt'} as any),put:async(path,bytes,options)=>{uploads++;assert.equal(path,'publication-media/'+f.media.sha256+'.jpg');assert.deepEqual(Buffer.from(bytes as Buffer),f.media.bytes);assert.equal(options.allowOverwrite,false);assert.equal(options.addRandomSuffix,false);return {url:f.payload.media[0].url,contentType:'image/jpeg'} as any;},fetch:async()=>new Response(new Uint8Array(f.media.bytes),{headers:{'content-type':'image/jpeg'}})});
 await assert.rejects(storage.ensure(f.payload.media[0],f.claimed),/Separate exact public-media consent/);assert.equal(uploads,0);
 await approvePublicMedia(db,f.media.id,f.media.sha256,origin,true);assert.equal(await storage.ensure(f.payload.media[0],f.claimed),true);assert.equal(uploads,1);assert.equal(await storage.ensure(f.payload.media[0],f.claimed),true);assert.equal(uploads,1);
 await f.intake.revoke(f.source.id,f.source.hash);await assert.rejects(storage.ensure(f.payload.media[0],f.claimed));assert.equal(uploads,1);
 }finally{await db.close();}
});
test('wrong-store token, ambiguous upload, mismatched bytes and exhausted caps never overwrite or retry',async()=>{
 const db=await embedded();try{const f=await seed(db);await approvePublicMedia(db,f.media.id,f.media.sha256,origin,true);let uploads=0;const put=async()=>{uploads++;throw Error('ambiguous isolated transport');};
 const wrong=new PublicationMediaStorage(db,config,env,{head:async()=>({url:'https://other.public.blob.vercel-storage.com/studio-store.txt'} as any),put});assert.equal(await wrong.ensure(f.payload.media[0],f.claimed),false);assert.equal(uploads,0);
 const storage=new PublicationMediaStorage(db,config,env,{head:async()=>({url:origin+'/studio-store.txt'} as any),put,fetch:async()=>new Response('wrong',{headers:{'content-type':'image/jpeg'}})});assert.equal(await storage.ensure(f.payload.media[0],f.claimed),false);assert.equal(uploads,1);assert.equal(await storage.ensure(f.payload.media[0],f.claimed),false);assert.equal(uploads,1);assert.equal((await db.query('SELECT status FROM media_uploads'))[0].status,'uncertain');
 }finally{await db.close();}
});
