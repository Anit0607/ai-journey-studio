import {createAdapterFactory,type AdapterFactory} from "better-auth/adapters";
import type {BetterAuthOptions} from "better-auth";
import type {Connection,Database} from "./db";

const models=new Set(["studio_auth_user","studio_auth_account","studio_auth_session","studio_auth_verification","studio_auth_rate_limit"]);
function identifier(value:string){if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))throw Error("Invalid auth schema field");return '"'+value+'"';}
function table(model:string){if(!models.has(model))throw Error("Unknown auth model");return identifier(model);}
type Predicate={field:string;value:unknown;operator?:string;connector?:string};
function condition(where:Predicate[]|undefined,params:unknown[]){
 if(!where?.length)return "TRUE";
 let result="";
 for(const part of where){
  const field=identifier(part.field),operator=part.operator||"eq";let clause:string;
  if(part.value===null&&["eq","ne"].includes(operator))clause=field+(operator==="eq"?" IS NULL":" IS NOT NULL");
  else if(["in","not_in"].includes(operator)){
   if(!Array.isArray(part.value))throw Error("Invalid auth predicate");
   clause=part.value.length?field+(operator==="in"?" IN (":" NOT IN (")+part.value.map(value=>{params.push(value);return "$"+params.length;}).join(",")+")":operator==="in"?"FALSE":"TRUE";
  }else{
   const sql:Record<string,string>={eq:"=",ne:"<>",gt:">",gte:">=",lt:"<",lte:"<="};if(!sql[operator])throw Error("Unsupported auth predicate");params.push(part.value);clause=field+sql[operator]+"$"+params.length;
  }
  if(part.connector&&!['AND','OR'].includes(part.connector))throw Error("Invalid auth connector");
  result=result?"("+result+" "+(part.connector||"AND")+" "+clause+")":clause;
 }
 return result;
}
/** Better Auth owns auth semantics; this adapter only uses the existing SQL connection. */
export function studioAuthAdapter(db:Connection):AdapterFactory<BetterAuthOptions>{
 return (options:BetterAuthOptions)=>createAdapterFactory({
  config:{adapterId:"studio-sql",adapterName:"Studio PostgreSQL",supportsDates:true,supportsBooleans:true,supportsJSON:false,debugLogs:false,
   transaction:"transaction" in db?async callback=>(db as Database).transaction(tx=>callback(studioAuthAdapter(tx)(options))):false},
  adapter:()=>({
   create:async({model,data})=>{const fields=Object.keys(data),params=Object.values(data);return (await db.query("INSERT INTO "+table(model)+" ("+fields.map(identifier).join(",")+") VALUES ("+fields.map((_field,index)=>"$"+(index+1)).join(",")+") RETURNING *",params))[0] as any;},
   findOne:async({model,where})=>{const params:unknown[]=[];return (await db.query("SELECT * FROM "+table(model)+" WHERE "+condition(where,params)+" LIMIT 1",params))[0] as any||null;},
   findMany:async({model,where,limit,offset,sortBy})=>{const params:unknown[]=[];const order=sortBy?" ORDER BY "+identifier(sortBy.field)+(sortBy.direction==="desc"?" DESC":" ASC"):"";return await db.query("SELECT * FROM "+table(model)+" WHERE "+condition(where,params)+order+" LIMIT "+Math.min(limit||100,1000)+" OFFSET "+Math.max(offset||0,0),params) as any[];},
   count:async({model,where})=>{const params:unknown[]=[];return Number((await db.query<{count:string}>("SELECT COUNT(*) AS count FROM "+table(model)+" WHERE "+condition(where,params),params))[0].count);},
   update:async({model,where,update})=>{if(!where.length)throw Error("Auth update needs a predicate");const fields=Object.keys(update as Record<string,unknown>),params:unknown[]=Object.values(update as Record<string,unknown>);return (await db.query("UPDATE "+table(model)+" SET "+fields.map((field,index)=>identifier(field)+"=$"+(index+1)).join(",")+" WHERE id IN (SELECT id FROM "+table(model)+" WHERE "+condition(where,params)+" LIMIT 1) RETURNING *",params))[0] as any||null;},
   updateMany:async({model,where,update})=>{if(!where.length)throw Error("Auth update needs a predicate");const fields=Object.keys(update as Record<string,unknown>),params:unknown[]=Object.values(update as Record<string,unknown>);return (await db.query("UPDATE "+table(model)+" SET "+fields.map((field,index)=>identifier(field)+"=$"+(index+1)).join(",")+" WHERE "+condition(where,params)+" RETURNING id",params)).length;},
   delete:async({model,where})=>{if(!where.length)throw Error("Auth delete needs a predicate");const params:unknown[]=[];await db.query("DELETE FROM "+table(model)+" WHERE id IN (SELECT id FROM "+table(model)+" WHERE "+condition(where,params)+" LIMIT 1)",params);},
   deleteMany:async({model,where})=>{if(!where?.length)throw Error("Auth delete needs a predicate");const params:unknown[]=[];return (await db.query("DELETE FROM "+table(model)+" WHERE "+condition(where,params)+" RETURNING id",params)).length;},
  }),
 })(options);
}
