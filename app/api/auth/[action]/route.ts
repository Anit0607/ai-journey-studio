import {handleOwnerAuth} from "../../../../lib/owner-password";
export const runtime="nodejs",dynamic="force-dynamic";
type Context={params:Promise<{action:string}>};
export async function GET(request:Request,context:Context){return handleOwnerAuth(request,(await context.params).action);}
export async function POST(request:Request,context:Context){return handleOwnerAuth(request,(await context.params).action);}
