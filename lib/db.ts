import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import path from "node:path";
import { SCHEMA } from "./schema";
export interface Connection {
  query<T=Record<string,any>>(sql:string,params?:unknown[]):Promise<T[]>;
}
export interface Database extends Connection {
  transaction<T>(work:(tx:Connection)=>Promise<T>):Promise<T>;
  close():Promise<void>;
  kind:"postgres"|"pglite";
}
export async function embedded(location?:string):Promise<Database>{
  const instance=new PGlite(location);
  await instance.exec(SCHEMA);
  return {
    kind:"pglite",
    async query<T>(sql:string,params:unknown[]=[]){return (await instance.query<T>(sql,params)).rows;},
    transaction:work=>instance.transaction(async tx=>work({async query<T>(sql:string,params:unknown[]=[]){return (await tx.query<T>(sql,params)).rows;}})),
    close:()=>instance.close()
  };
}
export function postgres(url:string):Database{
  const pool=new Pool({connectionString:url,max:5,connectionTimeoutMillis:5000});
  const connection=(client:Pool|PoolClient):Connection=>({async query<T>(sql:string,params:unknown[]=[]){return (await client.query(sql,params)).rows as T[];}});
  return {
    kind:"postgres",...connection(pool),
    async transaction(work){
      const client=await pool.connect();
      try{await client.query("BEGIN");const result=await work(connection(client));await client.query("COMMIT");return result;}
      catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    },
    close:()=>pool.end()
  };
}
const globalDb=globalThis as typeof globalThis & {studioDb?:Promise<Database>};
export function connectionMode(env:Record<string,string|undefined>){
  if(env.STUDIO_LOCAL_DB==="1"&&!env.VERCEL)return "pglite";
  if(env.STUDIO_DATABASE_AUTHORIZED==="1"&&env.DATABASE_URL)return "postgres";
  return null;
}
export function database():Promise<Database>{
  if(!globalDb.studioDb){
    const mode=connectionMode(process.env);
    if(mode==="pglite")globalDb.studioDb=embedded(path.resolve(/* turbopackIgnore: true */ process.env.STUDIO_LOCAL_PATH||"data/web-postgres"));
    else if(mode==="postgres")globalDb.studioDb=Promise.resolve(postgres(process.env.DATABASE_URL!));
    else return Promise.reject(Error("Database not configured"));
  }
  return globalDb.studioDb;
}
