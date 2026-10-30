/** Optional ntfy push to the owner's private topic. Messages carry no post text, credentials or
 * provider bodies; delivery is best-effort and never affects publication state. */
export type OwnerNotice={title:string;message:string;click?:string;priority?:"default"|"high"};
export type Notifier=(notice:OwnerNotice)=>Promise<void>;
export function ntfyNotifier(env:Record<string,string|undefined>,transport:typeof fetch=fetch):Notifier|undefined{
  const topic=env.STUDIO_NTFY_TOPIC;
  if(!topic||!/^[A-Za-z0-9_-]{16,64}$/.test(topic))return undefined;
  return async notice=>{
    try{await transport("https://ntfy.sh/"+topic,{method:"POST",headers:{Title:notice.title,Priority:notice.priority||"default",...(notice.click?{Click:notice.click}:{})},body:notice.message,signal:AbortSignal.timeout(5000)});}catch{/* best effort */}
  };
}
const ist=(value:string|Date)=>new Date(value).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false})+" IST";
/** Owner-facing wording for one final delivery outcome; null for states that may repeat. */
export function deliveryNotice(row:{platform:string;scheduled_at:string|Date;provider_id?:string|null},outcome:string,dashboard?:string):OwnerNotice|null{
  const slot=row.platform+" post for "+ist(row.scheduled_at);
  if(outcome==="published")return {title:"Published on "+row.platform,message:"Your "+slot+" is live.",click:row.provider_id&&/^urn:li:(?:share|ugcPost):\d+$/.test(row.provider_id)?"https://www.linkedin.com/feed/update/"+row.provider_id+"/":dashboard};
  if(outcome==="failed")return {title:row.platform+" post failed",message:"Your "+slot+" was not published. Open the dashboard to review it.",click:dashboard,priority:"high"};
  if(outcome==="uncertain")return {title:row.platform+" post outcome uncertain",message:"Check "+row.platform+" before doing anything: your "+slot+" may or may not be live. It will not be retried automatically.",click:dashboard,priority:"high"};
  if(outcome==="missed")return {title:row.platform+" post missed its time",message:"Your "+slot+" did not go out on time. Move it to another slot and approve again.",click:dashboard,priority:"high"};
  if(outcome==="invalidated")return {title:row.platform+" approval no longer valid",message:"Your "+slot+" changed after approval and will not be posted. Review and approve again.",click:dashboard,priority:"high"};
  return null;
}
