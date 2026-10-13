// No detached web-request work. This local process invokes persisted single steps.
import {inspectInterruptedWorker} from "../lib/worker-observer";
// User supplies the temporary owner token to their own process after launch.
const origin=process.env.STUDIO_ORIGIN||"http://127.0.0.1:3000";
const token=process.env.STUDIO_ACCESS_TOKEN;
if(!token)throw Error("Local worker requires this session's owner access token; never supply a provider key here");
let previousStatus="";
while(true){
  try{
    const result=await fetch(origin+"/api/studio/step",{method:"POST",headers:{Authorization:"Bearer "+token,Origin:origin,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(180_000)});
    if(!result.ok){console.error("Job-step authorization or database unavailable");break;}
    const value=await result.json();
    const status=String(value.result?.status);
    if(!["idle","step_saved","blocked"].includes(status))throw Error("Unrecognized step response");
    if(status!=="idle"||status!==previousStatus)console.log("Durable step: "+status+(value.result?.role?" / "+value.result.role:""));
    if(status==="idle"&&previousStatus!=="idle")console.log("No queued work. Waiting; idle polling makes no provider calls.");
    previousStatus=status;
    if(value.result?.status==="blocked"){console.log("Setup or reconciliation required; worker stopped");break;}
  }catch{console.error(await inspectInterruptedWorker(origin,token,previousStatus));break;}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
