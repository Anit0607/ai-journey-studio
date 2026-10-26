import {hash,type Task} from './domain';
import {taskPlatformPolicy} from './platform-policy';
import {platformVariants} from './platform-variants';
import type {Artifact} from './grounding';

/** Prospective prompt conditioning, not training, biography, or factual evidence.
 * Historical receipts retain their recorded version/hash; never relabel old drafts.
 */
const guidance=[
 'Write a personal, practical LinkedIn build story for someone who uses AI but is not a specialist. Use plain words and minimal jargon. Explain only technical terms the reader needs; preserve units, scope and uncertainty.',
 'Public post: 900–1300 characters including spaces and line breaks, excluding the platform heading. It applies to standard posts with either planning label, not to articles. Never pad thin evidence or silently truncate; keep an editorial hold if honest copy cannot fit.',
 'Shape: vivid source-backed problem, quick project context, concrete change, observed result, then a useful lesson or focused reflective question. Vary the opening; a metaphor is optional, not a fixed formula. Keep paragraphs short. Mix short emphasis sentences with fuller explanations; no forced fragments or invented drama.',
 'Use natural contractions, straight quotes/apostrophes and no em dashes. First person is valid only when established by the cleared SOURCE or separately validated task-bound owner context; project ownership does not require the owner to have typed the code. Do not turn an observer\'s action into the owner\'s or invent feelings, experience, instructions or outcomes.',
 'Keep material caveats in one or two plain sentences before the ending, not a catalogue of implementation exclusions. Never remove necessary limits to hit a style target. End with a specific useful lesson or a focused reflective question grounded in this episode, never a disclaimer or generic engagement bait. Proposed advice is not a tested result or a claimed personal lesson.',
 'Meaning-preserving word choices: "utilize" -> "use"; "prior to" -> "before"; "in order to" -> "to". These are vocabulary examples, not facts or a post template. Do not copy sample numbers, claims, phrases or reported scores. Source, explicit editorial holds, privacy rules and factual review take precedence; exact approval stays separate.'
].join('\n');
export const OWNER_WRITING_PROFILE=Object.freeze({version:'owner-style-v2-2026-10-26',hash:hash(guidance),reference:'Owner-supplied merged LinkedIn example and explicit tone instructions, 26 October 2026',guidance,method:'Prompt conditioning only; no fine-tuning, measured voice score or automated factual certification.'});
export function writingProfileFor(task:Task){return taskPlatformPolicy(task)&&[1,2,3,4,5].includes(task.checkpoint)?OWNER_WRITING_PROFILE:null;}

/** Mechanical observations only. Never a quality score, factual clearance or edit.
 * Runs only when composing a NEW Critic prompt; no historical-review regrading.
 */
export function linkedinVoiceDiagnostics(task:Task,previous:Artifact[]){
 const policy=taskPlatformPolicy(task);
 if(!policy||task.checkpoint!==5)return [];
 return previous.filter(a=>a.role==='Writer'||a.role==='Platform Adapter').map(a=>{
  const body=a.role==='Platform Adapter'?platformVariants(a,policy).variants.find(v=>v.platform==='LinkedIn')?.text:a.text;
  if(!body)return {role:a.role,artifact_hash:a.hash,status:'unavailable',issues:['platform_schema']};
  if(/^EDITORIAL HOLD\b/.test(body.trim()))return {role:a.role,artifact_hash:a.hash,status:'held',issues:[]};
  const characters=Array.from(body).length,issues:string[]=[];
  if(characters<900||characters>1300)issues.push('character_target');
  if(/[‘’“”]/.test(body))issues.push('curly_quotes');
  if(/—/.test(body))issues.push('em_dash');
  // Transparent review hints, not claims that jargon is wrong or a lesson is proven.
  const jargon_terms=[...new Set((body.toLowerCase().match(/\b(?:endpoint|autosuspend|request-level|runtime|metadata|queued-job|source-intake|configured-window|compute-unit|provenance|sql traces|validation boundary)\b/g)||[]))];
  const review_hints:string[]=[];
  if(jargon_terms.length>=3)review_hints.push('dense_jargon_review');
  if(/\b(?:repository|commit|source hash|provider receipts?|reported observation times|recorded metadata)\b|[\w.-]+\/[\w.-]+\/commit\//i.test(body))review_hints.push('audit_framing_review');
  const ending=(body.trim().match(/[^.!?]+(?:[.!?]+["']?|$)/g)||[]).at(-1)||'';
  if(/\b(?:not (?:proof|evidence)|no (?:guarantee|savings claims)|(?:has not|haven't|hasn't|not yet)[^.!?]{0,40}(?:measured|verified)|remain[s]? (?:unknown|unverified)|disclaimer|limitation)\b/i.test(ending))review_hints.push('caveat_ending_review');
  if(/^(?:thoughts|agree|what do you think|who(?:'s| is) with me)\?\s*["']?$|^(?:like and share|comment below|tell me in the comments)[.!]?\s*["']?$/i.test(ending.trim()))review_hints.push('engagement_bait_review');
  const sentence_word_counts=(body.match(/[^.!?]+(?:[.!?]+|$)/g)||[]).slice(0,16).map(s=>(s.match(/\S+/g)||[]).length);
  return {role:a.role,artifact_hash:a.hash,status:issues.length?'needs_voice_revision':'voice_review_required',characters,target:[900,1300],issues,review_hints,jargon_terms,sentence_word_counts};
 });
}
export function ownerWritingPrompt(task:Task,previous:Artifact[]=[]){
 const profile=writingProfileFor(task);if(!profile)return '';
 const header='\nOWNER WRITING STYLE (style only, never factual evidence; '+profile.version+'; SHA-256 '+profile.hash+'):';
 if(task.checkpoint===1)return header+' Select one clear problem/change/result for a 900–1300-character post with a useful lesson or focused question. Keep the required selection schema; do not write the post.';
 const role=task.checkpoint===5?' Evaluate Writer/Adapter, not a new post. Keep exact Critic JSON/verdict rules. Mechanical issues require EDITORIAL HOLD: needs_revision in Proposed advice:. Inspect review hints for dense jargon, audit-like framing, disclaimer endings and generic engagement bait; they are not automatic factual errors. A clear mechanical check is not a voice pass.':task.checkpoint===2?' Plan the public story within the required artifact schema; a canonical selector still returns only IDs/labels, never a prose brief.':' Apply this voice to public copy; preserve every supported claim and material limit.';
 const diagnostics=task.checkpoint===5?'\nVOICE OBSERVATIONS (mechanical only, not factual or editorial approval): '+JSON.stringify(linkedinVoiceDiagnostics(task,previous)):'';
 return header+role+'\n'+profile.guidance+diagnostics;
}
