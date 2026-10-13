import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {CAPSULE,configReady,hash,sourceAllowed,type RuntimeConfig,type Source} from "./domain";

export const SOURCE_CATEGORIES=["project-note","build-log","lesson-learned","user-reported-notes"] as const;
export const SOURCE_MAX_LENGTH=12_000;
export const SOURCE_MAX_BYTES=32_000;
export const SOURCE_CLEARANCE_PROVIDER="openai";
export const SOURCE_CLEARANCE_PURPOSE="content-drafts-revisions";
export const SOURCE_CLEARANCE_ACKNOWLEDGEMENT="I am the owner and have reviewed this exact source text and hash. I authorize sending it to OpenAI for content drafts and revisions under the $10 monthly warning and $15 monthly cap. It contains no bank, client, private, confidential, or credential material. This does not authorize Gemini or publishing.";
export type SourceInput={text:string;category:string;reported_date:string};

// This is an intentionally conservative intake guard, not a guarantee that
// arbitrary text is safe. Explicit owner review is still required separately.
const EXCLUDED_MATERIAL=/\b(?:bandhan|banks?|banking|clients?|private|confidential|secrets?|credentials?|passwords?|passcodes?)\b|\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?(?:cookie|token)|authorization)\s*(?:[:=]|\b)|\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{8,}/i;
const CREDENTIAL_ASSIGNMENT=/(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PASSWORD|SECRET|DATABASE_URL|PRIVATE[_-]?KEY)["']?\s*[:=]|[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s@]+@/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256=/^[a-f0-9]{64}$/;

export function validateSourceInput(input:SourceInput,today=new Date()):void {
  if(!input||typeof input.text!=="string"||!input.text.trim()||input.text.length>SOURCE_MAX_LENGTH||Buffer.byteLength(input.text,"utf8")>SOURCE_MAX_BYTES||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text))throw Error("Invalid source text");
  if(!SOURCE_CATEGORIES.includes(input.category as typeof SOURCE_CATEGORIES[number]))throw Error("Invalid source category");
  if(typeof input.reported_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.reported_date))throw Error("Invalid source date");
  const parsed=new Date(input.reported_date+"T00:00:00.000Z");
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==input.reported_date||input.reported_date>today.toISOString().slice(0,10))throw Error("Invalid source date");
  assertSourcePrivacy(input.text);
}

export function assertSourcePrivacy(text:string):void {
  if(typeof text!=="string"||(EXCLUDED_MATERIAL.test(text)||CREDENTIAL_ASSIGNMENT.test(text)))throw Error("Excluded private material");
}

function intact(source:Source|undefined|null,expectedHash?:string):source is Source {
  return !!source&&source.cleared===true&&typeof source.text==="string"&&typeof source.hash==="string"&&SHA256.test(source.hash)&&hash(source.text)===source.hash&&(expectedHash===undefined||source.hash===expectedHash)&&!source.revoked_at;
}
function ownerCleared(source:Source,provider:string,now=new Date()):boolean {
  if(provider!==SOURCE_CLEARANCE_PROVIDER||!source.clearance_id||!UUID.test(source.clearance_id)||source.clearance_hash!==source.hash||source.clearance_provider!==SOURCE_CLEARANCE_PROVIDER||source.clearance_purpose!==SOURCE_CLEARANCE_PURPOSE||source.clearance_owner_acknowledged!==true||source.clearance_acknowledgement!==SOURCE_CLEARANCE_ACKNOWLEDGEMENT||!source.cleared_at||!Number.isFinite(new Date(source.cleared_at).getTime()))return false;
  try{validateSourceInput(source,now);return true;}catch{return false;}
}
function hasOwnerClearance(source:Source):boolean {
  return source.clearance_owner_acknowledged===true||[source.clearance_id,source.clearance_hash,source.clearance_provider,source.clearance_purpose,source.clearance_acknowledgement,source.cleared_at].some(value=>value!==undefined&&value!==null);
}
/** Use only on a persisted source row. Text acceptance or cleared=true alone is insufficient. */
export function sourceEligible(source:Source|undefined|null,expectedHash?:string,provider="openai"):boolean {
  return intact(source,expectedHash)&&(hasOwnerClearance(source)?ownerCleared(source,provider):sourceAllowed(source.text,source.category,source.reported_date));
}
/** Owner-reviewed provenance only; excludes the legacy capsule exception. */
export function ownerSourceEligible(source:Source|undefined|null,expectedHash?:string,provider="openai",now=new Date()):boolean {
  return intact(source,expectedHash)&&ownerCleared(source,provider,now);
}
/** Per-source transmission scope, in addition to the shared credential/pricing/security gates. */
export function sourceAuthorized(config:RuntimeConfig,source:Source|undefined|null,provider="openai",now=new Date()):boolean {
  if(!configReady(config,now)||!intact(source)||!(provider==="openai"||(provider==="gemini"&&config.fallback_authorized===true)))return false;
  if(hasOwnerClearance(source))return config.owner_cleared_sources_authorized===true&&ownerCleared(source,provider,now);
  return config.source_approved===true&&config.approved_source_hash===hash(CAPSULE)&&config.transmission_authorized===true&&sourceAllowed(source.text,source.category,source.reported_date);
}

/** Called only behind the authenticated, same-origin owner API. Never calls a provider. */
export class SourceIntake {
  constructor(readonly db:Database){}
  private async event(tx:Connection,id:string,kind:string,detail:Record<string,unknown>){
    await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,NULL,$2,$3)",[id,kind,JSON.stringify(detail)]);
  }
  async stage(input:SourceInput):Promise<Source> {
    validateSourceInput(input);
    return this.db.transaction(async tx=>{
      const id=randomUUID(),version=hash(input.text);
      const inserted=await tx.query<Source>("INSERT INTO sources(id,text,category,reported_date,cleared,hash) VALUES($1,$2,$3,$4,false,$5) ON CONFLICT(hash) DO NOTHING RETURNING *",[id,input.text,input.category,input.reported_date,version]);
      const source=inserted[0]||(await tx.query<Source>("SELECT * FROM sources WHERE hash=$1 FOR UPDATE",[version]))[0];
      if(!source||source.text!==input.text||source.category!==input.category||source.reported_date!==input.reported_date)throw Error("Source already staged with different metadata");
      if(inserted.length)await this.event(tx,randomUUID(),"source_staged",{source_id:source.id,source_hash:version,category:input.category,reported_date:input.reported_date,actor:"owner",cleared:false});
      return source;
    });
  }
  async clear(id:string,expectedHash:string,ownerAcknowledged:boolean):Promise<Source> {
    if(ownerAcknowledged!==true)throw Error("Explicit owner source acknowledgement required");
    this.reference(id,expectedHash);
    return this.db.transaction(async tx=>{
      const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!source)throw Error("Unknown source");
      if(source.hash!==expectedHash||hash(source.text)!==expectedHash)throw Error("Stale source hash; review the exact source again");
      validateSourceInput(source);
      if(intact(source,expectedHash)&&ownerCleared(source,"openai"))return source;
      const eventId=randomUUID(),clearedAt=new Date().toISOString();
      await this.event(tx,eventId,"source_cleared",{source_id:id,source_hash:expectedHash,provider:SOURCE_CLEARANCE_PROVIDER,purpose:SOURCE_CLEARANCE_PURPOSE,actor:"owner",owner_acknowledged:true,acknowledgement:SOURCE_CLEARANCE_ACKNOWLEDGEMENT,cleared_at:clearedAt});
      return (await tx.query<Source>("UPDATE sources SET cleared=true,clearance_id=$2,clearance_hash=$3,clearance_provider=$4,clearance_purpose=$5,clearance_owner_acknowledged=true,clearance_acknowledgement=$6,cleared_at=$7,revoked_at=NULL WHERE id=$1 RETURNING *",[id,eventId,expectedHash,SOURCE_CLEARANCE_PROVIDER,SOURCE_CLEARANCE_PURPOSE,SOURCE_CLEARANCE_ACKNOWLEDGEMENT,clearedAt]))[0];
    });
  }
  async revoke(id:string,expectedHash:string):Promise<Source> {
    this.reference(id,expectedHash);
    return this.db.transaction(async tx=>{
      const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!source)throw Error("Unknown source");
      if(source.hash!==expectedHash||hash(source.text)!==expectedHash)throw Error("Stale source hash; review the exact source again");
      if(source.cleared===false&&source.revoked_at)return source;
      const revokedAt=new Date().toISOString();
      await this.event(tx,randomUUID(),"source_clearance_revoked",{source_id:id,source_hash:expectedHash,clearance_id:source.clearance_id||null,actor:"owner",revoked_at:revokedAt});
      return (await tx.query<Source>("UPDATE sources SET cleared=false,revoked_at=$2 WHERE id=$1 RETURNING *",[id,revokedAt]))[0];
    });
  }
  private reference(id:string,expectedHash:string){
    if(typeof id!=="string"||!UUID.test(id))throw Error("Invalid source id");
    if(typeof expectedHash!=="string"||!SHA256.test(expectedHash))throw Error("Exact source hash required");
  }
}
