import {authorized,allowedOrigin,response} from "./auth";
import {database} from "./db";
import {runtimeConfig} from "./config";
import {runAutopilot} from "./autopilot";
import {ntfyNotifier} from "./notify";
import {assistantEditAuthorized} from "./assistant-edit";

/** Daily Vercel cron (bearer CRON_SECRET) or an assistant-credential test run. Never approves. */
export async function handleAutopilot(request:Request,actor:"scheduler"|"assistant",env:Record<string,string|undefined>=process.env){
  if(actor==="scheduler"&&(!authorized(request,env.CRON_SECRET)||env.CRON_SECRET===env.STUDIO_ACCESS_TOKEN||env.CRON_SECRET===env.STUDIO_AUTH_SECRET))return response({error:"Private cron access required"},401);
  if(actor==="assistant"&&(!assistantEditAuthorized(request,env)||!allowedOrigin(request,env.STUDIO_ORIGIN)))return response({error:"Assistant edit access required"},401);
  try{
    const result=await runAutopilot(await database(),{readConfig:runtimeConfig,notify:ntfyNotifier(env),dashboard:env.STUDIO_ORIGIN,signal:request.signal,actor});
    return response({result});
  }catch{return response({error:"Autopilot unavailable"},503);}
}
