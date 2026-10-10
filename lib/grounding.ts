import {CAPSULE,ROLES,hash} from "./domain";
export type Artifact={role:string;text:string;hash:string};
export const SUPPORTED_SENTENCES=["I am a non-coder","I build and direct AI agents","I retain final approval","I use Codex and agents for implementation","I learn by doing","I want to share practical agent-building methods and honest lessons"];
export const GROUNDING_RULES="The cleared note establishes only role, approach and intent, not demonstrated discoveries, outcomes, mistakes or tested methods. Personal statements must stay within these exact supported sentences: "+SUPPORTED_SENTENCES.join("; ")+". Never turn wanting to share into having shared. If evidence is insufficient, say Evidence needed and ask for a concrete cleared note. Write for existing ChatGPT/Codex users. Anchor personal stories in specific cleared events and user-documented feelings; ask for missing emotional context, never invent it or replace it with a generic tutorial. Generic suggestions must be labeled Proposed approach, not Anit's lived lesson. Prior artifacts are not independent evidence. Critic must include Unsupported claims:, Evidence needed:, and Proposed advice: sections; quote and flag every unsupported personal experience claim, even if an earlier agent endorsed it. User approval is not factual verification.";
export function bundleQuality(bundle:Artifact[],source:string){
  const flags:{role:string;claim:string;reason:string}[]=[];
  if(source!==CAPSULE)flags.push({role:"Source",claim:"Source changed",reason:"Exact cleared evidence required"});
  for(const artifact of bundle.filter(item=>item.role!=="Critic")){
    for(const line of artifact.text.replace(/\*\*/g,"").split(/(?<=[.!?])\s+|\n/).filter(Boolean)){
      const personal=/\b(?:I\b|I[’'](?:ve|m)|my\b|Anit\b|he\s+(?:found|discovered|learned|shares))/i.test(line);
      const clean=line.trim().replace(/^[#>\-\d/\s]+/,"").replace(/[.!]$/,"");
      const directQuote=clean.length>=10&&source.toLowerCase().includes(clean.toLowerCase());
      // Conservative: the short capsule supports only six personal assertions.
      if(personal&&!directQuote&&!SUPPORTED_SENTENCES.some(sentence=>clean.toLowerCase()===sentence.toLowerCase()))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Personal claim needs specific cleared evidence; use a supported sentence or remove it"});
      if(/discovered|\bfound\b|steady improvement|gradual wins|doesn[’']t require coding|don[’']t need programming|coding is not mandatory|no fluff.*what works|more valuable than.*programming|patience.*pay off/i.test(line))
        flags.push({role:artifact.role,claim:line.slice(0,500),reason:"Discovery, result or categorical advice is not established by this source"});
    }
  }
  const critic=bundle.find(item=>item.role==="Critic")?.text||"";
  if(!["Unsupported claims:","Evidence needed:","Proposed advice:"].every(section=>critic.includes(section)))flags.push({role:"Critic",claim:"Critique format",reason:"Explicit unsupported-claim, evidence and proposed-advice sections required"});
  if(flags.some(item=>item.role!=="Critic")&&/no unsupported|all claims are supported|all variants accurately/i.test(critic))flags.push({role:"Critic",claim:"Unconditional endorsement",reason:"Critic contradicts unresolved source-grounding flags"});
  return {status:flags.length?"needs_revision":"needs_human_review",flags,notice:"Conservative checks are not proof of factual accuracy. Review every claim against the cleared note."};
}
export const bundleVersion=(bundle:Artifact[],sourceHash:string)=>hash(JSON.stringify({sourceHash,artifacts:ROLES.map(role=>({role,hash:bundle.find(item=>item.role===role)?.hash}))}));
export function assertBundle(bundle:Artifact[]){
  if(bundle.length!==6||!ROLES.every(role=>bundle.filter(item=>item.role===role).length===1)||bundle.some(item=>typeof item.text!=="string"||!item.text.trim()||hash(item.text)!==item.hash))throw Error("Invalid artifact bundle");
}
