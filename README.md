# AI Journey Studio

Private Next.js/TypeScript web app for Anit Bose's AI learning journey, with relational persistence and resumable single-step jobs. All seven logical roles are represented; Analyst remains insufficient-data until real metrics exist. No seeded live data, simulated agents, publishing or outreach.

## Cleared-source local drafting

The dashboard now supports blank source intake, separate exact-note owner clearance, explicit due-calendar activation, and queued agent feedback revisions with fresh approval. No records or credentials are created automatically. See [LOCAL_LOOP.md](LOCAL_LOOP.md) for the complete owner flow, recovery behavior and remaining hosted limitations. The example runtime configuration keeps the new standing-content scope disabled.

## Laptop validation

    npm ci
    npm run dev

The launcher prints a temporary owner access token and a laptop-only address. Open that address in a browser on this laptop and enter the token in the web sign-in screen. The token is generated for this process session and never saved. It protects every data/API action. It is not a provider credential.

The web client does not gain remote access to this laptop address. No remote deployment or tunnel exists. Review the committed screenshots in artifacts/ from this private repository.

Default laptop storage uses PGlite, an embedded PostgreSQL engine, at ignored data/web-postgres. It persists across server restart and uses the same SQL/schema as the network PostgreSQL adapter. Use one local app process per database directory; PGlite is not a multi-instance hosted database. Inherited DATABASE_URL values do not authorize external access and are ignored in local mode.

## Durable work

The source proposal and all actual state are behind authentication. The approved OpenAI-only secure launcher saves and queues only the exact consented note after readiness checks. Ordinary npm run dev is a blocked inspection session. Empty data stays empty until that authorized launch.

POST /api/studio/step claims and executes one persisted checkpoint. A separate local worker or future approved scheduler invokes it; browser closure has no effect on stored tasks. For local use, set STUDIO_ACCESS_TOKEN to the temporary web-session token in your own process environment and run npm run worker. This is a local access token, never an API key. The worker calls the web service; it does not open a second embedded database. It stops when setup/reconciliation is required.

Jobs use row locks, a lease, persisted checkpoints and unique artifact/action constraints. Expired work with an unresolved provider reservation is blocked. Safe explicit retry resumes at the saved checkpoint; uncertain completion never automatically retries. Cancellation stops future calls and retains any in-flight usage. All artifacts and their exact SHA-256 hashes are checked during approval, including source clearance/version.

## Provider and budget setup

The first user-operated OpenAI session completed six real outputs and reached review-ready. Its reported-token cost estimate is $0.005690, with no unresolved reservations; invoices have not been verified. The agent did not read credentials or restart live work. See LIVE_RUN_CHECK.md. The first-capsule mode remains limited to that shorter exact note. The separately approved standing mode requires explicit owner clearance for each dashboard source. Local keys are entered by the user through python scripts/secure_start.py; hosted persistent-key use requires separate approval. The example configuration enables nothing.

Combined monthly warning $10 / maximum $15, with $1 buffer inside the cap and IST calendar month. Atomic PostgreSQL transactions lock a shared budget guard before reserving an upper bound. Current-month settled costs plus every unresolved reservation, including prior-month unknown calls, constrain spending. Provider token estimates are distinct from invoices. Input/retry/concurrency/output bounds apply. Gemini fallback occurs once per step only for eligible transient HTTP errors, never access or safety refusals.

## Network PostgreSQL and hosted shape

lib/db.ts includes a pg connection adapter and additive migrations 001–009. An external database connection requires explicit STUDIO_DATABASE_AUTHORIZED=1 as well as a user-supplied approved DATABASE_URL. npm run migrate applies the schema only after that authorization. No database, credentials or cloud resources are provisioned.

Next.js App Router and Node API routes provide the Vercel web deployment shape. Embedded persistence is disabled on Vercel. The disabled Hobby adapter now provides a protected daily batch route, durable daily deduplication and separate persistent-access gates. See [HOSTED_HOBBY.md](HOSTED_HOBBY.md) for limits and the owner approval/setup checklist. Network database integration, scheduler delivery and owner authentication setup remain unverified. The compiled app is not evidence of production integration or 24/7 operation. No deployment is authorized.

## Checks

    npm run typecheck
    npm run lint
    npm test
    npm run build
    npm run qa

Browser QA uses a project-scoped Playwright headless browser and an isolated empty database. Set PLAYWRIGHT_BROWSERS_PATH to data/qa-browsers when using the installed local browser files. No browser fixtures populate the dashboard. Unit fixtures stay in isolated memory or temporary directories.

The earlier Python/SQLite slice and its tests remain as reference evidence, while npm scripts and app/lib are the primary implementation. See QA.md and ARCHITECTURE.md for precise integration limits.

Blueprint materialization remains blocked: the supported Library helper requires os.setxattr, unavailable on Windows. Implementation follows the delegated approved brief with the live-only override.
