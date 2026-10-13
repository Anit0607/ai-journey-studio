# First real run verification - 10 October 2026

Read-only sanitized metadata from a temporary copy of the laptop database confirms one task at checkpoint 6, status review, no active lease and no block reason. Six genuine outputs exist: Harvester, Story Miner, Strategist, Writer, Platform Adapter and Critic. They await exact-version user approval. Analyst still has no real platform metrics.

Six OpenAI calls to gpt-4.1-mini-2025-04-14 are settled, all with complete/stop termination and requested/returned default service tier. Reported usage totals 5,790 input tokens and 2,108 output tokens. Per-call upward-rounded ledger estimates total 5,690 microdollars ($0.005690). Unresolved reservations total zero. This is reported-token accounting, not an independently checked provider invoice.

The task reached review-ready at 07:33:18 UTC. The job-step heartbeat continued until 07:54:11 UTC. Later fast HTTP 200 step responses were idle polls, with no additional provider attempts in the ledger. The exact transport/JSON failure behind the final worker exception was not persisted and cannot be determined from this state. No listening server on port 3000 was observed during inspection; no process environment, credentials, owner token or terminal history was read.

The original worker printed "Unknown step completion" for every transport/JSON exception, including idle disconnection. It now performs one authenticated read-only state request after an interruption. It reports review-ready work separately from unresolved/in-flight work; unavailable state remains unverified. The observer never retries a step, clears a reservation or prints raw errors. Idle polling is explicitly described as making no provider calls.

The user can inspect completed work without a provider key: run npm run dev, open the printed laptop address, enter the newly generated owner access token, and open Approval inbox. This ordinary launcher explicitly disables the session-only provider gate, does not queue a pilot or start a worker. Review the saved variants and critique; no Retry or new paid run is needed. User approval remains separate from publishing, which is unsupported.

Regression tests cover the completed six-call shape, unresolved reservations, running work, unavailable state and exactly one read-only state request with no step replay. All inspection and test operations remain separate from the original live database. The agent did not restart a live server or invoke a provider.
