# Owner password login — WIP, not activated

Better Auth 1.7.7 owns password verification and cookie sessions. The app uses its existing SQL connection through a scoped adapter. Passwords use the library's salted, native scrypt hash; no password is stored in browser storage, command arguments, files, logs or database plaintext. Password input is sent to the same-origin server over HTTPS in hosted mode. A ten-digit numeric password is accepted; a longer passphrase has more entropy. Sessions expire after eight hours; logout revokes the server session. Cookie caching is off, and cookies are HttpOnly/SameSite Strict, Secure on hosted HTTPS.

Public signup, password setup and reset endpoints are unavailable. Only one fixed owner ID is permitted by the schema. Every login attempt consumes the same global SQL row under a transaction/row lock: five attempts per fifteen minutes, including correct attempts, across IPs and instances. Restarts do not clear this guard. Better Auth also uses database-backed rate limits. Missing database, signing secret, authorized hosted owner configuration or account means setup missing, never first-visitor registration.

## Owner-controlled setup after independent review and action-time approval

Do not run this during code review. No production migration or credential setup has been performed.

The owner can run one command from the approved checkout (new installations/workspaces belong on D or E; do not move the existing checkout/data without coordination):

```text
python scripts/set_owner_password.py --owner-setup-authorized --remote --migrate-authorized
```

The owner privately obtains the connection string from their authenticated Neon project, then pastes it into the hidden console prompt. The script does not obtain it from chat, pull Vercel secrets or save a .env file. It next asks for the chosen password twice through hidden input. Both values travel to a local child over a private stdin pipe; inherited API keys/config/proxy values are excluded. The approved remote mode accepts an encrypted Neon PostgreSQL connection, requires certificate verification, applies additive application schema migrations transactionally, then creates the owner/hash transactionally. Existing owner accounts are never overwritten. Errors are generic; connection/password values are not printed. Schema application and account creation are separate transactions: after a creation failure, schema may already be present and setup can be retried safely if no owner exists.

Local setup uses the same command without `--remote --migrate-authorized`, while the local app/worker are stopped. No provider key is needed. Local launcher compatibility retains a strong internal worker credential; the browser uses the owner password and cookies. Local signing changes with the launcher session unless a separately approved signing secret is supplied, so users sign in again after restart.

## Minimal Production configuration, only after approval

- Existing encrypted `DATABASE_URL` from the approved Neon integration; never put its value in chat. `DATABASE_URL_UNPOOLED` is not required by runtime auth.
- Nonsecret `STUDIO_DATABASE_AUTHORIZED=1` and `STUDIO_ORIGIN` equal to the exact canonical HTTPS production origin, without trailing slash/path.
- Nonsecret `STUDIO_RUNTIME_CONFIG` with `hosted.owner_auth_authorized=true`; hosted generation, cron and persistent model-key permission remain false/unset. Other existing budget/source fields are preserved.
- One strong, distinct, server-only `STUDIO_AUTH_SECRET` of at least 32 printable characters, supplied by the owner through approved Vercel secret configuration. This is not the ten-digit password and must never match a cron credential. The code task does not generate/upload it.
- The owner password is entered only into the hidden setup prompt, stored only as a salted hash, then entered into the app's password field at login. It is never a Vercel variable or bearer credential.

Leave provider keys, `STUDIO_HOSTED_ENABLED` and `CRON_SECRET` unset/disabled. The reviewed `vercel.json` selects Singapore `sin1`, matching the Neon region, and defines no cron schedule. No merge or deployment is authorized by this PR.

Verification is incomplete at this WIP checkpoint. Focused auth tests passed; the full suite had one failure still being investigated. Rendered browser QA and actual multi-instance network PostgreSQL behavior remain unverified. No live database, credentials, model calls or production settings were exercised.

Sources: [Better Auth passwords](https://better-auth.com/docs/authentication/email-password), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [adapter contract](https://better-auth.com/docs/guides/create-a-db-adapter), [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region).
