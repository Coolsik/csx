# Goal: CSX lifecycle, state, diagnostics, and migration

## Objective and Accepted Boundaries

Implement approved pro plan `draft_version: 3`: remove prompt routing; restore only `csx-plan-pro` and `csx-start-goal`; add bounded local diagnostics; migrate only exact receipt-owned historical installations; add transaction v3 recovery. Mixed current/old-version mutation concurrency, unowned old plugins, remote telemetry, WAL, exact diagnostic accounting, complete free-text sanitization, and non-Linux durability parity are out of scope.

## Current Revision

Current: R027
Latest cause: G002-RV3G historical recovery producer authenticity
Changed paths: `lib/install.js`, `test/install.test.js`
Invalidated current evidence: R026 cumulative verification and review; historical producer authority evidence superseded by R027 targeted results

## Success Criteria

- [x] AC1: Installed/upgraded config has no `UserPromptSubmit` routing.
  - Evidence: hook/install tests and managed-config inspection.
- [x] AC2: Canonical root is per linked worktree; common Git dir is unused.
  - Evidence: project-context tests.
- [x] AC3: Only valid active state for the two workflows restores once.
  - Evidence: hook/state and project/global precedence tests.
- [x] AC4: Stale workflow tokens cannot change current state.
  - Evidence: workflow CLI CAS tests.
- [x] AC5: Diagnostics require valid state and receipt-owned allowlisted agent; raw content/IDs are absent.
  - Evidence: hook/diagnostics schema tests.
- [x] AC6: Trailer parsing obeys final-line, byte-cap, and per-field fallback rules.
  - Evidence: parser corpus.
- [x] AC7: All diagnostic logical content, including crash residue, is at most 9,699,328 bytes.
  - Evidence: crash/concurrency namespace tests and arithmetic assertion.
- [x] AC8: Only seven exact H21/H23/H22 historical fixture families gain ownership.
  - Evidence: registry positive/negative fixtures.
- [x] AC9: Unsupported or unsafe receipts stop before mutation and preserve user files.
  - Evidence: install/uninstall negative integration tests.
- [x] AC10: Setup migration gate runs before catalog/TUI.
  - Evidence: setup dependency-spy tests.
- [x] AC11: Transaction v3 topology is identical across declaration, bundle, recovery, receipt, and adapter.
  - Evidence: transaction/install multi-participant tests.
- [x] AC12: Authority bundle is durable before journal/mutation and removed last.
  - Evidence: transaction forced-failure tests.
- [x] AC13: Unsafe replica or bundle-less nonterminal state performs no target write and returns `recovery_required`.
  - Evidence: transaction recovery state-table tests.
- [x] AC14: Mixed old-version concurrency remains explicitly unsupported with no compatibility mechanism added.
  - Evidence: source/docs inspection.
- [x] AC15: Linux full suite, checks, package dry-run, and bounded crash tests pass.
  - Evidence: final cumulative commands on unchanged revision.

## Execution Goals

### G001: Transaction v3 immutable authority bundle
- Dependencies: none
- Owner: csx-executor
- Files: `lib/transaction.js`, `test/transaction.test.js`
- Criteria: AC11–AC13
- Verification: `node --test test/transaction.test.js`
- Stop conditions: no ambiguous recovery writes; no ownership overlap
- Status: complete
- Current evidence: R022 re-sign/legacy/multiple selection 8 passed; transaction v3 7 passed; install/transaction union 106 passed
- Deslop: R022 exact union before/after 106 passed, 0 failed, 0 skipped; cleaned duplicate retryable-authority checks

### G002: v3 callers and adapter topology
- Dependencies: G001
- Owner: csx-executor
- Files: `lib/installation-state.js`, `lib/install.js`, `lib/setup.js`, related tests
- Criteria: AC11
- Verification: install/setup targeted tests
- Stop conditions: caller topology must match transaction authority
- Status: complete
- Current evidence: R027 injected historical producer impersonation reproduced independently by both R026 reviewers; trusted-producer regression 1 passed; related public recovery selection 15 passed; install/transaction union 113 passed
- Deslop: R027 exact install/transaction union before and after no-op review — 113 passed, 0 failed, 0 skipped

### G003: Worktree context and seven-family registry
- Dependencies: G002
- Owner: csx-executor
- Files: new context/registry modules and fixtures/tests
- Criteria: AC2, AC8
- Verification: context/registry targeted tests
- Stop conditions: no heuristic ownership or ambiguous fixture
- Status: complete
- Current evidence: R020 state/CLI/non-Git union before and after deslop — 43 passed, 0 failed
- Deslop: R020 union passed; duplicate safe-context resolution consolidated

### G004: Historical migration and setup gate
- Dependencies: G003
- Owner: csx-executor
- Files: install/setup modules and tests
- Criteria: AC8–AC11
- Verification: install/setup/setup-command targeted tests
- Stop conditions: unsupported receipt must remain no-write
- Status: complete
- Current evidence: R019 same-root H21/H23 all-pre/all-final, four metadata attacks, global coexistence uninstall, pre-catalog recovery; union 139 passed, 1 skip
- Deslop: R019 union passed/no-op

### G005: Lifecycle state and token CAS
- Dependencies: G004
- Owner: csx-executor
- Files: workflow-state module, CLI, two skills, state/CLI/contract tests
- Criteria: AC3–AC4
- Verification: state/CLI/skill targeted tests
- Stop conditions: stale token must preserve current state
- Status: complete
- Current evidence: R020 state/CLI/non-Git union before and after deslop — 43 passed, 0 failed; core state subset 29 passed
- Deslop: R020 union passed; duplicate safe-context resolution consolidated

### G006: Self-contained lifecycle hook and routing removal
- Dependencies: G005
- Owner: csx-executor
- Files: installed hook, installer, hook/install tests
- Criteria: AC1, AC3
- Verification: hook/lifecycle/install targeted tests
- Stop conditions: no package-relative imports or duplicate restore
- Status: complete
- Current evidence: R017 union — 81 passed; self-contained classifier parity and nullable event tests passed
- Deslop: R017 union passed/cleaned

### G007: Project-over-global restore precedence
- Dependencies: G006
- Owner: csx-executor
- Files: `lib/install.js`, installed hook, install/lifecycle tests, new precedence tests
- Criteria: AC2–AC3
- Verification: precedence integration tests
- Stop conditions: no malformed-project fallback or worktree leak
- Status: complete
- Current evidence: R017 union — 81 passed; managed-config residue fail-closed and clean uninstall fallback E2E passed
- Authority contract: exact operation plus `--authority-scope <project|global> --authority-root <absolute-install-root>`; receipt-owned running hook proof required
- Evidence superseded: G004/G006 managed-config, receipt-owned hook, uninstall, lifecycle validation, and prior install/hook deslop evidence
- Deslop: superseded by R017 union passed/cleaned

### G008: Bounded local diagnostics
- Dependencies: G007
- Owner: csx-executor
- Files: new diagnostics library, CLI, installed hook, two workflow skills, all receipt-owned agent TOMLs, focused fixtures/tests
- Criteria: AC5–AC7
- Verification: diagnostics targeted tests
- Stop conditions: fixed namespace only; no raw data
- Status: complete
- Current evidence: R017 union — 81 passed; cap regression 2 passed; nullable base event/non-Git/read-fallback E2E passed
- Implementation correction: 1/1
- Baseline: R012 authority argv and project-over-global precedence must remain unchanged
- Namespace bound: `2304 * 4096 + 64 * 4096 + 64 * 0 = 9,699,328`
- Crash/concurrency evidence: 24 workers, deterministic temp/reservation crash residue, 64 stranded reservations, 2,304 final saturation, unsafe fixed slots, exact namespace cap
- Deslop: R017 union passed/cleaned; hook/library oversize parity aligned

### G009: Documentation and packaging
- Dependencies: G008
- Owner: csx-executor
- Files: `README.md`, package manifests, CLI usage text, new package dry-run contract test
- Criteria: AC1, AC14
- Verification: syntax check and contract inspection
- Stop conditions: no publish/version decision
- Status: complete
- Current evidence: R014 before/after docs/package lock — 23 passed, 0 failed; `npm run check` exit 0; pack dry-run 40 entries; diff and README contract checks passed
- Implementation correction: 0/1
- Baseline: R013 product behavior is fixed; documentation/package surface only
- Version/dependencies: version `0.1.0`, dependency graph, publish settings unchanged
- Deslop: passed/cleaned; documentation terminology only

### G010: Final cumulative Linux verification
- Dependencies: G001–G009 ready_for_review
- Owner: root verification
- Files: none
- Criteria: AC1–AC15
- Verification: `npm test`, `npm run check`, `npm pack --dry-run`, bounded crash tests, `git diff --check`
- Stop conditions: no code changes during verification
- Status: complete
- Current evidence: unchanged R027 — full suite 298 passed with 2 existing Windows skips; syntax check passed; package dry-run contained 40 entries; transaction v3 7 passed; bounded diagnostics 2 passed; focused recovery/worktree regression 24 passed; diff check passed
- Verification iterations: 3/3
- Goal-continuation override: one additional unchanged-revision cumulative run authorized after the R018 fixture-only repair
- Same-failure repairs: diagnostics crash/concurrency evidence 1/2
- Deslop: not applicable

## Boundary Review

Reused approved plan Architect result: `draft_version: 3`, `verdict: CLEAR`.

## Final Verification

Iteration 1 stopped at R014 after evidence audit: commands passed, but `test/fixtures/diagnostics-writer-worker.js` was only auto-discovered with missing argv and emitted a module error payload; no test invoked it to prove concurrent writers, abrupt death residue, fixed 64-slot saturation, or drop behavior. G008 correction 1/1 resolved this at R015.

Iteration 2 passed at unchanged R015:

- `npm test`: 250 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries, no tarball created
- `node --test --test-name-pattern='^v3 ' test/transaction.test.js`: 7 passed
- bounded diagnostics crash/concurrency selection: 4 passed
- `git diff --check`: exit 0

Iteration 3 at R017 ran the full suite after all review findings were repaired. Product and integration scenarios passed, but the newly added `test/fixtures/historical-recovery-worker.js` failed only when auto-discovered without worker arguments:

- `npm test`: 269 passed, 1 fixture failure, 2 existing Windows skips
- historical recovery, non-Git lifecycle, nullable diagnostics, residue precedence, transaction, and all other product tests passed

R018 repaired the fixture:

- argument-less fixture discovery: 1 passed; direct execution exit 0 with empty stdout/stderr
- explicit historical re-entry selection: 12 passed
- worker syntax and `git diff --check`: passed

The continued active goal authorized one unchanged-R018 cumulative override run:

- `npm test`: 270 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- diagnostics crash/concurrency selection: 2 passed
- R015 review-finding focused selection: 20 passed
- `git diff --check`: exit 0

R018 remained unchanged throughout the cumulative run.

R020 final targeted union passed before cumulative verification:

- transaction/install/setup/project-context/workflow-state/CLI/non-Git union: 182 passed, 0 failed, 1 existing Windows skip
- owned product syntax checks and `git diff --check`: passed
- R020 remained unchanged throughout the union

Final unchanged-R020 cumulative verification passed:

- `npm test`: 286 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- F006–F009 focused selection: 12 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

R021 G002-RV3A targeted and deslop evidence:

- current-version project/global all-final uninstall re-entry: 1 passed after reproducing 1 failure before implementation
- install suite: 67 passed
- transaction v3 selection: 7 passed
- install/transaction deslop union before and after: 102 passed, 0 failed, 0 skipped
- owned syntax checks and `git diff --check`: passed

Final unchanged-R021 cumulative verification passed:

- `npm test`: 287 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- current uninstall plus F006–F009 focused selection: 13 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

Cumulative review on unchanged R021:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r021.md`
- Blocking findings: re-signed bundle operation is not independently authorized; existing injected adapter can recover without detailed completion and still fall through to global removal
- Optional hardening: bounded historical whole-file reads

R022 G001/G002-RV3B targeted and deslop evidence:

- re-signed operation/endpoint, legacy adapter, and ambiguous outcome selection: 8 passed after 4 pre-fix failures
- honest current-version project/global all-final uninstall: 1 passed
- install suite: 71 passed
- transaction v3 selection: 7 passed
- install/transaction deslop union before and after: 106 passed, 0 failed, 0 skipped
- owned syntax checks and `git diff --check`: passed

Final unchanged-R022 cumulative verification passed:

- `npm test`: 291 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- current uninstall, authority re-signing, legacy adapter, ambiguous outcome, and F006–F009 focused selection: 17 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

Cumulative review on unchanged R022:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r022.md`
- Blocking finding: a detailed adapter result containing both a top-level uninstall/all-final summary and multiple transaction outcomes bypasses the multiple-outcome rejection and is reported as project success
- Required repair: reject multiple transactions before any top-level completion decision; normalize a single transaction plus top-level summary only when operation and boundary match exactly; add a combined-shape public uninstall regression
- Optional hardening: bounded historical whole-file reads

R023 G002-RV3C targeted and deslop evidence:

- combined top-level uninstall/all-final plus multiple transaction outcomes: 1 pre-fix failure reproduced; passes after repair
- combined top-level summary plus single detailed outcome: mismatch rejects, exact match succeeds
- current uninstall, authority re-signing, legacy adapter, and ambiguity focused selection: 6 passed
- install suite: 73 passed
- install/transaction exact deslop union before and after no-op review: 108 passed, 0 failed, 0 skipped
- owned syntax checks and `git diff --check`: passed

Final unchanged-R023 cumulative verification passed:

- `npm test`: 293 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- current uninstall, authority re-signing, legacy adapter, combined-result normalization, and F006–F009 focused selection: 19 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

Cumulative review on unchanged R023:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Blocking findings: non-empty recovered IDs with missing/empty outcomes could fall through to global removal; malformed transactions containers and invalid outcome types were not rejected as a closed result contract
- Required repair: closed normalization of clean, single authenticated, historical summary, and legacy results; opaque recovery scope guard; strict container/type/ID consistency; public global-preservation tests

R024 G002-RV3D targeted and deslop evidence:

- opaque recovered IDs and malformed result-shape selection: 2 pre-fix failures reproduced; 10 related public-path tests pass after repair
- install suite: 75 passed
- install/transaction exact deslop union before and after no-op review: 110 passed, 0 failed, 0 skipped
- closed parser validates recovered IDs, detail classification, transactions container, operation/boundary types, single outcome ID correspondence, and summary equality
- project and global candidate selection fail closed on opaque recovery without a remaining receipt
- owned syntax and `git diff --check` remain required in unchanged-R024 cumulative verification

Final unchanged-R024 cumulative verification passed:

- `npm test`: 295 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- current uninstall, authority re-signing, legacy adapter, combined/opaque/malformed result normalization, and F006–F009 focused selection: 21 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

Cumulative review on unchanged R024:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Blocking finding: top-only historical summary accepted zero or extra recovered IDs, allowing false project completion or global removal
- Required repair: own-property summary discrimination and exact one-recovered-ID cardinality for the single-bundle historical producer contract, with install/uninstall zero/extra-ID global-preservation tests

R025 G002-RV3E targeted and deslop evidence:

- top-only historical summary zero/extra recovered IDs across install/uninstall: 1 pre-fix test failure reproduced; all four negative cases pass after repair and preserve global receipt bytes
- related public recovery selection: 10 passed
- install/transaction exact deslop union before and after no-op review: 111 passed, 0 failed, 0 skipped
- explicit undefined summary fields are malformed because discrimination now uses own-property presence

Final unchanged-R025 cumulative verification passed:

- `npm test`: 296 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- current uninstall, authority re-signing, legacy adapter, combined/opaque/malformed/top-only result normalization, and F006–F009 focused selection: 22 passed
- `git diff --check`: exit 0
- no product or test file changed during verification

Cumulative review on unchanged R025:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Blocking findings: normal detailed and historical summary shared one boolean classification; sparse recovered arrays bypassed string validation; recovery operation/boundary claims were not checked against actual canonical receipt state before project/global scope selection
- Required repair: immutable internal provenance tag, dense recovered-ID validation, closed normal/historical shapes, and normal detailed receipt-endpoint coherence with project/global preservation tests

R026 G002-RV3F targeted and deslop evidence:

- malformed/provenance and receipt-endpoint selections: 2 pre-fix failures reproduced; 12 related public-path tests pass after repair
- install suite: 77 passed
- install/transaction exact deslop union before and after no-op review: 112 passed, 0 failed, 0 skipped
- internal recovery kinds are `legacy`, `normal-detailed`, and `historical-summary`; caller-returned fields cannot override the tag
- normal detailed requires an owned transactions array; historical summary forbids transactions and requires one dense recovered ID plus paired summary
- sparse recovered arrays are rejected; normal detailed install/all-final, uninstall/all-preimage, and uninstall/all-final claims are checked against canonical receipt presence before scope selection
- historical summary remains governed by independently verified registry/bundle endpoints rather than an invalid canonical-only receipt assumption

Final unchanged-R026 cumulative verification passed:

- `npm test`: 297 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- recovery provenance, dense-ID, receipt-endpoint, current uninstall, authority re-signing, legacy adapter, historical re-entry, worktree/Git authority focused selection: 23 passed
- `git diff --check`: exit 0
- no product or test file changed during cumulative verification

Cumulative review on unchanged R026:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Blocking finding: an injected `recoverHistoricalTransactions` producer could be internally tagged as a verified historical summary without registry/bundle proof and drive public uninstall into a wrong-scope global mutation
- Both lanes independently reproduced global receipt deletion through the public API
- Required repair: bind historical recovery provenance to the package-owned producer and preserve global bytes in a public regression

R027 G002-RV3G targeted and deslop evidence:

- injected historical producer is ignored; the package-owned registry/bundle verifier alone can produce a historical summary
- public uninstall rejects the forged producer path and preserves global receipt, config, and hook bytes
- trusted-producer regression: 1 passed
- related normal/legacy/historical public recovery selection: 15 passed
- install/transaction exact deslop union before and after no-op review: 113 passed, 0 failed, 0 skipped

Final unchanged-R027 cumulative verification passed:

- `npm test`: 298 passed, 0 failed, 2 existing Windows skips
- `npm run check`: exit 0
- `npm pack --dry-run --json`: exit 0, 40 entries
- transaction v3 selection: 7 passed
- bounded diagnostics crash/concurrency selection: 2 passed
- recovery producer authority, provenance, dense-ID, receipt-endpoint, current uninstall, re-signing, legacy/historical re-entry, and worktree/Git authority focused selection: 24 passed
- `git diff --check`: exit 0
- no product or test file changed during cumulative verification

## Review

Cumulative review iteration 1 at R015:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r015.md`
- Review iterations: 1/3
- Blocking findings: historical exact-tuple drift race; historical v3 normal re-entry authority failure; nullable SubagentStop base event; managed-config residue misclassified as absent
- Compatibility finding to resolve in the same bounded rework: non-Git installed project workflow-state root proof

### Review Finding Rework

- F001 historical exact-tuple drift race: repair 1/2, owner G004-RV1A, resolved at R016
- F002 historical v3 normal re-entry authority: repair 2/2; functional defect resolved at R016, fixture auto-discovery repair in progress
- F003 nullable SubagentStop base event: repair 1/2, owner G008-RV1B, resolved at R017
- F004 managed-config residue authority: repair 1/2, owner G008-RV1B, resolved at R017
- F005 non-Git installed state root proof: repair 1/2, owner G008-RV1B, resolved at R017
- Required order: G004-RV1A, then G008-RV1B, then cumulative verification iteration 3, then cumulative review iteration 2

Verification iteration 3 at R017 failed only because the new `test/fixtures/historical-recovery-worker.js` threw on argument-less `node --test` auto-discovery. G004-RV1A verification repair 2/2 is assigned to make the fixture inert without changing recovery behavior. No fourth cumulative full-suite run is permitted, so completion remains blocked after this targeted repair.

Cumulative review iteration 2 at unchanged R018:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `BLOCK`
- Composite: `REQUEST CHANGES`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r018.md`
- Review iterations: 2/3
- Blocking findings: same-root historical re-entry topology; arbitrary metadata participant authority; all-final project uninstall global fallthrough; Git-root managed-config residue workflow state
- Optional hardening: bounded historical whole-file reads

### Review Iteration 2 Rework

- F006 same-root historical recovery topology: repair 1/2, owner G004-RV2A, resolved at R019
- F007 arbitrary metadata authority expansion: repair 1/2, owner G004-RV2A, resolved at R019
- F008 all-final project uninstall global fallthrough: repair 1/2, owner G004-RV2A, resolved at R019
- F009 Git-root managed-config residue workflow state: repair 1/2, owner G005-RV2B, resolved at R020
- Required order: G004-RV2A, then G005-RV2B, final union, unchanged-revision cumulative verification, review iteration 3/3

Cumulative review iteration 3 at unchanged R020:

- csx-code-reviewer: `REQUEST CHANGES`
- csx-architect: `CLEAR`
- Composite: `REQUEST CHANGES`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r020.md`
- Review iterations: 3/3
- Blocking finding: canonical current-v3 project uninstall interrupted at all-final loses the completed project operation during normal recovery and falls through to remove a coexisting global installation
- Optional hardening: bounded historical whole-file reads

### Review Iteration 3 Finding

- F008 historical uninstall repair remains resolved, but the same completion-scope defect persists in canonical current-v3 uninstall recovery.
- Required repair resolved at R021: explicit detailed normal recovery returns locked v3 operation/boundary while the legacy array API remains compatible; canonical project-uninstall/all-final is recognized before global selection; current-version project/global coexistence all-final re-entry is covered.
- R021 review showed the repair is incomplete for re-signed operation authority and the legacy injected-adapter path.
- The active-goal continuation treats the next bounded change as repair 2/2 for this F008 safety boundary. Required: bind operation and operation-specific endpoints to caller authority, fail closed when a legacy adapter reports project recovery without authenticated detail, cover operation/endpoint re-signing and legacy adapter fallthrough, then rerun deslop, cumulative verification, and review.

### R022 Final Review Finding

- F008 repair 2/2 resolved operation/endpoint authority, legacy recovered-ID fallthrough, and transactions-only ambiguity, but the adapter result discriminator remains incomplete.
- Both final review lanes independently reproduced a combined top-level summary plus multiple-transactions result being accepted as project uninstall success.
- Composite verdict: `REQUEST CHANGES`; the authorized same-failure repair allowance is exhausted at 2/2.
- The continuing active goal authorized R023 to close the still-open accepted-scope AC11 discriminator defect rather than redefine or abandon the requested completion state.

### R027 Final Review

- Evidence revision: unchanged R027
- csx-code-reviewer: `APPROVE`
- csx-architect: `CLEAR`
- Composite: `APPROVE`
- Review artifact: `.csx/reviews/csx-lifecycle-state-diagnostics-migration-r027.md`
- Blocking findings: none
- Optional hardening: bounded historical whole-file reads
- AC1–AC15 and G001–G010: complete

## Completion Decision

Complete. R027 passed targeted, deslop, unchanged-revision cumulative verification, and final independent review (`APPROVE` / `CLEAR`). All AC1–AC15 and G001–G010 are satisfied.
