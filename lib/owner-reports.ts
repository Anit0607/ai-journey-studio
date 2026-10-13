import {randomUUID} from "node:crypto";
import type {Database,Connection} from "./db";
import {hash,istMonth} from "./domain";
import {assertSourcePrivacy} from "./sources";
import {REQUIRED_PLATFORMS} from "./platform-variants";
import type {LedgerRow} from "./usage";
export const METRIC_KEYS=["impressions","reach","likes","comments","shares","clicks"] as const;
export const REPORT_ERRORS=["Invalid report period","Invalid report currency","Invalid report request id","Invalid report source reference","Invalid platform metrics","Invalid post observation","Explicit content attribution required","Revenue coverage requires an explicit revenue record","Report changed; refresh before saving","Request id already used for different data","Invalid money record","Duplicate money record; void the old record before correcting it","Unknown money record","Explicit cost coverage acknowledgement required","Cost coverage changed; review current records","Estimated AI costs require USD and no actual AI invoices","Unknown AI usage prevents estimated return","No recorded AI usage for this period"];
type Money={id:string;request_id:string;period:string;currency:string;kind:string;category:string;amount_minor:string|number;source_reference:string;created:string};
function period(value:unknown):asserts value is string{if(typeof value!=="string"||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)||value>istMonth())throw Error("Invalid report period");}
function currency(value:unknown):asserts value is string{if(value!=="USD"&&value!=="INR")throw Error("Invalid report currency");}
function id(value:unknown):asserts value is string{if(typeof value!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw Error("Invalid report request id");}
function reference(value:unknown):asserts value is string{if(typeof value!=="string"||value.trim().length<3||value.length>300||/[\u0000-\u001f\u007f]/.test(value))throw Error("Invalid report source reference");assertSourcePrivacy(value);}
async function guard(tx:Connection){await tx.query("SELECT id FROM owner_report_guard WHERE id=1 FOR UPDATE");}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function coverageHash(rows:Money[],ledger:LedgerRow[],month:string,unit:string,voids:{record_id:string;reason:string}[]=[]){
  return hash(JSON.stringify({period:month,currency:unit,money:rows.filter(row=>row.period===month&&row.currency===unit).map(row=>({id:row.id,kind:row.kind,category:row.category,amount:String(row.amount_minor),void_reason:voids.find(item=>item.record_id===row.id)?.reason||null})).sort((a,b)=>a.id.localeCompare(b.id)),ledger:ledger.filter(row=>row.month===month).map(row=>({id:row.id,status:row.status,estimated:row.estimated===null?null:String(row.estimated),input:row.input_tokens===null?null:String(row.input_tokens),output:row.output_tokens===null?null:String(row.output_tokens)})).sort((a,b)=>a.id.localeCompare(b.id))}));
}
async function activeMoney(tx:Connection){return tx.query<Money>("SELECT m.* FROM owner_money m LEFT JOIN owner_money_voids v ON v.record_id=m.id WHERE v.record_id IS NULL ORDER BY m.created,m.id");}
function estimatedIssue(ledger:LedgerRow[],month:string){const rows=ledger.filter(row=>row.month===month);return !rows.length?"No recorded AI usage for this period":rows.some(row=>row.status!=="settled"||row.estimated===null||row.input_tokens===null||row.output_tokens===null)?"Unknown AI usage prevents estimated return":null;}
export class OwnerReports{
  constructor(readonly db:Database){}
  async metrics(input:{request_id:unknown;period:unknown;platform:unknown;metrics:unknown;source_reference:unknown;expected_id:unknown;post_reference:unknown;observed_at:unknown;task_id:unknown}){
    id(input.request_id);period(input.period);reference(input.source_reference);reference(input.post_reference);
    if(typeof input.observed_at!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(input.observed_at)||!Number.isFinite(Date.parse(input.observed_at))||Date.parse(input.observed_at)>Date.now()||new Date(input.observed_at).toISOString()!==input.observed_at||istMonth(new Date(input.observed_at))!==input.period)throw Error("Invalid post observation");
    if(input.task_id!==null)id(input.task_id);
    if(!REQUIRED_PLATFORMS.includes(input.platform as any)||!input.metrics||typeof input.metrics!=="object"||Array.isArray(input.metrics))throw Error("Invalid platform metrics");
    const metrics=input.metrics as Record<string,unknown>;
    if(Object.keys(metrics).some(key=>!METRIC_KEYS.includes(key as any))||!Object.keys(metrics).length||Object.values(metrics).some(value=>value!==null&&(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>1e12))||Object.values(metrics).every(value=>value===null))throw Error("Invalid platform metrics");
    const normalized=Object.fromEntries(METRIC_KEYS.map(key=>[key,metrics[key]??null])),source=String(input.source_reference).trim();
    return this.db.transaction(async tx=>{
      await guard(tx);
      const duplicate=(await tx.query<any>("SELECT * FROM owner_metrics WHERE request_id=$1",[input.request_id]))[0];
      if(duplicate){if(duplicate.period!==input.period||duplicate.platform!==input.platform||duplicate.post_reference!==String(input.post_reference).trim()||new Date(duplicate.observed_at).toISOString()!==new Date(String(input.observed_at)).toISOString()||duplicate.task_id!==input.task_id||duplicate.source_reference!==source||!same(Object.fromEntries(METRIC_KEYS.map(key=>[key,duplicate.metrics[key]??null])),normalized))throw Error("Request id already used for different data");return duplicate;}
      const current=(await tx.query<any>("SELECT * FROM owner_metrics WHERE post_reference=$1 AND platform=$2 ORDER BY sequence DESC LIMIT 1",[String(input.post_reference).trim(),input.platform]))[0];
      if((current?.id||null)!==input.expected_id)throw Error("Report changed; refresh before saving");
      if(current&&Date.parse(String(input.observed_at))<new Date(current.observed_at).getTime())throw Error("Invalid post observation");
      if(input.task_id!==null&&!(await tx.query("SELECT id FROM tasks WHERE id=$1 AND revision_parent_task_id IS NULL",[input.task_id])).length)throw Error("Invalid post observation");
      return (await tx.query("INSERT INTO owner_metrics(id,request_id,period,platform,sequence,metrics,source_reference,post_reference,observed_at,task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[randomUUID(),input.request_id,input.period,input.platform,(current?.sequence||0)+1,JSON.stringify(normalized),source,String(input.post_reference).trim(),input.observed_at,input.task_id]))[0];
    });
  }
  async money(input:{request_id:unknown;period:unknown;currency:unknown;kind:unknown;category:unknown;amount_minor:unknown;source_reference:unknown;attributable:unknown}){
    id(input.request_id);period(input.period);currency(input.currency);reference(input.source_reference);
    if(input.attributable!==true)throw Error("Explicit content attribution required");
    if(!["revenue","expense"].includes(String(input.kind))||!(input.kind==="revenue"?input.category==="revenue":["other_expense","ai_invoice"].includes(String(input.category)))||!Number.isSafeInteger(input.amount_minor)||Number(input.amount_minor)<0||Number(input.amount_minor)>1e12)throw Error("Invalid money record");
    const source=String(input.source_reference).trim();
    return this.db.transaction(async tx=>{
      await guard(tx);
      const duplicate=(await tx.query<Money>("SELECT * FROM owner_money WHERE request_id=$1",[input.request_id]))[0];
      if(duplicate){if(duplicate.period!==input.period||duplicate.currency!==input.currency||duplicate.kind!==input.kind||duplicate.category!==input.category||Number(duplicate.amount_minor)!==input.amount_minor||duplicate.source_reference!==source)throw Error("Request id already used for different data");return duplicate;}
      const active=await activeMoney(tx);
      if(active.filter(row=>row.period===input.period&&row.currency===input.currency).reduce((sum,row)=>sum+BigInt(row.amount_minor),0n)+BigInt(Number(input.amount_minor))>1000000000000n)throw Error("Invalid money record");
      if(active.some(row=>row.period===input.period&&row.currency===input.currency&&row.kind===input.kind&&row.source_reference===source))throw Error("Duplicate money record; void the old record before correcting it");
      return (await tx.query("INSERT INTO owner_money(id,request_id,period,currency,kind,category,amount_minor,source_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[randomUUID(),input.request_id,input.period,input.currency,input.kind,input.category,input.amount_minor,source]))[0];
    });
  }
  async voidMoney(record:unknown,reason:unknown){
    id(record);reference(reason);
    return this.db.transaction(async tx=>{await guard(tx);if(!(await tx.query("SELECT id FROM owner_money WHERE id=$1",[record])).length)throw Error("Unknown money record");await tx.query("INSERT INTO owner_money_voids(record_id,reason) VALUES($1,$2) ON CONFLICT DO NOTHING",[record,reason.trim()]);return true;});
  }
  async coverage(input:{period:unknown;currency:unknown;basis:unknown;input_hash:unknown;source_reference:unknown;acknowledged:unknown;revenue_covered:unknown;costs_covered:unknown}){
    period(input.period);currency(input.currency);reference(input.source_reference);
    if(input.acknowledged!==true||input.revenue_covered!==true||input.costs_covered!==true||!["actual_expenses","estimated_ai"].includes(String(input.basis)))throw Error("Explicit cost coverage acknowledgement required");
    return this.db.transaction(async tx=>{
      await guard(tx);
      const history=await tx.query<Money>("SELECT * FROM owner_money ORDER BY created,id"),voids=await tx.query<{record_id:string;reason:string}>("SELECT * FROM owner_money_voids"),records=history.filter(row=>!voids.some(item=>item.record_id===row.id)),ledger=await tx.query<LedgerRow>("SELECT * FROM ledger"),fingerprint=coverageHash(history,ledger,String(input.period),String(input.currency),voids);
      if(!records.some(row=>row.period===input.period&&row.currency===input.currency&&row.kind==="revenue"))throw Error("Revenue coverage requires an explicit revenue record");
      if(input.input_hash!==fingerprint)throw Error("Cost coverage changed; review current records");
      if(input.basis==="estimated_ai"){
        if(input.currency!=="USD"||records.some(row=>row.period===input.period&&row.currency===input.currency&&row.category==="ai_invoice"))throw Error("Estimated AI costs require USD and no actual AI invoices");
        const issue=estimatedIssue(ledger,String(input.period));if(issue)throw Error(issue);
      }
      const existing=(await tx.query("SELECT * FROM owner_coverage WHERE period=$1 AND currency=$2 ORDER BY sequence DESC LIMIT 1",[input.period,input.currency]))[0];
      if(existing&&existing.basis===input.basis&&existing.input_hash===fingerprint&&existing.source_reference===String(input.source_reference).trim())return existing;
      return (await tx.query("INSERT INTO owner_coverage(id,period,currency,basis,input_hash,source_reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[randomUUID(),input.period,input.currency,input.basis,fingerprint,String(input.source_reference).trim()]))[0];
    });
  }
  async snapshot(ledger:LedgerRow[]){
    const history=await this.db.query<any>("SELECT * FROM owner_metrics ORDER BY platform,post_reference,sequence"),money=await this.db.query<Money>("SELECT * FROM owner_money ORDER BY created,id"),voids=await this.db.query<any>("SELECT * FROM owner_money_voids ORDER BY created"),coverage=await this.db.query<any>("SELECT * FROM owner_coverage ORDER BY sequence");
    const latest=new Map<string,any>();for(const row of history)latest.set(row.platform+":"+row.post_reference,row);
    const metrics=[...latest.values()],active=money.filter(row=>!voids.some(item=>item.record_id===row.id));
    const periods=[...new Set([istMonth(),...metrics.map(row=>row.period),...money.map(row=>row.period),...ledger.map(row=>row.month)])].sort().reverse();
    const finances=periods.flatMap(month=>["USD","INR"].map(unit=>{
      const records=active.filter(row=>row.period===month&&row.currency===unit),revenue=records.filter(row=>row.kind==="revenue"),expenses=records.filter(row=>row.kind==="expense");
      const revenueMinor=revenue.reduce((sum,row)=>sum+Number(row.amount_minor),0),expenseMinor=expenses.reduce((sum,row)=>sum+Number(row.amount_minor),0),inputHash=coverageHash(money,ledger,month,unit,voids);
      const latestCoverage=coverage.filter(row=>row.period===month&&row.currency===unit).at(-1);
      const confirmed=latestCoverage?.input_hash===inputHash?latestCoverage:null;
      const ai=ledger.filter(row=>row.month===month),unknownAi=ai.filter(row=>row.status!=="settled"||row.estimated===null||row.input_tokens===null||row.output_tokens===null).length;
      const aiEstimate=ai.filter(row=>row.status==="settled"&&row.estimated!==null).reduce((sum,row)=>sum+Number(row.estimated),0);
      const basis=confirmed?.basis||null;
      let reason=!revenue.length?"Record revenue explicitly, including zero if none was earned":!confirmed?"Confirm complete cost coverage for these current records":null;
      if(!reason&&basis==="estimated_ai")reason=unit!=="USD"||expenses.some(row=>row.category==="ai_invoice")?"Actual AI invoices and estimates cannot be added together":estimatedIssue(ledger,month);
      // USD cents -> microdollars exactly; INR calculations stay entirely in paise.
      const costUnits=basis==="estimated_ai"?BigInt(expenseMinor)*10000n+BigInt(aiEstimate):BigInt(expenseMinor);
      const revenueUnits=basis==="estimated_ai"?BigInt(revenueMinor)*10000n:BigInt(revenueMinor);
      const net=reason?null:revenueUnits-costUnits,roi=reason||costUnits===0n?null:(Number(revenueUnits-costUnits)/Number(costUnits))*100;
      return {period:month,currency:unit,revenue_recorded:revenue.length>0,revenue_minor:revenue.length?revenueMinor:null,expense_minor:expenseMinor,record_count:records.length,input_hash:inputHash,coverage:confirmed||null,basis,net_minor:net===null?null:basis==="estimated_ai"?Number(net)/10000:Number(net),roi_percent:roi,reason:reason||(costUnits===0n?"Return percentage is undefined with zero costs":null),ai_estimated_microdollars:aiEstimate,unknown_ai_calls:unknownAi,unresolved_reserved_microdollars:ai.filter(row=>row.status!=="settled").reduce((sum,row)=>sum+Number(row.reserved),0),ai_cost_notice:unit==="INR"?"USD token estimates are excluded. No exchange rate is assumed; actual AI expenses must be recorded in INR before confirming full cash-cost coverage.":basis==="estimated_ai"?"Includes reported-token estimates, not invoices. Actual AI invoices are excluded by validation.":"Token estimates are shown separately and never added to paid expenses.",cash_return_label:basis==="estimated_ai"?"Estimated return including AI token costs":"Tracked attributable cash return",notices:"Owner-entered records only. Unrecorded time, taxes and costs are not inferred. No profit, causality or future earnings claim."};
    }));
    return {current_month:istMonth(),status:metrics.length?"owner-reported":"insufficient-data",reason:metrics.length?"Summaries reflect only the platform reports you entered; no automated recommendations or provider calls.":"No real platform metrics entered",metrics,metrics_history:history,money_records:money.map(row=>({...row,voided:voids.find(item=>item.record_id===row.id)||null})),finances,periods,metric_keys:METRIC_KEYS,notice:"Owner-entered cumulative post snapshots. Only the latest observation for each exact platform/post reference is shown; historical snapshots are never added together. Missing values stay unknown and platforms are not combined. Source coverage is self-reported, not independently verified."};
  }
}
