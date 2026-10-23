import Link from 'next/link';
import NoticeShell,{STUDIO_CONTACT} from '../notice-shell';

export const metadata={title:'Owner-use notice | AI Journey Studio'};

export default function OwnerUseNotice(){
 return <NoticeShell title="Owner-use notice">
  <p>AI Journey Studio is Anit Bose&apos;s personal, single-owner workspace, not an employer or client system.</p>
  <p>Use only material you may process. Do not add employer or client material, private or confidential data, or credentials.</p>
  <p>Review the exact source before clearing it for OpenAI. Saving notes, connecting LinkedIn, approving drafts and approving publication are separate decisions.</p>
  <p>AI text can be wrong. Check facts, privacy and the final version before sharing it.</p>
  <p>Connect only your own authorized account. Publishing is off; connection consent does not approve a post.</p>
  <p>Read the <Link href="/privacy" prefetch={false}>Privacy Notice</Link> before connecting. Use Studio&apos;s Disconnect and LinkedIn&apos;s grant-removal controls to withdraw access.</p>
  <p>Support contact: Message the <a href={STUDIO_CONTACT}>Studio Page</a>. Studio support is not provided by LinkedIn; Studio is not LinkedIn-endorsed.</p>
 </NoticeShell>;
}
