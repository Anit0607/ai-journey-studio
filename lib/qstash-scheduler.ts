import {Receiver} from "@upstash/qstash";
import type {Connection} from "./db";
import type {IntegrationSettings} from "./integration-config";

export type SchedulerEnvironment=Record<string,string|undefined>;
export type QStashRequestResult={ok:true;delivery_id:string;destination:string}|{ok:false;status:401|403|405|413|503;error:string};
export type VerifiedQStashDelivery=Extract<QStashRequestResult,{ok:true}>;
export type QStashRequestOptions={scheduler:IntegrationSettings["scheduler"];env:SchedulerEnvironment;path:string};
const MAX_BODY_BYTES=1024;
const signingKey=(value:unknown):value is string=>typeof value==="string"&&/^[\x21-\x7e]{32,512}$/.test(value);
/** A transport selection, not proof that any external schedule has been provisioned. */
export function qstashSelected(scheduler:IntegrationSettings["scheduler"]){return scheduler?.provider==="qstash";}
export function legacySchedulerSelected(scheduler:IntegrationSettings["scheduler"]){return scheduler?.provider===undefined||scheduler.provider==="external-bearer";}
/** No keys, token, request body, destinations, or provider responses are returned in this status. */
export function qstashSchedulerStatus(scheduler:IntegrationSettings["scheduler"],env:SchedulerEnvironment){
  return {transport:"qstash_signature",selected:qstashSelected(scheduler),authorized:qstashSelected(scheduler)&&scheduler?.authorized===true,signing_keys_configured:signingKey(env.QSTASH_CURRENT_SIGNING_KEY)&&signingKey(env.QSTASH_NEXT_SIGNING_KEY),provisioned:false,live_delivery_verified:false};
}
function destinationFor(origin:string|undefined,path:string){
  if(!origin||!/^\/api\/[A-Za-z0-9/_-]+$/.test(path))return null;
  try{const url=new URL(origin);if(url.protocol!=="https:"||url.origin!==origin||url.username||url.password||url.port)return null;return origin+path;}catch{return null;}
}
async function readRawBody(request:Request){
  const size=request.headers.get("content-length");
  if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BODY_BYTES))throw Error("body_limit");
  const reader=request.body?.getReader();if(!reader)return "";
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_BODY_BYTES){await reader.cancel();throw Error("body_limit");}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(buffer);
}
/** Verify before opening a database or inspecting source/model content. Never reconstruct signed JSON.
 * JWT jti is authenticated; Upstash-Message-Id / Schedule-Id / User-Agent headers are not trusted.
 * This is authentication only: the durable tick lease, source cadence, publication outbox and
 * UTC-day generation guard provide semantic idempotency across retried/redelivered messages.
 */
export async function verifyQStashSchedulerRequest(request:Request,options:QStashRequestOptions):Promise<QStashRequestResult>{
  const denied:QStashRequestResult={ok:false,status:401,error:"Valid QStash signature required"};
  if(request.method!=="POST")return {ok:false,status:405,error:"Signed scheduler delivery requires POST"};
  if(!qstashSelected(options.scheduler)||options.scheduler?.authorized!==true||!["daily","external"].includes(options.scheduler.mode||""))return {ok:false,status:503,error:"QStash delivery is not authorized or configured"};
  const destination=destinationFor(options.env.STUDIO_ORIGIN,options.path);
  if(!destination)return {ok:false,status:503,error:"Canonical HTTPS scheduler destination is not configured"};
  try{if(request.url!==destination||(request.headers.has("host")&&request.headers.get("host")!==new URL(destination).host))return {ok:false,status:403,error:"Scheduler destination rejected"};}catch{return denied;}
  const current=options.env.QSTASH_CURRENT_SIGNING_KEY,next=options.env.QSTASH_NEXT_SIGNING_KEY;
  if(!signingKey(current)||!signingKey(next))return {ok:false,status:503,error:"Both QStash signing keys are required"};
  if([options.env.STUDIO_ACCESS_TOKEN,options.env.STUDIO_AUTH_SECRET,options.env.CRON_SECRET].filter(Boolean).some(secret=>secret===current||secret===next))return {ok:false,status:503,error:"Scheduler signing keys must be separate from application credentials"};
  const signature=request.headers.get("upstash-signature");
  if(!signature||signature.length>8192||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(signature))return denied;
  if(request.headers.get("content-encoding")&&!/^identity$/i.test(request.headers.get("content-encoding")!))return denied;
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")||""))return denied;
  let raw:string;try{raw=await readRawBody(request);}catch(error){return error instanceof Error&&error.message==="body_limit"?{ok:false,status:413,error:"Scheduler body limit exceeded"}:denied;}
  try{
    // The SDK checks signatures, issuer, URL, body digest and temporal claims. Its optional
    // JWT claims are mandatory here, and only HS256 is accepted. Dev keys are never inferred.
    const [encodedHeader,encodedPayload]=signature.split(".");
    const header=JSON.parse(Buffer.from(encodedHeader,"base64url").toString("utf8")),claims=JSON.parse(Buffer.from(encodedPayload,"base64url").toString("utf8"));
    if(!header||header.alg!=="HS256"||(header.typ!==undefined&&header.typ!=="JWT")||!claims||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.nbf)||!Number.isSafeInteger(claims.iat)||claims.nbf>claims.exp||claims.iat>claims.exp||typeof claims.jti!=="string"||!/^[-_A-Za-z0-9]{1,200}$/.test(claims.jti)||typeof claims.body!=="string")return denied;
    const valid=await new Receiver({currentSigningKey:current,nextSigningKey:next,devMode:false}).verify({signature,body:raw,url:destination,clockTolerance:0});
    if(!valid)return denied;
    // A schedule is a wake-up signal only. Never accept request-controlled limits, source
    // content, credentials, account IDs, pricing, or publication instructions from QStash.
    const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==0)return denied;
    return {ok:true,delivery_id:claims.jti,destination};
  }catch{return denied;}
}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function count(value:unknown){return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?Math.min(value,1000000):0;}
const STATUSES=new Set(["completed","already-running","disabled","failed","idle","blocked","deadline","max_steps","interrupted","duplicate","published","uncertain","staged","synced","partial","busy"]);
const status=(value:unknown)=>typeof value==="string"&&STATUSES.has(value)?value:"unknown";
/** QStash can retain response bodies. Return coarse status/counts, never internal records. */
export function qstashSafeResult(result:unknown,kind:"integration"|"generation"){
  const item=record(result);
  if(kind==="generation")return {status:status(item.status),steps:count(item.steps)};
  const sources=record(item.sources),providers=Array.isArray(sources.providers)?sources.providers.map(record):[],publishing=record(item.publishing);
  return {status:status(item.status),sources:{status:status(sources.status),providers_checked:providers.length,staged:providers.reduce((sum,p)=>sum+count(p.staged),0),duplicates:providers.reduce((sum,p)=>sum+count(p.duplicates),0),rejected:providers.reduce((sum,p)=>sum+count(p.rejected),0)},publishing:{status:status(publishing.status),published:publishing.status==="published"?1:0}};
}

/** A verified signature can still be replayed. Persist its authenticated jti and destination
 * before any source sync, provider call, or batch work. No unsigned headers are used. */
export async function claimQStashDelivery(db:Connection,verified:VerifiedQStashDelivery):Promise<boolean>{
  const rows=await db.query("INSERT INTO qstash_deliveries(destination,signed_jti) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING signed_jti",[verified.destination,verified.delivery_id]);
  return rows.length===1;
}
export async function completeQStashDelivery(db:Connection,verified:VerifiedQStashDelivery,outcome:"completed"|"failed"){
  await db.query("UPDATE qstash_deliveries SET outcome=$3,completed_at=now() WHERE destination=$1 AND signed_jti=$2 AND outcome='claimed'",[verified.destination,verified.delivery_id,outcome]);
}
