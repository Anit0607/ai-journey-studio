import {randomUUID} from 'node:crypto';
import {hash,type Task} from './domain';
import type {Connection} from './db';
import {stableJson} from './github-source-policy';
import {assertSourcePrivacy} from './sources';
import {ownerProjectContext} from './owner-project-context';
import {OWNER_MESSAGE_CONTEXT_POLICY,OWNER_MESSAGE_CONTEXT_SCOPE as scope,OWNER_MESSAGE_CONTEXT_STATEMENT as statement,OWNER_MESSAGE_CONTEXT_POLICY_HASH as policyHash} from './owner-message-context-policy';

type Source={id?:string;text:string;hash:string;cleared?:boolean;revoked_at?:unknown};
type Row=Record<string,any>;
export type OwnerMessageContext={eligible:boolean;policy_hash:string|null;version:string|null;status:'unattached'|'active'|'revoked'|'invalid'|'unavailable';quote:string|null;statement:string|null;source_hash:string|null;source_sentences:Array<{start:number;end:number;text:string}>;message_reference:string|null;authorization_reference:string|null;notice:string};
const notice='Owner self-report imported by the assistant, not independent verification or personal owner source review. Technical evidence remains separate; final-post approval is still required.';
const receiptBinding=hash(stableJson({policy:OWNER_MESSAGE_CONTEXT_POLICY,task_id:scope.task_id,source_id:scope.source_id,source_hash:scope.source_hash,project:scope.project}));
const receiptFinding=hash('owner-message-context-receipt|'+policyHash);
const attachReason='Assistant imported the exact owner self-report for this task; no model call, personal owner source review or publication approval.';
const revokeReason='Assistant revoked this task-bound owner-message context; prior receipts remain immutable and earlier reviews cannot be restored.';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const token=(v:unknown)=>typeof v==='string'&&/^(?:original:[a-f0-9]{64}|revision:[a-f0-9-]{36}:[a-f0-9]{64})$/.test(v);
const version=(v:unknown)=>v===null||typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const receiptHash=(row:Row)=>hash(stableJson(Object.fromEntries(['id','task_id','binding','finding_id','decision','policy_version','actor','reason','evidence','context'].map(key=>[key,row[key]]))));
const expectedEvidence=()=>({source_span:{start:0,end:statement.length},source_quote:statement,message_quote:scope.message_quote});
function expectedContext(reviewToken:string,previous:string|null){return {kind:'owner_message_context',task_id:scope.task_id,source_id:scope.source_id,source_hash:scope.source_hash,project:scope.project,policy_hash:policyHash,message_reference:scope.message_reference,authorization_reference:scope.authorization_reference,origin:scope.origin,imported_by:scope.imported_by,message_quote_hash:hash(scope.message_quote),statement_hash:hash(statement),previous_version:previous,review_token:reviewToken,review_token_hash:hash(reviewToken)};}
export function ownerMessageContext(task:Pick<Task,'id'|'source_id'|'source_hash'|'revision_parent_task_id'|'checkpoint'|'status'>,source:Source,rows:Row[]):OwnerMessageContext{
 const candidates=rows.filter(row=>row.policy_version===OWNER_MESSAGE_CONTEXT_POLICY||row.context?.kind==='owner_message_context');
 const eligible=task.id===scope.task_id&&task.checkpoint===6&&['review','approved'].includes(task.status)&&!task.revision_parent_task_id&&task.source_id===scope.source_id&&task.source_hash===scope.source_hash&&source.id===scope.source_id&&source.hash===scope.source_hash&&hash(source.text)===source.hash&&source.cleared===true&&!source.revoked_at&&!!ownerProjectContext(source.text);
 const base:OwnerMessageContext={eligible,policy_hash:eligible?policyHash:null,version:null,status:eligible?'unattached':'unavailable',quote:eligible?scope.message_quote:null,statement:eligible?statement:null,source_hash:eligible?hash(statement):null,source_sentences:eligible?[{start:0,end:statement.length,text:statement}]:[],message_reference:eligible?scope.message_reference:null,authorization_reference:eligible?scope.authorization_reference:null,notice};
 if(!candidates.length)return base;
 try{
  if(!eligible)throw Error();assertSourcePrivacy(scope.message_quote);
  let previous:string|null=null,active=false,lastSequence=0;const ids=new Set<string>();
  for(const row of candidates){
   if(!uuid(row.id)||ids.has(row.id)||!Number.isSafeInteger(Number(row.sequence))||Number(row.sequence)<=lastSequence||row.task_id!==task.id||row.binding!==receiptBinding||row.finding_id!==receiptFinding||row.policy_version!==OWNER_MESSAGE_CONTEXT_POLICY||row.actor!=='assistant'||!['accept','withdraw'].includes(row.decision)||!token(row.context?.review_token))throw Error();
   if((row.decision==='accept'&&active)||(row.decision==='withdraw'&&!active)||row.reason!==(row.decision==='accept'?attachReason:revokeReason)||stableJson(row.evidence)!==stableJson(expectedEvidence())||stableJson(row.context)!==stableJson(expectedContext(row.context.review_token,previous)))throw Error();
   previous=receiptHash(row);active=row.decision==='accept';lastSequence=Number(row.sequence);ids.add(row.id);
  }
  return {...base,version:previous,status:active?'active':'revoked'};
 }catch{return {...base,eligible:false,version:hash('invalid-owner-context|'+stableJson(candidates)),status:'invalid',statement:null,source_hash:null,source_sentences:[]};}
}
/** Only a complete verbatim owner assertion is eligible. No subclaim, paraphrase,
 * prefix, suffix, negation change or mixed technical assertion receives support. */
export function exactOwnerContextClaim(claim:string,context?:OwnerMessageContext):boolean{
 const normalize=(text:string)=>text.trim().replaceAll('’',"'").replace(/\s+/g,' ');
 return context?.status==='active'&&context.eligible&&!!context.version&&context.policy_hash===policyHash&&context.statement===statement&&context.source_hash===hash(statement)&&context.quote===scope.message_quote&&context.message_reference===scope.message_reference&&context.authorization_reference===scope.authorization_reference&&normalize(claim)===normalize(statement);
}
export type OwnerContextInput={task:string;expected:string;policy_hash:string;expected_context_version:string|null;decision:'attach'|'revoke';acknowledged:true};
export function validOwnerContextInput(value:unknown):value is OwnerContextInput{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as OwnerContextInput;
 return Object.keys(v).sort().join('|')==='acknowledged|decision|expected|expected_context_version|policy_hash|task'&&uuid(v.task)&&token(v.expected)&&v.policy_hash===policyHash&&version(v.expected_context_version)&&['attach','revoke'].includes(v.decision)&&v.acknowledged===true;
}
/** Called under existing task/source locks, after pending-revision rejection. */
export async function saveOwnerMessageContext(tx:Connection,task:Task,source:Source,currentToken:string,input:OwnerContextInput){
 if(!validOwnerContextInput(input)||input.task!==task.id||input.expected!==currentToken)throw Error('Exact owner-message context binding required');
 if(!(await tx.query('SELECT version FROM schema_versions WHERE version=23')).length)throw Error('Assistant comparison schema unavailable');
 const rows=await tx.query<Row>('SELECT * FROM evidence_decisions WHERE task_id=$1 ORDER BY sequence',[task.id]),current=ownerMessageContext(task,source,rows);
 if(!current.eligible||current.status==='invalid'||current.policy_hash!==input.policy_hash)throw Error('Owner-message context is not eligible for this task and source');
 if(current.version!==input.expected_context_version)throw Error('Stale owner-message context; refresh before saving');
 if(input.decision==='attach'&&current.status==='active')return {status:'already_attached',version:current.version};
 if(input.decision==='revoke'&&current.status!=='active')throw Error('No active owner-message context to revoke');
 const row={id:randomUUID(),task_id:task.id,binding:receiptBinding,finding_id:receiptFinding,decision:input.decision==='attach'?'accept':'withdraw',policy_version:OWNER_MESSAGE_CONTEXT_POLICY,actor:'assistant',reason:input.decision==='attach'?attachReason:revokeReason,evidence:expectedEvidence(),context:expectedContext(currentToken,current.version)};
 await tx.query("INSERT INTO evidence_decisions(id,task_id,binding,finding_id,decision,policy_version,actor,reason,evidence,context) VALUES($1,$2,$3,$4,$5,$6,'assistant',$7,$8,$9)",[row.id,task.id,row.binding,row.finding_id,row.decision,row.policy_version,row.reason,JSON.stringify(row.evidence),JSON.stringify(row.context)]);
 const savedVersion=receiptHash(row);
 await tx.query("INSERT INTO events(id,task_id,kind,detail) VALUES($1,$2,'owner_message_context_recorded',$3)",[randomUUID(),task.id,JSON.stringify({receipt_id:row.id,decision:input.decision,version:savedVersion,origin:'owner_self_report',imported_by:'assistant',policy_hash:policyHash,source_hash:source.hash,message_reference:scope.message_reference,authorization_reference:scope.authorization_reference,notice})]);
 await tx.query("UPDATE tasks SET status='review',updated=now() WHERE id=$1 AND status='approved'",[task.id]);
 return {status:input.decision==='attach'?'attached_requires_fresh_review':'revoked_requires_fresh_review',version:savedVersion};
}
