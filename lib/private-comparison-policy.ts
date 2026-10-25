import {hash,ROLES,type Pricing} from './domain';

export const COMPARISON_TARGET=Object.freeze({source_id:'f68ae274-ae09-4987-9d61-b8704bb1bb91',source_hash:'b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603',task_id:'96737ed0-a683-4a3d-9b2e-89aea38a214e',calendar_id:'bf3f4f29-572b-4469-bd56-b9cfa41db191'});
export const COMPARISON_CAP=850_000;
// UTF-8 bytes + schema + 1,024 framing allowance, conservatively counted as tokens.
// Later stages have room for both generated prose and the bound Critic index.
export const COMPARISON_INPUT_BOUNDS=Object.freeze([18_000,18_000,24_000,22_000,30_000,60_000]);
export const COMPARISON_OUTPUT_CAP=4096; // Includes reasoning, never just visible text.
export const COMPARISON_PRICING:Pricing=Object.freeze({model:'gpt-6.1-sol',pricing_version:'private-comparison-2026-10-25-cache-write-upper-bound',pricing_tier:'standard',official_pricing_url:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',input_microdollars_per_token:'2.5',output_microdollars_per_token:'10'});
export const COMPARISON_PLAN=Object.freeze(ROLES.map((role,index)=>Object.freeze({role,model:COMPARISON_PRICING.model,input_bound:COMPARISON_INPUT_BOUNDS[index],completion_cap:COMPARISON_OUTPUT_CAP,reasoning_effort:'low',maximum_microdollars:COMPARISON_INPUT_BOUNDS[index]*2.5+COMPARISON_OUTPUT_CAP*10})));
export const COMPARISON_SCOPE=Object.freeze({version:1,provider:'openai',target:COMPARISON_TARGET,plan:COMPARISON_PLAN,pricing:COMPARISON_PRICING,maximum_microdollars:COMPARISON_CAP,purpose:'one private six-stage comparison; no retry, Calendar, task execution, approval or publication',consent_reference:'Owner approval 2026-10-25 14:43 UTC and strongest-suitable-model clarification 14:44 UTC',pricing_verified:'2026-10-25',pricing_expires:'2026-10-31'});
export const COMPARISON_SCOPE_HASH=hash(JSON.stringify(COMPARISON_SCOPE));
export type ComparisonRequest={expected_state_hash:string;scope_hash:string;acknowledged:true};
export function validComparisonRequest(value:unknown):value is ComparisonRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as ComparisonRequest;
 return Object.keys(v).sort().join('|')==='acknowledged|expected_state_hash|scope_hash'&&v.acknowledged===true&&typeof v.expected_state_hash==='string'&&/^[a-f0-9]{64}$/.test(v.expected_state_hash)&&v.scope_hash===COMPARISON_SCOPE_HASH;
}
