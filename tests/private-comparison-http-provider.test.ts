import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {allowedOrigin,response} from '../lib/auth';
import {comparisonProvider} from '../lib/private-comparison-provider';
import {COMPARISON_PRICING,COMPARISON_SCOPE_HASH,validComparisonRequest} from '../lib/private-comparison-policy';

const origin='https://comparison.example.test';
function harness(){
 const flags={authenticated:true,release:COMPARISON_SCOPE_HASH,status:'completed_requires_review',live:true},calls={auth:0,db:0,run:0,read:0};
 const env={get STUDIO_PRIVATE_COMPARISON_SCOPE(){return flags.release;}};
 const modules:Record<string,unknown>={
  '../../../lib/auth':{allowedOrigin:(r:Request)=>allowedOrigin(r,origin),response},
  '../../../lib/owner-password':{passwordOwnerAuthenticated:async()=>{calls.auth++;return flags.authenticated;}},
  '../../../lib/db':{database:async()=>{calls.db++;return {kind:'postgres'};}},
  '../../../lib/config':{runtimeConfig:()=>({})},
  '../../../lib/providers':{liveReady:()=>flags.live},
  '../../../lib/hosted':{hostedEnvironment:()=>true,hostedOwnerDraftReady:()=>flags.live},
  '../../../lib/private-comparison-policy':{COMPARISON_SCOPE_HASH,validComparisonRequest},
  '../../../lib/private-comparison':{comparisonSnapshot:async()=>{calls.read++;return {history:[]};},runPrivateComparison:async(_db:unknown,_input:unknown,options:any)=>{calls.run++;assert.equal(options.ready(),true);return {status:flags.status,steps:6};}}
 };
 const exports:Record<string,any>={};
 const code=ts.transpileModule(readFileSync(new URL('../app/api/private-comparison/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:(id:string)=>modules[id],Buffer,process:{env}});
 const input={expected_state_hash:'a'.repeat(64),scope_hash:COMPARISON_SCOPE_HASH,acknowledged:true};
 const post=(body:unknown=input,from=origin)=>exports.POST(new Request(origin+'/api/private-comparison',{method:'POST',headers:{Origin:from,Authorization:'Bearer machine-token'},body:typeof body==='string'?body:JSON.stringify(body)}));
 return {flags,calls,post,exports};
}
test('private route rejects a machine bearer without owner session before opening a database',async()=>{
 const h=harness();h.flags.authenticated=false;assert.equal((await h.post()).status,401);assert.equal(h.calls.db,0);assert.equal(h.calls.run,0);
 assert.equal((await h.exports.GET(new Request(origin+'/api/private-comparison'))).status,401);
});
test('same-origin and exact default-closed release gate precede parsing and execution',async()=>{
 const h=harness();assert.equal((await h.post({},'https://other.example.test')).status,403);h.flags.release='';assert.equal((await h.post()).status,403);assert.equal(h.calls.db,0);assert.equal(h.calls.run,0);
});
test('bounded request rejects malformed, extra and oversized input without execution',async()=>{
 const h=harness();for(const body of ['{',{}, {scope_hash:COMPARISON_SCOPE_HASH,acknowledged:true,expected_state_hash:'a'.repeat(64),model:'other'}])assert.equal((await h.post(body)).status,400);
 assert.equal((await h.post('a'.repeat(1025))).status,413);assert.equal(h.calls.run,0);
});
test('valid owner invocation runs once and never implies approval or automatic retry',async()=>{
 const h=harness(),result=await h.post();assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(h.calls.run,1);
 h.flags.status='uncertain';assert.equal((await h.post()).status,409);assert.equal(h.calls.run,2);
});
test('private GET only reads history and never runs a provider',async()=>{
 const h=harness();assert.equal((await h.exports.GET(new Request(origin+'/api/private-comparison'))).status,200);assert.equal(h.calls.read,1);assert.equal(h.calls.run,0);
});
test('dedicated transport fixes model, tier, reasoning/output limits, retention and excludes tools/fallback',async()=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='offline-placeholder-not-a-real-key';
 try{
  let calls=0;const transport:typeof fetch=async(url,init)=>{
   calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(String(init!.body));
   assert.equal(body.model,COMPARISON_PRICING.model);assert.equal(body.max_completion_tokens,4096);assert.equal(body.reasoning_effort,'low');assert.equal(body.service_tier,'default');assert.equal(body.store,false);assert.equal(body.temperature,undefined);assert.equal(body.tools,undefined);assert.equal(body.top_p,undefined);assert(init!.signal);
   return Response.json({model:COMPARISON_PRICING.model,service_tier:'default',choices:[{finish_reason:'stop',message:{content:'exact output'}}],usage:{prompt_tokens:10,completion_tokens:20}},{headers:{'x-request-id':'offline'}});
  };
  const result=await comparisonProvider('exact cleared prompt',undefined,undefined,transport);assert.equal(calls,1);assert.equal(result.text,'exact output');assert.equal(result.input,10);assert.equal(result.output,20);assert.equal(result.complete,true);
  const unknown=await comparisonProvider('prompt',undefined,undefined,async()=>Response.json({choices:[{message:{content:'raw survives missing usage'}}]}));assert.equal(unknown.text,'raw survives missing usage');assert(unknown.raw);
  let attempts=0;await assert.rejects(comparisonProvider('prompt',undefined,undefined,async()=>{attempts++;return new Response('',{status:429});}));assert.equal(attempts,1);
 }finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('review branch is explicitly excluded from Vercel auto-deployment while main settings remain unchanged',()=>{
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));assert.deepEqual(config.git.deploymentEnabled,{'comparison/private-stronger-model-20261025':false});assert.equal(config.git.deploymentEnabled.main,undefined);assert.equal(config.buildCommand,'npm run build:vercel');
});

test('read-only execution readiness reflects the existing exact release and runtime gates',async()=>{
 const h=harness(),get=()=>h.exports.GET(new Request(origin+'/api/private-comparison'));
 assert.equal((await (await get()).json()).execution_ready,true);h.flags.release='';assert.equal((await (await get()).json()).execution_ready,false);h.flags.release=COMPARISON_SCOPE_HASH;h.flags.live=false;assert.equal((await (await get()).json()).execution_ready,false);assert.equal(h.calls.run,0);
});
