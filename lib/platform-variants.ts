import {hash} from "./domain";
import type {Artifact} from "./grounding";
export const REQUIRED_PLATFORMS=["LinkedIn","X","Instagram"] as const;
export type Platform=typeof REQUIRED_PLATFORMS[number];
export const PLATFORM_FORMAT="Return exactly three nonempty sections, each beginning with one of these exact headings on its own line, in this order: ### LinkedIn, ### X, ### Instagram. Put only that platform's publishable prose beneath its heading. Reviewer labels Unsupported claims:, Evidence needed:, Proposed advice:, and owner-clearance/source-date footers belong in separate internal artifacts, never these sections. Do not silently trim saved content; contaminated drafts require a fresh reviewed revision. No preamble, extra platform sections, or empty placeholders. These exact headings are the platform schema; a name mentioned in prose is not a variant. Target the implemented standard-post formats: LinkedIn at most 3000 characters, X one standalone post at most 280 weighted characters (URLs count as 23; do not emit a thread or native Article), and Instagram a concise caption suitable for a single readable text card (prefer at most 600 characters, English or Latin-script Hinglish, no emoji). Do not invent a photo or claim media already exists. Longer material needs a separately reviewed shorter platform variant; never silently truncate.";

/** Internal metadata must never be silently included in a publishable variant. */
export function hasInternalReviewMetadata(text:string):boolean{
 return /\b(?:Unsupported claims|Evidence needed|Proposed advice)\s*(?:\*{1,2}|_{1,2})?\s*[:\uFF1A]/i.test(text)||
  /^\s*[*_]*(?:Source:\s*Owner-cleared\b|SOURCE DATE:)/im.test(text);
}

/** Parse separate, explicit sections without modifying historical artifact bytes or hashes.
 * Exact plain/Markdown headings with an optional colon support existing local output.
 * Incidental names, hashtags, prefixes, partial matches and empty sections fail closed.
 */
export function platformVariants(artifact?:Pick<Artifact,"text"|"hash">){
  const missing=(reason:string)=>({complete:false,reason,variants:REQUIRED_PLATFORMS.map(platform=>({platform,text:null as string|null,hash:null as string|null}))});
  if(!artifact)return missing("Platform variants have not been generated");
  if(typeof artifact.text!=="string"||hash(artifact.text)!==artifact.hash)return missing("Platform artifact hash is invalid");
  const sections=new Map<Platform,string>(),lines=artifact.text.replace(/\r\n/g,"\n").split("\n");
  let platform:Platform|null=null,body:string[]=[];
  const flush=()=>{if(platform)sections.set(platform,body.join("\n").trim());body=[];};
  for(const line of lines){
    if(/^\s*(?:`{3,}|~{3,})/.test(line)||/<\/?(?:pre|code)(?:\s|>)/i.test(line))return missing("Code fences cannot define platform sections");
    const match=/^(?:#{1,3} )?(LinkedIn|X|Instagram):?$/.exec(line);
    if(match){
      flush();platform=match[1] as Platform;
      if(sections.has(platform))return missing("Duplicate platform section");
    }else{
      if(!platform&&line.trim())return missing("Use exact platform headings with no preamble");
      // Heading-like alternatives cannot silently become content of another platform.
      if(/^#{1,3}\s/.test(line.trim()))return missing("Unexpected heading in platform schema");
      body.push(line);
    }
  }
  flush();
  if([...sections.values()].some(hasInternalReviewMetadata))return missing("Internal reviewer metadata must remain in internal artifacts; create a clean exact-version revision before approval or publishing");
  const variants=REQUIRED_PLATFORMS.map(name=>{
    const text=sections.get(name)||null;
    const valid=text!==null&&!/^(?:n\/?a|tbd|todo|pending|not generated|\.\.\.)[.!]?$/i.test(text);
    return {platform:name,text:valid?text:null,hash:valid?hash(JSON.stringify({schema:1,platform:name,text})):null};
  });
  const complete=variants.every(variant=>variant.hash!==null);
  return {complete,reason:complete?null:"LinkedIn, X and Instagram each need a separate nonempty draft",variants};
}
