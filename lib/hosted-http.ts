import {authorized,response} from "./auth";
import {database,type Database} from "./db";
import {runtimeConfig} from "./config";
import type {RuntimeConfig} from "./domain";
import {hostedEnvironment,hostedCronReady,type HostedEnvironment} from "./hosted";
import {liveReady} from "./providers";
import {runHostedBatch} from "./hosted-batch";
import {Store} from "./store";

export function ownerRequestReady(request:Request,_c:RuntimeConfig,env:HostedEnvironment=process.env){
  // Compatibility for local machine workers only; hosted owner APIs use cookies.
  if(hostedEnvironment(env))return false;
  if(!authorized(request,env.STUDIO_ACCESS_TOKEN))return false;
  return true;
}
function requestOriginMatches(request:Request,origin:string|undefined){
  try{
    const actual=new URL(request.url),expected=new URL(origin||"");
    return actual.origin===expected.origin&&(!request.headers.has("host")||request.headers.get("host")===expected.host);
  }catch{return false;}
}
type CronDependencies={env?:HostedEnvironment;readConfig?:()=>RuntimeConfig;database?:()=>Promise<Database>;runBatch?:typeof runHostedBatch};
/** A single authenticated daily invocation. Never chains or schedules itself. */
export async function handleHostedCron(request:Request,deps:CronDependencies={}){
  if(request.method!=="GET")return response({error:"Method not allowed"},405);
  const env=deps.env||process.env;
  // Authenticate before config/database inspection. User agent and query strings
  // are not authentication, and the owner token cannot act as a cron credential.
  if(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN||env.CRON_SECRET===env.STUDIO_AUTH_SECRET)return response({error:"Private cron access required"},401);
  const read=deps.readConfig||runtimeConfig,c=read();
  const ready=(current:RuntimeConfig)=>hostedCronReady(current,env)&&liveReady(current,env);
  if(!ready(c)||!requestOriginMatches(request,env.STUDIO_ORIGIN))return response({error:"Hosted scheduling is not ready"},503);
  try{
    const store=new Store(await (deps.database||database)());
    const result=await (deps.runBatch||runHostedBatch)(store,c,{isReady:ready,readConfig:read,signal:request.signal});
    return response({result},result.status==="failed"?503:200);
  }catch{return response({error:"Hosted scheduling unavailable"},503);}
}
