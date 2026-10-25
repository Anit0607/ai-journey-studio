import {hash} from './domain';

/** Editorial identity mapping for the existing single-owner Studio note only.
 * This is not a source grant, a new factual source, or evidence of personal work.
 * New note bytes/repository/project require a new explicit review, not inference.
 */
export const OWNER_PROJECT_SOURCE_HASH='b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603';
const purpose="- Documented the repository's stated purpose for AI Journey Studio as an app for the owner's AI learning journey, intended to support drafting for LinkedIn with separate owner approval before publication; this describes project purpose, not verified autonomous operation.";
export function ownerProjectContext(source:string){
 if(hash(source)!==OWNER_PROJECT_SOURCE_HASH)return null;
 const start=source.indexOf(purpose);
 if(start<0||!source.startsWith('Attributed GitHub evidence; this record does not establish the owner’s experience.\nRepository: anit0607/ai-journey-studio\n'))return null;
 return {version:'studio-owner-project-v1',source_hash:OWNER_PROJECT_SOURCE_HASH,purpose:{start,end:start+purpose.length,text:purpose}} as const;
}
/** Grammar mapping only. Every predicate still needs original SOURCE evidence.
 * Mixed first-person actions/observations are deliberately not mapped.
 */
export function ownerProjectWording(claim:string,source:string):string|null{
 // Do not downgrade the known unsupported outcome/exclusion shapes merely because
 // they use possessive grammar. A conservative hard hold is intentional here.
 if(/\b(?:saved|savings|guaranteed|uninterrupted|continuously|never|always)\b|not once|\bno (?:SQL|quer)|without (?:any )?(?:SQL|quer)|(?:no|not|doesn[’']t)[^.!?]*\b(?:queue|queued)\b|queue-aware/i.test(claim))return null;
 if(!ownerProjectContext(source)||! /\bmy\s+(?:app|project)\b/i.test(claim)||/\b(?:I|me|mine|myself|we|our|ours|us|Anit)\b/i.test(claim))return null;
 const mapped=claim.replace(/\bmy\s+(app|project)\b/gi,'the $1');
 return /\bmy\b/i.test(mapped)?null:mapped;
}
export const OWNER_PROJECT_NARRATION=' SOURCE establishes project ownership and intended purpose, not personal work or results. Public narration may say "my app" or "my project"; every technical predicate still needs SOURCE evidence with its actual observer and scope. Use "the change" or "the update" when the implementer is unstated. Do not add "I built", "I changed", "I noticed", "I learned", feelings or "I am building with AI agents": that relationship/actor detail is not established by this SOURCE. The unchanged attribution disclaimer excludes inferred personal experience, not the stated project relationship. The writing example supplies style, never facts.';
