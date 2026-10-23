# Release-time migration 020

This is a narrowly scoped deployment hook for the already-authorized production
database. It does not provision a database, retrieve credentials, change access,
create an owner, enable publishing, approve content, or contact a social provider.

`vercel.json` explicitly selects `npm run build:vercel`. That package command runs
`node --import tsx scripts/release-migration.ts --vercel-build` before `next build`, and `&&` prevents the
application build after a migration failure. Vercel's versioned `buildCommand`
overrides the dashboard build command; this does not require a dashboard change.
The explicit flag identifies a Vercel build context, not authorization: missing
all system markers therefore fails instead of being mistaken for local work.
Ordinary local `npm run build` omits that flag and skips the hook's database work.

## Destination and permission gates

- Apply only with exact Vercel production build markers: `VERCEL=1`, `CI=1`,
  `VERCEL_ENV=production`, and `VERCEL_TARGET_ENV=production`.
- Require the existing `STUDIO_DATABASE_AUTHORIZED=1` gate, a valid network
  PostgreSQL `DATABASE_URL`, and no local-database or test-mode selection.
- Clearly local/test builds skip without constructing a database client.
- Positively identified preview, custom-preview and development builds skip
  without inspecting credentials or constructing a client. A preview's separate
  database authorization/isolation is not established by this repository, so
  this hook never migrates previews or borrows production credentials for them.
- Partial, contradictory or unrecognized Vercel markers fail closed with a static,
  actionable message. A production build must not be treated as migrated merely
  because the UI is visible.

## Transaction and verification

The hook opens one connection using only the existing deployment environment.
It bounds connection time at 5 seconds, lock waits at 5 seconds, statements at
15 seconds, client query waits at 20 seconds, idle transactions at 15 seconds,
and the migration sequence at 60 seconds. Rollback and shutdown each have an
additional 2-second bound. The CLI terminates with failure if cleanup cannot be
confirmed. It does not retry an uncertain result.

Within one transaction it sets a fixed `pg_catalog, public, pg_temp` search path,
takes a transaction-scoped advisory lock shared by migration-020 builds, checks
for the existing public schema-version-19 marker and ordinary outbox table, and
takes the bounded outbox table lock. It executes only
`MANUAL_PUBLICATION_SCHEMA`, not the historical bootstrap `SCHEMA`.

Before committing it checks the actual `public.publishing_outbox.delivery_mode`
catalog definition: writable built-in text with default collation, NOT NULL, the exact scheduled default, and a
validated CHECK admitting only scheduled/manual. It also checks the version-20
marker. An existing version marker alone is never trusted; a conflicting column,
missing/invalid/permissive CHECK, or missing prerequisite fails without trying to
repair/drop any existing column or constraint. Transaction failure is rolled back
when possible and otherwise closing the connection aborts uncommitted work.

Repeated builds are idempotent. If the migration commits and the later Next build
fails, the additive column remains compatible with the previous application.
Do not remove it as an automatic rollback. An interrupted commit may be uncertain:
inspect schema state before another release instead of assuming failure.

Only static status/stage messages are logged, never URLs, raw driver errors,
credentials, query results or nested causes. This hook does not alter publication
gates, account status, approvals, sources, model budgets or provider transports.

## Verification and limits

Local tests use injected transports and PGlite only. They do not establish live
network PostgreSQL contention or prove a production migration ran. The deployed
build must actually use this reviewed command and complete successfully before
the production schema can be described as migrated. If logs are inaccessible,
do not try alternate routes around that restriction or claim their contents.

Official documentation checked during implementation:
- https://vercel.com/docs/environment-variables/system-environment-variables
- https://vercel.com/docs/project-configuration/vercel-json#buildcommand
- https://node-postgres.com/apis/client
- https://www.postgresql.org/docs/current/runtime-config-client.html
