// Owner-run offline provisioning only. No HTTP setup route or password arguments.
import {database,postgres,type Database} from "../lib/db";
import {acceptableOwnerPassword,provisionOwner} from "../lib/owner-password";
import {SCHEMA} from "../lib/schema";

let input="",password="",db:Database|undefined,failed=false;
try{
 if(!process.argv.includes("--owner-setup-authorized"))throw Error("Setup approval required");
 const remote=process.argv.includes("--remote");
 if(remote&&!process.argv.includes("--migrate-authorized"))throw Error("Migration approval required");
 // A direct worker invocation must not fall back to an inherited remote URL.
 if(!remote&&(process.env.STUDIO_LOCAL_DB!=="1"||process.env.STUDIO_DATABASE_AUTHORIZED!=="0"||
  ["VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV"].some(name=>process.env[name]!==undefined)))throw Error("Explicit local setup required");
 process.stdin.setEncoding("utf8");
 for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2048)throw Error("Setup input too large");}
 const payload=JSON.parse(input);input="";
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
  Object.keys(payload).some(key=>key!=="password"&&key!=="database_url")||
  !acceptableOwnerPassword(payload.password)||typeof payload.database_url!=="string")throw Error("Invalid setup input");
 password=payload.password;payload.password="";
 if(remote){
  const url=new URL(payload.database_url);payload.database_url="";
  // pg decodes escaped hostnames and supports query overrides and TLS file reads.
  // Accept only literal DNS labels and the two documented Neon query options.
  const neonHost=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+neon\.tech$/i;
  const queryKeys=[...url.searchParams.keys()];
  if(!["postgres:","postgresql:"].includes(url.protocol)||url.hostname.length>253||!neonHost.test(url.hostname)||
   !url.username||!url.password||!url.pathname||url.pathname==="/"||url.hash||
   (url.port!==""&&url.port!=="5432")||
   queryKeys.some(key=>!["sslmode","channel_binding"].includes(key))||new Set(queryKeys).size!==queryKeys.length||
   !["require","verify-full"].includes(url.searchParams.get("sslmode")||"")||
   (url.searchParams.has("channel_binding")&&url.searchParams.get("channel_binding")!=="require"))throw Error("Approved encrypted Neon connection required");
  // Explicit fields prevent pg from filling missing values from inherited aliases.
  url.port="5432";url.searchParams.set("sslmode","verify-full");db=postgres(url.toString());
  await db.transaction(async tx=>{await tx.query(SCHEMA);});
 }else{
  if(payload.database_url!=="")throw Error("Remote input is not allowed in local mode");
  db=await database();
 }
 await provisionOwner(db,password,true);
}catch{failed=true;}finally{
 password="";input="";
 try{await db?.close();}catch{failed=true;}
}
if(failed){console.error("Owner setup failed or an owner already exists. No password or connection details were logged.");process.exitCode=1;}
else{console.log("Approved schema and owner password prepared. Public registration remains disabled.");}
