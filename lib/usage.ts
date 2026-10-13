import {ROLES,istMonth} from "./domain";
export type LedgerRow={id:string;month:string;role?:string|null;checkpoint?:number|null;status:string;reserved:string|number;estimated:string|number|null;input_tokens:string|number|null;output_tokens:string|number|null};
const total=()=>({calls:0,settled_calls:0,estimated_microdollars:0,input_tokens:0,output_tokens:0,unknown_usage_calls:0,unresolved_calls:0,reserved_microdollars:0});
function aggregate(rows:LedgerRow[]){
  const result=total();
  for(const row of rows){
    result.calls++;
    if(row.status==="settled"){result.settled_calls++;if(row.estimated!==null)result.estimated_microdollars+=Number(row.estimated);}
    else {result.unresolved_calls++;result.reserved_microdollars+=Number(row.reserved);}
    if(row.input_tokens!==null)result.input_tokens+=Number(row.input_tokens);
    if(row.output_tokens!==null)result.output_tokens+=Number(row.output_tokens);
    // Rejected calls can settle at zero without reported tokens. Never relabel as known zero usage.
    if(row.input_tokens===null||row.output_tokens===null||row.estimated===null)result.unknown_usage_calls++;
  }
  return result;
}
export function usageSummary(rows:LedgerRow[],month=istMonth()){
  const roles=[...ROLES,"Unattributed"];
  const grouped=(records:LedgerRow[])=>roles.map(role=>({role,...aggregate(records.filter(row=>role==="Unattributed"?!row.role:row.role===role))}));
  const by_month=Object.fromEntries([...new Set([month,...rows.map(row=>row.month)])].sort().reverse().map(value=>[value,{roles:grouped(rows.filter(row=>row.month===value)),total:aggregate(rows.filter(row=>row.month===value))}]));
  return {by_month,month,monthly:grouped(rows.filter(row=>row.month===month)),lifetime:grouped(rows),monthly_total:aggregate(rows.filter(row=>row.month===month)),lifetime_total:aggregate(rows),carried_reservations:aggregate(rows.filter(row=>row.month!==month&&row.status!=="settled")),basis:"Provider-reported token estimates, not paid invoices. Legacy calls have no reliable role attribution."};
}
