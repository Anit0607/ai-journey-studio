# Assistant wording reviewer migration 023

Migration 023 changes only the `evidence_decisions.actor` CHECK domain from `owner` to `owner`/`assistant`, then records version 23. It does not reinterpret or rewrite historical owner decisions, add approvals, change source grants, modify publication jobs, or replace either immutable evidence trigger/function.

The production release hook uses the existing production-only authorization decision. It verifies schema 22, actor column/constraint and the exact immutable trigger/function contract before DDL. The change is transactional and idempotent, uses a dedicated advisory transaction lock, takes a brief exclusive lock on the two evidence tables, and is bounded by the existing 5-second lock, 15-second statement and 60-second total deadline. Failure stops the build; there is no automatic retry or credential-bearing error output. Catalog verification runs again before commit. A busy live database can therefore require a later explicitly initiated release after checking durable schema state.

## Rollback without rewriting history

Prefer disabling/rolling back the new application route and reader support while retaining the widened constraint. The previous application recognizes only `actor='owner'` with its existing policy, so it ignores assistant comparisons and keeps their affected findings unresolved. Existing assistant rows remain immutable historical evidence, not owner testimony; do not update, delete or relabel them. Any final-approval receipt dependent on assistant evidence will no longer match the older reader's evidence version.

If operations must prohibit new assistant rows at the database layer, an explicitly authorized operator can additionally add a separate CHECK **NOT VALID** inside a bounded transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.evidence_decisions
  ADD CONSTRAINT evidence_decisions_owner_only_rollback
  CHECK(actor='owner') NOT VALID;
COMMIT;
```

`NOT VALID` preserves historical assistant rows while enforcing owner-only on new inserts. Do not validate that constraint while assistant rows exist, and never narrow the original validated actor constraint by deleting records. The 023 release verifier deliberately rejects this additional actor constraint until an authorized operator removes the rollback guard before re-enabling the new application. No rollback SQL is automatically executed.
