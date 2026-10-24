# One-time GitHub intake verification — 24 October 2026

## Recorded outcome: original attempt
The original manual invocation ended in failure at 2026-10-24T04:45:37.931Z with repository_read_permission_required and no successful-sync timestamp. It was not retried and is not a successful source-intake result.

At 2026-10-24T04:46:34Z the nonsecret Production configuration was restored and read back as exactly equal to the pre-intake snapshot. GitHub enabled and sync_authorized are false; the temporary private_read_authorized and since fields are removed. The approved App mapping, key and all unrelated settings are preserved. This documentation update deploys that OFF configuration through the ordinary Git integration.

Read-only diagnosis is separate from this release. No permission expansion, key regeneration, token retry, evidence deletion or application-code change is included. Verify disabled source readiness again after Production completes.

## Historical temporary scope
This record documents a bounded, owner-authorized manual GitHub-to-Studio intake setup, not an automatic drafting or publishing workflow.

Only Anit0607/ai-journey-studio is selected under the existing read-only GitHub App installation. GitHub enabled, sync_authorized and private_read_authorized are temporarily true, with since set to 2026-10-23T00:00:00Z. Notes remain absent/off; no file or Contents API reads are selected. Every unrelated configuration field remains unchanged.

## Single invocation and bounds
The existing “Sync authorized sources now” control was used once after the temporary Production deployment completed. Its provider=all request can execute only the enabled GitHub provider; disabled YouTube is blocked before network work, and chat is not part of this route.

One repository-metadata read and at most two commit-list pages of 100 entries bound the run to 200 commit-summary candidates. Store only validated first-line summaries and existing account attribution as uncleared build-log evidence with provenance. A narrow lower timestamp and the invocation's fixed upper timestamp bound the queried history. Remaining pages are reported, not automatically drained.

The existing App exchanges its key for a repository-restricted, read-only installation token in server memory. No key, JWT or token is exposed in status or this document. This operation writes source/provenance and sync receipts in Studio but does not edit GitHub content.

## Gates and completion
Scheduler authorization remains false. Scheduled integration ticks fail closed; the generation cron does not perform source ingestion. Model execution, source-policy activation, drafting, publishing and media operations remain off. No imported source is automatically cleared or sent to OpenAI.

Read the durable sync outcome, running lease, totals and recent provenance after the one invocation. If the response times out or is uncertain, inspect saved state and do not repeat the action.

The original one-attempt authorization was exhausted. The restored OFF configuration preserved approved App wiring and all audit records. A subsequent controlled retry required the separate explicit approval recorded below; no standing intake authorization is inferred from this historical checklist.

## Separately approved post-fix verification
The reviewed repository-token proof fix was deployed by PR25. The owner separately approved one bounded post-fix retry with the same single repository, 23 October cutoff, no note/file reads, no OpenAI calls, no scheduling and no publication.

That one manual invocation started at 2026-10-24T05:09:57.564Z and completed successfully at 2026-10-24T05:10:00.230Z. The saved error was null, no running lease remained, and imported provenance records were present. This confirms the bounded manual GitHub-to-Studio intake, not an unattended end-to-end content or publishing workflow.

At 2026-10-24T05:10:59Z the nonsecret Production config was again restored and read back as exactly equal to the pre-intake OFF snapshot. GitHub enabled and sync_authorized are false; private_read_authorized and since are removed. App wiring and every unrelated setting are preserved. This documentation-only release deploys the OFF restoration; live disabled status must be checked after completion.

The approved retry is consumed. Keep imported evidence uncleared and preserve provenance and the original failed-attempt history. No additional sync, source-policy activation, model use, schedule or social post is authorized by this completion record.
