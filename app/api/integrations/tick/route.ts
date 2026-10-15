import {authorized,response} from '../../../../lib/auth';
import {database} from '../../../../lib/db';
import {integrationConfig,schedulerStatus} from '../../../../lib/integration-config';
import {Integrations} from '../../../../lib/integrations';
import {hostedEnvironment,hostedOwnerReady} from '../../../../lib/hosted';
import {runtimeConfig} from '../../../../lib/config';
import {legacySchedulerSelected,qstashSafeResult,verifyQStashSchedulerRequest,claimQStashDelivery,completeQStashDelivery,type VerifiedQStashDelivery} from '../../../../lib/qstash-scheduler';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=180;
async function handle(request:Request){
 const env=process.env,config=integrationConfig(),signed=request.method==='POST';let delivery:VerifiedQStashDelivery|undefined;
 if(signed){
  const verified=await verifyQStashSchedulerRequest(request,{scheduler:config.scheduler,env,path:'/api/integrations/tick'});
  if(!verified.ok)return response({error:verified.error},verified.status);
  delivery=verified;
 }else{
  if(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_AUTH_SECRET||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN)return response({error:'Private scheduler access required'},401);
  if(!legacySchedulerSelected(config.scheduler))return response({error:'Legacy scheduler transport is not enabled'},503);
 }
 if(!schedulerStatus(config).authorized||(hostedEnvironment()&&!hostedOwnerReady(runtimeConfig())))return response({error:'Integration scheduling is not authorized or configured'},503);
 try {const url=new URL(request.url);if(url.origin!==env.STUDIO_ORIGIN||(request.headers.has('host')&&request.headers.get('host')!==url.host))return response({error:'Origin rejected'},403);}catch{return response({error:'Origin rejected'},403);}
 // A signed delivery is a wake-up only. Existing durable leases/outbox/day gates own replay safety.
 // Provisioning these schedules requires separate owner setup. No self-pings or scheduler API calls.
 try {const db=await database();if(delivery&&!await claimQStashDelivery(db,delivery))return response({result:{status:'duplicate'}});const result=await new Integrations(db,config).tick();if(delivery)await completeQStashDelivery(db,delivery,result.status==='failed'?'failed':'completed');return response({result:signed?qstashSafeResult(result,'integration'):result},result.status==='failed'?503:200);}catch{return response({error:'Integration scheduler unavailable'},503);}
}
export const GET=handle,POST=handle;
