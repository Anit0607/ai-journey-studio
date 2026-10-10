import fs from "node:fs";
import type {RuntimeConfig} from "./domain";
export function runtimeConfig():RuntimeConfig {
  try{
    // Non-secret local consent/pricing file only. Hosted runtime supplies reviewed config separately.
    const text=process.env.STUDIO_RUNTIME_CONFIG||(process.env.VERCEL?"{}":fs.readFileSync("runtime-config.json","utf8"));
    const value=JSON.parse(text);
    return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  }catch{return {};}
}
