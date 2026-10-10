# Validation report — 10 October 2026

Primary app: Next.js / TypeScript with relational SQL.

Passed:

- 20 isolated TypeScript safety tests using embedded PostgreSQL: authentication/origin, inherited configuration authorization, exact source consent/privacy filtering, duplicate actions, job claims, budget concurrency, IST rollover, prior-month uncertain reservations, lease expiry, cancellation/in-flight accounting, source invalidation, no-consent/no-call, timeout/no-replay, refusal/no-fallback, bounded fallback, approval integrity, safe retry, schema parity and close/reopen persistence.
- npm run lint, npm run typecheck and npm run build. Build tracing excludes local database files and runtime setup from hosted bundles.
- Two isolated Python secure-entry guard tests pass: no authorization and redirected input both stop before any key prompt.
- Playwright rendered QA against the compiled app with an isolated empty persistent database: unauthenticated and wrong-token access; authenticated blocked/empty view; disabled source save; Sources/Usage/Events/Approval navigation; empty cost display; mobile overflow; sign-out; no browser errors; all source/task/output/event/ledger/approval tables empty.
- Screenshots: artifacts/web-auth.png, web-empty-blocked.png, web-usage-empty.png and web-mobile-empty.png. They show real empty state; no sample dashboard records were created.

The first browser tool crashed during initialization. Alternative project-scoped Playwright succeeded. Initial authenticated web QA exposed inherited DATABASE_URL selection; the code now prefers explicit local mode and gates external connections with independent authorization. The regression is tested.

Earlier 16 Python safety tests and HTTP/worker checks remain legacy evidence. They are separate from the main web architecture.

Not run: real network PostgreSQL connection/migration, multi-process hosted row-lock and scheduler delivery integration, hosted authentication/identity provisioning, Vercel deployment/eligibility, provider account model access, paid calls. Docker's local daemon is unavailable; psql is not installed. PGlite persistence and SQL checks do not establish network PostgreSQL deployment behavior.

No source/runtime fixture records entered the live workspace. No provider key prompt was run, credentials persisted, provider charges incurred, content published or hosted resources provisioned.
