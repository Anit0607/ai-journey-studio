import Link from 'next/link';

export default function NoticeLinks(){
 return <nav className="notice-links" aria-label="Studio notices">
  <Link href="/privacy" prefetch={false}>Privacy Notice</Link>
  <Link href="/use" prefetch={false}>Owner-use notice</Link>
 </nav>;
}
