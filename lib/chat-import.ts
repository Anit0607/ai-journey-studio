import type {Database} from "./db";
import {SourceIntake} from "./sources";
import {privateMaterial} from "./privacy-patterns";
import {integrationConfig} from "./integration-config";
import {hash} from "./domain";
import type {ChatProviderName,OwnerConversation} from "./chat-export-parse";

const LABEL:Record<ChatProviderName,string>={chatgpt:"ChatGPT",claude:"Claude.ai",gemini:"Gemini","claude-code":"Claude Code"};
const PART_LIMIT=11_000,MAX_CONVERSATIONS=25,MAX_MESSAGES=400;
const validDate=(value:unknown,today:string)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value&&value<=today;

/** Standing consent is active only when the integration config records the owner's 31 Oct OK. */
export function standingChatConsent(config=integrationConfig()){
  const chat=config.sources?.chat as {enabled?:unknown;standing_consent?:unknown}|undefined;
  return chat?.enabled===true&&chat.standing_consent==="2026-10-31";
}
/** Validates one batch of owner-only conversations prepared on the owner's device. */
export function parseChatImport(input:unknown,today:string):OwnerConversation[]{
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).join(",")!=="conversations")throw Error("Invalid chat import");
  const list=(input as {conversations:unknown}).conversations;
  if(!Array.isArray(list)||!list.length||list.length>MAX_CONVERSATIONS)throw Error("Invalid chat import");
  return list.map(item=>{
    const conv=item as Record<string,unknown>;
    if(!conv||typeof conv!=="object"||Object.keys(conv).sort().join(",")!=="id,messages,provider,reported_date,title"||!(conv.provider as string in LABEL)||typeof conv.id!=="string"||conv.id.length>200||typeof conv.title!=="string"||conv.title.length>120||!validDate(conv.reported_date,today)||!Array.isArray(conv.messages)||!conv.messages.length||conv.messages.length>MAX_MESSAGES)throw Error("Invalid chat import");
    const messages=(conv.messages as unknown[]).map(value=>{
      const message=value as {text?:unknown;date?:unknown};
      if(!message||typeof message.text!=="string"||message.text.length<40||message.text.length>2000||!validDate(message.date,today)||Object.keys(message).length!==2)throw Error("Invalid chat import");
      return {text:message.text,date:message.date as string};
    });
    return {provider:conv.provider as ChatProviderName,id:conv.id,title:privateMaterial(conv.title)?"":conv.title,reported_date:conv.reported_date as string,messages};
  });
}
/** Owner-chat source texts: the owner's messages verbatim, split to fit the source size limit. */
export function chatSourceTexts(conv:OwnerConversation){
  const messages=conv.messages.filter(message=>!privateMaterial(message.text)).map(message=>"My message ("+message.date+"): "+message.text);
  const parts:string[][]=[[]];
  for(const message of messages){const current=parts[parts.length-1];if(current.length&&current.join("\n\n").length+message.length+2>PART_LIMIT)parts.push([message]);else current.push(message);}
  const used=parts.filter(part=>part.length);
  return used.map((part,index)=>{
    const dates=part.map(line=>line.slice(12,22)).sort();
    const header="Owner messages from a "+LABEL[conv.provider]+" conversation"+(conv.title?' titled "'+conv.title+'"':"")+", "+dates[0]+" to "+dates[dates.length-1]+(used.length>1?" (part "+(index+1)+" of "+used.length+")":"")+". Only the owner's own words; AI replies are excluded.";
    return {text:header+"\n\n"+part.join("\n\n"),reported_date:dates[dates.length-1]};
  });
}
/** Stages and clears each conversation under the standing consent. Identical text is stored once. */
export async function importOwnerChats(db:Database,input:unknown,now=new Date(),consent=standingChatConsent()){
  if(!consent)throw Error("Chat import is not enabled");
  const today=new Date(now.getTime()+330*60_000).toISOString().slice(0,10),conversations=parseChatImport(input,today);
  const intake=new SourceIntake(db);let added=0,existing=0;
  for(const conv of conversations)for(const part of chatSourceTexts(conv)){
    const before=(await db.query<{id:string}>("SELECT id FROM sources WHERE hash=$1",[hash(part.text)])).length;
    const staged=await intake.stage({text:part.text,category:"owner-chat",reported_date:part.reported_date});
    await intake.clearStanding(staged.id,staged.hash);
    if(before)existing++;else added++;
  }
  return {conversations:conversations.length,added,existing};
}
/** The weekly assistant collector may import only Claude Code session messages. */
export async function importClaudeCodeChats(db:Database,input:unknown,now=new Date(),consent=standingChatConsent()){
  const today=new Date(now.getTime()+330*60_000).toISOString().slice(0,10);
  if(parseChatImport(input,today).some(conv=>conv.provider!=="claude-code"))throw Error("Invalid chat import");
  return importOwnerChats(db,input,now,consent);
}
