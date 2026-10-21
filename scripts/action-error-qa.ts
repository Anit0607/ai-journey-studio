// Browser regression using intercepted APIs only: no DB, owner login or provider.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3137';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3137'],{stdio:'ignore',env:{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'}});
let browser;
try{
 let ready=false;for(let n=0;n<120;n++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 const executablePath=process.argv.find(arg=>arg.startsWith('--browser-executable='))?.slice('--browser-executable='.length);
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let polls=0,stages=0,succeed=false;
 const state={budget:{committed_microdollars:0,month_IST:'2026-10',warning:false},analyst:{status:'insufficient-data',reason:'Isolated UI fixture'},blockers:['Isolated fixture; execution disabled'],database:'pglite',sources:[] as unknown[],tasks:[],outputs:[],reviews:[],events:[],ledger:[],updated:new Date().toISOString(),proposed_source:'',source_approved:false,owner_cleared_sources_authorized:false,live_enabled:false};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/api/auth/status')return route.fulfill({json:{authenticated:true,setup_required:false}});
  if(url.pathname==='/api/studio/state'){polls++;return route.fulfill({json:state});}
  if(url.pathname==='/api/studio/source-stage'){
   stages++;if(!succeed)return route.fulfill({status:400,json:{error:'Excluded private material'}});
   const body=route.request().postDataJSON();state.sources=[{id:'isolated-fixture',...body,hash:'a'.repeat(64),cleared:false}];return route.fulfill({json:{result:state.sources[0]}});
  }
  if(url.pathname.startsWith('/api/'))return route.abort();return route.continue();
 });
 await page.goto(origin);await page.getByRole('button',{name:'Sources',exact:true}).click();
 const note=page.getByLabel('Project note',{exact:true}),date=page.getByLabel('Reported date',{exact:true}),stage=page.getByRole('button',{name:/Stage note/});
 const text='Isolated automated UI fixture with confidential wording';await note.fill(text);await date.fill('2026-10-21');await stage.click();
 const alert=page.getByRole('alert').filter({hasText:'Excluded private material'});await alert.waitFor();assert.equal(stages,1);assert.equal(await note.inputValue(),text);
 const initialPolls=polls;await page.waitForTimeout(11000);assert.ok(polls>=initialPolls+2);await alert.waitFor({state:'visible'});assert.equal(stages,1);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Connected',{exact:false}).first().waitFor();await alert.waitFor({state:'visible'});assert.equal(stages,1);
 await page.getByRole('button',{name:'Dismiss action error',exact:true}).click();await alert.waitFor({state:'hidden'});assert.equal(await note.inputValue(),text);
 await stage.click();await alert.waitFor();assert.equal(stages,2);
 succeed=true;await note.fill('Isolated automated UI fixture supported by a reviewed note');await stage.click();await page.getByText('Note staged. Review its saved text and SHA-256 below, then decide whether to clear it for OpenAI.').waitFor();await alert.waitFor({state:'hidden'});assert.equal(await note.inputValue(),'');assert.equal(stages,3);assert.equal(state.sources.length,1);assert.deepEqual(errors,[]);
 console.log('PASS: rejected action survives two successful polls and manual refresh; no automatic POST retry; explicit dismissal works; deliberate successful staging clears stale error; zero live APIs/DB/providers');
}finally{await browser?.close();server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',()=>resolve());});}
