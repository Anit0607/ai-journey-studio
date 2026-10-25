import {hash,type Source} from './domain';
import type {Artifact} from './grounding';
import {attributedProgressNote} from './drafting-contract';
import {sourceEvidenceSpans} from './evidence-review';

export const NOTE_SELECTION_VERSION='canonical-note-v1';
export const NOTE_CONTRACTS=['canonical_note_harvest','canonical_note_selection','canonical_note_plan'] as const;
export const NOTE_OPENINGS=['contrast','question','concrete_detail'] as const;
export const NOTE_READER_ACTIONS=['inspect_steps','compare_options','ask_for_demonstration','ask_for_limits'] as const;
export type CanonicalFact={id:string;start:number;end:number;text:string};
type NoteSource=Pick<Source,'text'|'hash'>;
export type FactSelection={contract:typeof NOTE_CONTRACTS[number];source_binding:string;source_ids:string[];decision?:'selected'|'needs_source';opening?:typeof NOTE_OPENINGS[number];reader_action?:typeof NOTE_READER_ACTIONS[number]};
function alpha(n:number):string{return n<26?String.fromCharCode(97+n):alpha(Math.floor(n/26)-1)+String.fromCharCode(97+n%26);}
export function canonicalNoteFacts(source:NoteSource):CanonicalFact[]{
 if(!attributedProgressNote(source.text)||hash(source.text)!==source.hash)throw Error('Canonical note source invalid');
 const start=source.text.indexOf('## Verified progress\n')+'## Verified progress\n'.length,end=source.text.indexOf('\n## Evidence',start);
 if(end<start)throw Error('Canonical note facts missing');
 const facts=sourceEvidenceSpans(source.text).filter(a=>a.start>=start&&a.end<=end).map((a,n)=>({...a,id:'fact_'+alpha(n)}));
 if(!facts.length||facts.length>64||facts.some(f=>f.text.length>2000)||new Set(facts.map(f=>f.text)).size!==facts.length)throw Error('Canonical note facts ambiguous or too large');
 const harvest={contract:NOTE_CONTRACTS[0],source_binding:'SOURCE HASH: '+source.hash,source_ids:facts.map(f=>f.id)};
 if(Buffer.byteLength(JSON.stringify(harvest))>1200)throw Error('Canonical note response bound exceeded');
 return facts;
}
function parse(text:string):Record<string,unknown>{try{if(Buffer.byteLength(text)>1200)throw Error();const names=[...text.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(m=>JSON.parse(m[1]));if(new Set(names).size!==names.length)throw Error();const v=JSON.parse(text);if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw Error('Invalid canonical note selection');}}
export function parseNoteSelection(checkpoint:0|1|2,text:string,source:NoteSource,previous?:FactSelection):FactSelection{
 const data=parse(text),expected=['contract','source_binding','source_ids',...(checkpoint>0?['decision']:[]),...(checkpoint===2?['opening','reader_action']:[])].sort().join('|');
 if(Object.keys(data).sort().join('|')!==expected||data.contract!==NOTE_CONTRACTS[checkpoint]||data.source_binding!=='SOURCE HASH: '+source.hash||!Array.isArray(data.source_ids)||data.source_ids.some(x=>typeof x!=='string')||new Set(data.source_ids).size!==data.source_ids.length)throw Error('Invalid canonical note selection');
 const allowed=canonicalNoteFacts(source).map(f=>f.id);
 if(data.source_ids.some(x=>!allowed.includes(x)))throw Error('Noncanonical note fact selection');
 if(checkpoint===0){if(data.source_ids.length!==allowed.length)throw Error('Incomplete canonical source index');}
 else{
  if(typeof data.decision!=='string'||!['selected','needs_source'].includes(data.decision)||data.source_ids.length>6||data.decision==='selected'&&data.source_ids.length<2||data.decision==='needs_source'&&data.source_ids.length!==0)throw Error('Invalid canonical note selection');
  if(checkpoint===2&&(!previous||previous.decision!=='selected'||data.source_ids.some(x=>!previous.source_ids.includes(x))))throw Error('Noncanonical note fact selection');
 }
 if(checkpoint===2&&(!NOTE_OPENINGS.includes(data.opening as any)||!NOTE_READER_ACTIONS.includes(data.reader_action as any)))throw Error('Invalid nonfactual editorial choice');
 return data as FactSelection;
}
export function noteStageIssue(checkpoint:number,text:string,source:NoteSource,previous:Artifact[]):string|null{
 if(!attributedProgressNote(source.text)||checkpoint>2)return null;
 try{
  const selected=checkpoint===2?parseNoteSelection(1,previous.find(a=>a.role==='Story Miner')?.text||'',source):undefined;
  const result=parseNoteSelection(checkpoint as 0|1|2,text,source,selected);
  return result.decision==='needs_source'?'Canonical note selection needs source':null;
 }catch{return 'Canonical note contract failed; exact source facts required';}
}
export function assertNotePredecessors(checkpoint:number,source:NoteSource,previous:Artifact[]){
 if(!attributedProgressNote(source.text))return;
 for(let n=0;n<Math.min(checkpoint,3);n++){
  const role=['Harvester','Story Miner','Strategist'][n],artifact=previous.find(a=>a.role===role);
  if(!artifact||hash(artifact.text)!==artifact.hash||noteStageIssue(n,artifact.text,source,previous))throw Error('Canonical note predecessor invalid');
 }
}
export function canonicalFactPacket(source:NoteSource,selection:FactSelection,artifactHash:string){
 const index=canonicalNoteFacts(source);
 return {contract:NOTE_SELECTION_VERSION,source_hash:source.hash,selection_artifact_hash:artifactHash,facts:selection.source_ids.map(id=>index.find(f=>f.id===id)!),...(selection.opening?{opening:selection.opening,reader_action:selection.reader_action}:{}),notice:'Facts are exact server-sliced SOURCE sentences. Selection/order and finite editorial choices are not factual claims. Full SOURCE and its limitations remain authoritative.'};
}
export function notePriorPayload(checkpoint:number,source:NoteSource,previous:Artifact[]){
 assertNotePredecessors(checkpoint,source,previous);
 const role=checkpoint===2?'Story Miner':'Strategist',item=previous.find(a=>a.role===role)!;
 if(checkpoint<2||checkpoint>4)return [];
 const story=parseNoteSelection(1,previous.find(a=>a.role==='Story Miner')!.text,source),selection=checkpoint===2?story:parseNoteSelection(2,item.text,source,story);
 return [{role,canonical_fact_packet:{...canonicalFactPacket(source,selection,item.hash),predecessor_artifacts:previous.filter(a=>['Harvester','Story Miner','Strategist'].includes(a.role)).map(a=>({role:a.role,hash:a.hash}))}},...(checkpoint===4?previous.filter(a=>a.role==='Writer').map(a=>({role:a.role,text:a.text,hash:a.hash})):[])];
}
