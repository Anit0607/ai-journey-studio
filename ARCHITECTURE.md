# Architecture correction

The primary implementation is now Next.js App Router, React and TypeScript, with PostgreSQL SQL persistence through a shared Database interface. pg supplies the network adapter. PGlite supplies an embedded PostgreSQL engine for laptop verification without service installation. Legacy Python/SQLite code remains reference evidence.

Relational state includes sources, tasks, artifacts, events, approval hashes, monthly budget guards, provider ledger reservations and runtime heartbeats. Both adapters execute the same PostgreSQL schema and SQL. Hosted migrations are explicit; the local embedded database initializes the schema without seeding workspace records.

Each authenticated job-step invocation locks/claims one task, records a 240-second lease, reserves an upper-bound cost atomically, performs at most one primary call plus one eligible fallback, and commits output, cost and checkpoint together. No detached background promise or browser loop performs jobs. A local process invokes the API; a hosted durable scheduler can invoke the same step contract after provisioning is authorized. Lost delivery is recovered by a later invocation; an expired lease with any uncertain provider reservation blocks automatic replay.

Budget reservation takes a global row lock, including across IST month changes, and counts current-month settled estimates plus all unresolved calls from any month. It keeps the $1 buffer inside the $15 maximum. Prices are versioned per ledger row; reported tokens and estimated charges are not invoices. A disagreement above the reserved bound blocks further work for investigation. PostgreSQL transactions and constraints provide the intended multi-instance coordination; real network/PostgreSQL multi-process integration has not been run.

Web authentication is a high-entropy, process-session owner token for laptop validation. All private reads and mutations check it server-side; mutations also check the configured Origin and bound request size. Browser token stays in React memory and is cleared at sign-out. A hosted owner authentication configuration still requires explicit setup. This is not a provisioned OAuth/identity service.

Vercel deployment shape is present: Next.js web surface and Node route handlers, with embedded storage forbidden on Vercel. Required hosted integration remains: approved PostgreSQL connection, persistent owner authentication, durable scheduler delivery and Vercel eligibility. No hosted resources, subscriptions, grants, deployments or credentials were created. Compile success does not establish these integrations.

Seven roles: Harvester, Story Miner, Strategist, Writer, Platform Adapter, Critic and Analyst. Orchestrator controls lifecycle separately. Harvester normalizes claims/provenance from one exact allowlisted capsule; it does not browse or import external sources. Source text/category/date plus consent are checked deterministically before any reservation/transmission. Critic reviews facts/privacy against the exact platform variants. Analyst remains insufficient-data. No role grants itself permission.

Four weekly pieces/twelve variants are a later cadence target. This first slice creates a single reviewed content family from approved evidence. No publishing or performance claims.
