import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ConnectionsPanel from '../app/connections-panel';
import PublicationPanel from '../app/publication-panel';
test('connections render truthful disabled setup and expired disconnect controls without token fields',()=>{
 const html=renderToStaticMarkup(createElement(ConnectionsPanel,{integrations:{sources:{connections:[]},publishing:{enabled:false},scheduler:{notice:'Not configured',delivery:null},oauth:[{provider:'linkedin',supported:true,configured:true,connected:false,status:'expired',authorization_version:'isolated-version',scopes:['openid','profile','w_member_social']}]},busy:false,action:async()=>true,onChanged:async()=>{}}));
 assert.match(html,/linkedin · expired/);assert.match(html,/Disconnect linkedin from this studio/);const button=html.match(/<button([^>]*)>Disconnect linkedin from this studio<\/button>/);assert.ok(button);assert.doesNotMatch(button[1],/disabled/);assert.doesNotMatch(html,/access_token|refresh_token|token_ciphertext/);
});
test('empty publication screen cannot stage content and states there are no receipts',()=>{
 const html=renderToStaticMarkup(createElement(PublicationPanel,{publishing:{accounts:[],jobs:[]},media:{artifacts:[],approvals:[],storage:{}},reviews:[],busy:false,action:async()=>true}));
 assert.match(html,/<button disabled="">Stage exact publication plan<\/button>/);assert.match(html,/No publication plans or receipts yet/);assert.doesNotMatch(html,/published successfully/i);
});
test('Facebook linked Instagram selection is explicit and disabled until owner acknowledgement',()=>{
 const html=renderToStaticMarkup(createElement(ConnectionsPanel,{integrations:{sources:{},publishing:{},scheduler:{notice:'Not configured'},oauth:[{provider:'instagram_facebook',supported:true,configured:true,connected:true,status:'selection_required',authorization_version:'v1',selection_version:'v1',scopes:['pages_show_list','instagram_basic','instagram_content_publish'],candidates:[{page_id:'1001',remote_id:'2001',label:'Chosen professional account'}]}]},busy:false,action:async()=>true,onChanged:async()=>{}}));
 assert.match(html,/Select the exact linked Page/);assert.match(html,/<button disabled="">Connect Chosen professional account · Instagram 2001 · Page 1001<\/button>/);assert.doesNotMatch(html,/access_token|refresh_token/);
});
