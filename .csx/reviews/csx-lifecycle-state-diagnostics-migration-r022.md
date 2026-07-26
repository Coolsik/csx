# Code Review: CSX lifecycle, state, diagnostics, and migration

## Evidence Revision

R022

## Findings

- Severity: HIGH
  Classification: accepted-scope defect
  Location: `lib/install.js:1146`, `lib/install.js:1163`
  Issue: `isCompletedUninstallRecovery()` accepts a top-level `operation: "uninstall"` and `boundary: "all-final"` before rejecting a simultaneous `transactions` array with multiple outcomes. An injected detailed adapter can therefore return a completed top-level summary plus two conflicting outcomes and make public `uninstall()` return project success instead of `recovery_required`.
  Recommendation: validate the detailed result as an exclusive or normalized discriminated union. Reject multiple transactions before any top-level completion decision; if one transaction and a top-level summary coexist, require their operation and boundary to match exactly. Add a public-path regression test for the combined result shape.

## Verification Reviewed

- Independent mandatory scenarios passed: honest all-final current project uninstall preserves global; operation-only re-sign is rejected; operation plus canonical receipt endpoint re-sign is rejected; legacy two-method adapter with recovered project IDs fails closed; clean legacy `[]` permits global fallback; transactions-only multiple outcomes fail closed.
- Independent combined-shape reproduction failed closedness: top-level uninstall/all-final plus two transaction outcomes returned `{removed:true, scope:"project"}` rather than `recovery_required`.
- `npm test`: 291 passed, 0 failed, 2 Windows skips.
- `npm run check`: passed.
- `npm pack --dry-run --json`: 40 entries.
- transaction v3 selection: 7 passed.
- diagnostics crash/concurrency selection: 2 passed.
- focused current uninstall, authority, legacy, multiple-outcome, and F006–F009 selection: 17 passed.
- `git diff --check`: passed.

## Independent Review

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`

## Verdict

REQUEST CHANGES

## Residual Risk

AC11 remains incomplete at the optional detailed-adapter result boundary. The historical whole-file read lacks a separate byte cap, but both lanes classified that as optional hardening rather than a release blocker.
