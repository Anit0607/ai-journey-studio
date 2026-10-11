# Validation report — 10 October 2026

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
