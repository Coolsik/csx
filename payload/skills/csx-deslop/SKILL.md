---
name: csx-deslop
description: Safely simplify an already implemented, bounded change without altering behavior or architecture, proving preservation by running the same behavior lock before and after cleanup.
---

# csx-deslop

Orchestrate one bounded behavior-preserving cleanup. Do not turn cleanup into redesign and do not add a separate evidence lane.

## Orchestration Boundary

The skill owns input validation, assignment construction, call ordering, revision routing, and the final report. `csx-executor` owns baseline execution, smell analysis, safe cleanup, and the identical post-cleanup verification. The root must not clean the code itself or weaken the supplied behavior lock.

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

Obtain or derive:

- the bounded implementation goal and accepted invariants;
- exact owned changed files and corresponding tests;
- an already-passing behavior-lock command or manual scenario;
- the relevant diff and stop conditions;
- the caller's current evidence revision when nested in a revisioned workflow.

If ownership, expected behavior, or the verification baseline is unclear, return a blocker instead of broadening scope. For standalone cleanup initialize `cleanup_revision: D000`; otherwise use the parent revision authority.

## Workflow

1. Confirm `csx-executor` is available. If missing, ask the user to rerun `csx install` and return `blocked: required role unavailable`.
2. Assign one Executor the evidence revision, bounded goal, invariants, exact owned files and tests, current diff, unchanged behavior lock, and stop conditions.
3. Require the Executor to:
   - run the assigned behavior lock before editing and stop if it fails;
   - inspect only owned changed files and corresponding tests;
   - look for speculative or masking fallbacks, duplicated logic, dead code, unnecessary abstraction or indirection, ownership violations, and swallowed or misleading errors;
   - separate safe cleanup from behavior, public-interface, data-shape, security, concurrency, migration, dependency, or architecture changes;
   - apply one safe smell category at a time using the smallest diff;
   - return `no-op` instead of manufacturing an edit;
   - run the exact same behavior lock after the final state;
   - return `cleaned`, `no-op`, or `blocked` with revision, files, before/after commands and raw results, removed smells, blockers, and residual risk.
4. Stop on `blocked`, a failing baseline or final behavior lock, a changed verification command, scope expansion, or revision mismatch. Do not ask another role to repair it inside this skill.
5. Establish the final evidence revision:
   - for `cleaned`, increment the standalone revision or require the invoking root to increment and record the parent revision after returned changes;
   - for `no-op`, retain the input revision;
   - record changed paths and the specifically invalidated evidence.
6. Report `passed/cleaned` or `passed/no-op` only when the Executor's before and after behavior locks both succeed unchanged and its final state matches the final evidence revision.

## Proportionality Boundary

- Cleanup is not a second implementation pass.
- Do not introduce new edge cases, platforms, threat models, abstractions, tests, or acceptance criteria.
- Do not turn an optional hardening opportunity into a blocker.
- When a smell cannot be removed safely within the existing behavior lock and ownership, leave it as residual risk or a follow-up.
- Perform one bounded cleanup pass only.

## Escalation Boundary

The Executor must not clean when doing so requires a behavior decision, changes an accepted requirement, crosses ownership, or needs architectural judgment. Return a blocker with the location, risk, and decision needed.

Do not create nested planning, runtime-state, ledger, or subagent machinery.

## Report

```markdown
## Deslop Report: <goal id>
- Scope: <changed files and tests>
- Input evidence revision: <revision>
- Final evidence revision: <revision>
- Behavior lock before: <exact command/scenario and result>
- Result: passed/cleaned | passed/no-op | blocked
- Smell removed: <categories or none>
- Files changed: <paths or none>
- Behavior lock after: <same command/scenario and result>
- Residual risk: <remaining risk or none>
- Escalation: <decision required or none>
```

Never report `passed` unless the exact same behavior lock succeeded before and after the final cleanup state and the final evidence revision matches.
