# One-time GitHub intake verification — 24 October 2026

## Temporary scope
This checkpoint deploys a bounded, owner-authorized manual GitHub-to-Studio intake setup, not an automatic drafting or publishing workflow.

Only Anit0607/ai-journey-studio is selected under the existing read-only GitHub App installation. GitHub enabled, sync_authorized and private_read_authorized are temporarily true, with since set to 2026-10-23T00:00:00Z. Notes remain absent/off; no file or Contents API reads are selected. Every unrelated configuration field remains unchanged.

## Single invocation and bounds
After Production completes, use the existing “Sync authorized sources now” control once. Its provider=all request can execute only the enabled GitHub provider; disabled YouTube is blocked before network work, and chat is not part of this route.

One repository-metadata read and at most two commit-list pages of 100 entries bound the run to 200 commit-summary candidates. Store only validated first-line summaries and existing account attribution as uncleared build-log evidence with provenance. A narrow lower timestamp and the invocation's fixed upper timestamp bound the queried history. Remaining pages are reported, not automatically drained.

The existing App exchanges its key for a repository-restricted, read-only installation token in server memory. No key, JWT or token is exposed in status or this document. This operation writes source/provenance and sync receipts in Studio but does not edit GitHub content.

## Gates and completion
Scheduler authorization remains false. Scheduled integration ticks fail closed; the generation cron does not perform source ingestion. Model execution, source-policy activation, drafting, publishing and media operations remain off. No imported source is automatically cleared or sent to OpenAI.

Read the durable sync outcome, running lease, totals and recent provenance after the one invocation. If the response times out or is uncertain, inspect saved state and do not repeat the action.

Immediately after that attempt, restore GitHub enabled=false and sync_authorized=false, and remove only the newly added private_read_authorized and since fields. Preserve the approved App wiring and imported audit records. Complete a normal OFF deployment even when the intake outcome is uncertain. This checkpoint changes documentation only; completion and OFF restoration require their own verified receipts.
