import {enqueueLegacy} from "./legacy-task-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {embedded,type Database} from "../lib/db";
import {provisionOwner,handleOwnerAuth} from "../lib/owner-password";
import {GET,POST} from "../app/api/studio/[action]/route";
import {Publishing,type PublishingAccount,type PublishInput} from "../lib/publishing";
import {publishingRuntime} from "../lib/integrations";
import type {IntegrationSettings} from "../lib/integration-config";
import {Store} from "../lib/store";
import {CAPSULE,ROLES,hash} from "../lib/domain";
import {variantFixture} from "./variant-fixture";

const TEXT="Proposed approach: inspect one cleared source.";
const ACCOUNT:PublishingAccount={id:"route-manual-owner",platform:"LinkedIn",remote_id:"urn:li:person:12345",label:"Isolated route account",enabled:true,verified:true,authorization_version:"route-consent-v1",scopes:["w_member_social"],linkedin_version:"202609",credential_env:"STUDIO_PUBLISH_MANUAL_TEST"};
async function approvedManual(db:Database,publisher:Publishing){
  const store=new Store(db),source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await enqueueLegacy(store,source.id);
  for(const role of ROLES){
    const text=role==="Critic"?"Unsupported claims: none\nEvidence needed: a concrete cleared project note\nProposed advice: inspect a draft":role==="Platform Adapter"?variantFixture(TEXT):TEXT;
    await db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);
  }
  await db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);
  const outputs=await db.query<{hash:string}>("SELECT hash FROM outputs WHERE task_id=$1 ORDER BY created,id",[task.id]),version=hash(outputs.map(item=>item.hash).join("|"));await store.approve(task.id,version);
  const input:PublishInput={request_id:randomUUID(),task_id:task.id,review_token:"original:"+version,platform:"LinkedIn",account_id:ACCOUNT.id,scheduled_at:new Date(Date.now()-1000).toISOString(),delivery_mode:"manual",payload:{text:TEXT}};
  const row=await publisher.enqueue(input);await publisher.approve(row.id,row.version,true);return {row,input};
}

test("manual publication route requires owner cookie and Origin, allowlists its body, and uses only server runtime",async()=>{
  const db=await embedded(),origin="http://127.0.0.1:3191",password="6728194035",globals=globalThis as typeof globalThis&{studioDb?:Promise<Database>};
  const previousDb=globals.studioDb,originalFetch=globalThis.fetch;
  const config:IntegrationSettings={publishing:{credential_use_authorized:true,max_lateness_seconds:300,accounts:[ACCOUNT]}};
  const env:Record<string,string>={STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:"isolated-manual-route-"+"x".repeat(40),STUDIO_ACCESS_TOKEN:"isolated-manual-worker-"+"y".repeat(40),STUDIO_RUNTIME_CONFIG:"{}",STUDIO_INTEGRATIONS_CONFIG:JSON.stringify(config),STUDIO_PUBLISH_MANUAL_TEST:"isolated-manual-route-token",OPENAI_API_KEY:"",GEMINI_API_KEY:"",STUDIO_SESSION_ONLY:"0",STUDIO_DATABASE_AUTHORIZED:"0",DATABASE_URL:""};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);globals.studioDb=Promise.resolve(db);
  const requests:{url:string;init?:RequestInit}[]=[];
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});assert.equal(String(url),"https://api.linkedin.com/rest/posts");return new Response(null,{status:201,headers:{"x-restli-id":"urn:li:share:123456"}});};
  const updateConfig=()=>{process.env.STUDIO_INTEGRATIONS_CONFIG=JSON.stringify(config);};
  try{
    await provisionOwner(db,password,true);
    const login=await handleOwnerAuth(new Request(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,Host:"127.0.0.1:3191","Content-Type":"application/json"},body:JSON.stringify({password})}),"login",env,async()=>db);assert.equal(login.status,200);
    const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    const publisher=new Publishing(db,publishingRuntime(config,process.env,globalThis.fetch,db)),{row,input}=await approvedManual(db,publisher);
    const body={id:row.id,expected_version:row.version,expected_account_id:ACCOUNT.id,acknowledged:true};
    const call=(payload:unknown=body,session=cookie,from=origin,extraHeaders:Record<string,string>={})=>POST(new Request(origin+"/api/studio/publication-publish",{method:"POST",headers:{Cookie:session,Origin:from,"Content-Type":"application/json",...extraHeaders},body:JSON.stringify(payload)}),{params:Promise.resolve({action:"publication-publish"})});

    assert.equal((await call(body,"")).status,401);
    assert.equal((await call(body,"",origin,{Authorization:"Bearer "+env.STUDIO_ACCESS_TOKEN})).status,401,"Worker bearer token must not replace the owner's cookie");
    assert.equal((await call(body,cookie,"https://different.example.test")).status,403);
    assert.equal((await call(body,cookie,"")).status,403);
    assert.equal((await GET(new Request(origin+"/api/studio/publication-publish",{headers:{Cookie:cookie}}),{params:Promise.resolve({action:"publication-publish"})})).status,404);
    assert.equal(requests.length,0);

    const disabled=await call();assert.equal(disabled.status,409);assert.equal((await disabled.json()).result.status,"disabled");
    assert.equal((await publisher.snapshot()).jobs[0].status,"approved");assert.equal(requests.length,0);
    config.publishing!.enabled=true;config.publishing!.credential_use_authorized=false;updateConfig();
    const credentialBlocked=await call();assert.equal(credentialBlocked.status,409);assert.equal((await credentialBlocked.json()).result.status,"blocked");assert.equal(requests.length,0);

    for(const extra of [
      {runtime:{enabled:true,credential_use_authorized:true}},
      {enabled:true},
      {credential_use_authorized:true},
      {credential:"attacker-provided-token"},
      {credentials:{token:"attacker-provided-token"}},
      {fetch:"https://different.example.test"},
      {accounts:[ACCOUNT]},
      {delivery_mode:"manual"},
      {payload:{text:"Unapproved replacement"}},
      {scheduled_at:new Date().toISOString()},
      {unexpected:true}
    ])assert.equal((await call({...body,...extra})).status,400,"Unknown fields must be rejected: "+Object.keys(extra).join(", "));
    for(const payload of [null,[],"not-an-object",{},...Object.keys(body).map(key=>Object.fromEntries(Object.entries(body).filter(([name])=>name!==key))),{...body,acknowledged:false},{...body,acknowledged:"true"},{...body,acknowledged:1},{...body,expected_account_id:123}])assert.equal((await call(payload)).status,400);
    assert.equal((await call({...body,padding:"x".repeat(4097)},cookie,origin,{"Content-Length":"5000"})).status,413);
    assert.equal(requests.length,0);assert.equal((await publisher.snapshot()).approvals.length,1);

    config.publishing!.credential_use_authorized=true;updateConfig();
    for(const payload of [{...body,id:randomUUID()},{...body,expected_version:"0".repeat(64)},{...body,expected_account_id:"wrong-owner"}])assert.equal((await call(payload)).status,400);
    const staged=await publisher.enqueue({...input,request_id:randomUUID(),scheduled_at:new Date(Date.now()-500).toISOString()});
    assert.equal((await call({...body,id:staged.id,expected_version:staged.version})).status,409,"Clicking must not stage an implicit publication approval");
    assert.equal((await publisher.snapshot()).approvals.length,1);assert.equal(requests.length,0);

    const published=await call();assert.equal(published.status,200);const result=(await published.json()).result;
    assert.equal(result.status,"published");assert.equal(result.id,row.id);assert.deepEqual(result.receipt,{platform:"LinkedIn",provider_id:"urn:li:share:123456",http_status:201,url:"https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123456/"});
    assert.equal(requests.length,1);assert.equal(requests[0].init?.redirect,"error");assert.equal((requests[0].init?.headers as Record<string,string>).Authorization,"Bearer isolated-manual-route-token");assert.equal(JSON.parse(String(requests[0].init?.body)).commentary,TEXT);
    const duplicate=await call();const duplicateBody=await duplicate.json();assert.notEqual(duplicateBody.result?.status,"published");assert.equal(requests.length,1);
    const state=await publisher.snapshot();assert.equal(state.jobs.find(job=>job.id===staged.id)?.status,"staged");assert.equal(state.attempts.length,1);assert(!JSON.stringify(state).includes(env.STUDIO_PUBLISH_MANUAL_TEST));

    const logout=await handleOwnerAuth(new Request(origin+"/api/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:"{}"}),"logout",env,async()=>db);assert.equal(logout.status,200);assert.equal((await call()).status,401);assert.equal(requests.length,1);
  }finally{
    globalThis.fetch=originalFetch;if(previousDb===undefined)delete globals.studioDb;else globals.studioDb=previousDb;
    for(const key of Object.keys(env)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    await db.close();
  }
});
