# Reproducible completion smoke test

The reporting UI at commit `64a1f3de024613f21077a5510709c5e5641138ab` passed isolated desktop/mobile browser QA on 2026-10-14. Merged main `636dc80c3e42db999ebe6abfcd48909c50b2e2f6` has the same file tree. The desktop run required test-only fixes to exact dropdown-label selectors; no application code changed.

Native select accessible names can include nested option text. The committed runner now uses the `combobox` role with the stable `Record type`, `Currency` and `Usage window` label prefixes. It keeps Playwright's strict uniqueness and does not select dropdowns by position. A Node regression test checks these selectors against the actual components' rendered markup. That test does not replace browser QA.

## Run on an approved browser-capable computer

Use the approved checkout with its existing dependencies and an available installed browser. Do not run this against production or point it at an existing database.

```text
npm run build
node --import tsx scripts/completion-qa.ts --edge
```

`--edge` uses installed Microsoft Edge on Windows. On a system with the package's approved Playwright Chromium already installed, omit `--edge`. `--system-chromium` is only for a supported Linux environment with `/usr/bin/chromium`; it does not remove environment access restrictions. Do not use tunnels or change browser security to work around a denied launch.

The runner starts its own server at `http://127.0.0.1:3113` and creates a temporary database with a dummy owner/password and clearly isolated QA records. It does not inherit provider credentials, use a remote database or invoke providers. It checks reporting empty/zero/unknown states, precise snapshot correction/history, coverage invalidation, void cancel/confirm, currency separation, mobile overflow, agent usage inspection, reload and sign-out. The server and temporary database are removed in `finally`.

Successful runs write test-fixture screenshots to `artifacts/completion-analytics-qa.png`, `artifacts/completion-mobile-qa.png` and `artifacts/completion-usage-qa.png`. These contain synthetic QA records, never evidence of real user metrics. Review `git status` before committing generated artifacts.

## Evidence and limits

The recorded 2026-10-14 desktop run also passed a separate supplemental suite for month/lifetime usage, carried reservations, cost-basis/invoice overlap, platform completeness/latest-revision status, and interrupted/repeated saves without duplicates. Those supplemental assertions are not all part of this committed smoke runner; equivalent backend regressions remain in the TypeScript suite.

The cloud environment's earlier Chromium launch failed with `socket() Operation not permitted`. This maintenance change has source/markup regression coverage; it does not claim a fresh cloud browser pass. Real hosted database connectivity, production owner setup and deployed authentication/reporting remain separate checks.
