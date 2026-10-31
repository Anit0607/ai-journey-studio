// Browser-safe: runs on the owner's device. Only the owner's own messages leave it.
import {unzipSync,strFromU8} from "fflate";
import {privateMaterial} from "./privacy-patterns";

export type ChatProviderName="chatgpt"|"claude"|"gemini"|"claude-code";
export type OwnerMessage={text:string;date:string};
export type OwnerConversation={provider:ChatProviderName;id:string;title:string;reported_date:string;messages:OwnerMessage[]};
export type ParseSummary={conversations:OwnerConversation[];kept:number;skipped:{ai:number;short:number;code:number;private:number}};

const MIN=40,MAX=2000,MIN_CONVERSATION=200;
const day=(value:unknown)=>{const date=typeof value==="number"?new Date(value*(value<1e12?1000:1)):new Date(String(value));return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):null;};
const clean=(text:string)=>text.replace(/\s+/g," ").trim();
/** Mostly prose in any script (Hinglish, Hindi, English), not pasted code, logs or data. */
const prose=(text:string)=>!/```/.test(text)&&(text.match(/[\p{L}\p{M}\d\s.,;:'"!?()\u2019-]/gu)||[]).length/text.length>=0.9;

/** Applies the owner-message rules and records why anything was left out. */
export function keepOwnerMessage(raw:string,summary:ParseSummary):string|null{
  const text=clean(raw);
  if(text.length<MIN){summary.skipped.short++;return null;}
  if(text.length>MAX||!prose(text)){summary.skipped.code++;return null;}
  if(privateMaterial(text)){summary.skipped.private++;return null;}
  return text;
}
function conversation(summary:ParseSummary,provider:ChatProviderName,id:string,title:string,messages:Array<{text:string;date:string|null}>,today:string){
  const kept=messages.flatMap(message=>{const text=keepOwnerMessage(message.text,summary);return text&&message.date&&message.date<=today?[{text,date:message.date}]:[];});
  if(kept.reduce((sum,message)=>sum+message.text.length,0)<MIN_CONVERSATION)return;
  summary.kept+=kept.length;
  const safeTitle=clean(title).slice(0,120);
  summary.conversations.push({provider,id:String(id).slice(0,200),title:safeTitle&&!privateMaterial(safeTitle)?safeTitle:"",reported_date:kept[kept.length-1].date,messages:kept});
}
const text=(value:unknown)=>typeof value==="string"?value:Array.isArray(value)?value.map(part=>typeof part==="string"?part:part&&typeof part==="object"&&typeof (part as {text?:unknown}).text==="string"?(part as {text:string}).text:"").join("\n"):"";

/** ChatGPT conversations.json: owner turns are author.role "user". */
export function parseChatGPT(data:unknown,summary:ParseSummary,today:string){
  for(const item of Array.isArray(data)?data:[]){
    const conv=item as {id?:string;conversation_id?:string;title?:string;mapping?:Record<string,{message?:{author?:{role?:string};create_time?:number;content?:{parts?:unknown}}}>};
    const nodes=Object.values(conv.mapping||{}).map(node=>node.message).filter(Boolean).sort((a,b)=>(a!.create_time||0)-(b!.create_time||0));
    const owner=nodes.filter(message=>message!.author?.role==="user");
    summary.skipped.ai+=nodes.length-owner.length;
    conversation(summary,"chatgpt",conv.conversation_id||conv.id||"",conv.title||"",owner.map(message=>({text:text(message!.content?.parts),date:day(message!.create_time)})),today);
  }
}
/** Claude.ai conversations.json: owner turns are sender "human". */
export function parseClaude(data:unknown,summary:ParseSummary,today:string){
  for(const item of Array.isArray(data)?data:[]){
    const conv=item as {uuid?:string;name?:string;chat_messages?:Array<{sender?:string;text?:string;content?:unknown;created_at?:string}>};
    const messages=conv.chat_messages||[],owner=messages.filter(message=>message.sender==="human");
    summary.skipped.ai+=messages.length-owner.length;
    conversation(summary,"claude",conv.uuid||"",conv.name||"",owner.map(message=>({text:message.text||text(message.content),date:day(message.created_at)})),today);
  }
}
/** Google Takeout My Activity (Gemini Apps): each "Prompted …" entry is one owner prompt, grouped by day. */
export function parseGemini(data:unknown,summary:ParseSummary,today:string){
  const days=new Map<string,Array<{text:string;date:string}>>();
  for(const item of Array.isArray(data)?data:[]){
    const entry=item as {title?:string;time?:string;header?:string};
    if(typeof entry.title!=="string"||!entry.title.startsWith("Prompted ")){summary.skipped.ai++;continue;}
    const date=day(entry.time);if(!date)continue;
    days.set(date,[...(days.get(date)||[]),{text:entry.title.slice("Prompted ".length),date}]);
  }
  for(const [date,messages] of [...days].sort())conversation(summary,"gemini","gemini-"+date,"Gemini prompts on "+date,messages,today);
}

/** Reads an export zip (or a bare JSON file) and returns only the owner's own messages. */
export function parseExport(bytes:Uint8Array,fileName:string,today=new Date().toISOString().slice(0,10)):ParseSummary&{provider:ChatProviderName|null}{
  const summary:ParseSummary={conversations:[],kept:0,skipped:{ai:0,short:0,code:0,private:0}};
  const wanted=(name:string)=>/(^|\/)conversations(-\d+)?\.json$/i.test(name)||/Gemini Apps\/[^/]*\.json$/i.test(name);
  const files:Record<string,Uint8Array>=/\.zip$/i.test(fileName)?unzipSync(bytes,{filter:file=>wanted(file.name)}):{[fileName]:bytes};
  let provider:ChatProviderName|null=null;
  for(const [name,content] of Object.entries(files)){
    if(!wanted(name)&&!/\.json$/i.test(name))continue;
    const data=JSON.parse(strFromU8(content));
    const first=Array.isArray(data)?data[0]:null;
    if(/Gemini Apps/i.test(name)||first?.header==="Gemini Apps"||typeof first?.title==="string"&&first.title.startsWith("Prompted ")){provider="gemini";parseGemini(data,summary,today);}
    else if(first&&"chat_messages" in first){provider="claude";parseClaude(data,summary,today);}
    else if(first&&"mapping" in first){provider="chatgpt";parseChatGPT(data,summary,today);}
  }
  return {...summary,provider};
}
