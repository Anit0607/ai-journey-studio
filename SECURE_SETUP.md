# User-operated session credential entry

The user has approved OpenAI only for the exact shorter note quoted below, within the $15 monthly cap. Gemini remains disabled. The user has entered their key through the session-only launcher themselves; no credential was inspected or persisted by the agent.

After all preflight checks pass, the agent prepares ignored runtime-config.json with the approved note hash, OpenAI-only consent, successful verification and current official pricing. The user does not edit security flags. The example remains inert. No keys belong in either configuration file.

Approved source: “Anit is a non-coder who builds and directs AI agents, retains final approval, uses Codex and agents for implementation, and learns by doing. He wants to share practical agent-building methods and honest lessons.”

For the primary web application, in your own interactive PowerShell terminal, from this repository:

    python scripts/secure_start.py

The launcher asks for the OpenAI API key through a hidden prompt. Type or paste it there, never into chat, dashboard, command arguments or a source file. It refuses redirected input and visible echo fallback, and checks for .env files without reading their contents. It inherits only OS/runtime necessities; inherited provider aliases, config overrides, proxies and Node injection options are excluded. Only freshly entered keys are passed to the child web-server environment. The exact reviewed configuration is snapshotted for that session; skipped fallback is explicitly disabled. Gemini is not prompted for this approved pilot.

No user/machine environment, file, browser or credential store is changed. Keys are not written to Git or logs. Stop the launcher/server with Ctrl+C; restart requires entry again. Python/Node cannot guarantee forensic memory zeroization. Agents must never run this interactive entry flow on the user's behalf.

After successful key entry and readiness checks, the launcher starts the web server, saves/queues only the approved real note and starts the durable worker automatically. The worker receives a separate temporary owner token and no provider keys. The launcher prints that owner token and http://127.0.0.1:3000. Open that address in a browser on this laptop and enter the owner token in the sign-in screen. It is not a provider key. The web client has no remote access to this laptop address. Keep the terminal open; Ctrl+C stops server and worker. No content is automatically approved or published.

OpenAI uses gpt-4.1-mini-2025-04-14 at standard pricing. Every Chat Completions request explicitly includes service_tier: default. Returned tier/model/request ID and rate version are retained. An unexpected or missing tier pauses further reservations and keeps the full uncertain reservation. Truncated or safety-terminated output never advances checkpoints; known usage is settled, partial output is marked separately, and safety cannot be retried.

Before a new activation rerun tests and recheck official rates on the run day. The first user-operated task completed six calls using the configured OpenAI model and standard tier. Its reported-token estimate is $0.005690; the invoice remains unverified. See LIVE_RUN_CHECK.md.

Proposed public documentation choices, verified 10 October 2026:

| Provider | Model | Standard input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- |
| OpenAI primary | gpt-4.1-mini | $0.40 | $1.60 |
| Gemini fallback | gemini-3.5-flash-lite | $0.30 | $2.50 |

Sources: https://developers.openai.com/api/docs/models/gpt-4.1-mini and https://ai.google.dev/gemini-api/docs/pricing . Gemini 2.5 Flash-Lite is restricted to previous active users according to https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite ; it is unsuitable as the default for this new project.

Use decimal-string microdollars per token: OpenAI input "0.40", output "1.60"; Gemini input "0.30", output "2.50". Store a pricing version and official URL with every reservation. Integer totals round upward, preserving conservative budget accounting without rounding each token to a whole microdollar.

Six calls bounded to 16,256 input tokens (input bytes plus protocol allowance) and 1,200 output tokens each reserve at most $0.0505344 for OpenAI, rounded up per call. This is a conservative ceiling, not expected or actual spend. An eligible one-call Gemini fallback reserves at most $0.0078768 in addition; uncertain primary reservations stay counted. Actual billable usage is settled from reported tokens; Gemini thinking tokens are included. Combined monthly cap remains $15 with $1 retained inside it and warning at $10. No caching/grounding/tool discounts or charges are assumed; tools are not enabled.
