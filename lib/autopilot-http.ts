import {authorized,allowedOrigin,response} from "./auth";
import {database} from "./db";
import {runtimeConfig} from "./config";
import {runAutopilot} from "./autopilot";
import {ntfyNotifier,eventRecorder,notifierBlocker} from "./notify";
import {assistantEditAuthorized} from "./assistant-edit";

/** Daily Vercel cron (bearer CRON_SECRET) or an assistant-credential test run. Never approves. */
export async function handleAutopilot(request:Request,actor:"scheduler"|"assistant",env:Record<string,string|undefined>=process.env){
  if(actor==="scheduler"&&(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN||env.CRON_SECRET===env.STUDIO_AUTH_SECRET))return response({error:"Private cron access required"},401);
  if(actor==="assistant"&&(!assistantEditAuthorized(request,env)||!allowedOrigin(request,env.STUDIO_ORIGIN)))return response({error:"Assistant edit access required"},401);
  try{
    const db=await database();
    const result=await runAutopilot(db,{readConfig:runtimeConfig,notify:ntfyNotifier(env,fetch,eventRecorder(db)),dashboard:env.STUDIO_ORIGIN,signal:request.signal,actor});
    return response({result});
  }catch{return response({error:"Autopilot unavailable"},503);}
}

/** Assistant-credential test push: sends one fixed notice and returns ntfy's answer. Changes nothing else. */
export async function handleNotifyTest(request:Request,env:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch){
  if(!assistantEditAuthorized(request,env)||!allowedOrigin(request,env.STUDIO_ORIGIN))return response({error:"Assistant edit access required"},401);
  const blocked=notifierBlocker(env);if(blocked)return response({outcome:"not_configured",reason:blocked});
  let outcome="not_sent";
  try{
    const db=await database(),record=eventRecorder(db);
    await ntfyNotifier(env,transport,async(title,result)=>{outcome=result;await record(title,result);})!({title:"Test notification",message:"AI Journey Studio can reach your phone. No action needed.",click:env.STUDIO_ORIGIN});
  }catch{return response({error:"Notification test unavailable"},503);}
  return response({outcome});
}
