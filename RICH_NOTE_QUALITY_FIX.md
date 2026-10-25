# Rich-note source fidelity

The captured 25 October 2026 richer-note run completed all six stages but remained
`needs_revision`. Completion is not content approval or permission to publish.

## Corrections

- Sentence spans retain decimal timestamps/amounts, URLs, paths and unpunctuated
  lines. Each span is an exact slice of the original JavaScript UTF-16 string;
  text and stored artifact hashes are not rewritten. Previously dropped text is
  now checked too, so this is not a promise of fewer total review findings.
- Attributed progress-note prompts no longer require a payoff, audience need,
  generalized takeaway or advice. Harvester is instructed to preserve the exact
  source; public stages prefer a short supported selection and retain historical
  subjects, actors, limitations and test scope. Unnecessary clocks are omitted;
  retained timestamps must preserve their exact precision.
- Critic distinguishes reporting a past unsupported claim from asserting that
  claim. OpenAI Critic requests use the existing schema-2 keys under a strict JSON
  response format. Nested verdict shapes require empty source IDs for unsupported
  claims and nonempty IDs for wording comparisons. Current source/index hashes,
  actual citation IDs, consecutive complete passages, privacy and meaning remain
  separately checked by the application. Formatting is not factual verification.

## Unchanged limits

The configured model, provider, tier, source scope, six-stage ceiling, 1,200 output
tokens, monthly budget and one-shot $0.13 cumulative reservation cap are unchanged.
The response-format wrapper adds 1,339 UTF-8 bytes to the existing conservative
input/reservation calculation and input-size limit. At the configured $0.40 per
million input tokens, this adds at most 536 microdollars to the reservation, not
an asserted invoice charge. Insufficient headroom blocks the request. There is
no schema-error retry, downgrade, model switch or seventh call.

Strict requests use the existing refusal, incomplete-output and uncertain-usage
accounting paths. No live model test was made as part of offline validation.
Compatibility was checked for `gpt-4.1-mini-2025-04-14` against the official
[model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
and [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

The existing number, timing, entity, negation and unsupported-claim checks are
not relaxed. A shortened timestamp can change a temporal boundary; it is not
globally accepted as equivalent. Faithful paraphrases still require the existing
individual evidence review. No software change accepts those judgments for the
owner or creates publication approval.

## Deliberate review invalidation

The evidence policy is now `evidence-review-v3-lossless-spans`. Lossless parsing
changes source/citation indices. Old decisions and approval receipts are retained
as history, not reinterpreted or migrated into current approval. A matching current
receipt is required even for old receiptless content approvals. Snapshot,
publication admission and media admission fail closed until a fresh review and
approval. Already attempted delivery history is never replayed by this change.

The actual captured malformed Critic remains invalid after this correction. Saved
outputs are not silently fixed, and wording findings are not automatically waived.
