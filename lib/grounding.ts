import type {PlatformPolicy} from "./platform-policy";
import {platformVariants} from "./platform-variants";
import {CAPSULE,ROLES,hash} from "./domain";
import {attributedCommitSummary} from "./drafting-contract";
export type Artifact={role:string;text:string;hash:string};
export const SUPPORTED_SENTENCES=["I am a non-coder","I build and direct AI agents","I retain final approval","I use Codex and agents for implementation","I learn by doing","I want to share practical agent-building methods and honest lessons"];
export const GROUNDING_RULES="The cleared note establishes only role, approach and intent, not demonstrated discoveries, outcomes, mistakes or tested methods. Personal statements must stay within these exact supported sentences: "+SUPPORTED_SENTENCES.join("; ")+". Never turn wanting to share into having shared. If evidence is insufficient, say Evidence needed and ask for a concrete cleared note. Write for existing ChatGPT/Codex users. Anchor personal stories in specific cleared events and user-documented feelings; ask for missing emotional context, never invent it or replace it with a generic tutorial. Generic suggestions must be labeled Proposed approach, not Anit's lived lesson. Prior artifacts are not independent evidence. Critic must include Unsupported claims:, Evidence needed:, and Proposed advice: sections; quote and flag every unsupported personal experience claim, even if an earlier agent endorsed it. User approval is not factual verification.";

/** Formatting-only normalization: retain every claim word, number and negation. */
function unformatClaim(value:string):string{
 let text=value.trim().replace(/^(?:(?:[-*+>]\s+)|(?:\d+[.)]\s+)|(?:#{1,6}\s+))+/,'').replace(/\*\*/g,'');
 for(let n=0;n<3;n++){
  const wrapped=/^(?:"([\s\S]*)"|\u201c([\s\S]*)\u201d|\u2018([\s\S]*)\u2019|'([\s\S]*)'|`([\s\S]*)`),?$/.exec(text);
  if(!wrapped)break;text=(wrapped.slice(1).find(part=>part!==undefined)||'').trim();
 }
 return text.replace(/\s+/g,' ').trim();
}
/** An internal provenance envelope is metadata only with the exact stored date/body. */
export function verifiedSourceEnvelope(value:string,role:string,source:string,reportedDate?:string):boolean{
 if(!['Harvester','Story Miner','Strategist'].includes(role))return false;
 const text=unformatClaim(value),dated=/^SOURCE DATE:\s*(\d{4}-\d{2}-\d{2})(?:[.,]\s*|\s+)SOURCE:\s*([\s\S]+)$/i.exec(text);
 const bare=/^SOURCE:\s*([\s\S]+)$/i.exec(text);
 const body=dated?(reportedDate===dated[1]?dated[2]:null):bare?.[1];
 return typeof body==='string'&&unformatClaim(body)===unformatClaim(source);
}
export type GroundingFlag={role:string;claim:string;reason:string;category?:'structure'};
const comparable=(text:string)=>unformatClaim(text).replace(/[.!]$/,'').toLowerCase();
const sentences=(text:string)=>text.split(/(?<=[.!?])\s+|\n/).filter(line=>line.trim());
function jsonText(value:unknown):string[]{
 if(typeof value==='string')return [value];
 if(typeof value==='number'||typeof value==='boolean')return [String(value)];
 if(Array.isArray(value))return value.flatMap(jsonText);
 if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>[...(/\b(?:I|my|Anit)\b/i.test(key)?[key]:[]),...(typeof item==='number'||typeof item==='boolean'?[key+': '+String(item)]:jsonText(item))]);
 return [];
}
function claimLines(artifact:Artifact,source:string,reportedDate?:string):string[]{
 let atoms:string[];
 try{const parsed:unknown=JSON.parse(artifact.text);atoms=jsonText(parsed);}catch{atoms=[artifact.text];}
 const expand=(atom:string)=>{
  const text=unformatClaim(atom);
  if(verifiedSourceEnvelope(text,artifact.role,source,reportedDate))return [];
  return sentences(text);
 };
 return atoms.flatMap(atom=>verifiedSourceEnvelope(atom,artifact.role,source,reportedDate)?[]:atom.split(/\n/).flatMap(expand));
}
const REVIEW_BOUNDARY=' Writer and Platform Adapter return public prose only. Keep evidence gaps, provenance records and review advice in Harvester, Strategist and Critic artifacts; never append internal reviewer sections or owner-clearance footers to platform copy. Preserve these internal notes for review; do not silently strip them from saved outputs.';

const externalEvidence=(source:string)=>/^Attributed (?:GitHub|YouTube) evidence;/.test(source);
export function groundingRules(source:string){
  if(externalEvidence(source))return REVIEW_BOUNDARY+ " This is attributed external evidence, not evidence of the owner's lived experience. Preserve repository/author or channel attribution. Describe external claims in third person; never adopt first-person claims, achievements or feelings as the owner's. Use only the exact supplied source and its reported date; no personal profile, prior artifact or editing feedback is independent evidence. Do not infer achievements, lessons, intentions, feelings, implementation success or tested outcomes. Keep reported claims distinct from demonstrated behavior. If owner experience is needed, ask for a separate owner-written source. Faithful paraphrases require owner comparison; never label them exact quotations. Critic must include Unsupported claims:, Evidence needed:, and Proposed advice: sections and flag unsupported claims. Every draft requires human factual review; approval never authorizes publishing.";
  if(source===CAPSULE)return GROUNDING_RULES+REVIEW_BOUNDARY;
  return REVIEW_BOUNDARY+" Use only the exact owner-cleared source as factual evidence. Faithful paraphrases are allowed, preserving source qualification, negation, timing and attribution. The owner reviews every uncertain claim against exact source passages. Never add certainty or describe paraphrases as exact quotations. Do not infer achievements, discoveries, mistakes, lessons, metrics or feelings. A request for a different tone is not new evidence. If a detail is missing, say Evidence needed. Generic suggestions must be labeled Proposed approach. Prior artifacts and revision feedback are not independent evidence. Critic must include Unsupported claims:, Evidence needed:, and Proposed advice: sections; quote and flag unsupported personal claims. Every draft requires human factual review; approval never authorizes publishing.";
}
/** Narrow checks for title-only GitHub evidence, not general semantic verification. */
function commitInference(line:string):boolean{
  return /\b(?:this(?:\s+(?:commit|addition|change|update))?|the\s+(?:commit|addition|change|update))\s+(?:shows?|indicates?|suggests?|demonstrates?|highlights?|proves?|reflects?|confirms?)\b/i.test(line)
    || /^(?:the|this|a)\s+(?:feature|workflow|system|implementation|addition|change|execution)\s+(?:now\s+)?(?:restricts?|bounds?|enforces?|prevents?|protects?|ensures?|guarantees?|works?|allows?|supports?|enhances?|improves?)\b/i.test(line)
    || /^(?:the|this)\s+(?:feature|workflow|system|implementation|addition|change|execution)\s+(?:is|was|has been)\s+(?:successfully\s+)?(?:tested|verified|deployed|implemented|operational)\b/i.test(line)
    || /^Scope:\s*(?:restricting|bounding|enforcing|preventing|protecting|ensuring|enhancing|improving)\b/i.test(line);
}
function nonVerbatimLines(text:string,source:string):string[]{
  const exactLines=new Set(source.split('\n').map(line=>line.trim())),bad:string[]=[];let active=false;
  for(const raw of text.split('\n')){
    const line=raw.trim();
    if(/^(?:#{1,6}\s*)?(?:\*\*)?Verbatim evidence:?(?:\*\*)?$/i.test(line)){active=true;continue;}
    if(!active)continue;
    if(!line)continue;
    if(/^(?:(?:[-*_]\s*){3,}|#{1,6}\s+.+|(?:\*\*)?[A-Za-z][A-Za-z ]{0,50}:(?:\*\*)?)$/.test(line)){active=false;continue;}
    const quoted=line.replace(/^[-*+>]\s+/, '').replace(/\*\*/g,'');
    if(!exactLines.has(quoted))bad.push(quoted);
  }
  return bad;
}
export function bundleQuality(bundle:Artifact[],source:string,reportedDate?:string,policy?:PlatformPolicy){
  const flags:GroundingFlag[]=[];
  const commitSummary=attributedCommitSummary(source);
  if(!source.trim())flags.push({role:"Source",claim:"Source missing",category:"structure",reason:"Exact cleared evidence required"});
  const adapter=bundle.find(item=>item.role==="Platform Adapter");
  if(adapter){const variants=platformVariants(adapter,policy);if(!variants.complete)flags.push({role:"Platform Adapter",claim:"Incomplete platform variants",category:"structure",reason:variants.reason||"Separate platform drafts required"});}
  for(const artifact of bundle.filter(item=>item.role!=="Critic")){
    if(commitSummary)for(const claim of nonVerbatimLines(artifact.text,source))flags.push({role:artifact.role,claim:claim.slice(0,500),reason:"Text labeled Verbatim evidence must copy exact source lines; correct the label or quote"});
    for(const line of claimLines(artifact,source,reportedDate)){
      const personal=/\b(?:I\b|I[’'](?:ve|m)|my\b|Anit\b|he\s+(?:found|discovered|learned|shares))/i.test(line);
      const clean=comparable(line);
      const directQuote=clean.length>=10&&sentences(source).some(sentence=>comparable(sentence)===clean);
      if(commitSummary&&!directQuote&&commitInference(line)&&!flags.some(flag=>flag.role===artifact.role&&flag.claim===line.slice(0,500)))flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Commit-summary evidence establishes a recorded title, not inferred learning, intent, benefits or working capability"});
      // Conservative: the short capsule supports only six personal assertions.
      if(personal&&(externalEvidence(source)||(!directQuote&&!(source===CAPSULE&&SUPPORTED_SENTENCES.some(sentence=>clean===sentence.toLowerCase())))))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Personal claim needs specific cleared evidence; use a supported sentence or remove it"});
      const newFigure=/\b\d+(?:[.,]\d+)?\s*(?:%|(?:users?|followers?|subscribers?|customers?|views?|posts?|drafts?|calls?)\b)|\b(?:users?|followers?|subscribers?|revenue|views?|posts?|drafts?|calls?)\s*[:=]\s*[\d$]|^\d+(?:\.\d+)?$/i.test(line);
      if(!directQuote&&newFigure&&!/^Proposed approach:/i.test(line.trim()))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"New figure or result needs exact cleared evidence; do not invent metrics"});
      if(!directQuote&&/\b(?:this|my|our) (?:experience|journey) (?:highlights|shows|taught|demonstrates)\b/i.test(line))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Experiential lesson needs exact cleared evidence; do not infer a takeaway as lived experience"});
      if(!directQuote&&/discovered|\bfound\b|steady improvement|gradual wins|doesn[’']t require coding|don[’']t need programming|coding is not mandatory|no fluff.*what works|more valuable than.*programming|patience.*pay off/i.test(line))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Discovery, result or categorical advice is not established by this source"});
    }
  }
  const critic=bundle.find(item=>item.role==="Critic")?.text||"";
  if(!["Unsupported claims:","Evidence needed:","Proposed advice:"].every(section=>critic.includes(section)))flags.push({role:"Critic",claim:"Critique format",category:"structure",reason:"Explicit unsupported-claim, evidence and proposed-advice sections required"});
  if(flags.some(item=>item.role!=="Critic")&&/no unsupported|all claims are supported|all variants accurately/i.test(critic))flags.push({role:"Critic",claim:"Unconditional endorsement",reason:"Critic contradicts unresolved source-grounding flags"});
  return {status:flags.length?"needs_revision":"needs_human_review",flags,notice:"Conservative checks are not proof of factual accuracy. Review every claim against the cleared note."};
}
export const bundleVersion=(bundle:Artifact[],sourceHash:string)=>hash(JSON.stringify({sourceHash,artifacts:ROLES.map(role=>({role,hash:bundle.find(item=>item.role===role)?.hash}))}));
export function assertBundle(bundle:Artifact[]){
  if(bundle.length!==6||!ROLES.every(role=>bundle.filter(item=>item.role===role).length===1)||bundle.some(item=>typeof item.text!=="string"||!item.text.trim()||hash(item.text)!==item.hash))throw Error("Invalid artifact bundle");
}
