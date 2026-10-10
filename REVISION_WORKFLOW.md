# Correct saved content without new API spending

The original six artifacts and historical user approval are never overwritten or deleted by this workflow. Request changes creates a separate revision bundle; each manual save appends another immutable bundle with a parent, sequence, hashes and note. Approval belongs to a revision ID and exact content/source hash, so it never carries to a later edit. Historical approvals remain visible.

The agent has not migrated or restarted the user's live app or altered the existing task. On the user's next ordinary npm run dev start, the additive migration creates only empty revision/approval tables. Existing artifacts, approvals, events and budget ledger remain intact. This ordinary viewer does not start a worker or queue model work.

1. Open Approval inbox and expand Source-grounding flags. User approval and factual quality are separate labels; an old approval does not establish truth or publish content.
2. Enter a revision note, then Request changes. The current bundle now requires fresh approval; the original approval stays in history.
3. Click Edit revision, choose an artifact, enter a reason and replace its text. Save new revision. Repeat for any flagged artifact, including upstream Story Miner/Strategist and the Critic.
4. Personal statements must be supported by the exact cleared capsule. The conservative checker accepts exact source quotations and the supported first-person sentences shown below. Label other suggestions Proposed approach; never describe them as experienced discoveries or proven results.
5. The Critic must contain Unsupported claims:, Evidence needed:, and Proposed advice: sections and honestly reflect remaining gaps. Review all six artifacts against the source, check the acknowledgement, then Approve this exact revision. Unresolved grounding flags block approval. Later edits again require new approval.

Supported first-person statements: I am a non-coder. I build and direct AI agents. I retain final approval. I use Codex and agents for implementation. I learn by doing. I want to share practical agent-building methods and honest lessons.

These lexical checks are conservative guardrails, not semantic proof. They may flag accurate paraphrases; use an exact source quotation or the supported sentence form. Richer anecdotes, lessons, achievements and results require additional real material to be specifically cleared and supported by a future source-import extension. This change does not broaden the current source allowlist.

Future model prompts include this grounding contract and deterministic prior-claim flags. Prior generated artifacts are explicitly not new evidence. Missing evidence should produce an Evidence needed request or clearly labeled proposed advice. No paid model call was used to build or test these changes.

Validation uses isolated test databases only. artifacts/revision-qa.png shows an isolated automated QA fixture, not user workspace content. No token is visible. The browser test verifies Request changes, manual save, fresh acknowledgement/approval, unchanged original artifacts and historical approval, wrong-token/origin rejection and zero provider ledger entries.
