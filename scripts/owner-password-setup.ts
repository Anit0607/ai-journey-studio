// Owner-run offline provisioning only. No HTTP setup route or password arguments.
import {database} from "../lib/db";
import {provisionOwner} from "../lib/owner-password";
if(!process.argv.includes("--owner-setup-authorized"))throw Error("Explicit owner setup approval required");
let input="";for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2048)throw Error("Setup input too large");}
let password:string;try{password=JSON.parse(input).password;}catch{throw Error("Hidden setup input required");}input="";
const db=await database();try{await provisionOwner(db,password,true);password="";console.log("Owner password set. Public registration remains disabled.");}catch{console.error("Owner setup failed or an owner already exists. No password or connection details were logged.");process.exitCode=1;}finally{password="";await db.close();}
