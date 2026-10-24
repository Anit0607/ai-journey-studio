# Controlled production recovery: 24 October 2026

## Observed failure

The reviewed privacy/grounding repair was merged in PR28 as `a0808aa5bc0529cd9f854c19db4ec32a907a0ef4`, tree `28b21fa109e3cb5be0d5347ef267d2250385168b`. Its preview passed, but production deployment `dpl_qrDF4fGCsxnGxY6mjyHkwAZCrLgr` failed at 05:54:17 UTC.

Owner-provided build-error evidence and review of the unchanged release hook identify migration 020's CONNECTION stage: the connection attempt timed out after 5,000 ms before `client.connect()` resolved, before `BEGIN` or migration SQL. Migration 021 and the Next build did not run. No partial migration resulted from this attempt. The underlying driver/network cause is not established; no cold-start or other cause is assumed.

The public alias continued serving READY PR27. Read-only checks at 06:07 UTC confirmed that the existing public application could read its PostgreSQL-backed state and source-policy availability. The original blocked task and artifacts were unchanged; no unresolved/reserved usage remained. These application reads are not a substitute for catalog validation and do not prove a new build will connect successfully.

## One controlled recovery release

This documentation-only checkpoint retries the ordinary Git integration once with every PR28 application, test, dependency, schema and release-hook file unchanged. It does not change connection timeouts, TLS, credentials, permissions, database authorization, migration SQL or required catalog checks. Existing guarded migrations 020/021 and all production build checks must still complete normally.

Runtime configuration remains unchanged. Source sync, drafting, publishing and scheduling remain OFF. No provider call, source sync, failed-run resume, automatic paid retry, approval or social post is authorized or performed by this release. Existing source clearances, records and usage controls are preserved.

The PR28 validation record remains applicable to the identical repair code: 72 new mock tests, 249 affected regressions, an independent 72-test rerun, and ordinary typecheck/lint/build passed. No whole-application aggregate or real-model quality claim is added; no application suite was rerun for this Markdown-only checkpoint.

Monitor the exact production commit to a terminal result and then verify the public alias separately. If the connection or any other required build check fails again, preserve that failure and stop for diagnosis; do not bypass checks or launch another blind retry.
