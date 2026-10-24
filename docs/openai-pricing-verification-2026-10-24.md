# OpenAI pricing verification: 24 October 2026

## Dated maintenance

The official [GPT-4.1 mini model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini) was rechecked on 2026-10-24 UTC. It still lists snapshot `gpt-4.1-mini-2025-04-14` and standard rates of US$0.40 input, US$1.60 output, and US$0.10 cached input per million tokens. Studio's existing conservative cached-input accounting and model selection are unchanged.

Production runtime metadata was saved and fully read back at 05:17:16 UTC. Only these two values changed:

- `pricing_verified_date`: `2026-10-24`
- `openai.pricing_version`: `official-reviewed-2026-10-24-standard`

All other runtime fields, including authorization, rates, fallback, pricing-window controls, and budget gates, were preserved. The separate integrations configuration still exactly matched the prior OFF state: GitHub intake, other source sync, publishing, scheduler, and media remained disabled. The existing GitHub App mapping and LinkedIn OAuth configuration were not changed.

The existing same-day pricing gate expires this verification at **2026-10-25 00:00:00 UTC**. No seven-day waiver or automatic renewal is enabled. The existing US$15 monthly cap and its warning/reservation safeguards remain unchanged; this maintenance does not grant permission for a paid call.

## Release verification boundaries

This is a documentation-only checkpoint on production base `141da46839b9f6bfc94579d4b254bcab06f7402d`, used to load the separately verified metadata through the normal Git deployment route. The prior dated verification record is retained. No application code, dependencies, schema, credentials, or feature activation changed, and no application test suite or live provider call was run for this Markdown-only change.

After the deployment succeeds, verify the exact deployed commit and live pricing readiness separately. Successful build/deployment status alone does not prove application-level runtime readiness or provider health. Any bounded draft test has its own source, spending, and owner-approval requirements; no scheduling or publication is authorized by this record.
