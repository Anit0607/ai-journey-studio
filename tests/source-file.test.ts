import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parseSourceFile,MAX_SOURCE_FILE_BYTES,SOURCE_FILE_CATEGORIES,SOURCE_FILE_MAX_TEXT_LENGTH,SOURCE_FILE_MAX_TEXT_BYTES,SOURCE_FILE_MAX_TXT_BYTES,SOURCE_FILE_MAX_JSON_BYTES} from "../lib/source-file";

const bytes=(text:string)=>new TextEncoder().encode(text);
const today="2026-10-11";
const input={text:"I tested a local outline and checked each claim.",category:"project-note",reported_date:"2026-10-10"};
const json=(value:unknown)=>parseSourceFile("source.json",bytes(JSON.stringify(value)),today);

test("TXT preserves exact UTF-8 text, spacing, line endings and Unicode without inventing metadata",()=>{
  const text="  A local note.\r\n\tएक सीख. 😀\n  ";
  const result=parseSourceFile("My note.TXT",bytes(text),today);
  assert.deepEqual(result,{text});
  assert.deepEqual(Object.keys(result),["text"]);
  assert.equal(parseSourceFile("note.txt",bytes("e\u0301")).text,"e\u0301");
});

test("TXT strips only one optional leading UTF-8 BOM and otherwise keeps BOM characters",()=>{
  assert.deepEqual(parseSourceFile("note.txt",bytes("\ufeff"+input.text)),{text:input.text});
  assert.equal(parseSourceFile("note.txt",bytes("\ufeff\ufeff"+input.text)).text,"\ufeff"+input.text);
  assert.equal(parseSourceFile("note.txt",bytes("a\ufeffb")).text,"a\ufeffb");
  assert.throws(()=>parseSourceFile("note.txt",bytes("\ufeff")),/empty/);
});

test("only final TXT and JSON extensions are allowed and content is never interpreted as code",()=>{
  for(const name of ["note.html","note.js","note.jsx","note.json.js","note.txt.html","note","note.txt ","note.csv","note.pdf",""]){
    assert.throws(()=>parseSourceFile(name,bytes(input.text)),/\.txt or \.json/);
  }
  const text='<script>globalThis.sourceFileExecuted = true</script>\nfetch("https://example.test/")';
  assert.deepEqual(parseSourceFile("code.txt",bytes(text)),{text});
  assert.equal(Object.hasOwn(globalThis,"sourceFileExecuted"),false);
  assert.equal(json({...input,text}).text,text);
});

test("zero byte, blank and malformed UTF-8 files fail without replacement decoding",()=>{
  for(const name of ["note.txt","note.json"]){
    assert.throws(()=>parseSourceFile(name,new Uint8Array()),/empty/);
    for(const invalid of [[0xff],[0xc3,0x28],[0xe2,0x82],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xff,0xfe,0x41,0x00]]){
      assert.throws(()=>parseSourceFile(name,new Uint8Array(invalid)),/valid UTF-8/);
    }
  }
  for(const text of [" ","\t\r\n", "\ufeff  "]){assert.throws(()=>parseSourceFile("note.txt",bytes(text)),/empty/);}
  assert.throws(()=>parseSourceFile("note.json",bytes("  \r\n ")),/valid JSON/);
  assert.throws(()=>parseSourceFile("note.txt",null as unknown as Uint8Array),/bytes are invalid/);
});

test("UTF-8 decoding observes the Uint8Array view rather than its whole backing buffer",()=>{
  const data=new Uint8Array([0xff,...bytes(input.text),0xff]);
  assert.deepEqual(parseSourceFile("note.txt",data.subarray(1,-1)),{text:input.text});
});

test("JSON requires exactly the three named string fields and preserves their values",()=>{
  assert.deepEqual(json(input),input);
  const text='  Escaped "quotes", \\ paths,\n\tand Unicode 界 😀.\r\n';
  assert.deepEqual(json({...input,text}),{...input,text});
  assert.deepEqual(parseSourceFile("note.JSON",bytes(" \r\n"+JSON.stringify(input)+"\t "),today),input);
  for(const category of SOURCE_FILE_CATEGORIES)assert.equal(json({...input,category}).category,category);
  for(const field of ["text","category","reported_date"]){
    const missing:Record<string,unknown>={...input};delete missing[field];
    assert.throws(()=>json(missing),/exactly text, category and reported_date/);
    for(const value of [null,0,false,[],{},["note"]])assert.throws(()=>json({...input,[field]:value}),/must all be strings/);
  }
});

test("JSON rejects permission metadata, unknown fields and prototype keys, including escaped keys",()=>{
  for(const field of ["clearance","cleared","consent","role","clearance_id","clearance_provider","clearance_owner_acknowledged","hash","provider","id","__proto__","constructor","prototype","unexpected"]){
    assert.throws(()=>json({...input,[field]:"untrusted"}),/exactly text, category and reported_date/);
  }
  const raw=JSON.stringify(input).slice(0,-1)+',"\\u005f_proto__":{"polluted":true}}';
  assert.throws(()=>parseSourceFile("note.json",bytes(raw),today),/exactly text, category and reported_date/);
  assert.equal(Object.hasOwn(Object.prototype,"polluted"),false);
});

test("JSON rejects duplicate fields instead of silently selecting a last value",()=>{
  for(const earlier of ['"earlier"',"null","42","false","{}",'[]','{"nested":"earlier"}']){
    const raw='{"text":'+earlier+','+JSON.stringify(input).slice(1);
    assert.throws(()=>parseSourceFile("note.json",bytes(raw),today),/exactly once/);
  }
  const escaped='{"\\u0074ext":"earlier",'+JSON.stringify(input).slice(1);
  assert.throws(()=>parseSourceFile("note.json",bytes(escaped),today),/exactly once/);
  for(const field of ["category","reported_date"]){
    const raw=JSON.stringify(input).slice(0,-1)+','+JSON.stringify(field)+':'+JSON.stringify(input[field as keyof typeof input])+'}';
    assert.throws(()=>parseSourceFile("note.json",bytes(raw),today),/exactly once/);
  }
});

test("JSON must be an object with standard JSON syntax",()=>{
  for(const value of [null,[],[input],"note",42,true])assert.throws(()=>json(value),/must be an object/);
  for(const raw of ["{",JSON.stringify(input)+" trailing",JSON.stringify(input)+JSON.stringify(input),'{"text":"note",}',"// comment\n"+JSON.stringify(input),"\ufeff"+JSON.stringify(input),"({text:'note'})"]){
    assert.throws(()=>parseSourceFile("note.json",bytes(raw),today),/valid JSON object/);
  }
});

test("text character and UTF-8 byte limits match source intake and include exact boundaries",()=>{
  assert.equal(SOURCE_FILE_MAX_TEXT_LENGTH,12000);assert.equal(SOURCE_FILE_MAX_TEXT_BYTES,32000);
  assert.equal(SOURCE_FILE_MAX_TXT_BYTES,32003);assert.equal(SOURCE_FILE_MAX_JSON_BYTES,64000);
  assert.equal(MAX_SOURCE_FILE_BYTES,SOURCE_FILE_MAX_JSON_BYTES);
  const maxCharacters="a".repeat(SOURCE_FILE_MAX_TEXT_LENGTH);
  const maxBytes="界".repeat(10666)+"ab";
  for(const text of [maxCharacters,maxBytes]){
    assert.equal(parseSourceFile("note.txt",bytes(text)).text,text);
    assert.equal(json({...input,text}).text,text);
  }
  assert.equal(bytes(maxBytes).length,SOURCE_FILE_MAX_TEXT_BYTES);
  assert.equal(parseSourceFile("note.txt",bytes("\ufeff"+maxBytes)).text,maxBytes);
  for(const text of [maxCharacters+"a","😀".repeat(6001)]){
    assert.throws(()=>parseSourceFile("note.txt",bytes(text)),/12,000 characters/);
    assert.throws(()=>json({...input,text}),/12,000 characters/);
  }
  const overBytes="界".repeat(10667);
  assert.throws(()=>parseSourceFile("note.txt",bytes(overBytes)),/32,000 UTF-8 bytes/);
  assert.throws(()=>json({...input,text:overBytes}),/32,000 UTF-8 bytes/);
  assert.throws(()=>parseSourceFile("note.txt",new Uint8Array(SOURCE_FILE_MAX_TXT_BYTES+1)),/Text file exceeds/);
});

test("the JSON file byte limit applies before parsing even with a small source text",()=>{
  const valid=JSON.stringify(input),atLimit=valid+" ".repeat(SOURCE_FILE_MAX_JSON_BYTES-bytes(valid).length);
  assert.deepEqual(parseSourceFile("note.json",bytes(atLimit),today),input);
  assert.throws(()=>parseSourceFile("note.json",bytes(atLimit+" "),today),/JSON file exceeds 64,000/);
  assert.throws(()=>parseSourceFile("note.json",new Uint8Array(SOURCE_FILE_MAX_JSON_BYTES+1)),/JSON file exceeds 64,000/);
});

test("source text rejects the same controls as intake while allowing tabs and line breaks",()=>{
  const controls=[...Array.from({length:32},(_,n)=>n).filter(n=>![9,10,13].includes(n)),127];
  for(const code of controls){
    const text="before"+String.fromCharCode(code)+"after";
    assert.throws(()=>parseSourceFile("note.txt",bytes(text)),/control characters/);
    assert.throws(()=>json({...input,text}),/control characters/);
  }
  for(const text of ["", " \t\r\n "])assert.throws(()=>json({...input,text}),/empty/);
  assert.equal(json({...input,text:"before\t\r\nafter"}).text,"before\t\r\nafter");
});

test("JSON validates exact allowed categories and actual nonfuture dates",()=>{
  for(const category of ["","Project-note","project-note ","client-notes","private"])assert.throws(()=>json({...input,category}),/Invalid source category/);
  for(const reported_date of ["","2026-02-30","2025-02-29","2026-13-01","2026-00-01","2026-01-00","2026-04-31","2026-1-01","26-01-01","2026-10-11T00:00:00Z","2026-10-11 ","2026-10-12","2099-01-01"])assert.throws(()=>json({...input,reported_date}),/real, nonfuture YYYY-MM-DD/);
  for(const reported_date of ["2024-02-29","2026-10-11"])assert.equal(json({...input,reported_date}).reported_date,reported_date);
  assert.throws(()=>parseSourceFile("note.json",bytes(JSON.stringify(input)),"not-a-date"),/Invalid current date/);
  assert.throws(()=>parseSourceFile("note.json",bytes(JSON.stringify(input)),"2026-02-30"),/Invalid current date/);
});

test("preview parsing does not perform the server privacy decision or invent clearance",()=>{
  const text="Excluded private client notes are still inert preview data.";
  assert.deepEqual(json({...input,text}),{...input,text});
  assert.deepEqual(parseSourceFile("note.txt",bytes(text)),{text});
});

test("the browser parser has no runtime imports, Buffer dependency or external side effects",async()=>{
  const source=await readFile(new URL("../lib/source-file.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/^\s*import\s/m);
  assert.doesNotMatch(source,/\b(?:Buffer|fetch|XMLHttpRequest|WebSocket|eval|Function)\s*[.(]/);
  assert.doesNotMatch(source,/node:|pglite|localStorage|sessionStorage|indexedDB|document\./i);
});
