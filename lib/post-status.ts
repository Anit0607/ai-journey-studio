type Job={id:string;task_id:string;platform:string;status:string;created:string};
const ACTIVE=["approved","claimed","published","uncertain","failed","missed","invalidated"];
/** The delivery that currently speaks for this task: newest non-cancelled, non-staged plan. */
export function currentDelivery<T extends Job>(jobs:T[]|undefined,task:string):T|null{
  return (jobs||[]).filter(job=>job.task_id===task&&job.platform==="LinkedIn"&&ACTIVE.includes(job.status)).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created))[0]||null;
}
/** Approved, in-flight or published deliveries replace the approval box, so nothing is approved twice. */
export function deliveryLocksApproval(job:{status:string}|null){return !!job&&["approved","claimed","published","uncertain"].includes(job.status);}
