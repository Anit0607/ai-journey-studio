import {configReady,type RuntimeConfig,type Pricing,tokenCost} from "./domain";
export type ProviderName="openai"|"gemini";
export class ProviderFailure extends Error{constructor(readonly status:number){super("Provider HTTP "+status);}}
export type Completion={text:string;input:number;output:number};
export function liveReady(c:RuntimeConfig){return configReady(c)&&Boolean(process.env.OPENAI_API_KEY);}
export async function providerCall(provider:ProviderName,prompt:string,p:Pricing):Promise<Completion>{
  const key=process.env[provider==="openai"?"OPENAI_API_KEY":"GEMINI_API_KEY"];
  if(!key)throw Error("Provider credential absent");
  const url=provider==="openai"?"https://api.openai.com/v1/chat/completions":"https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(p.model)+":generateContent";
  const body=provider==="openai"?{model:p.model,messages:[{role:"user",content:prompt}],max_completion_tokens:1200,store:false}:{contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:1200}};
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(provider==="openai")headers.Authorization="Bearer "+key;else headers["x-goog-api-key"]=key;
  const result=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
  if(!result.ok)throw new ProviderFailure(result.status);
  const value=await result.json();
  if(provider==="openai"){
    const choice=value.choices?.[0],usage=value.usage;
    if(choice?.message?.refusal||choice?.finish_reason==="content_filter")throw Error("Safety refusal; no fallback");
    const text=choice?.message?.content,input=usage?.prompt_tokens,output=usage?.completion_tokens;
    if(typeof text!=="string"||!text.trim())throw Error("Unknown completion");
    tokenCost(p,input,output);return {text,input,output};
  }
  const candidate=value.candidates?.[0];
  if(value.promptFeedback?.blockReason||["SAFETY","BLOCKLIST","PROHIBITED_CONTENT"].includes(candidate?.finishReason))throw Error("Safety refusal; no fallback");
  // Thought parts are never displayed; thoughts usage is still billed.
  const text=candidate?.content?.parts?.filter((x:any)=>!x.thought).map((x:any)=>x.text||"").join("");
  const input=value.usageMetadata?.promptTokenCount;
  const output=value.usageMetadata?.candidatesTokenCount+ (value.usageMetadata?.thoughtsTokenCount||0);
  if(typeof text!=="string"||!text.trim())throw Error("Unknown completion");
  tokenCost(p,input,output);return {text,input,output};
}
