"use client";
import {useState} from "react";
type Action=(path:string,body:unknown,onSaved?:(result:unknown)=>void)=>Promise<unknown>;
type Flag={id:string;role:string;kind:"wording_review"|"hard";claim:string;reason:string;span:{start:number;end:number}};
const AMBER="#f2c46d",RED="#ff8f8f";
const box={background:"#0d141c",border:"1px solid #30404b",borderRadius:10,padding:16,whiteSpace:"pre-wrap" as const,overflowWrap:"anywhere" as const,lineHeight:1.6};

/** Highlights every flagged sentence inside the exact LinkedIn text. */
function highlighted(text:string,flags:Flag[]){
 const ranges:Array<{start:number;end:number;hard:boolean}>=[];
 for(const flag of flags){let at=text.indexOf(flag.claim);while(at>=0&&flag.claim){ranges.push({start:at,end:at+flag.claim.length,hard:flag.kind==="hard"});at=text.indexOf(flag.claim,at+flag.claim.length);}}
 ranges.sort((a,b)=>a.start-b.start);
 const parts:React.ReactNode[]=[];let cursor=0;
 for(const range of ranges){if(range.start<cursor)continue;parts.push(text.slice(cursor,range.start));parts.push(<mark key={range.start} style={{background:"transparent",color:"inherit",borderBottom:`2px solid ${range.hard?RED:AMBER}`}}>{text.slice(range.start,range.end)}</mark>);cursor=range.end;}
 parts.push(text.slice(cursor));return parts;
}

export default function FinalPostReview({task,token,review,busy,action}:{task:string;token:string;review:any;busy:boolean;action:Action}){
 const [ack,setAck]=useState(false);
 const quality=review.quality,linkedin=review.variants?.variants?.find((v:any)=>v.platform==="LinkedIn");
 if(!quality||!linkedin?.text)return null;
 const flags:Flag[]=quality.flags||[],seen=new Set<string>(),unique=flags.filter(f=>!seen.has(f.kind+f.claim)&&seen.add(f.kind+f.claim));
 const hard=unique.filter(f=>f.kind==="hard"),wording=unique.filter(f=>f.kind==="wording_review");
 const blocked=!!review.pending_agent_revision||quality.editorial?.blocking;
 return <section aria-label="Final post review" style={{border:"1px solid #40534e",borderRadius:14,padding:20,margin:"16px 0"}}>
  <span className="eyebrow">YOUR POST</span>
  <h3>Read it, fix anything that is wrong, then confirm</h3>
  <div style={box} aria-label="Exact LinkedIn post">{highlighted(linkedin.text,unique)}</div>
  <small>{linkedin.text.length} characters · <span style={{borderBottom:`2px solid ${AMBER}`}}>underlined</span> = not word-for-word in your source, so it needs your OK{hard.length>0&&<> · <span style={{borderBottom:`2px solid ${RED}`}}>red</span> = must be fixed</>}</small>
  {hard.length>0&&<div><h4 style={{color:RED}}>Must be fixed before this can go out ({hard.length})</h4>{hard.map(f=><p key={f.id}><strong>{f.claim||f.role}</strong><br/>{f.reason}</p>)}<p className="fine">Edit the post below (“Platform Adapter” text) to correct these. They cannot be confirmed away.</p></div>}
  {wording.length>0&&hard.length===0&&<div>
   <h4 style={{color:AMBER}}>Needs your OK ({wording.length})</h4>
   <ul>{wording.map(f=><li key={f.id}>{f.claim}</li>)}</ul>
   <p className="fine">These sentences are reworded from your source or describe you personally, so only you can say whether they are true. If one is wrong, edit the post first.</p>
   <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I have read this whole post. Every statement in it is true, and I am happy to share it publicly.</label>
   <div className="actions"><button className="primary" disabled={busy||blocked||!ack} onClick={()=>void action("attest-final-post",{task,expected:token,binding:quality.binding,acknowledged:true})}>Confirm this post</button></div>
   {blocked&&<p className="fine">Finish the pending agent revision or editorial hold first.</p>}
  </div>}
  {flags.length===0&&<p><strong style={{color:"var(--accent)"}}>✓ Post confirmed.</strong> {review.approval?"It is approved.":"Approve and schedule it with the LinkedIn approval above, or approve the exact version below."}</p>}
  <details><summary>Show the source this post is based on</summary><div style={{...box,fontSize:13}}>{quality.source_text}</div></details>
 </section>;
}
