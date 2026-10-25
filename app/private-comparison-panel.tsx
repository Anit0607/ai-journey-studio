'use client';
import {useEffect,useState} from 'react';
type Snapshot=Awaited<ReturnType<typeof import('../lib/private-comparison').comparisonSnapshot>>;
/** Results only: no run, edit, approval, calendar or publish controls. */
export default function PrivateComparisonPanel({refreshKey}:{refreshKey:string}){
 const [state,setState]=useState<Snapshot|null>(null);
 useEffect(()=>{let active=true;void fetch('/api/private-comparison',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(active)setState(value);}).catch(()=>{});return()=>{active=false;};},[refreshKey]);
 return state?<ComparisonResult state={state}/>:null;
}
export function ComparisonResult({state}:{state:Snapshot}){
 if(!state.history.length)return null;
 const stages=state.history.filter(e=>e.kind==='private_comparison_stage'),end=state.history.find(e=>e.kind==='private_comparison_finished'),post=stages.find(e=>e.detail.role==='Platform Adapter');
 const status=end?.detail.status==='completed_requires_review'?'Comparison saved — factual and editorial review required.':end?'Comparison stopped — review the saved findings before any further action.':'Running or outcome unconfirmed — inspect history; do not retry.';
 return <section><h2>Private model comparison</h2><p>{status}</p><p>{state.notice}</p>{post&&<article><h3>Unchanged LinkedIn candidate</h3><pre style={{whiteSpace:'pre-wrap'}}>{post.detail.text}</pre><small>SHA-256 {post.detail.hash}</small></article>}<details><summary>Six stages, raw outputs and review findings</summary><pre>{JSON.stringify(state.history,null,2)}</pre></details></section>;
}
