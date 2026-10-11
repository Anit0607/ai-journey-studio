import test from "node:test";
import assert from "node:assert/strict";
import {assertSchemaParity} from "./schema-parity";

test("schema parity tolerates CRLF only and rejects substantive or whitespace drift",()=>{
  const expected="ALTER TABLE sources ADD COLUMN cleared BOOLEAN DEFAULT false;\n";
  assertSchemaParity(expected.replace(/\n/g,"\r\n"),expected);
  for(const changed of [expected.replace("false","true"),expected.replace("BOOLEAN","TEXT"),expected.replace(" sources ","  sources "),expected.trimEnd(),expected.replace(/\n/g,"\r")]){
    assert.throws(()=>assertSchemaParity(changed,expected),assert.AssertionError);
  }
});
