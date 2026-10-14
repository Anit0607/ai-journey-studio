# Owner-controlled setup checklist

Based on [PASSWORD_AUTH.md](PASSWORD_AUTH.md) and the existing hidden-input helper. This is a preparation checklist, not authorization to change production. Database migration, owner provisioning, persistent authentication-secret configuration and any required redeployment need the owner's applicable approval before execution.

1. Confirm the approved checkout and intended Neon project. Stop local app/worker processes before setup. Keep any new Windows checkout/data on D or E; do not move existing data as part of this step.
2. Keep execution off: `STUDIO_HOSTED_ENABLED` disabled/unset; `hosted.enabled`, `hosted.cron_authorized` and `hosted.persistent_key_authorized` false; fallback false. Leave OpenAI/Gemini keys and `CRON_SECRET` unset. Preserve source, pricing, budget and other permissions; this setup does not grant new source clearance or paid execution.
3. After approval, configure only the required owner-login settings: the existing approved encrypted `DATABASE_URL`, `STUDIO_DATABASE_AUTHORIZED=1`, exact canonical HTTPS `STUDIO_ORIGIN`, and `hosted.owner_auth_authorized=true`. `STUDIO_LOCAL_DB` must not be `1` in production. Do not replace the rest of the runtime configuration.
4. The owner supplies a distinct server-only `STUDIO_AUTH_SECRET` of at least 32 printable non-space characters through the approved secure configuration flow. It is not the owner password and must not equal a cron credential. Do not place its value, the connection string or password in chat, command arguments, screenshots or repository files.
5. Only after approval for the intended database migration and owner creation, the owner runs:

```text
python scripts/set_owner_password.py --owner-setup-authorized --remote --migrate-authorized
```

The owner enters the approved Neon connection string and chosen password twice into hidden prompts. The helper verifies the constrained Neon/TLS connection format, applies the checkout's additive schema and refuses to overwrite an existing owner. It accepts exactly ten digits or a password of at least twelve characters containing a non-digit, up to 128 characters. A longer passphrase offers more entropy. If setup reports failure, do not reset tables or expose values; investigate the sanitized result. Schema application may have succeeded even if owner creation did not.

6. If configuration changes require a redeployment, obtain that approval separately and preserve all execution-off settings. Verify production sign-in, refresh/reload, sign-out and denial of unauthenticated private reads. Confirm the dashboard still reports live execution blocked and that no provider/scheduler work starts.

Owner authentication does not need hosted generation to be enabled. No model key is required for this checklist. Real network PostgreSQL multi-instance behavior and any future paid generation remain separate verification/approval steps.
