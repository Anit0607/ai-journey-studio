"use client";
import {useState} from "react";
import {parseExport,type ParseSummary,type ChatProviderName} from "../lib/chat-export-parse";

type Action=(path:string,body:unknown)=>Promise<unknown>;
const LABEL:Record<ChatProviderName,string>={chatgpt:"ChatGPT",claude:"Claude.ai",gemini:"Gemini","claude-code":"Claude Code"};
const BATCH=25;

/** Reads an export on this device and uploads only the owner's own messages, in small batches. */
export default function ChatImportPanel({busy,action}:{busy:boolean;action:Action}){
  const [result,setResult]=useState<(ParseSummary&{provider:ChatProviderName|null;file:string})|null>(null),[error,setError]=useState(""),[progress,setProgress]=useState(""),[reading,setReading]=useState(false);
  async function read(file:File){
    setError("");setResult(null);setProgress("");setReading(true);
    try{const parsed=parseExport(new Uint8Array(await file.arrayBuffer()),file.name);if(!parsed.provider)throw Error();setResult({...parsed,file:file.name});}
    catch{setError("This file is not a ChatGPT, Claude.ai or Gemini (Google Takeout) export. Choose the .zip you downloaded, without unzipping it.");}
    finally{setReading(false);}
  }
  async function upload(){
    if(!result)return;
    const list=result.conversations;
    for(let start=0;start<list.length;start+=BATCH){
      setProgress(`Importing ${Math.min(start+BATCH,list.length)} of ${list.length} conversations…`);
      const saved=await action("chat-import",{conversations:list.slice(start,start+BATCH)});
      if(saved===false){setProgress(`Stopped after ${start} conversations. You can choose the file again; anything already imported is kept once.`);return;}
    }
    setProgress(`Done: ${list.length} conversations imported. Your agents can now use them.`);setResult(null);
  }
  return <section aria-label="Chat import">
    <span className="eyebrow">CHAT IMPORT</span>
    <h2>Bring in your AI chats</h2>
    <p>Choose the export you downloaded from ChatGPT, Claude.ai or Google Takeout (Gemini). It is read <strong>on this device</strong>: only your own messages are kept, and the AI replies, pasted code or logs, and anything mentioning a bank, clients or private details are left out before anything is uploaded.</p>
    <input type="file" accept=".zip,.json" disabled={busy||reading} onChange={event=>{const file=event.target.files?.[0];if(file)void read(file);}}/>
    {reading&&<p role="status">Reading the export on this device…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div>
      <p><strong>{LABEL[result.provider!]}</strong> export · {result.conversations.length} conversations with {result.kept} of your messages to import.</p>
      <p className="fine">Left out: {result.skipped.ai} AI replies, {result.skipped.short} very short messages, {result.skipped.code} code/log pastes, {result.skipped.private} messages with private words.</p>
      <button className="primary" disabled={busy||!result.conversations.length} onClick={()=>void upload()}>Import {result.conversations.length} conversations</button>
      <p className="fine">Imported under your standing consent of 31 Oct 2026. Nothing is drafted or posted by importing.</p>
    </div>}
    {progress&&<p role="status">{progress}</p>}
  </section>;
}
