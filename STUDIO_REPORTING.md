# Real studio activity and owner-reported results

This dependent code change adds no demo records, provider calls, external imports, new accounts, deployment or activation. Migration 011 is additive and remains unapplied to any live database. It follows the reviewed password-authentication candidate without changing its security configuration.

## Usage and agent activity

Every new provider reservation receives the role and checkpoint from the server's locked task row. SQL prevents later attribution changes. Existing calls retain null attribution and appear as Unattributed; call order is never used to guess their role.

Usage shows each recorded IST month and lifetime totals: attempts, settled calls, known input/output tokens, unknown-usage calls, settled token-cost estimates and unresolved reservations. Current task/checkpoint states and original/revision artifacts are inspectable separately. These are provider-reported estimates, not paid invoices. Analyst is deterministic reporting, with no model execution.

The global budget guard is unchanged: US$10 warning, US$15 combined maximum, US$1 buffer inside that maximum, and unresolved earlier-month reservations still count against the current budget. Nothing here enables hosted scheduling, Gemini fallback, publishing or paid execution.

## Exact platform drafts

The Platform Adapter now requests three exact section headings: `### LinkedIn`, `### X`, `### Instagram`, each followed by nonempty draft text. Exact legacy plain or Markdown headings with optional colons can be inspected too. A name embedded in prose does not identify a platform. Missing, duplicate, empty, placeholder or malformed sections block fresh original and revision approvals in addition to existing factual/privacy checks.

Each parsed platform draft has a hash over its schema version, exact platform identity and draft text. The original adapter artifact retains its own unmodified hash. Old outputs, revision bundles and approval records are not rewritten. Unstructured legacy content remains visible but its platform completeness is unverified. Historical approval does not mark an incomplete artifact or a newer unapproved revision ready.

## Metrics that reflect real observations

Analytics accepts an owner-entered platform, exact post reference, observation timestamp, optional content-task link and source/coverage note. Impressions, reach, likes, comments, shares and clicks are individually optional. Blank means unknown; an explicit zero is retained.

Each post's snapshots are append-only with optimistic version checks. The most recent saved observation is displayed for that exact platform/reference. Earlier observations remain in history and are never summed as incremental activity. Platforms are not combined and post identity is not inferred across different references. Observation time is entered in UTC; reporting month is derived in Asia/Kolkata. A later snapshot cannot backdate the current observation. Corrections at the exact same observation timestamp are allowed.

## Attributable finances and coverage

Financial entries use integer minor units (cents or paise), reporting month, currency (USD or INR), revenue/expense category and a source reference explaining attribution. The owner explicitly confirms that an amount belongs to AI Journey content; general project/business revenue is never automatically attributed to content. Reference fields must not contain bank, client, customer, private or credential details.

Amounts start empty. Revenue is unknown until entered, including an explicit zero when appropriate. Each financial entry is immutable. Correct an entry by voiding it with a reason and adding a new one; the original stays in history. Duplicate request IDs are idempotent and cannot be reused with different data. An active record cannot reuse the same period/currency/kind/reference.

Two separate calculation bases are available:

- Tracked attributable cash return: recorded attributable revenue and cash expenses, including actual AI payments. Token estimates are shown separately and not added. Unpaid costs and time are excluded.
- Estimated return including AI token costs (USD only): recorded attributable revenue minus non-AI cash expenses and reported-token cost estimates. Every relevant ledger call must have settled, known usage. Any actual AI-invoice entry blocks this basis; invoices and estimated token costs cannot be counted together.

Both require explicit current revenue coverage and cost coverage for the reporting month/currency, with provenance. Coverage is bound to the exact current financial/ledger inputs and becomes stale as inputs change. Missing or incomplete data yields unavailable return. A zero cost denominator never produces a percentage. The formula is `(attributable revenue - attributable costs) / attributable costs`; it is descriptive, not a causal or future-earnings claim.

USD and INR totals remain separate. There is no FX conversion. INR token-estimated return is unavailable; the owner must record any applicable actual AI expense in INR with provenance before confirming complete INR cash-cost coverage. No learning value, labor value, unknown revenue or unrecorded cost is invented.

## Privacy and operating boundary

All reads and writes use the existing owner authentication, Origin checks and body bounds. Reporting records are stored separately and never automatically copied into source notes, task prompts, provider calls or social publishing. This feature does not connect analytics APIs, OAuth, GitHub, YouTube, chat accounts or bank accounts. Only explicitly cleared real source notes can enter the existing drafting workflow.

Tests use disposable databases and deliberately marked fixtures only. Production migrations, real network PostgreSQL concurrency, credential setup, deployed authentication and hosted execution still require separate authorized setup and verification.
