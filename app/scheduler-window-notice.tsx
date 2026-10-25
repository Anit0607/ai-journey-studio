type Policy={mode?:string;valid?:boolean;hash?:string|null;weekly_utc?:string[];exceptions_utc?:string[];notice?:string};
/** Read-only status. A configured policy is not proof of delivery or actual usage savings. */
export default function SchedulerWindowNotice({policy}:{policy?:Policy}){
  if(!policy||policy.mode==="generic")return null;
  const valid=policy.mode==="fixed-cadence-v1"&&policy.valid===true;
  return <section aria-label="Scheduler posting windows">
    <h3>Configured scheduler windows</h3>
    <p role={valid?"status":"alert"}>{policy.notice||"Scheduler window policy is unavailable or invalid; scheduling must not be assumed ready."}</p>
    {valid&&<><p>Weekly posting times (UTC): {(policy.weekly_utc||[]).join(", ")||"none"}.</p><p>Exact dated exceptions (UTC): {(policy.exceptions_utc||[]).join(", ")||"none"}.</p><p>Calendar form hours are IST. Changing a Calendar time does not expand these windows. Unsupported delivery times are blocked; every post still requires exact approval.</p>{policy.hash&&<small>Scheduler policy SHA-256 {policy.hash}</small>}</>}
    <p className="fine">A configured window is not proof of an active scheduler, on-time delivery or measured cost savings. Workspace auto-refresh pauses in hidden, unfocused or idle tabs; use Refresh to check current status.</p>
  </section>;
}
