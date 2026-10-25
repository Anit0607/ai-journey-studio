import {providerResponseFormat,type ProviderArtifactContract} from './critic-response-format';
import {COMPARISON_PRICING,COMPARISON_OUTPUT_CAP} from './private-comparison-policy';

export type ComparisonCompletion={text:string;input:number;output:number;complete:boolean;report:{model:string;tier:string;request_id:string|null;finish_reason:string|null};raw:unknown};
/** Dedicated transport: the production provider/configuration is never overridden. */
export async function comparisonProvider(prompt:string,contract?:ProviderArtifactContract,signal?:AbortSignal,transport:typeof fetch=fetch):Promise<ComparisonCompletion>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('Comparison credential unavailable');
 const format=providerResponseFormat('openai',contract);
 const result=await transport('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},signal:AbortSignal.any([AbortSignal.timeout(35_000),...(signal?[signal]:[])]),body:JSON.stringify({model:COMPARISON_PRICING.model,messages:[{role:'user',content:prompt}],max_completion_tokens:COMPARISON_OUTPUT_CAP,reasoning_effort:'low',service_tier:'default',store:false,...(format?{response_format:format}:{})})});
 // HTTP failures are uncertain; even a rejection never triggers a second attempt.
 if(!result.ok)throw Error('Comparison transport not confirmed');
 const raw=await result.json(),choice=raw.choices?.[0],input=raw.usage?.prompt_tokens,output=raw.usage?.completion_tokens;
 // Usage and billing are validated only after the runner durably saves raw output.
 const text=typeof choice?.message?.content==='string'?choice.message.content:'';
 return {text,input,output,complete:choice?.finish_reason==='stop'&&!choice?.message?.refusal&&!!text.trim(),report:{model:raw.model,tier:raw.service_tier,request_id:result.headers.get('x-request-id'),finish_reason:choice?.finish_reason||null},raw};
}
