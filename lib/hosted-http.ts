import {authorized,response} from "./auth";
import {database,type Database} from "./db";
import {runtimeConfig} from "./config";
import type {RuntimeConfig} from "./domain";
import {hostedEnvironment,hostedCronReady,type HostedEnvironment} from "./hosted";
import {liveReady} from "./providers";
import {runHostedBatch} from "./hosted-batch";
import {Store} from "./store";
import {integrationConfig,type IntegrationSettings} from "./integration-config";
import {legacySchedulerSelected,qstashSelected,qstashSafeResult,verifyQStashSchedulerRequest,claimQStashDelivery,completeQStashDelivery,type VerifiedQStashDelivery} from "./qstash-scheduler";

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
type CronDependencies={env?:HostedEnvironment;readConfig?:()=>RuntimeConfig;database?:()=>Promise<Database>;runBatch?:typeof runHostedBatch;readIntegrationConfig?:()=>IntegrationSettings};
/** A single authenticated daily invocation. Never chains or schedules itself. */
export async function handleHostedCron(request:Request,deps:CronDependencies={}){
  if(!["GET","POST"].includes(request.method))return response({error:"Method not allowed"},405);
  const env=deps.env||process.env;
  const integrations=(deps.readIntegrationConfig||(()=>integrationConfig(env)))();
  const signed=request.method==="POST";let delivery:VerifiedQStashDelivery|undefined;
  if(signed){
    if(!qstashSelected(integrations.scheduler))return response({error:"Method not allowed"},405);
    const verified=await verifyQStashSchedulerRequest(request,{scheduler:integrations.scheduler,env,path:"/api/cron"});
    if(!verified.ok)return response({error:verified.error},verified.status);
    delivery=verified;
  }else{
    // The legacy bearer transport remains separate and is disabled when QStash is selected.
    if(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN||env.CRON_SECRET===env.STUDIO_AUTH_SECRET)return response({error:"Private cron access required"},401);
    if(!legacySchedulerSelected(integrations.scheduler))return response({error:"Legacy scheduler transport is not enabled"},503);
  }
  const read=deps.readConfig||runtimeConfig,c=read();
  const ready=(current:RuntimeConfig)=>hostedCronReady(current,env)&&liveReady(current,env);
  if(!ready(c)||!requestOriginMatches(request,env.STUDIO_ORIGIN))return response({error:"Hosted scheduling is not ready"},503);
  try{
    const db=await (deps.database||database)();
    if(delivery&&!await claimQStashDelivery(db,delivery))return response({result:{status:"duplicate",steps:0}});
    const store=new Store(db);
    const result=await (deps.runBatch||runHostedBatch)(store,c,{isReady:ready,readConfig:read,signal:request.signal});
    if(delivery)await completeQStashDelivery(db,delivery,result.status==="failed"?"failed":"completed");
    return response({result:signed?qstashSafeResult(result,"generation"):result},result.status==="failed"?503:200);
  }catch{return response({error:"Hosted scheduling unavailable"},503);}
}
