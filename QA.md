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

## Disabled Hobby adapter checkpoint — 2026-10-12

Based on desktop checkpoint `ad0e6f008892c67a3c1a59f817a95eb309019854`.

- Cloud: 160/160 TypeScript tests passed; 8/8 isolated Python secure-launcher tests passed. TypeScript, ESLint and production Next.js build passed. The build includes the dynamic Node `/api/cron` route and does not require credentials or database access.
- New coverage: separate production/owner/cron/persistent-key gates; preview failure; default same-day and explicitly approved seven-day pricing boundaries; authenticated route denial before DB access; daily deduplication and cross-day lease recovery; checkpoint/time limits; cancellation and uncertain usage; default production wiring rejects legacy uncleared queues and short-lead calendar tasks; safe mocked checkpoint resume on a later day; 120-hour planning policy and inherited revision deadlines. SQL migration009 parity ignores only checkout line endings.
- An independent read-only reviewer revalidated 41 hosted runtime/HTTP/batch tests, including zero mock calls for ineligible old queues. An intermediate missing-policy wiring issue was fixed before this checkpoint.
- All database tests use isolated in-memory PGlite. A deliberately marked Postgres-kind test wrapper exercises the runner without opening a network connection. This is **not** evidence of network PostgreSQL multi-connection locking, hosted persistence or production billing.
- No hosted deployment, secret configuration, provider transmission, source import/clearance, paid upgrade or scheduler activation occurred. `vercel.hobby.example.json` is inert. Runtime example approvals remain false; pricing review windows remain off.
- Hosted rendered browser QA was not run. The existing cloud browser access restriction remains respected; earlier Windows screenshots do not validate these new hosted UI notices. Real Vercel Authentication/cron interaction, the once-daily jitter, network database setup and actual deployment must be verified separately after the owner's approvals. See `HOSTED_HOBBY.md`.

## Password authentication cloud review — 2026-10-13

Exact desktop handoff: `3b7805609e5da535dcf4c47a81492a360ebf56ee`, branch `owner-password-login-2026-10-13`, draft PR2. All 109 non-binary files were checked against remote Git blob hashes before isolated testing; the screenshot files were not copied to this cloud checkout. Dependencies were installed from the unchanged lockfile.

- Final cloud checks: **171/171 TypeScript tests and 35/35 Python tests passed**, plus typecheck, ESLint and production Next.js build. Python total includes 27 new mocked owner-setup tests and 8 existing secure-entry tests. The original Windows failure was a CRLF/LF-only comparison; the shared parity helper still compares every substantive schema character.
- Independent read-only security review reproduced and revalidated two session fixes: an absolute eight-hour expiry that is not renewed by activity, and verified durable logout before success/cookie deletion. Injected deletion failure returns 503, retains the cookie for retry, and a successful retry invalidates copied cookies. The strengthened regression uses a fake clock past the renewal threshold and the expiry boundary.
- Hosted owner cookie access works with paid-generation master flags disabled. The actual owner `/step` route still returns 403 and cron remains gated; the isolated route test records no provider requests, ledger entries or content tasks. Owner authentication does not authorize model execution or implicit database migration.
- Setup-helper hardening rejects encoded socket-like Neon hosts, host overrides and TLS certificate-file parameters; enforces explicit local-only mode on direct worker invocation; validates password/payload before migration; and sanitizes input, launch, transaction and cleanup failures. Tests use fake input and mocked module/process calls, never real connection strings. Certificate-verified TLS is enforced; real TLS/channel-binding negotiation was not tested.
- A disposable empty local fixture served successfully inside the execution workspace. The supported cloud UI browser could not reach that workspace's localhost (`ERR_CONNECTION_REFUSED`), so **rendered password-login QA remains unverified**. No denied Chromium launch, tunnel or security bypass was attempted. The test server was stopped and fixture removed. `scripts/password-qa.ts` includes the normal login/reload/logout/lockout flow and failed-logout retry scenario for a future permitted browser environment.
- No PostgreSQL server/client/container tooling is available here. All SQL/auth tests used isolated PGlite, including an explicitly marked Postgres-kind wrapper for hosted gate tests. Real Neon connectivity, multi-connection locking, production migrations, deployed cookies and owner provisioning remain unverified and require approved setup.
- No live database, owner password, Vercel secret, provider key or production runtime configuration was read or changed. No account provisioning, paid model calls, deployment, merge, scheduling activation or source clearance occurred. The branch remains a reviewable code candidate, not activated authentication.

See `PASSWORD_AUTH.md` for the owner-controlled hidden-input setup and separate production approvals. The ordinary dashboard login now uses the owner password and HttpOnly cookies; the process-only local bearer token is retained only for the internal worker.

## Bounded studio completion candidate — 2026-10-13

This separate dependent change is based on password-authentication candidate `7ee72df7324d1af6e95f7d14c3977b4497433b70`. All 110 base text/source files matched the remote blob hashes before implementation; remote binary screenshots are preserved through the base tree. Frozen auth PR2 was not edited. Authentication/session code and production settings remain unchanged.

- Final regression command: `node --import tsx --test --test-concurrency=2 tests/*.test.ts`, **188/188 passed**. All **35/35 Python** secure-entry/setup tests passed. TypeScript, ESLint and the production Next.js/Turbopack build passed. Dependency versions and lockfile are unchanged. The lower test-file concurrency avoids an isolated process termination observed while full parallel tests, independent reviews and a build overlapped; the final complete run passed.
- New regression coverage checks immutable server-side role/checkpoint attribution, unattributed legacy calls, month/lifetime total reconciliation, cancellation, per-platform exact hashes, incidental X, missing/duplicate/empty headings, fenced/indented pseudo-headings, original/revision approval gates, and latest-unapproved-revision calendar status without erasing history.
- Owner-report checks cover empty data, nullable metrics vs explicit zero, immutable cumulative post snapshots, precise observation times, invalid/future dates, stale concurrent edits, bounded exact integer money, duplicate submissions, attribution acknowledgements, USD/INR separation without FX, revenue/cost coverage, zero denominators, unresolved usage, invoice/estimate exclusivity, cost-basis switching, and invalidation after corrections/voids. Real cookie-authenticated routes enforce access, Origin and request-size checks, preserve logout denial, and record zero provider transmissions, source additions or task creation.
- Independent read-only accounting and platform/approval reviews reproduced four edge cases and verified their corrections: cost-basis selection after switching back, acknowledgement resurrection after adding/voiding a record, historical task approval leaking into latest revision calendar status, and platform headings inside fenced code. No remaining blocking findings were reported in those scopes. One later hardening also rejects normalized impossible observation dates and bounds aggregate minor units.
- Rendered completion UI QA remains **unverified**. `scripts/completion-qa.ts` prepares a disposable empty database and covers metrics entry/correction, explicit-zero reporting, coverage invalidation, void cancel/confirm, currency separation, responsive layout, usage inspection, reload and sign-out. The Playwright bundled browser is absent in this cloud workspace. The installed Chromium aborts under the socket sandbox (`Operation not permitted`). No tunnel, browser-security workaround, real user data, or live database was used. The isolated server and fixture were cleaned up. Run the harness in a supported browser environment after the production build; `--edge` selects installed Microsoft Edge on the approved desktop.
- All database checks use isolated PGlite. Real network PostgreSQL multi-connection behavior, production migration 011, deployed reporting and browser layout still need separately authorized verification. No provider key/secret was accessed; no provider call, account setup, source clearance, scheduling activation, deployment or merge occurred. Reporting records never enter model prompts. Publishing stays disabled.

See [STUDIO_REPORTING.md](STUDIO_REPORTING.md) for data semantics, operating boundaries and exact unknown/coverage behavior.

## Completion smoke locator maintenance — 2026-10-14

Recorded desktop QA passed against exact candidate `64a1f3de024613f21077a5510709c5e5641138ab`; merged main `636dc80c3e42db999ebe6abfcd48909c50b2e2f6` has no file differences from that candidate. The desktop result confirms local build, desktop/mobile reports, empty/zero/unknown states, month/lifetime usage, currency separation, coverage/cost-basis/void handling, platform completeness and interrupted/repeated-save behavior. No application-code changes were needed. This supersedes the earlier cloud-only limitation as evidence for that candidate's rendered UI.

The committed smoke runner itself failed on exact dropdown-label matching. This maintenance changes only the runner's `Record type`, `Currency` and `Usage window` selectors to native `combobox` roles with stable accessible-name prefixes, plus test/documentation support. The actual UI, authentication, database schema and runtime configuration are unchanged. Node regression coverage checks the selector contract against rendered component markup; it is not a new browser pass. See [SMOKE_QA.md](SMOKE_QA.md) for the repeatable desktop command and the distinction between smoke and supplemental coverage.

No laptop work, production operation, live database, real credential or provider call is part of this maintenance. [MORNING_SETUP_CHECKLIST.md](MORNING_SETUP_CHECKLIST.md) prepares the separately approved owner-controlled next steps with generation, cron, fallback and provider access kept off.

Maintenance verification: **190/190 TypeScript tests** passed with `node --import tsx --test --test-concurrency=2 tests/*.test.ts`, including the two new selector-contract tests; **35/35 Python secure-entry/setup tests**, TypeScript checking, ESLint, production Next.js build and diff whitespace checks passed. Database-related regressions used disposable PGlite fixtures only. No fresh browser launch was attempted to bypass the previously confirmed cloud restriction; the corrected committed runner still needs its own supported-environment rerun before claiming that exact script passed end to end.
