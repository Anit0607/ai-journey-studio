import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {startActiveWorkspacePolling,WORKSPACE_IDLE_MS,WORKSPACE_POLL_MS} from "../lib/workspace-polling";
function fixture(){
 const page=new EventTarget(),view=new EventTarget();let now=0,active=true,polls=0,tick!:()=>void,cleared=0;
 const stop=startActiveWorkspacePolling(()=>polls++,{page,view,isActive:()=>active,now:()=>now,setTimer:(work,ms)=>{assert.equal(ms,WORKSPACE_POLL_MS);tick=work;return 1;},clearTimer:timer=>{assert.equal(timer,1);cleared++;}});
 return {page,view,stop,tick:()=>tick(),at:(value:number)=>{now=value;},active:(value:boolean)=>{active=value;},polls:()=>polls,cleared:()=>cleared};
}
test("active visible workspace polls while recently used, then stops entirely at idle cutoff",()=>{
 const f=fixture();assert.equal(f.polls(),0);f.at(5_000);f.tick();assert.equal(f.polls(),1);f.at(55_000);f.tick();assert.equal(f.polls(),2);
 for(const time of [WORKSPACE_IDLE_MS,120_000,600_000,3_600_000]){f.at(time);f.tick();}assert.equal(f.polls(),2);f.stop();
});
test("hidden/unfocused workspace never polls; focus and visibility resume only one read",()=>{
 const f=fixture();f.active(false);for(const time of [5_000,60_000,600_000]){f.at(time);f.tick();f.page.dispatchEvent(new Event("pointerdown"));f.view.dispatchEvent(new Event("focus"));}assert.equal(f.polls(),0);
 f.active(true);f.page.dispatchEvent(new Event("visibilitychange"));f.view.dispatchEvent(new Event("focus"));assert.equal(f.polls(),1);f.tick();assert.equal(f.polls(),1);f.at(605_000);f.tick();assert.equal(f.polls(),2);f.stop();
});
test("keyboard/pointer use resumes idle polling without writing state or replaying actions",()=>{
 const f=fixture();f.at(120_000);f.tick();assert.equal(f.polls(),0);f.page.dispatchEvent(new Event("keydown"));assert.equal(f.polls(),1);f.page.dispatchEvent(new Event("pointerdown"));assert.equal(f.polls(),1);
 f.at(125_000);f.tick();assert.equal(f.polls(),2);f.at(180_000);f.tick();assert.equal(f.polls(),2);f.page.dispatchEvent(new Event("pointerdown"));assert.equal(f.polls(),3);f.stop();
});
test("cleanup removes timer/listeners and ignores late queued callbacks",()=>{
 const f=fixture();f.stop();f.stop();assert.equal(f.cleared(),1);f.at(300_000);f.tick();f.page.dispatchEvent(new Event("keydown"));f.page.dispatchEvent(new Event("visibilitychange"));f.view.dispatchEvent(new Event("focus"));assert.equal(f.polls(),0);
});
test("Page binds only background read refresh; manual and action-completion refresh remain present",()=>{
 const source=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");assert.match(source,/startActiveWorkspacePolling\(\(\)=>\{void refresh\(true\);\}\)/);assert.doesNotMatch(source,/setInterval\(\(\)=>\{void refresh\(true\)/);assert.match(source,/onClick=\{\(\)=>void refresh\(\)\}/);assert.match(source,/const next=await request\("state"\)/);
});
