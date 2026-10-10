# User-operated session credential entry

No credentials have been configured. Do not perform these steps until the parent records action-time authorization for the source capsule, provider transmission and credential use.

After that authorization, configure nonsecret runtime-config.json locally with source_approved, transmission_authorized, credential_use_authorized and security_tests_passed true, the current UTC pricing_verified_date, and reviewed provider model/pricing fields. Do not add keys to that file.

In your own interactive PowerShell terminal, from this repository:

    python studio.py worker --prompt-keys

The worker asks for the OpenAI API key through a hidden prompt. Type or paste it there, never into chat, dashboard, command arguments or a source file. The prompt refuses noninteractive/redirected input and refuses fallback to visible echo. If separately authorized, a second hidden prompt accepts a Gemini key, or Enter skips fallback. Keys remain in this worker process's memory; they are not written to disk, browser, subprocess environment, Git or logs. Stop the worker with Ctrl+C to end that session; restart requires entry again. Python cannot guarantee forensic zeroization of memory, but no persistent credential facility is installed.

The dashboard server uses a different temporary local access token printed by python studio.py serve. This token is not a provider key. Worker heartbeat conveys readiness without exposing secrets. Do not record/screenshare the key-entry terminal.

Before activation rerun tests and recheck official rates on the run day. Account-specific model access and billing remain unverified without an authorized authenticated provider check. No paid request has occurred.

Proposed public documentation choices, verified 10 October 2026:

| Provider | Model | Standard input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- |
| OpenAI primary | gpt-4.1-mini | $0.40 | $1.60 |
| Gemini fallback | gemini-3.5-flash-lite | $0.30 | $2.50 |

Sources: https://developers.openai.com/api/docs/models/gpt-4.1-mini and https://ai.google.dev/gemini-api/docs/pricing . Gemini 2.5 Flash-Lite is restricted to previous active users according to https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite ; it is unsuitable as the default for this new project.

Use decimal-string microdollars per token: OpenAI input "0.40", output "1.60"; Gemini input "0.30", output "2.50". Store a pricing version and official URL with every reservation. Integer totals round upward, preserving conservative budget accounting without rounding each token to a whole microdollar.

Six calls bounded to 16,256 input tokens (input bytes plus protocol allowance) and 1,200 output tokens each reserve at most $0.0505344 for OpenAI, rounded up per call. This is a conservative ceiling, not expected or actual spend. An eligible one-call Gemini fallback reserves at most $0.0078768 in addition; uncertain primary reservations stay counted. Actual billable usage is settled from reported tokens; Gemini thinking tokens are included. Combined monthly cap remains $15 with $1 retained inside it and warning at $10. No caching/grounding/tool discounts or charges are assumed; tools are not enabled.
