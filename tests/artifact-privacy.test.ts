import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../lib/domain';
import {assertSourcePrivacy} from '../lib/sources';
import {assertArtifactPrivacy} from '../lib/artifact-privacy';

const observed=JSON.parse(readFileSync(new URL('./fixtures/github-owner-draft-blocked-2026-10-24.json',import.meta.url),'utf8'));
const generic='Managing task boundaries and authorization in AI agent workflows.';
test('the exact observed source/Harvester/Story Miner bytes remain intact; generic artifact authorization is not a credential',()=>{
 assert.equal(observed.status,'blocked');assert.equal(observed.checkpoint,2);assert.equal(observed.calls.length,2);assert.equal(observed.later_calls,0);
 assert.equal(hash(observed.source.text),observed.source.hash);assert.doesNotThrow(()=>assertSourcePrivacy(observed.source.text));
 for(const item of observed.bundle){assert.equal(hash(item.text),item.hash);assert.doesNotThrow(()=>assertArtifactPrivacy(item.text));assert.equal(hash(item.text),item.hash);}
 assert.throws(()=>assertSourcePrivacy(observed.bundle[1].text),/^Error: Excluded private material$/);
 assert.equal(observed.bundle[1].text.slice(558,571),'authorization');
});
test('ordinary authorization prose is allowed only at artifact boundaries, without mutating input',()=>{
 for(const text of [generic,'Authorization checks keep task boundaries explicit.','Discuss role-based authorization and scoped execution.','The draft discusses AUTHORIZATION in agent workflows.','Basic authorization checks keep task boundaries explicit.','Token budgets and authorization decisions are separate.',JSON.stringify({reason:'Review generic authorization wording against the source.'})]){
  const before=hash(text);assert.doesNotThrow(()=>assertArtifactPrivacy(text));assert.equal(hash(text),before);assert.throws(()=>assertSourcePrivacy(text));
 }
});
const credentialForms=[
 'Authorization: Bearer abcdefghijklmnop','authorization=Basic dXNlcjpwYXNz','Authorization : Token short',
 '{"Authorization": "Bearer abc"}',"{'authorization' : 'Basic dTpw'}",'headers["Authorization"] = value',
 'headers.Authorization = value','Authorization => value','Proxy-Authorization: Basic dTpw','HTTP_AUTHORIZATION=value',
 'setHeader("Authorization", value)','getHeader("Authorization")','headers.set("Authorization", value)',
 'headers.append( "Authorization" , value )','headers.get("Authorization")','[["Authorization", "Token abc"]]',
 'Authorization\n\t : Basic dTpw','Authorization\tBearer abc','Authorization\nBasic dTpw','Authorization Token abc',
 '**Authorization**: Bearer abc','`Authorization` = "Basic dTpw"','Authorization\r\n=Token abc',
 'Ａｕｔｈｏｒｉｚａｔｉｏｎ： Ｂｅａｒｅｒ abc','Autho\u200brization: Basic dTpw','Authorizatiоn: Bearer abc',
 'A u t h o r i z a t i o n = Basic dTpw','A_u_t_h_o_r_i_z_a_t_i_o_n: Token abc',
 '"\\u0041uthorization" : "Basic dTpw"','%41uthorization%3a%20Bearer%20abc','Author&#105;zation&colon; Basic dTpw',
 'Authorization\u00a0=\u00a0Basic dTpw','Authorization∶ Bearer abc','“Authorization” : “Basic dTpw”',
 'Authorization: <placeholder>','Authorization:','Basic dTpw','"Bearer abc"','"Token abc"',
 'Authorization\\nBasic YWxpY2U6c2VjcmV0','Authorization\\tToken abc','Authorization&amp;colon; abcdefghijkl',
 'Authorization%EF%BC%9A abcdefghijkl','"Authorization" + ": " + "abcdefghijkl"','Authorization\\: Basic dTpw',
 'Authorization%FF%3A abc','Authorization&amp;amp;colon; abc','"Authorization".concat(": ", value)','["Authorization"].join(":")',
 '`Authorization` + ": " + value','The header uses Basic dTpw in this example.',
];
for(const [n,text] of credentialForms.entries())test('credential-shaped artifact remains excluded '+n,()=>{
 assert.throws(()=>assertArtifactPrivacy(text),/^Error: Excluded private material$/);
});
const otherExcluded=['Bandhan note','bank operations','banking report','banks report','client update','clients note','private plan','confidential project','secret example','credentials sample','password=sample','passcode: sample','API_KEY=sample','OPENAI_API_KEY=sample','DB_PASSWORD=sample','DATABASE_URL=sample','"OPENAI_API_KEY": "sample"','postgresql://user:value@host/db','access_token:sample','refresh_token:sample','session_cookie=sample','Bearer abcdefghijklmnop','sk-abcdefghijklmnop','AIza'+'a'.repeat(25),'AKIA'+'A'.repeat(16),'ghp_'+'a'.repeat(25),'github_pat_'+'a'.repeat(25),'xoxb-'+'a'.repeat(15),'-----BEGIN RSA PRIVATE KEY-----','eyJabcdefghijk.abcdefghijkl.abcdefghijkl'];
test('every unchanged non-authorization source exclusion remains an artifact exclusion, including inside ordinary prose',()=>{
 for(const text of otherExcluded){assert.throws(()=>assertSourcePrivacy(text));assert.throws(()=>assertArtifactPrivacy(text));assert.throws(()=>assertArtifactPrivacy(generic+'\n'+text));}
});
test('normalization strengthens scanning without hiding original credential or private patterns',()=>{
 for(const text of ['bаnk details','cli\u200bent notes','confi\u2066dential plan','ｓｅｃｒｅｔ sample','pássword: sample','API_KEY%3Dsample','sk-abcdefghijklmnop','Authorizatiоn: Token abc'])assert.throws(()=>assertArtifactPrivacy(text));
 for(const text of [null,{},42])assert.throws(()=>assertArtifactPrivacy(text as unknown as string),/^Error: Excluded private material$/);
});

for(const text of ['OAuth authorization code: abcdefghijklmnop','authorization key = abcdefghijklmnop','"authorization code": "placeholder"','authorization_code = placeholder'])test('credential authorization code/key assignment remains blocked: '+text,()=>assert.throws(()=>assertArtifactPrivacy(text),/Excluded private material/));
test('authorization code flow remains ordinary technical prose',()=>assert.doesNotThrow(()=>assertArtifactPrivacy('The authorization code flow is discussed as a proposed approach.')));
