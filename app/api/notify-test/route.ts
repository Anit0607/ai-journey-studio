import {handleNotifyTest} from "../../../lib/autopilot-http";
export const runtime='nodejs',dynamic='force-dynamic';
export const POST=(request:Request)=>handleNotifyTest(request);
