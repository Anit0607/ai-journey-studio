"use client";
type Row=Record<string,any>;
const money=(value:number|null)=>value===null?'unknown':'$'+(value/1_000_000).toFixed(6);
const originLabel=(kind:string)=>kind==='manual_edit'?'Manual editor change, not an agent run':kind==='agent_revision'?'Saved agent-revision output':kind==='saved_original'?'Saved original-run artifact':'Origin not recorded or cannot be verified';
export default function AgentContributionsPanel({contributions,profile}:{contributions:Row;profile?:Row}){
 if(!contributions)return null;
 return <section aria-label="Six-agent contributions"><h3>What each agent actually produced</h3><p>{contributions.notice}</p>
  {profile&&<details><summary>Writing style configured for future eligible drafts · {profile.version}</summary><p>{profile.reference}. {profile.method}</p><p>Used by Strategist, Writer, Platform Adapter and Critic for LinkedIn drafts. Facts still come only from the cleared source. This does not change old outputs or prove an earlier run used this profile.</p><pre>{profile.guidance}</pre><small>Profile SHA-256 {profile.hash}</small></details>}
  {contributions.unattributed_calls>0&&<p>{contributions.unattributed_calls} call(s) have no reliable stage attribution.</p>}
  {contributions.roles.map((item:Row)=><article key={item.role}><h4>{item.checkpoint+1}. {item.role}</h4><p><strong>Responsibility:</strong> {item.purpose}</p><p><strong>Current artifact:</strong> {originLabel(item.current_origin.kind)}{item.current_origin.revision_id?' · revision '+item.current_origin.revision_id.slice(0,8):''}</p>
   <p>{item.usage.attempts} recorded attempt(s) across this task and its agent revisions · {item.usage.settled} settled. Known settled estimate {money(item.usage.known_estimate_microdollars)}. {item.usage.unknown_usage_calls>0?`${item.usage.unknown_usage_calls} call(s) have unresolved or unknown usage.`:''}</p>
   {item.runs.map((run:Row)=><details key={run.task_id}><summary>{run.kind==='agent_revision'?'Agent revision':'Original run'} {run.task_id.slice(0,8)} · {run.status} · {run.output?'artifact saved':'no saved artifact'}</summary>
    {run.usage.attempts===0&&<p>No stage ledger records. Cost and token totals are not recorded, not zero.</p>}
    <p>Recorded input tokens: {run.usage.input_tokens??'unknown'} · output tokens: {run.usage.output_tokens??'unknown'} · settled estimate: {money(run.usage.estimated_microdollars)} · unresolved reservation: {money(run.usage.unresolved_reserved_microdollars)}</p>
    <p>Reservation-to-artifact elapsed: {run.elapsed_ms===null?'not recorded or ambiguous':(run.elapsed_ms/1000).toFixed(3)+' seconds, including application overhead; not pure model latency'}.</p>
    {run.attempts.map((attempt:Row)=><div key={attempt.id}><p>{attempt.provider} · {attempt.model} · {attempt.status} · completion {attempt.completion_status||'unknown'}</p>{attempt.prepared?<details><summary>Prompt/style receipt · {attempt.receipt_state==='saved_output_recorded'?'linked to saved output':'prepared/reserved, not proof of transmission'}</summary><p>Style: {attempt.prepared.writing_profile?attempt.prepared.writing_profile.version+' · '+attempt.prepared.writing_profile.hash:'not applied at this role'}</p><p>Current-task inputs: source {attempt.prepared.source_hash}; prior roles {attempt.prepared.prior_artifacts.map((p:Row)=>p.role).join(', ')||'none'}. Revision feedback, if any, remains separately source-bound.</p><small>Complete prompt SHA-256 {attempt.prepared.prompt_hash}. Raw prompt text is not stored in this receipt.</small></details>:<p>Historical prompt/style version not recorded. The current profile is not attributed to this call.</p>}</div>)}
    {run.output&&<details><summary>Inspect the actual saved {item.role} output</summary><pre>{run.output.text}</pre><small>SHA-256 {run.output.hash}</small></details>}
   </details>)}
  </article>)}
 </section>;
}
