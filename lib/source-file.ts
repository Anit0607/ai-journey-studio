// Browser-only preview parsing. Keep these limits aligned with server source
// intake without importing its database or Node crypto dependencies. Successful
// parsing does not stage a source or grant clearance; server checks still apply.
export const SOURCE_FILE_CATEGORIES=["project-note","build-log","lesson-learned","user-reported-notes"] as const;
export const SOURCE_FILE_MAX_TEXT_LENGTH=12_000;
export const SOURCE_FILE_MAX_TEXT_BYTES=32_000;
export const SOURCE_FILE_MAX_TXT_BYTES=SOURCE_FILE_MAX_TEXT_BYTES+3;
export const SOURCE_FILE_MAX_JSON_BYTES=64_000;
// Largest accepted container, for the UI's guard before File.arrayBuffer().
export const MAX_SOURCE_FILE_BYTES=SOURCE_FILE_MAX_JSON_BYTES;

export type ParsedSourceFile={text:string;category?:string;reported_date?:string};

const FIELDS=["text","category","reported_date"] as const;
const CONTROL_CHARACTERS=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function validateText(text:string):void {
  if(!text.trim())throw Error("Source text must not be empty.");
  if(text.length>SOURCE_FILE_MAX_TEXT_LENGTH)throw Error("Source text exceeds 12,000 characters.");
  if(new TextEncoder().encode(text).byteLength>SOURCE_FILE_MAX_TEXT_BYTES)throw Error("Source text exceeds 32,000 UTF-8 bytes.");
  if(CONTROL_CHARACTERS.test(text))throw Error("Source text contains unsupported control characters.");
}

function validDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}

/** Read local file bytes as inert data. No MIME inference, execution or side effects. */
export function parseSourceFile(name:string,bytes:Uint8Array,today=new Date().toISOString().slice(0,10)):ParsedSourceFile {
  const extension=typeof name==="string"?/\.(txt|json)$/i.exec(name)?.[1].toLowerCase():undefined;
  if(!extension)throw Error("Choose a .txt or .json source file.");
  if(!(bytes instanceof Uint8Array))throw Error("Source file bytes are invalid.");
  if(bytes.byteLength===0)throw Error("Source file must not be empty.");
  const maxBytes=extension==="txt"?SOURCE_FILE_MAX_TXT_BYTES:SOURCE_FILE_MAX_JSON_BYTES;
  if(bytes.byteLength>maxBytes)throw Error(extension==="txt"?"Text file exceeds 32,000 bytes plus an optional UTF-8 BOM.":"JSON file exceeds 64,000 bytes.");

  let contents:string;
  try{
    // Preserve BOMs in the decoder, then remove exactly one at the start of TXT.
    // JSON remains strict JSON; a BOM there is not part of its object syntax.
    contents=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
  }catch{
    throw Error("Source file must contain valid UTF-8 text.");
  }
  if(extension==="txt"){
    const text=contents.startsWith("\ufeff")?contents.slice(1):contents;
    validateText(text);
    return {text};
  }

  let parsed:unknown;
  try{parsed=JSON.parse(contents);}catch{throw Error("Source file must contain a valid JSON object.");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("JSON source must be an object with text, category and reported_date.");
  const value=parsed as Record<string,unknown>;
  if(Object.keys(value).length!==FIELDS.length||!FIELDS.every(field=>Object.hasOwn(value,field)))throw Error("JSON source must contain exactly text, category and reported_date, with no extra fields.");
  if(!FIELDS.every(field=>typeof value[field]==="string"))throw Error("JSON source text, category and reported_date must all be strings.");
  // A flat object containing exactly three string fields has six string tokens.
  // JSON.parse hides duplicate keys; any extra token means a duplicate field was
  // present, even if its earlier value was not a string or its key was escaped.
  if((contents.match(/"(?:\\.|[^"\\])*"/g)||[]).length!==FIELDS.length*2)throw Error("JSON source fields must each appear exactly once.");

  const text=value.text as string,category=value.category as string,reported_date=value.reported_date as string;
  validateText(text);
  if(!SOURCE_FILE_CATEGORIES.includes(category as typeof SOURCE_FILE_CATEGORIES[number]))throw Error("Invalid source category.");
  if(!validDate(today))throw Error("Invalid current date for source validation.");
  if(!validDate(reported_date)||reported_date>today)throw Error("Source date must be a real, nonfuture YYYY-MM-DD date.");
  return {text,category,reported_date};
}
