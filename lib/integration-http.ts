import {authorized,response} from './auth';
import {database,type Database} from './db';
import {integrationConfig,schedulerStatus,type IntegrationSettings} from './integration-config';
import {schedulerWindowPhase,schedulerWindowPolicy} from './scheduler-window-policy';
import type {RuntimeConfig} from './domain';
import {Integrations} from './integrations';
import {hostedEnvironment,hostedOwnerReady} from './hosted';
import {runtimeConfig} from './config';
import {legacySchedulerSelected,qstashSafeResult,verifyQStashSchedulerRequest,claimQStashDelivery,completeQStashDelivery,type VerifiedQStashDelivery} from './qstash-scheduler';
export type IntegrationTickDependencies={env?:Record<string,string|undefined>;config?:IntegrationSettings;readRuntimeConfig?:()=>RuntimeConfig;database?:()=>Promise<Database>;now?:()=>Date;runTick?:(db:Database,config:IntegrationSettings,env:Record<string,string|undefined>,now:Date)=>Promise<{status:string}>};
export async function handleIntegrationTick(request:Request,deps:IntegrationTickDependencies={}){
 const env=deps.env??process.env,config=deps.config??integrationConfig(env),signed=request.method==='POST';let delivery:VerifiedQStashDelivery|undefined;
 if(signed){
  const verified=await verifyQStashSchedulerRequest(request,{scheduler:config.scheduler,env,path:'/api/integrations/tick'});
  if(!verified.ok)return response({error:verified.error},verified.status);
  delivery=verified;
 }else{
  if(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_AUTH_SECRET||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN)return response({error:'Private scheduler access required'},401);
  if(!legacySchedulerSelected(config.scheduler))return response({error:'Legacy scheduler transport is not enabled'},503);
 }
 if(!schedulerStatus(config).authorized||(hostedEnvironment(env)&&!hostedOwnerReady((deps.readRuntimeConfig??runtimeConfig)(),env)))return response({error:'Integration scheduling is not authorized or configured'},503);
 try {const url=new URL(request.url);if(url.origin!==env.STUDIO_ORIGIN||(request.headers.has('host')&&request.headers.get('host')!==url.host))return response({error:'Origin rejected'},403);}catch{return response({error:'Origin rejected'},403);}
 const now=(deps.now??(()=>new Date()))(),phase=schedulerWindowPhase(schedulerWindowPolicy(config.scheduler),now);
 if(phase==='invalid')return response({error:'Invalid scheduler window policy'},503);
 // Full signature/body/destination/authentication checks above always run, even off-window.
 // No DB connection, delivery claim, source, model or provider access occurs on a valid idle wake.
 if(phase==='idle')return response({result:{status:'idle'}});
 // A signed delivery is a wake-up only. Existing durable leases/outbox/day gates own replay safety.
 // Provisioning these schedules requires separate owner setup. No self-pings or scheduler API calls.
 try {const db=await (deps.database??database)();if(delivery&&!await claimQStashDelivery(db,delivery))return response({result:{status:'duplicate'}});const result=await (deps.runTick??((database,settings,environment,time)=>new Integrations(database,settings,environment).tick(time)))(db,config,env,now);if(delivery)await completeQStashDelivery(db,delivery,result.status==='failed'?'failed':'completed');return response({result:signed?qstashSafeResult(result,'integration'):result},result.status==='failed'?503:200);}catch{return response({error:'Integration scheduler unavailable'},503);}
}
