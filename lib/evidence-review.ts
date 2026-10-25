import {taskPlatformPolicy,type PlatformPolicy} from "./platform-policy";
import {randomUUID} from "node:crypto";
import {hasInternalReviewMetadata} from "./platform-variants";
import {assertBundle,bundleQuality,bundleVersion,verifiedSourceEnvelope,commitSummaryLessonReason,SUPPORTED_SENTENCES,type Artifact} from "./grounding";
import {CAPSULE,hash} from "./domain";
import {assertSourcePrivacy} from "./sources";
import {assertArtifactPrivacy} from "./artifact-privacy";
import type {Connection} from "./db";

export const EVIDENCE_POLICY="evidence-review-v3-lossless-spans";
export type Span={start:number;end:number};
export type Finding={category?:'structure';id:string;kind:"wording_review"|"hard";role:string;claim:string;reason:string;artifact_hash:string;span:Span};
export type Decision={id:string;binding:string;finding_id:string;decision:"accept"|"withdraw";policy_version:string;actor:string;reason:string;evidence:{source_span:Span;source_quote:string};context:{source_hash:string;artifact_hash:string;bundle_hash:string;claim_span:Span;claim_text:string;reported_date?:string|null};created?:string};
type EvidenceSource={text:string;hash:string;cleared?:boolean;clearance_id?:string|null;cleared_at?:unknown;revoked_at?:unknown;reported_date?:string};
const plain=(text:string)=>text.trim().replace(/^(?:[-*+>]\s+|#{1,3}\s+)/,'').replace(/\*\*/g,'').replace(/^["“]|["”,]$/g,'').replace(/[.!]$/,'').replace(/\s+/g,' ').toLowerCase();
function spans(text:string):Array<Span&{text:string}>{
 // Keep interior punctuation (decimal times/amounts, paths and URLs) and
 // unpunctuated lines. Every non-whitespace character belongs to an atom;
 // offsets remain slices of the original UTF-16 text, never rewritten text.
 const out:Array<Span&{text:string}>=[];const re=/[^\n]+?(?:[.!?](?=\s|$)|(?=\n|$))/g;let m;
 while((m=re.exec(text))){const lead=m[0].length-m[0].trimStart().length,body=m[0].trim();if(body)out.push({start:m.index+lead,end:m.index+lead+body.length,text:body});}return out;
}
/** Provenance/format hints only, using exactly the sentence boundaries accepted below.
 * Text is already in the prompt: do not duplicate it or permit unbounded index growth.
 */
export function criticReferenceIndex(bundle:Artifact[],source:Pick<EvidenceSource,'text'|'hash'>){
 if(hash(source.text)!==source.hash)throw Error('Source invalidated');
 if(bundle.some(artifact=>hash(artifact.text)!==artifact.hash))throw Error('Artifact integrity check failed');
 const index=(text:string)=>{const sentences=spans(text);return {spans:sentences.slice(0,64).map(({start,end})=>[start,end]),truncated:sentences.length>64};};
 const artifacts=['Writer','Platform Adapter'].map(role=>{
  const matches=bundle.filter(artifact=>artifact.role===role);
  if(matches.length!==1)throw Error('Artifact integrity check failed');
  const artifact=matches[0];return {role,artifact_hash:artifact.hash,...index(artifact.text)};
 });
 return {schema:1,offset_unit:'JavaScript UTF-16',source:{source_hash:source.hash,...index(source.text)},artifacts};
}
/** Versioned, bounded IDs are authoritative only for the current source/artifact hashes.
 * The model selects IDs; it never calculates offsets or supplies a source quotation.
 * Legacy ranges are retained for compatibility, not accepted as v2 model input.
 */
export function criticCitationIndex(bundle:Artifact[],source:Pick<EvidenceSource,'text'|'hash'>){
 const legacy=criticReferenceIndex(bundle,source);
 type Sentence=Span&{id:string;text:string};
 const index={schema:2,policy:'critic-citation-ids-v1',offset_unit:legacy.offset_unit,
  source:{...legacy.source,sentences:[] as Sentence[]},
  artifacts:legacy.artifacts.map(artifact=>({...artifact,sentences:[] as Sentence[]}))};
 const fill=(target:{sentences:Sentence[];truncated:boolean},text:string,prefix:string)=>{
  const all=spans(text);
  for(let n=0;n<Math.min(all.length,64);n++){
   const atom=all[n];
   if(atom.text.length>2000){target.truncated=true;continue;}
   target.sentences.push({...atom,id:prefix+':'+n});
   if(Buffer.byteLength(JSON.stringify(index))>11_800){target.sentences.pop();target.truncated=true;break;}
  }
 };
 fill(index.source,source.text,'source');
 for(const [n,artifact] of index.artifacts.entries())fill(artifact,bundle.find(x=>x.role===artifact.role)!.text,n===0?'writer':'platform');
 return {...index,index_hash:hash(JSON.stringify(index))};
}
function artifactSpans(text:string,role?:string,source?:string,reportedDate?:string):Array<Span&{text:string;raw?:string}>{
 try{JSON.parse(text);}catch{
  if(role&&source){
   if(verifiedSourceEnvelope(text,role,source,reportedDate))return [{start:0,end:text.length,text}];
   // Preserve only independently verified quoted envelopes as atomic metadata.
   const quoted=/"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g;let match;let cursor=0;const parts:Array<Span&{text:string;raw?:string}>=[];
   while((match=quoted.exec(text))){let body=match[0];try{body=JSON.parse(body);}catch{}
    if(!verifiedSourceEnvelope(body,role,source,reportedDate))continue;
    parts.push(...spans(text.slice(cursor,match.index)).map(x=>({...x,start:x.start+cursor,end:x.end+cursor})),{start:match.index,end:quoted.lastIndex,text:body,raw:match[0]});cursor=quoted.lastIndex;
   }
   if(cursor){parts.push(...spans(text.slice(cursor)).map(x=>({...x,start:x.start+cursor,end:x.end+cursor})));return parts;}
  }
   // A numbered Markdown prefix is formatting, not a numerical factual claim.
   // Keep the following text and every embedded number; standalone figures remain claims.
   return spans(text).filter(atom=>!isOrderedListMarker(text,atom));
 }
 const out:Array<Span&{text:string;raw?:string}>=[];const re=/"(?:\\.|[^"\\])*"/g;let match;
 while((match=re.exec(text))){if(/^\s*:/.test(text.slice(re.lastIndex)))continue;out.push({start:match.index,end:re.lastIndex,text:JSON.parse(match[0]),raw:match[0]});}return out;
}
function isOrderedListMarker(text:string,atom:Span&{text:string}):boolean{
 if(!/^\d+\.$/.test(atom.text))return false;
 const lineStart=text.lastIndexOf('\n',atom.start-1)+1;
 return /^[ \t]*$/.test(text.slice(lineStart,atom.start))&&/^[ \t]+\S/.test(text.slice(atom.end));
}
const sourceSentences=(source:string)=>spans(source).map(x=>x.text);
const exact=(claim:string,source:string)=>sourceSentences(source).some(x=>plain(x)===plain(claim));
const factual=(claim:string)=>/\b(?:I|my|Anit|owner|project|dashboard|login|system|agents?|workflow|he|she|they|we|our|it)\b.*\b(?:am|is|are|was|were|has|have|had|use[sd]?|identifies|retain[sd]?|work(?:ing|s)?|focus(?:ed|es)?|learn(?:ed|s)?|found|discovered|achieved|build[sd]?|built|documents?|demonstrates?|highlights?|verified|operational)\b/i.test(claim);
const dangerous=/\b(?:discovered|achieved|earned|increased|improved|successfully|always|guaranteed|reliably|reliable|proven|expert|engineer|years of experience|functioning as intended|fully operational|perfect|my favorite|my family|born in|degree in|worked at)\b|(?:experience|journey) (?:highlights|shows|taught|demonstrates)/i;
function hardReason(claim:string,source:string,role?:string):string|null{
 if(/\b(?:this|the) draft\b.*(?:exact sentences|no added assumptions|no invented|only.*facts)/i.test(claim))return 'Draft self-certification is not source evidence; remove it';
 const figures:string[]=claim.match(/(?:\$\s*)?\b\d+(?:[.,]\d+)?%?/g)||[];const sourceFigures:string[]=source.match(/(?:\$\s*)?\b\d+(?:[.,]\d+)?%?/g)||[];
 if(figures.some(x=>!sourceFigures.includes(x)))return "New figure requires new cleared evidence";
 const extra=claim.match(dangerous);if(extra&&!source.toLowerCase().includes(extra[0].toLowerCase()))return "Added outcome, biography or certainty requires correction or new evidence";
 // Structural labels are not names. Keep the body, original claim and span;
 // every non-entity check above/below still sees the complete original claim.
 const entityText=role==='Strategist'?claim.replace(/^(?:\*\*)?(?:Audience Need|Reader Takeaway):(?:\*\*)?[ \t]*/,''):claim;
 const names=entityText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)||[];
 const singleNames=[...entityText.matchAll(/\b(?:[A-Z][a-z]+|[A-Z][a-z]+[A-Z][A-Za-z]+)\b/g)];
 const firstWord=entityText.search(/[A-Za-z]/);
 if(singleNames.some(match=>{const x=match[0];const connective=match.index===firstWord&&['Following','Subsequently','Upon','If','Is','For'].includes(x);return !connective&&!source.includes(x)&&!['The','This','That','It','As','However','Currently','Proposed','Evidence','Unsupported','Review','Owner','Content','Audience','Approach','Human','Keep','Use','Only','No','All','Source','LinkedIn','Instagram','Writer','Platform','Adapter','Check','My','We','Our','They','He','She'].includes(x);}))return 'New named entity or unsupported capitalized term requires correction';
 if(names.some(x=>!source.includes(x)&&!['Proposed approach','Evidence needed','Unsupported claims','Proposed advice'].includes(x)))return "New named entity requires new cleared evidence";
 // An observed removal does not establish that Studio performed it. This narrow
 // product-action guard is not general actor/semantic verification.
 const studioDeletion=/\b(?:AI Journey Studio|(?:the\s+)?Studio)\b[^.!?\n]*\b(?:delet(?:e|es|ed|ing|ion)|remov(?:e|es|ed|ing|al))\b/i;
 if(studioDeletion.test(claim)&&!sourceSentences(source).some(sentence=>studioDeletion.test(sentence)&&! /\b(?:not|never|cannot|can't|unverified|requests?|requested|asked)\b/i.test(sentence)))return 'Action attribution or product capability is not established by the cleared source';
 {
  const words=(claim.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(x=>!['this','that','with','have','been','currently'].includes(x));
  const best=sourceSentences(source).map(text=>({text,score:words.filter(x=>text.toLowerCase().includes(x)).length})).sort((a,b)=>b.score-a.score)[0];
  if(best&&best.score>=2){const predicates=[/\buse[sd]?\b/i,/\bretain[sd]?\b/i,/\bverifi(?:ed|cation)\b/i,/\bwork(?:ing|ed|s)?\b/i,/\bbuild(?:s|ing)?\b/i];
   const polarity=(x:string,re:RegExp)=>{const hit=re.exec(x);if(!hit)return null;const clause=x.slice(0,hit.index+hit[0].length).split(/\b(?:and|while|but|however)\b|[;,]/i).at(-1)||'';return /\b(?:not|never|no longer|unverified|untested|cannot|can.t|pending|awaiting)\b/i.test(clause);};
   if(predicates.some(re=>polarity(claim,re)!==null&&polarity(best.text,re)!==null&&polarity(claim,re)!==polarity(best.text,re)))return "Possible negation reversal; correct wording before review";
   if(/\b(?:already|will|previously|before|after)\b/i.test(claim)&&!source.toLowerCase().includes((claim.match(/\b(?:already|will|previously|before|after)\b/i)||[''])[0].toLowerCase()))return "Changed timing requires correction or new evidence";
  }
 }
 // Positive assertions can reverse a source's explicit unverified status too.
 if(/\b(?:verified|confirmed|complete[ds]?|operational|working)\b/i.test(claim)&&!/\b(?:not|never|unverified)\b/i.test(claim)){
  const nouns=['collection','generation','publishing'];if(nouns.some(x=>claim.toLowerCase().includes(x))&&sourceSentences(source).some(x=>nouns.some(n=>claim.toLowerCase().includes(n)&&x.toLowerCase().includes(n))&&/not yet verified|unverified/i.test(x)))return "Unverified status changed to a positive result";
 }
 return null;
}
export function evidenceBinding(bundle:Artifact[],source:EvidenceSource,policy?:PlatformPolicy){return hash(JSON.stringify({policy:EVIDENCE_POLICY,source_hash:source.hash,reported_date:source.reported_date||null,clearance:source.clearance_id||"legacy",cleared_at:source.cleared_at?new Date(String(source.cleared_at)).toISOString():null,bundle:bundleVersion(bundle,source.hash),...(policy?{platform_policy:policy}:{})}));}
function finding(role:string,claim:string,reason:string,kind:Finding['kind'],artifact_hash:string,span:Span,category?:Finding['category']):Finding{return {id:hash(JSON.stringify({policy:EVIDENCE_POLICY,role,artifact_hash,span,claim,reason,kind,...(category?{category}:{} )})),role,claim,reason,kind,artifact_hash,span,...(category?{category}:{} )};}
export function evidenceFindings(bundle:Artifact[],source:string,reportedDate?:string,policy?:PlatformPolicy):Finding[]{
 const legacy=bundleQuality(bundle,source,reportedDate,policy),out:Finding[]=[];
 for(const flag of legacy.flags){if(flag.category==='structure'){out.push(finding(flag.role,flag.claim,flag.reason,'hard',bundle.find(x=>x.role===flag.role)?.hash||'',{start:-1,end:-1},'structure'));continue;}if(flag.role==='Critic'&&flag.claim==='Unconditional endorsement')continue;const artifact=bundle.find(x=>x.role===flag.role),start=artifact?.text.indexOf(flag.claim)??-1;
  const atom=artifact&&start>=0?artifactSpans(artifact.text,artifact.role,source,reportedDate).find(x=>x.start<=start&&x.end>=start+flag.claim.length):undefined;
  if(atom&&verifiedSourceEnvelope(atom.text,artifact!.role,source,reportedDate))continue;
  const claim=atom?(atom.raw||atom.text):flag.claim,span=atom?{start:atom.start,end:atom.end}:{start,end:start+flag.claim.length};
  const wording=/Personal claim needs/.test(flag.reason)&&source!==CAPSULE&&!/^Attributed (?:GitHub|YouTube) evidence;/.test(source);
  const hard=hardReason(claim,source,artifact?.role);
  out.push(finding(flag.role,claim,hard||flag.reason,wording&&!hard&&span.start>=0?"wording_review":"hard",artifact?.hash||"",span));
 }
 for(const artifact of bundle.filter(x=>x.role!=="Critic")){
  if(artifact.role==='Writer'&&hasInternalReviewMetadata(artifact.text))out.push(finding(artifact.role,'Internal review notes in public copy','Keep reviewer metadata in internal artifacts; edit public copy','hard',artifact.hash,{start:-1,end:-1}));
  for(const atom of artifactSpans(artifact.text,artifact.role,source,reportedDate)){
   if(verifiedSourceEnvelope(atom.text,artifact.role,source,reportedDate))continue;
   const internal=['Harvester','Story Miner','Strategist'].includes(artifact.role);
   if(internal&&((reportedDate&&(atom.text==='SOURCE DATE: '+reportedDate||atom.text===reportedDate))||atom.text===hash(source)||(atom.text.startsWith('SOURCE: ')&&exact(atom.text.slice(8),source))))continue;
   if(exact(atom.text,source)||(atom.raw&&spans(atom.text).length>0&&spans(atom.text).every(x=>exact(x.text,source)))||(source===CAPSULE&&SUPPORTED_SENTENCES.some(x=>plain(x)===plain(atom.text)))||/^#{1,3} (?:LinkedIn|X|Instagram)$/.test(atom.text)||(!factual(atom.text)&&!(/^(?:Writer|Platform Adapter)$/.test(artifact.role)&&/\b(?:is|are|was|were|has|have|documents?|uses?|publish(?:ed|es)?|delet(?:ed|es)?|remov(?:ed|es)?|supports?|tested)\b/i.test(atom.text))&&!dangerous.test(atom.text)&&! /\d/.test(atom.text)))continue;
   if(out.some(x=>x.role===artifact.role&&x.span.start===atom.start))continue;
   const hard=hardReason(atom.text,source,artifact.role);
   out.push(finding(artifact.role,atom.raw||atom.text,hard||"Compare this wording with exact cleared evidence",hard?"hard":"wording_review",artifact.hash,{start:atom.start,end:atom.end}));
  }
 }
 return out;
}
export function validateEvidence(finding:Finding,source:string,sourceSpan:Span,quote:string){
 if(finding.kind!=="wording_review")throw Error("Only an individual wording finding can be reviewed");
 if(!sourceSpan||!Number.isSafeInteger(sourceSpan.start)||!Number.isSafeInteger(sourceSpan.end)||sourceSpan.start<0||sourceSpan.end<=sourceSpan.start||sourceSpan.end>source.length||sourceSpan.end-sourceSpan.start>2000||typeof quote!=="string"||quote!==source.slice(sourceSpan.start,sourceSpan.end))throw Error("Exact source passage and valid bounds required");
 assertSourcePrivacy(quote);
 const complete=spans(source).filter(x=>x.start>=sourceSpan.start&&x.end<=sourceSpan.end);
 if(quote.trim().length<10||!complete.length||complete[0].start!==sourceSpan.start||complete.at(-1)!.end!==sourceSpan.end)throw Error('Select one or more complete source sentences');
 const disclaimer=/^Attributed (?:GitHub|YouTube) evidence; this record does not establish the owner[’']s experience\./.exec(source)?.[0];
 if(disclaimer&&quote===disclaimer&&finding.claim!==quote)throw Error('An attribution disclaimer cannot substantiate another claim');
 const commitLesson=commitSummaryLessonReason(finding.claim,source);if(commitLesson)throw Error(commitLesson);
 const hard=hardReason(finding.claim,quote,finding.role);if(hard)throw Error(hard);
 // A cited passage must share meaningful words; owner decides meaning, never the checker.
 const words=finding.claim.toLowerCase().match(/[a-z]{4,}/g)||[];
 if(!words.some(x=>quote.toLowerCase().includes(x)))throw Error("Select relevant source evidence");
}
export function evidenceQuality(bundle:Artifact[],source:EvidenceSource,decisions:Decision[]=[],policy?:PlatformPolicy){
 let integrity=true;try{assertBundle(bundle);assertSourcePrivacy(source.text);if(hash(source.text)!==source.hash||source.cleared===false||source.revoked_at)throw Error();for(const x of bundle)assertArtifactPrivacy(x.text);}catch{integrity=false;}
 const binding=evidenceBinding(bundle,source,policy),findings=evidenceFindings(bundle,source.text,source.reported_date,policy),latest=new Map<string,Decision>();
 for(const row of decisions)if(row.binding===binding&&row.policy_version===EVIDENCE_POLICY&&row.actor==='owner')latest.set(row.finding_id,row);
 const accepted:Decision[]=[];
 const resolved=findings.map(item=>{const row=latest.get(item.id);let resolution:Decision|null=null;
  if(integrity&&row?.decision==='accept'&&item.kind==='wording_review'&&row.context?.source_hash===source.hash&&row.context.artifact_hash===item.artifact_hash&&row.context.bundle_hash===bundleVersion(bundle,source.hash)&&row.context.claim_span.start===item.span.start&&row.context.claim_span.end===item.span.end&&row.context.claim_text===item.claim)try{validateEvidence(item,source.text,row.evidence.source_span,row.evidence.source_quote);resolution=row;accepted.push(row);}catch{}
  return {...item,resolution};});
 const flags=resolved.filter(x=>!x.resolution);
 const critic=criticSuggestions(bundle,source);for(const suggestion of critic.suggestions as Array<{verdict:string;role:string;claim:string;artifact_hash:string;start:number;end:number}>){if(suggestion.verdict==='unsupported')flags.push({...finding(suggestion.role,suggestion.claim,'Critic identifies unsupported content; correct it before approval','hard',suggestion.artifact_hash,{start:suggestion.start,end:suggestion.end}),resolution:null});}if(!critic.valid)flags.push({...finding('Critic','Invalid structured evidence review','Structured Critic links or source binding are invalid; correct the Critic artifact','hard',bundle.find(x=>x.role==='Critic')?.hash||'',{start:-1,end:-1}),resolution:null});
 if(!integrity)flags.push({...finding('Source','Integrity or privacy check failed','Current cleared source and intact six-artifact bundle required','hard','',{start:-1,end:-1}),resolution:null});
 return {status:flags.length?'needs_revision':'needs_human_review',flags,findings:resolved,binding,policy_version:EVIDENCE_POLICY,critic,source_text:source.text,source_hash:source.hash,bundle_hash:bundleVersion(bundle,source.hash),evidence_version:accepted.length?hash(accepted.map(x=>x.id).sort().join('|')):null,notice:'Evidence links and owner review are not independent factual verification. Review every claim; publication needs separate approval.'};
}
export async function reviewReadiness(tx:Connection,task:string,bundle:Artifact[],source:EvidenceSource){const rows=await tx.query<Decision>('SELECT * FROM evidence_decisions WHERE task_id=$1 ORDER BY sequence',[task]);const persisted=(await tx.query<{content_brief:Record<string,unknown>}>('SELECT content_brief FROM tasks WHERE id=$1',[task]))[0];if(!persisted)throw Error('Unknown task');return evidenceQuality(bundle,source,rows,taskPlatformPolicy(persisted));}
export async function saveEvidenceDecision(tx:Connection,task:string,bundle:Artifact[],source:EvidenceSource,input:{binding:string;finding_id:string;decision:string;reason:string;source_span:Span;source_quote:string;acknowledged:boolean}){
 const quality=await reviewReadiness(tx,task,bundle,source);
 if(!input||input.binding!==quality.binding)throw Error('Stale evidence review; refresh before saving');
 const item=quality.findings.find(x=>x.id===input.finding_id);if(!item||item.span.start<0||bundle.find(x=>x.role===item.role)?.text.slice(item.span.start,item.span.end)!==item.claim||item.kind!=='wording_review'||input.acknowledged!==true||!['accept','withdraw'].includes(input.decision))throw Error('Individual wording review acknowledgement required');
 if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>600)throw Error('Review reason required (maximum 600 characters)');assertSourcePrivacy(input.reason);
 if(input.decision==='accept')validateEvidence(item,source.text,input.source_span,input.source_quote);
 const existing=item.resolution;if(input.decision==='accept'&&existing)throw Error('This wording already has a current decision');
 if(input.decision==='withdraw'&&!existing)throw Error('No current decision to withdraw');
 const id=randomUUID(),evidence=input.decision==='accept'?{source_span:input.source_span,source_quote:input.source_quote}:existing!.evidence;
 await tx.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,$3,$4,$5,$6,'owner',$7,$8,$9)",[id,task,quality.binding,item.id,input.decision,EVIDENCE_POLICY,input.reason.trim(),JSON.stringify(evidence),JSON.stringify({source_hash:source.hash,artifact_hash:item.artifact_hash,bundle_hash:quality.bundle_hash,claim_span:item.span,claim_text:item.claim,reported_date:source.reported_date||null})]);
 if(input.decision==='withdraw')await tx.query("UPDATE tasks SET status='review',updated=now() WHERE id=$1 AND status='approved'",[task]);
 await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'evidence_review_saved',$3)",[randomUUID(),task,'Individual '+input.decision+' decision '+id+' for '+item.id+'; policy '+EVIDENCE_POLICY+'; content approval remains separate']);return {id};
}

export const CRITIC_CONTRACT=' Return JSON only, without Markdown fences or surrounding prose: {"schema":2,"source_hash":"copy current source_hash","index_hash":"copy current index_hash","Unsupported claims:":"short assessment, never factual certification","Evidence needed:":"short gaps","Proposed advice:":"short proposed approach","evidence":[{"claim_id":"writer:0 or platform:0 from the current index","source_ids":["source:0"],"verdict":"wording_review","reason":"why owner comparison is needed"}]}. Preserve these exact key names, including their trailing colons; do not rename or add fields. Select only server-issued sentence IDs from CURRENT CRITIC EVIDENCE INDEX. Never calculate offsets, invent IDs, copy draft text as source evidence, or reuse a previous revision index. For unsupported claims use verdict="unsupported", source_ids=[], and a concise reason; nonexistent support must not be invented. Never attach source IDs to an unsupported verdict. Reporting that an earlier draft made unsupported claims is not asserting those claims: compare the complete current sentence, attribution and negation against SOURCE. Reasons are critique, never factual evidence. For wording_review select one or more consecutive complete source sentences whose text actually supports the wording; a repository/account metadata line cannot support implementation, results or benefits. At most 8 entries and 600 characters per reason; prioritize uncertain public claims and action attribution. Missing coverage still requires owner review; an empty list is not verification. Do not contradict an unsupported verdict by declaring all claims supported. Fit within the existing 1200 output-token cap; no extra call.';
function citationSuggestions(data:Record<string,unknown>,bundle:Artifact[],source:EvidenceSource){
 const allowed=['schema','source_hash','index_hash','Unsupported claims:','Evidence needed:','Proposed advice:','evidence'];
 if(Object.keys(data).some(key=>!allowed.includes(key))||data.source_hash!==source.hash||!Array.isArray(data.evidence)||data.evidence.length>8||['Unsupported claims:','Evidence needed:','Proposed advice:'].some(key=>typeof data[key]!=='string'||!String(data[key]).trim()||String(data[key]).length>1000))throw Error();
 const index=criticCitationIndex(bundle,source);if(data.index_hash!==index.index_hash)throw Error();
 const seen=new Set<string>();
 const suggestions=data.evidence.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();const x=value as Record<string,unknown>;
  if(Object.keys(x).some(key=>!['claim_id','source_ids','verdict','reason'].includes(key))||typeof x.claim_id!=='string'||seen.has(x.claim_id)||!Array.isArray(x.source_ids)||x.source_ids.length>8||new Set(x.source_ids).size!==x.source_ids.length||typeof x.verdict!=='string'||!['wording_review','unsupported'].includes(x.verdict)||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>600)throw Error();
  seen.add(x.claim_id);assertArtifactPrivacy(x.reason);
  const artifact=index.artifacts.find(a=>a.sentences.some(sentence=>sentence.id===x.claim_id));const claim=artifact?.sentences.find(sentence=>sentence.id===x.claim_id);if(!artifact||!claim)throw Error();
  const base={role:artifact.role,artifact_hash:artifact.artifact_hash,start:claim.start,end:claim.end,claim:claim.text,verdict:x.verdict,reason:x.reason};
  if(x.verdict==='unsupported'){
   // This is a hard correction request, not a wording waiver or a source assertion.
   if(x.source_ids.length)throw Error();return base;
  }
  if(!x.source_ids.length||x.source_ids.some(id=>typeof id!=='string'))throw Error();
  const selected=x.source_ids.map(id=>index.source.sentences.find(sentence=>sentence.id===id));if(selected.some(sentence=>!sentence))throw Error();
  const complete=spans(source.text),positions=selected.map(sentence=>complete.findIndex(atom=>atom.start===sentence!.start&&atom.end===sentence!.end));
  if(positions.some((position,n)=>position<0||(n>0&&position!==positions[n-1]+1)))throw Error();
  const source_start=selected[0]!.start,source_end=selected.at(-1)!.end,source_quote=source.text.slice(source_start,source_end);
  const f=finding(base.role,base.claim,'Critic suggestion','wording_review',base.artifact_hash,{start:base.start,end:base.end});
  validateEvidence(f,source.text,{start:source_start,end:source_end},source_quote);
  return {...base,source_start,source_end,source_quote};
 });
 if(suggestions.some(x=>x.verdict==='unsupported')&&/no unsupported|all (?:claims|statements) (?:are )?(?:supported|align)/i.test(String(data['Unsupported claims:'])))throw Error();
 return {legacy:false,valid:true,suggestions};
}
export function criticSuggestions(bundle:Artifact[],source:EvidenceSource){
 const text=(bundle.find(x=>x.role==='Critic')?.text||'').trim();
 // Accept only a whole-document formatting envelope. Keep stored artifact bytes
 // and hashes unchanged, and run the exact same citation checks on its contents.
 const fenced=/^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(text);
 // Objects anywhere, broken/extra fences, standalone arrays and JSON-shaped
 // inline arrays are not legacy prose. Do not key this distinction on schema
 // spelling: malformed, escaped and unknown keys must also fail closed.
 const structured=!!fenced||/[{}]|```|~~~|(?:^|\n)[ \t]*\[|\[\s*(?:\]|[\[{"]|-?\d|true\b|false\b|null\b)|"(?:schema|source_hash|index_hash|evidence)"\s*:/.test(text);
 if(!structured)return {legacy:true,valid:true,suggestions:[] as unknown[]};
 try{const data=JSON.parse(fenced?fenced[1]:text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();if(data.schema===2)return citationSuggestions(data,bundle,source);if(data.schema!==1||data.source_hash!==source.hash||!Array.isArray(data.evidence)||data.evidence.length>8||['Unsupported claims:','Evidence needed:','Proposed advice:'].some(k=>typeof data[k]!=='string'||!data[k].trim()||data[k].length>1000))throw Error();
  const suggestions=data.evidence.map((x:Record<string,unknown>)=>{const artifact=bundle.find(a=>a.role===x.role&&a.role!=='Critic');if(!artifact||artifact.hash!==x.artifact_hash||!Number.isSafeInteger(x.start)||!Number.isSafeInteger(x.end)||Number(x.start)<0||Number(x.end)<=Number(x.start)||Number(x.end)>artifact.text.length||!['wording_review','unsupported'].includes(String(x.verdict)))throw Error();const claim=artifact.text.slice(Number(x.start),Number(x.end));if(!spans(artifact.text).some(atom=>atom.start===Number(x.start)&&atom.end===Number(x.end)))throw Error();const f=finding(artifact.role,claim,'Critic suggestion','wording_review',artifact.hash,{start:Number(x.start),end:Number(x.end)});validateEvidence(f,source.text,{start:Number(x.source_start),end:Number(x.source_end)},String(x.source_quote));return {...x,claim};});return {legacy:false,valid:true,suggestions};
 }catch{return {legacy:false,valid:false,suggestions:[] as unknown[]};}
}

export async function saveEvidenceApproval(tx:Connection,task:string,token:string,quality:ReturnType<typeof evidenceQuality>){
 const rows=await tx.query<{id:string}>("INSERT INTO evidence_approval_receipts(id,task_id,binding,evidence_version,review_token) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",[randomUUID(),task,quality.binding,quality.evidence_version||"",token]);
 if(rows.length)await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'evidence_bound_content_approval',$3)",[randomUUID(),task,"Approval receipt "+rows[0].id+" bound to "+quality.binding+"; individual evidence version "+(quality.evidence_version||"none")+"; publication remains separate"]);
}
export async function evidenceApprovalCurrent(tx:Connection,task:string,token:string,quality:ReturnType<typeof evidenceQuality>,_stored:string|null|undefined){
 const rows=await tx.query<{binding:string;evidence_version:string;review_token:string}>('SELECT binding,evidence_version,review_token FROM evidence_approval_receipts WHERE task_id=$1',[task]);
 return !quality.flags.length&&rows.some(row=>row.binding===quality.binding&&row.review_token===token&&row.evidence_version===(quality.evidence_version||""));
}
