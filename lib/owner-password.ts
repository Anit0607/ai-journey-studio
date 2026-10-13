import {betterAuth} from "better-auth";
import {hashPassword} from "better-auth/crypto";
import {studioAuthAdapter} from "./auth-adapter";
import {database,type Database} from "./db";
import {allowedOrigin,response,authorized} from "./auth";
import {hostedEnvironment} from "./hosted";
import {runtimeConfig} from "./config";

export const OWNER_ID="studio-owner",OWNER_EMAIL="owner@studio.local";
type Env=Record<string,string|undefined>;
function settings(env:Env){
 const hosted=hostedEnvironment(env),origin=env.STUDIO_ORIGIN,secret=env.STUDIO_AUTH_SECRET||(!hosted?env.STUDIO_ACCESS_TOKEN:undefined);
 if(!origin||!secret||!/^[\x21-\x7e]{32,}$/.test(secret)||env.STUDIO_PASSWORD_AUTH_ENABLED==="0"||env.CRON_SECRET===secret)throw Error("Owner password setup missing");
 const url=new URL(origin);if(url.origin!==origin||url.username||url.password|| (hosted&&url.protocol!=="https:")||(!hosted&&!['127.0.0.1','localhost'].includes(url.hostname)))throw Error("Owner password setup missing");
 if(hosted&&(env.VERCEL!=="1"||env.VERCEL_ENV!=="production"||env.STUDIO_DATABASE_AUTHORIZED!=="1"||env.STUDIO_LOCAL_DB==="1"||!env.DATABASE_URL))throw Error("Owner password setup missing");
 return {origin,secret,hosted};
}
export function createOwnerAuth(db:Database,env:Env){
 const configured=settings(env);
 return betterAuth({
  baseURL:configured.origin,basePath:"/api/auth",secret:configured.secret,trustedOrigins:[configured.origin],database:studioAuthAdapter(db),
  emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:10,maxPasswordLength:128,autoSignIn:false},
  user:{modelName:"studio_auth_user"},account:{modelName:"studio_auth_account",accountLinking:{enabled:false}},
  session:{modelName:"studio_auth_session",expiresIn:8*3600,updateAge:3600,cookieCache:{enabled:false}},
  verification:{modelName:"studio_auth_verification"},
  rateLimit:{enabled:true,storage:"database",modelName:"studio_auth_rate_limit",window:60,max:60,customRules:{"/sign-in/email":{window:900,max:5},"/get-session":false}},
  advanced:{useSecureCookies:configured.hosted||configured.origin.startsWith("https:"),defaultCookieAttributes:{httpOnly:true,sameSite:"strict",path:"/"}},
  logger:{disabled:true},
 });
}
export function acceptableOwnerPassword(value:unknown):value is string{
 return typeof value==="string"&&value.length<=128&&(/^[0-9]{10}$/.test(value)||(value.length>=12&&/[^0-9]/.test(value)))&&!/[\u0000-\u001f\u007f]/.test(value);
}
/** Offline owner action only; never mounted as a public setup endpoint. */
export async function provisionOwner(db:Database,password:string,authorizedSetup:boolean){
 if(authorizedSetup!==true)throw Error("Owner setup action-time authorization required");
 if(!acceptableOwnerPassword(password))throw Error("Choose exactly ten digits or a longer password of at least twelve characters");
 const encoded=await hashPassword(password);
 await db.transaction(async tx=>{
  await tx.query("SELECT id FROM studio_owner_login_guard WHERE id=1 FOR UPDATE");
  if((await tx.query("SELECT id FROM studio_auth_user")).length)throw Error("Owner already exists; no overwrite");
  await tx.query('INSERT INTO studio_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Owner\',$2,true,now(),now())',[OWNER_ID,OWNER_EMAIL]);
  await tx.query('INSERT INTO studio_auth_account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',["studio-owner-credential",OWNER_ID,encoded]);
 });
}
/** Global account-wide counter, atomically consumed before expensive hashing. */
export async function consumeOwnerLogin(db:Database,now=new Date()){
 return db.transaction(async tx=>{
  const row=(await tx.query<{attempts:number;window_started:Date}>("SELECT attempts,window_started FROM studio_owner_login_guard WHERE id=1 FOR UPDATE"))[0];if(!row)throw Error("Owner setup missing");
  const age=now.getTime()-new Date(row.window_started).getTime();
  if(age>=900000){await tx.query("UPDATE studio_owner_login_guard SET attempts=1,window_started=$1 WHERE id=1",[now]);return {allowed:true,retryAfter:0};}
  if(row.attempts>=5)return {allowed:false,retryAfter:Math.max(1,Math.ceil((900000-age)/1000))};
  await tx.query("UPDATE studio_owner_login_guard SET attempts=attempts+1 WHERE id=1");return {allowed:true,retryAfter:0};
 });
}
export async function ownerExists(db:Database){return (await db.query("SELECT u.id FROM studio_auth_user u JOIN studio_auth_account a ON a.\"userId\"=u.id WHERE u.id=$1 AND a.\"providerId\"='credential' AND a.\"accountId\"=u.id",[OWNER_ID])).length===1;}
function targetMatches(request:Request,origin:string){
 try{const expected=new URL(origin),actual=new URL(request.url),host=request.headers.get("host");return (!host||host===expected.host)&&(actual.origin===origin||(expected.hostname==="127.0.0.1"&&actual.hostname==="localhost"&&actual.protocol===expected.protocol&&actual.port===expected.port&&host===expected.host));}catch{return false;}
}
export async function passwordOwnerAuthenticated(request:Request,env:Env=process.env,dbProvider=database){
 try{const configured=settings(env);if(!targetMatches(request,configured.origin))return false;if(configured.hosted&&runtimeConfig().hosted?.owner_auth_authorized!==true)return false;const db=await dbProvider();if(configured.hosted&&db.kind!=="postgres")return false;if(!await ownerExists(db))return false;const session=await createOwnerAuth(db,env).api.getSession({headers:request.headers});return session?.user.id===OWNER_ID;}catch{return false;}
}
export async function ownerApiAuthenticated(request:Request){
 // Legacy machine credential remains laptop-only. Browser login uses cookies.
 if(!hostedEnvironment()&&authorized(request))return true;
 return passwordOwnerAuthenticated(request);
}
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)throw Error("Missing password request");const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw Error("Oversize password request");}chunks.push(value);}return Buffer.concat(chunks).toString("utf8");
}
function internalHeaders(request:Request){const headers=new Headers(request.headers);headers.delete("content-length");headers.delete("authorization");headers.set("Content-Type","application/json");return headers;}
export async function handleOwnerAuth(request:Request,action:string,env:Env=process.env,dbProvider=database){
 if(!["status","login","logout"].includes(action))return response({error:"Unknown authentication action"},404);
 if(action==="status"&&request.method!=="GET"||action!=="status"&&request.method!=="POST")return response({error:"Method not allowed"},405);
 if(action!=="status"&&!allowedOrigin(request,env.STUDIO_ORIGIN))return response({error:"Origin rejected"},403);
 try{
  const configured=settings(env);if(!targetMatches(request,configured.origin))return response({error:"Origin rejected"},403);
  if(configured.hosted&&runtimeConfig().hosted?.owner_auth_authorized!==true)throw Error("Owner auth authorization missing");
  const db=await dbProvider();if(configured.hosted&&db.kind!=="postgres")throw Error("Hosted PostgreSQL required");if(!await ownerExists(db))return response({mode:configured.hosted?"hosted":"local",setup_required:true,authenticated:false,error:"Owner password setup missing. No public registration is available."},503);
  const auth=createOwnerAuth(db,env);
  if(action==="status")return response({setup_required:false,authenticated:await passwordOwnerAuthenticated(request,env,async()=>db),mode:configured.hosted?"hosted":"local"});
  if(action==="login"){
   const limit=await consumeOwnerLogin(db);if(!limit.allowed)return new Response(JSON.stringify({error:"Too many attempts. Try again later."}),{status:429,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Retry-After":String(limit.retryAfter)}});
   if(Number(request.headers.get("content-length")||0)>2048)return response({error:"Invalid password request"},400);
   let input:any;try{input=JSON.parse(await boundedBody(request));}catch{return response({error:"Invalid password request"},400);}
   if(!input||Object.keys(input).length!==1||!acceptableOwnerPassword(input.password))return response({error:"Invalid password or password format"},401);
   const internal=new Request(configured.origin+"/api/auth/sign-in/email",{method:"POST",headers:internalHeaders(request),body:JSON.stringify({email:OWNER_EMAIL,password:input.password,rememberMe:true})});
   const result=await auth.handler(internal);const headers=new Headers(result.headers);headers.delete("content-length");headers.delete("set-auth-token");headers.set("Cache-Control","no-store");headers.set("Content-Type","application/json");
   // Do not return the library's bearer token or account metadata to browser JS.
   return new Response(JSON.stringify(result.ok?{authenticated:true}:{error:"Invalid password or login temporarily unavailable"}),{status:result.status,headers});
  }
  const result=await auth.handler(new Request(configured.origin+"/api/auth/sign-out",{method:"POST",headers:internalHeaders(request),body:"{}"}));const headers=new Headers(result.headers);headers.set("Cache-Control","no-store");return new Response(JSON.stringify({authenticated:false}),{status:result.status,headers});
 }catch{return response({mode:hostedEnvironment(env)?"hosted":"local",setup_required:true,authenticated:false,error:"Password login unavailable. Approved database and owner setup are required."},503);}
}
