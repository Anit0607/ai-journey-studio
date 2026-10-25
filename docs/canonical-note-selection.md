# Canonical note selection, version 1

Maintained GitHub progress-note drafts retain the existing six paid model stages,
provider/model, source policy, privacy checks, output cap and approval boundaries.
This is a prospective format change, not an alteration or certification of saved
historical artifacts.

- Harvester acknowledges the complete server-issued source index using a compact,
  source-hash-bound ID receipt. It does not rewrite or independently verify facts.
- Story Miner selects two to six IDs for one useful episode, or explicitly returns
  `needs_source` and an empty selection.
- Strategist orders a subset of that selection and chooses bounded opening and
  reader-action labels. It cannot add factual prose to the authoritative packet.
- Writer and Adapter receive full canonical SOURCE plus exact server-sliced facts.
  Advice remains proposed, attribution and limits stay source-bound, and the owner
  writing profile remains style guidance, not evidence.
- Critic receives current source/claim ID enums and exact source/index hashes in
  its strict response schema. The existing independent contiguous-citation,
  semantic, privacy and human-review rules still apply. Valid JSON is not truth.

The immutable `canonical_note_harvest`, `canonical_note_selection` and
`canonical_note_plan` shapes constitute `canonical-note-v1`. Fact IDs are valid
only for that exact source hash and index. Unknown/duplicate IDs, extra fields,
non-scalar values, duplicate JSON keys, ambiguous source atoms and oversized
responses fail closed. The response bound includes all UTF-8 JSON bytes.

Every predecessor's saved hash and source binding are rechecked before a new
reservation. If a completed model selector is invalid, its raw artifact and known
usage settle atomically, then the task is blocked with `note_contract`; it cannot
be retried or automatically advanced. Cancellation and scoped-source revocation
retain precedence. Old invalid predecessors are blocked before a new paid call.
The parent revision is not replaced by an incomplete child.

The dashboard distinguishes model-selected IDs from server-rendered source
excerpts. No new metadata exemption, factual waiver, automatic quality pass or
publication approval is introduced. Historical outputs and evidence decisions
are retained under the unchanged v3 evidence policy.

The accompanying maintained-note purpose addition is repository-declared intent,
not demonstrated autonomous capability. Its corroboration is README.md lines
3, 7 and 60 at commit a243a67eb1259b3f881e4e55d9329cf523fe093a
(blob 2eb977c692b6c6f094a15e77152d827753816201). It is imported as a new source
through the existing policy flow, never substituted into an old task or grant.
