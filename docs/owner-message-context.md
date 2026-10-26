# Task-bound owner-message context

The owner supplied a first-person project statement in message `Sentinel_b7c9856c988081919723843b0011c143`, and delegated routine draft preparation in `Sentinel_6759df00f0c8819198d3f79def3af5f2`. This feature records an assistant import of that exact owner self-report. It is neither independent verification nor a claim that the owner personally reviewed a source in this app.

The reviewed scope binds the message excerpt, authorization reference, project, task ID, original source ID and original source hash. The original technical source is never edited or concatenated with the owner statement. A different task, source, project or message requires a separately reviewed scope and explicit attachment; there is no automatic inheritance or general personal-fact permission.

## Ordinary UI

In the task's Evidence review, inspect **Owner-message context**, its exact quotation and references. Check the initially unchecked assistant-import acknowledgement and click **Attach owner-message context**. Refresh and inspect the active receipt before editing. Attachment does not accept a factual finding.

Write the complete supplied context sentence verbatim (straight and curly apostrophes and whitespace are equivalent). Partial quotes, paraphrases, changed negation, extra outcomes or compound unsupported clauses are not granted support. The complete sentence becomes an explicit wording comparison using a separately labeled owner-message source. Select its complete statement in **Assistant source comparison**, give a truthful reason and record that comparison. Ordinary technical claims still use the original source. The original owner-review route cannot accept this new context finding, but an owner can withdraw an assistant comparison; owner withdrawals retain precedence.

Finish all artifact edits, update the Critic's exact source/artifact citation bindings, then record fresh assistant comparisons. Each content revision invalidates prior assistant comparison tokens. The exact final-post approval remains a separate owner action.

**Revoke owner-message context** appends a withdrawal receipt. Reattachment appends another receipt; it never restores an old context version, old comparison or old final approval. A lost/failed UI response is not retried automatically; inspect refreshed status before any new deliberate action.

## Storage and freshness

No schema migration is required. Existing schema 23 allows `actor=assistant` and does not constrain `policy_version`. Receipts use a distinct `owner-message-context-v1` policy in the already immutable `evidence_decisions` table. Existing owner and assistant wording policies do not interpret context rows as factual acceptance. Existing immutability triggers prevent updates and deletion.

Receipts form a checked append-only chain with exact scope/evidence, server-selected importer/origin, UUID identity, monotonically ordered sequence, prior receipt digest and exact review-token hash. Every read revalidates the chain. Its current digest enters the quality binding even after revocation, so adding, revoking or reattaching context changes final-plan freshness. Context comparisons additionally bind the current receipt and statement hashes. Corrupt or mismatched context fails closed.

No model call, provider transmission grant, queue, outbox, content approval, source grant or publication change is performed. This bounded feature supports manual draft preparation only; it does not inject user messages into prompts or modify any consumed comparison scope. Persistent writing-style conditioning is separate and cannot act as factual context. Existing source clearance, privacy, technical/numeric checks, Critic validity, editorial holds, source revocation and final-post approval remain enforced.

Rollback should disable the new UI/actions while retaining the context-aware readers and binding validation, together with all immutable records. Do not roll back the readers to a pre-context version: although an old reader rejects the unsupported personal statement, a technical-only bundle with a historical pre-context approval could reconstruct its old binding and revive that approval. Retaining current read/freshness validation avoids this resurrection for every affected bundle. A full reader rollback requires a separately reviewed, fail-closed deployment plan; it is not authorized or automated here. Never relabel context as an owner review or rewrite historical sources/model artifacts.

### Explicit runtime boundary

The active receipt is consumed by `Store.snapshot`, `reviewReadiness`, assistant wording comparison, and therefore existing final-plan/content/publication/media validation. It is **not** consumed by `buildDraftPrompt`, `workflow.step`, private comparison, intake or automatic generation. This release does not claim recurring personal-context automation. Writing-style v2 may condition future eligible prompts independently, but style is never a factual license.

A later provider-context path would need explicit provider/purpose scope, task/source/project binding, the receipt digest in prepared-prompt/admission metadata, a locked freshness check immediately before the provider call, bounds tests, and no inheritance to unrelated/new tasks or spent comparison scopes. That path is intentionally not added by this no-paid manual-review feature.
