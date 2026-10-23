import {enqueueLegacy,legacyCalendarFixture} from "./legacy-task-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {embedded} from "../lib/db";
import {Store} from "../lib/store";
import {OwnerReports} from "../lib/owner-reports";
import {CAPSULE,ROLES,hash,istMonth,type Pricing} from "../lib/domain";
import {COMPLETION_SCHEMA} from "../lib/completion-schema";
import {platformVariants} from "../lib/platform-variants";
import {usageSummary,type LedgerRow} from "../lib/usage";
import {variantFixture} from "./variant-fixture";
import {assertSchemaParity} from "./schema-parity";
import {Calendar} from "../lib/calendar";
const month=istMonth(),p:Pricing={model:"isolated-completion",pricing_version:"test",pricing_tier:"standard",official_pricing_url:"https://example.test",input_microdollars_per_token:"0.4",output_microdollars_per_token:"1.6"};
const critique="Unsupported claims: none\nEvidence needed: cleared notes\nProposed advice: review each draft";
const observation=()=>({request_id:randomUUID(),period:month,platform:"LinkedIn",post_reference:"isolated-post-1",observed_at:new Date(Date.now()-60_000).toISOString(),task_id:null,metrics:{impressions:100,likes:0},source_reference:"Isolated platform report, partial fields",expected_id:null as string|null});
const financial=(overrides:Record<string,unknown>={})=>({request_id:randomUUID(),period:month,currency:"USD",kind:"revenue",category:"revenue",amount_minor:0,source_reference:"Isolated attributable content revenue report",attributable:true,...overrides});
const ledger=(overrides:Partial<LedgerRow>={}):LedgerRow=>({id:randomUUID(),month,role:"Harvester",checkpoint:0,status:"settled",reserved:1000000,estimated:500000,input_tokens:10,output_tokens:10,...overrides});
async function fixture(work:(store:Store,reports:OwnerReports)=>Promise<void>){const db=await embedded();try{await work(new Store(db),new OwnerReports(db));}finally{await db.close();}}
async function completeTask(store:Store,adapter=variantFixture()){
 const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await enqueueLegacy(store,source.id);
 for(const role of ROLES){const text=role==="Critic"?critique:role==="Platform Adapter"?adapter:"Proposed approach: inspect a cleared note.";await store.db.query("INSERT INTO outputs(id,task_id,role,text,hash) VALUES($1,$2,$3,$4,$5)",[randomUUID(),task.id,role,text,hash(text)]);}
 await store.db.query("UPDATE tasks SET status='review',checkpoint=6 WHERE id=$1",[task.id]);return task;
}
async function confirm(reports:OwnerReports,basis="actual_expenses",unit="USD"){
 const report=(await reports.snapshot(await reports.db.query<LedgerRow>("SELECT * FROM ledger"))).finances.find(row=>row.period===month&&row.currency===unit)!;
 return reports.coverage({period:month,currency:unit,basis,input_hash:report.input_hash,source_reference:"Isolated full attributable coverage reviewed",acknowledged:true,revenue_covered:true,costs_covered:true});
}
test("additive completion migration matches schema and seeds no user reports",()=>fixture(async(store)=>{
 assertSchemaParity((await readFile(new URL("../migrations/011_studio_completion.sql",import.meta.url),"utf8")).trim(),COMPLETION_SCHEMA.trim());
 const state=await store.snapshot();assert.equal(state.analyst.status,"insufficient-data");assert.deepEqual(state.analyst.metrics,[]);assert.deepEqual(state.analyst.money_records,[]);assert.equal(state.ledger.length,0);assert(state.analyst.finances.every((row:any)=>row.roi_percent===null&&row.revenue_minor===null));
 await store.db.query("SELECT 1");
}));
test("usage totals reconcile role, legacy, unknown, prior-month reservations and lifetime",()=>{
 const rows=[ledger(),ledger({role:null,checkpoint:null,status:"unknown",estimated:null,input_tokens:null,output_tokens:null,month:"2020-01"}),ledger({role:"Writer",checkpoint:3,status:"settled",estimated:0,input_tokens:null,output_tokens:null})];
 const summary=usageSummary(rows,month);assert.equal(summary.monthly_total.calls,2);assert.equal(summary.lifetime_total.calls,3);assert.equal(summary.lifetime_total.unknown_usage_calls,2);assert.equal(summary.carried_reservations.reserved_microdollars,1000000);assert.equal(summary.lifetime.at(-1)!.calls,1);assert.equal(summary.lifetime.reduce((sum,row)=>sum+row.calls,0),3);assert.equal(summary.lifetime.reduce((sum,row)=>sum+row.estimated_microdollars,0),summary.lifetime_total.estimated_microdollars);
});
test("reservation attribution comes from locked checkpoint, remains immutable after cancellation",()=>fixture(async(store)=>{
 const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true);await enqueueLegacy(store,source.id);const task=(await store.claim())!;
 await assert.rejects(store.reserve({...task,checkpoint:4},"openai",p,100),/stale lease/);
 const reservation=await store.reserve(task,"openai",p,100);await store.cancel(task.id);await store.settle(task,reservation,"Isolated output",1,1,2);
 const row=(await store.db.query<any>("SELECT * FROM ledger"))[0];assert.equal(row.role,"Harvester");assert.equal(row.checkpoint,0);assert.equal(row.status,"settled");
 await assert.rejects(store.db.query("UPDATE ledger SET role='Writer',checkpoint=3 WHERE id=$1",[reservation]),/immutable/);
 await assert.rejects(store.db.query("UPDATE ledger SET role=NULL,checkpoint=NULL WHERE id=$1",[reservation]),/immutable/);
}));
test("legacy ledger rows stay unattributed and cannot be backfilled by guessed order",()=>fixture(async(store)=>{
 const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true),task=await enqueueLegacy(store,source.id);await store.db.query("INSERT INTO budget_months(month) VALUES($1)",[month]);
 await store.db.query("INSERT INTO ledger(id,task_id,month,provider,model,pricing,reserved,status) VALUES($1,$2,$3,'openai','isolated','{}',100,'unknown')",[randomUUID(),task.id,month]);
 const state=await store.snapshot();assert.equal(state.usage.lifetime.at(-1).calls,1);assert.equal(state.ledger[0].role,null);await assert.rejects(store.db.query("UPDATE ledger SET role='Harvester',checkpoint=0"),/immutable/);
}));
test("platform schema rejects incidental X, malformed/missing/duplicate/empty sections and hash mismatch",()=>{
 for(const text of ["EXAMPLE mentions LinkedIn and Instagram","LinkedIn X Instagram", "### LinkedIn\na\n### Instagram\nb","### LinkedIn\na\n### X\n\n### Instagram\nb","### LinkedIn\na\n### X\nb\n### X\nc\n### Instagram\nd","### LinkedIn\na\n### X\nTBD\n### Instagram\nb", "### linkedin\na\n### X\nb\n### Instagram\nc"]){assert.equal(platformVariants({text,hash:hash(text)}).complete,false,text);}
 const text=variantFixture(),parsed=platformVariants({text,hash:hash(text)});assert.equal(parsed.complete,true);assert.equal(new Set(parsed.variants.map(row=>row.hash)).size,3);assert(parsed.variants.every(row=>row.hash!==hash(text)));assert.equal(platformVariants({text,hash:"wrong"}).complete,false);
 const changed=variantFixture().replace("### X\n","### X\nExtra proposed structure. ");const next=platformVariants({text:changed,hash:hash(changed)});assert.equal(next.variants[0].hash,parsed.variants[0].hash);assert.notEqual(next.variants[1].hash,parsed.variants[1].hash);
});
test("both original and revision approval require valid platform variants, while history remains",()=>fixture(async(store)=>{
 const task=await completeTask(store,"EXAMPLE LinkedIn and Instagram");let state=await store.snapshot();assert.equal(state.reviews[0].variants.complete,false);await assert.rejects(store.approve(task.id,state.reviews[0].token.slice(9)),/source-grounding/);
 await store.revise(task.id,state.reviews[0].token,"Use explicit platform sections",{role:"Platform Adapter",text:variantFixture()});state=await store.snapshot();await store.approveRevision(task.id,state.reviews[0].token,true);
 const approved=state.reviews[0].token;await store.revise(task.id,approved,"Remove an incomplete platform draft",{role:"Platform Adapter",text:"### LinkedIn\nProposed approach: review."});state=await store.snapshot();assert(state.reviews[0].history[0].approval);await assert.rejects(store.approveRevision(task.id,state.reviews[0].token,true),/source-grounding/);await assert.rejects(store.approveRevision(task.id,approved,true),/Stale revision/);assert.equal(state.outputs.find((row:any)=>row.role==="Platform Adapter").text,"EXAMPLE LinkedIn and Instagram");
}));
test("calendar never marks incidental X as a complete platform or silently upgrades historical approval",()=>fixture(async(store)=>{
 const task=await completeTask(store,"EXAMPLE LinkedIn and Instagram"),calendar=new Calendar(store.db);await calendar.configure({start_date:"2026-10-14",post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:null});await calendar.plan(1);await legacyCalendarFixture(store);const entry=(await store.db.query<any>("SELECT * FROM calendar_entries"))[0];await calendar.link(entry.id,task.source_id,task.id);
 await store.db.query("INSERT INTO approvals(task_id,version) VALUES($1,'historical')",[task.id]);await store.db.query("UPDATE tasks SET status='approved' WHERE id=$1",[task.id]);const view=await calendar.snapshot(await store.snapshot(),{},false);const row=view.entries.find((item:any)=>item.id===entry.id)!;assert.equal(row.status,"historical_approval_completeness_unverified");assert(row.variants.every((item:any)=>item.artifact_hash===null));assert.equal((await store.db.query("SELECT * FROM approvals")).length,1);
}));
test("metrics are immutable cumulative post snapshots, missing stays unknown and zeros stay zero",()=>fixture(async(store,reports)=>{
 const input=observation();const first:any=await reports.metrics(input);assert.equal((await reports.metrics(input) as any).id,first.id);
 await assert.rejects(reports.metrics({...input,metrics:{impressions:101}}),/different data/);
 await assert.rejects(reports.metrics({...input,request_id:randomUUID()}),/Report changed/);
 const next:any=await reports.metrics({...input,request_id:randomUUID(),expected_id:first.id,metrics:{impressions:150,likes:0}});
 const state=await store.snapshot();assert.equal(state.analyst.metrics.length,1);assert.equal(state.analyst.metrics[0].metrics.impressions,150);assert.equal(state.analyst.metrics[0].metrics.likes,0);assert.equal(state.analyst.metrics[0].metrics.reach,null);assert.equal(state.analyst.metrics_history.length,2);assert.equal(next.sequence,2);
 await assert.rejects(store.db.query("UPDATE owner_metrics SET source_reference='changed'"),/immutable/);assert.equal(state.sources.length,0);assert.equal(state.tasks.length,0);assert.equal(state.ledger.length,0);
}));
test("metrics reject invalid amounts, unknown fields, future observations, private references and stale concurrent edits",()=>fixture(async(_store,reports)=>{
 for(const metrics of [{likes:-1},{likes:0.5},{likes:"3"},{likes:NaN},{likes:1e20},{likes:null},{unknown:1}])await assert.rejects(reports.metrics({...observation(),metrics}));
 await assert.rejects(reports.metrics({...observation(),observed_at:new Date(Date.now()+60_000).toISOString()}),/observation/);
 await assert.rejects(reports.metrics({...observation(),source_reference:"confidential client report"}),/Excluded/);
 const input=observation();const saved:any=await reports.metrics(input);const results=await Promise.allSettled([reports.metrics({...input,request_id:randomUUID(),expected_id:saved.id,metrics:{likes:1}}),reports.metrics({...input,request_id:randomUUID(),expected_id:saved.id,metrics:{likes:2}})]);assert.equal(results.filter(row=>row.status==="fulfilled").length,1);
}));
test("explicit zero revenue and complete coverage enable cash return; missing revenue and zero costs stay unavailable",()=>fixture(async(_store,reports)=>{
 await assert.rejects(confirm(reports),/explicit revenue/);await reports.money(financial());await confirm(reports);let summary=(await reports.snapshot([])).finances.find(row=>row.currency==="USD"&&row.period===month)!;assert.equal(summary.roi_percent,null);assert.match(summary.reason!,/zero costs/);
 await reports.money(financial({kind:"expense",category:"other_expense",amount_minor:1000,source_reference:"Isolated attributable content expense"}));summary=(await reports.snapshot([])).finances.find(row=>row.currency==="USD"&&row.period===month)!;assert.equal(summary.coverage,null);await confirm(reports);summary=(await reports.snapshot([])).finances.find(row=>row.currency==="USD"&&row.period===month)!;assert.equal(summary.roi_percent,-100);assert.equal(summary.net_minor,-1000);
}));
test("money validates integer amounts, attribution, currencies and idempotency; void preserves history and invalidates coverage",()=>fixture(async(store,reports)=>{
 for(const amount_minor of [-1,0.1,NaN,Infinity,"100",1e15])await assert.rejects(reports.money(financial({amount_minor})),/Invalid money/);
 await assert.rejects(reports.money(financial({currency:"EUR"})),/currency/);await assert.rejects(reports.money(financial({attributable:false})),/attribution/);
 const input=financial(),row:any=await reports.money(input);assert.equal((await reports.money(input) as any).id,row.id);await assert.rejects(reports.money({...input,amount_minor:1}),/different data/);await assert.rejects(reports.money({...input,request_id:randomUUID()}),/Duplicate/);
 await confirm(reports);await reports.voidMoney(row.id,"Isolated correction");const state=await store.snapshot();assert(state.analyst.money_records[0].voided);assert.equal(state.analyst.finances.find((item:any)=>item.period===month&&item.currency==="USD").coverage,null);assert.equal(state.analyst.finances.find((item:any)=>item.period===month&&item.currency==="USD").revenue_minor,null);await assert.rejects(store.db.query("DELETE FROM owner_money"),/immutable/);
}));
test("USD and INR stay separate, invoice and estimated bases cannot overlap, unknown usage blocks estimated return",()=>fixture(async(store,reports)=>{
 await reports.money(financial({amount_minor:20000}));await reports.money(financial({currency:"INR",amount_minor:10000}));await assert.rejects(confirm(reports,"estimated_ai"),/No recorded AI usage/);await assert.rejects(confirm(reports,"estimated_ai","INR"),/USD/);
 const source=await store.source(CAPSULE,"user-reported-notes","2026-10-09",true);await enqueueLegacy(store,source.id);const task=(await store.claim())!,reservation=await store.reserve(task,"openai",p,1000000);await assert.rejects(confirm(reports,"estimated_ai"),/Unknown AI usage/);await store.settle(task,reservation,"Isolated output",10,10,500000);
 await confirm(reports);await confirm(reports,"estimated_ai");await confirm(reports);assert.equal((await store.snapshot()).analyst.finances.find((row:any)=>row.period===month&&row.currency==="USD").basis,"actual_expenses");await confirm(reports,"estimated_ai");let report=(await store.snapshot()).analyst.finances.find((row:any)=>row.period===month&&row.currency==="USD");assert.equal(report.roi_percent,39900);assert.equal(report.net_minor,19950);
 await reports.money(financial({kind:"expense",category:"ai_invoice",amount_minor:100,source_reference:"Isolated paid AI invoice"}));await assert.rejects(confirm(reports,"estimated_ai"),/no actual AI invoices/);await confirm(reports);report=(await store.snapshot()).analyst.finances.find((row:any)=>row.period===month&&row.currency==="USD");assert.equal(report.roi_percent,19900);assert.equal(report.net_minor,19900);assert.equal(report.ai_estimated_microdollars,500000);
 const inr=(await store.snapshot()).analyst.finances.find((row:any)=>row.period===month&&row.currency==="INR");assert.equal(inr.revenue_minor,10000);assert.equal(inr.roi_percent,null);assert.match(inr.ai_cost_notice,/No exchange rate/);
}));

test("calendar follows latest unapproved revision instead of original approved task status",()=>fixture(async(store)=>{
 const task=await completeTask(store),calendar=new Calendar(store.db);let state=await store.snapshot();await store.approve(task.id,state.reviews[0].token.slice(9));await calendar.configure({start_date:"2026-10-14",post_time:"10:00",short_days:[1,3,5],long_day:0,generation_lead_hours:null});await calendar.plan(1);await legacyCalendarFixture(store);const entry=(await store.db.query<any>("SELECT * FROM calendar_entries"))[0];await calendar.link(entry.id,task.source_id,task.id);
 state=await store.snapshot();await store.revise(task.id,state.reviews[0].token,"Adjust proposed structure",{role:"Platform Adapter",text:variantFixture("Proposed approach: inspect a single artifact.")});state=await store.snapshot();const row=(await calendar.snapshot(state,{},false)).entries.find((item:any)=>item.id===entry.id)!;assert.equal(row.status,"review_needed");assert.equal(state.tasks[0].status,"approved");assert.equal(state.approvals.length,1);assert.equal(state.reviews[0].approval,null);assert(row.variants.every((item:any)=>item.status==="review_needed"));
}));

test("platform headings inside code examples or indentation never prove completeness",()=>{
 for(const fence of ["```text","~~~text"]){const text="### LinkedIn\nProposed approach: inspect this format.\n"+fence+"\n### X\nDraft\n### Instagram\nDraft\n"+fence.slice(0,3);assert.equal(platformVariants({text,hash:hash(text)}).complete,false);const unclosed=text.slice(0,-3);assert.equal(platformVariants({text:unclosed,hash:hash(unclosed)}).complete,false);}
 const indented="### LinkedIn\nDraft\n    ### X\nDraft\n    ### Instagram\nDraft";assert.equal(platformVariants({text:indented,hash:hash(indented)}).complete,false);
});
test("voiding an added record never resurrects previous cost coverage",()=>fixture(async(_store,reports)=>{
 await reports.money(financial());await confirm(reports);const before=(await reports.snapshot([])).finances.find(row=>row.period===month&&row.currency==="USD")!;assert(before.coverage);
 const row:any=await reports.money(financial({kind:"expense",category:"other_expense",amount_minor:100,source_reference:"Isolated correction candidate"}));await reports.voidMoney(row.id,"Isolated erroneous entry");const after=(await reports.snapshot([])).finances.find(row=>row.period===month&&row.currency==="USD")!;assert.equal(after.coverage,null);assert.notEqual(after.input_hash,before.input_hash);assert.equal(after.roi_percent,null);
}));

test("reporting rejects normalized invalid observation dates and bounds exact aggregate minor units",()=>fixture(async(_store,reports)=>{
 await assert.rejects(reports.metrics({...observation(),period:"2026-03",observed_at:"2026-02-30T00:00:00.000Z"}),/observation/);
 await reports.money(financial({amount_minor:1000000000000}));await assert.rejects(reports.money(financial({amount_minor:1,source_reference:"Isolated additional revenue"})),/Invalid money/);
}));
