import {passwordOwnerAuthenticated} from "../../../../lib/owner-password";
import {database} from "../../../../lib/db";
import {response} from "../../../../lib/auth";
import {previewLegacyNormalization,commitLegacyNormalization,parseLegacyNormalizationRequest,LegacyNormalizationError} from "../../../../lib/calendar-legacy-normalization";
export const runtime="nodejs",dynamic="force-dynamic";
function exactOrigin(request:Request){
 const configured=process.env.STUDIO_ORIGIN;
 try{const expected=new URL(configured||""),actual=new URL(request.url),host=request.headers.get("host");return request.headers.get("origin")===configured&&expected.origin===configured&&actual.origin===configured&&(!host||host===expected.host);}catch{return false;}
}
async function body(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new LegacyNormalizationError("Normalization request is required");const chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new LegacyNormalizationError("Normalization request exceeds 4096 bytes");}chunks.push(part.value);}
 return parseLegacyNormalizationRequest(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(request:Request){
 if(request.method!=="POST")return response({error:"Method not allowed"},405);
 if(!await passwordOwnerAuthenticated(request))return response({error:"Live owner cookie required"},401);
 if(!exactOrigin(request))return response({error:"Exact same Origin required"},403);
 try{
  const input=await body(request);if(!input||typeof input!=="object"||Array.isArray(input))throw new LegacyNormalizationError("Invalid normalization request");
  if(input.action==="preview"&&Object.keys(input).length===1)return response({result:await previewLegacyNormalization(await database())});
  if(input.action!=="commit")throw new LegacyNormalizationError("Only exact preview or commit requests are supported");
  const {action,...requestBody}=input;void action;
  return response({result:await commitLegacyNormalization(await database(),requestBody)});
 }catch(error){return response({error:error instanceof LegacyNormalizationError?error.message:"Calendar normalization is unavailable"},error instanceof LegacyNormalizationError?409:503);}
}
