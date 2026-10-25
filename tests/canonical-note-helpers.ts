import {hash} from '../lib/domain';
import type {Artifact} from '../lib/grounding';
import {canonicalNoteFacts,NOTE_CONTRACTS} from '../lib/note-fact-selection';
export function canonicalNoteArtifacts(source:{text:string;hash:string},tail:Artifact[]=[]):Artifact[]{
 const ids=canonicalNoteFacts(source).map(f=>f.id),selected=ids.slice(0,Math.min(6,ids.length));
 return ['Harvester','Story Miner','Strategist'].map((role,n)=>{
  const text=JSON.stringify({contract:NOTE_CONTRACTS[n],source_binding:'SOURCE HASH: '+source.hash,source_ids:n?selected:ids,...(n?{decision:'selected'}:{}),...(n===2?{opening:'contrast',reader_action:'inspect_steps'}:{})});
  return {role,text,hash:hash(text)};
 }).concat(tail.filter(a=>!['Harvester','Story Miner','Strategist'].includes(a.role)));
}
