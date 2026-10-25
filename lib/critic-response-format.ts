import {type Source,type Task} from './domain';
import type {Artifact} from './grounding';
import {criticCitationIndex} from './evidence-review';
import {attributedProgressNote} from './drafting-contract';
import {canonicalNoteFacts,parseNoteSelection,NOTE_CONTRACTS,NOTE_OPENINGS,NOTE_READER_ACTIONS,assertNotePredecessors} from './note-fact-selection';
/** Trusted workflow metadata, never inferred from source or prompt text. */
type CitationBinding={source_hash:string;index_hash:string;claim_ids:string[];source_ids:string[]};
export type ProviderArtifactContract={artifact:'critic';binding?:CitationBinding}|{artifact:'note';checkpoint:0|1|2;source_hash:string;fact_ids:string[]};
const assessment={type:'string',minLength:1,maxLength:1000};
const evidence=(verdict:'unsupported'|'wording_review')=>({
 type:'object',additionalProperties:false,required:['claim_id','source_ids','verdict','reason'],
 properties:{claim_id:{type:'string'},source_ids:{type:'array',items:{type:'string'},minItems:verdict==='unsupported'?0:1,maxItems:verdict==='unsupported'?0:8},verdict:{type:'string',enum:[verdict]},reason:{type:'string',minLength:1,maxLength:600}}
});
// The live workflow binds current hash/ID enums. Source relevance, contiguous
// citations, privacy and contradictory assessments remain independently checked.
// Official supported subset: https://developers.openai.com/api/docs/guides/structured-outputs
const serialized=JSON.stringify({type:'json_schema',json_schema:{name:'critic_citations_v2',strict:true,schema:{
 type:'object',additionalProperties:false,required:['schema','source_hash','index_hash','Unsupported claims:','Evidence needed:','Proposed advice:','evidence'],
 properties:{schema:{type:'integer',enum:[2]},source_hash:{type:'string'},index_hash:{type:'string'},'Unsupported claims:':assessment,'Evidence needed:':assessment,'Proposed advice:':assessment,evidence:{type:'array',maxItems:8,items:{anyOf:[evidence('wording_review'),evidence('unsupported')]}}}
}}});
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const ids=(v:unknown,re:RegExp,max:number):v is string[]=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(x=>typeof x==='string'&&re.test(x))&&new Set(v).size===v.length;
export function draftArtifactContract(task:Task,source:Source,previous:Artifact[]):ProviderArtifactContract|undefined{
 if(task.checkpoint===5){const index=criticCitationIndex(previous,source);return {artifact:'critic',binding:{source_hash:source.hash,index_hash:index.index_hash,claim_ids:index.artifacts.flatMap(a=>a.sentences.map(s=>s.id)),source_ids:index.source.sentences.map(s=>s.id)}};}
 if(attributedProgressNote(source.text)&&task.checkpoint<=2){
  assertNotePredecessors(task.checkpoint,source,previous);
  const all=canonicalNoteFacts(source).map(f=>f.id),fact_ids=task.checkpoint===2?parseNoteSelection(1,previous.find(a=>a.role==='Story Miner')!.text,source).source_ids:all;
  return {artifact:'note',checkpoint:task.checkpoint as 0|1|2,source_hash:source.hash,fact_ids};
 }
 return undefined;
}
export function providerResponseFormat(provider:string,contract?:ProviderArtifactContract):Record<string,unknown>|undefined{
 if(!contract)return undefined;
 if(!contract||typeof contract!=='object'||Array.isArray(contract))throw Error('Invalid provider artifact contract');
 if(contract.artifact==='note'){
  if(Object.keys(contract).sort().join('|')!=='artifact|checkpoint|fact_ids|source_hash'||![0,1,2].includes(contract.checkpoint)||!sha(contract.source_hash)||!ids(contract.fact_ids,/^fact_[a-z]{1,2}$/,64))throw Error('Invalid provider artifact contract');
  const cp=contract.checkpoint,properties:Record<string,unknown>={contract:{type:'string',enum:[NOTE_CONTRACTS[cp]]},source_binding:{type:'string',enum:['SOURCE HASH: '+contract.source_hash]},source_ids:{type:'array',items:{type:'string',enum:contract.fact_ids},minItems:cp===0?contract.fact_ids.length:0,maxItems:cp===0?contract.fact_ids.length:6}};
  if(cp>0)properties.decision={type:'string',enum:['selected','needs_source']};
  if(cp===2){properties.opening={type:'string',enum:NOTE_OPENINGS};properties.reader_action={type:'string',enum:NOTE_READER_ACTIONS};}
  const maximum={contract:NOTE_CONTRACTS[cp],source_binding:'SOURCE HASH: '+contract.source_hash,source_ids:cp===0?contract.fact_ids:contract.fact_ids.slice(0,6),...(cp>0?{decision:'needs_source'}:{}),...(cp===2?{opening:'concrete_detail',reader_action:'ask_for_demonstration'}:{})};
  if(Buffer.byteLength(JSON.stringify(maximum))>1200)throw Error('Canonical note response bound exceeded');
  if(provider!=='openai')throw Error('Canonical note selection requires OpenAI');
  return {type:'json_schema',json_schema:{name:NOTE_CONTRACTS[cp],strict:true,schema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}}};
 }
 if(contract.artifact!=='critic'||Object.keys(contract).some(k=>!['artifact','binding'].includes(k)))throw Error('Invalid provider artifact contract');
 if('binding' in contract&&!contract.binding)throw Error('Invalid provider artifact contract');
 const format=JSON.parse(serialized);
 if(contract.binding){
  const b=contract.binding;
  if(Object.keys(b).sort().join('|')!=='claim_ids|index_hash|source_hash|source_ids'||!sha(b.source_hash)||!sha(b.index_hash)||!ids(b.claim_ids,/^(?:writer|platform):\d+$/,128)||!ids(b.source_ids,/^source:\d+$/,64))throw Error('Invalid provider artifact contract');
  const props=format.json_schema.schema.properties;props.source_hash.enum=[b.source_hash];props.index_hash.enum=[b.index_hash];
  for(const option of props.evidence.items.anyOf){option.properties.claim_id.enum=b.claim_ids;option.properties.source_ids.items.enum=b.source_ids;}
 }
 return provider==='openai'?format:undefined;
}
/** Same serialized wrapper as transport; counted as bytes plus existing framing
 * allowance, not an asserted exact external token charge. Never lower a cap. */
export function providerResponseFormatBytes(provider:string,contract?:ProviderArtifactContract):number{
 const format=providerResponseFormat(provider,contract);
 return format?Buffer.byteLength(JSON.stringify({response_format:format})):0;
}
