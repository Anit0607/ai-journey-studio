# Local X weighted-character validation candidate

## Scope

This patch is based on tree `10795bbce8f82f0de653fd176f611e1c7c597350`, the production-equivalent source tree supplied for this task. It changes only server-side standard X post validation, its pinned parsing dependencies, tests and documentation. No UI, saved user data, authentication, runtime permissions, provider configuration, schedules, source clearance or approval policy is changed. This is a local candidate, not a commit, push, merge or deployment.

## Defect and fix

The old ASCII/non-ASCII approximation accepted 260 ASCII letters followed by a space and `https://x.co`: 273 literal characters but **284 X-weighted characters**. It also rejected valid long URLs, accented Latin text and multi-code-point emoji.

The server now uses the official `twitter-text` parser for NFC counting, URL detection and the standard 280-character weighted limit. X's [current counting documentation](https://docs.x.com/fundamentals/counting-characters) specifies 23 characters per detected URL, NFC normalization for measuring text, and two per emoji sequence. The parser's full `valid` result also rejects its invalid-character cases. It never normalizes, truncates, splits or rewrites the saved or submitted text.

The same existing `normalizedPayload` validation path remains authoritative for enqueue, revision, publication intent hashing, approval/dispatch validation and the final official adapter. Existing source, exact-artifact, immutable approval, exact-account, schedule, scheduler and separate X-spending checks remain in force. Passing a character check does not authorize publishing. No informational UI counter or new UI budget was added.

The app also imposes a separate **4,096 UTF-16-code-unit raw-input safety limit** before calling the synchronous parser. This is not an X rule: it bounds the upstream URL regex's work after review reproduced multi-second parsing of a near-request-limit dotted string. A distinct error identifies the app limit. Ordinary long URLs still benefit from the 23-character weighting, but extremely long text or multiple long URLs can hit this stricter app guard even if their weighted count would fit X. Nothing is truncated, normalized or published to work around this limit.

## Dependency review

- Direct runtime dependency: official `twitter-text` 3.1.0, Apache-2.0, released 2020-03-31. npm integrity: `sha512-nulfUi3FN6z0LUjYipJid+eiwXvOLb8Ass7Jy/6zsXmZK3URte043m8fL3FyDzrK+WLpyqhHuR/TcARTN/iuGQ==`.
- Its default Twemoji 11 data miscounts modern sequences: `🫱🏽‍🫲🏻` measured 9, not 2. A scoped, exact npm override replaces only that dependency with `@twemoji/parser` 17.0.2 from the maintained Twemoji project, using the compatible `parse(text)` entity API. npm integrity: `sha512-X/P7pHsGOxnrupQYUVetIeuxBGgffFu8CLwoPMMjH9CWmQvlXiCpbTW/BXxMOCWXQojgHdmgdvm6IsCqAQ5nxA==`.
- The successor parser is MIT, has no runtime dependencies or install lifecycle hook, and its published JavaScript was inspected. It creates emoji entity metadata and asset URL strings without making network requests; no assets are fetched or rendered here. Its [source and package migration documentation](https://github.com/jdecked/twemoji-parser) identify the maintained successor.
- The complete change adds five runtime packages. Existing dependency versions are unchanged. Lockfile integrity hashes pin every new package. Registry tarballs were inspected and install scripts disabled. No scripts from an unknown repository were executed.
- `core-js` 2.6.12 is deprecated and globally probes/polyfills features. This is an explicitly retained legacy dependency of the official parser, not a claim of modern maintenance. Its deprecation warns of possible performance/compatibility effects. The patch does not attempt an incompatible major override or vendor a hand-written parser.
- Server-only import: the dependency is reached from `lib/publishing.ts`, not any client component. Only the `parseTweet` entry point is imported. This avoids adding parser/polyfill code to the browser and avoids importing unrelated linkification routines; it still increases installed/server dependency size. Installed package allocation is approximately 10 MiB across the five packages and is not a client download-size measurement.
- A clean npm advisory result means no **known reported** runtime vulnerability at check time, not proof that the packages are free from vulnerabilities. Package age, future emoji/URL-data changes and the intentional parser override remain maintenance considerations.
- URL detection follows upstream semantics, not a homegrown expression. For example, literal `https://example.com/道` counts 25, while an encoded path counts 23. The [official JavaScript README](https://github.com/twitter/twitter-text/blob/master/js/README.md) explains the intentional treatment of adjacent non-Latin text. No implicit URL rewriting is performed, and tests are documented-rule/upstream compatibility evidence, not live X certification.

## Regression coverage

- ASCII 279/280/281; Latin NFC and NFD equivalence; CJK and documented one-weight ranges.
- Distinct app-size guard, boundary-length valid long URLs, and an injected parser spy proving oversized/pathological text never reaches the parser.
- Single emoji, skin tones, flags, keycaps, family/profession ZWJ sequences and newer mixed-tone handshake/directional sequences, at and over the limit.
- Short, long, schemeless and multiple URLs; boundary punctuation; the exact 273-literal/284-weighted regression.
- Empty text and upstream-invalid characters.
- Reuse at enqueue, revise, approval, dispatch and adapter entry; over-limit legacy stored-plan simulation blocks before any credential read or outbound attempt.
- Exact NFD and long-URL bytes retained in stored payloads and mocked adapter bodies; unchanged originals and hashes; NFC-equivalent but byte-different input cannot replace an approved draft.
- Content approval, explicit publication acknowledgement, disabled runtime and separate X-spending authorization remain required; no provider ledger entry or real request.
- LinkedIn's existing 3,000 UTF-16-unit limit and text-only restriction, and Instagram's existing 2,200-unit limit and JPEG requirement, are unchanged.

All database checks use disposable in-memory fixtures. Adapter transports are local mocks, never real providers. UI code is unchanged; existing UI regression tests are part of the full suite, not a new rendered-browser pass. Live X acceptance, real credentials, production data, current account entitlements and provider billing are not tested or enabled.

Final check results and logs are recorded with the delivered local patch. Re-run the pinned dependency installation and complete regression suite before any separately authorized release.
