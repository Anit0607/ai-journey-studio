# AI Journey Studio

Private local first slice for Anit Bose's AI learning journey. Python 3.13 standard library, SQLite durable worker, browser dashboard. No seeded records, synthetic output, publishing or external source imports.

## Local access

From this directory run two separate PowerShell terminals:

    python studio.py serve
    python studio.py worker

Open http://127.0.0.1:8765 and enter the temporary access token printed by the server. Token changes at every server start and is held only in memory. The server binds to loopback. The worker survives browser closure; it runs while its terminal/process remains open. This is not 24/7 cloud hosting.

Save the displayed exact cleared source capsule deliberately, then queue it. Until setup is authorized, tasks remain queued and no provider requests occur.

## Secure setup blocker

Before a live run, obtain explicit authorization for transmission of the exact capsule dated 9 October 2026 to OpenAI and optionally Gemini, and use of credentials for ongoing runtime calls. Do not paste credentials into chat, source files, Git or dashboard. A user-controlled process environment can supply OPENAI_API_KEY and optionally GEMINI_API_KEY after authorization. No credential storage is provisioned by this repository.

Create ignored runtime-config.json only after authorization and successful tests. Its fields are transmission_authorized, credential_use_authorized, security_tests_passed, pricing_verified_date (UTC current date), fallback_authorized, and provider objects openai / gemini. Each provider object requires model, official_pricing_url, input_microdollars_per_token and output_microdollars_per_token. Rates must be positive integer microdollars, conservatively rounded up; verify exact current model and rates against official provider docs on run day. No model or price is invented or preconfigured.

OpenAI is primary. One Gemini fallback is possible only after eligible 429/5xx responses and authorization. Access/refusal errors never trigger fallback. Unknown completion retains the full reservation and blocks automatic replay. 5xx reservations are retained even if a bounded fallback succeeds. There is no automatic retry after ambiguous timeout, cancellation or restart.

## Safety and durability

Monthly combined maximum $15, warning $10, $1 buffer inside cap, IST calendar month. BEGIN IMMEDIATE serializes reservations; estimated token costs and unresolved reservations count against the limit. Reported token estimates are not invoices. Input byte count provides a conservative input token bound; output capped at 1200. One worker process is enforced by a Windows file lock. Checkpoints are committed with outputs. Cancellation stops future calls; an in-flight result is still recorded and charged. Approval binds all six role outputs to an exact SHA-256 bundle and checks source version/clearance.

Harvester, Story Miner, Strategist, Writer, Platform Adapter and Critic create provider-backed artifacts sequentially. Orchestrator owns lifecycle. Analyst remains insufficient-data because no real platform metrics are imported. Human review includes critique and exact platform variants. No chain of thought is requested or shown.

## Verification

    python -m unittest -v
    python -m compileall -q studio.py test_studio.py
    git diff --check

Test fixtures use a separate temporary database and never populate live data.

## Remaining scope

No deployment, social connections, publishing, provider purchase, credential installation or Vercel grants. Hosting eligibility remains unresolved. Future Vercel frontend/API adaptation needs a durable external database/worker and explicit approval; the current Windows worker cannot run on Vercel as-is. No standalone Python type/lint tools installed; compilation and stdlib tests are the baseline.

The approved Library blueprint could not be materialized: its supported helper uses os.setxattr, unavailable on Windows. Implementation follows the delegated approved brief, including the live-only override.
