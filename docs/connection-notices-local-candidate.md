# Connection-only notices: local candidate

## Release status: HELD

This is unpublished local preparation. The public notice text, owner-use text, proposed effective date **23 October 2026**, and publication require the owner's review and approval. The Page Message contact is included in the candidate, but the owner still needs to confirm the notice's contact wording and that this is a workable monitored route. The date in the runtime page is a **PROPOSED release date, not an approved or already-effective date**. There is deliberately no draft banner in the runtime page: the entire candidate must remain undeployed until approved.

No GitHub write, commit, push, merge, Vercel write, deployment, real credential access, owner-data access, legal acceptance, LinkedIn grant, provider request or feature activation occurred. This is not a legal-sufficiency assessment. No owner consent was performed by preparing or testing the checkbox.

## Baseline and change boundary

- Production reference supplied for this task: `9ed7c288a005121f63cc921fd7e1d6a2b4709e9a`.
- Independently verified copied source tree: `424f9414f8f78562bc5380b2484b017608f0884e`.
- The isolated candidate was copied from the 217 tracked files in the supplied X-validated workspace. Ignored environment files, runtime configurations, data, build output and dependency folders were not copied as source.
- Existing pinned dependencies were copied into the candidate separately for local execution. No package was installed or changed and no package-install lifecycle scripts ran.
- There are no changes to APIs, authentication libraries, OAuth handlers/scopes, database schemas, permission flags, provider configuration, publication code, scheduling, cron, source ingestion, media, model calls, dependencies or deployment configuration.

## Implementation

1. Static `/privacy` and `/use` pages contain only the proposed public notices, with shared navigation and the LinkedIn Page Message contact. Neither page imports workspace data, credentials, cookies or server storage. Next.js prerenders both pages.
2. Both notices are linked from the unauthenticated owner sign-in screen and immediately before the LinkedIn consent checkbox. Links do not prefetch.
3. The LinkedIn disclosure explains the unchanged `openid profile w_member_social` scope, no email request, encrypted-token retention, owner-triggered basic-profile verification, the broader comments/reactions scope and the fact that Studio implements only posts with publishing off. Connection does not approve a post or send the LinkedIn profile to OpenAI.
4. The LinkedIn checkbox starts unchecked and explicitly acknowledges both notices and the stated access/storage. The button says “Continue to LinkedIn” or “Reconnect with LinkedIn.” The client handler also checks the existing checkbox state for start/selection operations and passes the actual boolean; the existing server-side owner-session, Origin/CSRF, exact redirect, scope, token encryption, storage and acknowledgement checks are untouched.
5. There is no application-wide auth middleware or pathname allowlist to relax. Only the two new explicit page files are public. Protected APIs retain their own authentication and authorization checks; no prefix exemption was introduced.
6. The owner-use notice follows the review draft, including: “Do not add employer or client material, private or confidential data, or credentials.” It does not prohibit general banking-domain knowledge. This narrow patch does not alter unrelated existing source-import wording or source-processing gates.

## Verification

Final results against this candidate:

- Full TypeScript regression suite: **436 passed, 0 failed**, with two test files running concurrently.
- Focused notice/integration UI suite: **8 passed, 0 failed** (included in the full suite).
- Typecheck, lint, production build and whitespace check: **passed**. Build output lists `/privacy` and `/use` as static pages.
- Production loopback HTTP/security checks: **passed**.
- Python owner-setup/secure-launcher tests: **35 passed**.
- Legacy Windows Python/SQLite suite: **blocked before test execution** on this Linux host because the unchanged legacy `studio.py` imports Windows-only `msvcrt`. This is not counted as a pass.
- Rendered-browser and interaction checks: **blocked**, as detailed below.

Logs accompany the external release report/manifest. The added regression suite covers static notice rendering, exact contact/links, data-access-free page imports, disclosure accuracy, concise use text, unchecked/disabled initial consent, owner-only protected APIs, CSRF and strict boolean connection acknowledgement. Existing tests cover publishing-off, scope storage, account validation, encryption, disconnect and source/model approvals.

The production HTTP checks use a temporary embedded database with a synthetic owner and one uncleared synthetic source marker. They verify that public notice responses set no cookie and expose none of that source, keep existing frame/referrer headers, reject fake notice-prefix routes, and retain private-API/CSRF protections.

The browser script is retained for future authorized QA. **Rendered visual and browser-interaction checks are blocked and have not passed.** Chromium failed before opening a page because its local IPC socket was not permitted. The supported escalation failed during execution-environment setup. No denied mount was read or changed, and no alternate route was used to overcome the restriction. No screenshots from this candidate are claimed. Static React render tests are not a substitute for visual/browser QA.

## Reproducible local checks

Run in an isolated copy with no real credentials or production data. The `node --import tsx` entry point avoids the `tsx` CLI's additional IPC listener while running the same test files.

```sh
env -i PATH="$PATH" HOME=/tmp NEXT_TELEMETRY_DISABLED=1 npm run typecheck
env -i PATH="$PATH" HOME=/tmp NEXT_TELEMETRY_DISABLED=1 npm run lint
env -i PATH="$PATH" HOME=/tmp NEXT_TELEMETRY_DISABLED=1 node --import tsx --test --test-concurrency=2 tests/*.test.ts
env -i PATH="$PATH" HOME=/tmp NEXT_TELEMETRY_DISABLED=1 STUDIO_ORIGIN=http://127.0.0.1:3195 STUDIO_LOCAL_DB=1 STUDIO_DATABASE_AUTHORIZED=0 STUDIO_RUNTIME_CONFIG='{}' STUDIO_INTEGRATIONS_CONFIG='{}' node node_modules/next/dist/bin/next build
env -i PATH="$PATH" HOME=/tmp NEXT_TELEMETRY_DISABLED=1 node --import tsx scripts/public-notices-qa.ts --http-only
```

Do not run the HTTP production-server check concurrently with a build: Next.js replaces `.next` during compilation. In an environment that permits browser execution, the same QA script without `--http-only` attempts the preserved desktop/mobile, checkbox, error, navigation and sign-out tests. That is future verification, not a result obtained here.

## Holds and later checks

- Owner approval of the exact public text, owner-use text, proposed date, contact wording and publication is still required. Keep the candidate local until then.
- The owner retains the decision whether to keep the broader posting scope for this connection-only phase. This patch neither expands nor removes it.
- Hosting log/redaction and database recovery-retention settings remain unverified, as expressly stated in the notice. Do not promise deletion from every copy, a response time, zero retention or legal compliance.
- Before a separately authorized release, verify production still matches the baseline or rebase/retest; confirm publishing, scheduler, media and unrelated source/model features remain off; finish the blocked visual/interaction checks in a permitted environment.
- After an authorized deployment, check both exact public routes, login links, private API denials, unchecked LinkedIn consent and actual feature-off state on that exact release. No deployment or live consent test is part of this preparation.
