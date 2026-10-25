import {runAssistantWordingReleaseMigration} from '../lib/assistant-wording-release-migration';
import {runSchedulerWindowReleaseMigration} from '../lib/scheduler-window-release-migration';
import {runGithubSourceReleaseMigration} from "../lib/github-source-release-migration";
import {ReleaseMigrationError,runReleaseMigration} from "../lib/release-migration";

try{
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=="--vercel-build")||args.length>1)throw new ReleaseMigrationError("Migrations 020/021/022/023 blocked: unsupported build-hook arguments.");
  console.log((await runReleaseMigration(process.env,{vercelBuild:args[0]==="--vercel-build"})).message);
  console.log((await runGithubSourceReleaseMigration(process.env,{vercelBuild:args[0]==="--vercel-build"})).message);
  console.log((await runSchedulerWindowReleaseMigration(process.env,{vercelBuild:args[0]==="--vercel-build"})).message);
  console.log((await runAssistantWordingReleaseMigration(process.env,{vercelBuild:args[0]==="--vercel-build"})).message);
}
catch(error){
  console.error(error instanceof ReleaseMigrationError?error.message:"Migrations 020/021/022/023 failed; production build stopped. No connection details are logged.");
  // Also bound a failed transport's remaining handles after cleanup timeout.
  process.exit(1);
}
