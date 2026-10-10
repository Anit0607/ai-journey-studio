import {authorized,allowedOrigin,response} from "../../../../lib/auth";
import {database} from "../../../../lib/db";
import {Store} from "../../../../lib/store";
import {runtimeConfig} from "../../../../lib/config";
import {CAPSULE,configReady} from "../../../../lib/domain";
import {liveReady} from "../../../../lib/providers";
import {step} from "../../../../lib/workflow";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=180;
async function readBody(request:Request){
  const reader=request.body?.getReader();if(!reader)return "{}";
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw Error("Request too large");}chunks.push(value);}
  return Buffer.concat(chunks).toString("utf8");
}
type Context={params:Promise<{action:string}>};
export async function GET(request:Request,context:Context){
  if(!authorized(request))return response({error:"Private access required"},401);
  const {action}=await context.params;
  if(action!=="state")return response({error:"Unknown route"},404);
  try{
    const store=new Store(await database()),c=runtimeConfig(),state=await store.snapshot();
    const blockers=[];
    if(!c.source_approved)blockers.push("Source consent pending");
    if(!c.transmission_authorized)blockers.push("Provider transmission approval pending");
    if(!c.credential_use_authorized)blockers.push("Credential use approval pending");
    if(!configReady(c))blockers.push("Current model pricing and safety verification required");
    if(!process.env.OPENAI_API_KEY)blockers.push("Runtime provider credential not supplied");
    return response({...state,blockers,live_enabled:liveReady(c),source_approved:!!c.source_approved,proposed_source:CAPSULE});
  }catch{return response({error:"Relational database unavailable. Configure an approved PostgreSQL connection or use the laptop-only embedded option."},503);}
}
export async function POST(request:Request,context:Context){
  if(!authorized(request))return response({error:"Private access required"},401);
  if(!allowedOrigin(request))return response({error:"Origin rejected"},403);
  if(Number(request.headers.get("content-length")||0)>4096)return response({error:"Request too large"},413);
  const {action}=await context.params;
  if(!["source","run","approve","cancel","retry","step"].includes(action))return response({error:"Unknown action"},404);
  try{
    const raw=await readBody(request);
    const body=JSON.parse(raw),store=new Store(await database()),c=runtimeConfig();
    let value:unknown;
    if(action==="source")value=await store.source(CAPSULE,"user-reported-notes","2026-10-09",!!c.source_approved);
    if(action==="run")value=await store.enqueue(String(body.source));
    if(action==="approve")value=await store.approve(String(body.task),String(body.version));
    if(action==="cancel")value=await store.cancel(String(body.task));
    if(action==="retry")value=await store.retry(String(body.task));
    if(action==="step")value=await step(store,c);
    return response({result:value??true});
  }catch(error){
    const safe=error instanceof Error&&["Source not cleared","Source invalidated","Stale artifact version","Task is not ready for approval","Unknown completion; reconciliation required before retry","Task cannot be retried","Approved task cannot be cancelled","Unknown task"].includes(error.message)?error.message:"Action blocked or database unavailable";
    return response({error:safe},400);
  }
}
