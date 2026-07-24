---
name: csx-start-goal
description: Execute an explicitly accepted spec or plan as one durable aggregate Codex goal with bounded implementation goals, acceptance-criterion evidence, deslop verification, and a cumulative final code-review loop. Use when the user authorizes multi-step implementation without a custom runtime.
---

# csx-start-goal

Execute an accepted input with one Codex goal and a Markdown control artifact. Keep the goal active until the complete accepted plan is implemented, every original acceptance criterion has evidence, required cleanup and verification have passed, and the unchanged cumulative diff receives final approval.

## Entry Gate

1. Confirm current-turn execution authority.
   - For a csx spec, reject `BLOCKED`; accept `READY_WITH_ASSUMPTIONS` only when the user explicitly selected execution and thereby accepted its listed reversible assumptions.
   - For a csx plan, accept only `Decision: READY`.
   - For a csx pro plan, accept only `Decision: APPROVED`.
   - Reject every `BLOCKED` plan and every plan handed over without the user's explicit `Start execution with $csx-start-goal` selection or an equivalent current-turn request that names `$csx-start-goal` and the accepted plan.
2. Preserve the accepted input as binding execution context. Preserve the spec's scope, non-goals, constraints, acceptance criteria, and decision boundaries. For a plan, preserve its boundaries, user-confirmed decisions, reversible assumptions, acceptance criteria, Verification Matrix, risks, and stop conditions.
3. Call `get_goal` before creating anything. Use exactly one aggregate Codex goal for the entire accepted plan.
   - If the same goal is active, resume it and its artifact.
   - If a different goal is active, stop and ask the user to resolve it. Never create one Codex goal per execution goal.
   - Otherwise call `create_goal` once. Its objective must explicitly require: implementation of the whole accepted plan; direct evidence for every acceptance criterion; required deslop and post-deslop verification; and no completion before the final cumulative code review passes.

## Goal Artifact

Create or resume `.csx/goals/<slug>.md`. Treat it as the source of truth for execution state.

```markdown
# Goal: <title>

## Objective
<overall objective and accepted plan/spec path plus version>

## Accepted Boundaries
<scope, non-goals, constraints, decisions, assumptions, risks, stop conditions>

## Success Outcomes
### O1: <optional outcome>
- [ ] AC1: <original acceptance criterion, preserved verbatim>
  - Expected evidence: <command/test/file/manual scenario>
  - Failure signal: <observable failure>

## Execution Goals
### G001: <bounded implementation result>
- Dependencies: none | Gnnn
- Owner: leader | csx-executor:<task-name>
- Files: <implementation files and corresponding tests>
- Criteria: AC1, AC2
- Verification: <exact commands or scenarios>
- Stop conditions: <specific boundary or blocker>
- Status: pending | in_progress | ready_for_review | rework | complete
- Evidence: <initial and post-deslop results>

## Deslop and Verification
<per-goal cleanup/no-op report and post-deslop evidence>

## Review Iterations
### Review 1
<review input revision, lane verdicts, final verdict, findings mapped to goals>

## Completion Decision
<criterion evidence audit, final approval revision, and whether later code changes occurred>
```

## Preserve Success Criteria

- Do not impose a count limit on acceptance criteria. Every acceptance criterion from the accepted input is a required criterion in the artifact. Reuse testable acceptance criteria instead of weakening or rediscovering them.
- Optionally group criteria under 2-5 top-level outcomes only when that improves readability. The outcomes are organizational; they do not replace, merge, weaken, or summarize away original criteria or failure signals.
- Before implementation, assign each criterion concrete expected evidence such as a command, test, diagnostic, file inspection, or manual scenario. Preserve any stronger evidence required by the accepted Verification Matrix.
- Keep criterion identifiers stable through implementation, rework, and review so findings and evidence remain traceable.

## Define Execution Goals

1. Split the accepted plan into `G001...Gnnn` bounded implementation results. Record dependencies, owner, exact file ownership, corresponding tests, mapped criteria, verification, and stop conditions before work starts.
2. Use these state transitions:
   - Normal: `pending -> in_progress -> ready_for_review -> complete`
   - Review failure: `ready_for_review -> rework -> in_progress -> ready_for_review`
3. Do not mark an execution goal `complete` during implementation. Hold all successfully implemented goals at `ready_for_review` until the final cumulative review passes.
4. Run independent goals in parallel only when they have no dependency and no overlapping file ownership. Run dependent goals and goals touching the same files sequentially.

## Choose the Implementer

The leader may implement a goal directly only when all of these are demonstrably true:

- The change is small and local, with unambiguous behavior and edit scope.
- It affects no public API, schema, security, concurrency, migration, dependency, or architecture boundary.
- It requires no coordination across modules.
- One focused verification can prove the result.

If any condition is false or uncertain, assign the bounded goal to `csx-executor`. For every executor assignment, provide:

- owned implementation files and corresponding test files;
- mapped acceptance criteria and expected evidence;
- exact initial and post-deslop verification commands or manual scenarios;
- dependency state and explicit stop conditions;
- the instruction that other work may coexist in the worktree and must not be reverted.

The leader may skip deslop only for a directly authored, low-risk documentation or wording-only change. If implementation code exceeds the leader boundary, reassign it instead of expanding direct ownership.

## Implement, Deslop, and Prepare Review

For each execution goal:

1. Set the state to `in_progress`.
2. Implement the smallest change within the recorded ownership.
3. Run the assigned initial verification and record fresh results against the mapped criteria.
4. For every non-trivial implementation goal, invoke `$csx-deslop` after initial verification. Limit it to that goal's owned changed files and corresponding tests.
5. Require `$csx-deslop` to lock existing behavior, report either cleanup or a passed/no-op result, and run the same verification after cleanup.
6. Record changed files, removed smells or no-op reason, post-deslop verification, evidence, and residual risk.
7. Set the state to `ready_for_review` only when implementation, required deslop, and post-deslop verification all pass. Return boundary-changing cleanup proposals or unresolved failures to the leader as blockers.

Review the diff and evidence from each executor before accepting its goal as `ready_for_review`.

## Cumulative Review Loop

Begin final review only when every execution goal is `ready_for_review`.

1. Run fresh integrated verification over the cumulative change and update the artifact.
2. Invoke `$csx-code-review` with:
   - the accepted plan/spec and every original acceptance criterion;
   - the goal artifact and criterion-to-evidence mapping;
   - the entire cumulative diff;
   - all post-deslop and integrated verification results.
3. Treat a substantial diff as passed only when all three results are present:
   - `csx-code-reviewer: APPROVE`
   - `csx-architect: CLEAR`
   - final `Verdict: APPROVE`
4. A trivial diff may use the code-review fast path, but still requires final `Verdict: APPROVE`.
5. Treat `COMMENT`, `WATCH`, `REQUEST CHANGES`, `BLOCK`, a missing required lane, or any final verdict other than `APPROVE` as a failure.
6. Map every finding to affected acceptance criteria and execution goals. Move affected goals to `rework`, then assign every rework fix to `csx-executor` with bounded ownership, evidence, verification, and stop conditions.
7. Advance each affected goal through `rework -> in_progress -> ready_for_review`. Re-run scoped deslop and post-deslop verification for every changed implementation scope, then re-run integrated verification and `$csx-code-review` on the entire cumulative diff.
8. Any code change after a review invalidates every earlier approval. Record the new diff revision and review iteration; never reuse an earlier verdict.

Repeat until the unchanged cumulative diff passes. If a finding requires a user decision or a change to the accepted plan, do not loop speculatively. Keep the aggregate goal active, record the blocker and affected goals, and ask the user for that decision.

## Complete

Before completion, audit that:

- the entire accepted plan is implemented;
- every original acceptance criterion has direct, current evidence;
- every execution goal is `ready_for_review`;
- required deslop or passed/no-op reports and post-deslop verification exist;
- the latest cumulative review passed under the applicable lane rules;
- no code changed after that approval.

Only then change every execution goal to `complete`, write the final completion decision, and call `update_goal` with `complete` exactly once. Do not claim completion from memory or from an approval attached to an older diff.
