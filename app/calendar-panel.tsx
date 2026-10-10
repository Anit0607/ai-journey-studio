"use client";
import {useState,type CSSProperties} from "react";
const weekdays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const field:CSSProperties={display:"block",margin:"8px 0 16px",padding:"10px",background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b"};
const displayDate=(value:string|null)=>value?new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})+" IST":"Not chosen";
function Entry({entry,sources,tasks,busy,action}:{entry:any;sources:any[];tasks:any[];busy:boolean;action:(path:string,body:unknown)=>Promise<void>}){
  const [source,setSource]=useState(entry.source_id||""),[task,setTask]=useState(entry.task_id||"");
  return <article><h3>{entry.planned_date} · {entry.kind} <span className="pill">{entry.status.replaceAll("_"," ")}</span></h3>
    <p>Intended posting: {displayDate(entry.intended_post)}<br/>Draft ready / review deadline: {displayDate(entry.review_due)}<br/>Generation due: {displayDate(entry.generation_due)}</p>
    <label>Cleared source<select style={field} aria-label={"Source for "+entry.planned_date} value={source} onChange={event=>{setSource(event.target.value);setTask("");}}><option value="">No source linked</option>{sources.map(item=><option key={item.id} value={item.id}>{item.category} · {item.reported_date} · {item.id.slice(0,8)}</option>)}</select></label>
    <label>Existing content task<select style={field} aria-label={"Task for "+entry.planned_date} value={task} onChange={event=>setTask(event.target.value)}><option value="">No task linked</option>{tasks.filter(item=>item.source_id===source).map(item=><option key={item.id} value={item.id}>{item.id.slice(0,8)} · {item.status}</option>)}</select></label>
    <button disabled={busy} onClick={()=>void action("calendar-link",{entry:entry.id,source:source||null,task:task||null})}>Save explicit links</button>
    <p>Linked source: {entry.source_id?.slice(0,8)||"none"} · Task: {entry.task_id?.slice(0,8)||"none"}</p>
    <p>{entry.variants.map((variant:any)=>variant.platform+": "+variant.status.replaceAll("_"," ")).join(" · ")}</p>
    {entry.linked_content_version&&<small>Exact content version: {entry.linked_content_version}</small>}
    <details><summary>Generation blockers ({entry.blocked_reasons.length})</summary>{entry.blocked_reasons.map((reason:string)=><p key={reason}>{reason}</p>)}</details>
    <small>Due intent: {entry.job?"prepared, paid execution blocked":"not prepared"} · Last updated {displayDate(entry.updated)}</small>
  </article>;
}
export default function CalendarPanel({calendar,sources,tasks,busy,action}:{calendar:any;sources:any[];tasks:any[];busy:boolean;action:(path:string,body:unknown)=>Promise<void>}){
  const settings=calendar.settings;
  const [date,setDate]=useState(settings.start_date||""),[time,setTime]=useState(settings.post_time||""),[lead,setLead]=useState(settings.generation_lead_hours?.toString()||""),[short,setShort]=useState<number[]>(settings.short_days),[long,setLong]=useState<number>(settings.long_day),[weeks,setWeeks]=useState(1);
  return <section><span className="eyebrow">APPROVED CADENCE · ASIA/KOLKATA</span><h2>Calendar and content queue</h2>
    <p>Monday, Wednesday, Friday posts; Sunday longer piece. Drafts ready for review 48 hours before intended posting. Edit the cadence below; posting date/hour are not assumed.</p>
    <p><strong>{calendar.configuration_needed?"Configuration needed: choose a start date and posting time":"Calendar timing saved"}</strong></p>
    <p>Agents are intended to draft; you review. Manual revision is an optional correction path. Calendar paid generation and publishing are disabled. {calendar.scheduler}</p>
    <label>Start date<input style={field} aria-label="Calendar start date" type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
    <label>Intended posting time (IST)<input style={field} aria-label="Posting time IST" type="time" value={time} onChange={event=>setTime(event.target.value)}/></label>
    <fieldset><legend>Shortform days</legend>{weekdays.map((day,index)=><label key={day} style={{marginRight:14}}><input type="checkbox" checked={short.includes(index)} onChange={event=>setShort(event.target.checked?[...short,index]:short.filter(item=>item!==index))}/>{day}</label>)}</fieldset>
    <label>Longer-piece day<select style={field} aria-label="Longform day" value={long} onChange={event=>setLong(Number(event.target.value))}>{weekdays.map((day,index)=><option key={day} value={index}>{day}</option>)}</select></label>
    <label>Optional generation lead (hours before intended posting; 48–336)<input style={field} aria-label="Generation lead hours" type="number" min={48} max={336} placeholder="Unset" value={lead} onChange={event=>setLead(event.target.value)}/></label>
    <p className="fine">48 hours is the draft/review deadline. A generation lead is a separate choice; leaving it empty creates no generation due time. No scheduler is activated by saving.</p>
    <button disabled={busy} onClick={()=>void action("calendar-configure",{start_date:date||null,post_time:time||null,short_days:short,long_day:long,generation_lead_hours:lead?Number(lead):null})}>Save calendar settings</button>
    <label>Weeks to plan<select style={field} aria-label="Weeks to plan" value={weeks} onChange={event=>setWeeks(Number(event.target.value))}>{[1,2,3,4].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <button disabled={busy||calendar.configuration_needed} onClick={()=>void action("calendar-plan",{weeks})}>Create or update planned dates</button> <button disabled={busy} onClick={()=>void action("calendar-prepare",{})}>Check due queue — no model calls</button>
    {calendar.entries.length===0?<div className="empty"><h3>No calendar entries yet</h3><p>Save timing and explicitly create planned dates. No source or task is selected automatically.</p></div>:calendar.entries.map((entry:any)=><Entry key={entry.id+entry.updated} entry={entry} sources={sources} tasks={tasks} busy={busy} action={action}/>)}
  </section>;
}
