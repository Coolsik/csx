# Code Review: CSX lifecycle, state, diagnostics, and migration

## Evidence Revision

R018

## Findings

- Severity: HIGH
  Classification: accepted-scope defect
  Location: `lib/install.js:69`, `lib/install.js:131`, `lib/transaction.js:297`
  Issue: Supported same-root historical upgrades produce an `existing-installation-target` plus metadata expansion, while recovery requires a `historical-installation-target`. Valid all-preimage and all-final same-root bundles remain stuck with `recovery_required`.
  Recommendation: Validate both code-owned recovery topologies explicitly and add same-root H21/H23 all-preimage/all-final public re-entry tests.

- Severity: HIGH
  Classification: change-induced safety/regression
  Location: `lib/transaction.js:302`, `lib/transaction.js:310`, `lib/transaction.js:320`
  Issue: A re-signed bundle can add an arbitrary in-root metadata participant that is converted directly into caller authority and cleaned up.
  Recommendation: Permit metadata only as the exact same-root canonical expansion difference, and reject any other metadata participant, path, write, or final-endpoint topology without cleanup.

- Severity: HIGH
  Classification: change-induced safety/regression
  Location: `lib/install.js:174`, `lib/install.js:193`
  Issue: After an all-final project uninstall bundle is recovered, the command loses the completed project operation and continues to global fallback, deleting a coexisting global installation.
  Recommendation: Preserve the recovered operation/scope result and return project completion before global candidate selection.

- Severity: MEDIUM
  Classification: accepted-scope defect
  Location: `lib/project-context.js:33`, `lib/workflow-state.js:62`
  Issue: Git root resolution returns before installation-authority classification, so managed-config residue still permits workflow state begin/read/write.
  Recommendation: Classify the Git top-level and reject `unsafe` authority for workflow state operations while retaining valid and truly absent roots.

- Severity: LOW
  Classification: optional hardening
  Location: `lib/historical-installations.js:325`, `lib/historical-installations.js:331`
  Issue: Historical snapshot reads are no-follow but not byte-bounded before whole-file allocation.
  Recommendation: Add per-file descriptor size caps or bounded streaming in a future hardening pass.

## Verification Reviewed

- R018 `npm test`: 270 passed, 0 failed, 2 existing Windows skips
- syntax, 40-entry package dry-run, and diff checks passed
- transaction v3: 7 passed
- diagnostics crash/concurrency: 2 passed
- R015 finding focus: 20 passed
- Reviewers independently reproduced all four blocking cross-path scenarios

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

Optional hardening: bound historical preimage reads before whole-file allocation. Accepted non-goals remain mixed-version concurrency, unowned old plugins, remote/background/WAL, exact disk accounting, complete free-text sanitization, and non-Linux durability parity.
