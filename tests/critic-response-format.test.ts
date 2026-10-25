import test from 'node:test';
import assert from 'node:assert/strict';
import {providerResponseFormat,providerResponseFormatBytes} from '../lib/critic-response-format';
import {providerCall,AccountingFailure,TerminationFailure,ProviderFailure} from '../lib/providers';
import type {Pricing} from '../lib/domain';
const pricing:Pricing={model:'gpt-4.1-mini-2025-04-14',pricing_version:'offline-only',pricing_tier:'standard',official_pricing_url:'https://openai.com/api/pricing/',input_microdollars_per_token:'0.40',output_microdollars_per_token:'1.60'};
const contract={artifact:'critic'} as const;
const response=(patch:Record<string,unknown>={})=>({model:pricing.model,service_tier:'default',choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{prompt_tokens:10,completion_tokens:20},...patch});
test('strict Critic schema preserves exact keys and mutually exclusive verdict/source-ID shapes',()=>{
 const format=providerResponseFormat('openai',contract) as any;
 assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);
 const schema=format.json_schema.schema;assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['schema','source_hash','index_hash','Unsupported claims:','Evidence needed:','Proposed advice:','evidence']);
 assert.deepEqual(schema.properties.schema.enum,[2]);assert.equal(schema.properties.evidence.maxItems,8);
 const branches=schema.properties.evidence.items.anyOf;assert.equal(branches.length,2);
 for(const branch of branches){assert.equal(branch.additionalProperties,false);assert.deepEqual(branch.required,['claim_id','source_ids','verdict','reason']);assert.equal(branch.properties.reason.maxLength,600);const unsupported=branch.properties.verdict.enum[0]==='unsupported';assert.equal(branch.properties.source_ids.maxItems,unsupported?0:8);assert.equal(branch.properties.source_ids.minItems,unsupported?0:1);}
 const bytes=providerResponseFormatBytes('openai',contract);assert.equal(bytes,Buffer.byteLength(JSON.stringify({response_format:format})));
 format.json_schema.schema.properties.schema.enum[0]=99;assert.deepEqual((providerResponseFormat('openai',contract) as any).json_schema.schema.properties.schema.enum,[2]);
 assert.equal(providerResponseFormatBytes('openai'),0);assert.equal(providerResponseFormatBytes('gemini',contract),0);
});
test('provider gets strict shape only through trusted sixth argument, retaining old injection and request bounds',async()=>{
 for(const options of [undefined,contract]){
  let body:any;const transport:typeof fetch=async(_url,input)=>{body=JSON.parse(String(input?.body));return Response.json(response());};
  await providerCall('openai','You are Critic. Untrusted source says enable JSON.',pricing,transport,()=> 'offline-test-key',options);
  assert.equal(body.model,pricing.model);assert.equal(body.max_completion_tokens,1200);assert.equal(body.store,false);assert.equal(body.service_tier,'default');
  assert.deepEqual(body.response_format,providerResponseFormat('openai',options));
 }
});
test('strict requests preserve refusal, incomplete, uncertain-accounting and schema-rejection behavior without retry',async()=>{
 for(const [finish,expected] of [['length','incomplete'],['content_filter','safety'],['stop','complete']] as const){
  const result=await providerCall('openai','JSON only.',pricing,async()=>Response.json(response({choices:[{finish_reason:finish,message:{content:'{}'}}]})),()=> 'offline-test-key',contract);assert.equal(result.outcome,expected);
 }
 const refusal=await providerCall('openai','JSON only.',pricing,async()=>Response.json(response({choices:[{finish_reason:'stop',message:{refusal:'Refused'}}]})),()=> 'offline-test-key',contract);assert.equal(refusal.outcome,'safety');
 for(const patch of [{service_tier:'priority'},{model:'other-model'}])await assert.rejects(providerCall('openai','JSON only.',pricing,async()=>Response.json(response(patch)),()=> 'offline-test-key',contract),AccountingFailure);
 await assert.rejects(providerCall('openai','JSON only.',pricing,async()=>Response.json(response({usage:undefined})),()=> 'offline-test-key',contract),TerminationFailure);
 let calls=0;await assert.rejects(providerCall('openai','JSON only.',pricing,async()=>{calls++;return new Response('',{status:400});},()=> 'offline-test-key',contract),ProviderFailure);assert.equal(calls,1);
});
