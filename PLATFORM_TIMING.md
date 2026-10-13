# Platform/day calendar compatibility

Migration 005 adds a timing mode, platform/day hour map, benchmark provenance and per-entry platform schedules. It does not insert hours or planned dates. Existing shared-hour settings, dates, IDs, source/task links, approvals, outputs and costs are preserved. Legacy entries without a platform map display their original shared hour for each variant; only an explicit plan action rewrites planned timestamps.

The dashboard supports a different hour for every LinkedIn, X and Instagram weekday slot. Each variant has its own intended-post and 48-hour review deadline. The shared content family must be ready 48 hours before the earliest slot. Generation lead remains independently unset until selected; nothing here activates a scheduler or paid call.

The parent supplied an optional India-first engagement benchmark, labelled hypothesis rather than a viral prediction:

| Day (IST) | LinkedIn | Instagram | X |
|---|---|---|---|
| Monday | 22:00 | 19:00 | 09:00 |
| Wednesday | 16:00 | 12:00 | 10:00 |
| Friday | 15:00 | 22:00 | 09:00 |
| Sunday | 22:00 | 21:00 | 09:00 |

Sources are linked in the UI: Buffer LinkedIn (4.8M posts), Instagram (9.6M posts) and X engagement studies. Dataset local times are not converted US hours. Competing research disagrees; Sunday LinkedIn/X evidence is weak. These are first testing hypotheses, not user-specific performance predictions.

Load benchmark into form changes only unsaved form state. It does not choose a start date, persist hours or reschedule entries. Save calendar settings is explicit. Editing an hour marks the provenance custom. The API rejects invalid hours/day/platform names, incomplete per-platform planning and mismatched preset provenance; it never silently falls back to a legacy shared hour in per-platform mode.

The parent confirmed Wednesday 14 October 2026 as the first planning target, with shared review-ready deadline Monday 12 October at 10:00 IST (the Wednesday X slot is earliest). Applying this plan is authorized only if the existing real timing is unset and the app is stopped; any user-set configuration must be preserved and conflicts reported. This is a planning target, not an active generation promise.

Standing permission now covers OpenAI drafting/revision from sources explicitly marked cleared for content in the dashboard, within the unchanged $10 warning/$15 combined cap and internal buffer. It excludes bank material, credentials and uncleared private/client content. Gemini and publishing remain disabled. The implemented source intake still accepts only the original exact capsule; a richer cleared-note registry/selection is not yet implemented. Standing permission alone does not select or transmit any new source.

The smallest next content step is to prefill a dashboard source note with verified project events and the user's own expressed reactions, then let the user mark that exact note cleared. Do not ask them to write the content or infer emotions. Before one new grounded pack can run, the source allowlist/consent registry must support that clearance, official pricing must be verified for 11 October, and the user-operated credential runtime must be active. No credential values are read or entered by the agent. Recurring generation, feedback-driven paid agent revision and reliable laptop-off hosting remain unactivated integration work.

Confirmed local planning setup was applied on 11 October after verifying no server listener and unset configuration/zero entries. A local ignored backup was saved. The plan starts 14 October, with four intent dates (14, 16, 18, 19 October), unlinked sources/tasks and no generation due time. The first shared review deadline is 12 October 10:00 IST. Fingerprints verified every existing source, task, output, original/revision approval, revision and cost row unchanged. Only authorized calendar configuration/planning records and calendar audit events were added. No model call or live app restart occurred.
