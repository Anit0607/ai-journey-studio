# LinkedIn-first workflow, version 1

## Scope

New manual content tasks and new calendar entries target LinkedIn only. A complete new content family still contains all six internal role artifacts, but its Platform Adapter artifact contains exactly one `### LinkedIn` section. Every post still requires exact-content owner approval before a publication plan can be staged; that delivery plan separately requires owner approval of its text, account, time and delivery method before delivery. Calendar draft planning is not an approved publication schedule.

This release does not activate providers, source clearance, paid drafting, credentials, social accounts, hosting, schedulers or publication. It does not make live model or posting calls as part of setup. X and Instagram remain implemented for historical records, not selectable destinations for new LinkedIn-only content. Metrics entry remains able to describe historical posts without activating any platform.

## Immutable scope and compatibility

No database migration or backfill is needed. The existing JSONB columns hold the explicit snapshot:

- A new task's `content_brief` contains `platform_policy: {version: 1, platforms: ["LinkedIn"]}` and matching `platforms: ["LinkedIn"]`.
- A new calendar entry's `platform_schedule` contains that `platform_policy` plus its `LinkedIn` timestamps. No X/Instagram timestamps are created.
- An absent policy means the original three-platform contract. Scope is never inferred from generated text, a client-supplied request field, or a calendar's current settings. Unknown versions, inconsistent profiles and inactive platform sections fail closed.
- Revisions inherit the persisted parent scope. Existing manual-task deduplication returns the same historical task unchanged rather than converting it.
- New calendar planning is insert-only. Date/format collisions leave every existing entry unchanged. The UI states this; choose an unused date for a new plan. The existing explicit expired-draft recovery operation creates a fresh LinkedIn-only plan while retaining the cancelled original's brief and artifacts.
- Cross-scope task/calendar links are rejected. Unbound legacy slots cannot dispatch new tasks: the UI requires a fresh LinkedIn-only plan on an unused date. Already linked legacy tasks remain under their original contract; no automatic replacement, conversion or replay occurs.
- Original artifact bytes, bundle hashes, platform hash formulas, legacy evidence bindings, approval rows and receipts are not rewritten. Only new-policy evidence bindings include the platform policy. Content and delivery approvals are always separate.

The already queued historical task remains three-platform. This rollout never rewrites or automatically runs it.

## Owner-selected draft run compatibility

This patch is layered after the owner-selected one-shot run feature. The dashboard supplies a server-computed `platform_policy_hash`; the owner-run request includes its exact expected value. The admission transaction, durable start event, each locked checkpoint and final result recheck the persisted policy. The UI resets its acknowledgement if that hash changes and displays the actual legacy or LinkedIn scope. An older cached request lacking the policy hash is rejected; refresh the dashboard rather than retrying a started run.

## Timing and publishing

The calendar form and optional benchmark show only LinkedIn hours for new plans. All four chosen posting days need valid LinkedIn times; X/Instagram hours are neither needed nor used. The 48-hour draft review window, generation lead minimums, budget locks and source consent checks are unchanged. Old entries retain all their prior timing snapshots.

The strict new parser rejects extra platform sections, internal reviewer metadata, duplicate headings, placeholders, hash tampering and LinkedIn text over 3,000 characters without truncation. Publication rechecks task scope in addition to all existing exact artifact/evidence/account/runtime/receipt gates. Instagram media generation is rejected for a LinkedIn-only task. The publication account selector shows only destinations represented by that task's persisted variants.

## Release and rollback

Keep this as a separate reviewed release after the exact owner-run patch. Rebase on the confirmed landed owner-run commit, preserve its other guards, rerun the combined test suite and verify the final deployment before enabling any new work. Repository changes and deployment require separate authorization. No SQL migration or production data edit is part of this release.

To stop rollout, pause new drafting and delivery through existing authorized controls; keep the policy-aware reader while version-1 records exist. Do not strip metadata, convert historical approvals, or run version-1 queued work on pre-policy code. Reverting the whole interpreter would misinterpret new records as legacy, so a safe rollback retains this compatibility reader while disabling new task creation. Future platform expansion needs a new explicit policy version and separate authorization, not mutation of an approved record.

## Verification

Tests use isolated embedded PostgreSQL and injected fake provider/LinkedIn responses, never production data or live provider calls. Coverage includes strict scope parsing, new tasks/calendar dispatch, unchanged historical bytes and hashes, evidence approval binding, revision inheritance, approval-before-scheduling-before-delivery, inactive-platform rejection, and owner-run policy races. Existing three-platform regression fixtures explicitly create unversioned records; they no longer rely on the new-work default.
