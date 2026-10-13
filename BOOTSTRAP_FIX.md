# Local bootstrap 403 - 10 October 2026

The first user-operated key-entry session reached readiness, then POST /api/studio/source returned 403. The same failure was reproduced against the compiled app using only an isolated test token and database. No live key, token, environment or terminal history was inspected.

Next.js NextURL normalizes the internal request URL from 127.0.0.1 to localhost. The launcher correctly supplied Origin http://127.0.0.1:3000, but the original guard also compared that value against the normalized internal URL and rejected it.

The guard now recognizes only that internal loopback rewrite when the incoming Host and Origin exactly match the configured origin and the internal URL protocol/port also match. Wrong Origin, Host, protocol and port remain rejected; authentication is unchanged. Every launcher start generates a fresh random owner token; previous tokens are not stored and fail against the new session. Stopping the server removes its listening endpoint; a browser sign-out alone does not revoke the server token.

The live local database was copied to an isolated temporary directory and only aggregate counts were queried. Sources, tasks, outputs, events, ledger and approvals were all zero. Source creation failed before task queuing and before the launcher could start its worker; this app made no provider call in that attempt. The original database was not changed.

Regression coverage includes a real NextRequest normalization test, rejection cases and previous-session token rejection. npm run qa:bootstrap runs the exact preparePilot request headers against a compiled isolated server. Only readiness is mocked; source, run and blocked step use the real routes. The test has no credentials, no worker and no provider calls. Fixture source/task records stay in the isolated directory and are removed afterwards.

After verification, the user can rerun python .\scripts\secure_start.py from this repository in their own interactive PowerShell, enter the key only at the hidden prompt, and use the newly printed owner token on the laptop-only sign-in page. No credentials were entered and no live launcher was restarted by the agent during this fix.
