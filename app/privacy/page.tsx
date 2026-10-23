import NoticeShell,{STUDIO_CONTACT} from '../notice-shell';

export const metadata={title:'Privacy Notice | AI Journey Studio'};

export default function PrivacyNotice(){
 return <NoticeShell title="Privacy Notice">
  <p>AI Journey Studio is Anit Bose&apos;s personal, single-owner workspace for organizing notes and reviewing AI-assisted content. There is no public registration. It is not an employer or client system.</p>
  <p>For privacy or support questions, use the Message button on the <a href={STUDIO_CONTACT}>AI Journey Studio LinkedIn Page</a>. This can also be used to ask about correction or deletion. Do not send passwords or access tokens.</p>

  <h2>Information the studio keeps</h2>
  <ul>
   <li>Owner access: a password hash, sign-in sessions, expiry times and login-security records. Sessions can include IP address and browser information. Necessary sign-in cookies are used; sessions expire after eight hours without automatic renewal. Connecting LinkedIn adds a security cookie lasting up to ten minutes.</li>
   <li>Workspace content: saved source notes, dates, drafts, feedback, review/approval records, calendar plans and activity history. AI usage records include model/request identifiers, token counts, estimated costs and sometimes incomplete outputs. Optional reports retain the metrics, post references and revenue/expense information the owner enters.</li>
  </ul>
  <p>Previewing a source file in the browser does not save it to the server. Staging the selected text and clearing it for AI use are separate actions.</p>

  <h2>Connecting LinkedIn</h2>
  <p>Studio requests openid, profile and w_member_social, but not email access. The provider&apos;s w_member_social permission includes posts, comments and reactions. Studio implements only posting, and publishing is currently off. Connecting does not approve any post or grant Page-posting access.</p>
  <p>After approval on LinkedIn, Studio stores an encrypted access token, its expiry, permissions and connection metadata. It does not retain a returned ID token or collect your LinkedIn password.</p>
  <p>Only when you choose Verify does Studio request your basic profile. It saves your member identifier and name. Other returned profile fields, such as a picture URL, given/family names or locale, are not saved; no profile picture is downloaded. An unexpected email field is not saved. Verification is owner-initiated, not periodic. Expired access requires reauthorization.</p>

  <h2>How information is used</h2>
  <p>Vercel hosts the app; Neon PostgreSQL stores its records. Hosting diagnostics can include request paths/query parameters, IP/browser information, timestamps and technical metadata. Provider logs and database recovery copies follow the configured provider policies; their exact settings and retention have not been certified for this notice.</p>
  <p>LinkedIn receives connection and verification requests. Connecting does not send its profile response or token to OpenAI or read your LinkedIn feed, messages or contacts.</p>
  <p>Separately authorized AI drafting sends OpenAI the exact cleared source, related prior drafts, formatting context and revision/review information. Results are saved for review. Requests use store=false, which is not a zero-retention guarantee. <a href="https://developers.openai.com/api/docs/guides/your-data">OpenAI&apos;s API data controls</a> describe its retention and training practices.</p>
  <p>Provider tokens are encrypted before database storage. This does not mean every workspace field has separate application-level encryption. The reviewed app has no advertising or data-sale feature.</p>

  <h2>Withdrawal and deletion</h2>
  <p>Choose Disconnect LinkedIn in Studio to clear its active token, member identifier/name, permissions, expiry and authorization-flow records. Minimal disconnected-status and verification history remains, without the profile response or access token. Remove the application grant in LinkedIn settings as well to withdraw provider-side access.</p>
  <p>Connection data has no automatic age-based deletion. Expiry stops token use but does not automatically erase stored data. Revoking access only on LinkedIn does not automatically erase Studio&apos;s profile fields. Reconnection replaces the connection; a rejected token may also be cleared.</p>
  <p>Source revocation stops eligibility for later AI work, not storage of notes/drafts or earlier transmissions. Signing out ends the current session, not the workspace. General workspace deletion is not self-service; use the contact above for a request. Future posting and public-media features need their own retention/deletion review before activation.</p>
 </NoticeShell>;
}
