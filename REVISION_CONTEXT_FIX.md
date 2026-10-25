# Role-scoped revision context

The captured PR38 revision used the correct source and current citation-index
hash, but copied every assessment and reason from the historical Critic. One
selected passage failed the existing whole-passage entity check. Other copied
pairings were semantically inappropriate even though their lexical checks passed.
The same target public copy appeared in all five non-Critic outputs.

Revision generation now validates the complete historical parent as before, then
projects only the context needed for the requested role:

- Harvester, Story Miner and Strategist receive the exact source/base binding,
  not historical drafts or raw public-copy feedback. They regenerate source,
  evidence-selection and brief artifacts from the cleared source/current outputs.
- Writer and Platform Adapter receive owner feedback plus historical public
  artifacts for editing. Those artifacts never become factual evidence.
- Critic receives no historical artifact or owner target. It critiques the current
  child outputs with the current source and server-issued citation index, without
  inheriting a prior Critic's prose, verdicts or IDs.

The v3 evidence checker, citation rules, evidence/approval bindings, source grants,
privacy checks, six-stage execution, accounting, budget limits and publication
approval remain unchanged. No stored history or review decision is rewritten.
Raw feedback now guides public-copy editing only, not internal extraction or a
Critic verdict; unsupported requests remain excluded from all factual claims.

Reproduction tests preserve the captured outputs and show they still fail closed.
Mocked workflow tests prove context isolation and accounting, not that a future
model will follow its instructions or produce semantically correct citations.
No paid rerun is part of this change, and a manually checked post does not need
another model run merely to benefit from this engineering correction.
