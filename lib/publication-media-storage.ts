import {put,head} from '@vercel/blob';
import {createHash} from 'node:crypto';
import type {Database} from './db';
import type {PublishRow,PublishingMedia} from './publishing';
import {readApprovedPublicMedia} from './publication-media';
export type MediaStorageConfig={enabled?:boolean;upload_authorized?:boolean;credential_use_authorized?:boolean;public_origin?:string;credential_env?:string;monthly_upload_limit?:number;monthly_byte_limit?:number;auth_mode?:'token'|'oidc';store_id?:string;sentinel_path?:string;hobby_plan_verified?:boolean};
export function mediaPublicOrigin(config:MediaStorageConfig):string|null {
 try {const u=new URL(config.public_origin||'');return u.protocol==='https:'&&/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname)&&u.origin===config.public_origin?u.origin:null;}catch{return null;}
}
export function mediaPublicUrl(config:MediaStorageConfig,sha:string){const origin=mediaPublicOrigin(config);return origin&&/^[a-f0-9]{64}$/.test(sha)?origin+'/publication-media/'+sha+'.jpg':null;}
export function mediaStorageStatus(config:MediaStorageConfig,env:Record<string,string|undefined>={}) {
 const slot=typeof config.credential_env==='string'&&/^STUDIO_MEDIA_[A-Z0-9_]{1,100}$/.test(config.credential_env)?config.credential_env:null;
 const oidc=config.auth_mode==='oidc'&&!!env.VERCEL_OIDC_TOKEN&&typeof config.store_id==='string'&&/^(?:store_)?[a-zA-Z0-9]+$/.test(config.store_id)&&mediaPublicOrigin(config)===('https://'+config.store_id.replace(/^store_/,'').toLowerCase()+'.public.blob.vercel-storage.com');
 const token=config.auth_mode==='token'&&!!slot&&!!env[slot]&&typeof config.sentinel_path==='string'&&/^[a-zA-Z0-9_./-]{1,200}$/.test(config.sentinel_path)&&!config.sentinel_path.includes('..')&&!config.sentinel_path.startsWith('/');
 const bounded=Number.isSafeInteger(config.monthly_upload_limit)&&config.monthly_upload_limit!>0&&config.monthly_upload_limit!<=1000&&Number.isSafeInteger(config.monthly_byte_limit)&&config.monthly_byte_limit!>0&&config.monthly_byte_limit!<=100_000_000;
 return {configured:!!mediaPublicOrigin(config),ready:config.enabled===true&&config.upload_authorized===true&&config.credential_use_authorized===true&&(oidc||token)&&bounded&&config.hobby_plan_verified===true&&!env.VERCEL_BLOB_API_URL&&!env.NEXT_PUBLIC_VERCEL_BLOB_API_URL,public_origin:mediaPublicOrigin(config),notice:'Private previews remain in the database. Public Blob upload requires separate exact-image consent, an approved publication plan and explicit server storage authorization. No store is provisioned by this setting.'};
}
export class PublicationMediaStorage {
 constructor(readonly db:Database,readonly config:MediaStorageConfig={},readonly env:Record<string,string|undefined>=process.env,readonly deps:{put?:typeof put;head?:typeof head;fetch?:typeof fetch}={}){}
 async ensure(media:PublishingMedia,context:PublishRow):Promise<boolean>{
  if(!mediaStorageStatus(this.config,this.env).ready||mediaPublicUrl(this.config,media.sha256)!==media.url)return false;
  const origin=mediaPublicOrigin(this.config)!;
  if(process.env.VERCEL_BLOB_API_URL||process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL)return false;
  const auth=this.config.auth_mode==='oidc'?{oidcToken:this.env.VERCEL_OIDC_TOKEN!,storeId:this.config.store_id!}:{token:this.env[this.config.credential_env!]!};
  if('token' in auth){try{const probe=await (this.deps.head||head)(this.config.sentinel_path!,{...auth,abortSignal:AbortSignal.timeout(10_000)});if(new URL(probe.url).origin!==origin)return false;}catch{return false;}}

  // Both independent approval boundaries must still be valid immediately before upload.
  const artifact=await readApprovedPublicMedia(this.db,media.sha256,origin,context.task_id,context.review_token);
  const permission=await this.db.query("SELECT p.id FROM publishing_outbox p JOIN publishing_approvals a ON a.outbox_id=p.id AND a.version=p.version WHERE p.id=$1 AND p.version=$2 AND p.status='claimed' AND p.claim_token=$3",[context.id,context.version,context.claim_token]);
  if(!artifact||!permission.length)return false;
  const claim=await this.db.transaction(async tx=>{
   await tx.query("SELECT id FROM media_upload_guard WHERE id=1 FOR UPDATE");
   const previous=(await tx.query<{status:string;url:string|null}>('SELECT status,url FROM media_uploads WHERE sha256=$1 AND public_origin=$2',[media.sha256,origin]))[0];
   if(previous)return previous.status==='uploaded'?{existing:previous.url}:null;
   const totals=(await tx.query<{count:string;bytes:string}>("SELECT COUNT(*)::text AS count,COALESCE(SUM(byte_length),0)::text AS bytes FROM media_uploads WHERE created>=date_trunc('month',now()) OR status='uncertain'"))[0];
   if(Number(totals.count)>=this.config.monthly_upload_limit!||Number(totals.bytes)+artifact.bytes.byteLength>this.config.monthly_byte_limit!)return null;
   await tx.query("INSERT INTO media_uploads(sha256,public_origin,media_id,outbox_id,byte_length,status) VALUES($1,$2,$3,$4,$5,'uncertain')",[media.sha256,origin,artifact.id,context.id,artifact.bytes.byteLength]);
   return {existing:null};
  });
  if(!claim)return false;
  if(claim.existing)return claim.existing===media.url&&await this.verifyBytes(media);
  try{await readApprovedPublicMedia(this.db,media.sha256,origin,context.task_id,context.review_token);}catch{return false;}
  try {
   const result=await (this.deps.put||put)('publication-media/'+media.sha256+'.jpg',Buffer.from(artifact.bytes),{access:'public',contentType:'image/jpeg',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:31536000,...auth,abortSignal:AbortSignal.timeout(20_000)});
   if(result.url!==media.url||result.contentType!=='image/jpeg'||!await this.verifyBytes(media))return false;
  }catch{
   // A collision is reusable only after verifying actual exact bytes. An ambiguous upload is never replayed.
   if(!await this.verifyBytes(media))return false;
  }
  await this.db.query("UPDATE media_uploads SET status='uploaded',url=$3,verified_at=now() WHERE sha256=$1 AND public_origin=$2",[media.sha256,origin,media.url]);
  return true;
 }
 async verifyBytes(media:PublishingMedia){
  try {const r=await (this.deps.fetch||fetch)(media.url,{redirect:'error',signal:AbortSignal.timeout(15_000)});if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='image/jpeg')return false;const reader=r.body?.getReader();if(!reader)return false;let n=0;const digest=createHash('sha256');while(true){const v=await reader.read();if(v.done)break;n+=v.value.byteLength;if(n>2_000_000){await reader.cancel();return false;}digest.update(v.value);}return n>0&&digest.digest('hex')===media.sha256;}catch{return false;}
 }
}
