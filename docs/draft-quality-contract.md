# Grounded draft and Critic citation contract

This incremental change follows PR20 (`dd3d09450a19a74f03f1333dac13e28c5068bc75`, frozen code tree `c9f2b70ceb6aba3821f7f58f78d0f7d36a2eed28`). It changes no source permissions, provider approvals, budgets, stored drafts, evidence decisions, publication gates or scheduler settings.

## Observed failure

The 23 October milestone run completed six paid checkpoints and settled all usage. Its immutable 421-character source and six original outputs are retained as a regression fixture, without account IDs or credentials. Local reproduction matched 22 findings: 8 wording reviews and 14 hard findings. Four hard findings were numbered-list markers, seven were ordinary initial words, two caught real overclaim wording, and one rejected malformed Critic links. Studio performing a deletion was not established by the note. The third-person product-evaluation voice and optional video plan were also unsuitable for the requested personal milestone.

All three original Critic links remain invalid. Their artifact ranges and source ranges were not valid sentence boundaries; their purported source quotes were generated draft prose. This patch does not repair, replace, approve or resubmit those saved artifacts.

## Narrow changes

- A role-specific source/narration contract preserves first-person owner narration where present, exact action attribution and single-test scope. Attributed external GitHub/YouTube evidence remains third person, never the owner's lived experience. Internal extraction favors exact source sentences; public copy need not manufacture advice or a question.
- New Critic outputs use schema 2: a current source hash, a server-computed index hash, and server-issued claim/source sentence IDs. The model does not supply offsets or quotations. IDs distinguish duplicate sentences; the server resolves exact UTF-16 ranges and exact source bytes. The table is bounded below 12 KiB and omissions are explicit.
- Wording suggestions still pass the existing exact-source validator and remain advisory. Only the owner's individual evidence decision can resolve a wording finding, and content/publication approval remain separate.
- An unsupported verdict requires an exact current claim ID, an empty source-ID list, and a short critique reason. It creates a hard blocker; its reason is not source evidence. Contradictory summaries, unknown/duplicate/stale IDs, fabricated offsets/quotes, wrong source/index hashes and oversized tables fail closed.
- Existing schema-1 links remain strictly validated. Historical artifact bytes, hashes and stored review rows are not rewritten. Plain historical critique support is unchanged.
- Only a numbered Markdown prefix followed by content on the same line is excluded as formatting. Following text, metrics and standalone numbers remain checked. Only the observed sentence-initial connectives Following/Subsequently/Upon/If/Is avoid being mistaken for names; arbitrary names remain blocked. Public publishing/deletion/support assertions receive factual checking, and observed removal cannot become a Studio deletion capability.

Re-evaluating the immutable fixture now yields 18 unresolved findings: 14 individual wording reviews, three real public/internal action/certainty blockers and the original invalid Critic. This is deliberately not a clean bill of health or approval.

## Validation and boundaries

Pure regressions use the exact observed output plus adversarial IDs, duplicated sentences, stale hashes, injected metadata, numbers, named entities and actor changes. Six-checkpoint workflow tests use mocked provider responses only, verify six settled reservations and no additional call after malformed Critic output, and leave content unapproved with no publication job. Existing evidence/grounding/legacy tests remain required.

This change has not been tested with another paid model run. Better prompts and reliable citation formatting do not prove semantic correctness; every post still needs the owner's review. The prior one-workflow permission does not authorize a retry. Any future live evaluation requires its own applicable approval.
