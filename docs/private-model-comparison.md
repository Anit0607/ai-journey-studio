# Private stronger-model comparison — release handoff

This candidate adds one isolated comparison of the cleared Studio database-sleep note. It does not establish that the resulting prose will be factual or useful. No paid test has been run by implementation or offline verification.

Base: `d214eb1cac3042e5f1533a74c42ae9db1aed9dd5` (PR46). The exact source text was reconstructed from that commit's maintained note using the existing importer selection rules; its SHA-256 matches `b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603`. This is a repository reconstruction, not verification of the current production database state.

## Reviewed plan

Every role uses OpenAI `gpt-6.1-sol`, standard/default tier, low reasoning and a 4,096 completion-token cap **including reasoning**. There are no tools, fallback, retries, continuation or model availability probes. `store:false` is explicit. Production provider configuration is never replaced.

| Role | Maximum input tokens* | Completion tokens | Maximum USD |
| --- | ---: | ---: | ---: |
| Harvester | 18,000 | 4,096 | 0.085960 |
| Story Miner | 18,000 | 4,096 | 0.085960 |
| Strategist | 24,000 | 4,096 | 0.100960 |
| Writer | 22,000 | 4,096 | 0.095960 |
| Platform Adapter | 30,000 | 4,096 | 0.115960 |
| Critic | 60,000 | 4,096 | 0.190960 |
| Total | 172,000 | 24,576 | **0.675760** |

*Each complete prompt's UTF-8 bytes, serialized response-format/schema bytes and 1,024 framing allowance are conservatively counted as input tokens. Input is never truncated. Oversize source/context stops the attempt. The full US$0.85 approved maximum is reserved first, within the existing US$15 monthly limit and its US$1 internal buffer. Every input token is costed at US$2.50/M (the cache-write upper rate), and every completion token at US$10/M. Reported usage therefore produces a conservative estimate, not an invoice. Cached inputs are not assumed to save money.

Offline replay of this exact source with existing fixture prose measured input bounds of 16,045 / 16,154 / 20,431 / 17,513 / 19,908 / 36,884. New model outputs can differ; each actual prompt is checked again before sending. These measurements are not a live quality result.

GPT-5.4 was verified at US$2.50/M input and US$15/M output. The selected Sol model is described by OpenAI as near-Astra capability, with lower standard token prices. An Astra Writer at the selected 22k input and 4,096 completion bounds would raise this plan to US$1.059600, exceeding consent. Even with 2,048 Writer completion tokens, it would be US$0.957200. No Astra or alternate-provider permission is inferred. Official documentation currently supplies `gpt-6.1-sol` as its model ID, not a dated immutable snapshot; the route requires that exact returned model and stops on a mismatch.

Official sources checked 25 October 2026:

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)
- [Prompt caching and cache-write charges](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Reasoning and completion-token accounting](https://developers.openai.com/api/docs/guides/reasoning)

## Isolation and accounting

The protected `/api/private-comparison` route accepts only an authenticated owner session, exact Origin, exact reviewed scope hash and fresh state hash. A machine bearer is insufficient. POST is additionally closed unless the release operator sets `STUDIO_PRIVATE_COMPARISON_SCOPE` to the exported `COMPARISON_SCOPE_HASH`. That setting enables only this endpoint, not daily execution, Calendar, source grants, content approval or publication. The dashboard offers an explicit one-shot comparison control only when the existing release/runtime gates report ready, and a separate review-preparation control. Saved results remain read-only; there are no publication controls in this panel.

An append-only start event captures the model-bound comparison consent, source/task/calendar bindings, production config hash, style profile, original six artifact hashes and deadline. Existing task grants remain bound to their original model: the comparison has its own narrowly targeted receipt; no existing grant is rewritten. Before each provider call and after each returned response, current source authorization, task, original artifacts, Calendar reference and runtime are rechecked. Source policy revocation or stale state stops the chain. The current source resolver and grant checks are reused.

One ledger reservation is attached to the referenced failed task to reuse the existing globally locked monthly budget. It is deliberately unattributed to a production stage (`role`/`checkpoint` remain null); six comparison stages are identified in their separate audit events. Existing task/output rows, checkpoints, grants, Calendar entries, approvals and publication jobs are never written. The ledger model and pricing belong to the comparison, not the original production calls.

Raw responses and exact visible outputs/hashes are saved before accounting, canonical-selection or editorial validation. Existing six-stage prompts, owner style profile, canonical schemas, factual evidence checks and Critic failures are preserved unchanged. Returned model/tier or usage anomalies retain the full reservation and set a pricing anomaly where applicable. HTTP/network failures are treated as uncertain. A 35-second timeout per call and 240-second run deadline stop work; late responses cannot settle or advance a timed-out run. Reading status does not reconcile, retry or resume anything. A recorded start makes the attempt terminal even when it stops before all six calls.

`completed_requires_review` means six outputs were saved, never factual or editorial success. Findings remain in the saved assessment. A separate owner-only review adoption route can copy the exact six saved outputs into one fresh, unapproved revision after validating the terminal run, source/runtime binding and current review token. It cannot grant approval or enqueue publication. No assistant-authored replacement is substituted or described as autonomous success.

## Parent's later release/run sequence

1. Review the draft PR and offline checks. This implementation does not merge or deploy. The review branch `comparison/private-stronger-model-20261025` is explicitly excluded from automatic Git deployments using [Vercel's documented branch setting](https://vercel.com/docs/project-configuration/git-configuration); other branches retain their existing behavior.
2. Coordinate the separately authorized release. No database migration is required: this uses existing events and ledger columns. Keep the comparison release gate unset while validating the release.
3. Through the existing authenticated owner session, open the dashboard private-comparison panel. Its read-only preview uses `/api/private-comparison` and `/api/studio/state`. Verify the exact current task/source/Calendar reference and preview; compare ledger state against the reported baseline of 62 settled calls / US$0.102737. That baseline is supplied context, not independently verified by this candidate.
4. Confirm current pricing and model access without a paid probe. The comparison pricing scope expires 31 October 2026; existing production pricing/credential/source gates must also remain valid. If access or bounds fail, stop: no alternative-model or retry grant exists.
5. When parent is ready for the one authorized run, enable the exact scope, refresh the panel, check the explicit source/model/$0.85 single-attempt acknowledgement and click **Run private comparison once**. The control submits only `{expected_state_hash, scope_hash, acknowledged:true}` from a freshly rechecked preview. After any response loss, read durable history and ledger. Do not POST again to recover an uncertain result.
6. Disable the comparison gate after the attempt. Evaluate the generated copy unchanged. Require a natural hook, plain project explanation, understandable database-sleep/resource consequence, supported fix, qualified observations and practical reader value. Reject invented savings, uninterrupted-sleep claims or treating absent SQL traces as proof of zero queries. Preserve all Critic findings and raw responses. Anit reviews the final candidate; publication remains separate.

Current live task state, original six artifact values, provider account access, current production ledger totals and eventual prose quality are release/run checks; offline fixtures cannot certify them.

## Reproducible local verification

Windows Git autocrlf initially changed the existing hash-pinned fixture from 501 to 502 bytes and introduced CRLF differences in migration-file comparisons. These unchanged files were restored to exact HEAD blob bytes, without changing source text, accepted hashes or SQL. `.gitattributes` preserves exact-byte fixtures and LF migration files on subsequent checkouts. The originally failing full run and corrected-suite results must be reported separately; they are not a single clean pass. Final-state verification uses the same complete `tests/*.test.ts` suite with Node's supported `--test-concurrency=4` resource bound; no tests are weakened or excluded.

## Review-only adoption (no model calls)

After the run is `completed_requires_review` with a settled exact-model ledger, an authenticated owner session may POST `/api/private-comparison/adopt` from the exact Studio Origin with only:

```json
{
  "run_id": "<saved comparison run UUID>",
  "task_id": "96737ed0-a683-4a3d-9b2e-89aea38a214e",
  "scope_hash": "ed2bf1903a48644cccff06e8c4ae24cd1716c30a969229cdf5a16723be27a0ce",
  "expected_review_token": "<fresh token from this task's review>"
}
```

The server, not the caller, selects all six texts from the saved run. It verifies raw response text/hash/model/tier/stop reason and usage against stage receipts and the aggregate settled ledger, exact original source/task/Calendar/runtime state, a current review token, and absence of pending agent revision or publication history. It appends one `content_revisions` row and one `private_comparison_adopted` event in the same transaction. The existing readiness check is returned unchanged, including all factual and editorial holds. This action adds no owner evidence decisions, approvals, outbox entries, provider calls, model grants or production configuration changes. It does not require reopening the paid-comparison execution gate.

`adopted_requires_review` is not an approval or factual pass. `already_adopted` refers to the saved revision from the exact same request; it never replaces a newer edit. Following a response loss, inspect revision/history before any retry. The dashboard contribution label verifies the immutable adoption receipt against the original saved run and exact revision bytes before saying “Private model comparison output — gpt-6.1-sol”; a revision note alone never establishes that provenance. The saved comparison results remain read-only, raw history remains untouched, and the normal exact-final-post approval workflow is still required. The dashboard exposes **Prepare for final post review** only after a complete settled comparison, matching raw output hashes, and current task review token have been read. A separate unchecked acknowledgement and fresh preflight check are required. Neither action runs on mount or refresh. A browser-session attempt record plus an immediate in-flight lock prevents duplicate clicks and replay after response loss; refresh only reads durable status. No cookies are read or extracted, and no browser-console API invocation is needed.
