import {allowedOrigin,response} from '../../../lib/auth';
import {passwordOwnerAuthenticated} from '../../../lib/owner-password';
import {database} from '../../../lib/db';
import {runtimeConfig} from '../../../lib/config';
import {liveReady} from '../../../lib/providers';
import {hostedEnvironment,hostedOwnerDraftReady} from '../../../lib/hosted';
import {comparisonSnapshot,runPrivateComparison} from '../../../lib/private-comparison';
import {COMPARISON_SCOPE_HASH,validComparisonRequest} from '../../../lib/private-comparison-policy';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=300;
export async function GET(request:Request){
 if(!await passwordOwnerAuthenticated(request))return response({error:'Private owner access required'},401);
 try{const c=runtimeConfig();return response({...await comparisonSnapshot(await database(),c),execution_ready:process.env.STUDIO_PRIVATE_COMPARISON_SCOPE===COMPARISON_SCOPE_HASH&&liveReady(c)&&(!hostedEnvironment()||hostedOwnerDraftReady(c))});}catch{return response({error:'Comparison unavailable'},503);}
}
export async function POST(request:Request){
 if(!await passwordOwnerAuthenticated(request))return response({error:'Private owner access required'},401);
 if(!allowedOrigin(request))return response({error:'Origin rejected'},403);
 // A release operator must enable this exact reviewed scope. It grants nothing to Calendar or daily execution.
 if(process.env.STUDIO_PRIVATE_COMPARISON_SCOPE!==COMPARISON_SCOPE_HASH)return response({error:'Comparison release gate closed'},403);
 try{
  const reader=request.body?.getReader();let raw='';if(!reader)return response({error:'Exact comparison binding required'},400);
  let bytes=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024){await reader.cancel();return response({error:'Request too large'},413);}chunks.push(value);}
  raw=Buffer.concat(chunks).toString('utf8');let input:unknown;try{input=JSON.parse(raw);}catch{return response({error:'Invalid comparison request'},400);}
  if(!validComparisonRequest(input))return response({error:'Exact comparison binding required'},400);
  const ready=()=>{const c=runtimeConfig();return process.env.STUDIO_PRIVATE_COMPARISON_SCOPE===COMPARISON_SCOPE_HASH&&liveReady(c)&&(!hostedEnvironment()||hostedOwnerDraftReady(c));};
  const result=await runPrivateComparison(await database(),input,{readConfig:runtimeConfig,ready,signal:request.signal});
  return response({result},result.status==='completed_requires_review'?200:409);
 }catch{return response({error:'Comparison outcome unconfirmed. Read its saved history; do not retry.'},409);}
}
