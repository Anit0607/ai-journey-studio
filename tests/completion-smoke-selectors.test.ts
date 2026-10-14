import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import AnalyticsPanel from "../app/analytics-panel";
import UsagePanel from "../app/usage-panel";
import {usageSummary} from "../lib/usage";

const dropdownNames=["Record type","Currency","Usage window"] as const;
test("completion smoke selects native dropdowns by role and stable accessible-name prefix",async()=>{
 const script=await readFile(new URL("../scripts/completion-qa.ts",import.meta.url),"utf8");
 for(const label of dropdownNames){
  assert(script.includes('page.getByRole("combobox",{name:/^'+label+'/})'),label);
  assert(!script.includes('getByLabel("'+label+'",{exact:true})'),label+" must not assume the name excludes option text");
 }
 assert(!script.includes('getByRole("combobox").nth('),"Dropdowns must not rely on their DOM position");
});

test("dropdown label prefixes remain unique in actual rendered report markup with dynamic options",()=>{
 const analyst={periods:["2026-10"],current_month:"2026-10",finances:[],metrics:[],metrics_history:[],money_records:[],notice:"Isolated empty rendering fixture"};
 const html=renderToStaticMarkup(createElement(AnalyticsPanel,{analyst,tasks:[],busy:false,action:async()=>true}))+renderToStaticMarkup(createElement(UsagePanel,{usage:usageSummary([],"2026-10"),tasks:[],outputs:[]}));
 // This is a markup contract test, not a browser accessibility-tree simulation.
 const labels=[...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map(match=>match[1]).filter(body=>body.includes("<select")).map(body=>body.replace(/<[^>]*>/g,""));
 for(const name of dropdownNames){
  const prefix=new RegExp("^"+name),matches=labels.filter(label=>prefix.test(label));
  assert.equal(matches.length,1,name+" must identify one native select");
  assert(matches[0].length>name.length,"Nested option text is present in the label markup");
  assert(prefix.test(name+" Dynamic option"));
  assert(!prefix.test("Unrelated "+name));
 }
});
