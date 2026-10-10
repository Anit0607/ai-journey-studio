The local studio previously lacked a user-operated hidden credential prompt and showed readiness from the server environment instead of the worker. This change adds memory-only worker key entry, consent-gated source saving, actual worker heartbeat, decimal pricing totals, and clearer empty/loading/error/cost interface states.

Documents the proposed currently listed models and the clean PostgreSQL/durable-job/Next.js migration path. The current application remains a local validation slice.

Validation: 16 isolated safety tests, HTTP authorization/source-consent checks, worker singleton/process smoke checks, Python compilation, JavaScript syntax and Git whitespace checks. Browser screenshots remain blocked by the supported browser runtime crashing during initialization. No live provider calls, secrets configured, deployment or publishing.
