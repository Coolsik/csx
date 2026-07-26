# Code Review: CSX lifecycle, state, diagnostics, and migration

## Evidence Revision

R015

## Findings

- Severity: HIGH
  Classification: accepted-scope defect
  Location: `lib/install.js:384`, `lib/transaction.js:1061`
  Issue: Historical discovery verifies the exact registered tuple, but transaction declaration later pins only the receipt snapshot. Config or payload drift between those points can become an authorized preimage and be overwritten or removed.
  Recommendation: Revalidate every bounded no-follow historical preimage under the held transaction authority and add a zero-mutation race test.

- Severity: HIGH
  Classification: accepted-scope defect
  Location: `lib/install.js:60`, `lib/install.js:1071`, `lib/transaction.js:668`, `lib/transaction.js:1211`
  Issue: A historical multi-participant v3 bundle cannot be recovered through normal install/setup re-entry because recovery runs before historical participants are reconstructed and supplies only canonical caller authority. Exact H21 forced-exit reproduction returns `recovery_required` in an all-preimage state.
  Recommendation: Reconstruct complete authority from code-validated bundle preimages and canonical layouts without trusting the bundle alone; add install/uninstall re-entry tests after bundle publication and before all-final cleanup.

- Severity: MEDIUM
  Classification: accepted-scope defect
  Location: `payload/hooks/csx-hook.mjs:193`
  Issue: A valid SubagentStop payload with nullable `last_assistant_message` produces no base event.
  Recommendation: Accept `null`, emit the base event, and parse trailer fields only for strings.

- Severity: MEDIUM
  Classification: accepted-scope defect
  Location: `payload/hooks/csx-hook.mjs:114`, `lib/local-diagnostics.js:194`
  Issue: Receipt and hook both missing are treated as project authority absent even if the managed config block remains, allowing unsafe global fallback.
  Recommendation: Safely inspect bounded project config markers before declaring absence; classify residue as unsafe and test restore plus diagnostics suppression.

- Severity: MEDIUM
  Classification: accepted-scope compatibility risk
  Location: `lib/workflow-state.js:62`, `lib/project-context.js:29`, two canonical workflow skills
  Issue: Implicit non-Git workflow state requests cannot prove the installed project root, so advertised non-Git projects cannot publish state, restore, or produce diagnostics.
  Recommendation: Apply exact project-receipt ancestor proof to workflow-state root resolution or pass an explicit canonical project root, then add installed non-Git end-to-end coverage.

## Verification Reviewed

- `npm test`: 250 passed, 0 failed, 2 existing Windows skips
- `npm run check`: passed
- `npm pack --dry-run --json`: 40 entries
- `git diff --check`: passed
- transaction v3 targeted: 7 passed
- diagnostics crash/concurrency targeted: 4 passed
- Architect reproduced historical H21 forced-exit re-entry failure at R015

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

Accepted non-goals remain unchanged: mixed current/old-version mutation concurrency, unowned old plugins, remote/background diagnostics, WAL, exact disk accounting, complete free-text sanitization, and non-Linux durability parity.
