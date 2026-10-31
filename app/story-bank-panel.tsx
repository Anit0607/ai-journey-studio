"use client";
import {useState} from "react";
import {STORY_SETS,STORY_MARKER,STORY_ANSWER_LIMIT,type StorySet} from "../lib/story-bank-questions";

type Action=(path:string,body:unknown)=>Promise<unknown>;
type Source={id:string;text:string;cleared:boolean;created?:string;revoked_at?:string|null};
const field={display:"block",width:"100%",boxSizing:"border-box" as const,background:"#0d141c",color:"#dce8ed",border:"1px solid #30404b",borderRadius:8,padding:10,margin:"6px 0 14px",fontFamily:"inherit",fontSize:14};
const ACK="These answers are my own words and true. I authorize sending them to OpenAI to draft posts, under the $15 monthly cap. They contain no bank, client, private or credential details.";

export default function StoryBankPanel({sources,busy,action}:{sources:Source[];busy:boolean;action:Action}){
  const [set,setSet]=useState<StorySet>("post"),[answers,setAnswers]=useState<Record<string,string>>({}),[ack,setAck]=useState(false);
  const questions=STORY_SETS[set].questions,filled=Object.values(answers).filter(value=>value.trim()).length;
  const stories=sources.filter(source=>source.text.startsWith(STORY_MARKER)&&!source.revoked_at);
  async function save(){
    const result=await action("story-save",{set,answers:Object.fromEntries(Object.entries(answers).filter(([,value])=>value.trim())),acknowledged:ack});
    if(result!==false){setAnswers({});setAck(false);}
  }
  return <section aria-label="Story Bank">
    <span className="eyebrow">STORY BANK</span>
    <h2>Your experiences, in your own words</h2>
    <p>Your agents can only write personal posts about what you have told them. Answer a few questions; each saved story becomes a source your agents can draft from, and every draft still comes to you for approval.</p>
    <div className="actions">{(Object.keys(STORY_SETS) as StorySet[]).map(key=><button key={key} className={set===key?"primary":""} disabled={busy} onClick={()=>{setSet(key);setAnswers({});setAck(false);}}>{STORY_SETS[key].label}</button>)}</div>
    <p className="fine">{STORY_SETS[set].intro}</p>
    {questions.map(item=><label key={set+item.id}>{item.q}
      <textarea aria-label={item.q} rows={3} maxLength={STORY_ANSWER_LIMIT} style={field} value={answers[item.id]||""} onChange={event=>{setAnswers({...answers,[item.id]:event.target.value});setAck(false);}}/>
    </label>)}
    <p className="fine">Keep work details private: answers mentioning a bank, clients, or anything private or confidential are refused, and you will be told which words to remove.</p>
    <label><input type="checkbox" checked={ack} disabled={busy||filled<2} onChange={event=>setAck(event.target.checked)}/> {ACK}</label>
    <div className="actions"><button className="primary" disabled={busy||!ack||filled<2} onClick={()=>void save()}>Save story and queue a draft</button></div>
    {filled<2&&<p className="fine">Answer at least two questions to save.</p>}
    <h3>Saved stories ({stories.length})</h3>
    {stories.length===0?<p className="fine">None yet.</p>:stories.map(story=><details key={story.id}><summary>{story.text.split("\n")[0].replace(STORY_MARKER,"Story")}</summary><pre style={{whiteSpace:"pre-wrap"}}>{story.text}</pre></details>)}
    <p className="fine">After saving, open <strong>Overview</strong>: the new draft task appears there. Use <strong>Run this exact draft once</strong> (at most $0.13) to run your agents, review the post, put it in a free slot, then approve and schedule it.</p>
  </section>;
}
