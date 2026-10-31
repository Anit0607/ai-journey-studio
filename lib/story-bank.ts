import type {Database} from "./db";
import {Store} from "./store";
import {SourceIntake,EXCLUDED_MATERIAL} from "./sources";

import {STORY_SETS,STORY_MARKER,STORY_ANSWER_LIMIT,type StorySet} from "./story-bank-questions";
export {STORY_SETS,STORY_MARKER,STORY_ANSWER_LIMIT,type StorySet};

/** Words the privacy filter blocks, so the owner can remove them before saving. */
export function blockedWords(text:string){
  const found=new Set<string>(),pattern=new RegExp(EXCLUDED_MATERIAL.source,"gi");let match;
  while((match=pattern.exec(text)))found.add(match[0].toLowerCase());
  return [...found];
}
/** First-person source text: one question and the owner's verbatim answer per block. */
export function composeStory(set:StorySet,answers:Record<string,unknown>,date:string){
  const questions=STORY_SETS[set]?.questions;
  if(!questions||!answers||typeof answers!=="object"||Array.isArray(answers))throw Error("Invalid story");
  if(Object.keys(answers).some(id=>!questions.some(item=>item.id===id)))throw Error("Invalid story");
  const blocks=questions.flatMap(item=>{
    const value=answers[item.id];
    if(value===undefined||value===null||value==="")return [];
    if(typeof value!=="string"||value.length>STORY_ANSWER_LIMIT)throw Error("Each answer can be at most 1,500 characters");
    const answer=value.trim().replace(/\r\n/g,"\n");
    return answer?["Question: "+item.q+"\nMy answer: "+answer]:[];
  });
  if(blocks.length<2)throw Error("Answer at least two questions");
  return STORY_MARKER+" ("+STORY_SETS[set].label+"), answered by the owner on "+date+". Everything below is in the owner's own words.\n\n"+blocks.join("\n\n");
}
/** Saves, clears and queues one story in the owner's session. Nothing is drafted, approved or posted. */
export async function saveStory(db:Database,input:unknown,now=new Date()){
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join(",")!=="acknowledged,answers,set")throw Error("Invalid story");
  const body=input as {set:StorySet;answers:Record<string,unknown>;acknowledged:unknown};
  if(body.acknowledged!==true)throw Error("Confirm that these answers are yours and true before saving");
  const date=new Date(now.getTime()+330*60_000).toISOString().slice(0,10),text=composeStory(body.set,body.answers,date);
  const blocked=blockedWords(text);
  if(blocked.length)throw Error("Remove these words before saving: "+blocked.join(", "));
  const intake=new SourceIntake(db),staged=await intake.stage({text,category:"user-reported-notes",reported_date:date});
  const source=await intake.clear(staged.id,staged.hash,true),task=await new Store(db).enqueue(source.id);
  return {source:source.id,task:task.id};
}
