---
name: csx-loop
description: Explicitly orchestrate one bounded request through CSX specification, planning, execution, and completion with resumable checkpoints and fail-closed authority.
---

# csx-loop

Use this skill only for an explicit `$csx-loop <request>`, `csx loop <request>`, `$csx-loop resume <work-slug>`, or `csx loop resume <work-slug>` invocation. One invocation owns one bounded work slug and one aggregate goal. This is a declarative orchestration contract for the Codex host, not a runner, daemon, background service, MCP server, or new state system.

## Orchestration Boundary

The root `csx-loop` context owns explicit invocation validation, the bounded loop context, live continuation authority, fixed stage ordering, planning-branch selection, child-workflow assignment, checkpoint validation, progress and blocker reporting, and the final aggregate completion gate.

`$csx-spec` owns requirements analysis, decisions, readiness, and the spec artifact. Exactly one of `$csx-plan` or `$csx-plan-pro` owns the plan and its existing review gate. `$csx-start-goal` owns goal creation or resume, implementation, deslop, verification, cumulative review, and aggregate goal completion. Each child skill owns and monitors its own specialist agents. The loop root must not spawn those internal roles, recreate their judgments, rewrite immutable child bodies, relax their retry or review limits, or report a child stage successful before that child returns its required final status.

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

Assignments to child workflows must additionally pass the current bounded loop context, the live-authority binding for only that transition, the accepted artifact inputs, the expected return status and fields, and the instruction to preserve standalone behavior when either the context or live authority is invalid.

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

## Bounded Loop Context

Derive one stable `work_slug` from the initial request. Pass and, only in the child artifact areas that permit workflow provenance or handoff metadata, checkpoint these fields:

```text
source: csx-loop
original_invocation: <exact direct or shorthand initial command>
original_request: <bounded request text>
work_slug: <stable slug>
spec_path: <matching final spec path or none>
spec_status: READY | READY_WITH_ASSUMPTIONS | BLOCKED | none
spec_recommendation: csx-start-goal | csx-plan | csx-plan-pro | none
plan_kind: csx-plan | csx-plan-pro | none
plan_path: <the one matching plan path or none>
plan_status: READY | APPROVED | BLOCKED | none
accepted_reversible_assumptions: <explicit list>
last_completed_stage: none | csx-spec | csx-plan | csx-plan-pro | csx-start-goal
remaining_stages: <ordered list>
continuation_authority: initial-call | renewed-by-answer | explicit-resume
repository_marker: <checkpoint repository marker>
affected_evidence: <evidence and boundaries that marker changes can invalidate>
pending_decision: none | <stable id, work_slug, stage, controlled downstream decision>
attempt_counters: <preserved explicit child review, retry, verification, and repair counts>
```

The stored `continuation_authority` value is audit provenance only. It is never a credential and cannot by itself authorize a child call, a transition, or execution. A copied or edited enum, modified artifact, reference to an earlier prompt, or unrelated user answer creates no live authority.

Do not create `.csx/loops`, a public approval token, or any other loop state artifact. Preserve immutable spec and planner bodies; append only metadata that the owning child contract permits.

## Live Continuation Authority

Create live authority only from the current prompt in exactly one of these cases:

1. `initial-call`: the current prompt is an explicit direct or shorthand loop request with a non-empty bounded request. It remains a source only while orchestration is uninterrupted.
2. `renewed-by-answer`: the current input is the answer to the exact outstanding question and matches the artifact's `work_slug`, stage, and stable `pending_decision`. A nearby, stale, or unrelated answer does not qualify.
3. `explicit-resume`: the entire current prompt is exactly `$csx-loop resume <work-slug>` or `csx loop resume <work-slug>`, with no extra request text, and the slug exactly matches the artifacts.

Bind each live authority instance to:

```text
work_slug
current_stage
next_transition
pending_decision: <stable id or none>
current_user_turn
consumed: false
```

Validate all binding fields immediately before child entry, then consume that authority exactly once. It cannot be reused for a second child call or a repeated entry. After a successful child return, derive authority for the single next transition from the current-turn source only when the same orchestration remains uninterrupted. Never derive across a user question, stop, cancellation, unrelated turn, reported blocker, or ended workflow.

Invalidate live authority immediately when any binding or context field is missing or conflicting. Stop before downstream work with `BLOCKED: invalid loop approval context`; do not infer authority from persisted provenance and do not fall back to standalone execution approval.

## Fixed Workflow

The only normal flow is:

```text
csx-spec -> exactly one of csx-plan | csx-plan-pro -> csx-start-goal
```

Planning is never skipped, even for a small or obvious change. Enter a stage only after the preceding child has returned and its matching artifact and required final status have been validated.

### 1. Initialize or Recover

- Validate the explicit invocation, one bounded request, stable slug, original input boundary, current repository marker, matching artifacts, and active goal.
- On an initial call, do not silently adopt stale or conflicting same-slug artifacts.
- On a continued answer or resume, follow the checkpoint and resume rules below before deriving live authority.
- Announce the current stage, last completed stage, next transition, and any revalidation being performed.

### 2. Run csx-spec

- Invoke `$csx-spec` with context and live authority bound only to the spec entry.
- Accept only `READY` or `READY_WITH_ASSUMPTIONS` with the final spec path, status, downstream recommendation, accepted reversible assumptions, repository marker, and loop provenance.
- In validated loop mode, the child returns those fields to this parent without its standalone handoff question and without invoking a downstream workflow itself.
- On `BLOCKED`, accept only the matching incomplete-spec draft checkpoint described below, invalidate live authority, and stop without selecting or invoking a plan. An invalid or missing return also stops without a plan.

### 3. Select and Run Exactly One Plan

Map the validated spec recommendation deterministically:

| Spec recommendation or accepted classification | Loop plan |
| --- | --- |
| `csx-start-goal` | `$csx-plan` |
| `csx-plan` | `$csx-plan` |
| `csx-plan-pro` | `$csx-plan-pro` |
| Broad, high-risk, cross-module, or architecture-sensitive work | `$csx-plan-pro` |
| Other bounded work requiring ordinary sequencing, risk, or verification planning | `$csx-plan` |

The explicit risk classification must agree with the spec boundary and recommendation. If it conflicts or could change the plan branch, stop rather than guessing. Never call both planning skills and never create both plan artifacts.

- Accept `$csx-plan` only with `Decision: READY`.
- Accept `$csx-plan-pro` only with `Decision: APPROVED`, including same-version Architect `CLEAR` and Critic `APPROVED`.
- In validated loop mode, the selected plan child returns its path, kind, status, accepted version and assumptions, repository marker, and loop provenance without its standalone execution handoff question.
- Do not invoke `$csx-start-goal` before the selected plan's complete success gate. A `BLOCKED`, `REVISE`, `WATCH`, review exhaustion, version mismatch, or invalid return stops the loop.

### 4. Run csx-start-goal

- Confirm exactly one accepted plan artifact, its expected status, matching slug and input boundary, current repository evidence, accepted assumptions, preserved counters, and live authority bound only to start-goal entry.
- Pass the validated loop context as the current-turn execution selection equivalent for this entry only. It does not weaken any other `$csx-start-goal` gate.
- Let `$csx-start-goal` own implementation and completion. Do not duplicate its goal, retry, deslop, verification, review, or completion work in the loop root.

## Recommended Choice Policy

Auto-select a child question only when all of these are true:

- it offers exactly 2-3 mutually exclusive choices;
- the first choice is explicitly labeled `Recommended`;
- the recommendation is safe, reversible, and within the accepted request, spec, assumptions, and current stage;
- it does not change a user-owned public behavior, data treatment, support boundary, scope, acceptance criterion, or implementation boundary; and
- it is not a permission or safety gate and does not authorize deployment, an external message, deletion, additional permission, or another irreversible side effect.

Record the selected recommendation, the child's recommendation reason, and the stage where it was applied in progress output or permitted child provenance. Position alone is not a recommendation.

For every other plan-changing choice, do not answer on the user's behalf. Persist one stable pending-decision identifier without changing it on re-report, invalidate live authority, and stop with:

```text
BLOCKING_USER_DECISION
work_slug: <slug>
pending_decision: <stable identifier>
last_completed_stage: <stage>
controlled_downstream_decision: <what the answer changes>
continuation_effect: Answering this exact pending decision continues the remaining workflow and implementation.
resume: $csx-loop resume <work-slug>
```

Ask the decision itself with its available choices or open-ended requirement. Only the exact answer in that pending context may create `renewed-by-answer`. The resume command does not answer the unresolved decision; it restores and reports the same blocker until the answer is supplied.

## Hard Stops

Invalidate live authority and invoke no downstream stage after any of these:

- any child `BLOCKED` result;
- a required CSX role is missing or remains unavailable after the common liveness policy;
- a child review, revision, retry, verification, or repair limit is exhausted;
- user stop or cancellation;
- `get_goal` reports a distinct active aggregate goal;
- duplicate plan artifacts, mismatched slug or original boundary, stale or conflicting artifact status, plan-branch conflict, or repository evidence that can change a boundary;
- a permission or safety gate, including deployment, external messaging, deletion, additional permission, or irreversible side effect.

Report the blocker, last completed stage, preserved checkpoint, and required recovery action. In particular, never auto-select or auto-loop `Refine further` from a `BLOCKED` child. A hard stop ends the current uninterrupted orchestration.

## Checkpoint and Resume

`$csx-spec` is the producer of `.csx/specs/<work-slug>.draft.md`; the parent `$csx-loop` may consume that path only while the `csx-spec` stage is incomplete. The draft must have `Status: BLOCKED` and is only a clarification checkpoint. Never treat a draft as a final spec, `READY`, `READY_WITH_ASSUMPTIONS`, or authority to select a plan or enter `$csx-start-goal`.

Before accepting the draft checkpoint, require and cross-check all of this fail-closed resume context in its permitted provenance or checkpoint metadata:

- `source: csx-loop`, the matching `work_slug`, and the matching `original_invocation` and `original_request` boundary;
- `last_completed_stage` that does not claim `csx-spec` completion and the fixed ordered `remaining_stages` whose first item is `csx-spec`;
- the stable `pending_decision` whose embedded `work_slug` matches and whose `stage` is `csx-spec`, including the exact outstanding question and controlled downstream decision;
- every explicit `attempt_counters` value and stored `continuation_authority` audit provenance; and
- the checkpoint `repository_marker` and `affected_evidence`.

Missing, stale, or conflicting draft context is not a checkpoint and creates no authority. Do not infer a field, change the stable pending-decision identifier, or combine a draft with another slug, original boundary, stage, or repository marker.

For an exact pending-decision answer, consume the matching draft only to validate `renewed-by-answer`, pass that answer back into the incomplete `$csx-spec` stage, and require a fresh child readiness result. For an exact `$csx-loop resume <work-slug>` or `csx loop resume <work-slug>`, consume the matching draft only to validate `explicit-resume` and re-enter the incomplete `$csx-spec` stage. Only after the persisted checkpoint fields pass may live authority bind its `current_stage` to `csx-spec`; do not persist `current_stage` as an alternate loop-context field. Resume does not answer an unresolved question: restore and report the same stable blocker until its exact answer arrives. No initial call, unrelated answer, or stale, mismatched, or nearby answer or resume may reuse or alter the draft or create authority.

Only after resumed `$csx-spec` returns `READY` or `READY_WITH_ASSUMPTIONS`, writes `.csx/specs/<work-slug>.md`, and proves that it retained every material draft decision may the final spec replace the draft as the completed `csx-spec` checkpoint. Then continue through exactly one planning stage and `$csx-start-goal` in the fixed order. Do not rerun any already completed final stage.

The draft never replaces `.csx/specs/<work-slug>.md`, exactly one of `.csx/plans/<work-slug>.md` or `.csx/plans/<work-slug>-pro.md`, or `.csx/goals/<work-slug>.md`. Those final artifacts remain the only completed-stage checkpoints. Do not create `.csx/loops` or any other loop state artifact.

For an exact resume prompt or an exact pending-decision answer:

1. Validate original invocation provenance, request boundary, slug, child artifact status, selected plan kind, repository marker, same active goal or absence of a goal, and every explicit attempt counter.
2. If the repository marker changed, revalidate only evidence and boundaries affected by that change. Reuse unaffected current evidence.
3. Stop without overwrite when slug, input boundary, plan branch, artifact status, accepted assumptions, or acceptance criteria conflict. Never delete or regenerate a conflicting completed artifact.
4. Preserve all review, revision, retry, verification, and repair counters. Never reset them on resume.
5. Find the first incomplete stage in the fixed order. Reuse valid completed stages and do not rerun or regenerate them.
6. Create the applicable current-prompt live authority and continue only after all checks pass.

An enum-only artifact, wrong slug, extra text on a resume prompt, unrelated answer, stale boundary evidence, or distinct active goal is not resumable authority.

## Progress and Completion

At every stage boundary report the work slug, current stage, validated completion status, last completed stage, next stage or blocker, applied recommendation and reason when any, and the live-authority provenance source without presenting persisted provenance as a credential.

Report overall success only after `$csx-start-goal` returns final current evidence and the matching goal artifact proves all of the following on one unchanged revision:

- every original acceptance criterion has current direct evidence;
- every execution goal and required deslop result is complete at that revision;
- final cumulative verification passed;
- cumulative code review approved;
- no later change invalidated verification or review;
- `Completion Decision` is complete; and
- the aggregate Codex goal was completed with `update_goal complete`.

If any item is missing, stale, or conflicting, do not report success. Return the last valid stage and blocker, preserving the checkpoint for an exact answer or resume.
