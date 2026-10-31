import {createHash} from 'node:crypto';

/** Opt-in, server-only policy. This is an admission policy, never publication consent. */
// Evidence-based schedule v2 (owner-approved 30 Oct 2026): Mon 23:30 IST global post,
// Tue 09:00 IST India post, Wed 19:30 IST global long-form post, Thu 09:00 IST India post.
export const FIXED_WEEKLY_UTC=['Mon18:00','Tue03:30','Wed14:00','Thu03:30'] as const;
export const OPTIONAL_DATED_UTC='2026-10-29T10:30:00Z';
export const FIXED_WINDOW_LIMITS={intake_window_seconds:240,posting_before_seconds:240,posting_after_seconds:360,max_lateness_seconds:300} as const;
export type SchedulerWindowPolicy={mode:'generic';valid:true;hash:null}|{mode:'invalid';valid:false;hash:null}|{mode:'fixed-cadence-v1';valid:true;hash:string;weekly_utc:string[];exceptions_utc:string[]};
const generic:SchedulerWindowPolicy={mode:'generic',valid:true,hash:null};
const invalid:SchedulerWindowPolicy={mode:'invalid',valid:false,hash:null};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Explicit malformed policies cannot fall back to continuous polling, even when disabled. */
export function schedulerWindowPolicy(scheduler:unknown):SchedulerWindowPolicy{
 if(!record(scheduler)||!Object.hasOwn(scheduler,'window_policy'))return generic;
 const policy=scheduler.window_policy;
 if(!record(policy)||Object.keys(policy).sort().join(',')!=='exceptions_utc,kind,weekly_utc'||policy.kind!=='fixed-cadence-v1'||scheduler.provider!=='qstash'||scheduler.mode!=='external'||scheduler.cadence_seconds!==120||(scheduler.source_interval_minutes!==undefined&&scheduler.source_interval_minutes!==60))return invalid;
 if(!Array.isArray(policy.weekly_utc)||policy.weekly_utc.length!==4||policy.weekly_utc.some(value=>typeof value!=='string')||[...policy.weekly_utc].sort().join(',')!==[...FIXED_WEEKLY_UTC].sort().join(','))return invalid;
 if(!Array.isArray(policy.exceptions_utc)||policy.exceptions_utc.length>1||policy.exceptions_utc.some(value=>value!==OPTIONAL_DATED_UTC))return invalid;
 const values={kind:'fixed-cadence-v1',provider:'qstash',mode:'external',cadence_seconds:120,weekly_utc:[...FIXED_WEEKLY_UTC],exceptions_utc:[...policy.exceptions_utc] as string[],...FIXED_WINDOW_LIMITS};
 return {mode:'fixed-cadence-v1',valid:true,hash:createHash('sha256').update(JSON.stringify(values)).digest('hex'),weekly_utc:values.weekly_utc,exceptions_utc:values.exceptions_utc};
}
export function schedulerWindowStatus(scheduler:unknown){
 const policy=schedulerWindowPolicy(scheduler);
 return {...policy,weekly_utc:policy.mode==='fixed-cadence-v1'?policy.weekly_utc:[],exceptions_utc:policy.mode==='fixed-cadence-v1'?policy.exceptions_utc:[],...FIXED_WINDOW_LIMITS,
 notice:policy.mode==='invalid'?'Invalid explicit scheduler window policy. Scheduling is blocked; there is no continuous-polling fallback.':policy.mode==='generic'?'Generic scheduler cadence; fixed windows are not enabled.':'Hourly source intake uses UTC minutes 00–03:59.999. Publication wakes run from 4 minutes before through 6 minutes after each exact anchor. No provider request is allowed early or more than 5 minutes late. The dated exception is not publication approval.'};
}
const weekly=new Map([[1,'18:00'],[2,'03:30'],[3,'14:00'],[4,'03:30']]);
export function exactSchedulerAnchor(policy:SchedulerWindowPolicy,value:string|Date):boolean{
 const date=new Date(value),milliseconds=date.getTime();
 if(!Number.isFinite(milliseconds)||policy.mode==='invalid')return false;
 if(policy.mode==='generic')return true;
 const canonical=date.toISOString();
 return policy.exceptions_utc.some(at=>Date.parse(at)===milliseconds)||(date.getUTCSeconds()===0&&date.getUTCMilliseconds()===0&&weekly.get(date.getUTCDay())===canonical.slice(11,16));
}
export function schedulerWindowPhase(policy:SchedulerWindowPolicy,now=new Date()):'generic'|'invalid'|'idle'|'intake'|'publication'{
 if(policy.mode==='invalid'||!Number.isFinite(now.getTime()))return 'invalid';
 if(policy.mode==='generic')return 'generic';
 const day=now.toISOString().slice(0,10),time=weekly.get(now.getUTCDay());
 const anchors=[...(time?[Date.parse(`${day}T${time}:00Z`)]:[]),...policy.exceptions_utc.map(Date.parse)];
 if(anchors.some(at=>now.getTime()>=at-FIXED_WINDOW_LIMITS.posting_before_seconds*1000&&now.getTime()<=at+FIXED_WINDOW_LIMITS.posting_after_seconds*1000))return 'publication';
 return now.getTime()%3_600_000<FIXED_WINDOW_LIMITS.intake_window_seconds*1000?'intake':'idle';
}
export const nextUtcIntakeBoundary=(now:Date)=>new Date((Math.floor(now.getTime()/3_600_000)+1)*3_600_000);
export function scheduledPolicyBinding(policy:SchedulerWindowPolicy|undefined,value:string|Date):string|null{
 const current=policy??generic;
 if(!current.valid)throw Error('Invalid scheduler window policy; scheduling is blocked');
 if(!exactSchedulerAnchor(current,value))throw Error('Scheduled publication must match an exact configured UTC anchor');
 return current.hash;
}
