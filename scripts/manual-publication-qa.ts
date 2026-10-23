// Isolated intercepted browser QA. No real owner, database, credentials or provider calls.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3144';
const outputDir=process.argv.find(arg=>arg.startsWith('--output-dir='))?.slice('--output-dir='.length)||'/tmp/manual-publication-qa';
await mkdir(outputDir,{recursive:true});
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3144'],{stdio:['ignore','pipe','pipe'],env:{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'}});
let serverOutput="";server.stdout?.on("data",chunk=>{serverOutput=(serverOutput+chunk).slice(-4000);});server.stderr?.on("data",chunk=>{serverOutput=(serverOutput+chunk).slice(-4000);});
let browser;
try{
 let ready=false;for(let n=0;n<120;n++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready,serverOutput);
 const executablePath=process.argv.find(arg=>arg.startsWith('--browser-executable='))?.slice('--browser-executable='.length);
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const job:Record<string,any>={id:'isolated-manual-job',task_id:'isolated-content',version:'a'.repeat(64),review_token:'isolated-approved-content',platform:'LinkedIn',account_id:'isolated-owner-account',remote_id:'urn:li:person:12345',delivery_mode:'manual',status:'approved',manual_ready:true,manual_reason:null,scheduled_at:new Date(Date.now()-1000).toISOString(),payload:{text:'Proposed approach: review one cleared project note.'},receipt:null};
 const state={budget:{committed_microdollars:0,month_IST:'2026-10',warning:false},analyst:{status:'insufficient-data',reason:'Isolated UI fixture'},blockers:['Isolated fixture; execution disabled'],database:'pglite',sources:[],tasks:[],outputs:[],reviews:[],events:[],ledger:[],updated:new Date().toISOString(),live_enabled:false,integrations:{publishing:{enabled:true,accounts:[],jobs:[job],acknowledgement:'I approve this exact scheduled plan.',manual_acknowledgement:'I approve this exact manual plan and its displayed account and time.',max_lateness_seconds:300},media:{}}};
 let publishCount=0,reviseCount=0,loseResponse=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/api/auth/status')return route.fulfill({json:{authenticated:true,setup_required:false}});
  if(url.pathname==='/api/studio/state')return route.fulfill({json:state});
  if(url.pathname==='/api/studio/publication-publish'){
   publishCount++;assert.deepEqual(route.request().postDataJSON(),{id:job.id,expected_version:job.version,expected_account_id:job.account_id,acknowledged:true});
   if(loseResponse){job.status='uncertain';job.manual_ready=false;return route.abort('failed');}
   await new Promise(resolve=>setTimeout(resolve,11_000));
   job.status='published';job.manual_ready=false;job.receipt={provider_id:'urn:li:share:98765'};
   return route.fulfill({json:{result:{status:'published',id:job.id,receipt:job.receipt}}});
  }
  if(url.pathname==='/api/studio/publication-revise'){
   reviseCount++;const body=route.request().postDataJSON();assert.equal(body.expected_version,job.version);assert.equal(body.plan.delivery_mode,'scheduled');
   Object.assign(job,{...body.plan,version:'c'.repeat(64),status:'staged',manual_ready:false,receipt:null});return route.fulfill({json:{result:job}});
  }
  if(url.pathname.startsWith('/api/'))return route.abort();return route.continue();
 });
 await page.goto(origin);await page.getByRole('button',{name:'Publishing',exact:true}).click();
 const publish=page.getByRole('button',{name:'Publish this exact approved plan now',exact:true});
 const ack=page.getByRole('checkbox',{name:/I have reviewed the exact text/});
 await publish.waitFor();assert(await publish.isDisabled());assert.equal(await ack.isChecked(),false);
 await ack.check();await publish.click();assert(await publish.isDisabled());await page.waitForTimeout(10_500);assert.equal(publishCount,1);assert.equal(await page.getByRole('alert').count(),0);
 await page.getByText('Provider receipt: urn:li:share:98765',{exact:false}).waitFor();assert.equal(publishCount,1);assert.equal(await publish.count(),0);
 await page.screenshot({path:join(outputDir,'manual-publication-receipt.png'),fullPage:true});
 Object.assign(job,{status:'approved',manual_ready:true,version:'b'.repeat(64),receipt:null});await page.getByRole('button',{name:'Refresh',exact:true}).click();await publish.waitFor();assert.equal(await ack.isChecked(),false);
 await ack.check();await page.getByRole('button',{name:'Reschedule publication',exact:true}).click();assert.equal(await publish.count(),0);await page.getByRole('button',{name:'Keep current time',exact:true}).click();assert(await publish.isDisabled());
 loseResponse=true;await ack.check();await publish.click();await page.getByRole('alert').filter({hasText:'Publication outcome is not confirmed'}).waitFor();await page.getByRole('heading',{name:'LinkedIn · uncertain',exact:true}).waitFor();assert.equal(publishCount,2);assert.equal(await publish.count(),0);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(publishCount,2);await page.screenshot({path:join(outputDir,'manual-publication-uncertain.png'),fullPage:true});
 Object.assign(job,{status:'approved',manual_ready:false,version:'d'.repeat(64),scheduled_at:new Date(Date.now()+60_000).toISOString(),manual_reason:'Approved publication time has not arrived'});await page.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(await publish.count(),0);
 await page.getByRole('button',{name:'Reschedule publication',exact:true}).click();const article=page.locator('article').filter({hasText:'isolated-owner-account'});
 await article.getByLabel('New posting time (your browser timezone)').fill('2099-04-02T10:30');await article.getByLabel('Delivery method',{exact:true}).selectOption('scheduled');await article.getByRole('button',{name:'Save new time for review',exact:true}).click();
 await page.getByRole('button',{name:'Approve this exact plan',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Approve this exact plan',exact:true}).isDisabled());assert.equal(reviseCount,1);assert.equal(publishCount,2);assert.equal(await publish.count(),0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(outputDir,'manual-publication-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: exact manual acknowledgement, >10-second pending delivery, one mocked receipt, no duplicate submission, lost-response uncertainty/status refresh, future block, edit dismissal, mode revision/fresh approval, mobile render; zero live accounts, providers or databases.');
}finally{await browser?.close();server.kill();await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',()=>resolve());});}
