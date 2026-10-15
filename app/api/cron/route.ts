import {handleHostedCron} from "../../../lib/hosted-http";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=300;
export async function GET(request:Request){return handleHostedCron(request);}

export async function POST(request:Request){return handleHostedCron(request);}
