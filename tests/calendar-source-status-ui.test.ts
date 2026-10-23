import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import CalendarPanel from "../app/calendar-panel";
import {LEGACY_CALENDAR_BLOCKER} from "../lib/calendar";

const inactiveNotice="No active owner-authorized GitHub source policy matches the current runtime";
const eligibleNotice="Due dispatch selects one unused GitHub evidence item atomically; source availability may change";
const action=async()=>{assert.fail("Rendering source status must not execute an action");};
type Selection={enabled:boolean;eligible_candidates:number;notice:string};
function render(selection?:Selection,entries:any[]=[]){
  const calendar={settings:{short_days:[1,3,5],long_day:0,start_date:"2030-10-14",post_time:"10:00",generation_lead_hours:120,timing_mode:"shared",platform_times:{LinkedIn:{}},timing_basis:"custom",generation_enabled:false},configuration_needed:false,entries,minimum_generation_lead_hours:120,scheduler:"Scheduler setup pending",automatic_source_selection:selection};
  const before=JSON.stringify(calendar),html=renderToStaticMarkup(createElement(CalendarPanel,{calendar,sources:[],tasks:[],busy:false,action}));
  assert.equal(JSON.stringify(calendar),before);
  const draftingToggle=html.match(/<input\b[^>]*aria-label="Enable scheduled OpenAI drafting"[^>]*>/)?.[0];
  assert.ok(draftingToggle);assert.doesNotMatch(draftingToggle,/checked=""/);
  assert.match(html,/Every final post still needs your approval before scheduling and publication/);
  assert.match(html,/This drafting opt-in does not create or expand a source policy/);
  return html;
}

test("disabled source policy is shown as OFF without implying configured access or automatic work",()=>{
  const html=render({enabled:false,eligible_candidates:0,notice:inactiveNotice});
  assert.match(html,/Automatic source selection OFF: no matching active policy/);
  assert.match(html,new RegExp(inactiveNotice));
  assert.match(html,/GitHub access, paid-generation activation and scheduler setup are separate/);
  assert.doesNotMatch(html,/Eligible unused GitHub evidence in this snapshot/);
  assert.doesNotMatch(html,/explicitly cleared linked source|No source or task is selected automatically/);
  assert.match(html,/Planning selects no source and creates no task/);
});

test("matching active policy displays advisory candidates but never claims generation or scheduler readiness",()=>{
  const html=render({enabled:true,eligible_candidates:2,notice:eligibleNotice});
  assert.match(html,/an active policy matches the current runtime scope/);
  assert.match(html,/Eligible unused GitHub evidence in this snapshot: 2/);
  assert.match(html,new RegExp(eligibleNotice));
  assert.match(html,/This snapshot does not reserve evidence or start drafting/);
  assert.match(html,/Scheduler setup pending/);
  assert.match(html,/Automatic selection never replaces existing links/);
});

test("active policy with no eligible evidence shows the backend skip reason",()=>{
  const notice="No unused GitHub evidence matches the approved source scope",html=render({enabled:true,eligible_candidates:0,notice});
  assert.match(html,/Eligible unused GitHub evidence in this snapshot: 0/);
  assert.match(html,new RegExp(notice));
});

test("invalid candidate provenance under an active policy remains a visible skip, not a ready claim",()=>{
  const notice="No eligible unused evidence: Ambiguous multiple provenance records",html=render({enabled:true,eligible_candidates:0,notice});
  assert.match(html,new RegExp(notice));
  assert.doesNotMatch(html,/drafting ready|scheduler ready|automatically queued/i);
});

test("revoked policy renders inactive using the current snapshot rather than previous candidates",()=>{
  assert.match(render({enabled:true,eligible_candidates:1,notice:eligibleNotice}),/snapshot: 1/);
  const html=render({enabled:false,eligible_candidates:0,notice:inactiveNotice});
  assert.match(html,/Automatic source selection OFF/);
  assert.doesNotMatch(html,/snapshot: 1|an active policy matches/);
});

test("invalid or changed runtime scope renders inactive without guessing why authorization is absent",()=>{
  const html=render({enabled:false,eligible_candidates:0,notice:inactiveNotice});
  assert.match(html,new RegExp(inactiveNotice));
  assert.match(html,/Automatic source selection OFF/);
  assert.doesNotMatch(html,/policy revoked|credentials configured|scheduler ready/i);
});

test("revoked or unavailable evidence does not invent eligibility while a policy remains active",()=>{
  const html=render({enabled:true,eligible_candidates:0,notice:"No unused GitHub evidence matches the approved source scope"});
  assert.match(html,/snapshot: 0/);
  assert.match(html,/Dispatch rechecks source authorization, evidence, timing, budget and runtime/);
});

test("missing source-selection snapshot is explicitly unknown rather than enabled or OFF",()=>{
  const html=render();
  assert.match(html,/status unavailable; do not assume it is enabled/);
  assert.doesNotMatch(html,/Automatic source selection OFF|an active policy matches/);
});

test("legacy plans retain their scope and blocker even when automatic selection is active",()=>{
  const entry={id:"legacy",updated:"2030-10-01T00:00:00Z",planned_date:"2030-10-14",kind:"shortform",status:"due_blocked",active_platforms:["LinkedIn","X","Instagram"],platform_policy:null,source_id:null,task_id:null,intended_post:null,review_due:null,generation_due:null,recovery:null,variants:[],job:null,blocked_reasons:[LEGACY_CALENDAR_BLOCKER]};
  const html=render({enabled:true,eligible_candidates:1,notice:eligibleNotice},[entry]);
  assert.match(html,/LinkedIn, X, Instagram \(legacy, unchanged\)/);
  assert.match(html,/Automatic source selection does not apply to this legacy entry/);
  assert.match(html,/This unbound legacy calendar slot cannot create new three-platform work/);
  assert.match(html,/Save explicit links/);
});
