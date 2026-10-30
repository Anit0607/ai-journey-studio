# Session handoff: 30 October 2026

This note carries context from one Claude Code cloud session to the next. Read
it before doing anything else. It is a working note, not product documentation.

## How the owner wants to work

- Explain in plain language before acting. Ask before any change to the live
  site, database, Vercel settings or LinkedIn.
- Work on branches. Do not merge to `main` (which deploys production) without
  the owner's explicit OK.
- Never ask the owner to paste a token, key or password into chat. Secrets go
  in the cloud environment settings.

## Owner's vision

**Phase 1: personal content engine.** Turn the owner's real AI-learning journey,
including what was built, learnings and failures, into honest social posts.
Source library should include:

- GitHub repositories (working today)
- Chats with Claude, ChatGPT and Gemini
- The owner's YouTube channel (`@Studioemotune` in the example config)

Publish to LinkedIn first, fully end to end, then other platforms (X,
Instagram, later more).

**Phase 2: sell it as a product.** Build a business around it. Not started.
Implications to keep in mind so Phase 1 choices don't block it:
single-owner auth and registration disabled, one global budget, and Vercel
Hobby, which does not allow commercial use.

## Current state of the repo

- Next.js 16 / React 19 / TypeScript. PostgreSQL via `pg` (Neon in
  production) or PGlite locally. Deployed at https://ai-journey-studio.vercel.app
  (region `sin1`). That deployed app is the owner's "dashboard". Its tabs are
  Overview, Sources, Calendar, Connections, Publishing, Analytics and Usage.
- Seven agent roles: Harvester, Story Miner, Strategist, Writer, Platform
  Adapter, Critic and Analyst. There is a $10/$15 monthly budget guard.
  Everything is default-off behind explicit approval gates.
- Live behaviour is controlled by two JSON env vars on Vercel:
  `STUDIO_RUNTIME_CONFIG` (see `runtime-config.example.json`) and
  `STUDIO_INTEGRATIONS_CONFIG` (see `integrations-config.example.json`).
- History: on 24 Oct a LinkedIn-only run imported 25 commits and drafted a
  post. The Critic rejected it for unsupported claims, so nothing was
  published. Imports, drafting and publishing were then switched off. PRs
  37–51 tuned voice (`docs/linkedin-voice-v2.md`), fact selection, a one-off
  corrected comparison run (`docs/corrected-private-comparison.md`) and owner
  message context (`docs/owner-message-context.md`).
- No post has ever been published. Scheduled delivery (QStash) has not been
  verified end to end.

### Checks (this session)

- `npm ci`, `npm run typecheck`: pass.
- `npm test`: 1,221 tests. One was failing because its mock did not answer
  `SELECT * FROM tasks` after PR 51. It is fixed on branch
  `claude/fix-stale-review-test` (not yet merged), so the full suite now passes.
  The run takes about 10 minutes.
- Preview builds skip migrations (`lib/release-migration.ts:18-20`), so pushing
  a branch does not touch the production database.

## LinkedIn plan (agreed)

1. **Personal profile first.** The owner's LinkedIn developer app "AI Journey
   Studio" has the products *Share on LinkedIn* and *Sign In with LinkedIn
   using OpenID Connect*. That matches the scopes requested in
   `lib/integration-oauth.ts:25` (`openid profile w_member_social`). The owner
   says LinkedIn is connected in the dashboard. Still to confirm: the Connections
   tab card should read `linkedin · tested`, not `linkedin · connected`.
2. **Company page later.** Page ID is `145347773`, so the author would be
   `urn:li:organization:145347773`. Posting as the page needs
   `w_organization_social` from the *Community Management API*. Its "Request
   access" button is greyed out on the existing app, so a separate LinkedIn app
   with only that product is likely needed, plus LinkedIn's manual approval.
   The publishing code already accepts organization URNs
   (`lib/publishing.ts:76,83`), but the OAuth flow never requests that scope.
3. Check that the live `linkedin_version` in `STUDIO_INTEGRATIONS_CONFIG` is a
   version LinkedIn still accepts. Versions retire after about a year.

End-to-end path to prove: cleared source, drafting (OpenAI), Critic pass, owner
content approval, publication plan approval, QStash delivery, then the post
visible on LinkedIn.

**Main blocker:** find out why the 24 Oct draft failed the Critic, and fix
drafting so a true post passes.

## Chat collector plan (agreed in principle, not built)

No vendor offers an API for consumer chat history. Plan:

| Source | Collection |
|---|---|
| Claude Code / Codex | Read local session files (fully automatic, needs owner's computer) |
| Gemini | Google Takeout scheduled export (every 2 months) to Drive, picked up from there |
| ChatGPT, Claude.ai | Owner clicks Export about monthly and uploads the zip to the dashboard |

The agent then unzips, parses, deduplicates and stores the conversations in Neon
(a new table), marked private and not cleared until the owner selects them as
sources. No scraping or logging in as the owner. The existing parser is
`parseChatExport` in `lib/source-ingestion.ts`. It handles ChatGPT/Claude JSON
and a generic `ai-journey-chat-v1` format. It does not handle ZIP files, native
Gemini exports or files over 1 MB. Keep an eye on Neon free-tier storage
(about 0.5 GB; verify).

## Environment set up for the next session

- Network allowed domains (added by owner): `ai-journey-studio.vercel.app`,
  `api.vercel.com`, `console.neon.tech`, `api.linkedin.com`. All were reachable.
- Secrets the owner is adding (loaded only in a new session): `VERCEL_TOKEN`
  and `NEON_API_KEY`. Use them read-only unless the owner approves a change.

## First steps for the next session

1. Confirm `VERCEL_TOKEN` and `NEON_API_KEY` are set (do not print them).
2. With the Vercel API, read the project's env var **names**, their targets
   (Production/Preview) and the values of only `STUDIO_RUNTIME_CONFIG` and
   `STUDIO_INTEGRATIONS_CONFIG`. Do not print secret values.
3. With the Neon API, find the project and branch. Read-only, inspect the
   24 Oct task, its artifacts and the Critic findings, plus the LinkedIn row in
   `integration_oauth_connections` (status only, never the token).
4. Report to the owner in plain language why the draft failed and propose the
   fix. Then continue the LinkedIn end-to-end plan.
