import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {CAP,BUFFER,WARNING,ROLES,hash,istMonth,sourceAllowed,type Pricing,type Source,type Task,type Output} from "./domain";
import type {Completion,Report} from "./providers";
export class Store{
  constructor(readonly db:Database){}
  async event(tx:Connection,task:string|null,kind:string,detail:string){
    await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,$3,$4)",[randomUUID(),task,kind,detail]);
  }
  async source(text:string,category:string,date:string,consent:boolean){
    if(!consent||!sourceAllowed(text,category,date))throw Error("Source not cleared");
    return this.db.transaction(async tx=>{
      const id=randomUUID(),version=hash(text);
      await tx.query("INSERT INTO sources(id,text,category,reported_date,cleared,hash) VALUES($1,$2,$3,$4,true,$5) ON CONFLICT(hash) DO NOTHING",[id,text,category,date,version]);
      return (await tx.query<Source>("SELECT * FROM sources WHERE hash=$1",[version]))[0];
    });
  }
  async enqueue(source:string){
    return this.db.transaction(async tx=>{
      const s=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 AND cleared=true FOR UPDATE",[source]))[0];
      if(!s||!sourceAllowed(s.text,s.category,s.reported_date))throw Error("Source not cleared");
      const id=randomUUID();
      const inserted=await tx.query<Task>("INSERT INTO tasks(id,source_id,source_hash,status) VALUES($1,$2,$3,'queued') ON CONFLICT(source_id,source_hash) DO NOTHING RETURNING *",[id,source,s.hash]);
      if(inserted.length){await this.event(tx,id,"queued","Cleared source queued");return inserted[0];}
      return (await tx.query<Task>("SELECT * FROM tasks WHERE source_id=$1 AND source_hash=$2",[source,s.hash]))[0];
    });
  }
  async snapshot():Promise<Record<string,any>>{
    const tables=["sources","tasks","outputs","events","ledger","approvals"] as const;
    const data:Record<string,any>={};
    for(const table of tables)data[table]=await this.db.query("SELECT * FROM "+table+" ORDER BY "+(table==="approvals"?"created":table==="tasks"?"updated":"created"));
    const month=istMonth();
    const used=data.ledger.filter((r:any)=>r.month===month||r.status!=="settled").reduce((sum:number,r:any)=>sum+Number(r.status==="settled"?r.estimated:r.reserved),0);
    const unresolved=data.ledger.filter((r:any)=>r.status!=="settled").length;
    const workers=await this.db.query("SELECT * FROM runtime ORDER BY name");
    return {...data,workers,database:this.db.kind,analyst:{status:"insufficient-data",reason:"No real platform metrics imported"},
      budget:{month_IST:month,committed_microdollars:used,warning:used>=WARNING,cap_microdollars:CAP,buffer_microdollars:BUFFER,unresolved_reservations:unresolved,basis:"Reported token estimates and unresolved reservations; not invoices"},
      pricing_blocked:data.ledger.some((r:any)=>r.pricing_anomaly&&r.status!=="settled"),
      updated:new Date().toISOString()};
  }
  async claim(){
    return this.db.transaction(async tx=>{
      // Expiry never frees a provider reservation. Unknown completion requires reconciliation.
      const expired=await tx.query<Task>("SELECT * FROM tasks WHERE status='running' AND lease_until<now() FOR UPDATE SKIP LOCKED");
      for(const t of expired){
        const uncertain=await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND status IN ('reserved','unknown')",[t.id]);
        await tx.query("UPDATE tasks SET status=$2,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[t.id,uncertain.length?"blocked":"queued"]);
        await this.event(tx,t.id,"lease_expired",uncertain.length?"Reservation retained; replay blocked":"Resumable checkpoint queued");
      }
      const task=(await tx.query<Task>("SELECT * FROM tasks WHERE status='queued' ORDER BY updated FOR UPDATE SKIP LOCKED LIMIT 1"))[0];
      if(!task)return null;
      const lease=randomUUID();
      const claimed=(await tx.query<Task>("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '240 seconds',updated=now() WHERE id=$1 RETURNING *",[task.id,lease]))[0];
      await this.event(tx,task.id,"step_claimed","Checkpoint "+task.checkpoint+" claimed");
      return claimed;
    });
  }
  async reserve(task:Task,provider:string,p:Pricing,upper:number,month=istMonth()){
    if(!Number.isSafeInteger(upper)||upper<=0)throw Error("Invalid reservation");
    return this.db.transaction(async tx=>{
      const current=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[task.id]))[0];
      if(current.status!=="running"||current.lease_token!==task.lease_token)throw Error("Cancelled or stale lease");
      const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[current.source_id]))[0];
      if(!source?.cleared||source.hash!==current.source_hash||!sourceAllowed(source.text,source.category,source.reported_date))throw Error("Source invalidated");
      // Include unresolved prior-month calls: completion/billing date can cross the IST boundary.
      await tx.query("INSERT INTO budget_months(month) VALUES('__combined_guard__') ON CONFLICT DO NOTHING");
      await tx.query("SELECT month FROM budget_months WHERE month='__combined_guard__' FOR UPDATE");
      if((await tx.query("SELECT id FROM ledger WHERE pricing_anomaly=true AND status!='settled' LIMIT 1")).length)throw Error("Unverified billing tier; all provider execution paused");
      await tx.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);
      await tx.query("SELECT month FROM budget_months WHERE month=$1 FOR UPDATE",[month]);
      const rows=await tx.query<{used:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END),0) AS used FROM ledger WHERE month=$1 OR status IN ('reserved','unknown')",[month]);
      if(Number(rows[0].used)+upper>CAP-BUFFER)throw Error("Monthly cap including internal buffer reached");
      const id=randomUUID();
      await tx.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status,requested_service_tier) VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8)",[id,task.id,month,provider,p.model,JSON.stringify(p),upper,provider==="openai"?"default":"standard"]);
      await this.event(tx,task.id,"provider_started",provider+" / checkpoint "+task.checkpoint);
      return id;
    });
  }
  async report(id:string,report:Report,anomaly=false){
    await this.db.query("UPDATE ledger SET returned_service_tier=$2,returned_model=$3,provider_request_id=$4,finish_reason=$5,pricing_anomaly=$6 WHERE id=$1",[id,report.serviceTier,report.model,report.requestId,report.finishReason,anomaly]);
  }
  async settle(task:Task,id:string,text:string,input:number,output:number,cost:number,outcome:Completion["outcome"]="complete"){
    return this.db.transaction(async tx=>{
      const current=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[task.id]))[0];
      if(current.lease_token!==task.lease_token)throw Error("Stale lease; retain reservation");
      const ledger=(await tx.query<{reserved:string;status:string}>("SELECT * FROM ledger WHERE id=$1 AND task_id=$2 FOR UPDATE",[id,task.id]))[0];
      if(!ledger||ledger.status!=="reserved")throw Error("Duplicate completion");
      await tx.query("UPDATE ledger SET status='settled',estimated=$2,input_tokens=$3,output_tokens=$4,completion_status=$5,partial_output=$6,partial_hash=$7 WHERE id=$1",[id,cost,input,output,outcome,outcome==="complete"?null:text,outcome==="complete"?null:hash(text)]);
      if(outcome!=="complete"){
        await tx.query("UPDATE tasks SET status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'blocked' END,block_reason=$2,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[task.id,outcome]);
        await this.event(tx,task.id,outcome==="safety"?"safety_terminated":"completion_incomplete","Reported usage settled; checkpoint not advanced; approval blocked");
        return;
      }
      await tx.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,ROLES[task.checkpoint],text,hash(text)]);
      const cancelled=current.status==="cancelled",exceeded=cost>Number(ledger.reserved);
      const status=cancelled?"cancelled":exceeded?"blocked":task.checkpoint===5?"review":"queued";
      await tx.query("UPDATE tasks SET checkpoint=$2,status=$3,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[task.id,task.checkpoint+1,status]);
      await this.event(tx,task.id,"artifact_saved",ROLES[task.checkpoint]);
      if(exceeded)await this.event(tx,task.id,"blocked","Usage exceeded upper-bound reservation; investigation required");
      if(status==="review")await this.event(tx,task.id,"review_ready","Exact versions require user approval");
    });
  }
  async uncertain(task:Task,reservation:string|null,detail:string,blockReason:string|null=null){
    await this.db.transaction(async tx=>{
      await tx.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE",[task.id]);
      if(reservation)await tx.query("UPDATE ledger SET status='unknown' WHERE id=$1 AND status='reserved'",[reservation]);
      await tx.query("UPDATE tasks SET status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'blocked' END,block_reason=$3,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1 AND lease_token=$2",[task.id,task.lease_token,blockReason]);
      await this.event(tx,task.id,"blocked",detail);
    });
  }
  async reject(reservation:string,unknown:boolean){
    await this.db.query("UPDATE ledger SET status=$2,estimated=$3 WHERE id=$1 AND status='reserved'",[reservation,unknown?"unknown":"settled",unknown?null:0]);
  }
  async cancel(id:string){
    await this.db.transaction(async tx=>{
      const t=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!t)throw Error("Unknown task");
      if(t.status==="approved")throw Error("Approved task cannot be cancelled");
      if(t.status==="cancelled")return;
      await tx.query("UPDATE tasks SET status='cancelled',updated=now() WHERE id=$1",[id]);
      await this.event(tx,id,"cancelled","Future calls stopped; in-flight costs retained");
    });
  }
  async retry(id:string){
    await this.db.transaction(async tx=>{
      const t=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!t||t.status!=="blocked")throw Error("Task cannot be retried");
      if((t as Task&{block_reason:string|null}).block_reason==="safety")throw Error("Safety termination cannot be retried");
      const unknown=await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND status IN ('reserved','unknown')",[id]);
      if(unknown.length)throw Error("Unknown completion; reconciliation required before retry");
      await tx.query("UPDATE tasks SET status='queued',block_reason=NULL,updated=now() WHERE id=$1",[id]);
      await this.event(tx,id,"retry_queued","User requested resume at saved checkpoint");
    });
  }
  async approve(id:string,version:string){
    await this.db.transaction(async tx=>{
      const t=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!t||t.status!=="review")throw Error("Task is not ready for approval");
      const outputs=await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[id]);
      if(outputs.length!==6||!ROLES.every(role=>outputs.some(o=>o.role===role))||outputs.some(o=>hash(o.text)!==o.hash)||hash(outputs.map(o=>o.hash).join("|"))!==version)throw Error("Stale artifact version");
      const source=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[t.source_id]))[0];
      if(!source.cleared||source.hash!==t.source_hash||hash(source.text)!==source.hash||!sourceAllowed(source.text,source.category,source.reported_date))throw Error("Source invalidated");
      await tx.query("INSERT INTO approvals(task_id,version) VALUES($1,$2)",[id,version]);
      await tx.query("UPDATE tasks SET status='approved',updated=now() WHERE id=$1",[id]);
      await this.event(tx,id,"approved","User approved exact artifact bundle; publication disabled");
    });
  }
  async heartbeat(enabled:boolean){await this.db.query("INSERT INTO runtime(name,heartbeat,enabled) VALUES('job-step',now(),$1) ON CONFLICT(name) DO UPDATE SET heartbeat=now(),enabled=$1",[enabled]);}
}
