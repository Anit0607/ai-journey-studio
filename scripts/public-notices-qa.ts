// Isolated loopback-only UI/HTTP QA. No real owner data or provider calls.
import {chromium,type Browser} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {embedded} from '../lib/db';
import {provisionOwner} from '../lib/owner-password';

const directory=await mkdtemp(path.join(os.tmpdir(),'studio-notices-qa-'));
const origin='http://127.0.0.1:3196',password='isolated-notice-qa-owner-password';
const privateMarker='SYNTHETIC_PRIVATE_NOTICE_QA_NOT_PUBLIC';
let server:ChildProcess|undefined,browser:Browser|undefined;
try{
 const db=await embedded(path.join(directory,'db'));
 try{await provisionOwner(db,password,true);await db.query('INSERT INTO sources(id,text,category,reported_date,hash,cleared) VALUES($1,$2,$3,$4,$5,false)',['11111111-1111-4111-8111-111111111111',privateMarker,'project-note','2026-10-22','synthetic-only']);}finally{await db.close();}
 server=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3196'],{stdio:['ignore','pipe','pipe'],env:{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',STUDIO_ORIGIN:origin,STUDIO_AUTH_SECRET:'isolated-notice-qa-session-secret-'.repeat(2),STUDIO_LOCAL_DB:'1',STUDIO_LOCAL_PATH:path.join(directory,'db'),STUDIO_DATABASE_AUTHORIZED:'0',STUDIO_RUNTIME_CONFIG:'{}',STUDIO_INTEGRATIONS_CONFIG:'{}'}});
 let serverOutput='';server.stderr?.on('data',data=>serverOutput+=String(data));
 let ready=false;for(let attempt=0;attempt<120;attempt++){if(server.exitCode!==null)throw Error('Loopback server exited: '+serverOutput);try{if((await fetch(origin+'/privacy')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready,'Loopback notice server not ready');
 for(const route of ['/privacy','/use']){const result=await fetch(origin+route);assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);assert.equal(result.headers.get('x-frame-options'),'DENY');assert.equal(result.headers.get('referrer-policy'),'no-referrer');assert(!(await result.text()).includes(privateMarker));}
 for(const route of ['/api/studio/state','/api/studio/privacy','/api/connections/linkedin/status'])assert.equal((await fetch(origin+route)).status,401,route);
 for(const route of ['/privacy/api/studio/state','/privacy/private','/privacy-extra','/use/api/connections/linkedin/status','/use/private'])assert.equal((await fetch(origin+route)).status,404,route);
 assert.equal((await fetch(origin+'/api/connections/linkedin/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"acknowledged":true}'})).status,401);
 assert.equal((await fetch(origin+'/api/connections/linkedin/start',{method:'POST',headers:{Origin:'https://wrong.example','Content-Type':'application/json'},body:'{"acknowledged":true}'})).status,403);
 console.log('PASS: loopback HTTP checks for public notices, no notice cookies or private data, exact-route negatives, protected owner APIs and CSRF.');
 if(!process.argv.includes('--http-only')){
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
 const context=await browser.newContext({viewport:{width:1360,height:1000}});
 let externalRequests=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
 const page=await context.newPage(),pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await mkdir('artifacts/connection-notices',{recursive:true});
 await page.goto(origin);await page.getByRole('heading',{name:'Your private studio.',exact:true}).waitFor();
 await page.getByRole('link',{name:'Privacy Notice',exact:true}).click();await page.getByRole('heading',{name:'Privacy Notice',exact:true}).waitFor();
 assert.equal(await page.locator('article').getByRole('link',{name:'AI Journey Studio LinkedIn Page',exact:true}).getAttribute('href'),'https://www.linkedin.com/company/ai-journey-studio/home/');
 await page.screenshot({path:'artifacts/connection-notices/privacy-desktop.png',fullPage:true});
 await page.goBack();await page.getByRole('heading',{name:'Your private studio.',exact:true}).waitFor();
 await page.getByRole('link',{name:'Owner-use notice',exact:true}).click();await page.getByRole('heading',{name:'Owner-use notice',exact:true}).waitFor();
 assert((await page.locator('article').innerText()).trim().split(/\s+/).length<=150);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:'artifacts/connection-notices/use-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'Privacy Notice',exact:true}).last().click();await page.getByRole('heading',{name:'Privacy Notice',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:'artifacts/connection-notices/privacy-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'Return to owner sign-in',exact:true}).click();await page.getByLabel('Owner password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
 const state=await (await page.request.get(origin+'/api/studio/state')).json();assert.equal(state.live_enabled,false);assert.equal(state.integrations.publishing.enabled,false);assert.equal(state.sources.length,1);assert.equal(state.sources[0].cleared,false);assert.equal(state.ledger.length,0);
 // Render one configured LinkedIn card without enabling any actual server integration.
 const syntheticState={...state,integrations:{...state.integrations,oauth:[{provider:'linkedin',supported:true,configured:true,connected:false,status:'configured',scopes:['openid','profile','w_member_social']}]}};
 await page.route('**/api/studio/state',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(syntheticState)}));
 await page.goto(origin+'/?connection=linkedin');const button=page.getByRole('button',{name:'Continue to LinkedIn',exact:true});await button.waitFor();const checkbox=page.getByRole('checkbox',{name:'I have read the Privacy Notice and owner-use notice and approve the stated connection access and storage.',exact:true});
 assert.equal(await checkbox.isChecked(),false);assert.equal(await button.isDisabled(),true);
 let starts=0;await page.route('**/api/connections/linkedin/start',async route=>{starts++;assert.deepEqual(route.request().postDataJSON(),{acknowledged:true});await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Isolated UI test; no provider request'})});});
 await checkbox.check();assert.equal(await button.isEnabled(),true);await checkbox.uncheck();assert.equal(await button.isDisabled(),true);assert.equal(starts,0);
 await checkbox.check();await button.click();await page.getByRole('alert').filter({hasText:'Isolated UI test; no provider request'}).waitFor();assert.equal(starts,1);
 await page.screenshot({path:'artifacts/connection-notices/linkedin-consent-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'Privacy Notice',exact:true}).click();await page.getByRole('heading',{name:'Privacy Notice',exact:true}).waitFor();await page.goBack();await button.waitFor();assert.equal(await checkbox.isChecked(),false);assert.equal(await button.isDisabled(),true);assert.equal(starts,1);
 await page.getByRole('link',{name:'Owner-use notice',exact:true}).click();await page.getByRole('heading',{name:'Owner-use notice',exact:true}).waitFor();await page.goBack();await button.waitFor();assert.equal(await checkbox.isChecked(),false);
 await page.setViewportSize({width:1360,height:1000});await page.screenshot({path:'artifacts/connection-notices/linkedin-consent-desktop.png',fullPage:true});
 await page.unroute('**/api/studio/state');await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Your private studio.',exact:true}).waitFor();assert.equal((await page.request.get(origin+'/api/studio/state')).status(),401);
 assert.deepEqual(pageErrors,[]);assert.equal(externalRequests,0);
 console.log('PASS: public /privacy and /use; no cookie/data leakage; exact-route negatives; private APIs and CSRF; login links; desktop/mobile layouts; unchecked/checked/uncheck/error/Back flows; actual publishing/model off; no external requests.');
 }else console.log('SKIP: rendered-browser and interaction checks were not requested in HTTP-only mode.');
}finally{await browser?.close();if(server){server.kill();await new Promise<void>(resolve=>{if(server!.exitCode!==null)resolve();else server!.once('exit',()=>resolve());});}assert.equal(path.dirname(directory),os.tmpdir());assert(path.basename(directory).startsWith('studio-notices-qa-'));await rm(directory,{recursive:true,force:true});}
