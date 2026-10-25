import {ROLES,hash,type Source,type Task} from './domain';
import {type Artifact} from './grounding';
import {projectDraftContext} from './draft-prompt';
import {writingProfileFor} from './owner-writing-profile';
import {DRAFTING_GUIDANCE_VERSION} from './drafting-guidance';
import {SOURCE_DRAFTING_CONTRACT_VERSION} from './drafting-contract';

export const DRAFT_PROMPT_PREPARED='draft_prompt_prepared';
export const DRAFT_OUTPUT_RECORDED='draft_output_recorded';
export type DraftPromptMetadata={schema:1;checkpoint:number;role:string;source_hash:string;prompt_hash:string;prompt_bytes:number;guidance_version:string;source_contract_version:string;writing_profile:{version:string;hash:string}|null;prior_artifacts:{role:string;hash:string}[]};
export function draftPromptMetadata(task:Task,source:Source,previous:Artifact[],prompt:string):DraftPromptMetadata{
 const profile=writingProfileFor(task);
 return {schema:1,checkpoint:task.checkpoint,role:ROLES[task.checkpoint],source_hash:source.hash,prompt_hash:hash(prompt),prompt_bytes:Buffer.byteLength(prompt),guidance_version:DRAFTING_GUIDANCE_VERSION,source_contract_version:SOURCE_DRAFTING_CONTRACT_VERSION,writing_profile:profile?{version:profile.version,hash:profile.hash}:null,prior_artifacts:projectDraftContext(task.checkpoint,previous,source.text).map(({role,hash})=>({role,hash}))};
}
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:string[])=>Object.keys(v).sort().join('|')===[...expected].sort().join('|');
export function validPromptMetadata(v:unknown):v is DraftPromptMetadata{
 if(!object(v)||!keys(v,['schema','checkpoint','role','source_hash','prompt_hash','prompt_bytes','guidance_version','source_contract_version','writing_profile','prior_artifacts'])||v.schema!==1||!Number.isInteger(v.checkpoint)||Number(v.checkpoint)<0||Number(v.checkpoint)>5||v.role!==ROLES[Number(v.checkpoint)]||!sha(v.source_hash)||!sha(v.prompt_hash)||!Number.isSafeInteger(v.prompt_bytes)||Number(v.prompt_bytes)<=0||Number(v.prompt_bytes)>96000)return false;
 if(typeof v.guidance_version!=='string'||v.guidance_version.length>100||typeof v.source_contract_version!=='string'||v.source_contract_version.length>100)return false;
 if(v.writing_profile!==null&&(!object(v.writing_profile)||!keys(v.writing_profile,['version','hash'])||typeof v.writing_profile.version!=='string'||!v.writing_profile.version||v.writing_profile.version.length>100||!sha(v.writing_profile.hash)))return false;
 if(!Array.isArray(v.prior_artifacts)||v.prior_artifacts.length>6||v.prior_artifacts.some(p=>!object(p)||!keys(p,['role','hash'])||!ROLES.includes(p.role as typeof ROLES[number])||!sha(p.hash))||new Set(v.prior_artifacts.map(p=>p.role)).size!==v.prior_artifacts.length)return false;
 return true;
}
export function assertPromptMetadata(meta:DraftPromptMetadata,task:Task){
 const profile=writingProfileFor(task);
 if(!validPromptMetadata(meta)||meta.checkpoint!==task.checkpoint||meta.source_hash!==task.source_hash||meta.guidance_version!==DRAFTING_GUIDANCE_VERSION||meta.source_contract_version!==SOURCE_DRAFTING_CONTRACT_VERSION||JSON.stringify(meta.writing_profile)!==JSON.stringify(profile?{version:profile.version,hash:profile.hash}:null))throw Error('Invalid draft prompt receipt');
}
