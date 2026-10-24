# Pinned, file-only GitHub intake

This is a dormant capability. The change does not enable a connection, import a source, record owner clearance, call a model, create a task or authorize publishing.

## Backward-compatible mode

Without `sources.github.intake_mode`, existing commit-summary intake and optional structured build notes behave as before. The explicit `commits_and_notes` value has the same behavior. The structured parser is unchanged.

`intake_mode: "notes_only"` requires `notes.enabled: true`, a nonempty finite exact `notes.paths` list, and `notes.commit_sha` containing a full immutable 40- or 64-character hexadecimal commit identity. Unknown modes, malformed or absent pins, disabled notes, invalid paths, and profile fields outside notes-only mode fail before credentials or network use. Existing connection/sync/private-read authorization and the selected repository/App installation boundaries still apply.

The notes-only path never calls the list-commits or patch-bearing REST commit endpoints and never stages commit summaries. It reads repository metadata, exact Git commit metadata for timestamp/root tree, three nonrecursive path-tree metadata responses, and exact allowlisted Contents records with `ref=<pinned commit>`. It follows no download URLs, discovers no new files, and leaves the existing commit-pagination cursor unchanged. A pin may identify an immutable reviewed branch commit even if production is deployed from a later merge commit; it never follows the moving branch.

## One exact hash-pinned text profile

The optional `notes.profile` object must contain exactly:

- `kind`: `hash_pinned_text`
- `path`: `docs/build-notes/2026-10-24-linkedin-progress.md`
- `sha256`: `d6819a05d82864b052fca17b19ad0a02b2aed0d7ef6ed73aaccd1ebce7b15a63`

For this deliberately narrow profile, `notes.paths` must contain that one path only. Other paths, hashes, profile names or extra profile fields are rejected. The supplied raw file must be the exact 501 UTF-8 bytes, including its final LF. No BOM stripping, normalization, heading insertion, truncation, alternate text or fallback parser is permitted. The existing 8 KiB/file, request/response/time budgets, UTF-8, instruction/privacy, regular-file, tree/blob hash, selected-repository and access-denied checks remain in force.

The stored source includes the existing truthful GitHub attribution envelope followed by the byte-preserved paragraph. Provenance records the immutable repo/commit/tree/blob/path, raw hash and byte count, selected-content hash, resulting source hash, `content_kind: hash_pinned_text`, and `content_profile: hash-pinned-text-v1`. A matching hash is not proof of authorship, factual truth, owner review or transmission permission.

The source is staged uncleared. Its distinct profile is explicitly ineligible for policy-derived automatic selection; old structured-note consent cannot grant it clearance. Normal exact owner clearance must bind the full stored envelope hash, not merely the raw-file hash. Repeated imports deduplicate and never overwrite clearance or resurrect a revoked source. Subsequent draft execution retains all existing exact-task, spending and owner-approval gates. Manual clearance is independent of whether intake remains enabled: turning intake OFF does not revoke that exact approval. The unchanged manual-clearance contract binds source/envelope bytes and clearance hashes, not later mutable connector-provenance rows; this patch adds no per-checkpoint provenance-row revalidation. Intake and automatic-policy derivation still reject profile/raw-hash/provenance mismatches.

## Invocation and boundaries

Use the existing owner-authenticated, same-origin `POST /api/studio/integration-sync` with `{"provider":"github"}` after an explicitly authorized server configuration has been installed. The existing UI button sends `provider: "all"`, which can also sync any other ready provider; file-only operation must not silently enable or import from another provider. No new scheduler or standing consent is created by this capability.

No production configuration is supplied or activated by this document. Keep the normal OFF state until the exact operation is authorized, verify the staged source/provenance, and restore the approved OFF configuration after the bounded intake. Intake itself makes no OpenAI call.
