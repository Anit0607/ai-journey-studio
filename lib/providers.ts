import {configReady,type RuntimeConfig,type Pricing,tokenCost} from "./domain";
import {hostedEnvironment,hostedReady,type HostedEnvironment} from "./hosted";
export type ProviderName="openai"|"gemini";
export class ProviderFailure extends Error{constructor(readonly status:number){super("Provider HTTP "+status);}}
export type Report={serviceTier:string|null;model:string|null;requestId:string|null;finishReason:string|null};
export type Completion={text:string;input:number;output:number;outcome:"complete"|"incomplete"|"safety";report:Report};
export class AccountingFailure extends Error{constructor(readonly report:Report){super("Unverified model/service tier; reservation retained");}}
export class TerminationFailure extends Error{constructor(readonly outcome:"incomplete"|"safety",readonly report:Report){super("Completion usage unknown; reservation retained");}}
export function liveReady(c:RuntimeConfig,env:HostedEnvironment=process.env){
  const ready=hostedEnvironment(env)?hostedReady(c,env):env.STUDIO_SESSION_ONLY==="1"&&configReady(c);
  return ready&&Boolean(env.OPENAI_API_KEY);
}
const safeId=(value:unknown)=>typeof value==="string"&&value.length<=150&&/^[A-Za-z0-9_.:-]+$/.test(value)?value:null;
const tiers=["auto","default","flex","scale","priority","fast"];
export async function providerCall(provider:ProviderName,prompt:string,p:Pricing,transport:typeof fetch=fetch,credential:(name:ProviderName)=>string|undefined=name=>process.env[name==="openai"?"OPENAI_API_KEY":"GEMINI_API_KEY"]):Promise<Completion>{
  if(p.pricing_tier!=="standard")throw Error("Only reviewed standard pricing is supported");
  const key=credential(provider);
  if(!key)throw Error("Provider credential absent");
  const url=provider==="openai"?"https://api.openai.com/v1/chat/completions":"https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(p.model)+":generateContent";
  // Chat Completions explicitly supports default; never inherit project Fast/Priority settings.
  const body=provider==="openai"?{model:p.model,messages:[{role:"user",content:prompt}],max_completion_tokens:1200,store:false,service_tier:"default"}:{contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:1200}};
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(provider==="openai")headers.Authorization="Bearer "+key;else headers["x-goog-api-key"]=key;
  const result=await transport(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
  if(!result.ok)throw new ProviderFailure(result.status);
  const value=await result.json();
  if(provider==="openai"){
    const report:Report={serviceTier:tiers.includes(value.service_tier)?value.service_tier:null,model:safeId(value.model),requestId:safeId(result.headers.get("x-request-id")||value.id),finishReason:safeId(value.choices?.[0]?.finish_reason)};
    const matches=report.model===p.model||(report.model?.startsWith(p.model+"-")&&/^\d{4}-\d{2}-\d{2}$/.test(report.model.slice(p.model.length+1)));
    if(report.serviceTier!=="default"||!matches)throw new AccountingFailure(report);
    const choice=value.choices?.[0],usage=value.usage;
    const safety=!!choice?.message?.refusal||report.finishReason==="content_filter";
    const outcome=safety?"safety":report.finishReason==="stop"?"complete":"incomplete";
    const text=typeof choice?.message?.content==="string"?choice.message.content:"";
    const input=usage?.prompt_tokens,output=usage?.completion_tokens;
    try{tokenCost(p,input,output);}catch{throw new TerminationFailure(outcome==="safety"?"safety":"incomplete",report);}
    return {text,input,output,outcome:outcome==="complete"&&!text.trim()?"incomplete":outcome,report};
  }
  const candidate=value.candidates?.[0];
  const report:Report={serviceTier:null,model:safeId(value.modelVersion),requestId:safeId(value.responseId),finishReason:safeId(candidate?.finishReason||value.promptFeedback?.blockReason)};
  const safety=!!value.promptFeedback?.blockReason||["SAFETY","BLOCKLIST","PROHIBITED_CONTENT","SPII","RECITATION","IMAGE_SAFETY"].includes(report.finishReason||"");
  const outcome=safety?"safety":report.finishReason==="STOP"?"complete":"incomplete";
  // Thought parts are never displayed; reported thought tokens are still counted.
  const text=candidate?.content?.parts?.filter((x:any)=>!x.thought).map((x:any)=>typeof x.text==="string"?x.text:"").join("")||"";
  const input=value.usageMetadata?.promptTokenCount;
  const output=value.usageMetadata?.candidatesTokenCount+(value.usageMetadata?.thoughtsTokenCount||0);
  try{tokenCost(p,input,output);}catch{throw new TerminationFailure(outcome==="safety"?"safety":"incomplete",report);}
  return {text,input,output,outcome:outcome==="complete"&&!text.trim()?"incomplete":outcome,report};
}
