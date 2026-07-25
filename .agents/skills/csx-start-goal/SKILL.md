---
name: csx-start-goal
description: Execute an explicitly accepted spec or plan as one durable aggregate Codex goal with bounded implementation goals, proportional evidence, scoped deslop cleanup, one final cumulative verification, and a cumulative code-review loop.
---

# csx-start-goal

Execute an accepted input with one Codex goal and a compact Markdown control artifact. Keep the goal active until the accepted plan is implemented, every original acceptance criterion has current evidence, required cleanup has passed, the final cumulative verification succeeds once on the unchanged revision, and the cumulative code review approves it.

## Orchestration Boundary

The skill owns execution authority, aggregate goal state, assignment construction, dependency scheduling, artifact persistence, proportionality enforcement, rework routing, review invalidation, and final completion. `csx-planner` owns execution-goal decomposition, `csx-executor` owns implementation and rework, `$csx-deslop` owns bounded post-implementation cleanup, and `$csx-code-review` owns cumulative change review. The root may execute the exact accepted final verification commands and record their raw results, but must not weaken, reinterpret, or replace them.

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
2. Preserve the accepted input as binding execution context. Preserve its scope, non-goals, constraints, acceptance criteria, decisions, assumptions, Verification Matrix, risks, and stop conditions.
3. Call `get_goal` before creating anything. Use exactly one aggregate Codex goal for the entire accepted plan. Resume the same goal and artifact when active, stop for a different active goal, and otherwise call `create_goal` once.

## Proportionality and Scope Control

Classify every proposed requirement, check, and review finding as exactly one:

- `accepted scope`: required by the accepted input;
- `change-induced safety or regression`: a concrete correctness, security, data-integrity, compatibility, or supported-behavior defect introduced or exposed by the change;
- `optional hardening`: a new extreme, environment, threat model, compatibility promise, or robustness improvement not required by the accepted input and not a concrete regression.

Only the first two classes may block completion. Record optional hardening as a follow-up; do not silently turn it into a new acceptance criterion, implementation goal, or review gate. If an undefined support boundary would materially change implementation, stop and ask the user instead of choosing an unbounded interpretation.

Use the smallest evidence set that directly proves each criterion and relevant failure signal. Deduplicate commands and scenarios that prove the same behavior. By default, run the full suite once in the primary environment and bounded smoke coverage in other supported environments affected by the change. Run full cross-environment matrices only when the accepted input explicitly requires them or the change alters that environment boundary.

## Goal Artifact

Create or resume `.csx/goals/<slug>.md` as the current execution source of truth. Keep it compact:

```markdown
# Goal: <title>

## Objective and Accepted Boundaries

## Current Revision
Current: R000
Latest cause:
Changed paths:
Invalidated current evidence:

## Success Criteria
- [ ] AC1: <preserved criterion>
  - Evidence: <minimal command/scenario and current result>

## Execution Goals
### G001: <bounded result>
- Dependencies:
- Owner:
- Files:
- Criteria:
- Verification:
- Stop conditions:
- Status: pending | in_progress | ready_for_review | rework | complete
- Current evidence:
- Deslop:

## Boundary Review

## Final Verification

## Review

## Completion Decision
```

Keep only the current revision, current goal state, latest valid evidence, and open findings in the active sections. Collapse older revisions to short provenance rows. Give subagents only their goal scope, relevant current diff, criteria, latest evidence, and stop conditions rather than forwarding the complete historical artifact.

Existing artifacts with legacy scoped or integrated verification fields remain resumable. Treat those fields as historical evidence; do not require or produce new independent-agent results.

## Preserve Success Criteria

- Preserve every acceptance criterion and stable identifier from the accepted input without weakening it.
- Before implementation, map each criterion to one minimal sufficient command, test, inspection, or manual scenario with an expected result and failure signal.
- Do not multiply tests merely to create one row per criterion; one direct scenario may cover several related criteria.
- Do not invent limits, hostile inputs, platforms, or compatibility promises that the accepted input does not establish.

## Define Execution Goals

1. Confirm `csx-planner` and `csx-executor` are available. If either is missing, keep the aggregate goal active, record `blocked: required role unavailable`, and ask the user to rerun `csx install`.
2. Assign `csx-planner` the accepted input, current evidence, boundaries, decisions, criteria, and proportional Verification Matrix. Require a complete `G001...Gnnn` breakdown with bounded results, dependencies, exact file ownership, ordered handoffs for shared paths, mapped criteria, minimal verification, expected results, failure signals, and stop conditions.
3. Return one defective decomposition to the Planner for one corrected replacement. If it still has unmapped criteria, unsafe ownership overlap, scope expansion, or a user-owned decision, keep the goal active and report the blocker.
4. Persist stable goal identifiers and use:
   - Normal: `pending -> in_progress -> ready_for_review -> complete`
   - Code-changing review failure: `ready_for_review -> rework -> in_progress -> ready_for_review`
5. A dependency is satisfied when its prerequisite is `ready_for_review` with current executor and deslop evidence. Run only independent, non-overlapping goals in parallel and maintain one active owner per path.

## Architecture Boundary Review

Before implementation, require one `csx-architect` boundary review only when the accepted work changes a public interface, persisted data, permission or security boundary, migration, concurrency model, cross-module dependency contract, or operational contract.

- Reuse a current Architect `CLEAR` from an approved `csx-plan-pro` when it covers the same accepted version and boundaries.
- Otherwise assign one bounded pre-implementation review of feasibility, coupling, compatibility, migration, and recovery within the accepted scope.
- If that review is required but `csx-architect` is unavailable, keep the aggregate goal active, record `blocked: required architecture role unavailable`, and ask the user to rerun `csx install`.
- `BLOCK` stops execution only for an accepted-scope contradiction or concrete change-induced safety/regression risk.
- `WATCH` and optional hardening are recorded without expanding scope.
- Localized or non-architectural work records `skipped-not-architectural`.

## Change Revisions and Evidence Validity

- Initialize `change_revision` as `R000` and increment it after returned changes to source, tests, configuration, generated content, or documentation.
- Record only the changed paths, cause, and specifically invalidated current evidence.
- Invalidate evidence only when its observed behavior, owned file, mapped criterion, public contract, or dependency behavior changed.
- A test-only change invalidates results that use that test, not unrelated product evidence. A documentation-only change invalidates documentation evidence, not product behavior evidence.
- Any product code change after final verification or code-review approval invalidates those two final gates. Editorial-only artifact updates do not.
- Require deslop and code-review results to echo the assigned revision. Never reuse stale or mismatched evidence.

## Assign and Implement

Always assign implementation and code-changing rework to `csx-executor`. For each goal:

1. Set it to `in_progress`.
2. Assign exact owned files, criteria, minimal targeted verification, expected results, failure signals, dependency state, accepted boundaries, and stop conditions.
3. Require status, changed files, addressed criteria, commands and raw results, assumptions, blockers, and residual risk.
4. Return one recoverable defect to the same Executor for one bounded retry. Stop for a repeated failure, ownership expansion, or user-owned decision.
5. For every non-trivial code goal, invoke `$csx-deslop` once with the current revision, owned changed files and tests, accepted invariants, passing targeted verification, current diff, and stop conditions. A low-risk documentation or wording-only goal may record `deslop: not applicable`.
6. Accept only `passed/cleaned` or `passed/no-op` for the final revision. Record its before/after behavior lock and residual risk.
7. Set the goal to `ready_for_review` when executor verification and required deslop pass. There is no separate scoped evidence agent.

## Final Cumulative Verification

When every goal is `ready_for_review`, execute the accepted cumulative verification once on the unchanged current revision.

- Deduplicate equivalent commands and honor stronger explicit requirements from the accepted plan.
- The root records commands, environment, exit status, and concise raw summaries without changing the success criteria.
- On failure, map the failing command to the current owning goal and assign bounded executor rework. Rerun only invalidated targeted/deslop evidence, then rerun the final cumulative verification once on the new final revision.
- Do not create a separate integrated evidence agent or criterion-by-criterion verification pass.

## Cumulative Review Loop

After final cumulative verification succeeds, invoke `$csx-code-review` on the same revision with the accepted input, current criteria mapping, cumulative diff, executor/deslop evidence, boundary review, and final command results.

1. The code-reviewer lane is always required.
2. The Architect lane is required only when the final diff introduces or departs from a public interface, persisted-data, permission/security, migration, concurrency, cross-module dependency, or operational boundary not already cleared by the current boundary review. Diff size and file count alone do not require it.
3. Only accepted-scope defects and change-induced safety/regression findings may return goals to `rework`. Optional hardening becomes a non-blocking follow-up.
4. Map a blocking finding to the smallest affected goal and current owner. Ask the Planner for a corrected ownership handoff only when the finding crosses current ownership or requires an accepted-scope file not in the decomposition.
5. Run executor rework, one union deslop pass for changed paths and affected invariants, the invalidated final verification, and the final review again.
6. Allow at most two bounded repairs for the same blocking finding and at most three cumulative review iterations. Stop earlier when an iteration produces no new evidence or reduction in blockers.

## Complete

Complete only when:

- the accepted plan and every original criterion have current direct evidence;
- every execution goal is `ready_for_review`;
- required deslop reports pass at the current revision;
- the one final cumulative verification succeeds at the unchanged revision;
- the final code review returns `APPROVE`;
- no product code changed afterward.

Then mark goals `complete`, write the completion decision, and call `update_goal` with `complete` exactly once.
