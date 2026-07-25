---
name: csx-start-goal
description: Execute an explicitly accepted spec or plan as one durable aggregate Codex goal with bounded implementation goals, acceptance-criterion evidence, deslop verification, and a cumulative final code-review loop. Use when the user authorizes multi-step implementation without a custom runtime.
---

# csx-start-goal

Execute an accepted input with one Codex goal and a Markdown control artifact. Keep the goal active until the complete accepted plan is implemented, every original acceptance criterion has evidence, required cleanup and verification have passed, and the unchanged cumulative diff receives final approval.

## Orchestration Boundary

The skill owns execution authority, aggregate goal state, assignment construction, dependency scheduling, artifact persistence, rework routing, review invalidation, and final completion. `csx-planner` owns execution-goal decomposition, `csx-executor` owns implementation and rework, `csx-verifier` owns scoped and integrated completion evidence, and `$csx-code-review` owns cumulative change review. The root must not plan, implement, clean, verify, or review a delegated slice itself.

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

## Change Revision
Current: R000

| Revision | Cause | Changed Files | Invalidated Evidence |
| --- | --- | --- | --- |

## Success Outcomes
### O1: <optional outcome>
- [ ] AC1: <original acceptance criterion, preserved verbatim>
  - Expected evidence: <command/test/file/manual scenario>
  - Failure signal: <observable failure>

## Execution Goals
### G001: <bounded implementation result>
- Dependencies: none | Gnnn
- Owner: csx-executor:<task-name>
- Ownership history: <revision, owner, and any sequential handoff>
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
<change_revision, lane verdicts, final verdict, findings mapped to goals>

## Completion Decision
<criterion evidence audit, final approval revision, and whether later code changes occurred>
```

## Preserve Success Criteria

- Do not impose a count limit on acceptance criteria. Every acceptance criterion from the accepted input is a required criterion in the artifact. Reuse testable acceptance criteria instead of weakening or rediscovering them.
- Optionally group criteria under 2-5 top-level outcomes only when that improves readability. The outcomes are organizational; they do not replace, merge, weaken, or summarize away original criteria or failure signals.
- Before implementation, assign each criterion concrete expected evidence such as a command, test, diagnostic, file inspection, or manual scenario. Preserve any stronger evidence required by the accepted Verification Matrix.
- Keep criterion identifiers stable through implementation, rework, and review so findings and evidence remain traceable.

## Define Execution Goals

1. Confirm `csx-planner`, `csx-executor`, and `csx-verifier` are available. If a required role is missing, keep the aggregate goal active, record `blocked: required role unavailable`, and ask the user to rerun `csx install`.
2. Assign `csx-planner` the accepted spec or plan, approved version, boundaries, decisions, assumptions, risks, stop conditions, every original acceptance criterion, and the Verification Matrix. Require a complete `G001...Gnnn` execution breakdown containing:
   - one bounded implementation result per goal;
   - dependencies;
   - exact file ownership and corresponding tests, with no simultaneous ownership overlap;
   - an explicit ordered ownership handoff for any file that sequential goals must both change;
   - mapped acceptance-criterion identifiers without omission or weakening;
   - exact verification commands or scenarios, expected results, and failure signals;
   - goal-specific stop conditions;
   - identified ownership or dependency blockers.
3. If a material criterion is unmapped, ownership overlaps without sequencing, or the Planner reports a blocker, send the exact defect back to the Planner for one corrected replacement breakdown. If the correction still fails or requires a user decision, keep the goal active and ask the user; do not repair the decomposition in the root.
4. Persist the accepted Planner breakdown in the goal artifact, assign stable `G001...Gnnn` identifiers, and use these state transitions:
   - Normal: `pending -> in_progress -> ready_for_review -> complete`
   - Code-changing review failure: `ready_for_review -> rework -> in_progress -> ready_for_review`
   - Evidence-only invalidation after another goal owns the fix: `ready_for_review -> rework -> ready_for_review`
5. Do not mark an execution goal `complete` during implementation. Hold all successfully implemented goals at `ready_for_review` until independent verification and the final cumulative review pass.
6. A dependency is satisfied for execution when every prerequisite is `ready_for_review` with non-invalidated scoped evidence; never wait for `complete`, which is reserved for final completion. Run independent goals in parallel only when the Planner breakdown gives them no dependency and no overlapping file ownership. Run dependent goals and goals touching the same files sequentially.
7. Maintain one active owner per path. A dependent goal may take ownership of a shared path only through the Planner-recorded handoff after the prior owner reaches `ready_for_review`. Do not assign the prior owner that path again unless a fresh Planner correction explicitly reassigns it.

## Change Revisions and Evidence Validity

- Initialize `change_revision` as `R000` before implementation and increment it monotonically after every returned change to implementation, tests, configuration, generated source, or documentation.
- Record each revision's cause, changed files, and invalidated evidence in the goal artifact. Tag implementation, deslop, scoped verification, integrated verification, and code-review evidence with the revision whose state it inspected.
- Require every Verifier and code-review result to echo its assigned `change_revision`. A missing or mismatched revision is stale evidence and cannot pass.
- Any code change invalidates the prior integrated Verifier result and cumulative code-review result.
- Also invalidate scoped Verifier and deslop evidence for every goal whose owned files changed, whose mapped criteria changed, or whose dependency behavior may be affected. Move each affected goal to `rework` or `in_progress`. The current code owner reruns implementation verification and deslop for every changed path; evidence-only affected goals consume that shared final-revision deslop report and rerun scoped verification instead of repeating cleanup under an obsolete owner.
- Evidence for an unrelated goal remains valid only when its files, mapped criteria, and dependency behavior are unchanged. Record that impact decision in the revision history instead of assuming it silently.

## Assign Implementation

Always assign every implementation and code-changing rework goal to `csx-executor`. Evidence-only revalidation is not an implementation assignment and remains owned by `csx-verifier`. A clear local edit that does not need workflow orchestration should be implemented outside this skill rather than by a root fast path. For every Executor assignment, provide:

- owned implementation files and corresponding test files;
- mapped acceptance criteria and expected evidence;
- exact targeted verification commands or manual scenarios, expected results, and failure signals;
- dependency state and explicit stop conditions;
- the accepted boundaries, relevant repository evidence, and current goal artifact state;
- the instruction that other work may coexist in the worktree and must not be reverted.

The Executor must not invoke another skill or subagent. It implements only the assigned slice and returns its requested result packet.

## Implement, Deslop, and Prepare Review

For each execution goal:

1. Set the state to `in_progress`.
2. Spawn `csx-executor` with the complete assignment above. Require status, changed files, addressed criteria, decisions, commands and results, assumptions, conflicts, blockers, and residual risk.
3. Check the result packet for the required fields, owned-file compliance, and passing assigned verification. If it is incomplete or failing but recoverable inside the same assignment, return the exact defect to the same Executor when possible for one bounded retry. If the retry fails, the Executor is blocked, or recovery needs a user decision or wider ownership, record the exact blocker and keep the aggregate goal active; do not independently fix it or retry indefinitely.
4. For every non-trivial implementation goal, invoke `$csx-deslop` from the root with the current `change_revision`, that goal's owned changed files, corresponding tests, accepted behavior, passing targeted verification, current diff, and stop conditions. Authorize the Deslop orchestration to increment and record one new parent revision after returned cleanup changes and before its Verifier call. The Executor must not invoke it.
5. Accept only a `$csx-deslop` `passed/cleaned` or `passed/no-op` result backed by `csx-verifier: PASS` that echoes the artifact's current `change_revision`. A low-risk documentation or wording-only goal may record `deslop: not applicable` with rationale.
6. After implementation and cleanup, assign `csx-verifier` the current `change_revision`, goal's mapped criteria, final owned diff, exact verification, expected result, failure signal, and all current evidence. Require it to echo that revision and return `PASS`, `PARTIAL`, or `FAIL` with a criterion evidence matrix.
7. Record changed files, implementation evidence, deslop result, scoped Verifier verdict, evidence, and residual risk.
8. Set the state to `ready_for_review` only when implementation verification passes, required deslop passes, and the scoped Verifier returns `PASS`. Route `PARTIAL` or `FAIL` to rework or blocker handling rather than overriding the verdict.

## Cumulative Review Loop

Begin final review only when every execution goal is `ready_for_review`.

1. Assign `csx-verifier` the current `change_revision`, entire accepted input, every original acceptance criterion, the complete cumulative diff, all goal evidence, integrated commands or scenarios, expected results, and failure signals. Require it to echo that revision, perform fresh integrated verification, and return a criterion-by-criterion `PASS`, `PARTIAL`, or `FAIL` evidence matrix.
2. Continue only on integrated `PASS`. Map `PARTIAL` or `FAIL` evidence gaps to affected goals and move them to `rework`; do not begin code review on an unproven cumulative state.
3. Invoke `$csx-code-review` with:
   - the current `change_revision`, which every required lane and the composite result must echo;
   - the accepted plan/spec and every original acceptance criterion;
   - the goal artifact and criterion-to-evidence mapping;
   - the entire cumulative diff;
   - all scoped, post-deslop, and integrated Verifier results.
4. Treat a substantial diff as passed only when all three results are present:
   - `csx-code-reviewer: APPROVE`
   - `csx-architect: CLEAR`
   - final `Verdict: APPROVE`
5. A trivial diff may validly skip Architect under the code-review skill, but still requires `csx-code-reviewer: APPROVE`, integrated Verifier `PASS`, and final `Verdict: APPROVE`.
6. Treat `COMMENT`, `WATCH`, `REQUEST CHANGES`, `BLOCK`, a missing required lane, or any final verdict other than `APPROVE` as a failure.
7. Map every finding to affected acceptance criteria and execution goals. Move affected goals to `rework`, then assign every code-changing rework fix to `csx-executor` with bounded ownership, evidence, verification, and stop conditions. If a finding crosses current goal ownership or requires new files, send the finding, current artifact, and ownership history to `csx-planner` for a corrected decomposition and explicit ownership handoff; preserve stable goal and criterion identifiers where possible. Validate the replacement against the same criterion coverage, dependency, one-active-owner, handoff, verification, and stop-condition rules as the initial breakdown. Return one defective replacement to Planner for one correction; if it still fails or needs a user decision, keep the goal active and report the blocker. The root must not invent or repair the reassignment.
8. The corrected breakdown must name one current code owner for every changed path and list every earlier goal whose scoped evidence that change invalidates. Run the code-changing goal through Executor and invoke `$csx-deslop` once with the union of invariants for the current owner and every evidence-only affected goal that depends on those paths. Attach its final-revision, path-and-invariant-mapped report to each affected goal as the replacement for invalidated prior deslop evidence. Do not hand the file back merely to refresh evidence. Then assign `csx-verifier` each evidence-only affected goal's criteria, current revision, final diff, shared deslop report, and exact verification; only `PASS` may return it from `rework` to `ready_for_review`.
9. Advance each code-changing goal through `rework -> in_progress -> ready_for_review`, then re-run scoped Verifier checks for all affected goals, integrated Verifier checks, and `$csx-code-review` on the entire cumulative diff.
10. Apply the Change Revisions and Evidence Validity rules after every rework change. Record the new revision and iteration; never reuse invalidated scoped, integrated, deslop, or review evidence.

Repeat until the unchanged cumulative diff passes, up to 5 cumulative review iterations. Stop earlier when the same blocking finding survives two bounded repair attempts or an iteration produces no new evidence and no reduction in blocking findings. Keep the aggregate goal active, record the no-progress blocker and affected goals, and ask the user for direction. If a finding requires a user decision or a change to the accepted plan, do not loop speculatively; use the same blocker path.

## Complete

Before completion, audit that:

- the entire accepted plan is implemented;
- every original acceptance criterion has direct, current evidence;
- every execution goal is `ready_for_review`;
- required deslop or passed/no-op reports and scoped Verifier `PASS` results exist;
- the latest unchanged cumulative diff has integrated Verifier `PASS`;
- the latest cumulative review passed under the applicable lane rules;
- both results echo the current `change_revision`;
- no code changed after that revision's approval.

Only then change every execution goal to `complete`, write the final completion decision, and call `update_goal` with `complete` exactly once. Do not claim completion from memory or from an approval attached to an older diff.
