// Local orchestration uses only a temporary owner token; never provider secrets.
export async function preparePilot(origin:string,token:string,transport:typeof fetch=fetch){
  const headers={Authorization:"Bearer "+token,Origin:origin,"Content-Type":"application/json"};
  let state:Record<string,any>|null=null;
  for(let attempt=0;attempt<120;attempt++){
    try{const result=await transport(origin+"/api/studio/state",{headers,signal:AbortSignal.timeout(3000)});if(result.ok){state=await result.json();break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!state?.live_enabled)return false;
  const sourceResponse=await transport(origin+"/api/studio/source",{method:"POST",headers,body:"{}"});
  if(!sourceResponse.ok)throw Error("Approved source could not be saved");
  const source=await sourceResponse.json();
  const queued=await transport(origin+"/api/studio/run",{method:"POST",headers,body:JSON.stringify({source:source.result.id})});
  if(!queued.ok)throw Error("Approved source could not be queued");
  return true;
}
