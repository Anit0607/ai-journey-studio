// Owner-run offline provisioning only. No HTTP setup route or password arguments.
import {database,postgres,type Database} from "../lib/db";
import {provisionOwner} from "../lib/owner-password";
import {SCHEMA} from "../lib/schema";
if(!process.argv.includes("--owner-setup-authorized"))throw Error("Explicit owner setup approval required");
let input="";for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2048)throw Error("Setup input too large");}
let password="",db:Database|undefined;
try{
 const payload=JSON.parse(input);input="";password=payload.password;
 if(process.argv.includes("--remote")){
  if(!process.argv.includes("--migrate-authorized"))throw Error("Migration approval required");
  const url=new URL(payload.database_url);
  if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||url.searchParams.has("host")||!["require","verify-full"].includes(url.searchParams.get("sslmode")||""))throw Error("Approved encrypted Neon connection required");
  // No remote URL is taken from inherited aliases or written to disk.
  url.searchParams.set("sslmode","verify-full");db=postgres(url.toString());payload.database_url="";
  await db.transaction(async tx=>{await tx.query(SCHEMA);});
 }else{db=await database();}
 await provisionOwner(db,password,true);password="";console.log("Approved schema and owner password prepared. Public registration remains disabled.");
}catch{console.error("Owner setup failed or an owner already exists. No password or connection details were logged.");process.exitCode=1;}finally{password="";input="";await db?.close();}
