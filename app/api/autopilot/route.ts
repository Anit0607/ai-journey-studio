import {handleAutopilot} from "../../../lib/autopilot-http";
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=300;
export const GET=(request:Request)=>handleAutopilot(request,"scheduler");
export const POST=(request:Request)=>handleAutopilot(request,"assistant");
