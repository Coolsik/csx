# Code Review: CSX lifecycle, state, diagnostics, and migration

## Evidence Revision

R020

## Findings

- Severity: HIGH
  Classification: change-induced safety/regression
  Location: `lib/install.js:174`, `lib/install.js:180`, `lib/install.js:201`, `lib/transaction.js:263`
  Issue: A current-version project uninstall interrupted at the all-final authority-bundle boundary loses the completed project operation when normal transaction recovery returns only transaction IDs. Re-entry then falls through to a coexisting global installation and removes it. Independent reproduction exited the worker at 82, began with the global receipt present, returned `scope: "global"`, and removed that receipt.
  Recommendation: Return the v3 operation and boundary classified under lock from normal recovery, treat canonical project-uninstall/all-final as completed before global candidate selection, and add a current-version project/global coexistence all-final re-entry integration test.

- Severity: LOW
  Classification: optional hardening
  Location: `lib/historical-installations.js:325`
  Issue: Historical candidates are opened with no-follow protection but are not byte-bounded before whole-file allocation.
  Recommendation: Add a descriptor size cap or bounded streaming read in a future hardening change.

## Verification Reviewed

- Targeted union: 182 passed, 0 failed, 1 existing Windows skip
- `npm test`: 286 passed, 0 failed, 2 existing Windows skips
- `npm run check`: passed
- `npm pack --dry-run --json`: passed, 40 entries
- transaction v3 selection: 7/7 passed
- bounded diagnostics crash/concurrency selection: 2/2 passed
- F006–F009 focused selection: 12/12 passed
- `git diff --check`: passed
- Architect independent focused boundary selection: 25/25 passed

The accepted verification did not include the canonical current-v3 project-uninstall all-final re-entry with a coexisting global installation. The Code Reviewer independently reproduced destructive global fallthrough in that scenario.

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: CLEAR

Architect found no blocking boundary defect in its inspected scenarios and confirmed the six requested audits plus F001–F009. Its only concern was the same optional historical read-size hardening. The Code Reviewer's additional current-version crash scenario supersedes the earlier F008 resolution claim.

## Verdict

REQUEST CHANGES

## Residual Risk

The release-blocking residual is canonical current-v3 project-uninstall all-final re-entry selecting and deleting a coexisting global installation.

Accepted non-goals remain mixed old/current concurrency, unowned plugins, remote/background/WAL, exact diagnostic accounting, complete `failure_detail` sanitization, and non-Linux durability parity. Historical whole-file byte bounding remains optional hardening.
