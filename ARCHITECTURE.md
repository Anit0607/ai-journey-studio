# Architecture decision: local validation and web migration

The current Python/SQLite application is a local workflow slice, not Vercel-ready. It requires a long-running Windows worker and a local SQLite file. Hosting that file inside a serverless function would lose shared durability and invalidate the atomic combined budget guarantee.

Minimum clean migration:

1. Preserve source/approval hashes, task checkpoints, events and ledger semantics as the contract. Extract provider, orchestration and storage boundaries before porting; do not recreate behavior ad hoc in routes.
2. Introduce PostgreSQL persistence. Budget reservation locks a per-IST-month budget row in a transaction, checks settled estimates plus all unresolved reservations, and inserts the reservation before releasing the lock. Enforce unique action keys and artifact versions in the database.
3. Replace the Windows singleton with durable step jobs carrying task ID, checkpoint and lease expiry. Each invocation performs at most one bounded provider step and commits output/checkpoint/ledger together. A lost lease with an in-flight call blocks replay until reconciliation; leases must never imply a free retry.
4. Build a Next.js interface/API with authenticated owner access and server-side authorization for every source, job and approval. Private material lives only behind authentication. User review remains version-bound.
5. Choose an approved durable scheduler/queue and database after hosting eligibility/cost decisions. Vercel can host the web surface, but browser activity and an in-process loop cannot schedule durable work. No provider or hosting purchase is authorized by this document.

Tradeoff: staying local allows the first consented real workflow without a cloud subscription or access grant. Migrating adds infrastructure, authentication, transactional concurrency and job-delivery testing. A large rewrite before those decisions would risk wasted work. The current SQL statements are SQLite-specific; they are not a drop-in Postgres adapter.

Seven logical roles are covered: Harvester, Story Miner, Strategist, Writer, Platform Adapter, Critic and Analyst. Orchestrator is the lifecycle controller, separate from the seven. Harvester currently normalizes factual claims and provenance from one exact allowlisted capsule; it does not discover or import external sources. Privacy filtering before transmission is deterministic exact source/category/date gating. Critic adds factual/privacy review of the resulting versions. Neither model role establishes consent. Analyst returns insufficient-data because no real performance metrics exist.

The intended four weekly pieces / twelve variants schedule is not automated in this slice. It creates one reviewed content family from the approved note; expansions need new cleared evidence. There is no publishing.
