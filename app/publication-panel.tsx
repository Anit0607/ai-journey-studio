'use client';
import {useRef,useState} from 'react';
import Image from 'next/image';
type Data=Record<string,any>;
type Action=(path:string,body:unknown)=>Promise<boolean>;
const editableStatuses=['staged','approved','invalidated','missed'];
// datetime-local has no offset. Reject normalized impossible dates and DST gaps
// rather than silently changing the time the owner chose.
export function publicationTimeIso(value:string):string|null{
 const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
 if(!parts||Number(parts[1])<1)return null;
 const [year,month,day,hour,minute]=parts.slice(1).map(Number),date=new Date(value);
 if(!Number.isFinite(date.getTime())||date.getFullYear()!==year||date.getMonth()+1!==month||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute)return null;
 return date.toISOString();
}
function PublicationJob({job,acknowledgement,maxLateness,busy,action}:{job:Data;acknowledgement:string;maxLateness:number;busy:boolean;action:Action}){
 const [ack,setAck]=useState(false),[editing,setEditing]=useState(false),[scheduled,setScheduled]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[now,setNow]=useState(0),[deliveryMode,setDeliveryMode]=useState(job.delivery_mode||'scheduled'),[publishAck,setPublishAck]=useState(false),[publishRequested,setPublishRequested]=useState(false),[publishing,setPublishing]=useState(false);
 const inFlight=useRef(false),editable=editableStatuses.includes(job.status),scheduledAt=publicationTimeIso(scheduled);
 const valid=!!scheduledAt&&Date.parse(scheduledAt)>now&&(Date.parse(scheduledAt)!==new Date(job.scheduled_at).getTime()||deliveryMode!==(job.delivery_mode||'scheduled'));
 async function reschedule(){
  const next=publicationTimeIso(scheduled),currentTime=Date.now();setNow(currentTime);
  if(busy||inFlight.current||saved||!editable||!next||Date.parse(next)<=currentTime||(Date.parse(next)===new Date(job.scheduled_at).getTime()&&deliveryMode===(job.delivery_mode||'scheduled')))return;
  inFlight.current=true;setSaving(true);setAck(false);
  try{
   const ok=await action('publication-revise',{id:job.id,expected_version:job.version,plan:{task_id:job.task_id,review_token:job.review_token,platform:job.platform,account_id:job.account_id,payload:job.payload,scheduled_at:next,...(job.delivery_mode||deliveryMode!=='scheduled'?{delivery_mode:deliveryMode}:{})}});
   if(ok){setSaved(true);setEditing(false);setScheduled('');}
  }finally{inFlight.current=false;setSaving(false);}
 }
 async function publishNow(){
  const current=Date.now(),at=new Date(job.scheduled_at).getTime();
  if(busy||inFlight.current||saved||editing||publishRequested||!publishAck||job.delivery_mode!=='manual'||job.status!=='approved'||job.manual_ready!==true||current<at||current-at>maxLateness*1000)return;
  inFlight.current=true;setPublishing(true);setPublishRequested(true);setPublishAck(false);
  try{await action('publication-publish',{id:job.id,expected_version:job.version,expected_account_id:job.account_id,acknowledged:true});}
  finally{inFlight.current=false;setPublishing(false);}
 }
 return <article><h3>{job.platform} · {job.status}</h3><p>Delivery: {job.delivery_mode==='manual'?'Manual, owner-triggered only':'Authorized scheduler'}<br/>Account: {job.account_id} · {job.remote_id} · Scheduled: {new Date(job.scheduled_at).toLocaleString(undefined,{timeZoneName:'short'})}</p><pre>{job.payload.text}</pre>{job.payload.media?.map((m:Data)=><p key={m.sha256}>Image: {m.url}<br/>SHA-256: {m.sha256}</p>)}<small>Exact publication version: {job.version}</small>{job.reason&&<p role="status">{job.reason}</p>}{job.receipt&&<p>Provider receipt: {job.receipt.provider_id}{job.receipt.url&&<> · <a href={job.receipt.url} target="_blank" rel="noreferrer">View published post</a></>}</p>}
  {job.delivery_mode==='manual'&&<p>No scheduler delivers this plan. Publishing is allowed only from the displayed time through {new Date(new Date(job.scheduled_at).getTime()+maxLateness*1000).toLocaleString(undefined,{timeZoneName:'short'})}, with all approvals and connection gates still current.</p>}
  {job.delivery_mode==='manual'&&job.manual_reason&&<p role="status">{job.manual_reason}</p>}
  {job.delivery_mode==='manual'&&job.status==='approved'&&job.manual_ready===true&&!editing&&!saved&&<>
   <label><input type="checkbox" checked={publishAck} disabled={busy||publishing||publishRequested} onChange={e=>setPublishAck(e.target.checked)}/>I have reviewed the exact text, media, account, version and approved time shown above. I choose to publish this exact plan now.</label>
   <button disabled={busy||publishing||publishRequested||!publishAck} onClick={()=>void publishNow()}>Publish this exact approved plan now</button>
  </>}
  {publishRequested&&<p role="status">{publishing?'Checking and delivering this exact plan. Do not submit it again.':'Check the saved publication status and provider receipt before taking further action. An uncertain result must not be replayed.'}</p>}
  {saved&&<p role="status">Reschedule saved. Refresh to review the new exact plan before approving it.</p>}
  {job.status==='staged'&&<><label><input type="checkbox" checked={ack} disabled={busy||saving||publishing||publishRequested||editing||saved} onChange={e=>setAck(e.target.checked)}/>{acknowledgement}</label><button disabled={busy||saving||publishing||publishRequested||editing||saved||!ack} onClick={()=>void action('publication-approve',{id:job.id,expected_version:job.version,acknowledged:true})}>Approve this exact plan</button></>}
  {editable&&!publishRequested&&<>
   {editing?<div><label>New posting time (your browser timezone)<input type="datetime-local" value={scheduled} disabled={busy||saving} onChange={e=>{setScheduled(e.target.value);setNow(Date.now());}}/></label>
    <label>Delivery method<select value={deliveryMode} disabled={busy||saving} onChange={e=>setDeliveryMode(e.target.value)}><option value="scheduled">Authorized scheduler</option><option value="manual">Manual, owner-triggered only</option></select></label>
    <p>Choose a different future time or delivery method. Rescheduling stages a new version, not a publication. Review its content, destination, media and time before giving fresh approval.</p>
    {scheduledAt&&<p>Selected time: {new Date(scheduledAt).toLocaleString(undefined,{timeZoneName:'longOffset'})} ({Intl.DateTimeFormat().resolvedOptions().timeZone})<br/>UTC: {scheduledAt}</p>}
    {scheduled&&!valid&&<p role="status">Enter a valid future date and time, and change the time or delivery method.</p>}
    <button disabled={busy||saving||saved||!valid} onClick={()=>void reschedule()}>Save new time for review</button><button disabled={busy||saving} onClick={()=>{setEditing(false);setScheduled('');setDeliveryMode(job.delivery_mode||'scheduled');}}>Keep current time</button>
   </div>:<button disabled={busy||saving||saved} onClick={()=>{setAck(false);setPublishAck(false);setNow(Date.now());setEditing(true);}}>Reschedule publication</button>}
   <button disabled={busy||saving||saved} onClick={()=>void action('publication-cancel',{id:job.id,expected_version:job.version})}>Cancel publication</button>
  </>}
 </article>;
}
export default function PublicationPanel({publishing,media,reviews,busy,action}:{publishing:Data;media:Data;reviews:Data[];busy:boolean;action:(path:string,body:unknown)=>Promise<boolean>}){
 const [task,setTask]=useState(''),[account,setAccount]=useState(''),[scheduled,setScheduled]=useState(''),[mediaUrl,setMediaUrl]=useState(''),[mediaHash,setMediaHash]=useState(''),[mediaAck,setMediaAck]=useState(''),[deliveryMode,setDeliveryMode]=useState('scheduled');
 const accounts:Data[]=publishing.accounts||[],jobs:Data[]=publishing.jobs||[];
 const selected=accounts.find(a=>a.id===account),review=reviews.find(r=>r.task_id===task),variant=review?.variants?.variants.find((v:Data)=>v.platform===selected?.platform);
 const generated=media?.artifacts?.find((m:Data)=>m.task_id===task&&m.review_token===review?.token);
 const mediaConsentKey=generated?generated.id+':'+generated.sha256+':'+media.storage?.public_origin:'';
 const hostingApproved=generated&&media.approvals?.some((a:Data)=>a.artifact_id===generated.id&&a.sha256===generated.sha256&&a.public_origin===media.storage?.public_origin);
 async function stage(){if(!review||!selected||!variant?.text)return;const ok=await action('publication-enqueue',{request_id:crypto.randomUUID(),task_id:task,review_token:review.token,platform:selected.platform,account_id:account,delivery_mode:deliveryMode,scheduled_at:new Date(scheduled).toISOString(),payload:{text:variant.text,...(selected.platform==='Instagram'?{media:[{url:mediaUrl||generated?.public_url,sha256:mediaHash||generated?.sha256,mime_type:'image/jpeg'}]}:{})}});if(ok){setScheduled('');setMediaUrl('');setMediaHash('');}}
 return <section><h2>Publication plans</h2><p>Choose an approved draft, destination and time. Staging does not publish; review the saved exact plan before approving it.</p><label>Content family<select value={task} onChange={e=>{setTask(e.target.value);setAccount('');setMediaAck('');setMediaUrl('');setMediaHash('');}}><option value="">Choose content</option>{reviews.filter(r=>r.approval).map(r=><option key={r.task_id} value={r.task_id}>{r.task_id.slice(0,8)} · approved</option>)}</select></label><label>Destination account<select value={account} onChange={e=>{setAccount(e.target.value);setMediaAck('');}}><option value="">Choose account</option>{accounts.filter(a=>review?.variants?.variants.some((v:Data)=>v.platform===a.platform)).map(a=><option key={a.id} value={a.id}>{a.platform} · {a.label} · {a.remote_id}</option>)}</select></label><label>Delivery method<select value={deliveryMode} onChange={e=>setDeliveryMode(e.target.value)}><option value="scheduled">Authorized scheduler</option><option value="manual">Manual, owner-triggered only</option></select></label><p>{deliveryMode==='manual'?'You must return and deliberately publish within the approved time window. No scheduler is required or implied.':'Requires an independently authorized, sufficiently frequent scheduler. Saving a plan does not provision delivery.'}</p><label>Posting time (your browser timezone)<input type="datetime-local" value={scheduled} onChange={e=>setScheduled(e.target.value)}/></label>{selected?.platform==='Instagram'&&<>
 <button disabled={busy||!review} onClick={()=>void action('publication-media-stage',{task,review_token:review?.token})}>Create private JPEG card from this exact draft</button>
 {generated&&<div><p>Review the exact private image before approving public hosting.</p><Image unoptimized alt="Private preview of the exact generated Instagram card" src={'/api/studio/publication-media-preview?id='+generated.id} width={360} height={450} style={{maxWidth:'100%',height:'auto'}}/><p>Image SHA-256: {generated.sha256}</p><p>Public hosting destination: {media.storage?.public_origin||'Not configured'}</p>{hostingApproved?<p>Public hosting approved for this exact image and destination.</p>:<><label><input type="checkbox" checked={!!mediaConsentKey&&mediaAck===mediaConsentKey} onChange={e=>setMediaAck(e.target.checked?mediaConsentKey:'')}/>I approve making this exact JPEG publicly accessible on the displayed Vercel Blob destination for my Instagram publication. Source notes and chat history stay private.</label><button disabled={busy||!mediaConsentKey||mediaAck!==mediaConsentKey||!media.storage?.public_origin} onClick={()=>void action('publication-media-approve',{id:generated.id,sha256:generated.sha256,public_origin:media.storage.public_origin,acknowledged:true})}>Approve exact image hosting</button></>}<p>{media.storage?.notice}</p></div>}
<label>Immutable public JPEG URL<input type="url" value={mediaUrl} onChange={e=>setMediaUrl(e.target.value)}/></label><label>Exact image SHA-256<input value={mediaHash} onChange={e=>setMediaHash(e.target.value)}/></label></>}{variant?.text&&<pre>{variant.text}</pre>}<button disabled={busy||!variant?.text||!scheduled||!selected||!Number.isFinite(Date.parse(scheduled))} onClick={()=>void stage()}>Stage exact publication plan</button>
 {jobs.length===0?<p>No publication plans or receipts yet.</p>:jobs.map(job=><PublicationJob key={job.id+':'+job.version} job={job} acknowledgement={job.delivery_mode==='manual'?publishing.manual_acknowledgement:publishing.acknowledgement} maxLateness={(job.delivery_mode==='manual'?publishing.manual_max_lateness_seconds??publishing.max_lateness_seconds:publishing.max_lateness_seconds)??300} busy={busy} action={action}/>)}
 </section>;
}
