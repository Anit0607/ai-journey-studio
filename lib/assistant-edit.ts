import {authorized} from "./auth";

type Env=Record<string,string|undefined>;
/** The assistant-edit credential is separate from every owner, worker and scheduler secret. */
export function assistantEditAuthorized(request:Request,env:Env=process.env):boolean{
  const token=env.STUDIO_ASSISTANT_EDIT_TOKEN;
  if(!token||token.length<32)return false;
  if([env.STUDIO_ACCESS_TOKEN,env.STUDIO_AUTH_SECRET,env.CRON_SECRET,env.STUDIO_CONNECTIONS_ENCRYPTION_KEY].includes(token))return false;
  return authorized(request,token);
}
/** Only public-copy draft edits; approval, confirmation and publishing are not reachable. */
export function parseAssistantRevision(input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join(",")!=="expected,note,role,task,text")throw Error("Invalid assistant revision request");
  const body=input as Record<string,unknown>;
  if(typeof body.task!=="string"||typeof body.expected!=="string"||typeof body.note!=="string"||typeof body.text!=="string"||!["Writer","Platform Adapter"].includes(String(body.role)))throw Error("Invalid assistant revision request");
  return {task:body.task,expected:body.expected,note:body.note,role:String(body.role),text:body.text};
}
/** Scheduling only: applying the evidence schedule or moving a post. Moves cancel unattempted
 * delivery plans, so nothing the assistant does here can approve or publish a post. */
export function parseAssistantCalendar(input:unknown):{op:"apply-schedule"}|{op:"move";entry:string;planned_date:string}{
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid assistant calendar request");
  const body=input as Record<string,unknown>,keys=Object.keys(body).sort().join(",");
  if(body.op==="apply-schedule"&&keys==="op")return {op:"apply-schedule"};
  if(body.op==="move"&&keys==="entry,op,planned_date"&&typeof body.entry==="string"&&typeof body.planned_date==="string")return {op:"move",entry:body.entry,planned_date:body.planned_date};
  throw Error("Invalid assistant calendar request");
}
