import { createHash } from "node:crypto";
export const CAPSULE="Anit is a non-coder who builds and directs AI agents, retains final approval, uses Codex and agents for implementation, and learns by doing. He wants to share practical agent-building methods and honest lessons.";
export const ROLES=["Harvester","Story Miner","Strategist","Writer","Platform Adapter","Critic"] as const;
export const CAP=15_000_000,BUFFER=1_000_000,WARNING=10_000_000;
export const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export const istMonth=(date=new Date())=>new Date(date.getTime()+330*60_000).toISOString().slice(0,7);
export function rateNano(value:unknown):number {
  if(typeof value!=="string" && typeof value!=="number")throw Error("Pricing missing");
  const text=String(value);
  if(!/^\d+(\.\d{1,3})?$/.test(text))throw Error("Invalid exact pricing");
  const [whole,fraction=""]=text.split(".");
  const rate=Number(whole)*1000+Number(fraction.padEnd(3,"0"));
  if(!Number.isSafeInteger(rate)||rate<=0)throw Error("Invalid exact pricing");
  return rate;
}
export function tokenCost(p:Pricing,input:number,output:number){
  if(!Number.isSafeInteger(input)||!Number.isSafeInteger(output)||input<0||output<0)throw Error("Invalid usage");
  const cost=Math.ceil((input*rateNano(p.input_microdollars_per_token)+output*rateNano(p.output_microdollars_per_token))/1000);
  if(!Number.isSafeInteger(cost))throw Error("Invalid cost");
  return cost;
}
export type Pricing={model:string;pricing_version:string;pricing_tier:"standard";official_pricing_url:string;input_microdollars_per_token:string;output_microdollars_per_token:string};
export type RuntimeConfig={source_approved?:boolean;approved_source_hash?:string;transmission_authorized?:boolean;credential_use_authorized?:boolean;security_tests_passed?:boolean;pricing_verified_date?:string;fallback_authorized?:boolean;openai?:Pricing;gemini?:Pricing};
export type Source={id:string;text:string;category:string;reported_date:string;cleared:boolean;hash:string};
export type Task={id:string;source_id:string;source_hash:string;status:string;checkpoint:number;lease_token:string|null;lease_until:string|null;updated:string};
export type Output={id:string;task_id:string;role:string;text:string;hash:string;created:string};
export function sourceAllowed(text:string,category:string,date:string){return text===CAPSULE&&category==="user-reported-notes"&&date==="2026-10-09";}
export function configReady(c:RuntimeConfig,date=new Date()){
  if(!c.source_approved||c.approved_source_hash!==hash(CAPSULE)||!c.transmission_authorized||!c.credential_use_authorized||!c.security_tests_passed||c.pricing_verified_date!==date.toISOString().slice(0,10))return false;
  try{for(const p of [c.openai,...(c.fallback_authorized?[c.gemini]:[])]){
    if(!p?.model||!p.pricing_version||p.pricing_tier!=="standard"||!p.official_pricing_url.startsWith("https://"))return false;
    rateNano(p.input_microdollars_per_token);rateNano(p.output_microdollars_per_token);
  }return true;}catch{return false;}
}
