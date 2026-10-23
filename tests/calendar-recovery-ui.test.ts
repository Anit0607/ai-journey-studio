import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import CalendarRecoveryForm from "../app/calendar-recovery-form";
const recovery:{eligible:boolean;reason:string|null;expected:string;task_review_due:string}={eligible:true,reason:null,expected:"0".repeat(64),task_review_due:"2026-10-20T00:00:00.000Z"};
const render=(value:typeof recovery|null,busy=false)=>renderToStaticMarkup(createElement(CalendarRecoveryForm,{entryId:"entry",recovery:value,minimumLeadHours:120,busy,action:async()=>{}}));
test("recovery is an explicit action, absent without an overdue draft, disabled when busy and unavailable for unsafe states",()=>{
 assert.equal(render(null),"");assert.match(render(recovery),/Replan overdue draft/);assert.doesNotMatch(render(recovery),/Cancel old draft and save future plan/);
 assert.match(render(recovery,true),/<button disabled="">Replan overdue draft/);
 const blocked=render({...recovery,eligible:false,reason:"Unknown usage needs reconciliation"});assert.match(blocked,/Recovery unavailable/);assert.doesNotMatch(blocked,/<button/);
});
test("form captures an exact version, resets consent on edits, avoids immediate queue and guards duplicate submission",()=>{
 const form=readFileSync(new URL("../app/calendar-recovery-form.tsx",import.meta.url),"utf8"),calendar=readFileSync(new URL("../app/calendar-panel.tsx",import.meta.url),"utf8");
 assert.match(form,/setExpected\(recovery.expected\)/);assert.match(form,/expected!==recovery.expected/);assert.match(form,/inFlight.current=true/);assert.match(form,/acknowledged:true/);assert.match(form,/setAck\(false\)/);
 assert.match(form,/No draft is queued now/);assert.match(form,/same exact cleared source/);assert.match(form,/without copying approvals/);assert.match(form,/LinkedIn only for this new plan/);assert.match(form,/cancelled original keeps its historical platform scope/);assert.match(form,/Keep old draft/);assert.doesNotMatch(form,/action\("(?:step|run|calendar-dispatch)"/);
 assert.match(calendar,/<CalendarRecoveryForm/);
});
