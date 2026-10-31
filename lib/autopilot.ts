import {randomUUID} from "node:crypto";
import type {Database} from "./db";
import type {RuntimeConfig,Source,Task} from "./domain";
import {Store} from "./store";
import {Calendar} from "./calendar";
import {ownerSourceEligible,sourceAuthorized} from "./sources";
import {STORY_MARKER} from "./story-bank-questions";
import {slotBrief} from "./schedule-presets";
import {runOwnerDraft,ownerDraftConfigHash} from "./owner-draft";
import {taskPlatformPolicyHash} from "./platform-policy-binding";
import {hostedOwnerDraftReady} from "./hosted";
import type {Notifier} from "./notify";

export const AUTOPILOT_EVENT="autopilot_draft";
export const AUTOPILOT_DAILY_LIMIT=2;
const HOUR=3_600_000,MIN_LEAD=30*HOUR,MAX_LEAD=7*24*HOUR;
// Signals of a real, first-person episode: something tried, broken, changed or learned.
const SIGNALS=/\b(?:I|I'm|I've|my|we)\b[^.]{0,80}\b(?:tried|built|broke|failed|fixed|learn(?:ed|t)|realis(?:ed|ing)|realiz(?:ed|ing)|mistake|wrong|stuck|surpris(?:ed|ing)|changed|finally|worked|decided|noticed)\b/gi;
const istDay=(date:Date)=>new Date(date.getTime()+330*60_000).toISOString().slice(0,10);

/** Owner stories the agents may draft from: imported chats and Story Bank answers, never used before. */
function storyKind(source:Source){return source.category==="owner-chat"?"chat":source.category==="user-reported-notes"&&source.text.startsWith(STORY_MARKER)?"story":null;}
/** Story agent, step one: rank unused owner stories by concrete episodes and recency. */
export function storyScore(source:Source,now:Date){
  const episodes=(source.text.match(SIGNALS)||[]).length,ageDays=Math.max(0,(now.getTime()-Date.parse(source.reported_date+"T00:00:00Z"))/86_400_000);
  if(episodes===0)return 0;
  return Math.min(episodes,8)*10+(storyKind(source)==="story"?15:0)+Math.max(0,30-ageDays)+Math.min(source.text.length,6000)/1000;
}

type Options={readConfig:()=>RuntimeConfig;notify?:Notifier;dashboard?:string;draft?:typeof runOwnerDraft;isReady?:(config:RuntimeConfig)=>boolean;now?:()=>Date;signal?:AbortSignal;actor:"scheduler"|"assistant"};
export type AutopilotResult={status:"drafted"|"idle"|"blocked"|"limit"|"no_story"|"no_slot";entry?:string;task?:string;reason?:string};

/** One hands-free draft: next free slot, best unused owner story, capped six-stage run, then the slot.
 * Nothing is confirmed, approved, scheduled or published here; the owner approves every post. */
export async function runAutopilot(db:Database,options:Options):Promise<AutopilotResult>{
  const now=(options.now||(()=>new Date()))(),config=options.readConfig();
  if(!(options.isReady||hostedOwnerDraftReady)(config)||config.owner_cleared_sources_authorized!==true)return {status:"blocked",reason:"Drafting is not ready"};
  const settings=(await db.query<{generation_enabled:boolean}>("SELECT generation_enabled FROM calendar_settings WHERE id=1"))[0];
  if(settings?.generation_enabled!==true)return {status:"blocked",reason:"Calendar generation is off"};
  const today=(await db.query<{id:string}>("SELECT id FROM events WHERE kind=$1 AND created>=$2",[AUTOPILOT_EVENT,new Date(Date.parse(istDay(now)+"T00:00:00+05:30"))])).length;
  if(today>=AUTOPILOT_DAILY_LIMIT)return {status:"limit"};
  const entries=await db.query<{id:string;planned_date:string;kind:string;intended_post:string}>("SELECT e.id,e.planned_date,e.kind,e.intended_post FROM calendar_entries e WHERE e.task_id IS NULL AND e.source_id IS NULL AND e.intended_post BETWEEN $1 AND $2 AND NOT EXISTS(SELECT 1 FROM calendar_jobs j WHERE j.entry_id=e.id) AND NOT EXISTS(SELECT 1 FROM github_source_grants g WHERE g.entry_id=e.id) ORDER BY e.intended_post LIMIT 1",[new Date(now.getTime()+MIN_LEAD),new Date(now.getTime()+MAX_LEAD)]);
  const entry=entries[0];if(!entry)return {status:"no_slot"};
  const candidates=(await db.query<Source>("SELECT s.* FROM sources s WHERE s.cleared=true AND s.revoked_at IS NULL AND s.category IN ('owner-chat','user-reported-notes') AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.source_id=s.id) ORDER BY s.created DESC LIMIT 500")).filter(source=>storyKind(source)&&ownerSourceEligible(source,source.hash,"openai",now)&&sourceAuthorized(config,source,"openai",now));
  const best=candidates.map(source=>({source,score:storyScore(source,now)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score)[0];
  if(!best)return {status:"no_story",entry:entry.id};
  const store=new Store(db),brief={kind:entry.kind,planned_date:entry.planned_date,intended_post:new Date(entry.intended_post).toISOString(),...slotBrief(entry.planned_date)};
  const task=await store.enqueue(best.source.id,brief);
  await db.query("INSERT INTO events(id,task_id,kind,detail,created) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,AUTOPILOT_EVENT,"Autopilot ("+(options.actor==="assistant"?"assistant":"daily schedule")+", owner standing consent of 31 Oct 2026) chose this "+storyKind(best.source)+" for the "+new Date(entry.intended_post).toISOString()+" slot and started the capped draft run; nothing is approved",now]);
  const fresh=(await db.query<Task>("SELECT * FROM tasks WHERE id=$1",[task.id]))[0];
  const run=await (options.draft||runOwnerDraft)(db,{task_id:fresh.id,expected_source_id:best.source.id,expected_source_hash:best.source.hash,expected_clearance_id:best.source.clearance_id!,expected_updated:new Date(fresh.updated).toISOString(),expected_checkpoint:0,expected_config_hash:ownerDraftConfigHash(config),expected_platform_policy_hash:taskPlatformPolicyHash(fresh),acknowledged:true},{readConfig:options.readConfig,isReady:options.isReady,signal:options.signal});
  if(run.status!=="review")return {status:"blocked",entry:entry.id,task:task.id,reason:"Draft run "+run.status};
  // The slot is linked only after drafting, matching the capped run's no-calendar precondition.
  try{await new Calendar(db).link(entry.id,best.source.id,task.id);}catch{return {status:"drafted",task:task.id,reason:"Slot was taken meanwhile; choose a slot in Overview"};}
  if(options.notify)await options.notify({title:"Draft ready to approve",message:"A new LinkedIn draft for "+new Date(entry.intended_post).toLocaleString("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false})+" IST is ready. Read it and approve it in the dashboard.",click:options.dashboard});
  return {status:"drafted",entry:entry.id,task:task.id};
}
