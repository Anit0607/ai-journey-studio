import {validOwnerContextInput} from '../../../../lib/owner-message-context';
import {validAssistantEvidenceInput} from '../../../../lib/evidence-review';
import {runOwnerCalendar,ownerCalendarSnapshot,validOwnerCalendarRequest} from "../../../../lib/owner-calendar";
import {previewApprovalPlan,approveApprovalPlan} from "../../../../lib/approval-plan";
import {runOwnerDraft,ownerDraftSnapshot,validOwnerDraftRequest} from "../../../../lib/owner-draft";
import {advanceGenerationNow,GenerationTimeError,validGenerationTimeInput,parseGenerationTimeRequest} from '../../../../lib/calendar-generation-time';
import {renderApprovedInstagram,getPrivateMedia,approvePublicMedia,safeMediaError} from "../../../../lib/publication-media";
import {integrationConfig} from "../../../../lib/integration-config";
import {mediaPublicOrigin,mediaPublicUrl} from "../../../../lib/publication-media-storage";
import {safeIngestionError} from "../../../../lib/source-ingestion";
import {PublicationValidationError,safePublicationError} from "../../../../lib/publishing";
import {createIntegrations} from "../../../../lib/integrations";
import {OwnerReports,REPORT_ERRORS} from "../../../../lib/owner-reports";
import {allowedOrigin,response} from "../../../../lib/auth";
import {database} from "../../../../lib/db";
import {Store} from "../../../../lib/store";
import {runtimeConfig} from "../../../../lib/config";
import {CAPSULE,hash,configReady} from "../../../../lib/domain";
import {liveReady} from "../../../../lib/providers";
import {step} from "../../../../lib/workflow";
import {SourceIntake,sourceAuthorized} from "../../../../lib/sources";
import {queueAgentRevision} from "../../../../lib/agent-revisions";
import {ownerApiAuthenticated,passwordOwnerAuthenticated} from "../../../../lib/owner-password";
import {hostedEnvironment,hostedBlockers,hostedCronReady,hostedOwnerDraftReady} from "../../../../lib/hosted";
import {recoverOverdueCalendarDraft,safeCalendarRecoveryError} from "../../../../lib/calendar-recovery";
import {Calendar} from "../../../../lib/calendar";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=300;
async function readBody(request:Request,limit=4096){
  const reader=request.body?.getReader();if(!reader)return "{}";
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error("Request too large");}chunks.push(value);}
  return Buffer.concat(chunks).toString("utf8");
}
type Context={params:Promise<{action:string}>};
export async function GET(request:Request,context:Context){
  if(!await ownerApiAuthenticated(request))return response({error:"Private access required"},401);
  const {action}=await context.params;
  if(action==="publication-media-preview"){
    try{const media=await getPrivateMedia(await database(),new URL(request.url).searchParams.get("id")||"");return new Response(new Uint8Array(media.bytes),{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline; filename=approved-card.jpg"}});}catch{return response({error:"Private media unavailable"},404);}
  }
  if(action!=="state")return response({error:"Unknown route"},404);
  try{
    const store=new Store(await database()),c=runtimeConfig(),state=await store.snapshot();
    const blockers=[];
    const sourceApproved=!!c.source_approved&&c.approved_source_hash===hash(CAPSULE);
    if(!sourceApproved&&!c.owner_cleared_sources_authorized)blockers.push("Source consent pending");
    if(!c.transmission_authorized&&!c.owner_cleared_sources_authorized)blockers.push("Provider transmission approval pending");
    if(!c.credential_use_authorized)blockers.push("Credential use approval pending");
    if(!configReady(c))blockers.push("Current model pricing and safety verification required");
    if(!process.env.OPENAI_API_KEY)blockers.push("Runtime provider credential not supplied");
    if(hostedEnvironment()){blockers.push(...hostedBlockers(c));if(c.hosted?.cron_authorized!==true)blockers.push("Daily hosted cron is not authorized");}
    else if(process.env.STUDIO_SESSION_ONLY!=="1")blockers.push("User-operated session-only key entry required");
    if(state.pricing_blocked)blockers.push("Unexpected provider billing tier requires reconciliation");
    const enabled=liveReady(c)&&(!hostedEnvironment()||hostedCronReady(c))&&!state.pricing_blocked;
    const hosted=hostedEnvironment()?{mode:"vercel-hobby",daily_batches:await store.db.query("SELECT day,status,attempts,steps,reason,started_at,heartbeat,finished_at FROM hosted_batches ORDER BY day DESC LIMIT 14"),notice:"One bounded daily batch, with up to an hour of scheduling variation. Backlog or slow calls may miss a review deadline; nothing is published automatically."}:null;
    const integrations=await createIntegrations(store.db);
    const approval_plans=await Promise.all(state.reviews.filter((review:any)=>state.tasks.some((task:any)=>task.id===review.task_id&&task.checkpoint===6&&["review","approved"].includes(task.status))).map(async(review:any)=>{try{return {task_id:review.task_id,plan:await previewApprovalPlan(store.db,integrations.publishing.runtime,review.task_id,review.token)};}catch(error){return {task_id:review.task_id,plan:null,reason:safePublicationError(error)||"Current source or review is not eligible; refresh and review its gates"};}}));
    return response({...state,approval_plans,owner_draft:await ownerDraftSnapshot(store.db,c),owner_calendar:await ownerCalendarSnapshot(store.db,c),integrations:await integrations.snapshot(),hosted,calendar:await new Calendar(store.db,hostedEnvironment()?120:49).snapshot(state,c,enabled,new Date(),hostedEnvironment()?hostedOwnerDraftReady(c):liveReady(c)),blockers,live_enabled:enabled,source_approved:sourceApproved,owner_cleared_sources_authorized:c.owner_cleared_sources_authorized===true,proposed_source:CAPSULE});
  }catch{return response({error:"Relational database unavailable. Configure an approved PostgreSQL connection or use the laptop-only embedded option."},503);}
}
export async function POST(request:Request,context:Context){
  const {action}=await context.params;
  // Worker execution credentials cannot grant owner source, evidence, content or publication consent.
  if(!await (["calendar-generation-now","publication-publish","owner-draft-run","owner-calendar-run","approval-plan-approve","source-clear","evidence-review","assistant-evidence-review","owner-message-context","approve","approve-revision","publication-approve","publication-media-approve","agent-revise"].includes(action)?passwordOwnerAuthenticated(request):ownerApiAuthenticated(request)))return response({error:"Private access required"},401);
  if(!allowedOrigin(request))return response({error:"Origin rejected"},403);
  if(!["calendar-generation-now","approval-plan-approve","owner-draft-run","owner-calendar-run","publication-media-stage","publication-media-approve","integration-sync","integration-import","publication-enqueue","publication-approve","publication-cancel","publication-revise","publication-publish","metrics-save","money-add","money-void","coverage-confirm","source-stage","source-clear","source-revoke","agent-revise","calendar-dispatch","source","run","approve","cancel","retry","step","evidence-review","assistant-evidence-review","owner-message-context","request-changes","revise","approve-revision","calendar-configure","calendar-plan","calendar-link","calendar-prepare","calendar-recover"].includes(action))return response({error:"Unknown action"},404);
  if(hostedEnvironment()&&action==="step")return response({error:"Hosted checkpoints run only through the protected daily scheduler"},403);
  const limit=["evidence-review","assistant-evidence-review","owner-message-context"].includes(action)?12000:action==="integration-import"?1_050_000:action==="publication-enqueue"||action==="publication-revise"?40000:["revise","source-stage"].includes(action)?40000:4096;
  if(Number(request.headers.get("content-length")||0)>limit)return response({error:"Request too large"},413);
  try{
    const raw=await readBody(request,limit);
    const body=action==='calendar-generation-now'?parseGenerationTimeRequest(raw):JSON.parse(raw),store=new Store(await database()),c=runtimeConfig();
    let value:unknown;
    if(action==="calendar-generation-now"){
      if(!validGenerationTimeInput(body))return response({error:"Exact generation-time acknowledgement required"},400);
      try{return response({result:await advanceGenerationNow(store.db,body,{readConfig:runtimeConfig,isReady:config=>hostedEnvironment()?hostedOwnerDraftReady(config):liveReady(config)})});}
      catch(error){return response({error:error instanceof GenerationTimeError?error.message:"Generation-time change was not confirmed; refresh the calendar and inspect its saved time before retrying"},409);}
    }
    if(action==="approval-plan-approve")value=await approveApprovalPlan(store.db,(await createIntegrations(store.db)).publishing.runtime,body);
    if(action==="owner-calendar-run"){
      if(!validOwnerCalendarRequest(body))return response({error:"Exact Calendar draft acknowledgement required"},400);
      const result=await runOwnerCalendar(store.db,body,{readConfig:runtimeConfig,signal:request.signal});
      return response({result,...(result.status!=="review"?{error:result.status==="uncertain"?"Calendar draft outcome uncertain. Check saved run and ledger; do not retry.":result.status==="duplicate"?"This task already has a one-shot Calendar attempt. Check saved status; do not retry.":"Selected Calendar draft stopped or its exact preview changed. Check saved run and ledger; no automatic retry."}:{})},result.status==="review"?200:409);
    }
    if(action==="owner-draft-run"){
      if(!validOwnerDraftRequest(body))return response({error:"Exact owner draft acknowledgement required"},400);
      const result=await runOwnerDraft(store.db,body,{readConfig:runtimeConfig,signal:request.signal});
      return response({result,...(result.status!=="review"?{error:result.status==="uncertain"?"Draft execution outcome uncertain. Check saved run and ledger; do not retry.":result.status==="duplicate"?"This task already has a one-shot draft attempt. Check saved status; do not retry.":"Selected draft stopped or is not eligible. Check saved run and ledger; no automatic retry."}:{})},result.status==="review"?200:409);
    }
    if(action==="publication-media-stage"){
      const media=await renderApprovedInstagram(store.db,String(body.task),String(body.review_token));
      const {bytes,...metadata}=media;void bytes;
      value={...metadata,public_url:mediaPublicUrl(integrationConfig().media||{},media.sha256)};
    }
    if(action==="publication-media-approve"){
      const origin=mediaPublicOrigin(integrationConfig().media||{});
      if(!origin||body.public_origin!==origin)throw Error("Media hosting destination must match reviewed configuration");
      value=await approvePublicMedia(store.db,String(body.id),String(body.sha256),origin,body.acknowledged);
    }

    if(action==="integration-sync")value=await (await createIntegrations(store.db)).sources.sync(body.provider);
    if(action==="integration-import")value=await (await createIntegrations(store.db)).sources.importChat(body.payload,body.acknowledged);
    if(action==="publication-enqueue")value=await (await createIntegrations(store.db)).publishing.enqueue(body);
    if(action==="publication-approve")value=await (await createIntegrations(store.db)).publishing.approve(body.id,body.expected_version,body.acknowledged);
    if(action==="publication-cancel")value=await (await createIntegrations(store.db)).publishing.cancel(body.id,body.expected_version);
    if(action==="publication-revise")value=await (await createIntegrations(store.db)).publishing.revise(body.id,body.expected_version,body.plan);
    if(action==="publication-publish"){
      if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>!["id","expected_version","expected_account_id","acknowledged"].includes(key)))throw new PublicationValidationError("Unsupported publish-now request field");
      const result=await (await createIntegrations(store.db)).publishing.publishNow(body.id,body.expected_version,body.expected_account_id,body.acknowledged);
      if(result.status!=="published")return response({error:result.status==="uncertain"?"Provider outcome uncertain. Do not retry; reconcile the provider receipt first.":result.status==="failed"?"Publication stopped or rejected. Review the saved plan and attempts; no automatic retry is allowed.":result.status==="disabled"?"Publishing is disabled by server configuration":("reason" in result?result.reason:"Publication is not eligible for delivery"),result},409);
      value=result;
    }

    if(action==="metrics-save")value=await new OwnerReports(store.db).metrics(body);
    if(action==="money-add")value=await new OwnerReports(store.db).money(body);
    if(action==="money-void")value=await new OwnerReports(store.db).voidMoney(body.record,body.reason);
    if(action==="coverage-confirm")value=await new OwnerReports(store.db).coverage(body);
    if(action==="source-stage")value=await new SourceIntake(store.db).stage({text:body.text,category:body.category,reported_date:body.reported_date});
    if(action==="source-clear")value=await new SourceIntake(store.db).clear(String(body.source),String(body.expected_hash),body.acknowledged);
    if(action==="source-revoke")value=await new SourceIntake(store.db).revoke(String(body.source),String(body.expected_hash));
    if(action==="agent-revise")value=await queueAgentRevision(store,c,String(body.task),String(body.expected),body.note);
    if(action==="source")value=await store.source(CAPSULE,"user-reported-notes","2026-10-09",!!c.source_approved&&c.approved_source_hash===hash(CAPSULE));
    if(action==="run"){
      const source=(await store.db.query<any>("SELECT * FROM sources WHERE id=$1",[String(body.source)]))[0];
      const legacy=source?.text===CAPSULE&&source?.hash===hash(CAPSULE);
      if(!legacy&&!sourceAuthorized(c,source))throw Error("Source transmission is not authorized");
      value=await store.enqueue(String(body.source));
    }
    if(action==="approve")value=await store.approve(String(body.task),String(body.version));
    if(action==="owner-message-context"){if(!validOwnerContextInput(body))return response({error:"Exact owner-message context binding required"},400);value=await store.recordOwnerMessageContext(body);}
    if(action==="assistant-evidence-review"){if(!validAssistantEvidenceInput(body))return response({error:"Exact assistant comparison required; actor and policy cannot be supplied"},400);value=await store.reviewAssistantEvidence(body);}
    if(action==="evidence-review")value=await store.reviewEvidence(String(body.task),String(body.expected),body);
    if(action==="request-changes")value=await store.revise(String(body.task),String(body.expected),body.note);
    if(action==="revise")value=await store.revise(String(body.task),String(body.expected),body.note,{role:body.role,text:body.text});
    if(action==="approve-revision")value=await store.approveRevision(String(body.task),String(body.expected),body.acknowledged);
    if(action==="calendar-recover")value=await recoverOverdueCalendarDraft(store.db,body,hostedEnvironment()?120:49);
    if(action==="calendar-configure")value=await new Calendar(store.db,hostedEnvironment()?120:49).configure(body);
    if(action==="calendar-plan")value=await new Calendar(store.db,hostedEnvironment()?120:49).plan(body.weeks);
    if(action==="calendar-link")value=await new Calendar(store.db,hostedEnvironment()?120:49).link(String(body.entry),body.source||null,body.task||null);
    if(action==="calendar-prepare")value=await new Calendar(store.db,hostedEnvironment()?120:49).prepareDue();
    if(action==="cancel")value=await store.cancel(String(body.task));
    if(action==="retry")value=await store.retry(String(body.task));
    if(action==="calendar-dispatch")value=await new Calendar(store.db,hostedEnvironment()?120:49).dispatchDue(c,liveReady(c));
    if(action==="step"){
      await new Calendar(store.db,hostedEnvironment()?120:49).dispatchDue(c,liveReady(c));
      value=await step(store,c);
    }
    return response({result:value??true});
  }catch(error){
    const safe=safeCalendarRecoveryError(error)||safeMediaError(error)||safePublicationError(error)||safeIngestionError(error)||(error instanceof Error&&[...REPORT_ERRORS,"Dispatched calendar task cannot be relinked","Invalid generation activation","Task and calendar platform policies must match","Invalid dispatch time","Completed revision cannot be retried; review its parent content","Revision feedback required (maximum 1000 characters)","Standing OpenAI draft and revision permission required","Revise the parent content task instead","Source not authorized for OpenAI revision","This exact version already has an agent revision request","Agent revision pending; review or cancel it before approval","Invalid source text","Invalid source category","Invalid source date","Source already staged with different metadata","Explicit owner source acknowledgement required","Unknown source","Stale source hash; review the exact source again","Invalid source id","Exact source hash required","Source transmission is not authorized","Source not cleared","Source invalidated","Stale artifact version","Task is not ready for approval","Unknown completion; reconciliation required before retry","Task cannot be retried","Owner draft attempt cannot be replayed","Safety termination cannot be retried","Approved task cannot be cancelled","Unknown task","Task is not ready for revision","Stale revision; refresh before editing","Revision note required","Invalid revision text","Excluded private material","No content change","Human factual review acknowledgement required","No revision to approve","Resolve source-grounding flags before approval","Fresh revision approval required","Invalid calendar date or time","Invalid cadence","Generation lead must be 49 to 336 hours or unset","Generation lead must be 120 to 336 hours or unset","Choose one to four weeks","Choose start date and posting time first","Unknown calendar entry","Task must match the linked source","Invalid platform timing","Preset provenance does not match selected hours","Choose every platform/day posting time first"].includes(error.message)?error.message:"Action blocked or database unavailable");
    return response({error:safe},400);
  }
}
