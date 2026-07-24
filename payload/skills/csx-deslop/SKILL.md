---
name: csx-deslop
description: Safely simplify an already implemented, bounded change without altering behavior or architecture, then re-run its original verification. Use when explicitly asked to clean a diff or when an execution workflow requires scoped post-implementation cleanup before review.
---

# csx-deslop

Orchestrate one bounded behavior-preserving cleanup and independent verification. Do not turn cleanup into redesign.

## Orchestration Boundary

The skill owns input validation, assignment construction, role availability, call ordering, verdict routing, and the final report. `csx-executor` owns baseline execution, smell analysis, safe code cleanup, and targeted verification. `csx-verifier` independently proves the final behavior-preservation claim. The root must not clean or verify the code itself.

Every subagent assignment must state:

```text
Objective:
Inputs:
Scope:
Required work/checks:
Expected deliverable:
Required verdict or vocabulary:
Constraints:
Stop conditions:
```

## Required Input

Obtain or derive all of the following before editing:

- the bounded implementation goal and acceptance criteria;
- the exact owned changed files and corresponding test files;
- the already-passing initial verification command or manual scenario;
- relevant diff and stop conditions;
- the caller's current evidence revision when this cleanup is part of a revisioned workflow.

If file ownership, expected behavior, or the verification baseline is unclear, return a blocker instead of broadening scope.

For a standalone cleanup, initialize `cleanup_revision: D000`. For a revisioned parent workflow, use its supplied revision and its artifact as the revision authority.

## Workflow

1. Confirm `csx-executor` and `csx-verifier` are available. If either is missing, ask the user to rerun `csx install` for the intended scope and return `blocked: required role unavailable`.
2. Assign `csx-executor` the input evidence revision, bounded goal, acceptance criteria or invariants, exact owned files and corresponding tests, current diff, already-passing verification command or scenario, and stop conditions.
3. Require the Executor to:
   - lock existing behavior by running the assigned verification unchanged before editing;
   - stop without cleanup if the baseline fails;
   - inspect only the owned changed files and corresponding tests for speculative or masking fallbacks, duplicated logic, dead or unreachable code, unnecessary abstractions or indirection, ownership-boundary violations, and weak, swallowed, or misleading error handling;
   - separate safe cleanup from changes that could alter behavior, public interfaces, data shape, security, concurrency, migrations, dependencies, or architecture;
   - apply one safe smell category at a time and make the smallest behavior-preserving diff;
   - avoid manufactured edits and return a no-op when no safe cleanup exists;
   - run the same behavior-lock verification after the final state;
   - return `cleaned`, `no-op`, or `blocked` with files, before/after commands and results, removed smells, blockers, and residual risk.
4. If the Executor returns `blocked` or its baseline/post-cleanup verification fails, stop and report the failure. Do not ask another role to repair it inside this skill.
5. Establish the final evidence revision before independent verification:
   - For `cleaned`, increment the standalone cleanup revision, or require the invoking root to increment and record the parent `change_revision` after the Executor's returned changes and before continuing.
   - For `no-op`, retain the input revision.
   - Record changed files and invalidated evidence with that final revision. If the revision authority cannot record the new state, return `blocked: final revision unavailable`.
6. Assign `csx-verifier` the final evidence revision, original goal and invariants, allowed scope, pre-cleanup and final diffs, Executor report, exact behavior-lock verification, expected result, and failure signal.
7. Require the Verifier to echo the final evidence revision, inspect that final state, rerun the same verification when possible, and return `PASS`, `PARTIAL`, or `FAIL` with an evidence matrix. A missing or mismatched revision and missing, stale, or mismatched evidence cannot pass.
8. Report `passed/cleaned` or `passed/no-op` only when the Executor result is successful and the Verifier returns `PASS` for the final evidence revision. Any other Verifier verdict is `blocked`.

## Escalation Boundary

The Executor must not make a cleanup when it requires a behavior decision, changes an accepted requirement, crosses the assigned file boundary, or needs architectural judgment. Return it to the leader as a blocker with the location, risk, and decision needed.

Do not create OMX, Ralph, HUD, ledger, runtime-state, or nested planning machinery. This skill performs one bounded cleanup pass and verification only.

## Report

Return and record:

```markdown
## Deslop Report: <goal id>
- Scope: <changed files and corresponding tests>
- Input evidence revision: <revision>
- Final evidence revision: <revision echoed by Verifier>
- Behavior lock: <command/scenario and result>
- Result: passed/cleaned | passed/no-op | blocked
- Smell removed: <one or more categories, or none>
- Files changed: <paths, or none>
- Post-deslop verification: <same command/scenario and result>
- Independent verification: PASS | PARTIAL | FAIL | unavailable
- Residual risk: <remaining risk or none>
- Escalation: <decision required or none>
```

Never report `passed` unless the original behavior-lock verification succeeded after the final cleanup state and `csx-verifier` returned `PASS`.
