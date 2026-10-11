# Validation report — 10 October 2026

## Windows follow-up - 11 October 2026

Source-file warning regression: successful staging now clears only the obsolete file-import error. Failed staging retains the current error and form text. `npx tsx scripts/source-file-qa.ts --edge` checks TXT/JSON preview and replacement, invalid files preserving form state, invalid-file-to-valid-file recovery, failed privacy validation, and corrected successful staging using ephemeral uncleared fixtures only. No actual model calls are made; its screenshot is `artifacts/source-file-qa.png`.

The exact cloud checkpoint ba234ed was fast-forwarded into a clean laptop checkout. Its first Windows run passed 98/100 TypeScript tests; the two new migration comparisons failed only because Git checked them out with CRLF. The comparisons now normalize CRLF to LF only. A regression rejects changed SQL defaults/types, spaces, missing final newline and bare CR. Substantive schema assertions and additive migration checks remain intact.

After that fix, all 101 TypeScript tests and 8 mocked Python secure-entry tests passed on Windows, with typecheck, lint and production build. Isolated source stage/clear/revoke, blocked calendar dispatch and manual fresh-approval browser checks passed in installed Microsoft Edge. Playwright's bundled Chromium was absent; no browser software was installed. None of these checks opened the user's database or called an actual provider.

The reproducible rendered agent-revision check is `npx tsx scripts/agent-revision-qa.ts --edge` after `npm run build` (omit `--edge` when the bundled Chromium is installed). It uses an ephemeral database, explicit credential-free server environment and injected mock completions. It exercises UI feedback queuing, stops the isolated server, processes three steps, reopens the browser at checkpoint three, finishes the remaining steps after another stop, and checks fresh exact-version approval, historical originals and settled mock accounting. Its screenshot is automated fixture evidence, not real generated content or spending.

Primary app: Next.js / TypeScript with relational SQL.

Passed:

- 53 isolated TypeScript tests: authentication/origin, inherited configuration authorization, exact source consent/privacy filtering, duplicate actions, job claims, budget concurrency, IST rollover, prior-month uncertain reservations, lease expiry, cancellation/in-flight accounting, source invalidation, no-consent/no-call, timeout/no-replay, refusal/no-fallback, bounded fallback, approval integrity, safe retry, two-migration schema parity and close/reopen persistence. Added provider tests verify explicit standard service tier, returned-tier/model validation, immutable session configuration, OpenAI/Gemini finish reasons and missing usage. Workflow tests verify global pricing pause, retained unknown reservations, incomplete Critic checkpoints and safety retry prohibition. Two pilot tests verify readiness gating and exact server-approved source queuing.
- npm run lint, npm run typecheck and npm run build. Build tracing excludes local database files and runtime setup from hosted bundles.
- Seven isolated Python secure-entry tests pass: missing authorization, redirected input and .env existence stop entry; inherited key aliases/configuration are excluded without reading their values; Gemini skip/disabled consent cannot retain an old key; freshly supplied mock keys and the exact reviewed configuration alone reach the child. Sixteen legacy Python tests also pass (23 total). All credential tests use isolated mocks.
- Playwright rendered QA against the compiled app with an isolated empty persistent database: unauthenticated and wrong-token access; authenticated blocked/empty view; disabled source save; Sources/Usage/Events/Approval navigation; empty cost display; mobile overflow; sign-out; no browser errors; all source/task/output/event/ledger/approval tables empty.
- Screenshots: artifacts/web-auth.png, web-empty-blocked.png, web-usage-empty.png and web-mobile-empty.png. They show real empty state; no sample dashboard records were created.

The first browser tool crashed during initialization. Alternative project-scoped Playwright succeeded. Initial authenticated web QA exposed inherited DATABASE_URL selection; the code now prefers explicit local mode and gates external connections with independent authorization. The regression is tested.

Earlier Python HTTP/worker checks remain legacy evidence, separate from the main web architecture. Legacy execution requires an independent flag that is not enabled.

The restricted sandbox initially blocked disk reopening, Python temporary database files and Next build path resolution. Repeating verification with normal filesystem access passed without changing application code for those access errors.

Not run: real network PostgreSQL connection/migration, multi-process hosted row-lock and scheduler delivery integration, hosted authentication/identity provisioning, Vercel deployment/eligibility, provider account model access, paid calls. Docker's local daemon is unavailable; psql is not installed. PGlite persistence and SQL checks do not establish network PostgreSQL deployment behavior.

No source/runtime fixture records entered the live workspace. The initial preflight checks used no credentials or provider calls. The later user-operated real task completed six OpenAI calls; its sanitized verification is documented in LIVE_RUN_CHECK.md. No credentials were inspected by the agent, content published or hosted resources provisioned.

Revision correction checks: immutable original artifacts/approvals, append-only manual revisions, exact-version approval acknowledgement, stale/concurrent edit rejection, source invalidation, privacy filtering and grounding flags pass with isolated fixtures. Compiled browser Request changes/edit/fresh approval flow passes with zero provider ledger entries and unchanged originals. See REVISION_WORKFLOW.md.

Calendar checks verify approved/unset configuration, IST deadlines, explicit links, blocked readiness, invalid input and idempotent/concurrent due intents with zero content tasks or provider ledger entries. See CALENDAR.md for local-only scheduler and activation limits.

Platform/day timing checks pass: optional unset preset, distinct IST variant deadlines, earliest-slot shared review deadline, incomplete/invalid timing rejection, truthful benchmark provenance and additive legacy preservation. Final compiled calendar browser QA proves loading the benchmark does not save it or choose a date. The authorized stopped-app planning setup preserved original content/approvals/costs and left generation/source links unset.

## Cloud implementation checkpoint — 11 October 2026

The local cleared-source/scheduled-draft/agent-revision loop is implemented and verified without the user's laptop or live data. This supersedes older implementation-gap statements above; it does not establish hosted execution or paid-provider integration.

Passed on the final cloud source snapshot:

- 100 isolated TypeScript tests via `node --import tsx --test tests/*.test.ts`, including all 53 prior tests.
- 8 mocked Python secure-entry tests, including standing-content launch without the legacy pilot or Gemini.
- `npm run typecheck`, `npm run lint`, `NEXT_TELEMETRY_DISABLED=1 npm run build`, and `git diff --check`.
- Exact route flow: authenticated staging, hash-bound owner acknowledgement, clearance, revocation, and runtime gating with zero provider calls.
- Complete isolated SQL/workflow loop: cleared concrete note → one scheduled longform task → six mocked OpenAI roles → original approval → feedback revision → restart midway → six completed revised roles → fresh exact-version approval. Original artifacts and approvals remain unchanged; 12 mock calls and no unresolved reservation. This is test evidence, not real generated content.
- Concurrent/idempotent dispatch, frozen brief, explicit default-off activation, budget headroom, prior-month unknown usage, cancellation, stale revision bases, source revocation, migrations/reopen, historical-artifact privacy guards and no automatic replay.

Independent review caught and corrected two defects: stored manual artifacts are checked for excluded material immediately before any outbound revision prompt, and new generation leads require 49–336 hours to leave at least one hour ahead of the 48-hour review deadline. Legacy 48-hour plans remain unchanged and explicitly blocked until corrected and replanned. Catch-up within the review window is labeled as a late start; dates are never changed automatically.

Verification limits:

- New rendered browser QA is not established. Browser socket creation was denied in this executor, including the reviewed escalation route; no workaround around that restriction was attempted. Existing committed screenshots belong to earlier laptop validation and do not prove the new UI flows. Static rendering checks and compilation are not substitutes for interactive browser testing.
- The npm test wrapper's tsx CLI needed an IPC socket unavailable here; the direct supported Node import loader ran the same test files successfully.
- Legacy Windows-only Python/SQLite tests cannot import msvcrt on this Linux executor and were not passed here. They are separate from the primary app and eight secure-entry tests.
- No real database, provider credential, actual paid call, deployment, merge, publication, hosted scheduler or network-PostgreSQL integration was exercised. Existing real content, ledger, source clearance and runtime configuration were not read or changed.

## Local source-file chooser

After desktop checkpoint 99ec186, the authenticated Sources form now accepts a user-selected UTF-8 .txt file or a strict three-field .json file (text, category, reported_date). The file is read only in the browser into a separate preview. It does not upload, stage, clear or call a provider. Applying the preview to an occupied form requires explicit replacement acknowledgement; staging and exact-note clearance remain separate owner actions. Unknown/duplicate JSON fields, malformed UTF-8, unsupported extensions, oversized text/files and invalid dates/categories are rejected. Source privacy validation still runs on the existing server staging path.

Verification: 117 TypeScript tests and 8 mocked Python tests pass, including 15 parser tests and a static empty-form/no-side-effect UI smoke test. Final typecheck, lint and production build pass. The existing desktop browser evidence above covers the prior loop; interactive file-picker/replacement behavior is not established by this cloud check. No real source file, live database, credential or provider call was used, and no file was automatically imported or cleared.
