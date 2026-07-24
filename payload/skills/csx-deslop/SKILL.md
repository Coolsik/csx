---
name: csx-deslop
description: Safely simplify an already implemented, bounded change without altering behavior or architecture, then re-run its original verification. Use when explicitly asked to clean a diff or when an execution workflow requires scoped post-implementation cleanup before review.
---

# csx-deslop

Clean only the assigned changed files and corresponding tests. Preserve behavior, remove safe implementation smells one type at a time, and leave fresh verification evidence. Do not turn cleanup into redesign.

## Required Input

Obtain or derive all of the following before editing:

- the bounded implementation goal and acceptance criteria;
- the exact owned changed files and corresponding test files;
- the already-passing initial verification command or manual scenario;
- relevant diff and stop conditions.

If file ownership, expected behavior, or the verification baseline is unclear, return a blocker instead of broadening scope.

## Workflow

1. Inspect the bounded diff and its corresponding tests.
2. Lock existing behavior before cleanup by running the assigned verification unchanged. A focused automated test is preferred; a reproducible diagnostic or manual scenario is acceptable when no automated test exists.
3. If the behavior-lock verification fails, stop. Report the failure without cleaning code or hiding the regression.
4. Inspect only the owned changed files and corresponding tests for:
   - speculative or masking fallbacks;
   - duplicated logic;
   - dead or unreachable code;
   - unnecessary abstractions or indirection;
   - violations of an existing module or ownership boundary;
   - weak, swallowed, or misleading error handling.
5. Separate safe cleanup from changes that could alter behavior, public interfaces, data shape, security, concurrency, migrations, dependencies, or architecture.
6. Apply one safe smell category at a time. Keep the smallest diff that removes the smell, preserve existing contracts, and do not mix feature work into cleanup.
7. Re-run the same behavior-lock verification after cleanup. Add a narrower check only when needed to prove the cleanup itself; never replace a stronger existing check.
8. Inspect the final bounded diff and report the result.

If there is no safe cleanup to make, do not manufacture edits. Return a passed/no-op report with the successful behavior-lock and post-cleanup-equivalent verification result.

## Escalation Boundary

Do not make a cleanup when it requires a behavior decision, changes an accepted requirement, crosses the assigned file boundary, or needs architectural judgment. Return it to the leader as a blocker with the location, risk, and decision needed.

Do not create OMX, Ralph, HUD, ledger, runtime-state, or nested planning machinery. This skill performs one bounded cleanup pass and verification only.

## Report

Return and record:

```markdown
## Deslop Report: <goal id>
- Scope: <changed files and corresponding tests>
- Behavior lock: <command/scenario and result>
- Result: passed/cleaned | passed/no-op | blocked
- Smell removed: <one or more categories, or none>
- Files changed: <paths, or none>
- Post-deslop verification: <same command/scenario and result>
- Residual risk: <remaining risk or none>
- Escalation: <decision required or none>
```

Never report `passed` unless the original behavior-lock verification succeeded after the final cleanup state.
