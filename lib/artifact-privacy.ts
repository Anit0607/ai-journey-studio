import {assertSourcePrivacy} from './sources';

// Scan-only compatibility views. Never rewrite stored/sent artifacts or their hashes.
const HOMOGLYPHS:Record<string,string>={'а':'a','А':'A','ɑ':'a','Α':'A','α':'a','о':'o','О':'O','ο':'o','Ο':'O','і':'i','І':'I','ι':'i','Ι':'I','ı':'i','т':'t','Т':'T','Τ':'T','τ':'t','һ':'h','Н':'H','Η':'H','е':'e','Е':'E','Ε':'E','ε':'e','с':'c','С':'C','ϲ':'c','р':'p','Р':'P','Ρ':'P','ρ':'p','ѕ':'s','Ѕ':'S','х':'x','Х':'X','Χ':'X','χ':'x','υ':'u','Υ':'U','Ζ':'Z','ζ':'z'};
const ENTITIES:Record<string,string>={amp:'&',colon:':',equals:'=',quot:'"',apos:"'",tab:'\t',newline:'\n',lbrack:'[',rbrack:']',lpar:'(',rpar:')'};
const point=(value:string,radix:number,original:string)=>{const n=Number.parseInt(value,radix);return n>=0&&n<=0x10ffff?String.fromCodePoint(n):original;};
function scanView(value:string):string{
 return value
  .replace(/\\u\{([a-f0-9]{1,6})\}|\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi,(all,a,b,c)=>point(a||b||c,16,all))
  .replace(/\\([nrt])/g,(_all,code)=>({n:'\n',r:'\r',t:'\t'}[code as 'n'|'r'|'t']))
  .replace(/\\(["'`\\/:=,\[\]()])/g,'$1')
  .replace(/&#x([a-f0-9]{1,6});?|&#([0-9]{1,7});?/gi,(all,hex,decimal)=>point(hex||decimal,hex?16:10,all))
  .replace(/&([a-z]+);/gi,(all,name)=>ENTITIES[name.toLowerCase()]??all)
  .replace(/(?:%[a-f0-9]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded;}})
  .normalize('NFKD').replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu,'')
  .replace(/[‘’‚‛]/g,"'").replace(/[“”„‟]/g,'"')
  .replace(/[∶꞉]/g,':').replace(/[‐‑‒–—−]/g,'-')
  .replace(/[аАɑΑαоОοΟіІιΙıтТΤτһНΗеЕΕεсСϲрРΡρѕЅхХΧχυΥΖζ]/g,char=>HOMOGLYPHS[char]);
}
const authorization='authorization'.split('').join('[\\s._-]*');
const label='\\b(?:(?:proxy|http)[\\s_-]*)?'+authorization+'(?:[\\s_-]*header)?(?![a-z0-9])';
const decoration='[\\s*_~`]*';
const AUTH_VALUE=new RegExp(label+decoration+'(?:[:=]|["\'`]\\s*(?:[:=,+]|\\.[a-z_$]|\\]\\s*(?:[:=,]|\\.[a-z_$])|\\))|\\]\\s*[:=,]|%[a-f0-9]{2}|&(?:amp;)*(?:colon;|equals;|#)|(?:bearer|basic|token|digest|negotiate|oauth)\\b)','i');
const AUTH_CREDENTIAL=new RegExp(label+'[\\s_-]+(?:code|key)'+decoration+'[\"\'`]?[\\s]*[:=]','i');
const AUTH_HEADER_CALL=new RegExp('\\b(?:getheader|setheader|appendheader|headers?\\s*\\.\\s*(?:get|set|append))\\s*\\(\\s*["\'`]?'+label,'i');
const SCHEME_VALUE=/(?:^|[\n\r:"'`])\s*(?:Bearer|Basic|Token|Digest|Negotiate)\s+[A-Za-z0-9._~+\/-]+={0,2}(?=\s*(?:$|["'`,}\]]|\r?\n))/i;
function basicCredential(text:string):boolean{
 for(const match of text.matchAll(/\bBasic\s+([A-Za-z0-9+/]+={0,2})/gi)){
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.toString('base64').replace(/=+$/,'')===match[1].replace(/=+$/,'')&&bytes.includes(58))return true;
 }
 return false;
}

/** Generated artifacts only. Human sources, feedback and evidence keep their stricter guard.
 * Ordinary technical authorization prose is allowed, not credential-shaped material.
 * This conservative pattern guard is not semantic verification or guaranteed secret detection.
 */
export function assertArtifactPrivacy(text:string):void{
 if(typeof text!=='string')throw Error('Excluded private material');
 const views=[text];for(let n=0;n<2;n++)views.push(scanView(views.at(-1)!));
 for(const view of views){
  if(AUTH_VALUE.test(view)||AUTH_CREDENTIAL.test(view)||AUTH_HEADER_CALL.test(view)||SCHEME_VALUE.test(view)||basicCredential(view))throw Error('Excluded private material');
  // Original and normalized views both retain every non-authorization exclusion.
  assertSourcePrivacy(view.replace(/\bauthorization\b/gi,'permission-topic'));
 }
}
