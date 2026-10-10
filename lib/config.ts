import fs from "node:fs";
import type {RuntimeConfig} from "./domain";
export function runtimeConfig(environment:Record<string,string|undefined>=process.env,readLocal=()=>fs.readFileSync("runtime-config.json","utf8")):RuntimeConfig {
  try{
    // Non-secret local consent/pricing file only. Hosted runtime supplies reviewed config separately.
    const text=environment.STUDIO_RUNTIME_CONFIG||(environment.VERCEL?"{}":readLocal());
    const value=JSON.parse(text);
    return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  }catch{return {};}
}
