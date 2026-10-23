# Owner-selected hosted draft run

This adds a deliberate owner-only execution path for one pristine, manually queued content task. It is not a scheduler and does not replace or loosen `/api/cron`, its bearer/QStash authorization, or hosted `/step` denial.

## Scope and approval

- The password-owner session and same-origin request are mandatory. A machine bearer alone cannot invoke this action.
- Stage, clear, and queue a real source separately. The control binds task ID, current task update/checkpoint, source ID/hash, the exact clearance event, and runtime configuration hash. No checkbox is selected automatically.
- The existing hosted production, owner, authorized database, persistent key, Fluid Compute, reviewed pricing/security, OpenAI source-transmission, and generation activation gates must pass. Only cron authorization/secret are not required by this separate owner path.
- Generation remains OFF by default. This code does not activate it, change permissions, create credentials, call a model during build/tests, or connect a scheduler.
- The control runs only the selected original manual task, starting at checkpoint zero with no prior outputs or provider ledger rows and no Calendar linkage. It never dispatches Calendar or drains the queue.
- Existing six-stage output still includes LinkedIn, X, and Instagram draft variants. No account is activated. Content/evidence approval, delivery-plan approval, scheduling, and publishing remain separate mandatory actions.

## Bounds and accounting

The server permits at most six OpenAI requests and at most 130,000 microdollars ($0.13) in the sum of reservations for this task, including reservations from already settled calls. Settling a cheaper call does not replenish this one-run allowance. The existing monthly guard, $15 cap including its $1 internal buffer, pricing-anomaly checks, and provider-reported accounting remain intact. No provider fallback or automatic retry is allowed.

The run is bounded to 240 seconds with 70 seconds of headroom before starting another 60-second provider request. The route's platform limit is 300 seconds; the UI waits up to 320 seconds and reports an unconfirmed outcome rather than pretending a lost response means no call ran. Database operations use transaction-local lock/statement timeouts. A late provider promise cannot advance a timed-out checkpoint.

## Durable one-shot state

An `owner_draft_started` event is inserted under the exact task row lock before any checkpoint. That task alone is excluded from generic queue claims, expired lease recovery, and explicit retry. Checkpoint claims and reservations revalidate that event, exact source clearance, generation gate, and deadline. A final pre-request check covers runtime/source/accounting changes; a final completion check prevents a revoked source becoming a successful run result.

`owner_draft_finished` records the terminal result. Existing task/output/ledger rows contain checkpoint progress and accounting. No database migration is needed. A start without a finish becomes presentation status `uncertain` after its deadline; reading status never executes or reconciles anything.

Interrupted, failed, partial, and uncertain attempts are not resumable through this control, including a stopped run before its first paid request. Do not clone or re-enqueue a replacement to evade an uncertain outcome. Investigate saved provider request IDs, outputs, and ledger state first. The feature does not implement reconciliation.

## Owner operation

1. Verify the exact note and its clearance, and queue it once while generation is OFF.
2. Review readiness and absence of unresolved accounting. Enable generation separately only within the approved test window; do not enable or call a scheduler.
3. In Overview or Approval inbox, find the exact task. Review the displayed source, destination/model, and $0.13 limit; deliberately check the acknowledgement and select “Run this exact draft once”.
4. Read the saved run, outputs, and Usage ledger. Review-ready is not factual approval and never publishes.
5. Restore generation OFF after the bounded test. Changing a gate cannot recall information already sent or cancel billing for an in-flight call.

API: `POST /api/studio/owner-draft-run`, exactly `task_id`, `expected_source_id`, `expected_source_hash`, `expected_clearance_id`, `expected_updated`, `expected_checkpoint: 0`, `expected_config_hash`, and `acknowledged: true`. Refresh through `GET /api/studio/state`; the additive `owner_draft` object contains readiness, non-secret config hash, model, fixed limits and durable runs.
