# Fixed-cadence integration windows

Status: offline candidate. This document is not evidence of a production deployment, configuration change, observed database suspension, or an approved post.

## Purpose and unchanged boundaries

The existing QStash schedule still invokes `/api/integrations/tick` every two minutes. No new provider token, external schedule, paid plan, or credential is needed. An explicitly configured server policy lets valid callbacks return without opening Postgres when neither source intake nor an allowed publication can be due.

This is a personal LinkedIn MVP with fixed posting times, not an arbitrary-time scheduler. It does not change owner content approval, exact account/payload/time approval, source clearance, the 300-second maximum publication lateness, or the rule against replaying a claimed/uncertain/completed publication. The independent daily generation callback remains unchanged.

Generic scheduler behavior remains available when no window policy is configured. An explicitly supplied but malformed policy must fail closed, not silently restore continuous database polling.

## Exact supported publication times

- Monday 22:00 IST = Monday 16:30 UTC.
- Wednesday 16:00 IST = Wednesday 10:30 UTC.
- Friday 15:00 IST = Friday 09:30 UTC.
- Sunday 22:00 IST = Sunday 16:30 UTC.
- Optional dated exception: Thursday 29 October 2026, 16:00 IST = `2026-10-29T10:30:00Z`. This does not enable every Thursday and does not approve a post.

Only exact anchor timestamps are admissible. The surrounding database-access window is not a range of alternative posting times. New plans, revisions, direct publication approvals and combined approval previews must use the same policy. Existing times are never shifted silently.

After the dated exception passes, it is naturally inactive. Do not automatically remove it from configuration while other plans are approved: removal changes the policy binding and needs the same deliberate transition procedure as any other policy change.

The policy binding is part of each scheduled publication's immutable intent and exact approval preview. Changing or removing the policy requires fresh approval of affected unattempted plans. Existing generic plans without the matching binding must not become silently eligible in window mode. Historical completed/uncertain records are preserved.

## Database-access windows

- Hourly intake: the first four minutes of each UTC hour. Nominal two-minute events arrive at `:00` and `:02`.
- Publication: four minutes before through six minutes after an allowed exact anchor. The existing pre-provider check still prohibits publication before the anchor or after its 300-second lateness limit. The additional minute is for safe late-status handling, not permission to post late.
- Source synchronization is restricted to intake windows. A missed source sync must not run ahead of a due post in a publication window. The next source time uses an hourly boundary, avoiding gradual drift beyond the intake window.

All existing request authentication, signature, temporal-claim, body, origin and canonical-destination checks run before the no-database shortcut. No unauthenticated request is accepted because it arrived off-window. A skipped callback has no database/provider effect; delivery claims and the existing durable publication safeguards apply when work is actually admitted.

Old overdue unattempted jobs must not consume all finite-window dispatch opportunities. They can be marked missed without re-approval or replay, while current eligible work is selected under the existing publication guards. A provider failure or uncertain outcome is never retried merely because another timer event arrives.

## Proposed server configuration

The reviewed implementation and release manifest are authoritative for exact fields. The candidate contract is:

```json
{
  "provider": "qstash",
  "authorized": true,
  "mode": "external",
  "cadence_seconds": 120,
  "source_interval_minutes": 60,
  "window_policy": {
    "kind": "fixed-cadence-v1",
    "weekly_utc": ["Mon16:30", "Wed10:30", "Fri09:30", "Sun16:30"],
    "exceptions_utc": ["2026-10-29T10:30:00Z"]
  }
}
```

This is the `scheduler` member only. Preserve all unrelated integration settings and existing approvals. The one dated Thursday planning slot was explicitly chosen and verified on 25 October; its source/task/publication job remain unbound. Including that date is not consent to publish its content. The exception list may instead be empty when this one-off slot is not required.

## Compute estimate, not a spending guarantee

The observed production compute is fixed at 0.25 CU, with a five-minute inactivity timeout. Neon Free includes 100 CU-hours per project per month; all computes in that project share the allowance. Continuous database access would use 180 CU-hours in 30 days.

For this policy, a conservative planning envelope allows a callback immediately before each intake gate closes, up to three minutes of function runtime, and another five minutes until database suspension:

- Hourly intake: `(4 + 3 + 5) / 60 * 24 * 31 * 0.25 = 37.2 CU-hours` in a 31-day month.
- Up to 20 publication windows, conservatively budgeted at 18 active minutes each: `1.5 CU-hours`.
- One daily generation run, budgeted at five minutes plus five idle minutes: approximately `1.292 CU-hours`.
- Combined envelope: approximately **40 CU-hours per 31-day month**, before owner browsing, tests, previews, retries that extend execution, or other database clients. Overlapping windows are counted twice, so this is deliberately conservative within those assumptions.

This is not a provider-enforced cap or a mathematical guarantee of the total bill/quota. Generic Postgres queries are not automatically cancelled by a JavaScript AbortSignal, and unexpected long-running queries or idle transactions can prevent suspension. Actual runtime and Neon usage must be observed. In the usual fast path, usage should be lower.

References: [Neon pricing](https://neon.com/pricing), [compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle), [Free-plan limits](https://neon.com/faqs/free-plan-limits-and-quotas). QStash delivery counts and the OpenAI/Gemini budget are separate from Neon compute.

## Release and acceptance checklist

1. Review the additive migration and all approval-policy bindings. Run focused boundary/authentication/idempotency tests, the complete suite, typecheck, lint and production build against the final combined tree.
2. Before any policy activation, change, removal or rollback, choose a period outside publication windows with no imminent approved delivery. Disable dispatch, drain old-deployment invocations (the integration route has a 180-second limit), and inspect outstanding scheduled outbox rows and attempts. An elapsed timeout does not establish the outcome of an already-sent provider request; preserve and reconcile any claimed/uncertain result. Each running invocation holds its own configuration snapshot, so do not switch policy while an old invocation could still publish. Durably invalidate/cancel every unattempted staged/approved scheduled intent affected by the transition, then require fresh exact approval under the selected policy before re-enabling dispatch. Do not silently translate approvals, change times, or replay claimed/uncertain/failed work. A configuration hash is a fingerprint, not a monotonic revocation epoch: changing A to B and back to A can otherwise match an earlier approval again. Inspection without invalidation is insufficient. If there are no outstanding eligible plans, record that fact instead of inventing a cancellation.
3. Deploy through the normal reviewed release path. Apply only the verified nonsecret window configuration; leave the existing two-minute provider schedule, daily generation event, keys and free plans unchanged.
4. Verify one real signed off-window callback succeeds with a no-work result and no database activity. Bad or mismatched signatures must still be rejected off-window. Do not create or publish a test post to test the gate.
5. After the last authorized database activity, observe Neon becoming idle in its console. Avoid polling Studio state or database health endpoints during this check because those reads themselves wake Postgres. Baseline `app/page.tsx` refreshes state every five seconds while signed in, even in a hidden tab, so close or navigate all Studio tabs during the proof unless the combined release has a separately tested visibility/idle polling guard. Allow for the five-minute idle timeout and monitoring delay.
6. Observe an hourly source window, then another idle period. Confirm existing daily generation still runs. For publication, use a real separately approved exact plan only; verify the provider receipt and no duplicate on later callbacks.
7. Compare CU-hour usage after a representative day, accounting for manual browsing and other branches. Do not claim the cost issue is fixed until both autosuspend and the usage trend are observed.

Rollback must use the transition procedure above. A currently mismatched policy prevents dispatch, but that mismatch alone does not permanently revoke an old approval. Restoring the old continuously polling configuration also restores the compute-usage problem. Do not roll back by weakening intent checks, widening the 300-second limit, or silently upgrading Neon.
