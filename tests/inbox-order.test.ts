import test from "node:test";
import assert from "node:assert/strict";
import {inboxGroups,slotLabel} from "../lib/inbox-order";

test('drafts for upcoming unpublished slots come first, soonest first; the rest are folded',()=>{
 const now=new Date("2026-11-05T00:00:00Z");
 const task=(id:string,updated="2026-11-01T00:00:00Z",status="review")=>({id,status,updated});
 const tasks=[task("old-github","2026-10-28T00:00:00Z"),task("published"),task("monday"),task("tuesday"),task("unlinked","2026-11-04T00:00:00Z"),task("past")];
 const entries=[{task_id:"tuesday",intended_post:"2026-11-10T03:30:00Z"},{task_id:"monday",intended_post:"2026-11-09T18:00:00Z"},{task_id:"published",intended_post:"2026-11-06T03:30:00Z"},{task_id:"past",intended_post:"2026-11-03T03:30:00Z"},{task_id:null,intended_post:"2026-11-11T14:00:00Z"}];
 const g=inboxGroups(tasks,entries,[{task_id:"published",status:"published"}],now);
 assert.deepEqual(g.next.map(t=>t.id),["monday","tuesday"]);
 assert.deepEqual(g.other.map(t=>t.id),["unlinked","published","past","old-github"],'newest first');
 assert.equal(slotLabel(g.slot(g.next[0])!),"Mon 09 Nov, 23:30 IST");
 assert.deepEqual(inboxGroups(tasks,undefined,undefined,now).next,[]);
});
