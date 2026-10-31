"use client";
type Job={id:string;task_id:string;platform:string;status:string;reason:string|null;scheduled_at:string;published_at:string|null;provider_id:string|null;delivery_mode:string;created:string};
const ist=(value:string)=>new Date(value).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false})+" IST";
export default function PostStatus({job}:{job:Job|null}){
  if(!job)return null;
  const link=job.provider_id&&/^urn:li:(?:share|ugcPost):\d+$/.test(job.provider_id)?"https://www.linkedin.com/feed/update/"+job.provider_id+"/":null;
  const [icon,color,text]:[string,string,string]=job.status==="published"?["✓","var(--accent)",`Published ${job.published_at?ist(job.published_at):""}`]:
    job.status==="approved"?["✓","var(--accent)",`Scheduled for ${ist(job.scheduled_at)}${job.delivery_mode==="manual"?" (you publish it)":" (automatic)"}`]:
    job.status==="claimed"?["…","#f2c46d","Publishing now"]:
    job.status==="uncertain"?["?","#f2c46d","Outcome uncertain: check LinkedIn before doing anything; it will not be retried automatically"]:
    ["✗","#ff8f8f",`${job.status==="missed"?"Missed its posting time":job.status==="invalidated"?"Approval no longer valid":"Failed"}${job.reason?": "+job.reason:""}`];
  return <section aria-label="Post status" style={{border:`1px solid ${color}`,borderRadius:12,padding:"12px 16px",margin:"12px 0"}}>
    <strong style={{color}}>{icon} {text}</strong>
    {link&&<> · <a href={link} target="_blank" rel="noreferrer">View on LinkedIn</a></>}
    {job.status==="approved"&&<p className="fine">Approved. To change the text or time, edit or move the post; that cancels this approval and asks you again.</p>}
  </section>;
}
