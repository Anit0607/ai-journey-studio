import {allowedOrigin,response} from './auth';
import {database,type Database} from './db';
import {runtimeConfig} from './config';
import {createOwnerAuth,OWNER_ID,passwordOwnerAuthenticated} from './owner-password';
import {GithubSourcePolicies,GithubSourcePolicyError,type PolicySession} from './github-source-policy';
import type {RuntimeConfig} from './domain';
type Dependencies={db?:Database;env?:Record<string,string|undefined>;readConfig?:()=>RuntimeConfig;session?:(request:Request,db:Database)=>Promise<PolicySession|null>};
async function body(request:Request){
 if(Number(request.headers.get('content-length')||0)>4096)throw new GithubSourcePolicyError('Request too large');
 const reader=request.body?.getReader();if(!reader)throw new GithubSourcePolicyError('Exact policy request required');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new GithubSourcePolicyError('Request too large');}parts.push(part.value);}
 let value:unknown;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new GithubSourcePolicyError('Invalid policy request');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GithubSourcePolicyError('Invalid policy request');return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,expected:string[]){return Object.keys(value).length===expected.length&&Object.keys(value).every(key=>expected.includes(key));}
/** Cookie owner session only. No worker/bearer/configuration input can grant source consent. */
export async function handleGithubSourcePolicy(request:Request,action:string,deps:Dependencies={}){
 if(!['status','preview','activate','revoke'].includes(action))return response({error:'Unknown source policy action'},404);
 if(request.method!==(action==='status'?'GET':'POST'))return response({error:'Method not allowed'},405);
 const env=deps.env||process.env,origin=env.STUDIO_ORIGIN;
 try{const u=new URL(request.url),expected=new URL(origin||''),host=request.headers.get('host');if((host&&host!==expected.host)||!(u.origin===origin||expected.hostname==='127.0.0.1'&&u.hostname==='localhost'&&u.protocol===expected.protocol&&u.port===expected.port&&host===expected.host))return response({error:'Origin rejected'},403);}catch{return response({error:'Origin rejected'},403);}
 if(action!=='status'&&!allowedOrigin(request,origin))return response({error:'Origin rejected'},403);
 try{
  const db=deps.db||await database();
  const authenticate=deps.session||(async(req:Request,database:Database)=>{
   if(!await passwordOwnerAuthenticated(req,env,async()=>database))return null;
   const current=await createOwnerAuth(database,env).api.getSession({headers:req.headers});return current?.user.id===OWNER_ID?{owner_id:OWNER_ID,session_id:current.session.id}:null;
  });
  const session=await authenticate(request,db);if(!session)return response({error:'Authenticated owner session required'},401);
  const service=new GithubSourcePolicies(db,(deps.readConfig||(()=>runtimeConfig(env)))());
  if(action==='status')return response(await service.snapshot());
  const input=await body(request);
  if(action==='preview')return response({preview:await service.preview(input,session)});
  if(action==='activate'){
   if(!keys(input,['preview_id','preview_hash','acknowledgement','acknowledged'])||typeof input.preview_id!=='string'||typeof input.preview_hash!=='string'||typeof input.acknowledgement!=='string'||input.acknowledged!==true)throw new GithubSourcePolicyError('Exact bounded source-policy acknowledgement required');
   return response({policy:await service.activate({preview_id:input.preview_id,preview_hash:input.preview_hash,acknowledgement:input.acknowledgement,acknowledged:true},session),notice:'Source consent saved. No connection, scheduler, generation, schedule or publication was started.'});
  }
  if(!keys(input,['policy_id','expected_hash','acknowledged'])||typeof input.policy_id!=='string'||typeof input.expected_hash!=='string'||input.acknowledged!==true)throw new GithubSourcePolicyError('Exact policy revocation acknowledgement required');
  return response({policy:await service.revoke(input.policy_id,input.expected_hash,session),notice:'Future policy-derived use is blocked. Manual source grants and historical work are unchanged; in-flight calls cannot be recalled.'});
 }catch(error){return response({error:error instanceof GithubSourcePolicyError?error.message:'Source policy unavailable; no automatic retry was attempted'},error instanceof GithubSourcePolicyError?400:503);}
}
