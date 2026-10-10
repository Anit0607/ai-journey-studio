import {timingSafeEqual} from "node:crypto";
export function authorized(request:Request,expected=process.env.STUDIO_ACCESS_TOKEN):boolean{
  if(!expected||expected.length<32)return false;
  const received=request.headers.get("authorization")||"";
  const a=Buffer.from(received),b=Buffer.from("Bearer "+expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function allowedOrigin(request:Request,configured=process.env.STUDIO_ORIGIN):boolean{
  if(!configured)return false;
  return request.headers.get("origin")===configured&&new URL(request.url).origin===configured;
}
export function response(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
