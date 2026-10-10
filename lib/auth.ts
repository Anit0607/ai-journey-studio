import {timingSafeEqual} from "node:crypto";
export function authorized(request:Request,expected=process.env.STUDIO_ACCESS_TOKEN):boolean{
  if(!expected||expected.length<32)return false;
  const received=request.headers.get("authorization")||"";
  const a=Buffer.from(received),b=Buffer.from("Bearer "+expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function allowedOrigin(request:Request,configured=process.env.STUDIO_ORIGIN):boolean{
  if(!configured)return false;
  if(request.headers.get("origin")!==configured)return false;
  try{
    const expected=new URL(configured),actual=new URL(request.url),host=request.headers.get("host");
    if(host&&host!==expected.host)return false;
    if(actual.origin===configured)return true;
    // NextURL rewrites loopback URLs to localhost. Accept only this internal
    // representation, with the original Host and Origin still exact matches.
    return expected.hostname==="127.0.0.1"&&actual.hostname==="localhost"&&
      actual.protocol===expected.protocol&&actual.port===expected.port&&host===expected.host;
  }catch{return false;}
}
export function response(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
