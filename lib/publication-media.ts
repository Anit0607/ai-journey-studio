import {taskPlatformPolicy,activePlatforms} from "./platform-policy";
import {reviewReadiness,evidenceApprovalCurrent} from "./evidence-review";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {Connection,Database} from "./db";
import {hash,type Source,type Output,type Task} from "./domain";
import {assertNoPendingAgentRevision} from "./agent-revisions";
import {assertBundle,bundleVersion,type Artifact} from "./grounding";
import {platformVariants} from "./platform-variants";
import {ownerSourceEligible} from "./sources";
import {assertArtifactPrivacy} from "./artifact-privacy";

export const MEDIA_RENDERER_VERSION="ai-journey-instagram-text-v1";
export const PUBLIC_MEDIA_ACKNOWLEDGEMENT="I approve making this exact owner-reviewed JPEG publicly accessible at the displayed Vercel Blob origin for Instagram delivery. Anyone with its URL may access or copy it. This public-media consent does not authorize publishing the Instagram post.";
const FONT_HASH="57f73e11f51999432bf7ab22ce55b6f945d5eca1bf824404cfa9ec2e3718c84e";
const FONT_PATH=path.join(process.cwd(),"lib/assets/DejaVuSans.ttf");
const WIDTH=1080,HEIGHT=1350,TEXT_WIDTH=904,TEXT_HEIGHT=950;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
export class MediaValidationError extends Error{}
export function safeMediaError(error:unknown):string|null{return error instanceof MediaValidationError?error.message:null;}
export type MediaArtifact={id:string;task_id:string;source_id:string;source_hash:string;source_clearance_id:string;review_token:string;caption:string;caption_hash:string;renderer_version:string;sha256:string;mime_type:"image/jpeg";width:number;height:number;bytes:Buffer;created?:string|Date};
export type PublicMediaApproval={id:string;artifact_id:string;sha256:string;public_origin:string;source_clearance_id:string;acknowledgement:string;created:string|Date};
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function reference(id:string){if(typeof id!=="string"||!UUID.test(id))throw new MediaValidationError("Invalid media or task identifier");}
function exactHash(value:string){if(typeof value!=="string"||!SHA.test(value))throw new MediaValidationError("Exact media SHA-256 required");}
function xml(text:string){return text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]!);}
function origin(value:string):string{
  let url:URL;try{url=new URL(value);}catch{throw new MediaValidationError("A configured public Vercel Blob origin is required");}
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash||url.pathname!=="/"||!(/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)))throw new MediaValidationError("A configured public Vercel Blob origin is required");
  return url.origin;
}
/** The pinned cmap prevents font fallback/tofu from silently changing owner text. */
function fontSupports(font:Buffer,code:number):boolean{
  if([9,10,13].includes(code))return true;
  const tables=font.readUInt16BE(4);let cmap=0;
  for(let i=0;i<tables;i++){const at=12+i*16;if(font.toString("ascii",at,at+4)==="cmap"){cmap=font.readUInt32BE(at+8);break;}}
  if(!cmap)return false;
  for(let i=0;i<font.readUInt16BE(cmap+2);i++){
    const record=cmap+4+i*8,platform=font.readUInt16BE(record),encoding=font.readUInt16BE(record+2);
    if(platform!==0&&!(platform===3&&(encoding===1||encoding===10)))continue;
    const at=cmap+font.readUInt32BE(record+4),format=font.readUInt16BE(at);
    if(format===12){const groups=font.readUInt32BE(at+12);for(let group=0;group<groups;group++){const start=at+16+group*12,first=font.readUInt32BE(start),last=font.readUInt32BE(start+4);if(code>=first&&code<=last&&font.readUInt32BE(start+8)+(code-first)!==0)return true;}}
    if(format===4&&code<=65535){const segments=font.readUInt16BE(at+6)/2,end=at+14,start=end+segments*2+2,delta=start+segments*2,ranges=delta+segments*2;
      for(let segment=0;segment<segments;segment++)if(code>=font.readUInt16BE(start+segment*2)&&code<=font.readUInt16BE(end+segment*2)){
        const offset=font.readUInt16BE(ranges+segment*2),shift=font.readInt16BE(delta+segment*2);
        if(!offset){if(((code+shift)&65535)!==0)return true;}else{const glyphAt=ranges+segment*2+offset+(code-font.readUInt16BE(start+segment*2))*2;if(glyphAt+2<=font.length){const glyph=font.readUInt16BE(glyphAt);if(glyph&&((glyph+shift)&65535)!==0)return true;}}break;
      }
    }
  }
  return false;
}
async function textLayer(text:string,size:number,color:string,width?:number){
  return sharp({text:{text:`<span foreground="${color}">${xml(text)}</span>`,font:`DejaVu Sans ${size}`,fontfile:FONT_PATH,width,wrap:"word-char",spacing:Math.ceil(size*0.22),rgba:true,dpi:72},limitInputPixels:5_000_000}).png().toBuffer({resolveWithObject:true});
}
/** Deterministic local rasterization of exact approved prose, never image generation or upload. */
export async function renderInstagramCard(caption:string):Promise<{bytes:Buffer;sha256:string;mime_type:"image/jpeg";width:number;height:number}>{
  if(typeof caption!=="string"||!caption.trim()||caption.length>2200||Buffer.byteLength(caption)>8800||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(caption)||(caption.match(/\n/g)||[]).length>40)throw new MediaValidationError("Instagram graphic needs nonempty approved text within 2,200 characters and 40 line breaks");
  assertArtifactPrivacy(caption);
  const font=await readFile(FONT_PATH);if(digest(font)!==FONT_HASH)throw new MediaValidationError("Pinned media font failed verification");
  if([...caption].some(c=>!fontSupports(font,c.codePointAt(0)!)))throw new MediaValidationError("The approved caption contains characters unsupported by the graphic font; revise and approve a supported caption");
  let body:Awaited<ReturnType<typeof textLayer>>|undefined;
  // Bounded sizes keep the complete caption intact. Never truncate or invent a headline.
  const largest=caption.length>1600?34:caption.length>1000?42:caption.length>600?52:64;
  for(let size=largest;size>=26;size-=2){const candidate=await textLayer(caption,size,"#16342e",TEXT_WIDTH);if(candidate.info.height<=TEXT_HEIGHT){body=candidate;break;}}
  if(!body)throw new MediaValidationError("The complete approved caption does not fit legibly in one card; approve a shorter variant");
  const background=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="1080" height="1350" fill="#f5f1e9"/><circle cx="1044" cy="80" r="250" fill="#e8ede2"/><path d="M88 161H992" stroke="#16342e" stroke-opacity=".18" stroke-width="2"/><rect x="88" y="201" width="76" height="8" rx="4" fill="#dc633c"/><path d="M88 1215H992" stroke="#16342e" stroke-opacity=".18" stroke-width="2"/><circle cx="966" cy="1267" r="23" fill="#dc633c"/><path d="M955 1267H977M966 1256V1278" stroke="#f5f1e9" stroke-width="3"/></svg>`);
  const brand=await textLayer("AI JOURNEY",34,"#16342e"),label=await textLayer("BUILD / LEARN / SHARE",18,"#546b60");
  const bytes=await sharp(background,{limitInputPixels:2_000_000}).composite([{input:brand.data,left:88,top:82},{input:body.data,left:88,top:226+Math.floor((TEXT_HEIGHT-body.info.height)/2)},{input:label.data,left:88,top:1257}]).flatten({background:"#f5f1e9"}).jpeg({quality:92,chromaSubsampling:"4:4:4",progressive:false,mozjpeg:false}).toBuffer();
  if(bytes.length>8_000_000)throw new MediaValidationError("Rendered graphic exceeds the JPEG size limit");
  return {bytes,sha256:digest(bytes),mime_type:"image/jpeg",width:WIDTH,height:HEIGHT};
}

type Context={source:Source;caption:string;review_token:string};
async function approvedContext(tx:Connection,taskId:string,reviewToken:string):Promise<Context>{
  reference(taskId);if(typeof reviewToken!=="string"||reviewToken.length>200)throw new MediaValidationError("Exact approved artifact token required");
  const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[taskId]))[0];
  if(!task||task.revision_parent_task_id||task.checkpoint!==6||!["review","approved"].includes(task.status))throw new MediaValidationError("Final content is not ready for media rendering");
  await assertNoPendingAgentRevision(tx,taskId);
  const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[task.source_id]))[0];
  if(!ownerSourceEligible(source,task.source_hash)||!source.clearance_id)throw new MediaValidationError("Current exact owner source clearance is required for media");
  const latest=(await tx.query<{id:string;version:string;bundle:Artifact[]}>("SELECT * FROM content_revisions WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1",[taskId]))[0];
  const bundle=latest?.bundle||await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[taskId]);assertBundle(bundle);
  const version=latest?bundleVersion(bundle,source.hash):hash(bundle.map(item=>item.hash).join("|"));
  const token=latest?`revision:${latest.id}:${version}`:`original:${version}`;
  if(token!==reviewToken||(latest&&latest.version!==version))throw new MediaValidationError("Final content changed; render the newly approved version");
  const approval=latest?(await tx.query<{version:string;evidence_version:string|null}>("SELECT version,evidence_version FROM revision_approvals WHERE revision_id=$1",[latest.id]))[0]:(await tx.query<{version:string;evidence_version:string|null}>("SELECT version,evidence_version FROM approvals WHERE task_id=$1",[taskId]))[0];
  if(approval?.version!==version)throw new MediaValidationError("Approve the exact final content before rendering media");
  const quality=await reviewReadiness(tx,taskId,bundle,source);
  if(quality.editorial.blocking)throw new MediaValidationError("Resolve the saved editorial hold before rendering media");
  if(!await evidenceApprovalCurrent(tx,taskId,reviewToken,quality,approval?.evidence_version))throw new MediaValidationError("Resolve factual review flags before rendering media");
  const platformPolicy=taskPlatformPolicy(task);
  if(!activePlatforms(platformPolicy).includes("Instagram"))throw new MediaValidationError("Instagram is not active for this task");
  const variants=platformVariants(bundle.find(item=>item.role==="Platform Adapter"),platformPolicy),caption=variants.variants.find(item=>item.platform==="Instagram")?.text;
  if(!variants.complete||!caption)throw new MediaValidationError("An approved Instagram variant is required");
  assertArtifactPrivacy(caption);return {source,caption,review_token:reviewToken};
}
function verifiedRow(row:MediaArtifact,context:Context):MediaArtifact{
  if(row.source_id!==context.source.id||row.source_hash!==context.source.hash||row.source_clearance_id!==context.source.clearance_id||row.review_token!==context.review_token||row.caption!==context.caption||row.caption_hash!==hash(context.caption))throw new MediaValidationError("Media provenance changed; render and review a new artifact");
  const bytes=Buffer.from(row.bytes);if(digest(bytes)!==row.sha256||bytes[0]!==0xff||bytes[1]!==0xd8||row.mime_type!=="image/jpeg"||row.width!==WIDTH||row.height!==HEIGHT)throw new MediaValidationError("Stored media failed integrity verification");
  return {...row,bytes};
}
/** Stores only a private artifact. It grants neither public access nor posting consent. */
export async function renderApprovedInstagram(db:Database,taskId:string,reviewToken:string):Promise<MediaArtifact>{
  const initial=await db.transaction(tx=>approvedContext(tx,taskId,reviewToken));
  const existing=(await db.query<MediaArtifact>("SELECT * FROM media_artifacts WHERE task_id=$1 AND review_token=$2 AND source_clearance_id=$3 AND renderer_version=$4",[taskId,reviewToken,initial.source.clearance_id,MEDIA_RENDERER_VERSION]))[0];
  if(existing)return db.transaction(async tx=>verifiedRow(existing,await approvedContext(tx,taskId,reviewToken)));
  const rendered=await renderInstagramCard(initial.caption);
  return db.transaction(async tx=>{
    const current=await approvedContext(tx,taskId,reviewToken);
    if(current.source.clearance_id!==initial.source.clearance_id||current.caption!==initial.caption)throw new MediaValidationError("Source or content changed while rendering; review again");
    await tx.query("INSERT INTO media_artifacts(id,task_id,source_id,source_hash,source_clearance_id,review_token,caption,caption_hash,renderer_version,sha256,mime_type,width,height,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'image/jpeg',$11,$12,$13) ON CONFLICT(task_id,review_token,source_clearance_id,renderer_version) DO NOTHING",[randomUUID(),taskId,current.source.id,current.source.hash,current.source.clearance_id,reviewToken,current.caption,hash(current.caption),MEDIA_RENDERER_VERSION,rendered.sha256,WIDTH,HEIGHT,rendered.bytes]);
    const row=(await tx.query<MediaArtifact>("SELECT * FROM media_artifacts WHERE task_id=$1 AND review_token=$2 AND source_clearance_id=$3 AND renderer_version=$4",[taskId,reviewToken,current.source.clearance_id,MEDIA_RENDERER_VERSION]))[0];
    return verifiedRow(row,current);
  });
}
/** Authenticated owner download only; do not expose bytes in ordinary state JSON. */
export async function getPrivateMedia(db:Database,id:string):Promise<MediaArtifact>{
  reference(id);return db.transaction(async tx=>{const row=(await tx.query<MediaArtifact>("SELECT * FROM media_artifacts WHERE id=$1",[id]))[0];if(!row)throw new MediaValidationError("Unknown media artifact");return verifiedRow(row,await approvedContext(tx,row.task_id,row.review_token));});
}
export async function approvePublicMedia(db:Database,id:string,sha256:string,publicOrigin:string,acknowledged:boolean):Promise<PublicMediaApproval>{
  reference(id);exactHash(sha256);const public_origin=origin(publicOrigin);if(acknowledged!==true)throw new MediaValidationError("Explicit public Vercel Blob media acknowledgement is required");
  return db.transaction(async tx=>{
    const row=(await tx.query<MediaArtifact>("SELECT * FROM media_artifacts WHERE id=$1",[id]))[0];if(!row||row.sha256!==sha256)throw new MediaValidationError("Media changed; review the exact JPEG and hash");
    verifiedRow(row,await approvedContext(tx,row.task_id,row.review_token));
    await tx.query("INSERT INTO media_public_approvals(id,artifact_id,sha256,public_origin,source_clearance_id,acknowledgement) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[randomUUID(),id,sha256,public_origin,row.source_clearance_id,PUBLIC_MEDIA_ACKNOWLEDGEMENT]);
    return (await tx.query<PublicMediaApproval>("SELECT * FROM media_public_approvals WHERE artifact_id=$1 AND sha256=$2 AND public_origin=$3 AND source_clearance_id=$4",[id,sha256,public_origin,row.source_clearance_id]))[0];
  });
}
/** Call only after outbox publication approval and immediately before public upload. */
export async function readApprovedPublicMedia(db:Database,sha256:string,publicOrigin:string,taskId:string,reviewToken:string):Promise<MediaArtifact>{
  exactHash(sha256);reference(taskId);const public_origin=origin(publicOrigin);
  return db.transaction(async tx=>{
    const context=await approvedContext(tx,taskId,reviewToken);
    const rows=await tx.query<MediaArtifact>("SELECT m.* FROM media_artifacts m JOIN media_public_approvals a ON a.artifact_id=m.id AND a.sha256=m.sha256 AND a.source_clearance_id=m.source_clearance_id WHERE m.sha256=$1 AND a.public_origin=$2 AND m.task_id=$3 AND m.review_token=$4 AND m.source_clearance_id=$5 AND a.acknowledgement=$6",[sha256,public_origin,taskId,reviewToken,context.source.clearance_id,PUBLIC_MEDIA_ACKNOWLEDGEMENT]);
    if(rows.length!==1)throw new MediaValidationError("Separate exact public-media consent is required for this origin and current source clearance");
    return verifiedRow(rows[0],context);
  });
}
