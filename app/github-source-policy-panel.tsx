'use client';
import {useEffect,useRef,useState} from 'react';
import {recoverGithubPolicyStatus} from '../lib/github-policy-ui-state';
type Scope={repository:string;commit_summaries:boolean;note_paths:string[];categories:string[];start_date:string};
type Policy={id:string;scope_hash:string;scope:Scope;active:boolean};
type Preview={id:string;preview_hash:string;scope:Scope;acknowledgement:string;expires_at:string};
type Status={available:boolean;active:Policy|null;binding_current?:boolean;runtime_ready?:boolean;notice:string};
export default function GithubSourcePolicyPanel(){
 const [status,setStatus]=useState<Status|null>(null),[preview,setPreview]=useState<Preview|null>(null),[date,setDate]=useState(''),[paths,setPaths]=useState(''),[commits,setCommits]=useState(true),[ack,setAck]=useState(false),[revokeAck,setRevokeAck]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const pending=useRef(false),revision=useRef(0);
 async function readStatus(){const r=await fetch('/api/source-policy/status',{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'Source policy status unavailable');return data as Status;}
 useEffect(()=>{let active=true;void readStatus().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setNotice('Saved source-consent status is unavailable. Sign in as the owner before making changes.');});return()=>{active=false;};},[]);
 function changed(){revision.current++;setPreview(null);setAck(false);setNotice('');}
 async function perform(action:string,input:unknown){
  if(pending.current)return;pending.current=true;setBusy(true);setNotice('');const version=revision.current;
  try{
   const result=await fetch('/api/source-policy/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await result.json();
   if(!result.ok)throw Error(data.error||'Source policy request unavailable');
   if(action==='preview'){if(version===revision.current){setPreview(data.preview);setAck(false);}}
   else {setPreview(null);setAck(false);setRevokeAck(false);setNotice(data.notice||'Saved');}
   setStatus(await readStatus());setUncertain(false);
  }catch(error){
   setAck(false);setRevokeAck(false);
   if(action!=='preview'){
    setPreview(null);setUncertain(true);
    const recovered=await recoverGithubPolicyStatus(readStatus);setStatus(recovered.status);setUncertain(recovered.uncertain);setNotice(recovered.notice);
   }else setNotice(error instanceof Error?error.message:'Source policy preview unavailable.');
  }
  finally{pending.current=false;setBusy(false);}
 }
 return <section aria-labelledby="github-policy-title">
  <span className="eyebrow">OPTIONAL · BOUNDED SOURCE CONSENT</span>
  <h2 id="github-policy-title">GitHub → LinkedIn draft selection</h2>
  <p>This is separate from exact-note review. A matching policy lets unused GitHub evidence fill an unlinked, due LinkedIn calendar slot. Every final post still needs your approval before scheduling and publication.</p>
  <p>Repository: Anit0607/ai-journey-studio only. No other repositories, code files, diffs, chats, bank/client material or credentials. GitHub access, paid-generation activation and scheduler setup remain separate.</p>
  {uncertain&&<p role="alert">Source consent status UNCONFIRMED. No activation or revocation will be retried automatically.</p>}
  {uncertain&&<button disabled={busy} onClick={()=>{setBusy(true);void readStatus().then(value=>{setStatus(value);setUncertain(false);setNotice('Saved status refreshed. No write was repeated.');}).catch(()=>setNotice('Saved status is still unavailable. Do not repeat the write.')).finally(()=>setBusy(false));}}>Refresh saved status</button>}
  {status&&<p role="status">{!status.available?'Setup pending · selection OFF':status.active?status.binding_current?'Source consent ON · other runtime and calendar gates still apply':'Source consent saved · runtime changed, selection blocked':'Source consent OFF'}{status.notice?' · '+status.notice:''}</p>}
  {status?.active?<>
   <p>Approved from {status.active.scope.start_date}; {status.active.scope.commit_summaries?'commit summaries enabled':'commit summaries excluded'}; categories: {status.active.scope.categories.join(', ')}.</p>
   <p>Exact note files: {status.active.scope.note_paths.join(', ')||'None'}. New filenames are not discovered automatically.</p>
   <label><input type="checkbox" checked={revokeAck} disabled={busy} onChange={e=>setRevokeAck(e.target.checked)}/> Stop future use under this policy. Keep manual source clearances and historical work unchanged.</label>
   <button disabled={busy||!revokeAck} onClick={()=>void perform('revoke',{policy_id:status.active!.id,expected_hash:status.active!.scope_hash,acknowledged:true})}>Revoke source policy</button>
  </>:<>
   <label>Start date (UTC)<input type="date" value={date} max={new Date().toISOString().slice(0,10)} disabled={busy||uncertain||!status?.available} onChange={e=>{changed();setDate(e.target.value);}}/></label>
   <label><input type="checkbox" checked={commits} disabled={busy||uncertain||!status?.available} onChange={e=>{changed();setCommits(e.target.checked);}}/> Include first-line commit summaries and existing account attribution, never commit bodies or diffs</label>
   <label>Exact progress-note files (optional, one per line, maximum five)<textarea value={paths} placeholder="docs/build-notes/progress.md" disabled={busy||uncertain||!status?.available} onChange={e=>{changed();setPaths(e.target.value);}}/></label>
   <p className="fine">Only direct Markdown files under docs/build-notes/ are supported. No folder wildcard or automatic discovery of new filenames. A note needs “## Verified progress” and “## Evidence” sections with immutable same-repository commit links.</p>
   <button disabled={busy||uncertain||!status?.available||!date||(!commits&&!paths.trim())} onClick={()=>void perform('preview',{repository:'anit0607/ai-journey-studio',commit_summaries:commits,note_paths:paths.split('\n').map(x=>x.trim()).filter(Boolean),start_date:date})}>Preview exact consent</button>
   {preview&&<article aria-label="Exact GitHub policy preview">
    <h3>Review this exact scope</h3>
    <p>{preview.scope.repository} · Start date: {preview.scope.start_date} UTC · Categories: {preview.scope.categories.join(', ')}.</p>
    <p>Commit summaries: {preview.scope.commit_summaries?'Included':'Excluded'}. Exact files: {preview.scope.note_paths.join(', ')||'None'}.</p>
    <p>Recipient: OpenAI. Selected facts, repository and immutable commit/file identifiers, existing commit author/committer account attribution, and intermediate drafts only, LinkedIn drafts and revisions. Shared monthly warning $10 USD; cap $15 USD. Each final post still needs your approval.</p>
    <label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>{preview.acknowledgement}</label>
    <button disabled={busy||!ack||!status?.runtime_ready} onClick={()=>void perform('activate',{preview_id:preview.id,preview_hash:preview.preview_hash,acknowledgement:preview.acknowledgement,acknowledged:true})}>Activate this source scope</button>
    {!status?.runtime_ready&&<p>Current OpenAI-only runtime configuration is required before activation. Previewing or saving consent does not set up credentials or start paid work.</p>}
    <button disabled={busy} onClick={()=>{changed();}}>Cancel preview</button>
   </article>}
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
