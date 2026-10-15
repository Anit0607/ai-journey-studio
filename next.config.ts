import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader:false,
  serverExternalPackages:["pg","@electric-sql/pglite"],
  outputFileTracingIncludes:{"/api/studio/[action]":["./lib/assets/**"]},
  outputFileTracingExcludes:{"/*":["./data/**","./runtime-config.json","./artifacts/**","./tests/**","./scripts/**","./*.py"]},
  async headers(){return [{source:"/(.*)",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Frame-Options",value:"DENY"},{key:"Cache-Control",value:"no-store"}]}];}
};
export default config;
