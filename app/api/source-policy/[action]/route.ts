import {handleGithubSourcePolicy} from '../../../../lib/github-source-policy-http';
export const runtime='nodejs',dynamic='force-dynamic';
type Context={params:Promise<{action:string}>};
async function handle(request:Request,context:Context){return handleGithubSourcePolicy(request,(await context.params).action);}
export const GET=handle,POST=handle;
