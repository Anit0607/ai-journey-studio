import {hash,type Task} from './domain';
import {taskPlatformPolicy} from './platform-policy';

/** Owner-requested style conditioning, not model training or a factual source.
 * Only distilled writing preferences are retained; no private chat or sample claims.
 */
const guidance=[
 'Write as a practical peer explaining a real build to a non-specialist who already uses AI tools. Use everyday language; explain a technical term only when it matters.',
 'Lead with the specific problem or contrast that makes this episode worth reading. A simple everyday image is optional. Vary the opening across posts; do not reuse a fixed hook, metaphor or formula.',
 'Give brief project context after the opening, then make the source-supported problem, change and observed result easy to follow. Explain stakes plainly only when the evidence supports them.',
 'Use short paragraphs and varied sentence lengths, including an occasional short emphasis line. Rhythm never justifies an unsupported absolute, causal claim, metric or success.',
 'First-person project ownership, decisions and directing agents are valid when established by the cleared SOURCE. This does not require the owner to have typed the code. Do not convert an external observer’s action, experience or feeling into the owner’s, or claim personal implementation without evidence.',
 'Keep a meaningful limitation in plain language rather than burying it. A spot observation is not continuous proof; planned behavior is not a measured outcome.',
 'End with a concrete, useful question or instruction the reader can give an agent when it fits the episode. Present it as proposed advice, not a tested historical fact. No engagement bait or generic motivational lesson.',
 'Use the style, not the example’s facts or wording. The active format, source attribution, explicit editorial holds, privacy rules and factual review take precedence. Do not pad thin evidence or invent emotion to sound human.'
].join('\n');
export const OWNER_WRITING_PROFILE=Object.freeze({version:'owner-style-v1-2026-10-25',hash:hash(guidance),reference:'Owner-supplied writing example, 25 October 2026',guidance,method:'Prompt conditioning only; no fine-tuning or automated factual certification.'});
export function writingProfileFor(task:Task){return taskPlatformPolicy(task)&&[2,3,4,5].includes(task.checkpoint)?OWNER_WRITING_PROFILE:null;}
export function ownerWritingPrompt(task:Task){const profile=writingProfileFor(task);const role=task.checkpoint===5?' Evaluate the public Writer/Adapter against these preferences; do not write a post or closing question yourself. Keep the exact required Critic JSON schema and verdict rules.':task.checkpoint===2?' Use these preferences to plan the public story; keep your own output a concise internal brief.':' Apply these preferences to the public copy, subject to its source and active format.';return profile?'\nOWNER WRITING STYLE (style only, never factual evidence; '+profile.version+'; SHA-256 '+profile.hash+'):'+role+'\n'+profile.guidance:'';}
