import Link from 'next/link';
import type {ReactNode} from 'react';
import NoticeLinks from './notice-links';

export const STUDIO_CONTACT='https://www.linkedin.com/company/ai-journey-studio/home/';

export default function NoticeShell({title,children}:{title:string;children:ReactNode}){
 return <main className="public-notice">
  <header><div><span className="eyebrow">AI JOURNEY STUDIO</span><h1>{title}</h1></div></header>
  <p className="notice-date">Effective date: 23 October 2026</p>
  <article>{children}</article>
  <NoticeLinks/>
  <p><Link href="/" prefetch={false}>Return to owner sign-in</Link></p>
 </main>;
}
