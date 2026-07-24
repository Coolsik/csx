---
name: csx-start-goal
description: Start and track a durable multi-step Codex task from a request, accepted spec, or plan using Markdown goal artifacts, success criteria, evidence, and completion checks. Use when the user explicitly approves execution across several steps without a custom runtime.
---

# csx-start-goal

Use this skill to execute a task with lightweight durability through workspace artifacts.

## Artifact

Create `.csx/goals/<slug>.md` for tasks with more than one verification criterion.

```markdown
# Goal: <title>

## Objective

## Success Criteria
- [ ] C1: ...
- [ ] C2: ...

## Work Log

## Evidence

## Completion Check
```

## Workflow

1. Use real Codex goal tools when available: call `get_goal` first.
2. If no active goal exists, call `create_goal` for the user request, accepted spec, or plan. If a different active goal exists, do not create a second goal; resume it when it is the same task, or stop and ask the user to resolve the active goal first.
3. When the input is a csx spec, reject `BLOCKED`; accept `READY_WITH_ASSUMPTIONS` only when the user explicitly selected execution and thereby accepted its listed reversible assumptions. Preserve the spec's scope, non-goals, constraints, acceptance criteria, and decision boundaries as binding execution context.
4. Convert the input into 2-5 success criteria. Reuse testable acceptance criteria from an accepted spec instead of weakening or rediscovering them.
5. For each criterion, name the exact observable evidence before work starts.
6. Split only independent implementation work into bounded slices with non-overlapping file ownership.
7. Spawn one `csx-executor` per safe independent slice. Tell every executor it is not alone in the worktree, its exact ownership, required verification, and stop condition. Use unique task names and `fork_turns: "none"`.
8. Keep dependent work sequential. Review every executor's diff and evidence before accepting the slice.
9. Record command output, file paths, screenshots, or review artifacts in the goal file.
10. Before completion on non-trivial work, spawn `csx-verifier` with the success criteria, goal artifact, diff, and fresh verification evidence.
11. Call `update_goal` complete only when every essential criterion has evidence and `csx-verifier` returns `PASS`.

## Review Gate

- Verifier lane cap: 2,000 tokens.
- Skip executor delegation for tiny documentation or one-file edits, but keep `csx-verifier` for non-trivial completion claims.
- The verifier checks only criteria, evidence, residual risk, and whether the completion claim is justified; it must not repair failures.
- If a required role is missing, ask the user to rerun `csx install` for the intended scope. Do not mark a non-trivial goal complete without the verifier.

## Built-in Quality Checks

- Before editing: note expected behavior and files likely affected.
- Before completion: run relevant tests, diagnostics, or manual checks.
- For cleanup-heavy work: preserve behavior first, then simplify.
- For user-facing behavior: include at least one real use check.

Do not claim completion from memory. The goal file must show why completion is justified.
