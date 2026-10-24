# Approved recurring GitHub intake and bounded pricing window

Release checkpoint: 24 October 2026.

This documentation-only release loads the owner's approved production configuration using the normal Git integration. Application code, migrations, dependencies, credentials and permissions are unchanged from PR33.

## Narrow source scope

- The existing GitHub App installation and repository allowlist remain unchanged: Anit0607/ai-journey-studio only.
- GitHub intake is enabled and authorized for commit summaries dated 2026-10-24T00:00:00Z onward.
- Intake uses `commits_and_notes` with notes explicitly disabled. No file paths, immutable note pin or note profile are configured. This does not enable code, diffs, commit bodies, other repositories or private-chat intake.
- Imported records are staged uncleared. Model execution still requires the separate current owner source-policy receipt and persisted generation setting. Deployment itself does not activate those gates or approve any post.
- Existing QStash integration timing is preserved. No new schedule is created by this release.

## Pricing boundary

Official standard pricing was verified on 24 October 2026 for `gpt-4.1-mini-2025-04-14`: USD 0.40 per million input tokens and USD 1.60 per million output tokens. The configured model, rates and pricing-version label are unchanged. Source: https://developers.openai.com/api/docs/models/gpt-4.1-mini

The owner approved using this verification only until **2026-10-31T00:00:00Z**, which is **31 October at 05:30 Asia/Kolkata**. The existing gate represents the final permitted UTC day inclusively, so the configuration is:

- `pricing_verified_date`: `2026-10-24` (unchanged)
- `pricing_window_authorized`: `true`
- `pricing_valid_until`: `2026-10-30`

This is the existing maximum of seven UTC calendar days, not an open-ended waiver. Direct checks against the unchanged `configReady` implementation accept 30 October 23:59:59.999 UTC and reject 31 October 00:00:00 UTC. The gate also rejects a final permitted day of 31 October because that exceeds its existing bound. Drafting must pause at expiry unless prices are reverified.

## Preserved controls and verification limits

The USD 10 warning, USD 15 monthly cap, fallback OFF, all unrelated providers and media OFF, and publishing OFF are unchanged. Persisted generation remains OFF during deployment. Existing source clearances, tasks, drafts, approvals and receipts are preserved.

Both known nonsecret production JSON configurations were freshly read, changed only at the approved fields and independently read back with full-object equality. Their encrypted type and Production-only scope are unchanged. No key or token value was accessed.

This release adds only this checkpoint document. PR33's exact application tree passed 823 tests, type checking, lint and a Linux Next build; that prior evidence is not presented as a newly run suite for this document. Five new pure pricing-boundary assertions passed without network, database or model calls. Git integration checks and production deployment status must pass separately. Successful deployment is not evidence of automatic drafting, scheduled delivery or publication; live source-policy and intake verification remain separate.
