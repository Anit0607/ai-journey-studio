import type {Artifact} from './grounding';

export const EDITORIAL_POLICY='journey-editorial-v1';
export type EditorialIssue={role:string;status:'needs_source'|'needs_revision';message:string};
/** An explicit saved hold, not a keyword quality score or topic blacklist. */
function hold(text:string):EditorialIssue['status']|null{
 let body=text.trim().replace(/^#{1,3} (?:LinkedIn|X|Instagram)[ \t]*\r?\n\s*/,'');
 const fenced=/^```(?:text|markdown)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(body);if(fenced)body=fenced[1].trim();
 body=body.replace(/^#{1,3}\s+(?=EDITORIAL HOLD\b)/i,'').replace(/^\*\*(EDITORIAL HOLD:)\*\*/i,'$1');
 if(!/^EDITORIAL HOLD(?:\s|:|$)/i.test(body))return null;
 return /^EDITORIAL HOLD:\s*needs_source(?:\s|$)/i.test(body)?'needs_source':'needs_revision';
}
function criticAdvice(text:string):string{
 const fenced=/^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(text.trim());
 try{const parsed=JSON.parse(fenced?fenced[1]:text);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&typeof parsed['Proposed advice:']==='string'?parsed['Proposed advice:']:'';}catch{return '';}
}
export function editorialReview(bundle:Artifact[]){
 const issues:EditorialIssue[]=[];
 for(const item of bundle){
  // Harvester is a verbatim source envelope, not the editorial decision stage.
  if(!['Story Miner','Strategist','Writer','Platform Adapter','Critic'].includes(item.role))continue;
  const status=hold(item.text)||(item.role==='Critic'?hold(criticAdvice(item.text)):null);
  if(status)issues.push({role:item.role,status,message:status==='needs_source'
   ?'This saved artifact says the cleared source cannot support the requested story. Prepare appropriate cleared evidence; do not publish a placeholder.'
   :'This saved artifact has an editorial hold. Revise the story or record a fresh, honest editorial assessment; factual wording decisions cannot clear this hold.'});
 }
 return {policy:EDITORIAL_POLICY,status:issues.some(item=>item.status==='needs_source')?'needs_source':issues.length?'needs_editorial_revision':'editorial_review_required',blocking:issues.length>0,issues,
  notice:'Factual checks do not measure story quality. Review the specific problem, supported decision or method, useful detail for existing ChatGPT/Codex users, natural voice and limits. No automated editorial pass is issued.'};
}
export function assertNoEditorialHold(review:ReturnType<typeof editorialReview>){if(review.blocking)throw Error('Resolve the saved editorial hold before approval or publication');}

/** Editorial selection instructions, never evidence or a new source grant. */
export function editorialPrompt(checkpoint:number){
 const brief=' ORIGINAL CONTENT BRIEF (editorial direction, not factual evidence): The main story is learning by building and directing AI agents, experimenting and solving a real problem. The reader already uses ChatGPT/Codex and wants practical methods to go further, not beginner reassurance or a product promotion. Select one concrete episode: a specific goal or constraint, a documented decision/instruction/experiment/change, what the agents or system did, and an observed result or honest unresolved limit. Make the useful method visible through that episode. Do not invent a lesson, owner action, feeling, quote, causal result or success to fill a story template. Natural human texture comes from supported choices, friction and tradeoffs; emotion is optional and only allowed when SOURCE states it. A repository observation is not automatically the owner’s personal experience. A source-safe status report is not automatically useful content. Do not default to the previously rejected generic story that six outputs completed but unsupported claims required checking, or turn it into a generic source-check tutorial. Choose a genuinely different supported practical point or report missing source detail internally. Test counts, timestamps, commit IDs, Critic verdicts and review receipts belong in internal evidence unless a particular detail is essential to understanding the selected practical method. No support map, reviewer instruction or approval checklist in the public post.';
 const roles=[
  'Harvester: preserve exact source facts and provenance. Do not turn an operations log into a personal journey or invent a motivation. Leave story selection to Story Miner.',
  'Story Miner: select a concrete supported episode and identify its problem, documented choice/change, action and observed limit/result using complete verbatim evidence. Assess usefulness to the stated reader, not just factual admissibility. If the source only supplies a title, identity capsule, checklist or status without a useful episode, return an internal hold instead of manufacturing an angle.',
  'Strategist: produce a brief with the supported problem, the concrete method/choice, its exact evidence and why that detail is useful to an experienced tool user. Do not substitute a run summary, generic takeaway or motivational lesson. Preserve a prior editorial hold rather than invent missing material.',
  'Writer: write a natural practical-peer story around the supported episode, not a chronological system report. Prefer clear everyday language and the specific choice or problem over test totals or workflow status. Use first person only for a narrator established by SOURCE. Do not copy an internal brief, source log or review checklist as the post. Preserve a prior editorial hold.',
  'Platform Adapter: adapt the current supported story for the active platform without flattening it into a technical report, adding generic advice or inserting internal evidence metadata. Preserve a prior editorial hold; do not wrap a hold as a publishable variant.',
  'Critic: independently assess editorial fit as well as factual support. Zero factual flags do not establish reader value, natural voice or story fit. Check the current post against the original brief; distinguish an operational report or repeated generic lesson from a specific useful episode. Keep the exact existing JSON schema. If source/story detail is missing or the current draft fails the brief, start the existing Proposed advice: value with EDITORIAL HOLD: needs_source or EDITORIAL HOLD: needs_revision and explain the editorial issue. Do not change a factual verdict merely to express an editorial preference.'
 ];
 const protocol=' HOLD PROTOCOL: An editorial hold is internal, never public copy or approval. For Story Miner, Strategist, Writer and Platform Adapter, start a held artifact with exactly EDITORIAL HOLD: needs_source (missing cleared story evidence) or EDITORIAL HOLD: needs_revision (a drafting/selection failure), then briefly state the missing detail or correction. Critic carries the same marker only in its existing Proposed advice: JSON value. A downstream role must not silently clear a prior hold. Do not add JSON fields, call tools, obtain another source, or claim publishing is ready. Every usable draft still requires owner editorial and factual review in the dashboard and separate exact publication approval; calendar deadlines do not justify filler.';
 return '\nEDITORIAL SELECTION CONTRACT:'+brief+' '+(roles[checkpoint]||'')+protocol;
}
