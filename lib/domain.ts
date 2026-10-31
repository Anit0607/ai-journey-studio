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
export type RuntimeConfig={owner_cleared_sources_authorized?:boolean;source_approved?:boolean;approved_source_hash?:string;transmission_authorized?:boolean;credential_use_authorized?:boolean;security_tests_passed?:boolean;pricing_verified_date?:string;pricing_window_authorized?:boolean;pricing_valid_until?:string;fallback_authorized?:boolean;openai?:Pricing;gemini?:Pricing;
  hosted?:{enabled?:boolean;persistent_key_authorized?:boolean;owner_auth_authorized?:boolean;cron_authorized?:boolean;fluid_compute_verified?:boolean};
};
export type Source={scoped_authorization?:import("./scoped-source-proof").ScopedSourceProof;id:string;text:string;category:string;reported_date:string;cleared:boolean;hash:string;
  clearance_id?:string|null;clearance_hash?:string|null;clearance_provider?:string|null;clearance_purpose?:string|null;
  clearance_owner_acknowledged?:boolean;clearance_acknowledgement?:string|null;cleared_at?:string|Date|null;revoked_at?:string|Date|null;
};
export type Task={content_brief?:Record<string,unknown>;id:string;source_id:string;source_hash:string;status:string;checkpoint:number;lease_token:string|null;lease_until:string|null;updated:string;origin_key?:string;revision_parent_task_id?:string|null;revision_base_token?:string|null;revision_note?:string|null};
export type Output={id:string;task_id:string;role:string;text:string;hash:string;created:string};
export function sourceAllowed(text:string,category:string,date:string){return text===CAPSULE&&category==="user-reported-notes"&&date==="2026-10-09";}
function utcDay(value:unknown):number|null{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const day=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value?day.getTime():null;
}
function pricingCurrent(c:RuntimeConfig,date:Date):boolean{
  if(!Number.isFinite(date.getTime()))return false;
  const today=utcDay(date.toISOString().slice(0,10)),verified=utcDay(c.pricing_verified_date);
  if(today===null||verified===null||verified>today)return false;
  // An unapproved or absent window never extends the original same-day gate.
  if(c.pricing_window_authorized!==true)return verified===today;
  // Owner-approved standing prices (30 Oct 2026) stay valid until the configured prices are
  // changed. The monthly budget cap and per-call reservations still apply to every call.
  if(c.pricing_valid_until==="until-changed")return true;
  const until=utcDay(c.pricing_valid_until);
  // Seven UTC calendar days includes the verification day, so the final day is +6.
  return until!==null&&until>=verified&&until-verified<=6*86_400_000&&today<=until;
}
export function configReady(c:RuntimeConfig,date=new Date()){
  const legacyConsent=c.source_approved===true&&c.approved_source_hash===hash(CAPSULE)&&c.transmission_authorized===true;
  if((!legacyConsent&&c.owner_cleared_sources_authorized!==true)||c.credential_use_authorized!==true||c.security_tests_passed!==true||!pricingCurrent(c,date))return false;
  try{for(const p of [c.openai,...(c.fallback_authorized?[c.gemini]:[])]){
    if(!p?.model||!p.pricing_version||p.pricing_tier!=="standard"||!p.official_pricing_url.startsWith("https://"))return false;
    rateNano(p.input_microdollars_per_token);rateNano(p.output_microdollars_per_token);
  }return true;}catch{return false;}
}
