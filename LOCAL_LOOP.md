# Local cleared-source drafting loop

Implemented on top of the existing private app; no hosted service, account, credential, source clearance, or paid execution is activated by installing this change.

## Owner flow

1. In Sources, stage a concrete project note and its actual date. Staging saves local evidence only. Do not include bank, client, confidential, credential or other excluded material. Nothing is prefilled or seeded.
2. Review the exact saved text and SHA-256. Check the separate OpenAI-only acknowledgement and clear that exact note. Clearance can be revoked. Clearing is not publishing and does not itself call a model.
3. Separately review the non-secret runtime configuration. The new `owner_cleared_sources_authorized` flag represents the previously approved standing scope: only notes the owner explicitly clears in the dashboard, sent to OpenAI for drafts/revisions, with the existing $10 warning, $15 monthly maximum and internal $1 buffer. The example leaves it false. Existing capsule-only configuration remains supported. Pricing must be verified for the run day; security and credential-use gates remain required.
4. Only the owner runs `python scripts/secure_start.py` and enters the provider credential in the hidden interactive prompt. Never paste a credential into a source or chat. In standing-content mode, this launcher disables Gemini, starts the local worker and does not automatically queue the old capsule. Keys stay in the session-only child process; a restart needs owner entry again.
5. Calendar timing and source selection are separate actions. Select posting hours, a start date, and a generation lead of 49–336 hours. The minimum 49-hour lead reserves at least one hour before the 48-hour review deadline; a larger lead is safer. Save, create planned dates, and explicitly link cleared evidence. No source is selected automatically.
6. The separate default-off scheduled-generation checkbox authorizes due dispatch. The local worker queues each eligible entry once and runs one persisted role checkpoint per step. Turning the checkbox off prevents new scheduled tasks; cancel already queued work separately. The read-only-style Check due queue button prepares blocked intents without a model call; Queue eligible due drafts only queues tasks, also without a call.
7. Review every platform draft and its critique. Request agent revision with editing feedback to regenerate the six-role family from the same exact source. Feedback is not new factual evidence. New facts require a new cleared source. A completed revision appends a new immutable version and needs fresh owner approval; historical artifacts and approvals remain available.

## Safety and recovery

- Every provider-bound source, prior artifact and feedback is checked for excluded material, including historical manually edited artifacts. A blocked record is preserved rather than silently rewritten.
- Clearance does not make a source true. Personal claims must trace to supplied evidence. Deterministic checks remain conservative; human factual review is required.
- Due dispatch is transactional and idempotent. Calendar tasks have distinct namespaces; re-delivery cannot replace cancelled, blocked or finished work.
- Task scheduling briefs are frozen at dispatch. Changing calendar settings does not silently rewrite an in-progress draft's format or deadline.
- Catch-up after a target generation time is allowed only while the fixed review deadline is still ahead, and the dashboard labels the late start. No historical execution is invented and no chosen date is changed automatically.
- Work waking after its frozen review deadline is blocked before a provider call. Reschedule and review the existing task explicitly; late posting is never automatic.
- Safe interrupted checkpoints resume. Uncertain provider usage remains reserved and blocks replay until reconciliation. Cancellation stops future calls while retaining in-flight charges/output.
- An in-progress agent revision blocks parent approval. Manual changes during a run make its base stale; stale results cannot overwrite the newer version. Cancel a blocked revision to proceed with manual review. The same request never automatically restarts.
- The budget lock still reserves a conservative upper bound immediately before every call. Queued tasks are not evidence of spending, successful calls or invoice reconciliation.

## Limits

This remains a local app and local worker. Sleeping the laptop pauses its live execution. Cloud development and isolated tests do not move the owner's real database or credential to a hosted runtime. Hosted database, authentication, scheduling, deployment and actual paid validation remain separate decisions.

The legacy Python/SQLite slice is a Windows-only reference. The primary implementation is TypeScript/Next.js with PGlite for local checks; real network-PostgreSQL multi-process integration has not been established.
