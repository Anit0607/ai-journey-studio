export const WORKSPACE_POLL_MS=5_000,WORKSPACE_IDLE_MS=60_000;
type ListenerTarget={addEventListener:(event:string,listener:()=>void)=>void;removeEventListener:(event:string,listener:()=>void)=>void};
type PollEnvironment={page:ListenerTarget;view:ListenerTarget;isActive:()=>boolean;now:()=>number;setTimer:(work:()=>void,ms:number)=>unknown;clearTimer:(timer:unknown)=>void};
/** Read-only UI refresh. Hidden/unfocused/idle tabs must not keep the database awake. */
export function startActiveWorkspacePolling(refresh:()=>void,environment?:PollEnvironment){
  const env=environment||{page:document,view:window,isActive:()=>document.visibilityState==="visible"&&document.hasFocus(),now:()=>Date.now(),setTimer:(work:()=>void,ms:number)=>setInterval(work,ms),clearTimer:(timer:unknown)=>clearInterval(timer as ReturnType<typeof setInterval>)};
  let lastActivity=env.now(),lastPoll=lastActivity,closed=false;
  const poll=()=>{const now=env.now();if(closed||!env.isActive()||now-lastActivity>=WORKSPACE_IDLE_MS||now-lastPoll<WORKSPACE_POLL_MS)return;lastPoll=now;refresh();};
  const activity=()=>{if(closed||!env.isActive())return;const idle=env.now()-lastActivity>=WORKSPACE_IDLE_MS;lastActivity=env.now();if(idle)poll();};
  const resumed=()=>{if(closed||!env.isActive())return;lastActivity=env.now();poll();};
  const timer=env.setTimer(poll,WORKSPACE_POLL_MS);
  env.page.addEventListener("pointerdown",activity);env.page.addEventListener("keydown",activity);env.page.addEventListener("visibilitychange",resumed);env.view.addEventListener("focus",resumed);
  return ()=>{if(closed)return;closed=true;env.clearTimer(timer);env.page.removeEventListener("pointerdown",activity);env.page.removeEventListener("keydown",activity);env.page.removeEventListener("visibilitychange",resumed);env.view.removeEventListener("focus",resumed);};
}
