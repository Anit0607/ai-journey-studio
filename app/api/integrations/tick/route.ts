import {handleIntegrationTick} from '../../../../lib/integration-http';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=180;
export const GET=(request:Request)=>handleIntegrationTick(request);
export const POST=GET;
