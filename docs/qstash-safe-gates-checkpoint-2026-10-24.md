# QStash safe-gates deployment checkpoint — 24 October 2026

This checkpoint loads the owner-approved scheduler configuration through the normal Git-integrated deployment route. It does not enable source imports, generation, media handling, or social publication.

## Configuration scope

- Existing QStash current and next signing keys are stored as Production-only secrets. Their presence and scope were verified without recording their values.
- The nonsecret scheduler selection is `provider: qstash`, `authorized: true`, `mode: external`, `cadence_seconds: 120`, and `source_interval_minutes: 60`.
- Unrelated integration configuration, OAuth connections, runtime/model settings, and all source-import and publication activation flags remain unchanged.
- Authenticated application state was checked before release: persisted calendar generation was OFF, source imports and publishing were OFF, and there were no active task leases or unresolved/reserved paid calls. These gates must remain unchanged for the harmless timer check.

## Verification boundaries

The initial timer is only an exact empty-JSON POST to `/api/integrations/tick`. That route verifies the QStash signature and uses the existing durable delivery and integration leases. It has no model-generation path. Disabled sources and disabled publication remain separately gated.

The daily `/api/cron` schedule is not part of this checkpoint. A generation-disabled cron dry run can consume the existing UTC-day batch row, so it is not a harmless substitute for the integration tick.

A successful deployment is not proof of a delivered timer, scheduled publication, or an end-to-end automated workflow. Provider delivery status and the application's durable tick result must be checked afterward, with paid usage and source/task records unchanged.

This commit changes documentation only. Application code, database migrations, dependencies, and permission gates are unchanged. Existing production migration validation remains mandatory.
