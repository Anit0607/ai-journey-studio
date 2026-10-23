import {ReleaseMigrationError,runReleaseMigration} from "../lib/release-migration";

try{
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=="--vercel-build")||args.length>1)throw new ReleaseMigrationError("Migration 020 blocked: unsupported build-hook arguments.");
  console.log((await runReleaseMigration(process.env,{vercelBuild:args[0]==="--vercel-build"})).message);
}
catch(error){
  console.error(error instanceof ReleaseMigrationError?error.message:"Migration 020 failed; production build stopped. No connection details are logged.");
  // Also bound a failed transport's remaining handles after cleanup timeout.
  process.exit(1);
}
