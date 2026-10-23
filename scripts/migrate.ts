import {postgres} from "../lib/db";
import {SCHEMA} from "../lib/schema";
if(process.env.STUDIO_DATABASE_AUTHORIZED!=="1"||!process.env.DATABASE_URL)throw Error("Explicitly approved database connection required; no service is provisioned");
const db=postgres(process.env.DATABASE_URL);
try{await db.transaction(async tx=>{await tx.query(SCHEMA);});console.log("Schema migrations through version 20 applied");}finally{await db.close();}
