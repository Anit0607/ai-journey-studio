# Exact owner-triggered publication

This change adds a manual delivery mode to publication plans. It does not enable publishing, create credentials, provision a scheduler, make a live post, or authorize anyone to publish for the owner.

## Owner workflow

1. Complete source clearance, evidence review and exact final-content approval as before.
2. Stage a publication plan with its exact account, text/media, time and an explicitly selected delivery method. The existing default is **Authorized scheduler**. Choose **Manual, owner-triggered only** for one owner-triggered delivery.
3. Review the saved plan and accept its mode-specific acknowledgement. Staging and content approval do not authorize publication.
4. For a manual plan, return within its approved time window. The default window is the scheduled time through five minutes afterward. Future and missed plans cannot be sent by clicking early or late.
5. If every server-side gate is satisfied, the plan displays a separate unchecked acknowledgement and **Publish this exact approved plan now**. Review the visible text, media, account, exact version and time before deliberately confirming that action.
6. Inspect the resulting saved status and official provider receipt. An uncertain result must not be replayed. This change does not add reconciliation or recovery controls.

The person operating the UI still needs authority to send the specific post. An assistant cannot convert implementation permission or permission to connect an account into permission to publish content, and cannot manufacture owner approval by checking the controls itself.

Manual delivery has no background wakeup and no guarantee the owner will be present. Missing the approved window requires an explicit reschedule and fresh approval. Changing the delivery mode, destination, text/media or time also creates a new exact version and returns the plan to staged status.

## Safety boundaries

- The existing server `publishing.enabled` and `credential_use_authorized` gates remain required and default off. Account identity, current connection authorization, scopes, source clearance, source version, exact final artifacts, evidence decisions, immutable media and any X budget authorization remain required.
- Only scheduled plans may be selected by scheduled dispatch. Scheduled plans still require the independently authorized, sufficiently frequent scheduler. Manual mode does not pretend a scheduler exists or weaken its checks.
- The owner-session and same-origin-protected POST action `publication-publish` accepts only `id`, `expected_version`, `expected_account_id`, and a boolean `acknowledged: true`. It never accepts a payload, destination override, credential, runtime or transport from request JSON.
- The requested ID is locked and claimed atomically. There is no "next due job" fallback. The exact approval acknowledgement is checked both before claiming and immediately before each provider request, alongside current source/evidence/account/time gates.
- Manual invocation has a 150-second abort signal; every official adapter request retains its 30-second deadline and rejects redirects. A claim, terminal state or uncertain result cannot be replayed through the manual action. Frontend submission is single-flight and requires a new reviewed state after an attempt.
- Provider transport failures and unverifiable receipts remain uncertain with redacted, durable attempt records. No automatic retry or uncertain reconciliation is introduced.
- No model-generation path, source permission, model budget, provider account setup or OAuth permission is changed.

## Storage compatibility

Additive migration 020 adds `delivery_mode` with the existing behavior, `scheduled`, as its database default and constrains it to `scheduled` or `manual`. Migration SQL is identical for embedded PGlite and PostgreSQL and is idempotent.

Existing scheduled intent hashes and acknowledgement text retain their schema-1 bytes. Manual intents use schema 2 with an explicit mode field and their own acknowledgement. Existing approvals are neither reinterpreted nor rewritten. Revising between modes creates a different hash and a fresh staged version. Historical immutable approval records remain intact.

## Verification

All provider success, rejection, timeout and uncertainty tests use injected mocked transports and disposable databases. They do not demonstrate live social-provider connectivity or a real published post. See the implementation report for exact completed checks and remaining environment limits.
