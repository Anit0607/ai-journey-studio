import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {X_POST_MAX_INPUT_LENGTH,xPostTextValidation} from "../lib/x-text";

test("X app safety cap rejects oversized input before invoking the upstream parser",()=>{
  const output=ts.transpileModule(readFileSync(new URL("../lib/x-text.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  let calls=0;const exports:Record<string,any>={};
  new Function("require","exports",output)((name:string)=>{assert.equal(name,"twitter-text/dist/parseTweet.js");return {__esModule:true,default:()=>{calls++;return {weightedLength:23,valid:true};}};},exports);
  for(const text of ["a.".repeat(20000),"https://example.com/"+"p".repeat(X_POST_MAX_INPUT_LENGTH)])assert.deepEqual(exports.xPostTextValidation(text),{weightedLength:null,valid:false});
  assert.equal(calls,0,"Oversized text must not reach the URL regex");
  exports.xPostTextValidation("a".repeat(X_POST_MAX_INPUT_LENGTH));assert.equal(calls,1);
  const urls="https://example.com/"+"p".repeat(2000)+" https://example.com/"+"p".repeat(X_POST_MAX_INPUT_LENGTH-2041);
  assert.equal(urls.length,X_POST_MAX_INPUT_LENGTH);
  assert.deepEqual(xPostTextValidation(urls),{weightedLength:47,valid:true});
  assert.deepEqual(xPostTextValidation(urls+"p"),{weightedLength:null,valid:false});
});

test("X standard-post ASCII limits use weighted characters, not a larger account tier",()=>{
  for(const length of [279,280,281])assert.deepEqual(xPostTextValidation("a".repeat(length)),{weightedLength:length,valid:length<=280});
});

test("X counts NFC Latin text, CJK and documented one-weight Unicode ranges",()=>{
  for(const text of ["é".repeat(280),"e\u0301".repeat(280)])assert.deepEqual(xPostTextValidation(text),{weightedLength:280,valid:true});
  assert.deepEqual(xPostTextValidation("e\u0301".repeat(281)),{weightedLength:281,valid:false});
  assert.deepEqual(xPostTextValidation("漢".repeat(140)),{weightedLength:280,valid:true});
  assert.deepEqual(xPostTextValidation("漢".repeat(141)),{weightedLength:282,valid:false});
  assert.deepEqual(xPostTextValidation("\u2000\u2010\u2032"),{weightedLength:3,valid:true});
});

test("X emoji sequences count as two, including modern ZWJ and mixed skin tones",()=>{
  for(const emoji of ["👾","🙋🏽","👨‍🎤","👨‍👩‍👧‍👦","🇮🇳","1️⃣","🫱🏽‍🫲🏻","🙂‍↔️","🧑🏽‍🦽‍➡️"]){
    assert.deepEqual(xPostTextValidation(emoji.repeat(140)),{weightedLength:280,valid:true},emoji);
    assert.deepEqual(xPostTextValidation(emoji.repeat(140)+"a"),{weightedLength:281,valid:false},emoji);
  }
});

test("X charges 23 per detected URL, not the URL's literal length",()=>{
  const short="https://x.co",long="https://example.com/"+"a".repeat(900);
  for(const url of [short,long,"example.com/path"]){
    assert.deepEqual(xPostTextValidation(url),{weightedLength:23,valid:true});
    assert.deepEqual(xPostTextValidation("a".repeat(256)+" "+url),{weightedLength:280,valid:true});
    assert.deepEqual(xPostTextValidation("a".repeat(257)+" "+url),{weightedLength:281,valid:false});
  }
  const regression="a".repeat(260)+" "+short;
  assert.equal(regression.length,273);
  assert.deepEqual(xPostTextValidation(regression),{weightedLength:284,valid:false});
  assert.deepEqual(xPostTextValidation("a".repeat(232)+" "+short+" "+long),{weightedLength:280,valid:true});
  assert.deepEqual(xPostTextValidation("a".repeat(233)+" "+short+" "+long),{weightedLength:281,valid:false});
  assert.deepEqual(xPostTextValidation("("+short+"), "+long+"!"),{weightedLength:51,valid:true});
});

test("X rejects empty and upstream-invalid characters without inventing a truncation",()=>{
  assert.deepEqual(xPostTextValidation(""),{weightedLength:0,valid:false});
  for(const invalid of ["\uFFFE","\uFFFF","\uFEFF"])assert.equal(xPostTextValidation("a"+invalid).valid,false);
});
