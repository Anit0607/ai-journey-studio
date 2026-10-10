// No detached web-request work. This local process invokes persisted single steps.
export {};
// User supplies the temporary owner token to their own process after launch.
const origin=process.env.STUDIO_ORIGIN||"http://127.0.0.1:3000";
const token=process.env.STUDIO_ACCESS_TOKEN;
if(!token)throw Error("Local worker requires this session's owner access token; never supply a provider key here");
while(true){
  try{
    const result=await fetch(origin+"/api/studio/step",{method:"POST",headers:{Authorization:"Bearer "+token,Origin:origin,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(180_000)});
    if(!result.ok){console.error("Job-step authorization or database unavailable");break;}
    const value=await result.json();
    console.log("Durable step: "+String(value.result?.status));
    if(value.result?.status==="blocked"){console.log("Setup or reconciliation required; worker stopped");break;}
  }catch{console.error("Unknown step completion; inspect durable ledger before restarting");break;}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
