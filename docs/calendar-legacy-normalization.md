# One-off normalization of four reviewed legacy Calendar rows

This operator repair is separate from source intake, model execution, scheduling
activation and publication. It adds no UI and changes no existing file or schema.
Both preview and commit require a live password-owner cookie and an exact matching
Origin. A worker bearer cannot preview or commit it.

The isolated implementation starts from commit
`a90d2122f7614ba3204d91c976d1a2b30f756d7a`, tree
`52514f994eb3d904d17d509a508870048496549d`.

## Evidence and fixed scope

The reviewed authenticated API capture was made at `2026-10-24T17:51:37.414Z`.
Its exact JSON, including the final LF, is 11,854 UTF-8 bytes with SHA-256
`d71577c6ec7d11496e60191b7d0b6ebc929dae312cfc44232237b103c30c19f6`.
It is retained outside the patch as `calendar-legacy-api-evidence.json`.

That capture contains API-derived presentation fields, not raw database snapshots.
Its hash is **not** a database row or settings token. The helper reads the intended
`public` tables under locks and computes canonical full-row SHA-256 values from
those fresh database rows. SQL JSON snapshots retain every native column, with
timestamp fields rendered as UTC ISO strings with six fractional digits. This
avoids the JS driver's millisecond truncation. Object keys are sorted. Reviewed
API values are compared at their exposed precision, while hashes and bound
`updated` values retain full database precision. Even a one-microsecond change
after preview invalidates commit. Unknown columns or changed settings fail closed.
There is no invented database version field.

Only these IDs can be repaired. All times below are UTC:

| ID | Existing aggregate post | Preserved LinkedIn post | Actual shift |
| --- | --- | --- | --- |
| `e15dbb66-c3f9-4141-8b94-544e14349b46` | Nov 2 03:30 | Nov 2 16:30 | +13 hours |
| `c2aed4a0-1257-4faa-ac59-090e5d838a28` | Nov 4 04:30 | Nov 4 10:30 | +6 hours |
| `b57e284f-ffc5-4162-9b9d-8398b554eb39` | Nov 6 03:30 | Nov 6 09:30 | +6 hours |
| `183af62f-c135-474b-b6d6-0fe77dc24c4e` | Nov 8 03:30 | Nov 8 16:30 | +13 hours |

The year is 2026. Existing IDs, kinds, planned dates and each complete LinkedIn
sub-schedule are preserved. Top-level post/draft/review become the existing
LinkedIn values. Generation becomes that LinkedIn post minus the verified existing
120-hour lead. Draft/review remain 48 hours before that post. These aggregate
timestamps change by the shown offsets; they are not claimed to be unchanged.
`updated` becomes the transaction timestamp and is recorded in the audit.

The only scope replacement is the exact reviewed three-platform JSON becoming
`{LinkedIn: <the existing sub-schedule>, platform_policy: {version: 1,
platforms: ["LinkedIn"]}}`. Other legacy shapes, added keys, malformed JSON,
changed timestamps, changed settings or already-bound rows are rejected. The
reviewed settings include generation OFF, lead 120, review 48, Asia/Kolkata,
the captured start/cadence/LinkedIn hours and exact settings `updated` value.

## Deliberate operator action

1. POST `{"action":"preview"}` to `/api/calendar/normalize-legacy` using the
   authenticated owner's cookie and exact configured Origin. The response shows
   the settings hash, each complete-row hash and old `updated`, all old/new
   aggregate timestamps, complete old/new platform JSON and the acknowledgement.
2. Present that concrete preview for the separate owner's normalization approval.
   Do not infer approval from source policy or final-post approval.
3. Only after that approval, POST `action: "commit"`, the unchanged
   `settings_hash`, four `entries` proofs, `preview_fingerprint`, and literal
   `acknowledged: true`. No arbitrary IDs, override options or activation fields
   are accepted. The assistant handles preparation; this repair does not ask the
   owner to configure technical settings or manually schedule a post.

A lost response requires inspecting the saved audit. An identical replay returns
the original audit ID without changing rows or adding an audit. That replay is a
historical receipt, not a claim about current eligibility or permission to run
anything. Changed settings/request data or ambiguous audit history reject replay.

## Atomicity, history and concurrency

One transaction locks settings, then all four target entries sorted by ID with
`FOR UPDATE OF e NOWAIT`. PostgreSQL `55P03` returns an actionable busy response:
no changes were saved; let the current operation finish and request a fresh
preview. No automatic retry is made. Every
row must still have its exact reviewed legacy contents, a future aggregate and
LinkedIn post, null source/task, no job, no Calendar-origin task, no entry grant
and no `calendar_publication_approved` receipt. Commit rechecks all preview tokens
and the clock at its write boundary. Any error rolls back all four updates and
the audit together.

`Calendar.prepareDue` takes entry UPDATE locks before inserting jobs and does not
take settings. Its multi-entry order is unchanged. NOWAIT avoids an opposite-order
wait against that existing operation, and held target entry locks protect job
absence. Dispatch/link/recovery start with settings; dispatch's task/grant
creation also holds the entry. Rolling refill holds settings and leaves existing
rows alone. Combined publication approval takes settings before writing its
Calendar receipt. The new audit writer uses settings and sorted entries too.
No task/source/policy/outbox/OAuth/budget lock is sought by this repair.

For each inspected exact TEXT event kind, an aggregate count/UTF-8-byte check
precedes loading: at most 1,024 rows, 1 MiB total and 64 KiB per detail. Loading
is bounded again and must agree with those counts. JSON is parsed with bounded
depth/nodes and duplicate decoded-key rejection. Canonical `entry_id` fields are
inspected; JSON escaping cannot hide a target UUID. There is no SQL `LIKE` match.
Malformed, unknown, ambiguous or excessive receipt data fails closed.

The existing events table stores one `calendar_legacy_normalized_v1` event with
schema version 1, exact request fingerprint, settings hash, four old-row hashes
and `updated` values, canonical full old/new rows (including all prior platform
JSON), and explicit old/new timestamp plans. No migration or new table is used.
No source, grant, task, approval, model ledger or publishing record is created,
and no activation switch is changed.

## Focused verification

Run only after the shared test slot is explicitly released:

```text
node --no-wasm-code-gc --import tsx --test --test-concurrency=1 tests/calendar-legacy-normalization.test.ts tests/calendar-legacy-normalization-route.test.ts
```

Fixtures use isolated databases and synthetic history only. Route tests execute
the real route, actual cookie authentication and actual helper; only the database
provider and helper clock are injected. Tests cover stale jobs/tasks/grants/
receipts, escaped and duplicate receipt keys, bounds before loading, atomic
rollback, exact scope, cookie/Origin rejection and side-effect-free replay.
They do not prove multi-session PostgreSQL concurrency or real scheduled delivery.
