import {handleIntegrationOAuth} from '../../../../../lib/integration-oauth';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=60;
type Context={params:Promise<{provider:string;action:string}>};
async function handle(request:Request,context:Context){const {provider,action}=await context.params;return handleIntegrationOAuth(request,provider,action);}
export const GET=handle,POST=handle;
