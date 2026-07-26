# Code Review: CSX lifecycle, state, diagnostics, and migration

## Evidence Revision

R021

## Findings

- Severity: HIGH
  Classification: change-induced safety/regression
  Location: `lib/transaction.js:225`, `lib/transaction.js:445`, `lib/transaction.js:513`, `lib/install.js:181`
  Issue: The detailed recovery operation comes from a self-hashed authority bundle but is not independently bound to caller recovery authority or operation-specific endpoint meaning. Re-signing an all-final project-uninstall bundle with `operation: "install"` passes current authorization, suppresses project completion, and causes removal of a coexisting global installation.
  Recommendation: Bind expected operation and operation-specific final endpoint invariants into caller recovery authority, reject re-signed operation or endpoint changes with `recovery_required`, preserve the bundle and all global bytes, and expose detailed results only after this validation.

- Severity: HIGH
  Classification: change-induced safety/regression
  Location: `lib/install.js:1100`, `lib/install.js:1135`, `lib/install.js:1146`
  Issue: A valid injected adapter implementing the existing required `{beginTransaction,recoverTransactions}` interface cannot return detailed completion. After it recovers a current project all-final uninstall, the adapter path still falls through and removes a coexisting global installation.
  Recommendation: Keep the two-method compatibility contract, but if a legacy adapter actually recovers project control state without authenticated detail, prevent project-to-global selection and fail closed or require package-internal authenticated classification.

- Severity: LOW
  Classification: optional hardening
  Location: `lib/historical-installations.js:325`
  Issue: Historical candidates are not byte-bounded before whole-file allocation.
  Recommendation: Add bounded descriptor reads in a future hardening change.

## Verification Reviewed

- R021 targeted/deslop union: 102 passed before and after
- `npm test`: 287 passed, 0 failed, 2 existing Windows skips
- `npm run check`: passed
- `npm pack --dry-run --json`: 40 entries
- transaction v3: 7/7 passed
- bounded diagnostics: 2/2 passed
- current uninstall plus prior finding selection: 13/13 passed
- `git diff --check`: passed

Both reviewers independently reproduced operation re-signing followed by destructive global fallthrough. Architect additionally reproduced the same fallthrough through the existing injected adapter interface.

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

F001–F007 and F009 remain resolved. F008 is fixed only for the honest default detailed-recovery path and remains open for re-signed operation authority and injected legacy adapters.

Accepted non-goals remain unchanged. Historical whole-file byte bounding remains optional hardening.
