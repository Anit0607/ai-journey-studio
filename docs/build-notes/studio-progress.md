# Studio progress and database sleep

## Verified progress
- Documented assistant-observed database configuration, scheduler behavior and provider status on 25 October 2026; these are system observations, not the owner's personal experiences or feelings.
- Verified that the existing Neon Free account had a monthly allowance of 100 compute-unit hours per project.
- Verified that the production endpoint was configured with both minimum and maximum compute at 0.25 compute units and a five-minute autosuspend delay.
- Documented two sources of database reads in the previous setup: two-minute integration requests and five-second signed-in dashboard polling.
- Updated signed integration-request handling to validate the request and return before database access when outside the configured source-intake and publishing windows.
- Updated source intake to use hourly windows and publication handling to use exact configured windows.
- Updated background dashboard polling to pause when the page is hidden or unfocused, or after 60 seconds without activity; polling remains available when the page is active and recently used.
- Verified that fresh Neon provider observations reported at 04:10:55 UTC and 04:12:20 UTC on 25 October 2026 showed the production endpoint as SUSPENDED; these are reported observation times, not suspension event timestamps.
- Verified that a fresh Neon observation reported at 04:14:50 UTC again showed SUSPENDED; a separate Upstash metadata observation recorded the scheduled 04:12 integration wake as SUCCESS, without establishing a response body, HTTP status code or request-level SQL trace.
- Documented that the observation used provider status reads without SQL queries, manual resume or settings changes during the observation window.
- Documented that the verification used the existing connected account and Free plan, without a paid-plan upgrade.
- Documented the limits of this result: the checks establish endpoint state at the observed times, not uninterrupted sleep, measured monthly compute savings, guaranteed use within the Free allowance or successful LinkedIn publication.
- Documented that the commit linked below identifies the implementation change; the endpoint settings and runtime observations above come from separately inspected provider receipts, not from treating a commit link as runtime proof.

## Evidence
- https://github.com/anit0607/ai-journey-studio/commit/e2a608b9f7a9e1dfde4f96709e8cb47a182819ff
