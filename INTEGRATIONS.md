# Source ingestion and publication delivery

This change implements server-side adapters and durable orchestration. It does not connect accounts, obtain OAuth grants, provision a scheduler, activate production, or perform live publication. Mock HTTP and embedded PostgreSQL tests are not proof of live account connectivity.

## Sources

GitHub selected public repositories and YouTube selected channels can be periodically synchronized into staged sources using official APIs. A supplied credential is server-side only. Sources retain provenance and remote identity; only durable ingested batches advance cursors. Review each source's exact content/hash before clearing it for OpenAI. Staging never authorizes model transmission or publication. Private repositories require a separately approved least-privilege integration; never request broad OAuth `repo` just to read.

Consumer ChatGPT, Claude, Gemini Apps and Gemini Spark history cannot be synchronized by entering an API key. Import selected exported conversations/artifacts instead. Supported JSON import formats are specified by `parseChatExport` in `lib/source-ingestion.ts`. ChatGPT/Claude native export wrappers must explicitly name selected conversation IDs. Extract archives locally and provide selected JSON under 1 MB; ZIP parsing is not supported. No browser scraping or forbidden session-store reading is used. A separately approved Codex local app-server companion would depend on an awake computer; it is not provided as cloud account sync.

References:
- https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data
- https://support.google.com/accounts/answer/3024190 (Takeout recurring export is every two months, not continuous)
- https://support.google.com/gemini/answer/17094507 (Spark artifact export)
- https://developers.openai.com/codex/app-server/
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/youtube/v3/guides/push_notifications

## Publication

Publication plans capture the exact approved task/revision, platform, destination account, payload and scheduled time. A separate owner acknowledgement approves that immutable plan. Any edit requires fresh approval. Source revocation or artifact changes block pending dispatch. An atomic claim and durable attempt prevent repeated scheduler delivery from publishing twice. A timeout or ambiguous response after sending requires reconciliation; it must not be retried blindly.

Capabilities are intentionally narrow: LinkedIn standard posts, X single standard posts, Instagram professional-account single-image publication. Native LinkedIn articles, X Articles/threads, Instagram personal accounts and unverified carousel behavior are not represented as supported. Instagram needs a public, immutable JPEG with an owner-approved Vercel public Blob origin, content-addressed object path containing its hash, and matching SHA-256; caption-only output cannot publish. Publishing account IDs and authorization versions must be explicitly configured. OAuth app provisioning remains an owner setup step; supported code-level connection/refresh behavior is described below.

X currently charges for creating posts. It requires separate explicit cost authorization and a configured bound; do not treat it as a free API. OpenAI/Gemini retain their existing $10 warning / $15 combined monthly cap with the buffer inside it. Gemini fallback stays disabled. Do not enable paid social calls without reviewing their separate spend configuration.

References:
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- https://docs.x.com/x-api/getting-started/pricing
- https://docs.x.com/x-api/posts/manage-tweets/integrate
- https://docs.x.com/fundamentals/counting-characters

## Delivery and configuration

`STUDIO_INTEGRATIONS_CONFIG` is nonsecret server JSON. `sources` configures allowlisted read adapters; `publishing` configures disabled-by-default publishing account metadata; `scheduler` configures authorized delivery mode and cadence. Each manual-token publishing account names a credential_env such as STUDIO_PUBLISH_LINKEDIN_OWNER_TOKEN. Only names beginning STUDIO_PUBLISH_ followed by uppercase letters, digits or underscores are accepted. Tokens remain in those separately provisioned server environment slots, never in this JSON or browser local storage. OAuth accounts instead use encrypted database storage described below. Missing credentials are reported as not ready.

`GET /api/integrations/tick` uses the separately enabled legacy cron bearer transport. QStash uses signed `POST` with raw-body verification; both require the exact configured origin and explicit scheduler authorization; hosted environments also require existing hosted owner/database readiness. It runs a bounded sync/publication tick using a persistent lease. It does not schedule or ping itself. Merely saving config does not establish delivery. Connections displays actual persisted last-run observations separately from config readiness. `/api/studio/integration-sync` and `/integration-import` require the existing authenticated owner session and same-origin mutation protection.

Vercel Hobby cron runs each job at most daily with an hour-wide invocation window. This does not support exact platform post times. `scheduler.mode= daily` is allowed for source synchronization but fails closed for publishing. Timed publishing requires an independently provisioned, explicitly authorized external scheduler with a declared 15–300 second cadence. Missed publication windows remain blocked rather than silently publishing late. No paid upgrade or scheduler was provisioned here. The existing single daily generation batch and 48-hour content-review constraints are unchanged.

https://vercel.com/docs/cron-jobs/usage-and-pricing

## Migration and verification

The existing Better Auth password/session flow is retained. Apply the explicit database migration after approval; no production schema is changed by these edits. Migrations 12–18 add source provenance, publication outbox, scheduler observations, private/public media consent, upload accounting, encrypted OAuth state and signed-delivery replay claims. Local embedded PostgreSQL initializes the same schema without seeding fake workspace records. The deployment baseline is version 11. Interim developer databases created from an earlier draft of migration 17 need an explicit constraint upgrade or isolated rebuild; CREATE TABLE IF NOT EXISTS does not widen a preexisting provider CHECK constraint. Do not delete real workspace data to apply a draft schema.

Use `node --no-wasm-code-gc --import tsx --test --test-concurrency=2 tests/*.test.ts` in this cloud environment (the `tsx` CLI IPC socket is restricted and Node 24/PGlite needs the noted code-GC workaround), followed by `npm run typecheck`, `npm run lint` and `npm run build`. No real provider calls, production data or credentials are needed by the mocked tests. Real account, OAuth scope, public-media delivery and hosted PostgreSQL multi-instance verification remain separate activation checks.

## Verification limits during cloud implementation

The final frozen checkpoint passed all 322 automated tests with `--no-wasm-code-gc`, plus the optimized production build, TypeScript checks and ESLint. Independent launch-safety review found no outstanding reproducible blocking defect in the reviewed code. The first aggregate test run hit a native Node 24 / PGlite WebAssembly code-GC crash in the agent-revisions test process; rerunning that complete 18-test file with `node --no-wasm-code-gc --import tsx --test tests/agent-revisions.test.ts` passed. A browser smoke script exists at `scripts/integrations-qa.ts`, using disposable records and no external calls, but the cloud Chromium launch was blocked by the sandbox's Unix-socket restriction. No rendered-browser pass is claimed. Real network PostgreSQL, OAuth grants, hosted scheduler delivery and live provider publication remain unverified.


## Private deterministic Instagram media

The studio can render the exact approved Instagram caption into a branded faceless JPEG card using a pinned local font and Sharp. Rendering does not call a paid image service, invent visual claims or upload source material. Oversized/unsupported text fails rather than truncating the approved content. The private preview is served only through the authenticated owner API and has a SHA-256 content identity.

Public hosting is a separate approval: the owner reviews the actual image and authorizes its exact hash and Vercel Blob origin. Upload happens only when a separately approved publication is claimed and both source/artifact and media permissions are still valid. Server storage configuration is disabled by default; it requires explicit upload/credential permissions, a public Blob origin, an approved server credential slot and monthly byte/operation bounds. No store or grant is created by this code. Blob SDK uploads use addRandomSuffix:false and allowOverwrite:false at a content-addressed JPEG path. Duplicate paths are accepted only after fetching and hashing the actual bytes. Unknown upload outcomes remain reserved and are not blindly replayed. Only the final JPEG is public; source notes, chat messages and private preview records remain private. Revocation prevents later dispatch; it cannot erase copies already published or fetched from public hosting. Removing an existing public object/post is a separate owner action.

The renderer and uploader are code paths verified with isolated fixtures, not evidence of a provisioned store or live Instagram publication. Blob storage/transfer is a separate service from the OpenAI/Gemini budget and needs its own reviewed quota/price setup before activation.


Blob activation currently supports only an explicitly verified Hobby plan, whose documented quota exhaustion blocks service rather than permitting paid overages. Pro/paid storage is intentionally blocked in this implementation: local upload counts/bytes cannot cap public-download egress or all account-wide costs. Verify the actual account plan and remaining shared quotas before activation. A token-based store must have an owner-created sentinel pathname; the authenticated read-only HEAD must prove that token's store origin matches the separately approved public origin before any upload. OIDC mode requires explicit approved store ID and nonempty runtime OIDC token, with no read/write-token fallback. Alternative Blob API endpoint overrides are rejected.

## Account connection lifecycles

The Connections screen now includes real owner-initiated OAuth start/callback/identity-test/disconnect flows for X, LinkedIn and Instagram through Facebook Login. These are implemented code paths, not accounts connected by this change. App registration, encryption-key provisioning and provider grants still require owner setup/approval. Starting a flow requires a current password session, same-origin request and explicit acknowledgement. Callback state is random, expiring, one-use and tied to the original still-valid owner session and a short-lived HttpOnly browser binding cookie. X uses S256 PKCE. Access/refresh tokens and pending verifier are encrypted with a separately provisioned 32-byte AES-GCM key (`STUDIO_CONNECTIONS_ENCRYPTION_KEY`); tokens never enter browser JSON or logs.

X supports serialized refresh rotation; uncertain refresh outcomes require reconnection rather than blind reuse. Linking requires a separate identity test before the account can publish. That possibly paid test has its own explicit maximum/cap in USD, separate from publication charges and from the OpenAI/Gemini cap. Both reserve uncertain charges across IST month rollover. LinkedIn requires an exact registered HTTPS callback, including development; X permits exact HTTP loopback callbacks for local development. LinkedIn self-service tokens require owner reauthorization on expiry; partner refresh entitlement is not assumed. Changes in grant/version/identity invalidate pending publishing approval, including changes between credential retrieval and the final outgoing request.

Instagram supports the verified Facebook Login route for a professional account linked to a Page. The owner grants only pages_show_list, instagram_basic, instagram_content_publish and pages_read_engagement; business_management, comments and insights scopes are not requested. Identity testing discovers candidate Page/Instagram pairs, and the owner must explicitly choose the exact pair even if only one exists. Selection rechecks permissions, the Page link and publishing access. Only the encrypted Facebook user token is retained; any returned Page token is discarded. Returned token expiry is mandatory and expiry/error requires reauthorization. Facebook token exchange follows the official fixed-endpoint query-parameter contract, so deployment query-string capture, APM traces and outbound fetch URL logging must be redacted before activation. The server requires the explicit owner-verified `exchange_url_redaction_verified=true` setting before the Facebook flow can start or exchange its code; this task does not inspect or change live logging. The distinct Instagram Login automatic exchange/refresh lifecycle remains unsupported; no perpetual refresh or permanent Page token is assumed. Manual professional-account server credentials remain an alternative. Consumer chat histories still require selected exports. YouTube supports public channel metadata with the configured server API key; owner-private YouTube OAuth/captions remain unsupported here.

Private GitHub ingestion supports a separately provisioned selected-repository read-only GitHub App. The runtime signs a short-lived JWT using the approved server key, verifies installation/app/owner binding, requests only exact selected repository IDs with contents:read and metadata:read, verifies the returned repository IDs/names/permissions, and refreshes short-lived installation tokens through a concurrency-deduplicated cache. It never registers an app, expands repository access or asks for broad repo-write OAuth. The configured repositories must belong to one verified installation owner. Server key slot: STUDIO_SOURCE_GITHUB_APP_PRIVATE_KEY. Manual server token mode is retained as an alternative.

Start from `integrations-config.example.json`; every activation/permission flag is false and spend/quota bounds are zero. Replace callback/origin/store identifiers only after verifying the actual provider registration. Never paste tokens, client secrets or the encryption key into this file or chat. Provider app credential slots default to STUDIO_OAUTH_X_CLIENT_ID / STUDIO_OAUTH_X_CLIENT_SECRET and STUDIO_OAUTH_LINKEDIN_CLIENT_ID / STUDIO_OAUTH_LINKEDIN_CLIENT_SECRET and STUDIO_OAUTH_INSTAGRAM_FACEBOOK_CLIENT_ID / STUDIO_OAUTH_INSTAGRAM_FACEBOOK_CLIENT_SECRET. The Facebook callback is also exact registered HTTPS.

## Evidence-to-calendar continuity

Sync creates staged evidence, not paid model work. The owner reviews and clears the exact imported source for OpenAI, then links it to a planned calendar entry. Evidence is never silently auto-selected from mixed private history. Once calendar generation and the existing runtime/budget permissions are enabled, the daily dispatcher queues that exact source hash and resumes the six checkpointed agents automatically. Content approval, exact destination/time publication approval, and (for Instagram) exact JPEG public-hosting consent remain distinct owner reviews. The existing UTC-day generation gate and minimum review lead time remain unchanged.

## Concrete cloud scheduler setup (not provisioned)

Use the [bounded QStash setup runbook](docs/qstash-linkedin-setup.md). Its proposed transport is signed POST with exactly the empty JSON object `{}` to `/api/integrations/tick` every two minutes, plus one signed daily POST to `/api/cron`, with **zero provider retries on both schedules**. This is 721 planned scheduled deliveries/day before other account usage, duplicates or operator tests. The owner's actual QStash plan, region, quota and shared usage must be verified before approval or activation. No paid plan, upgrade or overage is authorized.

The older five-minute / one-retry proposal is superseded: five-minute polling consumes the whole five-minute publication window before network, source-sync or database latency. Two-minute polling provides margin, not exact-time or outage-proof delivery. Each tick handles at most one scheduled publication. Delayed, failed and uncertain publication outcomes still require review, not blind replay.

The runbook keeps provider access, server credential storage, source-to-OpenAI consent, paid-generation activation and every-post approval separate. It describes the existing seven-UTC-date pricing expiry, hourly source polling/read budgets, real schedule readback, and the hardcoded status fields that must not be mistaken for live delivery evidence. No schedule, credential, grant, source scope or runtime setting is activated by this documentation.

References: https://upstash.com/docs/qstash/api-reference/schedules/create-a-schedule ; https://upstash.com/docs/qstash/features/security ; https://upstash.com/pricing/qstash ; https://vercel.com/docs/functions/configuring-functions/duration

Facebook Login primary implementation reference: https://github.com/fbsamples/reels_publishing_apis/blob/7bf98f94e75d841ecc9612c0061881d1d713c6bd/insta_reels_publishing_api_sample/index.js

## Owner-triggered manual publication

Publication plans can explicitly select manual delivery instead of an authorized scheduler. Existing plans remain scheduled, and publishing stays off unless its existing server and credential-use gates are authorized. Manual delivery requires a fresh exact-plan approval plus a separate deliberate owner action during the approved time window; it cannot deliver early, late, to another account, or select the next job. No scheduler is claimed or provisioned. See [Exact owner-triggered publication](docs/manual-publication-delivery.md) for the workflow, migration 020 and no-replay boundaries.
