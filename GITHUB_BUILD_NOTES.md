# Bounded GitHub build-note intake

This adapter stages attributed evidence only. It does not clear sources, authorize model use, enqueue drafts, publish, or activate a saved scope grant.

## Configuration

Notes are opt-in through `sources.github.notes = { enabled: true, paths: [...] }`. The GitHub adapter must also be enabled, `sync_authorized` and `private_read_authorized` must both be true, and the normalized repository allowlist must contain only `anit0607/ai-journey-studio`. Private repositories additionally require the existing authorized credential flow. Configuration alone does not confer any downstream transmission permission.

Each path must be an exact ASCII Markdown file directly under `docs/build-notes/`, ending in lowercase `.md`. Up to five configured paths are accepted. Nested directories, wildcards, hidden components, traversal, percent encoding, backslashes, URLs, query strings, and excluded privacy terms are rejected before network access.

## Accepted note format

```markdown
# Build progress

## Verified progress
- Implemented source-linked draft previews.
- Validated the owner review flow.

## Evidence
- https://github.com/anit0607/ai-journey-studio/commit/0123456789012345678901234567890123456789
```

The two section headings are case-sensitive and must appear exactly once in that order. Progress is line-oriented: up to 20 short factual statements beginning with a supported past-tense implementation or verification verb, optionally preceded by `I` or `We`, then optionally `have`. Bullet markers and numbered lists are accepted. This syntactic gate does not independently establish that a claim is true.

Evidence is one or more bare URLs or Markdown links to immutable 40- or 64-character commit SHAs in the same repository. Evidence links may refer to earlier commits, not necessarily the note's snapshot commit, and are never fetched. No mutable branch links, external URLs, query strings, fragments, code fences, inline code in progress, directive-like text, hidden Unicode formatting, HTML, or conservatively excluded private material are accepted. Privacy and directive checks apply to the entire raw note, including unselected sections. Only normalized progress and canonical evidence links survive selection.

## Read and storage boundary

- At most five exact Contents API file reads per sync, one per configured path at the first valid commit returned by the bounded commit scan. Requests use `https://api.github.com/repos/anit0607/ai-journey-studio/contents/{path}?ref={full-commit-sha}` with redirects disabled. No recursive tree, diff, raw download, attachment, or linked-page requests are made.
- Before any file read, exactly three bounded non-recursive Git Tree metadata reads verify the immutable commit's root, `docs`, and `build-notes` trees. Each intermediate selected entry must be `040000/tree`; each selected file must be `100644/blob`. Root tree identity comes from the commit-list entry, or one immutable `/git/commits/{sha}` metadata lookup when absent. Missing/ambiguous entries, other modes, unexpected SHAs, and truncated trees fail closed. No unrelated tree or file is followed. This closes the server-side Contents symlink ambiguity.
- The Contents response envelope is bounded to 16 KiB and the decoded UTF-8 file to 8,192 bytes. Declared file type/path, strict base64, decoded size, UTF-8, and Git blob SHA are validated. The Contents blob SHA must match the selected tree entry and the recomputed Git object hash. Explicit directory, symlink, target, and submodule responses are rejected.
- Total GitHub read attempts are capped at 12 per enabled-note sync: one repository check, up to two commit-list pages, at most one immutable Git commit lookup, three tree metadata reads, and up to five Contents reads. Tree responses are bounded to 256 KiB and Git commit resolution to 64 KiB. `github_read_counts` reports each category and the total, including attempted requests that fail.
- Stored note text uses category `project-note` and consists of an attribution/repository/snapshot/path prefix followed by canonical selected sections. The entire stored representation must also fit the note parser's 8 KiB bound. Commit text uses category `build-log` and includes attribution and only the first message line, never the commit body or diff.
- Provenance records include `content_kind`, `repository`, `commit_sha`, `content_digest = SHA256(source.text)`, `evidence_digest`, and `source_timestamp`. Notes additionally contain `note_path`, verified `blob_sha`, `root_tree_sha`, and `note_mode: "100644"`; commit summaries have `blob_sha: null`. Source URLs are immutable commit or blob URLs.
- `evidence_digest` hashes the canonical selected note sections, independent of snapshot attribution, to support downstream unchanged-note deduplication. For commit summaries it hashes the first-line summary; distinct commits must still be distinguished by repository and commit SHA.
- Missing or malformed notes produce structured fixed reason counts without storing raw skipped material. Access, rate-limit, cancellation, and network failures stop the current provider run rather than silently appearing as successful empty intake. Note configuration changes reset an in-progress commit sweep.

## Verification

`node --import tsx --test tests/github-note-intake.test.ts` uses a lightweight database double and mocked transport only. It covers authorization gating, path limits, deterministic selection, immutable evidence, privacy/injection exclusions, exact API requests, tree modes and identity, byte/blob integrity, all read budgets, first-line commit isolation, deduplication, and configuration resets. It does not make live GitHub or model calls and does not substitute for the existing database-backed source-ingestion suite.
