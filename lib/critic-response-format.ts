/** Trusted workflow metadata, never inferred from source or prompt text. */
export type ProviderArtifactContract={artifact:'critic'};
const assessment={type:'string',minLength:1,maxLength:1000};
const evidence=(verdict:'unsupported'|'wording_review')=>({
 type:'object',additionalProperties:false,required:['claim_id','source_ids','verdict','reason'],
 properties:{claim_id:{type:'string'},source_ids:{type:'array',items:{type:'string'},minItems:verdict==='unsupported'?0:1,maxItems:verdict==='unsupported'?0:8},verdict:{type:'string',enum:[verdict]},reason:{type:'string',minLength:1,maxLength:600}}
});
// Static shape only. Current hashes, citation IDs, source relevance, privacy and
// contradictory assessments remain independently checked by evidence-review.
// Official supported subset: https://developers.openai.com/api/docs/guides/structured-outputs
const serialized=JSON.stringify({type:'json_schema',json_schema:{name:'critic_citations_v2',strict:true,schema:{
 type:'object',additionalProperties:false,required:['schema','source_hash','index_hash','Unsupported claims:','Evidence needed:','Proposed advice:','evidence'],
 properties:{schema:{type:'integer',enum:[2]},source_hash:{type:'string'},index_hash:{type:'string'},'Unsupported claims:':assessment,'Evidence needed:':assessment,'Proposed advice:':assessment,evidence:{type:'array',maxItems:8,items:{anyOf:[evidence('wording_review'),evidence('unsupported')]}}}
}}});
export function providerResponseFormat(provider:string,contract?:ProviderArtifactContract):Record<string,unknown>|undefined{
 if(contract&&(typeof contract!=='object'||Object.keys(contract).length!==1||contract.artifact!=='critic'))throw Error('Invalid provider artifact contract');
 return provider==='openai'&&contract?.artifact==='critic'?JSON.parse(serialized):undefined;
}
/** Same serialized wrapper as transport; counted as bytes plus existing framing
 * allowance, not an asserted exact external token charge. Never lower a cap. */
export function providerResponseFormatBytes(provider:string,contract?:ProviderArtifactContract):number{
 const format=providerResponseFormat(provider,contract);
 return format?Buffer.byteLength(JSON.stringify({response_format:format})):0;
}
