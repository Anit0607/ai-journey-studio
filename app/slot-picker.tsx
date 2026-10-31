"use client";
import {useState} from "react";

type Entry={id:string;planned_date:string;kind:string;intended_post:string;task_id:string|null;source_id:string|null};
const ist=(value:string)=>new Date(value).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false})+" IST";
/** Puts a drafted post that has no slot into a free future calendar slot. Nothing is approved. */
export default function SlotPicker({task,source,entries,busy,action}:{task:string;source:string;entries:Entry[];busy:boolean;action:(path:string,body:unknown)=>Promise<unknown>}){
  const [now]=useState(()=>Date.now());
  const free=entries.filter(entry=>!entry.task_id&&!entry.source_id&&Date.parse(entry.intended_post)>now+3_600_000).sort((a,b)=>Date.parse(a.intended_post)-Date.parse(b.intended_post));
  const [entry,setEntry]=useState(free[0]?.id||"");
  if(!free.length)return <p className="fine">No free calendar slot is available. Plan more weeks in Calendar.</p>;
  return <section aria-label="Choose a slot"><strong>Put this post in a slot</strong>
    <select aria-label="Free calendar slot" value={entry} disabled={busy} onChange={event=>setEntry(event.target.value)}>{free.map(item=><option key={item.id} value={item.id}>{ist(item.intended_post)} · {item.kind==="longform"?"long-form":"post"}</option>)}</select>
    <button disabled={busy||!entry} onClick={()=>void action("calendar-link",{entry,source,task})}>Use this slot</button>
    <p className="fine">This only chooses the time. You still approve the post and its time before anything is scheduled.</p>
  </section>;
}
