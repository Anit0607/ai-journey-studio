import {COMPARISON_PROMPT_POLICY_HASH} from './private-comparison-prompt-policy-manifest';
import {hash} from './domain';
import {COMPARISON_SCOPE,COMPARISON_SCOPE_HASH,COMPARISON_CAP} from './private-comparison-policy';
/** Closed, finite registry. Never mutate the original one-shot policy or historical receipts. */
export const COMPARISON_PREDECESSOR=Object.freeze({run_id:'7d849360-6740-4cc6-bf14-63db7fb2d694',scope_hash:'ed2bf1903a48644cccff06e8c4ae24cd1716c30a969229cdf5a16723be27a0ce',finished_event_id:'919d9139-55ac-4c63-8a95-3c5a02be602f',state_hash:'0f112a9dc532fe253f1ebe9bf238ac85cbf236476b803a8396a81dfe9a7127e9',config_hash:'25cf1f9326e6b3a93ec7747f6072c7bf0851fef0da02e654b8dffc053fed5ea7',status:'blocked',steps:6,spent_microdollars:85324,stage_hashes:Object.freeze(['c08a7d7c259963eab09b6ed0b8f3b1dd2161dc522ee4afa807fa7794348320e0','cce7adb0bc001526f66f115f96a88b9c6929c87252e57fcc92886b001fb0f384','6669ad85efcd1e2f5e1b81415b03a17cab1025d0c505ce79f7267f2f431ebb96','bc0e1271b9c777fb5dc4ebf2b6be6211b3b9a3e5fd1d8a7a3344451d65e71e34','4cc2ec64651262ece38904e569d127419561dff285a408b07d5398773fb4e4f8','d8d3b129306514339e4df66fe1e8de41b874cbb50c3c6a386627442af699347b'])});
// Owner approved one corrected comparison on 2026-10-26; the reference below
// binds that affirmative reply, not a retry or any publication permission.
// This exact reviewed digest is immutable scope data, not a dynamic current-policy alias.
// A factual pinned digest is not consent; pending/null consent remains fail-closed.
export const CORRECTED_COMPARISON_AUTHORIZATION:{status:'pending'|'approved';consent_reference:string|null;prompt_policy_hash:string|null}=Object.freeze({status:'approved',consent_reference:'Sentinel_5fe38455d5bc8191ad426a18b4a923a4',prompt_policy_hash:'a92c37461e9d2b3d904ceb831cd498aebb7a9863a534865d94d56aac474dbf0a'});
export const CORRECTED_COMPARISON_CAP=764676;
// Successor-only conservative bounds; original one-shot limits are immutable.
export const CORRECTED_COMPARISON_INPUT_BOUNDS=Object.freeze([20000,20000,28000,30000,35000,65000]);
export const CORRECTED_COMPARISON_PLAN=Object.freeze(COMPARISON_SCOPE.plan.map((stage,index)=>Object.freeze({...stage,input_bound:CORRECTED_COMPARISON_INPUT_BOUNDS[index],maximum_microdollars:CORRECTED_COMPARISON_INPUT_BOUNDS[index]*2.5+stage.completion_cap*10})));
export const CORRECTED_COMPARISON_SCOPE=Object.freeze({...COMPARISON_SCOPE,version:2,plan:CORRECTED_COMPARISON_PLAN,maximum_microdollars:CORRECTED_COMPARISON_CAP,purpose:'exactly one separately authorized corrective six-stage experiment after the immutable failed predecessor; no retry, resume, approval or publication',consent_reference:CORRECTED_COMPARISON_AUTHORIZATION.consent_reference,permission_status:CORRECTED_COMPARISON_AUTHORIZATION.status,prompt_policy_hash:CORRECTED_COMPARISON_AUTHORIZATION.prompt_policy_hash,predecessor:COMPARISON_PREDECESSOR,combined_maximum_microdollars:COMPARISON_CAP});
export const CORRECTED_COMPARISON_SCOPE_HASH=hash(JSON.stringify(CORRECTED_COMPARISON_SCOPE));
export type ComparisonPolicy={scope:typeof COMPARISON_SCOPE|typeof CORRECTED_COMPARISON_SCOPE;hash:string;cap:number;corrected:boolean;gate:string};
const original:ComparisonPolicy=Object.freeze({scope:COMPARISON_SCOPE,hash:COMPARISON_SCOPE_HASH,cap:COMPARISON_CAP,corrected:false,gate:'STUDIO_PRIVATE_COMPARISON_SCOPE'});
const corrected:ComparisonPolicy=Object.freeze({scope:CORRECTED_COMPARISON_SCOPE,hash:CORRECTED_COMPARISON_SCOPE_HASH,cap:CORRECTED_COMPARISON_CAP,corrected:true,gate:'STUDIO_PRIVATE_CORRECTED_COMPARISON_SCOPE'});
export function comparisonPolicy(value:unknown):ComparisonPolicy|null{return value===original.hash?original:value===corrected.hash?corrected:null;}
/** Saved provenance depends on the immutable recorded grant, not today's prompt code. */
export function comparisonPolicyRecordedPermission(policy:ComparisonPolicy){
 if(policy===original)return true;
 return policy===corrected&&CORRECTED_COMPARISON_AUTHORIZATION.status==='approved'&&typeof CORRECTED_COMPARISON_AUTHORIZATION.consent_reference==='string'&&CORRECTED_COMPARISON_AUTHORIZATION.consent_reference.trim().length>0&&typeof CORRECTED_COMPARISON_AUTHORIZATION.prompt_policy_hash==='string'&&/^[a-f0-9]{64}$/.test(CORRECTED_COMPARISON_AUTHORIZATION.prompt_policy_hash);
}
/** New execution additionally requires the current compiled policy to match that grant. */
export function comparisonPolicyAuthorized(policy:ComparisonPolicy,currentPromptPolicyHash?:string){
 return comparisonPolicyRecordedPermission(policy)&&(!policy.corrected||currentPromptPolicyHash===CORRECTED_COMPARISON_AUTHORIZATION.prompt_policy_hash);
}
export type ScopedComparisonRequest={expected_state_hash:string;scope_hash:string;acknowledged:true};
export function validScopedComparisonRequest(value:unknown):value is ScopedComparisonRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as ScopedComparisonRequest;return Object.keys(v).sort().join('|')==='acknowledged|expected_state_hash|scope_hash'&&v.acknowledged===true&&typeof v.expected_state_hash==='string'&&/^[a-f0-9]{64}$/.test(v.expected_state_hash)&&!!comparisonPolicy(v.scope_hash);
}
/** Final pipeline must generate and verify a compiled manifest before activation. */
export function currentComparisonPromptPolicyHash():string{return COMPARISON_PROMPT_POLICY_HASH;}
