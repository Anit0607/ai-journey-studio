import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {allowedOrigin,authorized} from "../lib/auth";
test("real NextRequest loopback normalization preserves exact launcher origin and host",()=>{
  const origin="http://127.0.0.1:3000",token="isolated-owner-token-00000000000000";
  const request=new NextRequest(origin+"/api/studio/source",{method:"POST",headers:{Authorization:"Bearer "+token,Origin:origin,Host:"127.0.0.1:3000","Content-Type":"application/json"},body:"{}"});
  assert.equal(new URL(request.url).hostname,"localhost");
  assert.equal(authorized(request,token),true);
  assert.equal(allowedOrigin(request,origin),true);
  const rejected:Record<string,string>[]=[{Origin:"http://localhost:3000",Host:"127.0.0.1:3000"},{Origin:origin,Host:"evil.test:3000"},{Origin:origin,Host:"localhost:3000"},{Origin:origin,Host:"127.0.0.1:3001"},{Origin:origin}];
  for(const headers of rejected){
    assert.equal(allowedOrigin(new Request("http://localhost:3000/api",{headers}),origin),false);
  }
  assert.equal(allowedOrigin(new Request("http://localhost:3001/api",{headers:{Origin:origin,Host:"127.0.0.1:3000"}}),origin),false);
  assert.equal(allowedOrigin(new Request("https://localhost:3000/api",{headers:{Origin:origin,Host:"127.0.0.1:3000"}}),origin),false);
});
test("a newly generated session token rejects the prior session token",()=>{
  const old="isolated-old-owner-token-00000000000",fresh="isolated-new-owner-token-00000000000";
  const request=new Request("http://isolated.test",{headers:{Authorization:"Bearer "+old}});
  assert.equal(authorized(request,fresh),false);
  assert.equal(authorized(new Request(request,{headers:{Authorization:"Bearer "+fresh}}),fresh),true);
});
