import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import CalendarPanel from "../app/calendar-panel";
import OwnerDraftControl from "../app/owner-draft-control";
import {BENCHMARK_PRESET} from "../lib/schedule-presets";
import {NEW_PLATFORM_POLICY,newTaskPlatformBrief} from "../lib/platform-policy";
import {taskPlatformPolicyHash} from "../lib/platform-policy-binding";
const action=async()=>{assert.fail("Rendering cannot execute an action");};

test("new calendar form renders only LinkedIn hours and benchmark without changing legacy input settings",()=>{
 const calendar={settings:{short_days:[1,3,5],long_day:0,start_date:"2030-10-14",post_time:null,generation_lead_hours:120,timing_mode:"per_platform",platform_times:BENCHMARK_PRESET.times,timing_basis:BENCHMARK_PRESET.id,generation_enabled:false},configuration_needed:false,entries:[],minimum_generation_lead_hours:120,scheduler:"Disabled"};
 const before=JSON.stringify(calendar),html=renderToStaticMarkup(createElement(CalendarPanel,{calendar,sources:[],tasks:[],busy:false,action}));
 assert.match(html,/LinkedIn Monday time IST/);assert.match(html,/LinkedIn Sunday time IST/);assert.doesNotMatch(html,/(?:Instagram|X) (?:Monday|Sunday) time IST/);assert.doesNotMatch(html,/href="[^"]*(?:instagram|twitter)/);assert.match(html,/keep existing plans/);assert.match(html,/New plans target LinkedIn only/);assert.equal(JSON.stringify(calendar),before);
});
test("owner draft acknowledgement displays its actual persisted scope rather than the global default",()=>{
 const base={id:"task",updated:"2030-01-01T00:00:00Z",checkpoint:0,status:"queued",origin_key:"manual",source_hash:"source-hash"},source={id:"source",hash:"source-hash",clearance_id:"clearance",cleared:true,text:"Cleared source"},execution={runtime_ready:true,config_hash:"config",model:"fixture",runs:[]};
 for(const content_brief of [{},newTaskPlatformBrief()]){
  const task={...base,content_brief,platform_policy_hash:taskPlatformPolicyHash({content_brief})},html=renderToStaticMarkup(createElement(OwnerDraftControl,{task,source,execution,generationEnabled:true,busy:false,action}));
  if("platform_policy" in content_brief){assert.deepEqual(content_brief.platform_policy,NEW_PLATFORM_POLICY);assert.match(html,/This task produces LinkedIn only/);assert.doesNotMatch(html,/Instagram/);}else assert.match(html,/LinkedIn, X and Instagram \(legacy scope\)/);
  assert.match(html,/does not publish anything/);assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/checked=""/);
 }
});
