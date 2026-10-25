'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
type Snapshot=Awaited<ReturnType<typeof import('../lib/private-comparison').comparisonSnapshot>>&{execution_ready?:boolean};
type Row=Record<string,any>;
type View={outputHashesValid:boolean;comparison:Snapshot;studio:{tasks:Row[];sources:Row[];reviews:Row[];ledger:Row[];events:Row[]}};
const storageKey=(scope:string,run?:string)=>'studio.private-comparison.'+(run?'adopt:'+run:'run:'+scope);
const detail=(event:Row)=>{try{return JSON.parse(event.detail);}catch{return null;}};
/** Client eligibility is presentation only; the adoption endpoint re-verifies every saved byte. */
export function comparisonPreparation(view:View){
 const {comparison:c,studio:s}=view,target=c.scope.target,model=c.scope.pricing.model;
 const starts=c.history.filter(e=>e.kind==='private_comparison_started'),ends=c.history.filter(e=>e.kind==='private_comparison_finished');
 if(!view.outputHashesValid||starts.length!==1||ends.length!==1)return null;
 const run=starts[0].detail.run_id,end=ends[0].detail,stages=c.history.filter(e=>e.kind==='private_comparison_stage'&&e.detail.run_id===run);
 const ledger=s.ledger.filter(r=>r.id===run),task=s.tasks.find(t=>t.id===target.task_id),review=s.reviews.find(r=>r.task_id===target.task_id);
 if(starts[0].detail.scope_hash!==c.scope_hash||end.run_id!==run||end.status!=='completed_requires_review'||end.steps!==6||end.reservation_retained!==false||stages.length!==6||!c.scope.plan.every((p,index)=>stages.filter(e=>e.detail.role===p.role&&e.detail.checkpoint===index&&e.detail.report?.model===model&&e.detail.report?.tier==='default'&&e.detail.report?.finish_reason==='stop'&&typeof e.detail.text==='string'&&!!e.detail.text.trim()&&e.detail.raw?.choices?.[0]?.message?.content===e.detail.text&&e.detail.raw?.choices?.[0]?.finish_reason==='stop'&&!e.detail.raw?.choices?.[0]?.message?.refusal).length===1)||ledger.length!==1||ledger[0].status!=='settled'||ledger[0].completion_status!=='completed_requires_review'||ledger[0].provider!=='openai'||ledger[0].model!==model||ledger[0].pricing_anomaly||task?.status!=='review'||task.checkpoint!==6||task.source_id!==target.source_id||task.source_hash!==target.source_hash||!review||typeof review.token!=='string'||!c.preview)return null;
 const adopted=s.events.some(e=>e.task_id===target.task_id&&e.kind==='private_comparison_adopted'&&detail(e)?.run_id===run);
 return {run_id:run,review_token:review.token,adopted,pending:!!review.pending_agent_revision};
}
async function readView():Promise<View>{
 const [comparison,studio]=await Promise.all([fetch('/api/private-comparison',{cache:'no-store',credentials:'same-origin'}),fetch('/api/studio/state',{cache:'no-store',credentials:'same-origin'})]);
 if(!comparison.ok||!studio.ok)throw Error('Private preview unavailable');
 const saved:Snapshot=await comparison.json(),state=await studio.json(),stages=saved.history.filter(e=>e.kind==='private_comparison_stage');
 let outputHashesValid=false;
 if(stages.length===6)try{outputHashesValid=(await Promise.all(stages.map(async e=>{if(typeof e.detail.text!=='string')return false;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(e.detail.text));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')===e.detail.hash;}))).every(Boolean);}catch{}
 return {comparison:saved,studio:state,outputHashesValid};
}
/** Only deliberate clicks can POST. Refresh/mount/status recovery are read-only. */
export default function PrivateComparisonPanel({refreshKey}:{refreshKey:string}){
 const [view,setView]=useState<View|null>(null),[message,setMessage]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState<'run'|'adopt'|null>(null),[storageReady,setStorageReady]=useState(false),[attempted,setAttempted]=useState({run:false,adopt:false});
 const inFlight=useRef(false),epoch=useRef(0);
 const apply=useCallback((next:View)=>{
  setView(next);const preparation=comparisonPreparation(next);
  try{setAttempted({run:sessionStorage.getItem(storageKey(next.comparison.scope_hash))!==null,adopt:!!preparation&&sessionStorage.getItem(storageKey(next.comparison.scope_hash,preparation.run_id))!==null});setStorageReady(true);}catch{setStorageReady(false);setMessage('Safe attempt recording is unavailable in this browser. No action can be submitted.');}
 },[]);
 const refresh=useCallback(async()=>{
  const request=++epoch.current;
  try{const next=await readView();if(request===epoch.current){apply(next);setAck(false);}}
  catch{if(request===epoch.current){setView(null);setMessage('Saved status could not be read. Refresh status; no automatic action or retry was made.');}}
 },[apply]);
 const invalidate=useCallback(()=>{epoch.current++;},[]);
 useEffect(()=>{void refresh();return invalidate;},[refreshKey,refresh,invalidate]);
 const preparation=view?comparisonPreparation(view):null;
 const canRun=view?.comparison.execution_ready===true&&!!view.comparison.preview&&!view.comparison.history.length&&!attempted.run;
 const canAdopt=!!preparation&&!preparation.adopted&&!preparation.pending&&!attempted.adopt;
 async function execute(mode:'run'|'adopt'){
  if(!view||!ack||!storageReady||busy||inFlight.current||!(mode==='run'?canRun:canAdopt))return;
  inFlight.current=true;setBusy(mode);setAck(false);const request=++epoch.current;
  let sent=false;
  try{
   const fresh=await readView();if(request!==epoch.current)return;apply(fresh);
   const next=comparisonPreparation(fresh),old=view.comparison;
   if(mode==='run'?(fresh.comparison.execution_ready!==true||fresh.comparison.scope_hash!==old.scope_hash||fresh.comparison.preview?.state_hash!==old.preview?.state_hash||fresh.comparison.history.length>0):(!next||next.adopted||next.pending||next.run_id!==preparation?.run_id||next.review_token!==preparation?.review_token||fresh.comparison.preview?.state_hash!==old.preview?.state_hash)){
    setMessage('The source, run or review changed. Read the fresh preview and confirm again; no action was submitted.');return;
   }
   const key=storageKey(old.scope_hash,mode==='adopt'?next!.run_id:undefined);
   if(sessionStorage.getItem(key)!==null){setMessage('An attempt is already recorded. Inspect saved status; do not retry.');return;}
   // Persist before transmission, including across page reloads or a lost response.
   sessionStorage.setItem(key,JSON.stringify({state_hash:fresh.comparison.preview!.state_hash,at:new Date().toISOString()}));
   setAttempted(previous=>({...previous,[mode]:true}));sent=true;
   const response=await fetch(mode==='run'?'/api/private-comparison':'/api/private-comparison/adopt',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode==='run'?{expected_state_hash:fresh.comparison.preview!.state_hash,scope_hash:old.scope_hash,acknowledged:true}:{run_id:next!.run_id,task_id:old.scope.target.task_id,scope_hash:old.scope_hash,expected_review_token:next!.review_token})});
   const data=await response.json();
   setMessage(response.ok?(mode==='run'?'Comparison saved. Inspect all six unchanged outputs and findings before preparing final review.':'Prepared for final post review. Refresh the Approval inbox to inspect this exact revision; nothing was approved, scheduled or published.'):(data.result?.status?'Comparison stopped: '+data.result.status+'. Inspect saved history and usage; do not retry.':'Action was not confirmed. Inspect saved history and current review; do not retry.'));
  }catch{setMessage(sent?'Outcome unconfirmed. Read saved history and usage; do not retry. No automatic resubmission will occur.':'Fresh binding or safe attempt recording was unavailable. No action was submitted. Refresh status before confirming again.');}
  finally{inFlight.current=false;setBusy(null);if(sent)await refresh();}
 }
 if(!view)return <section aria-label="Private model comparison"><p role="status">{message||'Reading private comparison status…'}</p><button onClick={()=>void refresh()}>Refresh saved status</button></section>;
 const c=view.comparison,target=c.scope.target,source=view.studio.sources.find(s=>s.id===target.source_id),maximum=(c.scope.maximum_microdollars/1_000_000).toFixed(2);
 return <section aria-label="Private model comparison"><h2>Private model comparison</h2>
  <p>One private six-stage attempt · {c.scope.pricing.model} · maximum ${maximum}. No fallback or retry. This does not approve, schedule or publish a post.</p>
  <p>Task {target.task_id} · Source {target.source_id}</p><small>Source SHA-256 {target.source_hash}</small>
  {source?.hash===target.source_hash&&<details><summary>Exact cleared source for this comparison</summary><pre>{source.text}</pre></details>}
  <ComparisonResult state={c}/>
  {!c.history.length&&c.execution_ready!==true&&<p>The private comparison release gate or runtime is not ready. No attempt can be submitted; refresh after setup is ready.</p>}
  {busy&&<p role="status">{busy==='run'?'Comparison in progress. This may take several minutes; do not submit again.':'Preparing the unchanged comparison for final review…'}</p>}
  {message&&<p role="status">{message}</p>}
  {canRun&&<><label><input type="checkbox" checked={ack} disabled={!!busy||!storageReady} onChange={e=>setAck(e.target.checked)}/> Run this exact source once through all six stages using {c.scope.pricing.model}, reserving at most ${maximum} within the existing budget. I understand there is no automatic retry and no publication approval.</label><button disabled={!ack||!!busy||!storageReady} onClick={()=>void execute('run')}>Run private comparison once · max ${maximum}</button></>}
  {preparation&&!preparation.adopted&&<p>Current exact review token: <code>{preparation.review_token}</code>. Preparation copies all six saved outputs unchanged; factual and editorial findings remain.</p>}
  {canAdopt&&<><label><input type="checkbox" checked={ack} disabled={!!busy||!storageReady} onChange={e=>setAck(e.target.checked)}/> Prepare these six unchanged model outputs as an unapproved revision for final post review. This is not approval to schedule or publish.</label><button disabled={!ack||!!busy||!storageReady} onClick={()=>void execute('adopt')}>Prepare for final post review</button></>}
  {preparation?.adopted&&<p>Already prepared for final post review. Inspect the saved revision in the Approval inbox; fresh final-post approval remains required.</p>}
  {preparation?.pending&&<p>A separate agent revision is pending. Review or cancel it before preparing this comparison.</p>}
  {(attempted.run||attempted.adopt)&&<p>An attempt is recorded in this browser. Refresh reads saved status only; it never retries.</p>}
  <button disabled={!!busy} onClick={()=>void refresh()}>Refresh saved status</button>
 </section>;
}
export function ComparisonResult({state}:{state:Snapshot}){
 if(!state.history.length)return null;
 const stages=state.history.filter(e=>e.kind==='private_comparison_stage'),end=state.history.find(e=>e.kind==='private_comparison_finished'),post=stages.find(e=>e.detail.role==='Platform Adapter');
 const status=end?.detail.status==='completed_requires_review'?'Comparison saved — factual and editorial review required.':end?'Comparison stopped — review the saved findings before any further action.':'Running or outcome unconfirmed — inspect history; do not retry.';
 return <section><p>{status}</p><p>{state.notice}</p>{post&&<article><h3>Unchanged LinkedIn candidate</h3><pre style={{whiteSpace:'pre-wrap'}}>{post.detail.text}</pre><small>SHA-256 {post.detail.hash}</small></article>}<details><summary>Six stages, raw outputs and review findings</summary><pre>{JSON.stringify(state.history,null,2)}</pre></details></section>;
}
