import {configReady,type RuntimeConfig} from "./domain";

export type HostedEnvironment=Record<string,string|undefined>;

// Detect partial/malformed Vercel configuration too, so it cannot fall back to
// the local session-only authorization path. This is detection, not approval.
export function hostedEnvironment(env:HostedEnvironment=process.env):boolean{
  return ["VERCEL","VERCEL_ENV","VERCEL_URL","VERCEL_TARGET_ENV"].some(name=>env[name]!==undefined);
}

function strongSecret(value:string|undefined):boolean{
  return typeof value==="string"&&/^[\x21-\x7e]{32,}$/.test(value);
}

function exactHttpsOrigin(value:string|undefined):boolean{
  if(!value)return false;
  try{
    const url=new URL(value);
    return url.protocol==="https:"&&!!url.hostname&&!url.username&&!url.password&&url.origin===value;
  }catch{return false;}
}

function networkPostgres(env:HostedEnvironment):boolean{
  if(env.STUDIO_DATABASE_AUTHORIZED!=="1"||env.STUDIO_LOCAL_DB==="1"||!env.DATABASE_URL)return false;
  try{
    const url=new URL(env.DATABASE_URL);
    // pg also accepts a host query parameter, which must not select a Unix socket.
    const hostOverrides=url.searchParams.getAll("host");
    return ["postgres:","postgresql:"].includes(url.protocol)&&!!url.hostname&&
      !/[\s/\\]/.test(decodeURIComponent(url.hostname))&&
      hostOverrides.every(host=>!!host&&!/[\s/\\]/.test(decodeURIComponent(host)));
  }catch{return false;}
}

function ownerBlockers(c:RuntimeConfig,env:HostedEnvironment):string[]{
  const blockers:string[]=[];
  if(env.VERCEL!=="1"||env.VERCEL_ENV!=="production")blockers.push("Vercel production deployment is required");
  if(env.STUDIO_HOSTED_ENABLED!=="1"||c.hosted?.enabled!==true)blockers.push("Hosted runtime is disabled");
  if(c.hosted?.owner_auth_authorized!==true)blockers.push("Hosted owner authentication is not authorized");
  if(!strongSecret(env.STUDIO_ACCESS_TOKEN))blockers.push("A strong hosted owner access token is required");
  if(env.STUDIO_ACCESS_TOKEN&&env.CRON_SECRET&&env.STUDIO_ACCESS_TOKEN===env.CRON_SECRET)blockers.push("Owner and cron credentials must be different");
  if(!exactHttpsOrigin(env.STUDIO_ORIGIN))blockers.push("An exact HTTPS studio origin is required");
  if(!networkPostgres(env))blockers.push("An authorized network PostgreSQL database is required");
  return blockers;
}

// Setup inspection is allowed before model credentials, pricing and cron are
// ready. It still requires the production deployment, owner and database gates.
export function hostedOwnerReady(c:RuntimeConfig,env:HostedEnvironment=process.env):boolean{
  return ownerBlockers(c,env).length===0;
}

// These labels are deliberately static: never return environment values,
// connection strings, credentials, or configuration parser errors to callers.
export function hostedBlockers(c:RuntimeConfig,env:HostedEnvironment=process.env):string[]{
  const blockers=ownerBlockers(c,env);
  if(c.hosted?.persistent_key_authorized!==true)blockers.push("Persistent provider credential use is not authorized");
  if(c.hosted?.fluid_compute_verified!==true)blockers.push("Vercel Fluid Compute has not been verified");
  if(!strongSecret(env.CRON_SECRET))blockers.push("A strong hosted cron secret is required");
  if(c.owner_cleared_sources_authorized!==true)blockers.push("Owner-cleared source authorization is required");
  if(c.fallback_authorized!==undefined&&c.fallback_authorized!==false)blockers.push("Provider fallback must remain disabled for hosted execution");
  if(!configReady(c))blockers.push("Current approved pricing and security configuration is required");
  return blockers;
}

export function hostedReady(c:RuntimeConfig,env:HostedEnvironment=process.env):boolean{
  return hostedBlockers(c,env).length===0;
}

export function hostedCronReady(c:RuntimeConfig,env:HostedEnvironment=process.env):boolean{
  return c.hosted?.cron_authorized===true&&hostedReady(c,env);
}
