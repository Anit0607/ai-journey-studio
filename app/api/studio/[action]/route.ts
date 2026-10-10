import {authorized,allowedOrigin,response} from "../../../../lib/auth";
import {database} from "../../../../lib/db";
import {Store} from "../../../../lib/store";
import {runtimeConfig} from "../../../../lib/config";
import {CAPSULE,hash,configReady} from "../../../../lib/domain";
import {liveReady} from "../../../../lib/providers";
import {step} from "../../../../lib/workflow";
import {Calendar} from "../../../../lib/calendar";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=180;
async function readBody(request:Request,limit=4096){
  const reader=request.body?.getReader();if(!reader)return "{}";
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error("Request too large");}chunks.push(value);}
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
    const sourceApproved=!!c.source_approved&&c.approved_source_hash===hash(CAPSULE);
    if(!sourceApproved)blockers.push("Source consent pending");
    if(!c.transmission_authorized)blockers.push("Provider transmission approval pending");
    if(!c.credential_use_authorized)blockers.push("Credential use approval pending");
    if(!configReady(c))blockers.push("Current model pricing and safety verification required");
    if(!process.env.OPENAI_API_KEY)blockers.push("Runtime provider credential not supplied");
    if(process.env.STUDIO_SESSION_ONLY!=="1")blockers.push("User-operated session-only key entry required");
    if(state.pricing_blocked)blockers.push("Unexpected provider billing tier requires reconciliation");
    const enabled=liveReady(c)&&!state.pricing_blocked;
    return response({...state,calendar:await new Calendar(store.db).snapshot(state,c,enabled),blockers,live_enabled:enabled,source_approved:sourceApproved,proposed_source:CAPSULE});
  }catch{return response({error:"Relational database unavailable. Configure an approved PostgreSQL connection or use the laptop-only embedded option."},503);}
}
export async function POST(request:Request,context:Context){
  if(!authorized(request))return response({error:"Private access required"},401);
  if(!allowedOrigin(request))return response({error:"Origin rejected"},403);
  const {action}=await context.params;
  if(!["source","run","approve","cancel","retry","step","request-changes","revise","approve-revision","calendar-configure","calendar-plan","calendar-link","calendar-prepare"].includes(action))return response({error:"Unknown action"},404);
  const limit=action==="revise"?40000:4096;
  if(Number(request.headers.get("content-length")||0)>limit)return response({error:"Request too large"},413);
  try{
    const raw=await readBody(request,limit);
    const body=JSON.parse(raw),store=new Store(await database()),c=runtimeConfig();
    let value:unknown;
    if(action==="source")value=await store.source(CAPSULE,"user-reported-notes","2026-10-09",!!c.source_approved&&c.approved_source_hash===hash(CAPSULE));
    if(action==="run")value=await store.enqueue(String(body.source));
    if(action==="approve")value=await store.approve(String(body.task),String(body.version));
    if(action==="request-changes")value=await store.revise(String(body.task),String(body.expected),body.note);
    if(action==="revise")value=await store.revise(String(body.task),String(body.expected),body.note,{role:body.role,text:body.text});
    if(action==="approve-revision")value=await store.approveRevision(String(body.task),String(body.expected),body.acknowledged);
    if(action==="calendar-configure")value=await new Calendar(store.db).configure(body);
    if(action==="calendar-plan")value=await new Calendar(store.db).plan(body.weeks);
    if(action==="calendar-link")value=await new Calendar(store.db).link(String(body.entry),body.source||null,body.task||null);
    if(action==="calendar-prepare")value=await new Calendar(store.db).prepareDue();
    if(action==="cancel")value=await store.cancel(String(body.task));
    if(action==="retry")value=await store.retry(String(body.task));
    if(action==="step")value=await step(store,c);
    return response({result:value??true});
  }catch(error){
    const safe=error instanceof Error&&["Source not cleared","Source invalidated","Stale artifact version","Task is not ready for approval","Unknown completion; reconciliation required before retry","Task cannot be retried","Safety termination cannot be retried","Approved task cannot be cancelled","Unknown task","Task is not ready for revision","Stale revision; refresh before editing","Revision note required","Invalid revision text","Excluded private material","No content change","Human factual review acknowledgement required","No revision to approve","Resolve source-grounding flags before approval","Fresh revision approval required","Invalid calendar date or time","Invalid cadence","Generation lead must be 48 to 336 hours or unset","Choose one to four weeks","Choose start date and posting time first","Unknown calendar entry","Task must match the linked source"].includes(error.message)?error.message:"Action blocked or database unavailable";
    return response({error:safe},400);
  }
}
