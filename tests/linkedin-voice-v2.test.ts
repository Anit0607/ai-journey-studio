import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash,ROLES,type Task,type Source} from '../lib/domain';
import {OWNER_WRITING_PROFILE,writingProfileFor,ownerWritingPrompt,linkedinVoiceDiagnostics} from '../lib/owner-writing-profile';
import {buildDraftPrompt} from '../lib/draft-prompt';
import {draftPromptMetadata,validPromptMetadata,assertPromptMetadata} from '../lib/draft-run-receipt';
import {draftArtifactContract,providerResponseFormatBytes} from '../lib/critic-response-format';
import {comparisonPolicy,comparisonPolicyAuthorized,comparisonPolicyRecordedPermission,CORRECTED_COMPARISON_SCOPE,CORRECTED_COMPARISON_SCOPE_HASH,currentComparisonPromptPolicyHash} from '../lib/private-comparison-scopes';
import {evidenceFindings} from '../lib/evidence-review';
import {NEW_PLATFORM_POLICY} from '../lib/platform-policy';
import {type Artifact} from '../lib/grounding';
import {canonicalNoteArtifacts} from './canonical-note-helpers';
const snapshot=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-context-2026-10-25.json',import.meta.url),'utf8'));
const events=JSON.parse(readFileSync(new URL('./fixtures/private-comparison-predecessor-2026-10-25.json',import.meta.url),'utf8'));
const source=snapshot.context.source as Source;
const artifacts:Artifact[]=events.filter((a:any)=>a.kind==='private_comparison_stage').map((a:any)=>{const d=JSON.parse(a.detail);return {role:d.role,text:d.text,hash:d.hash};});
const task=(checkpoint:number,kind='longform')=>({...snapshot.context.task,checkpoint,content_brief:{...snapshot.context.task.content_brief,kind}} as Task);
const artifact=(role:string,text:string):Artifact=>({role,text,hash:hash(text)});

test('merged example yields versioned style-only preferences and vocabulary examples, not copied facts or a humanizer score',()=>{
 assert.equal(OWNER_WRITING_PROFILE.version,'owner-style-v2-2026-10-26');assert.equal(OWNER_WRITING_PROFILE.hash,hash(OWNER_WRITING_PROFILE.guidance));
 for(const required of ['900–1300 characters','plain words','minimal jargon','Mix short emphasis sentences','natural contractions','straight quotes/apostrophes','no em dashes','one or two plain sentences','End with a specific useful lesson or a focused reflective question','not to articles','separately validated task-bound owner context'])assert(OWNER_WRITING_PROFILE.guidance.includes(required),required);
 for(const sampleFact of ['Neon','100 hours','every 2','3 times out of 3','It never got them','35.9','75.6','Something kept waking'])assert(!OWNER_WRITING_PROFILE.guidance.includes(sampleFact));
 assert.match(OWNER_WRITING_PROFILE.guidance,/"utilize" -> "use"/);assert.match(OWNER_WRITING_PROFILE.guidance,/vocabulary examples, not facts or a post template/);
 assert.match(OWNER_WRITING_PROFILE.method,/no fine-tuning, measured voice score/);
});

test('all six rendered prompts remain source-bound and bounded while story selection through Critic receive the new post voice',()=>{
 const before=JSON.stringify({source,artifacts,snapshot}),caps=[18000,18000,24000,22000,30000,60000];
 for(const kind of ['shortform','longform'])for(let cp=0;cp<6;cp++){
  const t=task(cp,kind),previous=artifacts.slice(0,cp),prompt=buildDraftPrompt(t,source,previous);
  assert(prompt.includes(source.text));assert.equal(prompt.includes(OWNER_WRITING_PROFILE.hash),cp>=1);assert.equal(!!writingProfileFor(t),cp>=1);
  assert.doesNotMatch(prompt,/120–180-word/);
  if(cp>=2){assert.match(prompt,/900–1300 characters/);assert.match(prompt,/one or two plain sentences/);assert.match(prompt,/End with a specific useful lesson or a focused reflective question grounded in this episode/);}
  if(cp===1){assert.match(prompt,/900–1300-character post/);assert.match(prompt,/Keep the required selection schema; do not write the post/);}
  if(cp===2)assert.match(prompt,/canonical selector still returns only IDs\/labels, never a prose brief/);
  if(cp===5){assert.match(prompt,/VOICE OBSERVATIONS/);assert.match(prompt,/Mechanical issues require EDITORIAL HOLD: needs_revision in Proposed advice:/);assert.match(prompt,/not automatic factual errors/);}
  assert.match(prompt,/separate exact publication approval/);assert.match(prompt,/unknown, not proof of no query or no response/);
  const normalInput=Buffer.byteLength(prompt)+providerResponseFormatBytes('openai',draftArtifactContract(t,source,previous));
  assert(normalInput<=48000,ROLES[cp]+' normal production input cap');
  const bound=normalInput+1024;
  assert(bound<=caps[cp],ROLES[cp]+' '+kind+' bound '+bound);
 }
 assert.equal(JSON.stringify({source,artifacts,snapshot}),before);
});

test('mechanical observations count only visible post body without editing bytes, and never claim factual or voice approval',()=>{
 const t=task(5);
 for(const length of [899,900,1300,1301]){
  const text='a'.repeat(length),items=[artifact('Writer',text),artifact('Platform Adapter','### LinkedIn\n'+text)],before=JSON.stringify(items);
  const findings=linkedinVoiceDiagnostics(t,items);
  assert.equal(findings.length,2);for(const f of findings){assert.equal(f.characters,length);assert.equal(f.issues.includes('character_target'),length<900||length>1300);assert.equal(f.status,length<900||length>1300?'needs_voice_revision':'voice_review_required');assert(!('score' in f));}
  assert.equal(JSON.stringify(items),before);
 }
 const unicode='a'.repeat(899)+'😀';assert.equal(linkedinVoiceDiagnostics(t,[artifact('Writer',unicode)])[0].characters,900);
 const punctuation='x'.repeat(900)+' “It’s” —';const finding=linkedinVoiceDiagnostics(t,[artifact('Writer',punctuation)])[0];assert(finding.issues.includes('curly_quotes'));assert(finding.issues.includes('em_dash'));
 for(const cp of [0,1,2,3,4])assert.deepEqual(linkedinVoiceDiagnostics(task(cp),[artifact('Writer',punctuation)]),[]);
 const held=linkedinVoiceDiagnostics(t,[artifact('Writer','EDITORIAL HOLD: needs_source\nMissing evidence.')])[0];assert.equal(held.status,'held');assert.deepEqual(held.issues,[]);
});

test('transparent jargon/audit/ending hints invite review without inventing semantic scores or hard factual verdicts',()=>{
 const review=(text:string)=>linkedinVoiceDiagnostics(task(5),[artifact('Writer',text)])[0];
 assert(review('The endpoint returned runtime metadata with request-level SQL traces.').review_hints?.includes('dense_jargon_review'));
 assert(review('The repository commit records the update.').review_hints?.includes('audit_framing_review'));
 assert(review("Monthly usage hasn't been measured yet.").review_hints?.includes('caveat_ending_review'));
 assert(review('What do you think?').review_hints?.includes('engagement_bait_review'));
 for(const question of ["What happens in your app when nobody's there?",'Which checks can pause without delaying scheduled work?']){const hints=review(question).review_hints||[];assert(!hints.includes('engagement_bait_review'));assert(!hints.includes('question_ending_review'));}
 assert(!OWNER_WRITING_PROFILE.guidance.includes("What happens in your app when nobody's there?"),'Do not hardcode the sample ending as a template');
 const plain=review('Keep the useful check close to the work it protects.');assert.deepEqual(plain.review_hints,[]);assert(!('score' in plain));
 assert.match(ownerWritingPrompt(task(5),[artifact('Writer','Short draft.')]),/A clear mechanical check is not a voice pass/);
});

test('style never supplies personal facts, clears holds, changes legacy/article scope or imports arbitrary owner identity',()=>{
 const text=source.text.replace('anit0607/ai-journey-studio','someone/another-project'),other={...source,text,hash:hash(text)},prior=canonicalNoteArtifacts(other,artifacts);
 const prompt=buildDraftPrompt(task(3),other,prior.slice(0,3));assert.match(prompt,/Describe external claims in third person/);assert.match(prompt,/Never write its actions or feelings as the owner’s experience/);
 assert(evidenceFindings([artifact('Writer',"I built this project with agents and saved 999 hours.")],other.text).some(f=>f.kind==='hard'));
 const legacy={...task(3),content_brief:{kind:'article'}};assert.equal(writingProfileFor(legacy),null);assert.equal(ownerWritingPrompt(legacy),'');assert.deepEqual(linkedinVoiceDiagnostics({...legacy,checkpoint:5},[]),[]);
 assert.deepEqual(task(3).content_brief?.platform_policy,NEW_PLATFORM_POLICY);assert.match(prompt,/never automatic|separate exact publication approval/);
});

test('v1 receipts and consumed comparison policy remain historical; v2 cannot rebind them or spend their approval',()=>{
 const start=JSON.parse(events.find((e:any)=>e.kind==='private_comparison_started').detail),oldStyle=structuredClone(start.style);
 assert.equal(oldStyle.version,'owner-style-v1-2026-10-25');assert.notEqual(oldStyle.hash,OWNER_WRITING_PROFILE.hash);
 const t=task(3),meta=draftPromptMetadata(t,source,artifacts.slice(0,3),buildDraftPrompt(t,source,artifacts.slice(0,3))),historic={...meta,writing_profile:oldStyle};
 assert(validPromptMetadata(historic),'Old receipt remains readable');assert.throws(()=>assertPromptMetadata(historic,t),/Invalid draft prompt receipt/);assert.equal(meta.writing_profile?.version,OWNER_WRITING_PROFILE.version);
 assert.equal(CORRECTED_COMPARISON_SCOPE.prompt_policy_hash,'a92c37461e9d2b3d904ceb831cd498aebb7a9863a534865d94d56aac474dbf0a');
 const policy=comparisonPolicy(CORRECTED_COMPARISON_SCOPE_HASH)!;assert(comparisonPolicyRecordedPermission(policy));assert.equal(comparisonPolicyAuthorized(policy,currentComparisonPromptPolicyHash()),false);assert.equal(comparisonPolicy(hash('third attempt')),null);
 assert.deepEqual(JSON.parse(events.find((e:any)=>e.kind==='private_comparison_started').detail).style,oldStyle);
});
