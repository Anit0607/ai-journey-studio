import {ownerMessageContext,saveOwnerMessageContext,type OwnerContextInput} from './owner-message-context';
import {noteStageIssue} from './note-fact-selection';
import {DRAFT_PROMPT_PREPARED,DRAFT_OUTPUT_RECORDED,assertPromptMetadata,type DraftPromptMetadata} from './draft-run-receipt';
import {agentContributions} from './agent-contributions';
import {OWNER_WRITING_PROFILE} from './owner-writing-profile';
import {assertNoEditorialHold} from './editorial-review';
import {assertOwnerCalendarScope,OWNER_CALENDAR_STARTED,OWNER_CALENDAR_MAX_CALLS,OWNER_CALENDAR_MAX_RESERVED,type OwnerCalendarExecution,type OwnerCalendarScope} from "./owner-calendar-policy";
import {admittedHostedTask,hostedCandidates,HOSTED_CANDIDATE_LIMIT,HostedCalendarScanExhausted,type HostedCalendarPolicy} from "./hosted-calendar-policy";
import {resolveScopedSource} from "./github-source-policy";
import {scopedSourceProof,scopedTaskMatches} from "./scoped-source-proof";
import {taskPlatformPolicyHash} from "./platform-policy-binding";
import {newTaskPlatformBrief,taskPlatformPolicy} from "./platform-policy";
import {evidenceQuality,reviewReadiness,saveEvidenceDecision,saveOwnerAttestation,criticSuggestions,OUTDATED_CRITIC_NOTE,saveAssistantEvidenceDecision,saveEvidenceApproval,type Decision,type AssistantEvidenceInput} from "./evidence-review";
import {usageSummary} from "./usage";
import {OwnerReports} from "./owner-reports";
import {platformVariants} from "./platform-variants";
import {randomUUID} from "node:crypto";
import type {Connection,Database} from "./db";
import {CAP,BUFFER,WARNING,ROLES,hash,istMonth,sourceAllowed,type Pricing,type Source,type Task,type Output} from "./domain";
import {assertNoPendingAgentRevision,finalizeAgentRevision} from "./agent-revisions";
import {assertSourcePrivacy,sourceEligible} from "./sources";
import {assertArtifactPrivacy} from "./artifact-privacy";
import type {Completion,Report} from "./providers";
import {assertBundle,bundleVersion,type Artifact} from "./grounding";
import {assertOwnerDraftScope,OWNER_DRAFT_STARTED,OWNER_DRAFT_MAX_RESERVED,OWNER_DRAFT_MAX_CALLS,type OwnerDraftScope} from "./owner-draft-policy";
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
  /** Queues one manual draft task; extraBrief adds format/timing context (never evidence). */
  async enqueue(source:string,extraBrief:Record<string,unknown>={}){
    return this.db.transaction(async tx=>{
      const s=(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 AND cleared=true FOR UPDATE",[source]))[0];
      if(!s||!sourceEligible(s))throw Error("Source not cleared");
      const id=randomUUID();
      const inserted=await tx.query<Task>("INSERT INTO tasks(id,source_id,source_hash,status,content_brief) VALUES($1,$2,$3,'queued',$4) ON CONFLICT(source_id,source_hash,origin_key) DO NOTHING RETURNING *",[id,source,s.hash,JSON.stringify({...extraBrief,...newTaskPlatformBrief()})]);
      if(inserted.length){await this.event(tx,id,"queued","Cleared source queued");return inserted[0];}
      return (await tx.query<Task>("SELECT * FROM tasks WHERE source_id=$1 AND source_hash=$2 AND origin_key='manual'",[source,s.hash]))[0];
    });
  }
  async snapshot():Promise<Record<string,any>>{
    const tables=["sources","tasks","outputs","events","ledger","approvals"] as const;
    const data:Record<string,any>={};
    for(const table of tables)data[table]=await this.db.query("SELECT * FROM "+table+" ORDER BY "+(table==="outputs"?"created,id":table==="approvals"?"created":table==="tasks"?"updated":"created"));
    data.sources=await Promise.all(data.sources.map((source:Source)=>resolveScopedSource(this.db,source)));
    const month=istMonth();
    const used=data.ledger.filter((r:any)=>r.month===month||r.status!=="settled").reduce((sum:number,r:any)=>sum+Number(r.status==="settled"?r.estimated:r.reserved),0);
    const unresolved=data.ledger.filter((r:any)=>r.status!=="settled").length;
    const workers=await this.db.query("SELECT * FROM runtime ORDER BY name");
    const revisions=await this.db.query("SELECT * FROM content_revisions ORDER BY task_id,sequence"),revisionApprovals=await this.db.query("SELECT * FROM revision_approvals ORDER BY created");
    const evidenceRows=await this.db.query<Decision&{task_id:string}>("SELECT * FROM evidence_decisions ORDER BY sequence");
    const evidenceReceipts=await this.db.query<any>("SELECT * FROM evidence_approval_receipts ORDER BY created,id");
    const reviews=data.tasks.filter((task:Task)=>!task.revision_parent_task_id).map((task:Task)=>{
      const history=revisions.filter((revision:any)=>revision.task_id===task.id),latest:any=history.at(-1);
      const bundle=latest?.bundle||data.outputs.filter((output:Output)=>output.task_id===task.id);
      const source=data.sources.find((item:Source)=>item.id===task.source_id);
      const token=latest?"revision:"+latest.id+":"+latest.version:"original:"+hash(bundle.map((item:Artifact)=>item.hash).join("|"));
      const quality=evidenceQuality(bundle,source||{text:"",hash:"",cleared:false},evidenceRows.filter(row=>row.task_id===task.id),taskPlatformPolicy(task),token,ownerMessageContext(task,source||{text:"",hash:"",cleared:false},evidenceRows.filter(row=>row.task_id===task.id)));
      const receipts=evidenceReceipts.filter((row:any)=>row.task_id===task.id);
      const approvalCurrent=!quality.editorial.blocking&&!quality.flags.length&&receipts.some((row:any)=>row.binding===quality.binding&&row.review_token===token&&row.evidence_version===(quality.evidence_version||""));
      return {contributions:agentContributions(task,data.tasks,data.outputs,data.ledger,data.events,history,bundle,source),variants:platformVariants(bundle.find((item:Artifact)=>item.role==="Platform Adapter"),taskPlatformPolicy(task)),platform_policy:taskPlatformPolicy(task)||null,task_id:task.id,is_agent_revision:false,pending_agent_revision:data.tasks.find((child:Task)=>child.revision_parent_task_id===task.id&&["queued","running","blocked"].includes(child.status))||null,agent_revision_jobs:data.tasks.filter((child:Task)=>child.revision_parent_task_id===task.id),token:latest?"revision:"+latest.id+":"+latest.version:"original:"+hash(bundle.map((item:Artifact)=>item.hash).join("|")),latest_revision:latest?.id||null,original_bundle:data.outputs.filter((output:Output)=>output.task_id===task.id),original_approval:data.approvals.find((item:any)=>item.task_id===task.id)||null,bundle,quality,approval:(latest?revisionApprovals.find((item:any)=>item.revision_id===latest.id):data.approvals.find((item:any)=>item.task_id===task.id))&&approvalCurrent?(latest?revisionApprovals.find((item:any)=>item.revision_id===latest.id):data.approvals.find((item:any)=>item.task_id===task.id))||null:null,history:history.map((item:any)=>({...item,approval:revisionApprovals.find((approval:any)=>approval.revision_id===item.id)||null}))};
    });
    return {...data,writing_profile:OWNER_WRITING_PROFILE,tasks:data.tasks.map((task:Task)=>({...task,platform_policy_hash:taskPlatformPolicyHash(task)})),reviews,workers,database:this.db.kind,usage:usageSummary(data.ledger,month),analyst:await new OwnerReports(this.db).snapshot(data.ledger),
      budget:{month_IST:month,committed_microdollars:used,warning:used>=WARNING,cap_microdollars:CAP,buffer_microdollars:BUFFER,unresolved_reservations:unresolved,basis:"Reported token estimates and unresolved reservations; not invoices"},
      pricing_blocked:data.ledger.some((r:any)=>r.pricing_anomaly&&r.status!=="settled"),
      updated:new Date().toISOString()};
  }
  async claim(scope?:OwnerDraftScope,hosted?:HostedCalendarPolicy,calendar?:OwnerCalendarExecution){
    if(calendar){
      if(scope||hosted)throw Error("Conflicting execution policy");
      return this.db.transaction(async tx=>{
        const {task}=await assertOwnerCalendarScope(tx,calendar);
        if(task.status!=="queued")return null;
        const claimed=(await tx.query<Task>("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '240 seconds',updated=now() WHERE id=$1 RETURNING *",[task.id,randomUUID()]))[0];
        await this.event(tx,task.id,"step_claimed","Owner-selected Calendar checkpoint "+task.checkpoint+" claimed");
        return claimed;
      });
    }
    if(hosted){
      if(scope)throw Error("Conflicting execution policy");
      // This is a read-only candidate snapshot, never an admission. Each attempt
      // owns a separate transaction so a rejected source/policy lock cannot
      // precede another candidate's entry or task lock.
      const candidates=await hostedCandidates(this.db);
      for(const candidate of candidates.slice(0,HOSTED_CANDIDATE_LIMIT)){
        const claimed=await this.db.transaction(async tx=>{
          let task=await admittedHostedTask(tx,candidate.id,hosted.config);
          if(!task)return null;
          if(task.status==="running"&&task.lease_until&&new Date(task.lease_until)<new Date()){
            const uncertain=await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND status IN ('reserved','unknown')",[task.id]);
            await tx.query("UPDATE tasks SET status=$2,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[task.id,uncertain.length?"blocked":"queued"]);
            await this.event(tx,task.id,"lease_expired",uncertain.length?"Reservation retained; replay blocked":"Resumable checkpoint queued");
            if(uncertain.length)return null;
            task={...task,status:"queued"};
          }
          if(task.status!=="queued")return null;
          const next=(await tx.query<Task>("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '240 seconds',updated=now() WHERE id=$1 RETURNING *",[task.id,randomUUID()]))[0];
          await this.event(tx,task.id,"step_claimed","Scoped calendar checkpoint "+task.checkpoint+" claimed");
          return next;
        });
        if(claimed)return claimed;
      }
      if(candidates.length>HOSTED_CANDIDATE_LIMIT)throw new HostedCalendarScanExhausted();
      return null;
    }
    return this.db.transaction(async tx=>{
      if(scope){
        const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[scope.task_id]))[0];
        if(!task||task.status!=="queued")return null;
        await assertOwnerDraftScope(tx,task,scope);
        const claimed=(await tx.query<Task>("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '240 seconds',updated=now() WHERE id=$1 RETURNING *",[task.id,randomUUID()]))[0];
        await this.event(tx,task.id,"step_claimed","Owner-selected checkpoint "+task.checkpoint+" claimed");
        return claimed;
      }
      // Expiry never frees a provider reservation. Unknown completion requires reconciliation.
      const expired=await tx.query<Task>("SELECT * FROM tasks WHERE status='running' AND lease_until<now() AND NOT EXISTS (SELECT 1 FROM events WHERE events.task_id=tasks.id AND kind IN ('owner_draft_started','owner_calendar_started')) FOR UPDATE SKIP LOCKED");
      for(const t of expired){
        if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[t.id,OWNER_DRAFT_STARTED])).length||(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[t.id,OWNER_CALENDAR_STARTED])).length)continue;
        const uncertain=await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND status IN ('reserved','unknown')",[t.id]);
        await tx.query("UPDATE tasks SET status=$2,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[t.id,uncertain.length?"blocked":"queued"]);
        await this.event(tx,t.id,"lease_expired",uncertain.length?"Reservation retained; replay blocked":"Resumable checkpoint queued");
      }
      const task=(await tx.query<Task>("SELECT * FROM tasks WHERE status='queued' AND NOT EXISTS (SELECT 1 FROM events WHERE events.task_id=tasks.id AND kind IN ('owner_draft_started','owner_calendar_started')) ORDER BY updated FOR UPDATE SKIP LOCKED LIMIT 1"))[0];
      if(!task)return null;
      // Fresh statement after the row lock handles a marker committed after the selection snapshot.
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[task.id,OWNER_DRAFT_STARTED])).length||(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[task.id,OWNER_CALENDAR_STARTED])).length)return null;
      const lease=randomUUID();
      const claimed=(await tx.query<Task>("UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '240 seconds',updated=now() WHERE id=$1 RETURNING *",[task.id,lease]))[0];
      await this.event(tx,task.id,"step_claimed","Checkpoint "+task.checkpoint+" claimed");
      return claimed;
    });
  }
  async reserve(task:Task,provider:string,p:Pricing,upper:number,month=istMonth(),scope?:OwnerDraftScope,calendar?:OwnerCalendarExecution,promptMetadata?:DraftPromptMetadata){
    if(!Number.isSafeInteger(upper)||upper<=0)throw Error("Invalid reservation");
    return this.db.transaction(async tx=>{
      if(scope&&calendar)throw Error("Conflicting execution policy");
      const current=calendar?(await assertOwnerCalendarScope(tx,calendar)).task:(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[task.id]))[0];
      if(!current||current.status!=="running"||current.lease_token!==task.lease_token||current.checkpoint!==task.checkpoint||!ROLES[current.checkpoint])throw Error("Cancelled or stale lease");
      if(promptMetadata)assertPromptMetadata(promptMetadata,current);
      if(scope)await assertOwnerDraftScope(tx,current,scope);
      else if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[task.id,OWNER_DRAFT_STARTED])).length)throw Error("Owner draft execution stopped");
      if(!calendar&&(await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[task.id,OWNER_CALENDAR_STARTED])).length)throw Error("Owner calendar execution stopped");
      const source=(await resolveScopedSource(tx,(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[current.source_id]))[0]))!;
      if(!source?.cleared||source.hash!==current.source_hash||!sourceEligible(source)||!scopedTaskMatches(source,current)||(scopedSourceProof(source)&&provider!=="openai"))throw Error("Source invalidated");
      // Include unresolved prior-month calls: completion/billing date can cross the IST boundary.
      await tx.query("INSERT INTO budget_months(month) VALUES('__combined_guard__') ON CONFLICT DO NOTHING");
      await tx.query("SELECT month FROM budget_months WHERE month='__combined_guard__' FOR UPDATE");
      if(scope||calendar){
        const spent=(await tx.query<{reserved:string;calls:string}>("SELECT COALESCE(SUM(reserved),0) AS reserved,COUNT(*) AS calls FROM ledger WHERE task_id=$1",[task.id]))[0];
        if(provider!=="openai"||!Number.isSafeInteger(Number(spent.reserved))||Number(spent.reserved)+upper>(calendar?OWNER_CALENDAR_MAX_RESERVED:OWNER_DRAFT_MAX_RESERVED)||Number(spent.calls)>=(calendar?OWNER_CALENDAR_MAX_CALLS:OWNER_DRAFT_MAX_CALLS)||(await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND checkpoint=$2",[task.id,task.checkpoint])).length)throw Error("Owner draft reservation limit reached");
        if((await tx.query("SELECT id FROM ledger WHERE status!='settled' LIMIT 1")).length)throw Error("Owner draft accounting unresolved");
      }
      if((await tx.query("SELECT id FROM ledger WHERE pricing_anomaly=true AND status!='settled' LIMIT 1")).length)throw Error("Unverified billing tier; all provider execution paused");
      await tx.query("INSERT INTO budget_months(month) VALUES($1) ON CONFLICT DO NOTHING",[month]);
      await tx.query("SELECT month FROM budget_months WHERE month=$1 FOR UPDATE",[month]);
      const rows=await tx.query<{used:string}>("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN estimated ELSE reserved END),0) AS used FROM ledger WHERE month=$1 OR status IN ('reserved','unknown')",[month]);
      if(Number(rows[0].used)+upper>CAP-BUFFER)throw Error("Monthly cap including internal buffer reached");
      const id=randomUUID();
      await tx.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status,requested_service_tier,role,checkpoint) VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10)",[id,task.id,month,provider,p.model,JSON.stringify(p),upper,provider==="openai"?"default":"standard",ROLES[current.checkpoint],current.checkpoint]);
      if(promptMetadata)await this.event(tx,task.id,DRAFT_PROMPT_PREPARED,JSON.stringify({reservation_id:id,...promptMetadata}));
      await this.event(tx,task.id,"provider_started",provider+" / checkpoint "+task.checkpoint);
      return id;
    });
  }
  async report(id:string,report:Report,anomaly=false){
    await this.db.query("UPDATE ledger SET returned_service_tier=$2,returned_model=$3,provider_request_id=$4,finish_reason=$5,pricing_anomaly=$6 WHERE id=$1",[id,report.serviceTier,report.model,report.requestId,report.finishReason,anomaly]);
  }
  async settle(task:Task,id:string,text:string,input:number,output:number,cost:number,outcome:Completion["outcome"]="complete",calendar?:OwnerCalendarScope){
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
      let scopedInvalid=false;
      if(current.content_brief?.source_policy){
        // Match parent review/edit/finalization order before taking the source lock.
        // Otherwise final child settlement can hold source while waiting on parent.
        if(current.revision_parent_task_id)await tx.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE",[current.revision_parent_task_id]);
        const source=await resolveScopedSource(tx,(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[current.source_id]))[0]);
        scopedInvalid=!source||!sourceEligible(source,current.source_hash)||!scopedTaskMatches(source,current);
      }
      const stageSource=task.checkpoint<=2?(await tx.query<Source>('SELECT * FROM sources WHERE id=$1',[current.source_id]))[0]:undefined;
      const stagePrevious=stageSource?await tx.query<Output>('SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id',[task.id]):[];
      const contractIssue=stageSource&&stageSource.hash===current.source_hash?noteStageIssue(task.checkpoint,text,stageSource,stagePrevious):null;
      const cancelled=current.status==="cancelled",exceeded=cost>Number(ledger.reserved);
      const status=cancelled?"cancelled":exceeded||scopedInvalid||!!contractIssue?"blocked":task.checkpoint===5?"review":"queued";
      // A Calendar one-shot publishes neither a reviewable root nor a parent revision
      // until its final locked consent/timing check and finish receipt commit together.
      const finalPending=status==="review"&&!!calendar;
      if(calendar&&calendar.task_id!==task.id)throw Error("Owner calendar execution stopped");
      await tx.query("UPDATE tasks SET checkpoint=$2,status=$3,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[task.id,task.checkpoint+1,finalPending?"running":status]);
      await this.event(tx,task.id,"artifact_saved",ROLES[task.checkpoint]);
      await this.event(tx,task.id,DRAFT_OUTPUT_RECORDED,JSON.stringify({schema:1,reservation_id:id,checkpoint:task.checkpoint,role:ROLES[task.checkpoint],artifact_hash:hash(text)}));
      if(scopedInvalid){await tx.query("UPDATE tasks SET block_reason='scoped_source_invalid' WHERE id=$1",[task.id]);await this.event(tx,task.id,"blocked","Source policy revoked or changed while provider call was in flight; usage and output retained; no further calls");}
      if(contractIssue&&!cancelled&&!scopedInvalid&&!exceeded){await tx.query("UPDATE tasks SET block_reason='note_contract' WHERE id=$1",[task.id]);await this.event(tx,task.id,"note_contract_blocked",contractIssue+"; returned artifact and settled usage retained; no next-stage call");}
      if(exceeded)await this.event(tx,task.id,"blocked","Usage exceeded upper-bound reservation; investigation required");
      if(status==="review"&&!finalPending){
        const revision=await finalizeAgentRevision(tx,{...task,checkpoint:task.checkpoint+1,status});
        if(revision.status==="not_revision")await this.event(tx,task.id,"review_ready","Exact versions require user approval");
      }
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
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[id,OWNER_DRAFT_STARTED])).length)throw Error("Owner draft attempt cannot be replayed");
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[id,OWNER_CALENDAR_STARTED])).length)throw Error("Owner Calendar attempt cannot be replayed");
      if(t.checkpoint>=6||["revision_stale","revision_source","revision_invalid","revision_accounting","scoped_source_invalid","note_contract"].includes((t as Task&{block_reason:string|null}).block_reason||""))throw Error("Completed revision cannot be retried; review its parent content");
      if((t as Task&{block_reason:string|null}).block_reason==="safety")throw Error("Safety termination cannot be retried");
      const unknown=await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND status IN ('reserved','unknown')",[id]);
      if(unknown.length)throw Error("Unknown completion; reconciliation required before retry");
      await tx.query("UPDATE tasks SET status='queued',block_reason=NULL,updated=now() WHERE id=$1",[id]);
      await this.event(tx,id,"retry_queued","User requested resume at saved checkpoint");
    });
  }
  async approve(id:string,version:string,approvalScope:"artifacts"|"final-post"="artifacts"){
    await this.db.transaction(async tx=>{
      const t=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!t||t.status!=="review"||t.revision_parent_task_id)throw Error("Task is not ready for approval");
      if((await tx.query("SELECT id FROM events WHERE task_id=$1 AND kind=$2",[id,OWNER_DRAFT_STARTED])).length){
        const finished=(await tx.query<{detail:string}>("SELECT detail FROM events WHERE task_id=$1 AND kind='owner_draft_finished'",[id]))[0];
        if(!finished||JSON.parse(finished.detail).status!=="review")throw Error("Task is not ready for approval");
      }
      await assertNoPendingAgentRevision(tx,id);
      if((await tx.query("SELECT id FROM content_revisions WHERE task_id=$1 LIMIT 1",[id])).length)throw Error("Fresh revision approval required");
      const outputs=await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[id]);
      if(outputs.length!==6||!ROLES.every(role=>outputs.some(o=>o.role===role))||outputs.some(o=>hash(o.text)!==o.hash)||hash(outputs.map(o=>o.hash).join("|"))!==version)throw Error("Stale artifact version");
      const source=(await resolveScopedSource(tx,(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[t.source_id]))[0]))!;
      if(!source?.cleared||source.hash!==t.source_hash||hash(source.text)!==source.hash||!sourceEligible(source)||!scopedTaskMatches(source,t))throw Error("Source invalidated");
      const quality=await reviewReadiness(tx,id,outputs,source);
      assertNoEditorialHold(quality.editorial);
      if(quality.flags.length)throw Error("Resolve source-grounding flags before approval");
      await tx.query("INSERT INTO approvals(task_id,version,evidence_version) VALUES($1,$2,$3) ON CONFLICT(task_id) DO NOTHING",[id,version,quality.evidence_version]);
      await saveEvidenceApproval(tx,id,"original:"+version,quality);
      await tx.query("UPDATE tasks SET status='approved',updated=now() WHERE id=$1",[id]);
      await this.event(tx,id,"approved",approvalScope==="final-post"?"Owner approved the exact final LinkedIn post; artifact bundle retained as review context; see versioned publication approval receipt":"User approved exact artifact bundle; publication disabled");
    });
  }
  async revisionContext(tx:Connection,id:string,expected:string){
    const task=(await tx.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[id]))[0];
    if(!task||task.revision_parent_task_id||!["review","approved"].includes(task.status))throw Error("Task is not ready for revision");
    const source=(await resolveScopedSource(tx,(await tx.query<Source>("SELECT * FROM sources WHERE id=$1 FOR UPDATE",[task.source_id]))[0]))!;
    if(!source?.cleared||source.hash!==task.source_hash||hash(source.text)!==source.hash||!sourceEligible(source)||!scopedTaskMatches(source,task))throw Error("Source invalidated");
    const latest:any=(await tx.query("SELECT * FROM content_revisions WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1",[id]))[0];
    const bundle:Artifact[]=latest?.bundle||await tx.query<Output>("SELECT * FROM outputs WHERE task_id=$1 ORDER BY created,id",[id]);assertBundle(bundle);
    if(latest&&bundleVersion(bundle,source.hash)!==latest.version)throw Error("Stale artifact version");
    const token=latest?"revision:"+latest.id+":"+latest.version:"original:"+hash(bundle.map(item=>item.hash).join("|"));
    if(expected!==token)throw Error("Stale revision; refresh before editing");
    return {task,source,latest,bundle,token};
  }
  async revise(id:string,expected:string,note:string,edit?:{role:string;text:string},actor:"owner"|"assistant"="owner"){
    if(typeof note!=="string"||!note.trim()||note.length>1000)throw Error("Revision note required");
    if(edit&&(!ROLES.includes(edit.role as typeof ROLES[number])||typeof edit.text!=="string"||!edit.text.trim()||Buffer.byteLength(edit.text)>32000))throw Error("Invalid revision text");
    assertSourcePrivacy(note);
    if(edit)assertArtifactPrivacy(edit.text);
    return this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,id,expected);
      if(edit&&context.bundle.find(item=>item.role===edit.role)?.text===edit.text)throw Error("No content change");
      const bundle=context.bundle.map(item=>({role:item.role,text:edit?.role===item.role?edit.text:item.text,hash:edit?.role===item.role?hash(edit.text):item.hash}));
      // An owner edit to public copy makes a structured Critic's sentence index stale. Replace
      // it with a plain note instead of leaving a citation set that no longer matches the text.
      if(edit&&["Writer","Platform Adapter"].includes(edit.role)&&!criticSuggestions(context.bundle,context.source).legacy){const critic=bundle.find(item=>item.role==="Critic");if(critic){critic.text=OUTDATED_CRITIC_NOTE;critic.hash=hash(OUTDATED_CRITIC_NOTE);}}
      const revision=randomUUID(),version=bundleVersion(bundle,context.source.hash);
      await tx.query("INSERT INTO content_revisions(id,task_id,parent_id,base_token,version,bundle,request_note,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[revision,id,context.latest?.id||null,expected,version,JSON.stringify(bundle),(actor==="assistant"?"[Assistant edit] ":"")+note.trim(),(context.latest?.sequence||0)+1]);
      await this.event(tx,id,actor==="assistant"?"assistant_revision_saved":edit?"manual_revision_saved":"changes_requested",(actor==="assistant"?"Assistant-saved edit, not owner review or approval. ":"")+"New revision "+revision+"; historical approvals preserved; fresh approval required");
      return {id:revision,version};
    });
  }
  async reviewEvidence(id:string,expected:string,input:Parameters<typeof saveEvidenceDecision>[4]){
    return this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,id,expected);
      await assertNoPendingAgentRevision(tx,id);
      return saveEvidenceDecision(tx,id,context.bundle,context.source,input);
    });
  }
  async attestFinalPost(id:string,expected:string,input:Parameters<typeof saveOwnerAttestation>[4]){
    return this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,id,expected);
      await assertNoPendingAgentRevision(tx,id);
      return saveOwnerAttestation(tx,id,context.bundle,context.source,input);
    });
  }
  async recordOwnerMessageContext(input:OwnerContextInput){
    return this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,input.task,input.expected);
      await assertNoPendingAgentRevision(tx,input.task);
      return saveOwnerMessageContext(tx,context.task,context.source,context.token,input);
    });
  }
  async reviewAssistantEvidence(input:AssistantEvidenceInput){
    return this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,input.task,input.expected);
      await assertNoPendingAgentRevision(tx,input.task);
      return saveAssistantEvidenceDecision(tx,input.task,context.token,context.bundle,context.source,input);
    });
  }
  async approveRevision(id:string,expected:string,acknowledged:boolean,approvalScope:"artifacts"|"final-post"="artifacts"){
    if(acknowledged!==true)throw Error("Human factual review acknowledgement required");
    await this.db.transaction(async tx=>{
      const context=await this.revisionContext(tx,id,expected);
      if(!context.latest)throw Error("No revision to approve");
      await assertNoPendingAgentRevision(tx,id);
      const quality=await reviewReadiness(tx,id,context.bundle,context.source);
      assertNoEditorialHold(quality.editorial);
      if(quality.flags.length)throw Error("Resolve source-grounding flags before approval");
      if(bundleVersion(context.bundle,context.source.hash)!==context.latest.version)throw Error("Stale artifact version");
      const inserted=await tx.query("INSERT INTO revision_approvals(revision_id,version,evidence_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING revision_id",[context.latest.id,context.latest.version,quality.evidence_version]);
      await saveEvidenceApproval(tx,id,context.token,quality);
      if(inserted.length)await this.event(tx,id,"revision_approved",approvalScope==="final-post"?"Owner approved the exact final LinkedIn post in revision "+context.latest.id+"; artifact bundle retained as review context; see versioned publication approval receipt":"User approved revision "+context.latest.id+" after factual review; publication disabled");
    });
  }
  async heartbeat(enabled:boolean){await this.db.query("INSERT INTO runtime(name,heartbeat,enabled) VALUES('job-step',now(),$1) ON CONFLICT(name) DO UPDATE SET heartbeat=now(),enabled=$1",[enabled]);}
}
