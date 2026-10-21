# Evidence review (local proposal)

Natural wording is allowed, but a wording decision is not an automatic truth check. Existing saved drafts can be reviewed without another model call. Every unresolved finding still blocks content approval. Content approval never grants publication permission.

## Owner flow

Open the task in Approval inbox. For each wording finding, compare the draft sentence with the exact cleared note; select one or more complete supporting source sentences, give a short reason, acknowledge the comparison, and record that individual decision. There is no bulk ignore. Hard findings require corrected content or a separately cleared source. Review the complete public copy and internal critique before separately approving the exact content version. Public Writer/Platform Adapter copy must not contain internal review notes.

The panel shows the exact source, artifact and bundle hashes, policy version, claim offsets, current owner reason and cited evidence. Withdrawing a decision blocks approval again. Edits and changed/revoked source clearance invalidate old decisions and evidence-bound approvals. Historical decisions, original outputs and content approvals remain stored. Previously approved original content with renewed clearance can use Request changes and fresh revision approval.

## Storage and gates

Migration 019 adds append-only evidence_decisions and evidence_approval_receipts; triggers reject update/delete. Records include source/artifact/bundle hashes, exact claim offsets/text, source offsets/quotation, actor owner, reason, time and policy. The authenticated same-origin owner API accepts one current finding only. Task/source row locks serialize decisions with edits, content approval and publication/media checks. Source revocation locks the source row. No lock is held across a provider request.

Approval, publication preparation/delivery validation and media preparation use shared readiness checks. Evidence decisions do not queue work, change the daily guard, release reservations, generate content or publish. Existing provider caps remain 1200 output tokens and six logical calls; the extra prompt bytes enter the existing upper-bound reservation. No new subscriptions, dependencies, credentials, permissions or schedules.

## Critic compatibility and limits

The existing sixth Critic prompt requests bounded JSON (at most eight links) tied to source/artifact hashes and exact spans. Valid links are advisory; they never record an owner decision. Invalid JSON links/schema/source binding block approval. Legacy plain-text critiques remain supported for old drafts and still require the existing sections and owner review. Missing suggested links are handled by individual manual review; there is no seventh call or automatic semantic certification. The schema is not provider-enforced, so an unstructured response follows the legacy manual-review path rather than being certified.

Automated classification uses conservative lexical rules, not a semantic entailment model. It detects tested figures/entities, negation/timing/certainty changes and selected unsupported outcome/biography patterns, but cannot guarantee detection of all meanings, all entities or arbitrary languages. Sentence segmentation is deliberately bounded/simple and may need correction for complex punctuation. Owner judgement and separate factual/publication review remain essential. A faithful wording can still need correction if conservative hard checks cannot distinguish it safely; there is no hard-finding override.

## Rollout

This checkout is local only, based on 2cb750914f058939cab32b218e93615ef4e31dcc. Migration 019 is prepared, not applied to production. Do not deploy the new code against an unmigrated database. No existing saved draft is rewritten by this proposal. Any production migration/deployment needs separate authorization.
