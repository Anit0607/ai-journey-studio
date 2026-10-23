# Dormant GitHub-to-LinkedIn source selection

This candidate adds a bounded path from GitHub intake to one linked draft task for an unused, due LinkedIn-only calendar entry. It does not activate a source policy, provision GitHub App access, start a scheduler, make a model call, approve an artifact, or publish anything when deployed.

## Separate permissions and default-off behavior

1. **Read access:** The existing integration configuration must separately authorize GitHub read-only syncing and, where relevant, the selected private repository. This patch does not create credentials or installation permissions. Notes additionally require a finite configured file list. See [bounded intake](../GITHUB_BUILD_NOTES.md).
2. **Source-to-OpenAI consent:** An authenticated owner opens Sources → GitHub → LinkedIn draft selection, chooses the start date and exact files, previews the full bounded scope, then explicitly accepts the displayed acknowledgement. Previewing makes no model call and does not activate a policy. There is no seeded preview, policy, grant or runtime binding.
3. **Paid generation:** Existing OpenAI credential, pricing, security, monthly $10 warning/$15 cap, unresolved-accounting, runtime and Calendar generation-activation gates all remain required. Saving source consent does not turn any of them on. The saved scope is bound to the current OpenAI model/provider/budget-purpose fingerprint; changing that fingerprint blocks it until a new owner preview and consent.
4. **Dispatch:** The existing authorized worker or hosted generation invocation calls Calendar dispatch. Reading/syncing sources alone does not dispatch tasks. A configured scheduler is not evidence that delivery has been provisioned or is running.
5. **Every post:** Final-content review/approval and exact publication account/time/payload approval remain independent hard gates. A source-policy receipt is neither an exact-source personal review nor publication consent. No scheduler may create those approvals.

## Exact source boundary

- Only `anit0607/ai-journey-studio` is eligible.
- First-line commit summaries can be included as `build-log`, with repository/immutable commit identifiers and the author/committer account attribution already present in commit metadata. The owner preview and acknowledgement explicitly disclose that provenance. No profile lookup or identity enrichment occurs. Bodies, patches and diffs are never selected or sent to OpenAI.
- Up to five exact, direct `.md` files under `docs/build-notes/` can be included as `project-note`. New filenames are **not discovered automatically**. Updating the list requires revoking the previous policy and explicitly accepting a fresh preview, and the separately authorized intake configuration must cover the same files.
- Notes contain only canonical “Verified progress” facts and same-repository immutable commit evidence links after conservative validation. An exact nonrecursive tree walk verifies `docs/build-notes` directory modes and regular-file mode before Contents reads. No links, raw download URLs, symlinks, submodules, code files or unrelated tree branches are followed.
- Start date is an exact UTC date. Recipient is OpenAI; purpose is LinkedIn drafts/revisions, including selected facts and intermediate drafts. No Gemini, whole consumer-chat synchronization, other repositories, account access, scheduling or publication is granted.
- Repository assertions remain attributed statements, not proof of the owner's personal achievements, feelings, outcomes or participation. Syntactic verification does not independently prove factual claims. Thin, unsafe, ambiguous, mismatched or already-used evidence is skipped with a fixed reason.

## Supported owner API

The UI uses `/api/source-policy/status` (GET), `/preview`, `/activate` and `/revoke` (POST). All require a real, live owner cookie session; machine/worker bearer tokens cannot grant consent. Mutations require the exact same Origin and Host. Bodies are capped at 4 KiB and reject unrelated fields.

Preview saves a session-bound, ten-minute, single-use receipt candidate containing the canonical scope, runtime fingerprint and preview hash. Activation must present the exact preview ID/hash and full acknowledgement with `acknowledged: true`. Policy activation is idempotent; a revoked preview cannot be replayed. Changing scope requires revocation and a new preview. No raw database or secret command is needed for these owner actions.

Revocation requires the exact active policy ID/hash and explicit acknowledgement. It leaves manual source grants, original source rows, historical tasks/outputs/approvals, usage and publication receipts untouched. A source-level owner revocation also blocks policy-derived use and is never silently resurrected.

If a write response is lost, the UI clears its acknowledgement and attempts only a read-only status refresh. If that also fails it shows **UNCONFIRMED**, not a stale ON/OFF claim, and does not repeat the write.

## Determinism and concurrency

- Only a truly unlinked entry with the persisted LinkedIn-only platform policy may receive automatic evidence. Explicit source/task/job bindings and legacy slots are never overwritten.
- The bounded pool considers at most 100 unused source versions in `(reported_date, external_id, provenance_id)` order. An overflow blocks selection visibly rather than widening the scan. Sources already attached to any task, competing provenance records, individually cleared/revoked sources and previously claimed evidence are excluded.
- The transaction locks Calendar settings, due entries and relevant source rows. Unique database constraints cover source ID, evidence identity, calendar entry and task. Grant, exact provenance digest, task and calendar linkage commit together or roll back together.
- Commit evidence identity is repository + commit SHA. Note evidence identity is repository + selected canonical-content digest, so the same unchanged note at another snapshot cannot generate a duplicate automatic draft.
- Original source rows stay staged and manual-clearance fields stay unchanged. A transaction-aware resolver attaches an in-memory eligibility view only after checking the active policy, genuine owner receipt, exact grant, source hash, provenance and bound task. `ownerSourceEligible` remains exact-review-only.
- Admission, reservation, final pre-request, settlement, revision and publication paths revalidate. The final admission transaction locks and rechecks the exact task/lease/checkpoint/reservation and source, then holds a shared policy lock through a unique admission event. Revocation before this linearization point blocks transmission; later revocation cannot recall an already-admitted in-flight request. No admission event permits replay.
- If revocation happens during a model call, paid usage and returned output remain recorded, but the task cannot become review-ready and no next call is authorized. Uncertain provider outcomes retain existing reconciliation requirements.

## Transaction lock order

Strong locks use these orders; policy reads at action gates use `FOR SHARE` through transaction completion:

- Scoped terminal revision settlement: child task → exact ledger reservation → parent task → source → policy. Parent is acquired before the first source lock, including the final `finalizeAgentRevision` path. This avoids inversion with a simultaneous owner revision and retains paid usage/output on a stale parent.
- Owner revision/edit, revision prompt and revision approval: parent → source → policy. Child-state checks are nonlocking reads, not an inverse child acquisition.
- Final provider admission: task → exact reservation → source → policy; it does not acquire a parent afterward. Reservation: task → source → policy → combined budget guard → month.
- Publication update/delivery: outbox → parent → source → policy, followed by existing publication budget locks where applicable. Enqueue begins at parent and inserts a new outbox row, never one held by settlement.
- Calendar dispatch: settings → due entries → sorted sources → policy → combined budget → jobs/new task. Recovery: settings → entry → job → task → source → that task's ledger rows.
- Owner source revocation locks source only. Policy revocation locks settings → policy exclusively and never requests source/task afterward. Cancellation locks its task only.

The isolated tests assert terminal query order and both successful and stale-parent settlement; they do not claim to emulate multi-session PostgreSQL lock scheduling.

## Migration and rollback compatibility

Additive migration 021 creates only three empty tables plus their keys/indexes. There is no backfill or source/task/approval rewrite. The production build hook first runs the unchanged, fully verified 020 step, then runs the separately bounded 021 transaction. Both require exact authorized-production markers. Local/test/preview builds do not connect to a database.

021 requires an existing version-20 schema and verifies physical built-in column types/defaults/collations, permanent ordinary tables, public foreign-key targets, valid immediate uniqueness, active-policy constraint and version marker. Conflicting existing schema fails closed, without destructive repair. Deadlines are checked before issuing each driver query. Locks are bounded and restricted to the new policy tables plus the migration advisory lock.

If 021 fails after 020 committed, the build stops; 020 remains compatible with the preceding release. Older app versions ignore the additive tables. Until 021 exists, new source selection stays off and the owner UI reports setup pending. Do not drop policy tables as a rollback mechanism or replay an uncertain migration blindly.

## Verification scope

Tests use isolated databases and mocked network/model transports only. No production database, GitHub repository, OpenAI or LinkedIn request is required by the test suite. PostgreSQL row-lock behavior is implemented using its documented transaction semantics; local PGlite tests are not a substitute for a separately authorized multi-connection production-like concurrency test. Final exact-tree test counts and unresolved limitations are recorded in the accompanying implementation report.
