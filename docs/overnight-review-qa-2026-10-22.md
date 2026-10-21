# Review usability and workflow corrections

## Scope
- Preserve unsaved text per artifact when switching the revision editor.
- Reconcile a one-artifact save against its exact returned revision ID and version. Retain drafts on failed requests, failed refreshes and external changes; require explicit comparison before rebasing.
- Explain missing revision notes beside Save; distinguish saved and unsaved roles; keep factual review and content approval separate.
- Supply the Critic with verified current artifact hashes and bounded UTF-16 sentence ranges. Reject corrupt artifacts before another provider call.
- Route the Instagram/Facebook callback to Connections and expose the existing explicit publication rescheduling API with fresh approval required.
- Distinguish runtime permission checks from hosted drafting being switched off and from a worker actually running.

## Verification
- Workspace-wide TypeScript, ESLint and production build passed.
- Full serial TypeScript run: 395 tests passed; the calendar test process encountered a native Node/V8 WebAssembly allocation crash after three passing cases. The unchanged calendar test file passed all five cases on isolated rerun. No application assertion failed in that run.
- Final editor regression suite: 9/9 passed, including an independently identified in-flight revert after an unverified save response.
- Critic-context and adjacent workflow suites: 51/51 passed.
- Publication controls, callback routing and adjacent publication suites: 31/31 passed.
- Manual cumulative revision and evidence-review suites: 30/30 passed. Five one-role saves produced six persisted revisions including the initial manual copy, preserved earlier edits after reopening storage, and recomputed current rather than historical flags.
- Readiness presentation tests: 4/4 passed.
- Independent review identified the editor edge case above; it was corrected and rechecked.

## Limits
- Tests use disposable local databases and mocked external providers. They do not certify the owner's live draft, prove the owner's attempted saves, or authorize content approval/publication.
- Rendered-browser interaction and screenshots could not be completed in the cloud execution environment. Chromium launch was restricted, the supported browser could not reach executor loopback, and its URL policy rejected local-file navigation. No policy bypass was attempted.
- Unsaved editor drafts are memory-only. The UI warns to save before leaving the screen, signing out or reloading the browser.
- No production database migration, saved-content update, source clearance, provider call, account connection, scheduler activation or publishing occurs as part of this code correction.
- The Critic's small-source fixture adds 2,028 bytes across six prompts (approximately $0.000811 extra conservative input reservation at the fixture rate). This is not measured billed usage. Existing call count, output limits, input caps and spending guards are unchanged.
