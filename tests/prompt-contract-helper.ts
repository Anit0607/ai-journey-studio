import type {ProviderArtifactContract} from '../lib/critic-response-format';
/** Test-only reconstruction of the exact current index, never a runtime trust path. */
export function criticContractFromPrompt(prompt:string):ProviderArtifactContract{
 const index=JSON.parse(prompt.split('\nCURRENT CRITIC EVIDENCE INDEX (provenance and format only, not factual verification): ')[1]);
 return {artifact:'critic',binding:{source_hash:index.source.source_hash,index_hash:index.index_hash,claim_ids:index.artifacts.flatMap((a:any)=>a.sentences.map((s:any)=>s.id)),source_ids:index.source.sentences.map((s:any)=>s.id)}};
}
