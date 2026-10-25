import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import SchedulerWindowNotice from "../app/scheduler-window-notice";
const render=(policy?:Parameters<typeof SchedulerWindowNotice>[0]["policy"])=>renderToStaticMarkup(createElement(SchedulerWindowNotice,{policy}));
test("fixed scheduler notice displays exact returned UTC cadence and exceptions without promising delivery or savings",()=>{
 const policy={mode:"fixed-cadence-v1",valid:true,hash:"a".repeat(64),weekly_utc:["Mon16:30","Wed10:30","Fri09:30","Sun16:30"],exceptions_utc:[],notice:"Configured fixed cadence; explicit approval is still required."};
 const before=JSON.stringify(policy),html=render(policy);for(const value of [...policy.weekly_utc,policy.hash,policy.notice])assert(html.includes(value));assert.match(html,/Exact dated exceptions \(UTC\): none/);assert.match(html,/Calendar form hours are IST/);assert.match(html,/not proof of an active scheduler, on-time delivery or measured cost savings/);assert.match(html,/hidden, unfocused or idle tabs/);assert.equal(JSON.stringify(policy),before);assert.doesNotMatch(html,/<button|<input/);
 assert(render({...policy,exceptions_utc:["2026-10-29T10:30:00Z"]}).includes("2026-10-29T10:30:00Z"));
});
test("invalid policy shows an explicit alert and never presents its proposed times as valid",()=>{
 const html=render({mode:"invalid",valid:false,weekly_utc:["wrong"],notice:"Fixed window policy invalid; delivery blocked."});assert.match(html,/role="alert"/);assert.match(html,/delivery blocked/);assert.doesNotMatch(html,/Weekly posting times|Exact dated exceptions|wrong/);
 assert.equal(render(),"");assert.equal(render({mode:"generic",valid:true}),"");
});
test("Page shows the returned backend notice near Calendar, review and publishing, not a hardcoded ready flag",()=>{
 const source=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");assert.match(source,/\["Overview","Calendar","Approval inbox","Publishing"\].includes\(tab\)&&<SchedulerWindowNotice policy=\{state.integrations\?\.scheduler\?\.window_policy\}/);
});
