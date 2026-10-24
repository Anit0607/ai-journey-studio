"use client";
import {useEffect,useRef,useState} from "react";
import type {LegacyNormalizationPreview} from "../lib/calendar-legacy-normalization";

// Keep this browser-only contract aligned with the server; never import its DB/crypto runtime.
const ACK="I approve normalizing only these four unbound legacy Calendar entries, including the displayed old/new aggregate timestamps and LinkedIn-only scope, without enabling generation, import, source clearance, model execution or publication.";
const TARGETS:Record<string,string>={"e15dbb66-c3f9-4141-8b94-544e14349b46":"2026-11-02","c2aed4a0-1257-4faa-ac59-090e5d838a28":"2026-11-04","b57e284f-ffc5-4162-9b9d-8398b554eb39":"2026-11-06","183af62f-c135-474b-b6d6-0fe77dc24c4e":"2026-11-08"};
const STORAGE="calendar-legacy-normalization-pending-v1",EVENT="calendar_legacy_normalized_v1";
const TIMES=["intended_post","draft_due","review_due","generation_due"] as const;
const LABELS={intended_post:"Post",draft_due:"Draft",review_due:"Review",generation_due:"Generation"};
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const object=(value:any):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const exactKeys=(value:any,keys:string[])=>object(value)&&Object.keys(value).sort().join("|")===keys.sort().join("|");
const stamp=(value:any)=>typeof value==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const canonical=(value:any):string=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a:any,b:any)=>canonical(a)===canonical(b);
function validPreview(value:any):value is LegacyNormalizationPreview{
 if(!exactKeys(value,["schema","settings_hash","settings","entries","changes","preview_fingerprint","acknowledgement","paid_execution"])||value.schema!==1||value.paid_execution!==false||value.acknowledgement!==ACK||!SHA.test(value.settings_hash)||!SHA.test(value.preview_fingerprint)||!object(value.settings)||!Array.isArray(value.entries)||value.entries.length!==4||!Array.isArray(value.changes)||value.changes.length!==4)return false;
 if(!same(value.entries.map((entry:any)=>entry?.id).sort(),Object.keys(TARGETS).sort())||!same(value.changes.map((change:any)=>change?.id).sort(),Object.keys(TARGETS).sort()))return false;
 return value.entries.every((entry:any)=>exactKeys(entry,["id","row_hash","updated"])&&SHA.test(entry.row_hash)&&stamp(entry.updated))&&value.changes.every((change:any)=>{
  if(!exactKeys(change,["id","kind","planned_date","before","after"])||change.planned_date!==TARGETS[change.id]||change.kind!==(change.planned_date==="2026-11-08"?"longform":"shortform"))return false;
  const before=change.before,after=change.after;
  if(![before,after].every(plan=>exactKeys(plan,[...TIMES,"platform_schedule"])&&TIMES.every(key=>stamp(plan[key]))&&object(plan.platform_schedule)))return false;
  const old=before.platform_schedule,next=after.platform_schedule;
  if(!exactKeys(old,["Instagram","LinkedIn","X"])||!exactKeys(next,["LinkedIn","platform_policy"])||!same(next.platform_policy,{version:1,platforms:["LinkedIn"]})||!same(old.LinkedIn,next.LinkedIn))return false;
  if(!["Instagram","LinkedIn","X"].every(platform=>exactKeys(old[platform],["draft_due","intended_post","review_due"])&&["draft_due","intended_post","review_due"].every(key=>typeof old[platform][key]==="string"&&Number.isFinite(Date.parse(old[platform][key])))))return false;
  return ["intended_post","draft_due","review_due"].every(key=>Date.parse(after[key])===Date.parse(next.LinkedIn[key]))&&Date.parse(after.intended_post)-Date.parse(after.generation_due)===120*3600000&&Date.parse(after.intended_post)-Date.parse(after.review_due)===48*3600000;
 });
}
function validResult(value:any,preview:LegacyNormalizationPreview){return exactKeys(value,["status","audit_id","preview_fingerprint","changes","paid_execution"])&&["applied","already_applied"].includes(value.status)&&typeof value.audit_id==="string"&&UUID.test(value.audit_id)&&value.paid_execution===false&&value.preview_fingerprint===preview.preview_fingerprint&&same(value.changes,preview.changes);}
async function savedReceipt(state:any,preview:LegacyNormalizationPreview):Promise<string|null>{
 if(!Array.isArray(state?.events))return null;
 const matches=state.events.filter((event:any)=>event.kind===EVENT);
 if(matches.length!==1||!UUID.test(matches[0].id)||typeof matches[0].detail!=="string")return null;
 try{
  const audit=JSON.parse(matches[0].detail);
  // The server saves canonical JSON. Requiring its exact bytes also rejects duplicate/escaped keys.
  if(matches[0].detail!==canonical(audit)||!exactKeys(audit,["schema","settings_hash","entries","preview_fingerprint","acknowledgement","before","after","changes"])||audit.schema!==1||audit.acknowledgement!==ACK||audit.preview_fingerprint!==preview.preview_fingerprint||audit.settings_hash!==preview.settings_hash||!same(audit.entries,preview.entries)||!same(audit.changes,preview.changes)||!Array.isArray(audit.before)||!Array.isArray(audit.after)||audit.before.length!==4||audit.after.length!==4)return null;
  for(const change of preview.changes){
   const proof=preview.entries.find(entry=>entry.id===change.id)!;
   for(const side of ["before","after"] as const){
    const rows=audit[side].filter((row:any)=>row.id===change.id),row=rows[0];
    if(rows.length!==1||!exactKeys(row,["id","planned_date","kind",...TIMES,"source_id","task_id","platform_schedule","updated"])||row.planned_date!==change.planned_date||row.kind!==change.kind||row.source_id!==null||row.task_id!==null||!stamp(row.updated)||!TIMES.every(key=>row[key]===change[side][key])||!same(row.platform_schedule,change[side].platform_schedule))return null;
    if(side==="before"){
     const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(row))),hash=Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
     if(row.updated!==proof.updated||hash!==proof.row_hash)return null;
    }
   }
  }
  return matches[0].id;
 }catch{return null;}
}
export default function CalendarNormalizationForm({busy,snapshot}:{busy:boolean;snapshot:string}){
 const [preview,setPreview]=useState<LegacyNormalizationPreview|null>(null),[version,setVersion]=useState(""),[ack,setAck]=useState(false),[working,setWorking]=useState(false),[checking,setChecking]=useState(true),[pending,setPending]=useState<LegacyNormalizationPreview|null>(null),[locked,setLocked]=useState(false),[message,setMessage]=useState(""),[receipt,setReceipt]=useState("");
 const inFlight=useRef(false),mounted=useRef(false),epoch=useRef(0);
 const stale=!!preview&&version!==snapshot;
 async function inspect(expected:LegacyNormalizationPreview){
  try{
   const response=await fetch("/api/studio/state",{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(10_000)});
   if(!response.ok)throw Error();
   const audit=await savedReceipt(await response.json(),expected);
   if(!mounted.current)return;
   if(audit){sessionStorage.removeItem(STORAGE);setPending(null);setReceipt(audit);setMessage("Saved audit confirms the repair of all four entries. This is a historical receipt, not publication approval.");}
   else setMessage("Repair outcome is not confirmed. No matching saved audit was found in the available Events. Do not retry the repair; check the saved audit again after the current operation finishes.");
  }catch{if(mounted.current)setMessage("Repair outcome is not confirmed. Saved audit readback is unavailable. Sign in if needed, then check the saved audit. No repair will be retried.");}
 }
 useEffect(()=>{
  mounted.current=true;
  try{
   const saved=sessionStorage.getItem(STORAGE);
   if(saved){const expected=JSON.parse(saved);setLocked(true);if(validPreview(expected)){setPending(expected);setWorking(true);inFlight.current=true;void inspect(expected).finally(()=>{inFlight.current=false;if(mounted.current)setWorking(false);});}else setMessage("Saved repair state is invalid. Inspect Events before any further repair; this control is locked to prevent an uncertain retry.");}
  }catch{setLocked(true);setMessage("Repair safety storage is unavailable. No changes were sent; this control is locked.");}
  setChecking(false);
  return ()=>{mounted.current=false;epoch.current+=1;};
 },[]);
 async function loadPreview(){
  if(busy||checking||locked||inFlight.current)return;
  inFlight.current=true;setWorking(true);setPreview(null);setAck(false);setMessage("");const current=++epoch.current;
  try{
   const response=await fetch("/api/calendar/normalize-legacy",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"preview"}),signal:AbortSignal.timeout(15_000)}),data=await response.json();
   if(!mounted.current||epoch.current!==current)return;
   if(!response.ok)throw Error(typeof data?.error==="string"?data.error:"Preview unavailable. Sign in and request a fresh preview.");
   if(!validPreview(data?.result))throw Error("Invalid repair preview. No approval or changes are possible; request a fresh preview.");
   setPreview(data.result);setVersion(snapshot);
  }catch(error){if(mounted.current&&epoch.current===current)setMessage(error instanceof Error?error.message:"Preview unavailable. No changes were sent.");}
  finally{inFlight.current=false;if(mounted.current)setWorking(false);}
 }
 async function commit(){
  if(busy||checking||locked||inFlight.current||!preview||stale||!ack)return;
  const expected=preview;inFlight.current=true;setWorking(true);setAck(false);setMessage("");
  try{sessionStorage.setItem(STORAGE,JSON.stringify(expected));}
  catch{setMessage("Repair safety storage is unavailable. No changes were sent.");setWorking(false);inFlight.current=false;return;}
  setLocked(true);setPending(expected);
  try{
   const response=await fetch("/api/calendar/normalize-legacy",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"commit",settings_hash:expected.settings_hash,entries:expected.entries,preview_fingerprint:expected.preview_fingerprint,acknowledged:true}),signal:AbortSignal.timeout(15_000)}),data=await response.json();
   if(!mounted.current)return; // Leave the pending marker for read-only recovery after navigation/reload.
   if(!response.ok&&[401,403,409].includes(response.status)&&typeof data?.error==="string"){
    sessionStorage.removeItem(STORAGE);setPending(null);setLocked(false);setPreview(null);setMessage(data.error+" No automatic retry was made. Request a fresh preview only after resolving this blocker.");return;
   }
   if(!response.ok||!validResult(data?.result,expected))throw Error("Unconfirmed repair response");
   sessionStorage.removeItem(STORAGE);setPending(null);setPreview(null);setReceipt(data.result.audit_id);setMessage("Saved audit confirms the repair of all four entries. Existing LinkedIn times are preserved. Generation, imports, model execution and publication were not enabled.");
  }catch{if(mounted.current){setPreview(null);setMessage("Repair outcome is not confirmed. Checking the saved audit without retrying the repair.");await inspect(expected);}}
  finally{inFlight.current=false;if(mounted.current)setWorking(false);}
 }
 async function readAgain(){if(busy||inFlight.current||!pending)return;inFlight.current=true;setWorking(true);try{await inspect(pending);}finally{inFlight.current=false;if(mounted.current)setWorking(false);}}
 const disabled=busy||working||checking;
 return <div role="region" aria-label="Repair four legacy Calendar entries" style={{margin:"24px 0",padding:20,border:"1px solid #40534e",borderRadius:8,minWidth:0}}>
  <h3>Repair four unused legacy plans</h3>
  <p>Only the reviewed November 2, 4, 6 and 8, 2026 entries can change. Keep their existing LinkedIn posting times, align the aggregate timestamps and 120-hour generation lead, and remove the old Instagram/X scope. No source is linked, no draft runs, and nothing is approved for publication.</p>
  {message&&<p role="status">{message}</p>}
  {receipt&&<p>Saved normalization audit: <code>{receipt}</code>. All four changes were saved together. The Calendar refreshes automatically.</p>}
  {!locked&&!receipt&&<button disabled={disabled} onClick={()=>void loadPreview()}>{preview?"Request a fresh repair preview":"Preview four-entry repair"}</button>}
  {preview&&!locked&&<div>
   <p>Exact four-entry diff below. All timestamps are UTC; each existing LinkedIn sub-schedule is preserved unchanged. Review this separately from any final-post approval.</p>
   <div style={{overflowX:"auto"}}><table style={{width:"100%",tableLayout:"fixed"}}><caption>Four legacy plans: previous and repaired values</caption><thead><tr><th>Plan</th><th>Before (UTC)</th><th>After (UTC)</th></tr></thead><tbody>{[...preview.changes].sort((a,b)=>a.planned_date.localeCompare(b.planned_date)).map(change=><tr key={change.id}><th>{change.planned_date}<br/>{change.kind}<br/><small>{change.id}</small></th>{(["before","after"] as const).map(side=><td key={side} style={{verticalAlign:"top"}}>{TIMES.map(key=><p key={key}>{LABELS[key]}: <code style={{display:"block",overflowWrap:"anywhere"}}>{change[side][key]}</code></p>)}<details><summary>Complete {side} platform JSON</summary><pre>{JSON.stringify(change[side].platform_schedule,null,2)}</pre></details></td>)}</tr>)}</tbody></table></div>
   <details><summary>Exact preview binding and saved settings</summary><pre>{JSON.stringify({settings_hash:preview.settings_hash,settings:preview.settings,entries:preview.entries,preview_fingerprint:preview.preview_fingerprint},null,2)}</pre></details>
   {stale&&<p role="status">Calendar state changed after this preview. Request a fresh preview and review it again before approving.</p>}
   <label><input type="checkbox" aria-label="Approve this exact four-entry repair" checked={ack} disabled={disabled||stale} onChange={event=>setAck(event.target.checked)}/>{preview.acknowledgement}</label>
   <button disabled={disabled||stale||!ack} onClick={()=>void commit()}>Apply exactly these four repairs</button>
   <button disabled={working} onClick={()=>{epoch.current+=1;setPreview(null);setAck(false);setMessage("");}}>Close without changes</button>
  </div>}
  {pending&&<button disabled={disabled} onClick={()=>void readAgain()}>Check saved repair audit only</button>}
 </div>;
}
