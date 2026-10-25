# Delegated assistant wording comparison

This workflow records an assistant's explicit, per-finding source comparison. It is **not owner testimony**, independent factual verification, final-post approval or publication authority. No model is called by the workflow.

The existing owner evidence route and its `evidence-review-v3-lossless-spans` receipts remain unchanged. The separate owner-session/same-origin `/api/studio/assistant-evidence-review` action selects `actor=assistant` and `policy_version=assistant-wording-comparison-v1` on the server. Caller-supplied actor or policy fields are rejected. Migration 023 expands only the actor check, keeps the immutable audit triggers and all historical rows, and is production-gated through the existing bounded release process. See the migration handoff for verification and non-destructive rollback.

## Normal UI workflow

For a current `wording_review` finding, expand its **Assistant source comparison** section. Select the first and last complete source sentences from the displayed original source, write a specific comparison reason, and check the separate assistant acknowledgement. Click **Record assistant source comparison**. No sentence or acknowledgement is preselected. The server verifies the exact original UTF-16 span and quotation; the quotation cannot be rewritten in the form. The usual page action reads fresh state after the request. A duplicate click or lost response never triggers automatic replay.

Existing owner controls remain available separately. An owner decision always has precedence over assistant decisions on the same binding/finding, including an owner withdrawal. An assistant can withdraw only its own current comparison; an owner can withdraw an assistant comparison using the existing owner route.

## Binding and limits

An assistant receipt contains the exact review token and its hash, source/artifact/bundle hashes, complete original claim/span, source quotation/span hashes, reason, policy and actor. Each read revalidates the actor-policy pair, current source clearance, artifact integrity, review token, exact quotation and existing evidence rules. Even a new revision with identical text requires its own assistant comparison. Current accepted receipt IDs determine `evidence_version`; withdrawal/recomparison cannot inherit an older final approval.

Only individual wording findings can be resolved. Hard and structural findings remain unresolved; invalid Critic evidence, editorial holds and privacy failures block assistant acceptance. The workflow never writes content approval rows, evidence approval receipts, publication jobs, source grants or model permissions. The exact final-post approval remains an explicit owner action.

An adoption caller assessing a not-yet-inserted revision must pass that prospective revision token to `reviewReadiness` rather than treating the current token as the proposed revision's identity.
