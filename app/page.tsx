"use client";
import {useEffect,useRef,useState} from "react";
import RevisionPanel from "./revision-panel";
import CalendarPanel from "./calendar-panel";
import SourcePanel from "./source-panel";
type State=Record<string,any>;
const money=(value:number)=>"$"+(value/1_000_000).toFixed(4);
export default function Page(){
  const [signedIn,setSignedIn]=useState(false),[authInfo,setAuthInfo]=useState<State|null>(null),[state,setState]=useState<State|null>(null),[input,setInput]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("Disconnected"),[tab,setTab]=useState("Overview");
  const inFlight=useRef(false),session=useRef(0),logoutInFlight=useRef(false);
  const [logoutPending,setLogoutPending]=useState(false);
  async function request(path:string,body?:unknown){
    const response=await fetch("/api/studio/"+path,{method:body?"POST":"GET",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10_000)});
    const data=await response.json();if(!response.ok){if(response.status===401){setSignedIn(false);setState(null);}throw Error(data.error||"Request failed");}return data;
  }
  async function refresh(){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setStatus("Loading actual workspace");
    const currentSession=session.current;
    try{const next=await request("state");if(currentSession!==session.current)return;setState(next);setError("");setStatus("Connected");}
    catch(e){if(currentSession===session.current){setError(e instanceof Error?e.message:"Connection failed");setStatus("Connection failed · previous state may be stale");}}finally{setBusy(false);inFlight.current=false;}
  }
  useEffect(()=>{if(!signedIn)return;const timer=setInterval(()=>{void refresh();},5000);return ()=>clearInterval(timer);},[signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  async function sourceAction(path:string,body:unknown):Promise<boolean>{
    if(inFlight.current)return false;
    inFlight.current=true;setBusy(true);setError("");
    const currentSession=session.current;
    let saved=false;
    try{
      await request(path,body);saved=true;
      if(currentSession!==session.current)return true;
      const next=await request("state");
      if(currentSession===session.current){setState(next);setStatus("Connected");}
      return true;
    }catch(e){
      if(currentSession===session.current){setError((saved?"Action saved, but refresh failed. ":"")+(e instanceof Error?e.message:"Action failed"));if(saved)setStatus("Refresh needed · previous state may be stale");}
      return saved;
    }finally{setBusy(false);inFlight.current=false;}
  }
  async function action(path:string,body:unknown){await sourceAction(path,body);}
  async function approve(task:string,outputs:State[]){
    const ordered=[...outputs].sort((a,b)=>new Date(a.created).getTime()-new Date(b.created).getTime()||String(a.id).localeCompare(String(b.id)));
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ordered.map(o=>o.hash).join("|")));
    const version=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");
    await action("approve",{task,version});
  }
    async function login(){if(logoutPending||inFlight.current)return;let loggedIn=false;const password=input;setInput("");setBusy(true);setError("");try{const result=await fetch("/api/auth/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const data=await result.json();if(!result.ok)throw Error(data.error||"Sign-in failed");setSignedIn(true);loggedIn=true;}catch(e){setError(e instanceof Error?e.message:"Sign-in failed");}finally{setBusy(false);}if(loggedIn)await refresh();}
  async function disconnect(){
    if(logoutInFlight.current)return;logoutInFlight.current=true;session.current+=1;setLogoutPending(true);setSignedIn(false);setInput("");setState(null);setStatus("Verifying sign out");setBusy(true);
    try{const result=await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(10_000)});if(!result.ok)throw Error("Server sign-out failed. Retry sign out before leaving this device.");setLogoutPending(false);setStatus("Signed out");setError("");}
    catch(e){setStatus("Sign-out not confirmed");setError(e instanceof Error?e.message:"Sign-out failed");}
    finally{logoutInFlight.current=false;setBusy(false);}
  }
  useEffect(()=>{const currentSession=session.current;void(async()=>{try{const result=await fetch("/api/auth/status",{credentials:"same-origin",cache:"no-store"});const info=await result.json();if(currentSession!==session.current)return;setAuthInfo(info);if(info.authenticated){setSignedIn(true);void refresh();}}catch{if(currentSession===session.current)setAuthInfo({setup_required:true});}})();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasks:State[]=state?.tasks||[],outputs:State[]=state?.outputs||[];
  const contentTasks=tasks.filter(task=>!task.revision_parent_task_id);
  return <main>
    <aside><div className="brand"><span className="mark">aj</span><div>AI JOURNEY<br/><small>ANIT BOSE · PRIVATE STUDIO</small></div></div><nav aria-label="Studio navigation">{["Overview","Calendar","Sources","Approval inbox","Usage","Events"].map(item=><button key={item} aria-current={tab===item?"page":undefined} className={tab===item?"selected":""} onClick={()=>setTab(item)}>{item}</button>)}</nav><div className="side-note"><span className="dot"/>{state?"Authenticated session":"Private access required"}<p>Build. Learn. Share honestly.</p></div></aside>
    <div className="content"><header><div><span className="eyebrow">YOUR LEARNING JOURNEY</span><h1>{tab}</h1></div><span className="pill">Publishing disabled</span></header>
    <div role="status" aria-live="polite" className="connection">{status}{state&&" · Last refreshed "+new Date(state.updated).toLocaleTimeString()}</div>
    {error&&<div role="alert" className="alert">{error}</div>}
    {!state?<section className="login"><span className="eyebrow">OWNER ACCESS</span><h2>Your private studio.</h2><p>{authInfo?.mode==="hosted"?"Private hosted workspace.":"Private workspace."} Sign in with the owner password you set once. Sources, outputs and usage require authentication.</p><label htmlFor="access">Owner password</label><input id="access" type="password" autoComplete="current-password" maxLength={128} value={input} onChange={e=>setInput(e.target.value)}/><button className="primary" disabled={busy||logoutPending||!input||!authInfo||authInfo.setup_required===true} onClick={()=>void login()}>{busy?"Signing in.":"Sign in"}</button>{logoutPending&&<button disabled={busy} onClick={()=>void disconnect()}>Retry sign out</button>}{(!authInfo||authInfo.setup_required)&&<p role="status">{authInfo?"Password setup is required. An approved database and securely provisioned owner account are needed. Public registration is disabled.":"Checking password setup."}</p>}<small>Use your ten-digit password or longer passphrase. Do not send it in chat. Provider credentials never belong here.</small></section>:<>
    <div className="toolbar"><span className="pill blocked">{state.live_enabled?"Execution enabled":"Live execution blocked"}</span><button onClick={()=>void refresh()} disabled={busy}>Refresh</button><button onClick={disconnect}>Sign out</button></div>
    {(tab==="Overview"||tab==="Usage")&&<>
      <div className="metrics"><section><small>COMMITTED ESTIMATE + RESERVATIONS</small><strong>{money(state.budget.committed_microdollars)}</strong><p>Reported tokens · not invoices</p></section><section><small>COMBINED MONTHLY MAXIMUM</small><strong>$15.00</strong><p>$1 buffer inside the cap</p></section><section><small>REVIEW INBOX</small><strong>{contentTasks.filter(t=>t.status==="review").length}</strong><p>Exact versions await your approval</p></section></div>
      <div className="two-col"><section><span className="eyebrow">EXECUTION READINESS</span><h2>{state.live_enabled?"Ready for authorized work":"Secure setup is pending"}</h2><p>{state.blockers.join(" · ")||"No pending setup gates."}</p><div className="fine">Storage: {state.database==="pglite"?"Embedded PostgreSQL · laptop only":"PostgreSQL"} · IST month {state.budget.month_IST}</div><p>{state.hosted?.notice||"Jobs persist beyond browser closure. A scheduler or local worker must invoke each step."}</p>{state.hosted&&<div className="fine">Daily batches: {state.hosted.daily_batches.length?state.hosted.daily_batches.slice(0,3).map((batch:any)=>`${batch.day}: ${batch.status} (${batch.steps} checkpoints)${batch.reason?" · "+batch.reason:""}`).join("; "):"No hosted invocation recorded"}</div>}</section><section><span className="eyebrow">ANALYST</span><h2>Insufficient data</h2><p>No real platform metrics have been imported. Recommendations and performance figures remain empty.</p><div className="fine">No fabricated reach, impressions or engagement.</div></section></div>
      {state.budget.warning&&<div className="alert">The $10 monthly warning threshold has been reached.</div>}
    </>}
    {tab==="Overview"&&<section><span className="eyebrow">AGENT WORKFLOW</span><h2>From evidence to your final approval.</h2><div className="roles">{["Harvester","Story Miner","Strategist","Writer","Platform Adapter","Critic","Analyst"].map((role,i)=><div key={role}><span>{String(i+1).padStart(2,"0")}</span>{role}</div>)}</div><p>Only cleared real source notes enter the pipeline. Actual outputs and execution events appear after an authorized run.</p></section>}
    {tab==="Calendar"&&<CalendarPanel key={state.calendar.settings.updated} calendar={state.calendar} sources={state.sources} tasks={tasks} busy={busy} action={action}/>}
    {tab==="Sources"&&<SourcePanel sources={state.sources} proposedSource={state.proposed_source} sourceApproved={!!state.source_approved} intakeAuthorized={!!state.owner_cleared_sources_authorized} liveEnabled={!!state.live_enabled} busy={busy} action={sourceAction}/>}
    {(tab==="Approval inbox"||tab==="Overview")&&<section><span className="eyebrow">DURABLE TASKS</span><h2>{tab==="Overview"?"Current work":"Your exact-version approval inbox"}</h2>{contentTasks.length===0?<div className="empty"><span className="empty-icon">↗</span><h3>No tasks or drafts yet</h3><p>Real agent output will appear here after a cleared source and authorized provider run.</p></div>:contentTasks.map(t=>{const review=state.reviews.find((item:State)=>item.task_id===t.id);const artifacts=review?.bundle||outputs.filter(o=>o.task_id===t.id);return <article key={t.id}><h3>Task {t.id.slice(0,8)} <span className="pill">{review?.latest_revision?(review.approval?"revision approved":"revision awaiting approval"):t.status}</span></h3><small>Source {t.source_id} · Updated {new Date(t.updated).toLocaleString()}</small>{artifacts.map((o:State)=><details key={o.id||o.role}><summary>{o.role} · exact version</summary><pre>{o.text}</pre><small>SHA-256 {o.hash}</small></details>)}{review&&["review","approved"].includes(t.status)&&<RevisionPanel key={review.token} task={t.id} review={review} busy={busy} action={sourceAction} agentRevisionEligible={state.owner_cleared_sources_authorized===true}/>}<div className="actions">{t.status==="review"&&!review?.latest_revision&&review?.quality.flags.length===0&&<button className="primary" disabled={busy||!!review?.pending_agent_revision} onClick={()=>void approve(t.id,artifacts)}>Approve these exact versions</button>}{t.status==="blocked"&&t.block_reason!=="safety"&&<button disabled={busy} onClick={()=>void action("retry",{task:t.id})}>Resume if safe</button>}{!["approved","cancelled"].includes(t.status)&&<button disabled={busy} onClick={()=>void action("cancel",{task:t.id})}>Cancel task</button>}</div><p className="fine">Approval requires reviewing every platform variant and the factual/privacy critique. Publishing remains disabled.</p></article>})}</section>}
    {tab==="Usage"&&<section><h2>Actual usage ledger</h2><p>Warning $10 · maximum $15 · unresolved reservations {state.budget.unresolved_reservations}</p>{state.ledger.length===0?<div className="empty"><h3>No calls or costs recorded</h3><p>Usage remains empty until a real provider call is reserved.</p></div>:state.ledger.map((l:State)=><article key={l.id}><h3>{l.provider} · {l.model}</h3><p>{l.status} · completion {l.completion_status??"unknown"} · reservation {money(Number(l.reserved))} · estimate {l.estimated===null?"unknown":money(Number(l.estimated))}</p><small>Input {l.input_tokens??"unknown"} · output {l.output_tokens??"unknown"}</small><details><summary>Pricing version / requested and returned tier</summary><pre>{JSON.stringify({pricing:l.pricing,requested_tier:l.requested_service_tier,returned_tier:l.returned_service_tier,returned_model:l.returned_model,request_id:l.provider_request_id,finish_reason:l.finish_reason},null,2)}</pre></details>{l.partial_output&&<details><summary>Incomplete output · not approval-ready</summary><pre>{l.partial_output}</pre><small>SHA-256 {l.partial_hash}</small></details>}</article>)}</section>}
    {tab==="Events"&&<section><h2>Execution events</h2>{state.events.length===0?<div className="empty"><h3>No execution events</h3><p>Progress appears as recorded events when work actually happens.</p></div>:state.events.map((e:State)=><article key={e.id}><h3>{e.kind}</h3><p>{e.detail}</p><small>{new Date(e.created).toLocaleString()} · Task {e.task_id}</small></article>)}</section>}
    </>}
    <footer>Private learning studio · User reviews every content version · No publishing or outreach</footer></div>
  </main>;
}
