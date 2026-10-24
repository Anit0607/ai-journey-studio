import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,verify} from "node:crypto";
import {createGitHubAppCredentialResolver,githubAppRepositoryReadAuthorized,githubAppStatus,GITHUB_APP_PRIVATE_KEY_ENV,type GitHubAppConfig} from "../lib/github-app-auth";

// Ephemeral, local fixture key only. No test reads process credentials or contacts GitHub.
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const pem=privateKey.export({type:"pkcs8",format:"pem"}).toString();
const env={[GITHUB_APP_PRIVATE_KEY_ENV]:pem};
const start=Date.parse("2026-10-15T03:00:00Z"),now=()=>new Date(start);
const repositories=["builder/one","builder/two"];
const config=():GitHubAppConfig=>({authorized:true,app_id:7,installation_id:9,selected_repository_ids:[102,101]});
const installation=()=>({id:9,app_id:7,account:{login:"builder",id:11,type:"User"},suspended_at:null,repository_selection:"selected"});
const token=(time=start)=>({token:"ghs_fixture_"+"a".repeat(200),expires_at:new Date(time+3_600_000).toISOString(),permissions:{contents:"read",metadata:"read"},repository_selection:"selected",repositories:[{id:101,full_name:"builder/one",owner:{login:"builder",id:11}},{id:102,full_name:"builder/two",owner:{login:"builder",id:11}}]});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const normalFetch:typeof fetch=async(_input,init)=>init?.method==="POST"?json(token(),201):json(installation());
const resolver=(fetcher:typeof fetch=normalFetch)=>createGitHubAppCredentialResolver(config(),repositories,{fetch:fetcher,env,now});

test("readiness is nonsecret configuration readiness, never proof of a live connection",()=>{
  assert.deepEqual(githubAppStatus(undefined,[],{}),{configured:false,authorized:false,ready:false,tested:false,reason:"github_app_not_configured"});
  assert.equal(githubAppStatus(config(),repositories,{}).reason,"github_app_private_key_missing");
  const status=githubAppStatus(config(),repositories,env);
  assert.equal(status.ready,true);assert.equal(status.tested,false);assert.equal(JSON.stringify(status).includes(pem),false);
  // This is intentionally not a key parse or API test.
  assert.equal(githubAppStatus(config(),repositories,{[GITHUB_APP_PRIVATE_KEY_ENV]:"present-but-not-tested"}).tested,false);
});

test("missing approval and malformed exact selections do not read credentials or perform network I/O",async()=>{
  let reads=0,calls=0;
  const unreadableEnv=new Proxy({}, {get(){reads++;throw new Error("must not access credentials");}});
  const fetcher:typeof fetch=async()=>{calls++;throw new Error("must not call network");};
  for(const candidate of [undefined,{...config(),authorized:false},{...config(),authorized:undefined}]){
    await assert.rejects(createGitHubAppCredentialResolver(candidate,repositories,{env:unreadableEnv,fetch:fetcher})(repositories[0]),/github_app_(not_configured|authorization_required)/);
    assert.equal(githubAppStatus(candidate,repositories,unreadableEnv).ready,false);
  }
  for(const candidate of [{...config(),app_id:0},{...config(),app_id:1.5},{...config(),installation_id:-1},{...config(),installation_id:Number.MAX_SAFE_INTEGER+1},{...config(),selected_repository_ids:[]},{...config(),selected_repository_ids:[101,101]},{...config(),selected_repository_ids:[101,1.5]},{...config(),selected_repository_ids:[101]}]){
    await assert.rejects(createGitHubAppCredentialResolver(candidate,repositories,{env:unreadableEnv,fetch:fetcher})(repositories[0]),/github_app_invalid_/);
  }
  for(const names of [[],["builder/one","other/two"],["builder/one","Builder/ONE"],["builder/one","https://evil.test/two"],["builder/one","builder/.."],["builder/one","builder/bank"]]){
    await assert.rejects(createGitHubAppCredentialResolver(config(),names,{env:unreadableEnv,fetch:fetcher})(repositories[0]),/github_app_invalid_repository_selection/);
  }
  await assert.rejects(createGitHubAppCredentialResolver(config(),repositories,{env:unreadableEnv,fetch:fetcher})("builder/three"),/github_app_repository_not_allowed/);
  assert.equal(reads,0);assert.equal(calls,0);
});

test("JWT uses verified RS256 claims and requests only exact repository IDs plus read-only permissions",async()=>{
  const calls:string[]=[];
  const credential=resolver(async(input,init)=>{
    const url=String(input);calls.push(url);
    assert.equal(init?.redirect,"error");assert.equal(init?.cache,"no-store");assert.ok(init?.signal);
    const headers=new Headers(init?.headers);
    assert.equal(headers.get("x-github-api-version"),"2026-03-10");assert.equal(headers.get("accept"),"application/vnd.github+json");
    const jwt=headers.get("authorization")!.replace(/^Bearer /,"");
    const [header,payload,signature]=jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header,"base64url").toString()),{alg:"RS256",typ:"JWT"});
    const claims=JSON.parse(Buffer.from(payload,"base64url").toString());
    assert.equal(claims.iss,"7");assert.equal(claims.iat,start/1000-60);assert.equal(claims.exp-claims.iat,600);assert.ok(claims.exp<=start/1000+600);
    assert.equal(verify("RSA-SHA256",Buffer.from(header+"."+payload),publicKey,Buffer.from(signature,"base64url")),true);
    if(init?.method==="POST"){
      assert.equal(url,"https://api.github.com/app/installations/9/access_tokens");
      assert.deepEqual(JSON.parse(String(init.body)),{repository_ids:[101,102],permissions:{contents:"read",metadata:"read"}});
      return json(token(),201);
    }
    assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);assert.equal(url,"https://api.github.com/app/installations/9");return json(installation());
  });
  assert.equal(await credential("Builder/ONE"),token().token);assert.equal(calls.length,2);
});

test("missing, malformed, weak, and non-RSA keys fail without transmitting credential material",async()=>{
  const weak=generateKeyPairSync("rsa",{modulusLength:1024}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
  const ec=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw new Error();};
  for(const value of [undefined,"unsafe-placeholder",weak,ec,"x".repeat(32_769)])await assert.rejects(createGitHubAppCredentialResolver(config(),repositories,{fetch:fetcher,env:{[GITHUB_APP_PRIVATE_KEY_ENV]:value},now})(repositories[0]),/github_app_private_key_(missing|invalid)/);
  assert.equal(calls,0);
});

test("installation identity, app identity, account owner, and suspension are checked before token creation",async()=>{
  for(const value of [{...installation(),id:10},{...installation(),app_id:8},{...installation(),account:{login:"other",id:11,type:"User"}},{...installation(),account:{login:"builder",id:0,type:"User"}},{...installation(),account:{login:"builder",id:11,type:"Enterprise"}},{...installation(),suspended_at:"2026-10-15T02:00:00Z"},{...installation(),repository_selection:"unknown"}]){
    let calls=0;await assert.rejects(resolver(async(_input,init)=>{calls++;assert.equal(init?.method,"GET");return json(value);})(repositories[0]),/github_app_(installation_mismatch|installation_suspended|invalid_response)/);assert.equal(calls,1);
  }
});

test("an all-repository installation can mint only the explicit selected token scope",async()=>{
  const credential=resolver(async(_input,init)=>init?.method==="POST"?json(token(),201):json({...installation(),repository_selection:"all"}));
  assert.equal(await credential(repositories[0]),token().token);
});

test("unexpected, elevated, and missing permissions are rejected and never cached",async()=>{
  for(const permissions of [{contents:"write",metadata:"read"},{contents:"read"},{metadata:"read"},{contents:"read",metadata:"read",issues:"read"},{contents:"read",metadata:"read",administration:"write"},null,[]]){
    let posts=0;const credential=resolver(async(_input,init)=>{if(init?.method==="POST"){posts++;return json({...token(),permissions},201);}return json(installation());});
    await assert.rejects(credential(repositories[0]),/github_app_(permissions_mismatch|invalid_response)/);await assert.rejects(credential(repositories[0]));assert.equal(posts,2);
  }
});

test("token responses must prove exact repository IDs, names, owner IDs, and selected scope",async()=>{
  const normal=token(),first=normal.repositories[0],second=normal.repositories[1];
  const values=[{...normal,repository_selection:"all"},{...normal,repositories:undefined},{...normal,repositories:[first]},{...normal,repositories:[first,second,{id:103,full_name:"builder/three",owner:{login:"builder",id:11}}]},{...normal,repositories:[first,first]},{...normal,repositories:[first,{...second,id:103}]},{...normal,repositories:[first,{...second,full_name:"builder/three"}]},{...normal,repositories:[first,{...second,owner:{login:"other",id:11}}]},{...normal,repositories:[first,{...second,owner:{login:"builder",id:12}}]}];
  for(const value of values)await assert.rejects(resolver(async(_input,init)=>init?.method==="POST"?json(value,201):json(installation()))(repositories[0]),/github_app_repository_selection_mismatch/);
});

test("GitHub stateless tokens are opaque and variable-length while unsafe token values are refused",async()=>{
  const longToken="ghs_123_"+"eyJhbGciOiJSUzI1NiJ9.a-b_c.signature".repeat(100);
  assert.equal(await resolver(async(_input,init)=>init?.method==="POST"?json({...token(),token:longToken},201):json(installation()))(repositories[0]),longToken);
  for(const value of [undefined,"","contains a space","newline\nsecret","control\u0000token","x".repeat(16_385),123])await assert.rejects(resolver(async(_input,init)=>init?.method==="POST"?json({...token(),token:value},201):json(installation()))(repositories[0]),/github_app_invalid_response/);
});

test("expired, nearly expired, malformed, and over-one-hour token expiries fail closed",async()=>{
  for(const expires_at of [undefined,"invalid","2026-99-99T03:00:00Z",new Date(start-1).toISOString(),new Date(start+60_000).toISOString(),new Date(start+3_600_001).toISOString()])await assert.rejects(resolver(async(_input,init)=>init?.method==="POST"?json({...token(),expires_at},201):json(installation()))(repositories[0]),/github_app_invalid_expiry/);
});

test("cache is shared across selected repositories and refreshes before expiration without persisting anything",async()=>{
  let time=start,posts=0;
  const credential=createGitHubAppCredentialResolver(config(),repositories,{env,now:()=>new Date(time),fetch:async(_input,init)=>{if(init?.method==="POST"){posts++;return json({...token(time),token:"ghs_fixture_generation_"+posts},201);}return json(installation());}});
  assert.equal(await credential(repositories[0]),"ghs_fixture_generation_1");assert.equal(await credential(repositories[1]),"ghs_fixture_generation_1");assert.equal(posts,1);
  time=start+3_539_999;assert.equal(await credential(repositories[0]),"ghs_fixture_generation_1");assert.equal(posts,1);
  time=start+3_540_000;assert.equal(await credential(repositories[1]),"ghs_fixture_generation_2");assert.equal(posts,2);
  assert.equal(JSON.stringify(credential),undefined);assert.deepEqual(Object.keys(credential),[]);
});

test("concurrent callers deduplicate verification and token generation",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let gets=0,posts=0;
  const credential=resolver(async(_input,init)=>{if(init?.method==="GET"){gets++;await gate;return json(installation());}posts++;return json(token(),201);});
  const pending=Array.from({length:20},(_,index)=>credential(repositories[index%2]));
  assert.equal(gets,1);assert.equal(posts,0);release();
  assert.deepEqual(await Promise.all(pending),Array(20).fill(token().token));assert.equal(gets,1);assert.equal(posts,1);
});

test("a failed single-flight is cleared and an explicit subsequent call may recover",async()=>{
  let gets=0;
  const credential=resolver(async(_input,init)=>{if(init?.method==="GET"){gets++;if(gets===1)throw Error("Bearer fixture-secret");return json(installation());}return json(token(),201);});
  const results=await Promise.allSettled([credential(repositories[0]),credential(repositories[1])]);
  assert.ok(results.every(result=>result.status==="rejected"&&result.reason.message==="github_app_network_error"));assert.equal(gets,1);
  assert.equal(await credential(repositories[0]),token().token);assert.equal(gets,2);
});

test("HTTP errors and malformed responses never reflect upstream messages or secrets",async()=>{
  for(const [status,code] of [[401,"github_app_access_denied"],[403,"github_app_access_denied"],[404,"github_app_access_denied"],[429,"github_app_rate_limited"],[500,"github_app_http_error"],[302,"github_app_http_error"]] as const){
    await assert.rejects(resolver(async()=>json({message:pem,token:token().token},status))(repositories[0]),error=>error instanceof Error&&error.message===code&&!JSON.stringify(error).includes("PRIVATE KEY"));
  }
  for(const response of [new Response("{bad"),json(null),json([]),new Response(new Uint8Array([0xff,0xfe]))])await assert.rejects(resolver(async()=>response)(repositories[0]),/github_app_invalid_response/);
  await assert.rejects(resolver(async()=>{throw new Error(pem);})(repositories[0]),error=>error instanceof Error&&error.message==="github_app_network_error");
});

test("response sizes are bounded using both content-length and streamed bytes",async()=>{
  for(const response of [new Response("{}",{headers:{"content-length":"262145"}}),new Response("x".repeat(262145))])await assert.rejects(resolver(async()=>response)(repositories[0]),/github_app_response_too_large/);
});

test("already cancelled work never accesses credentials or network",async()=>{
  const controller=new AbortController();controller.abort();let reads=0,calls=0;
  const credential=createGitHubAppCredentialResolver(config(),repositories,{env:new Proxy({}, {get(){reads++;throw Error();}}),fetch:async()=>{calls++;throw Error();}});
  await assert.rejects(credential(repositories[0],controller.signal),/github_app_cancelled/);assert.equal(reads,0);assert.equal(calls,0);
});

test("cancelling one waiter does not cancel an independent caller sharing the token request",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let gets=0,posts=0;
  const credential=resolver(async(_input,init)=>{if(init?.method==="GET"){gets++;await gate;assert.equal(init.signal?.aborted,false);return json(installation());}posts++;return json(token(),201);});
  const controller=new AbortController(),first=credential(repositories[0],controller.signal),second=credential(repositories[1]);
  controller.abort();await assert.rejects(first,/github_app_cancelled/);release();assert.equal(await second,token().token);assert.equal(gets,1);assert.equal(posts,1);
});

test("when every waiter cancels the shared operation aborts and never advances to token creation",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let posts=0;let signal:AbortSignal|null|undefined;
  const credential=resolver(async(_input,init)=>{signal=init?.signal;if(init?.method==="POST"){posts++;return json(token(),201);}await gate;return json(installation());});
  const controller=new AbortController(),pending=credential(repositories[0],controller.signal);controller.abort();await assert.rejects(pending,/github_app_cancelled/);assert.equal(signal?.aborted,true);release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(posts,0);
});

test("revoked configuration and key removal immediately prevent cached-token reuse",async()=>{
  const mutable=config(),mutableEnv={...env};let posts=0;
  const credential=createGitHubAppCredentialResolver(mutable,repositories,{env:mutableEnv,now,fetch:async(_input,init)=>{if(init?.method==="POST"){posts++;return json(token(),201);}return json(installation());}});
  await credential(repositories[0]);mutable.authorized=false;await assert.rejects(credential(repositories[0]),/github_app_authorization_required/);
  mutable.authorized=true;delete (mutableEnv as Record<string,string|undefined>)[GITHUB_APP_PRIVATE_KEY_ENV];await assert.rejects(credential(repositories[0]),/github_app_private_key_missing/);
  mutableEnv[GITHUB_APP_PRIVATE_KEY_ENV]=pem;await credential(repositories[0]);assert.equal(posts,2);
});

test("key rotation and clock rollback invalidate the cached token",async()=>{
  const mutableEnv={...env};let time=start,posts=0;
  const credential=createGitHubAppCredentialResolver(config(),repositories,{env:mutableEnv,now:()=>new Date(time),fetch:async(_input,init)=>{if(init?.method==="POST"){posts++;return json(token(time),201);}return json(installation());}});
  await credential(repositories[0]);mutableEnv[GITHUB_APP_PRIVATE_KEY_ENV]=privateKey.export({type:"pkcs1",format:"pem"}).toString();await credential(repositories[0]);assert.equal(posts,2);
  time=start-1000;await credential(repositories[0]);assert.equal(posts,3);
});

test("mid-flight revocation or scope changes cannot return the newly minted credential",async()=>{
  for(const changed of ["revoked","selection"]){
    const mutable=config();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
    const credential=createGitHubAppCredentialResolver(mutable,repositories,{env,now,fetch:async(_input,init)=>{if(init?.method==="POST"){await gate;return json(token(),201);}return json(installation());}});
    const pending=credential(repositories[0]);await new Promise(resolve=>setTimeout(resolve,0));
    if(changed==="revoked")mutable.authorized=false;else mutable.selected_repository_ids=[101,103];release();
    await assert.rejects(pending,/github_app_(authorization_required|configuration_changed)/);
  }
});

test("authorization revoked while installation verification is pending prevents token creation",async()=>{
  const mutable=config();let release!:()=>void,posts=0;const gate=new Promise<void>(resolve=>release=resolve);
  const credential=createGitHubAppCredentialResolver(mutable,repositories,{env,now,fetch:async(_input,init)=>{if(init?.method==="POST"){posts++;return json(token(),201);}await gate;return json(installation());}});
  const pending=credential(repositories[0]);mutable.authorized=false;release();await assert.rejects(pending,/github_app_authorization_required/);assert.equal(posts,0);
});

test("malformed calendar dates cannot normalize into an apparently valid expiry",async()=>{
  const date=Date.parse("2026-03-02T03:00:00Z");
  const credential=createGitHubAppCredentialResolver(config(),repositories,{env,now:()=>new Date(date),fetch:async(_input,init)=>init?.method==="POST"?json({...token(date),expires_at:"2026-02-30T04:00:00Z"},201):json(installation())});
  await assert.rejects(credential(repositories[0]),/github_app_invalid_expiry/);
});

test("repository read proof requires the actual factory, current token, exact name/ID pair and live cache",async()=>{
  const fake=Object.assign(async()=>token().token,{authorized:true,repositoryIds:new Map([[repositories[0],101]]),permissions:{contents:"read",metadata:"read"}});
  assert.equal(githubAppRepositoryReadAuthorized(fake,token().token,repositories[0],101),null);
  const mutable=config(),mutableEnv={...env};let time=start,generation=0;
  const credential=createGitHubAppCredentialResolver(mutable,repositories,{env:mutableEnv,now:()=>new Date(time),fetch:async(_input,init)=>init?.method==="POST"?json({...token(time),token:'fixture-'+(++generation)},201):json(installation())});
  assert.equal(githubAppRepositoryReadAuthorized(credential,'fixture-1',repositories[0],101),false);
  const first=await credential(repositories[0]);
  assert.equal(githubAppRepositoryReadAuthorized(credential,first,'BuIlDeR/OnE',101),true);
  for(const [presented,name,id] of [[first,repositories[0],102],[first,repositories[1],101],[first,'builder/other',101],[first,repositories[0],'101'],['wrong',repositories[0],101]] as const)assert.equal(githubAppRepositoryReadAuthorized(credential,presented,name,id),false);
  time=start+3_540_000;assert.equal(githubAppRepositoryReadAuthorized(credential,first,repositories[0],101),false);
  const second=await credential(repositories[0]);assert.notEqual(first,second);
  assert.equal(githubAppRepositoryReadAuthorized(credential,first,repositories[0],101),false);
  assert.equal(githubAppRepositoryReadAuthorized(credential,second,repositories[0],101),true);
  time--;assert.equal(githubAppRepositoryReadAuthorized(credential,second,repositories[0],101),false);time++;
  mutable.authorized=false;assert.equal(githubAppRepositoryReadAuthorized(credential,second,repositories[0],101),false);mutable.authorized=true;
  mutable.selected_repository_ids=[101,103];assert.equal(githubAppRepositoryReadAuthorized(credential,second,repositories[0],101),false);mutable.selected_repository_ids=[102,101];
  mutableEnv[GITHUB_APP_PRIVATE_KEY_ENV]=privateKey.export({type:'pkcs1',format:'pem'}).toString();assert.equal(githubAppRepositoryReadAuthorized(credential,second,repositories[0],101),false);
});
