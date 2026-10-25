# Exact Calendar one-shot drafting

This owner-cookie UI action runs one already queued Calendar task now. It is a
separate execution path from both the daily hosted batch and the original
manual-source one-shot. It supports exactly two modes:

- Initial: an unattempted task already dispatched from a due LinkedIn Calendar
  entry under the active bounded GitHub source policy.
- Revision: an unattempted, receipted direct child of that Calendar task, still
  bound to the current exact parent artifact version and feedback.

The approval inbox displays the full exact source, its hash, task/mode, model,
source policy and grant, Calendar entry and all three times. Revision mode also
shows its parent version and feedback. The checkbox starts unchecked and is
reset by a new preview. The POST accepts only task ID, exact preview version and
acknowledgement; worker bearer credentials cannot invoke it.

## Preconditions and limits

The existing source-policy/provenance/grant, LinkedIn-only brief, generation
opt-in, due generation time, future review/post times and 120–336-hour generation
lead all remain required. Current parent content, runtime/model consent and
pricing, global unresolved accounting and monthly budget are rechecked. No new
source permission, credential or provider is created. Every request is OpenAI
only, with at most six calls and $0.13 cumulative reserved usage. The original
manual-only eligibility rules and daily batch claim are unchanged.

A successful start records an immutable one-shot fence while the selected task
is locked. Both hosted and generic workers exclude that fence, including stale
candidate/lease recovery checks. No resume, fallback, auto-retry or queue sweep
is allowed. A timeout/unknown outcome retains its reservation; a late provider
response cannot advance the checkpoint. Refresh only reads durable status.

After six stages, final review admission is rechecked under the established
Calendar -> child -> parent -> source -> policy lock order. The reviewable task
(or complete new parent revision) and successful finish receipt commit together.
If final admission fails, paid outputs/accounting remain, but no parent revision
is created. Nothing is approved, enqueued for publication or posted. Normal
exact-version quality review and explicit owner approval are still required.

## Supported preparation

Calendar's existing **Queue eligible due drafts — no model calls** action can
create the initial queued task without consuming the daily generation attempt.
It selects unused evidence deterministically under the active policy; it does
not replace existing task/source links. The one-shot action does not select a
source, dispatch a plan, change any time or reset the daily claim. A future or
already-linked entry must not be manipulated to bypass these preconditions.

## Offline acceptance

`tests/owner-calendar.test.ts` injects fake providers against isolated embedded
PostgreSQL. It covers both modes, stale previews, source/policy/Calendar/parent
changes, daily and owner claim races, terminal atomicity, budget, cancellation,
timeouts and lost commit acknowledgements. Route tests include real local owner
cookies and reject worker bearer, cross-origin, malformed and revoked sessions.
UI handler tests cover exact preview consent, repeated clicks, changed previews
and interrupted request recovery. No test needs live secrets or model calls.
