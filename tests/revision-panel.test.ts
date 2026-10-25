import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import RevisionPanel,{createRevisionEditor,reduceRevisionEditor,revisionSaveReason,unsavedRevisionRoles} from '../app/revision-panel';
const bundle=(writer='saved writer',critic='saved critic')=>[{role:'Writer',text:writer},{role:'Critic',text:critic}];
const revision=(n:number,writer='saved writer',critic='saved critic')=>({id:'r'+n,version:'v'+n,sequence:n,bundle:bundle(writer,critic),request_note:'edit',created:'2026-10-21'});
const review=(history=[revision(1)])=>({token:`revision:${history.at(-1)!.id}:${history.at(-1)!.version}`,bundle:history.at(-1)!.bundle,history,latest_revision:history.at(-1)!.id,quality:{status:'needs_review',flags:[],notice:'Review required'},original_bundle:bundle()});
const edit=(state:ReturnType<typeof createRevisionEditor>,role:string,text:string)=>reduceRevisionEditor(state,{type:'draft',role,text});

test('role drafts are independent and switching does not replace unsaved text',()=>{
 let state=createRevisionEditor(review());
 state=edit(state,'Writer','new writer');state=edit(state,'Critic','new critic');
 assert.equal(state.drafts.Writer,'new writer');assert.equal(state.drafts.Critic,'new critic');
 assert.deepEqual(unsavedRevisionRoles(state),['Writer','Critic']);
 assert.match(revisionSaveReason(state,'Writer','   ',false),/revision note/);
 assert.equal(revisionSaveReason(state,'Writer','Explain edit',false),'');
 assert.match(revisionSaveReason(edit(state,'Writer',' '),'Writer','note',false),/cannot be empty/);
});

test('one-role save needs its exact response token and retains other drafts',()=>{
 let state=edit(edit(createRevisionEditor(review()),'Writer','new writer'),'Critic','new critic');
 state=reduceRevisionEditor(state,{type:'start',role:'Writer',text:'new writer'});
 const duplicate=reduceRevisionEditor(state,{type:'start',role:'Critic',text:'new critic'});assert.equal(duplicate,state);
 state=reduceRevisionEditor(state,{type:'saved',result:{id:'r2',version:'v2'}});
 assert.equal(state.base.token,'revision:r1:v1');assert.ok(state.pending);
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'new writer')])});
 assert.equal(state.base.token,'revision:r2:v2');assert.equal(state.pending,null);
 assert.deepEqual(unsavedRevisionRoles(state),['Critic']);assert.equal(state.drafts.Critic,'new critic');
 assert.equal(revisionSaveReason(state,'Critic','note',false),'');
 assert.match(revisionSaveReason(state,'Writer','note',false),/No unsaved changes/);
});

test('failed saves, successful saves with failed refresh, and malformed responses keep drafts',()=>{
 const draft=edit(createRevisionEditor(review()),'Writer','new writer');
 const started=reduceRevisionEditor(draft,{type:'start',role:'Writer',text:'new writer'});
 const failed=reduceRevisionEditor(started,{type:'failed'});
 assert.equal(failed.drafts.Writer,'new writer');assert.equal(failed.base.token,draft.base.token);assert.equal(failed.pending,null);
 const waiting=reduceRevisionEditor(started,{type:'saved',result:{id:'r2',version:'v2'}});
 assert.equal(reduceRevisionEditor(waiting,{type:'review',review:review()}),waiting);
 assert.equal(waiting.drafts.Writer,'new writer');assert.match(revisionSaveReason(waiting,'Writer','note',false),/Waiting to verify/);
 const malformed=reduceRevisionEditor(started,{type:'saved',result:true});
 assert.equal(malformed.base.token,draft.base.token);assert.equal(malformed.drafts.Writer,'new writer');assert.ok(malformed.pending);
 assert.match(malformed.message,/could not be verified/);
});

test('external changes never silently rebase local drafts; explicit rebase preserves them',()=>{
 let state=edit(createRevisionEditor(review()),'Writer','local writer');
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'remote writer','remote critic')])});
 assert.equal(state.base.token,'revision:r1:v1');assert.equal(state.drafts.Writer,'local writer');
 assert.match(revisionSaveReason(state,'Writer','note',false),/newer saved version/);
 state=reduceRevisionEditor(state,{type:'rebase'});
 assert.equal(state.base.token,'revision:r2:v2');assert.equal(state.drafts.Writer,'local writer');assert.equal(state.drafts.Critic,'remote critic');
 const older=reduceRevisionEditor(state,{type:'review',review:review()});
 assert.equal(older,state);assert.equal(older.base.token,'revision:r2:v2');
});

test('an own save followed by an external save stays stale and retains all newer text',()=>{
 let state=edit(edit(createRevisionEditor(review()),'Writer','submitted writer'),'Critic','local critic');
 state=reduceRevisionEditor(state,{type:'start',role:'Writer',text:'submitted writer'});
 state=edit(state,'Writer','typed while saving');
 state=reduceRevisionEditor(state,{type:'saved',result:{id:'r2',version:'v2'}});
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'submitted writer'),revision(3,'external writer')])});
 assert.equal(state.base.token,'revision:r2:v2');assert.equal(state.latest.token,'revision:r3:v3');
 assert.equal(state.drafts.Writer,'typed while saving');assert.equal(state.drafts.Critic,'local critic');assert.equal(state.pending,null);
 assert.match(revisionSaveReason(state,'Critic','note',false),/newer saved version/);
});

test('reverting to the old saved text while saving is still preserved as a new draft',()=>{
 let state=edit(createRevisionEditor(review()),'Writer','submitted writer');
 state=reduceRevisionEditor(state,{type:'start',role:'Writer',text:'submitted writer'});
 state=edit(state,'Writer','saved writer');
 state=reduceRevisionEditor(state,{type:'saved',result:{id:'r2',version:'v2'}});
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'submitted writer')])});
 assert.equal(state.drafts.Writer,'saved writer');assert.deepEqual(unsavedRevisionRoles(state),['Writer']);
});

test('busy prevention and approval controls remain separate; page key survives saved token changes',()=>{
 const state=edit(createRevisionEditor(review()),'Writer','new writer');
 assert.match(revisionSaveReason(state,'Writer','note',true),/request is in progress/);
 const html=renderToStaticMarkup(createElement(RevisionPanel,{task:'task',review:review(),busy:false,action:async()=>true}));
 assert.match(html,/Separate revision approval/);assert.match(html,/Approval applies only to the saved version/);
 assert.match(html,/<button disabled="">Approve this exact revision<\/button>/);
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/<RevisionPanel key=\{t.id\}/);assert.doesNotMatch(page,/<RevisionPanel key=\{review.token\}/);
 assert.match(page,/onSaved\?\.\(response.result\)/);
});

test('an unverified success can only recover by explicitly comparing a refreshed version',()=>{
 let state=edit(createRevisionEditor(review()),'Writer','new writer');
 state=reduceRevisionEditor(state,{type:'start',role:'Writer',text:'new writer'});
 state=reduceRevisionEditor(state,{type:'saved',result:true});
 assert.equal(reduceRevisionEditor(state,{type:'rebase'}),state);
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'new writer')])});
 assert.equal(state.base.token,'revision:r1:v1');assert.ok(state.pending);
 state=reduceRevisionEditor(state,{type:'rebase'});
 assert.equal(state.base.token,'revision:r2:v2');assert.equal(state.pending,null);assert.equal(state.drafts.Writer,'new writer');
});

test('unverified-save rebase preserves an in-flight revert even when it matches the old base',()=>{
 let state=edit(createRevisionEditor(review()),'Writer','submitted writer');
 state=reduceRevisionEditor(state,{type:'start',role:'Writer',text:'submitted writer'});
 state=edit(state,'Writer','saved writer');
 state=reduceRevisionEditor(state,{type:'saved',result:{id:'r2'}});
 state=reduceRevisionEditor(state,{type:'review',review:review([revision(1),revision(2,'submitted writer')])});
 state=reduceRevisionEditor(state,{type:'rebase'});
 assert.equal(state.drafts.Writer,'saved writer');assert.equal(state.base.bundle.Writer,'submitted writer');
 assert.deepEqual(unsavedRevisionRoles(state),['Writer']);assert.equal(state.pending,null);
});


test('editorial hold is visible separately from zero factual flags and never presented as an automatic quality pass',()=>{
 const current=review(),editorial={policy:'journey-editorial-v1',status:'needs_source',blocking:true,issues:[{role:'Critic',message:'Missing a specific supported story.'}],notice:'Factual checks do not measure story quality. No automated editorial pass is issued.'};
 const markup=renderToStaticMarkup(createElement(RevisionPanel,{task:'task',review:{...current,quality:{...current.quality,editorial}},busy:false,action:async()=>false,agentRevisionEligible:false}));
 assert.match(markup,/Story and reader value/);assert.match(markup,/needs source/);assert.match(markup,/Missing a specific supported story/);assert.match(markup,/No automated editorial pass/);assert.match(markup,/practical-journey brief/);
 assert.match(markup,/<button[^>]*disabled[^>]*>Approve this exact revision<\/button>/);
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(page,/quality\.editorial\?\.blocking/);assert.match(page,/Zero factual flags are not an editorial quality pass/);
});
