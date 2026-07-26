---
name: csx-start-goal
description: Execute an explicitly accepted spec or plan as one durable aggregate Codex goal with bounded implementation goals, proportional evidence, scoped deslop cleanup, one final cumulative verification, and a cumulative code-review loop.
---

# csx-start-goal

Execute an accepted input with one Codex goal and a compact Markdown control artifact. Keep the goal active until the accepted plan is implemented, every original acceptance criterion has current evidence, required cleanup has passed, the final cumulative verification succeeds once on the unchanged revision, and the cumulative code review approves it.

## Orchestration Boundary

The skill owns execution authority, aggregate goal state, assignment construction, dependency scheduling, artifact persistence, proportionality enforcement, rework routing, review invalidation, and final completion. `csx-planner` owns execution-goal decomposition, `csx-executor` owns implementation and rework, `$csx-deslop` owns bounded post-implementation cleanup, and `$csx-code-review` owns cumulative change review. The root may execute the exact accepted final verification commands and record their raw results, but must not weaken, reinterpret, or replace them.

## Canonical Workflow State

After creating or resuming the repository-relative `.csx/goals/<slug>.md` control artifact and persisting its current entry state, call `csx workflow begin` with one bounded JSON request on stdin:

```json
{"version":1,"workflow":"csx-start-goal","phase":"entry","artifact":".csx/goals/<slug>.md"}
```

Parse the single JSON stdout result. Retain and propagate its opaque `token` only when `ok` is `true`; never write the token into the goal artifact or pass JSON content through command arguments. A missing command, nonzero exit, malformed result, or `ok: false` is state telemetry failure only: continue the execution contract unchanged and do not retry speculatively.

Whenever the control artifact records a material phase transition or current revision milestone, persist and verify the artifact first, then call `csx workflow checkpoint` with bounded JSON stdin containing `version: 1`, the retained `token`, the new `phase`, and the same repository-relative `artifact`. After the completed artifact is persisted and verified, call `csx workflow finish` in the same artifact-first/state-second order with phase `complete` and outcome `complete`. If this workflow reaches a genuine terminal blocked or stopped decision rather than a resumable pause, finish with outcome `blocked` or `stopped`; otherwise leave the active state at its latest checkpoint. A stale-token or any other state failure is fail-open and must not change goal status, evidence, retry counters, review decisions, or `update_goal` behavior. Do not create canonical workflow state for any other skill.

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
Diagnostics trailer:
```

For every direct subagent assignment, require the normal response body followed by this exact final nonempty line:

```text
<!-- csx-metrics:v1 {"status":"completed"} -->
```

The compact JSON may contain only `status` (`completed`, `blocked`, `failed`, or `terminated`), `reason_code` (`[a-z0-9_]{1,64}`), and `failure_detail` (at most 2048 UTF-8 bytes and only with a valid `reason_code`). Keep the complete trailer at most 6144 UTF-8 bytes. Never put prompt or artifact text, agent/thread/run IDs, workflow tokens, or other identifiers in the trailer.

## Subagent Output and Liveness Policy

Apply this policy to every direct subagent spawn or resume in this skill.

- Do not set or request a fixed token count. Require the smallest complete deliverable that preserves every required field, cited fact, evidence boundary, verdict, blocker, and stop condition.
- Omit request restatement, generic advice, duplicated evidence, and unrelated exploration. Control workload through explicit scope, required checks, output shape, and stop conditions.
- If the bounded assignment cannot be completed with the available evidence, return the skill's missing-evidence or blocked vocabulary instead of dropping required content, inventing facts, or broadening scope.
- After dispatch, allow at least five minutes before inactivity handling unless the agent returns a hard failure.
- After that initial grace period, if three consecutive minutes pass without new observable activity, measured from the later of the grace-period end or the last activity, send exactly one status check. Require the current step, last completed evidence, any running tool or command, blocker, and next action.
- After the status check, allow two additional minutes for activity. If none arrives, terminate the inactive agent and confirm termination before creating a replacement.
- Create at most one availability replacement for that direct assignment. Give it a unique task name, `fork_turns: "none"`, the complete original assignment, and all validated inputs and evidence. Never run the replacement concurrently with the agent it replaces.
- If the replacement also becomes inactive under this policy, report the required role as unavailable using this skill's existing failure vocabulary. Do not create another replacement.
- Observable activity includes a progress or result message and an observable tool or command start or completion. A tool or command known to still be running is not agent inactivity; follow that operation's own timeout and stop conditions.
- This skill monitors only its direct subagent calls. A child skill monitors the agents it calls. Availability replacement does not consume or relax normal revision, review, or rework limits.
- Use the environment's existing agent controls. Do not implement a custom runner, background service, or hard-kill timer for this policy.

## Entry Gate

1. Confirm current-turn execution authority through exactly one of these parallel branches.
   - Standalone branch:
     - For a csx spec, reject `BLOCKED`; accept `READY_WITH_ASSUMPTIONS` only when the user explicitly selected execution and thereby accepted its listed reversible assumptions.
     - For a csx plan, accept only `Decision: READY`.
     - For a csx pro plan, accept only `Decision: APPROVED`.
     - Reject every `BLOCKED` plan and every plan handed over without the user's explicit `Start execution with $csx-start-goal` selection or an equivalent current-turn request that names `$csx-start-goal` and the accepted plan.
   - `$csx-loop` authority branch: apply every validation in `csx-loop Entry Contract` below. A successful validation is the current-turn execution selection equivalent for this entry only.
2. Preserve the accepted input as binding execution context. Preserve its scope, non-goals, constraints, acceptance criteria, decisions, assumptions, Verification Matrix, risks, and stop conditions.
3. Call `get_goal` before creating anything. Use exactly one aggregate Codex goal for the entire accepted plan. Resume the same goal and artifact when active, stop for a different active goal, and otherwise call `create_goal` once. Persist the created or resumed control artifact before beginning canonical workflow state.

## csx-loop Entry Contract

Validate a claimed loop entry against the exact `$csx-loop` context schema, with no alternate fields or token:

```text
source
original_invocation
original_request
work_slug
spec_path
spec_status
spec_recommendation
plan_kind
plan_path
plan_status
accepted_reversible_assumptions
last_completed_stage
remaining_stages
continuation_authority
repository_marker
affected_evidence
pending_decision
attempt_counters
```

The loop branch requires all of the following before implementation or goal creation:

- `source: csx-loop`, one bounded original request and matching `work_slug`, complete original invocation provenance, preserved counters, and internally consistent completed/remaining stages;
- a matching final spec with `spec_status: READY | READY_WITH_ASSUMPTIONS`, its accepted reversible assumptions explicitly present in `accepted_reversible_assumptions`, and no unaccepted assumption;
- exactly one matching plan artifact: `plan_kind: csx-plan` with `plan_status: READY` or `plan_kind: csx-plan-pro` with `plan_status: APPROVED`, plus matching path, slug, original boundary, accepted `draft_version`, and artifact status;
- for a pro plan, Architect `CLEAR` and Critic `APPROVED` for that same accepted `draft_version`;
- a current repository marker, or bounded revalidation of only the `affected_evidence` whose boundary the marker change can invalidate;
- `get_goal` reporting no active goal or the same compatible aggregate goal and matching goal artifact; a distinct active goal is a hard stop; and
- current live authority bound to this `work_slug`, current stage, the `csx-start-goal` entry transition, exact `pending_decision` or `none`, and current user turn with `consumed: false`.

The stored `continuation_authority: initial-call | renewed-by-answer | explicit-resume` is audit provenance only. A persisted enum, past prompt, copied or edited artifact, stale answer, unrelated answer, or mismatched resume command cannot satisfy entry. Validate the current-turn source and every binding immediately before entry. Consume the entry authority exactly once only after every check, including active-goal compatibility, succeeds; it cannot authorize a repeated entry.

If `source: csx-loop` or any other loop claim is present but the complete context, accepted artifacts, repository freshness, active-goal compatibility, or live authority fails validation, stop before `create_goal` with exactly `BLOCKED: invalid loop approval context`. Never fall back from a malformed loop claim to standalone authorization. When there is no loop claim, preserve the standalone Entry Gate unchanged.

A question, blocker, cancellation, unrelated turn, permission stop, or ended workflow invalidates live authority. This skill cannot renew or derive it. Deployment, an external message, deletion, additional permission, and irreversible effects always require separate approval regardless of a Recommended label or loop provenance.

## Proportionality and Scope Control

Classify every proposed requirement, check, and review finding as exactly one:

- `accepted scope`: required by the accepted input;
- `change-induced safety or regression`: a concrete correctness, security, data-integrity, compatibility, or supported-behavior defect introduced or exposed by the change;
- `optional hardening`: a new extreme, environment, threat model, compatibility promise, or robustness improvement not required by the accepted input and not a concrete regression.

Only the first two classes may block completion. Record optional hardening as a follow-up; do not silently turn it into a new acceptance criterion, implementation goal, or review gate. If an undefined support boundary would materially change implementation, stop and ask the user instead of choosing an unbounded interpretation.

Use the smallest evidence set that directly proves each criterion and relevant failure signal. Deduplicate commands and scenarios that prove the same behavior. By default, run the full suite once in the primary environment and bounded smoke coverage in other supported environments affected by the change. Run full cross-environment matrices only when the accepted input explicitly requires them or the change alters that environment boundary.

## Goal Artifact

Create or resume `.csx/goals/<slug>.md` as the current execution source of truth. Keep it compact:

After a successful loop-authority entry, record the validated loop provenance and accepted boundaries under `Objective and Accepted Boundaries`. This is checkpoint provenance only and does not remain or become live authority.

```markdown
# Goal: <title>

## Objective and Accepted Boundaries

## Current Revision
Current: R000
Latest cause:
Changed paths:
Invalidated current evidence:

## Attempt Counters
- Goal implementation corrections:
  - G001: 0/1
- Final cumulative verification: 0/3
- Verification failure repairs:
  - V001: 0/2
- Environment reruns:
  - V001: 0/1
- Cumulative code review: 0/3
- Review finding repairs:
  - F001: 0/2

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

Keep only the current revision, current goal state, latest valid evidence, attempt counters, and open findings in the active sections. Collapse older revisions to short provenance rows. Increment every applicable attempt counter before dispatching the work or running the command so interruption and resume cannot create a free retry. Give subagents only their goal scope, relevant current diff, criteria, latest evidence, and stop conditions rather than forwarding the complete historical artifact.

Existing artifacts with legacy scoped or integrated verification fields remain resumable. Reconstruct counters from explicit recorded attempts and reviews when possible. When history does not prove a prior count, record `legacy baseline`, initialize the missing counter at zero for future attempts, and do not guess or block resume. Treat legacy verification fields as historical evidence; do not require or produce new independent-agent results.

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
4. Allow the initial Executor assignment to implement, debug, and rerun its targeted verification as needed within its bounded scope. After it returns, allow at most one orchestration-level correction round per goal for a recoverable defect before `ready_for_review`; increment that goal's `0/1` counter before dispatch. If the corrected result is still defective, even with a different defect, or requires ownership expansion or a user-owned decision, stop and report the blocker. Final-verification and review rework use their own counters and neither consume nor reset this implementation correction.
5. For every non-trivial code goal, invoke `$csx-deslop` once with the current revision, owned changed files and tests, accepted invariants, passing targeted verification, current diff, and stop conditions. A low-risk documentation or wording-only goal may record `deslop: not applicable`.
6. Accept only `passed/cleaned` or `passed/no-op` for the final revision. Record its before/after behavior lock and residual risk. On `blocked`, a failed behavior lock, a changed verification command, scope expansion, or revision mismatch, keep the goal below `ready_for_review`, record the blocker, and stop this workflow without assigning another repair.
7. Set the goal to `ready_for_review` when executor verification and required deslop pass. There is no separate scoped evidence agent.

## Final Cumulative Verification

When every goal is `ready_for_review`, execute the accepted cumulative verification on the unchanged current revision. Allow at most three cumulative verification iterations, including the first run and any full rerun invalidated by later code-review rework. Increment the persisted iteration counter before each full run; a new failure or revision never resets it.

- Deduplicate equivalent commands and honor stronger explicit requirements from the accepted plan.
- The root records commands, environment, exit status, and concise raw summaries without changing the success criteria.
- For every failure, assign a stable `Vnnn` identifier from the command or scenario, primary failure signal, and owning goal when one exists. Preserve that identifier while the material failure remains the same, even when wording or line numbers change.
- Classify each failure as exactly one of `product defect`, `test or verification defect`, `environment or transient failure`, or `unknown, scope, or user-decision blocker`.
- For a product defect, map it to the current owning goal. For a test or verification defect, map it to the goal that owns that evidence. Increment the failure's repair counter before bounded Executor rework and allow at most two repairs for the same failure. Rerun only invalidated targeted and deslop evidence, then start the next cumulative verification iteration on the new final revision.
- For an environment or transient failure, do not edit code. Rerun the exact failing command once on the unchanged revision without incrementing the full-iteration counter, and persist its `0/1` environment-rerun counter before execution. If it fails again, stop with a blocker; if it passes, record the transient result and continue the current cumulative verification decision.
- For an unknown failure, ownership or scope expansion, or a user-owned decision, do not guess or edit code; stop and report the blocker.
- Stop before the numeric limits when a repair produces neither new evidence nor a reduction in blockers. Different failures retain distinct repair counters but still share the three-iteration cumulative maximum.
- Do not create a separate integrated evidence agent or criterion-by-criterion verification pass.

## Cumulative Review Loop

After final cumulative verification succeeds, invoke `$csx-code-review` on the same revision with the accepted input, current criteria mapping, cumulative diff, executor/deslop evidence, boundary review, and final command results. Increment the persisted cumulative review counter before each invocation.

1. The code-reviewer lane is always required.
2. The Architect lane is required only when the final diff introduces or departs from a public interface, persisted-data, permission/security, migration, concurrency, cross-module dependency, or operational boundary not already cleared by the current boundary review. Diff size and file count alone do not require it.
3. Only accepted-scope defects and change-induced safety/regression findings may return goals to `rework`. Optional hardening becomes a non-blocking follow-up.
4. Assign and preserve a stable `Fnnn` identifier for each blocking finding from its classification, location, and material defect. Map it to the smallest affected goal and current owner. Ask the Planner for a corrected ownership handoff only when the finding crosses current ownership or requires an accepted-scope file not in the decomposition.
5. Increment the finding's persisted repair counter before Executor rework. Run one union deslop pass for changed paths and affected invariants, the invalidated final verification, and the final review again.
6. Allow at most two bounded repairs for the same blocking finding and at most three cumulative review iterations. Stop earlier when an iteration produces no new evidence or reduction in blockers.

## Complete

Complete only when:

- the accepted plan and every original criterion have current direct evidence;
- every execution goal is `ready_for_review`;
- required deslop reports pass at the current revision;
- the latest cumulative verification succeeds at the unchanged revision;
- the final code review returns `APPROVE`;
- no product code changed afterward.

Then mark goals `complete`, write the completion decision, finish canonical workflow state after that artifact write, and call `update_goal` with `complete` exactly once.
