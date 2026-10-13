// A failed HTTP response does not establish unknown provider usage. Reconcile
// with a read-only state request; never replay a paid step from this observer.
export function interruptionMessage(state:unknown,lastStatus:string){
  const snapshot=state as {tasks?:{status:string}[];ledger?:{status:string}[]}|null;
  const context=lastStatus==="idle"?" after idle polling":"";
  if(!snapshot||!Array.isArray(snapshot.tasks)||!Array.isArray(snapshot.ledger))
    return "Worker connection interrupted"+context+". Current completion could not be verified; inspect saved task/cost state before restarting. Worker stopped.";
  if(snapshot.ledger.some(row=>row.status!=="settled")||snapshot.tasks.some(task=>task.status==="running"))
    return "Worker connection interrupted. Saved state shows unresolved or in-flight work; reservations retained. Do not retry until reconciled. Worker stopped.";
  if(snapshot.tasks.some(task=>task.status==="review"))
    return "Worker connection interrupted. Saved content is ready for review; no unresolved reservations recorded. Worker stopped.";
  return "Worker connection interrupted"+context+". Saved checkpoints remain durable; no unresolved reservations recorded. Review the dashboard before resuming. Worker stopped.";
}
export async function inspectInterruptedWorker(origin:string,token:string,lastStatus:string,transport:typeof fetch=fetch){
  try{
    const result=await transport(origin+"/api/studio/state",{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)});
    if(result.ok)return interruptionMessage(await result.json(),lastStatus);
  }catch{}
  return interruptionMessage(null,lastStatus);
}
