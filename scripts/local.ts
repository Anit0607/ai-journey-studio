import {randomBytes} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import path from "node:path";
import {preparePilot} from "../lib/pilot";
if(process.env.VERCEL)throw Error("Local launcher is not a hosted authentication setup");
const mode=process.argv[2]==="start"?"start":"dev";
const sessionOnly=process.argv.includes("--session-only");
const pilot=sessionOnly&&process.argv.includes("--pilot");
const token=randomBytes(32).toString("base64url");
const port=process.env.PORT||"3000",origin="http://127.0.0.1:"+port;
console.log("Laptop-only web view: "+origin);
console.log("Temporary local owner access token: "+token);
const child=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),mode,"--hostname","127.0.0.1","--port",port],{stdio:"inherit",env:{...process.env,NEXT_TELEMETRY_DISABLED:"1",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin,STUDIO_SESSION_ONLY:sessionOnly?"1":"0",STUDIO_LOCAL_DB:process.env.STUDIO_DATABASE_AUTHORIZED==="1"?"0":"1"}});
let worker:ChildProcess|undefined;
child.on("exit",code=>{worker?.kill();process.exit(code??1);});
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>{worker?.kill(signal);child.kill(signal);});
if(pilot){
  void (async()=>{
    if(!await preparePilot(origin,token)){console.log("Pilot remains blocked by setup gates; no source queued and no provider call made.");return;}
    // Worker receives only OS necessities and the temporary owner token, never provider keys.
    const environment:NodeJS.ProcessEnv={NODE_ENV:mode==="start"?"production":"development",STUDIO_ACCESS_TOKEN:token,STUDIO_ORIGIN:origin};
    for(const name of ["PATH","PATHEXT","SYSTEMROOT","WINDIR","COMSPEC","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[name])environment[name]=process.env[name];
    worker=spawn(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/worker.ts"],{stdio:"inherit",env:environment});
    console.log("Exact approved note queued. Durable worker started; final content approval stays with you.");
  })().catch(()=>console.error("Pilot setup blocked; inspect the dashboard. No automatic restart or extra call was requested."));
}
