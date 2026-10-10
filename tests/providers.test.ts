import test from "node:test";
import assert from "node:assert/strict";
import {providerCall,AccountingFailure,TerminationFailure} from "../lib/providers";
import type {Pricing} from "../lib/domain";
import {runtimeConfig} from "../lib/config";
const pricing:Pricing={model:"isolated-fixture",pricing_version:"test-standard-v1",pricing_tier:"standard",official_pricing_url:"https://example.test",input_microdollars_per_token:"0.40",output_microdollars_per_token:"1.60"};
const openai=(overrides:Record<string,unknown>={})=>({id:"isolated-response",model:pricing.model,service_tier:"default",choices:[{finish_reason:"stop",message:{content:"isolated output",refusal:null}}],usage:{prompt_tokens:10,completion_tokens:20},...overrides});
const fake=(value:unknown):typeof fetch=>async()=>Response.json(value,{headers:{"x-request-id":"isolated-request"}});
test("session config snapshot wins over later file changes without reading the file",()=>{
  const reviewed={source_approved:false,fallback_authorized:false,openai:{model:"reviewed-fixture"}};
  const config=runtimeConfig({STUDIO_RUNTIME_CONFIG:JSON.stringify(reviewed)},()=>{throw Error("Must not re-read file");});
  assert.deepEqual(config,reviewed);
});
test("Chat Completions explicitly requests default tier and returns actual metadata",async()=>{
  let request:Record<string,any>={};
  const transport:typeof fetch=async(url,options)=>{assert.equal(url,"https://api.openai.com/v1/chat/completions");request=JSON.parse(String(options?.body));return Response.json(openai());};
  const result=await providerCall("openai","isolated prompt",pricing,transport,()=>"isolated-test-key");
  assert.equal(request.service_tier,"default");assert.equal(result.report.serviceTier,"default");assert.equal(result.outcome,"complete");
});
test("unknown, missing and premium returned tiers cannot use standard pricing",async()=>{
  for(const tier of ["priority","fast","auto","flex",undefined,null]){
    await assert.rejects(providerCall("openai","isolated prompt",pricing,fake(openai({service_tier:tier})),()=>"isolated-test-key"),AccountingFailure);
  }
  await assert.rejects(providerCall("openai","isolated prompt",pricing,fake(openai({model:"different-model"})),()=>"isolated-test-key"),AccountingFailure);
});
test("OpenAI output length, safety and missing finish reasons remain incomplete",async()=>{
  for(const [reason,outcome] of [["length","incomplete"],["content_filter","safety"],[undefined,"incomplete"]] as const){
    const result=await providerCall("openai","isolated prompt",pricing,fake(openai({choices:[{finish_reason:reason,message:{content:"nonempty isolated partial"}}]})),()=>"isolated-test-key");
    assert.equal(result.outcome,outcome);assert.equal(result.input,10);assert.equal(result.output,20);
  }
  const refusal=await providerCall("openai","isolated prompt",pricing,fake(openai({choices:[{finish_reason:"stop",message:{refusal:"isolated safety refusal"}}]})),()=>"isolated-test-key");
  assert.equal(refusal.outcome,"safety");
});
test("missing usage on a safety response retains uncertain accounting",async()=>{
  await assert.rejects(providerCall("openai","isolated prompt",pricing,fake(openai({usage:undefined,choices:[{finish_reason:"content_filter"}]})),()=>"isolated-test-key"),(error:unknown)=>error instanceof TerminationFailure&&error.outcome==="safety");
});
test("Gemini MAX_TOKENS and safety cannot advance; thinking is counted but never displayed",async()=>{
  for(const [reason,outcome] of [["STOP","complete"],["MAX_TOKENS","incomplete"],["SAFETY","safety"]] as const){
    const value={candidates:[{finishReason:reason,content:{parts:[{text:"visible isolated output"},{thought:true,text:"isolated hidden thought"}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20,thoughtsTokenCount:7}};
    const result=await providerCall("gemini","isolated prompt",pricing,fake(value),()=>"isolated-test-key");
    assert.equal(result.outcome,outcome);assert.equal(result.output,27);assert.equal(result.text,"visible isolated output");
  }
});
