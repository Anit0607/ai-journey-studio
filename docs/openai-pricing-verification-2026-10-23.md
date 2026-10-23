# OpenAI pricing verification: 23 October 2026

## Official-source check

Verification date: 2026-10-23 UTC. Official pages were rechecked at approximately 02:39 UTC.

- Model reviewed: GPT-4.1 mini, snapshot `gpt-4.1-mini-2025-04-14`.
- Standard/default-tier text input: US$0.40 per 1,000,000 tokens.
- Text output: US$1.60 per 1,000,000 tokens.
- Cached text input: US$0.10 per 1,000,000 tokens.

Source: [OpenAI GPT-4.1 mini model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

These are the reviewed standard rates, not Batch, Flex, Fast/Priority, tool, fine-tuning, or hosting prices. The configured model and rates are not changed by this maintenance.

OpenAI's [deprecation schedule](https://developers.openai.com/api/docs/deprecations#2026-10-14-gpt-4-series-model-deprecations) lists removal of `gpt-4.1-mini-2025-04-14` on **14 January 2027**. Plan and validate a replacement before that date; this record neither switches models nor authorizes a migration.

## Existing Studio accounting

At base commit `ba9cc857af1ff0a72741e919d70186cbd06524c5`:

- [lib/providers.ts](../lib/providers.ts) requests Chat Completions with `service_tier: "default"`, validates the returned model/tier, and records total `prompt_tokens` plus `completion_tokens`.
- [lib/domain.ts](../lib/domain.ts) applies the configured input and output rates to those totals. It does not subtract cached input or apply a cache discount. Studio therefore conservatively estimates cached input at the full input rate; the provider's actual invoice may be lower.
- The unchanged combined IST-month controls remain a US$10 warning, US$15 limit, and US$1 buffer inside that limit. Uncertain usage/reservations remain guarded. These internal controls do not guarantee the external invoice or include hosting/database charges.

## Dated runtime metadata and expiry

The separate production environment maintenance updated only:

- `pricing_verified_date`: `2026-10-23`
- `openai.pricing_version`: `official-reviewed-2026-10-23-standard`

The environment write completed at 02:38:41 UTC. Parsed-JSON readback at 02:38:48 UTC confirmed those two changes and preservation of all other fields. This documentation commit does not contain runtime configuration or credentials, and environment readback alone does not prove the running deployment has picked up the values.

The existing same-day gate in [lib/domain.ts](../lib/domain.ts) remains unchanged: this verification is valid only on **23 October 2026 UTC** and expires at **2026-10-24 00:00:00 UTC** unless a new check is performed. No seven-day pricing waiver or automatic renewal is authorized or enabled. See [HOSTED_HOBBY.md](../HOSTED_HOBBY.md#optional-pricing-validity-still-disabled).

Updating pricing readiness does not clear sources, grant provider access, activate a scheduler, enable posting, or authorize a paid call. Model, rates, budget, permissions, and activation flags are unchanged.

## Verification boundaries

This is a documentation-only repository change. The official sources and existing accounting/gate implementation were reviewed; no application tests were rerun for this Markdown-only change, and no live provider call was made.

Use the normal Git deployment route to load the separately reviewed production metadata. After deployment, verify the exact deployed commit and runtime readiness without triggering generation, cron, OAuth, posting, or any other provider operation. A successful build alone does not establish runtime metadata or provider health.
