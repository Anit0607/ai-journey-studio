import assert from "node:assert/strict";

/** Ignore checkout line endings only; every other character must still match. */
export function assertSchemaParity(actual:string,expected:string){
  assert.equal(actual.replace(/\r\n/g,"\n"),expected.replace(/\r\n/g,"\n"));
}
