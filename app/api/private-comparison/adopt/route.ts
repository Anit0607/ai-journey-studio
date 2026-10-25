import {allowedOrigin,response} from '../../../../lib/auth';
import {passwordOwnerAuthenticated} from '../../../../lib/owner-password';
import {database} from '../../../../lib/db';
import {runtimeConfig} from '../../../../lib/config';
import {adoptPrivateComparison,validComparisonAdoption} from '../../../../lib/private-comparison-adoption';
export const runtime='nodejs',dynamic='force-dynamic';
/** Review-only adoption is separate from the paid comparison execution gate. */
export async function POST(request:Request){
 if(!await passwordOwnerAuthenticated(request))return response({error:'Private owner access required'},401);
 if(!allowedOrigin(request))return response({error:'Origin rejected'},403);
 try{
  const reader=request.body?.getReader();if(!reader)return response({error:'Exact comparison and review binding required'},400);
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024){await reader.cancel();return response({error:'Request too large'},413);}chunks.push(value);}
  let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return response({error:'Invalid comparison adoption request'},400);}
  if(!validComparisonAdoption(input))return response({error:'Exact comparison and review binding required'},400);
  return response({result:await adoptPrivateComparison(await database(),input,runtimeConfig())});
 }catch{return response({error:'Comparison adoption not confirmed. Refresh saved revisions and comparison history; no approval or publication was granted.'},409);}
}
