import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {allowedOrigin,response} from '../lib/auth';
import {validGenerationTimeInput,GenerationTimeError,parseGenerationTimeRequest} from '../lib/calendar-generation-time';
const origin='https://studio.example.test',body=()=>({entry_id:randomUUID(),expected_preview:'a'.repeat(64),requested_generation_time:'server_now',acknowledged:true});
function harness(){
 const calls={password:0,bearer:0,db:0,writes:[] as any[]},flags={authenticated:true,fail:false};const db={},config={};
 const modules:Record<string,any>={
  '../../../../lib/calendar-generation-time':{validGenerationTimeInput,GenerationTimeError,parseGenerationTimeRequest,advanceGenerationNow:async(database:any,input:any,options:any)=>{assert.equal(database,db);assert.equal(options.isReady(config),true);calls.writes.push(input);if(flags.fail)throw new GenerationTimeError('Generation-time preview changed; refresh before saving');return {duplicate:false,queued:false,paid_execution:false};}},
  '../../../../lib/owner-password':{passwordOwnerAuthenticated:async()=>{calls.password++;return flags.authenticated;},ownerApiAuthenticated:async()=>{calls.bearer++;return true;}},
  '../../../../lib/auth':{allowedOrigin:(request:Request)=>allowedOrigin(request,origin),response},
  '../../../../lib/db':{database:async()=>{calls.db++;return db;}},
  '../../../../lib/store':{Store:class{constructor(readonly db:any){}}},
  '../../../../lib/config':{runtimeConfig:()=>config},
  '../../../../lib/hosted':{hostedEnvironment:()=>true,hostedOwnerDraftReady:()=>true},
  '../../../../lib/owner-reports':{REPORT_ERRORS:[]},'../../../../lib/source-ingestion':{safeIngestionError:()=>null},'../../../../lib/publication-media':{safeMediaError:()=>null},'../../../../lib/publishing':{safePublicationError:()=>null},'../../../../lib/calendar-recovery':{safeCalendarRecoveryError:()=>null}
 };
 const source=readFileSync(new URL('../app/api/studio/[action]/route.ts',import.meta.url),'utf8'),exports:any={};runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(id:string)=>modules[id]||{},Request,Response,URL,Buffer,process:{env:{}}});
 const invoke=(payload:any=body(),from=origin)=>exports.POST(new Request(origin+'/api/studio/calendar-generation-now',{method:'POST',headers:{Origin:from,'Content-Type':'application/json',Authorization:'Bearer not-owner'},body:typeof payload==='string'?payload:JSON.stringify(payload)}),{params:Promise.resolve({action:'calendar-generation-now'})});return {calls,flags,invoke};
}
test('generation timing action requires owner cookie and same Origin before any database access',async()=>{
 const h=harness();h.flags.authenticated=false;assert.equal((await h.invoke()).status,401);assert.equal(h.calls.password,1);assert.equal(h.calls.bearer,0);assert.equal(h.calls.db,0);
 const other=harness();assert.equal((await other.invoke(body(),'https://other.example.test')).status,403);assert.equal(other.calls.db,0);
});
test('route rejects caller clock/extra source fields and sends exact acknowledged mode without invoking runner',async()=>{
 const h=harness();for(const bad of [{...body(),now:'2026-10-25T08:00:00Z'},{...body(),source_reviewed:true},{...body(),acknowledged:false},{...body(),requested_generation_time:'2026-10-25T08:00:00Z'},null,[]])assert.equal((await h.invoke(bad)).status,400);
 for(const raw of ['{bad',JSON.stringify(body()).replace('{','{\"entry_id\":\"hidden\",')])assert.equal((await h.invoke(raw)).status,400);assert.equal(h.calls.writes.length,0);const input=body(),response=await h.invoke(input);assert.equal(response.status,200);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.writes)),[input]);assert.equal((await response.json()).result.paid_execution,false);
 h.flags.fail=true;const stale=await h.invoke();assert.equal(stale.status,409);assert.match((await stale.json()).error,/preview changed/);
});
