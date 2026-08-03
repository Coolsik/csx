---
name: csx-plan
description: Create a concise, executable work plan from a clear request or spec. Use when the user asks to plan, break down work, compare implementation paths, or prepare a task before coding.
---

# csx-plan

Use this skill to produce a practical plan that another Codex turn can execute without a second interview.

## Contract

Produce one versioned plan with explicit readiness, verification, and review provenance. Do not start implementation unless the user explicitly selects the final `$csx-start-goal` handoff.

The skill owns request routing, user decisions, assignment construction, review routing, version state, artifact persistence, and handoff. `csx-explorer` owns repository facts, `csx-planner` owns every plan draft, and `csx-critic` owns independent plan review. The root must not author or independently repair a plan when a required role is available.

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

## Entry Routing

- If the input is an accepted csx spec, treat its scope, non-goals, constraints, acceptance criteria, decisions, and evidence packet as the requirements source of truth. Do not repeat requirements discovery.
- If a raw request lacks acceptance criteria, non-goals, or decision boundaries that can change implementation, invoke `$csx-spec` from the root and stop this planning pass. Continue only from its final spec when the user has explicitly selected the `$csx-plan` handoff. Do not fill the gap with root-authored requirements.
- If the request is already decision-ready, or the user supplied an existing plan for review, continue with the workflow below. Give an existing plan to the Planner as input rather than treating it as an independently approved draft.

## csx-loop Composition Contract

Loop-aware behavior is a bounded return path to an invoking `$csx-loop`, not another planning mode. Validate the incoming context against the exact `$csx-loop` schema, with no alternate fields or token:

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

Require `source: csx-loop`, `plan_kind: csx-plan`, a matching accepted spec and `work_slug`, and a complete internally consistent context. Require current live authority bound to this `work_slug`, current stage, the `csx-plan` transition, exact `pending_decision` or `none`, and current user turn with `consumed: false`. The stored `continuation_authority: initial-call | renewed-by-answer | explicit-resume` is audit provenance only; a persisted enum, copied metadata, earlier prompt, stale answer, or unrelated answer is not live authority.

Validate every binding immediately before entry and consume the authority exactly once. Only the parent loop may derive authority for the one next transition from the same current-turn source after a successful child return. A question, blocker, cancellation, unrelated turn, or ended workflow invalidates it. This child must not derive or forward live authority.

This branch never approves deployment, an external message, deletion, additional permission, or an irreversible side effect on product or user data. Those actions always require their own approval. Deleting only `.csx/plans/<slug>.draft.md` after verified finalization is the bounded internal artifact cleanup defined by this skill, not authority for any other deletion. Missing or invalid loop context or live authority preserves the standalone explicit-selection workflow.

## Workflow

1. Read the spec and user request.
2. For a raw brownfield request, spawn `csx-explorer` to gather repository conventions, affected boundaries, referenced files or symbols, tests, and verification commands. When an accepted spec already contains current repository evidence, reuse its packet. If the repository changed or material evidence may be stale, ask Explorer to revalidate only the affected claims. A repository-independent greenfield plan may omit Explorer and record that no repository evidence applies.
3. In the root thread, resolve remaining user-owned decisions that would change the plan. Record confirmed decisions, reversible assumptions, and open decisions separately.
4. Always give the request or spec, evidence packet, and user decisions to `csx-planner`. In its assignment require the exact Planner Body Shape below, the smallest viable implementation path, `draft_version: 1`, preserved boundaries, acceptance criteria, concrete sequencing and ownership, the Verification Matrix, risks, stop conditions, and its strongest unresolved risk.
5. Immediately after each Planner result arrives, write the complete response verbatim to `.csx/plans/<slug>.draft.md`. Verbatim means byte-for-byte, including the required diagnostics line. Persist it before parsing, summarizing, reviewing, or requesting another agent action. The temporary draft is the sole plan candidate for that version; the root may inspect metadata but must not normalize, repair, or rewrite the Planner body. Read the persisted file back and require its embedded `draft_version` to match the expected version before review.
6. Always give `csx-critic` the draft path, its `draft_version`, and the accepted spec path, plus every user decision and assumption and the current repository evidence packet. Do not relay the Planner body in the Critic assignment. Critic must read the temporary file directly and compare its complete Planner body against the accepted spec, including scope, non-goals, constraints, acceptance criteria, decisions, and evidence. For a decision-ready raw request with no accepted spec, use the original request and recorded decisions as the requirements source and explicitly record that fallback. Require Critic to confirm that the version in the file matches the assigned `draft_version` before issuing a verdict.
7. Require the Critic to return the reviewed `draft_version` and exactly one verdict:
   - `APPROVED`: the same draft version is ready to finalize.
   - `REVISE`: return the exact Critic findings to the Planner for another versioned draft.
   - `BLOCKED`: preserve the best draft with unresolved user-owned or otherwise unresolvable blockers and do not offer execution.
8. For `REVISE`, resume the same Planner when possible with the temporary draft path, exact Critic findings, and user decisions, and require it to increment `draft_version` by exactly one. If the Planner cannot be resumed, spawn a fresh `csx-planner` with the complete evidence, decisions, temporary draft path, and exact Critic findings, and record the fallback in the Review Ledger. When the next Planner result arrives, repeat the immediate verbatim persistence gate in step 5 before any further action. The root must not rewrite the draft.
9. Every revised draft MUST receive one fresh Critic review with the same complete input set plus the prior Critic findings. Repeat until `APPROVED`, an unresolvable `BLOCKED` verdict, or a maximum of 5 review cycles. Failure to reach approval after cycle 5 produces a `BLOCKED` artifact containing the best draft and unresolved blockers.
10. Any material change after approval invalidates that verdict and starts the next versioned review cycle, subject to the same 5-cycle maximum. A material change alters scope, boundaries, approach, sequence, acceptance criteria, verification, risks, assumptions, or stop conditions.
11. Only `APPROVED` for the same persisted `draft_version` authorizes finalization. For `READY`, write `.csx/plans/<slug>.md` from the exact approved Planner body inside the Artifact Format envelope without modification, then append Critic review provenance, the Review Ledger, and handoff metadata outside that immutable body. Read the final artifact back and verify its Planner body and approved version against the temporary draft. Delete `.csx/plans/<slug>.draft.md` only after the final artifact has been written and verified. If final writing or verification fails, retain the temporary draft and do not offer execution; if deletion fails, report the cleanup failure and do not report `READY`.
12. Write `.csx/plans/<slug>.md` for every completed plan whether the final Decision is `READY` or `BLOCKED`. A terminal `BLOCKED` result is a non-executable failure artifact rather than approved finalization: assemble it from the best persisted Planner body and unresolved blockers, and retain `.csx/plans/<slug>.draft.md` for inspection or refinement.

## Root User Decisions

For step 3 and any decision exposed during review, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them to the Planner and Critic.
- Do not ask about facts the Explorer can discover, and do not call the tool when the request is already decision-ready.
- Never delegate this tool call to a sub-agent. Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, or acceptance criteria makes the final plan `BLOCKED`.

## Review Policy

- Never skip Planner delegation while this skill is active. Only repository-independent greenfield work may omit Explorer. Never skip Critic review while this skill is active.
- Require Critic to follow the common output discipline while preserving every required review field and verdict.
- Use the exact installed roles `csx-explorer`, `csx-planner`, and `csx-critic`; give each a unique task name, `fork_turns: "none"`, and an explicit stop condition.
- If a required role is missing, ask the user to rerun `csx install` for the intended scope. Mark the plan `BLOCKED: required independent role unavailable`; do not present a self-authored plan as independently reviewed.
- The final plan body must be the exact approved body read from `.csx/plans/<slug>.draft.md`. The root may append review provenance and handoff metadata without invalidating approval.

## Verification Matrix

The Planner assignment must map every acceptance criterion to at least one row:

| Criterion | Evidence | Command or Scenario | Expected Result | Failure Signal |
|---|---|---|---|---|
| C1 | ... | ... | ... | ... |

The Critic assignment must reject vague verification such as "works", "fast", or "robust" unless the plan defines an observable threshold.

Apply these proportionality rules:

- Use the smallest evidence set that directly proves the accepted criteria and relevant failure signals. One scenario may cover several related criteria.
- Separate accepted scope and concrete change-induced safety or regression risks from optional hardening. Do not make new extremes, environments, threat models, or compatibility promises blocking plan requirements.
- Default to one full suite in the primary environment plus bounded smoke coverage in other supported environments affected by the change. Require full cross-environment matrices only when the accepted input or changed boundary requires them.
- If a support limit is undefined and choosing it changes the implementation, return it as a user decision rather than planning for an unbounded domain.
- The Critic must reject duplicated verification rows and scope-expanding hardening presented as required work.

## Planner Body Shape

The Planner owns and returns this complete immutable body:

```markdown
# Plan: <title>

draft_version: <N>

## Goal and Boundaries

## Decisions and Assumptions
### User-confirmed Decisions
### Reversible Assumptions
### Open Decisions

## Acceptance Criteria

## Steps
1. ...

## Verification Matrix

## Risks and Stop Conditions
```

## Artifact Format

```markdown
# Plan: <title>

## Decision
READY / BLOCKED

## Review
APPROVED / BLOCKED
Approved draft_version: <N or N/A>

## Planner Body
<exact final Planner body>

## Critic Review
<exact result for the final reviewed version>

## Review Summary

## Review Ledger
| Cycle | Draft Version | Critic | Revision Reason |

## Handoff
```

Keep plans short. Prefer 5-9 concrete steps over exhaustive task trees.

## Final Handoff

For a validated loop context whose selected kind is `csx-plan`, whose accepted spec and slug match, and whose current plan-transition authority was consumed, replace the standalone handoff only when the final artifact has `Decision: READY`. Return `plan_path`, `plan_kind: csx-plan`, `plan_status: READY`, the accepted `draft_version`, accepted reversible assumptions, repository marker, and complete loop provenance to the parent `$csx-loop`; do not call `request_user_input` and do not invoke `$csx-start-goal`. The immutable Planner Body and the maximum of 5 review cycles remain unchanged.

For `Decision: BLOCKED`, a required-role failure, or review exhaustion, return `BLOCKED`, the blocker, the last valid checkpoint, and the temporary draft path when it exists to the parent and invalidate authority. Never auto-select `Refine further`. The parent alone may validate the return and derive the start-goal transition. If the loop context or live authority is absent or invalid, use the standalone handoff below unchanged.

After writing the artifact, call `request_user_input` from the root thread.

For `Decision: READY`, show:

1. `Start execution with $csx-start-goal (Recommended)`
2. `Refine further`
3. `Stop`

For `Decision: BLOCKED`, show only:

1. `Refine further (Recommended)`
2. `Stop`

Only an explicit `Start execution with $csx-start-goal` selection authorizes implementation and accepts the listed reversible assumptions. Pass the plan path, approved draft version, boundaries, acceptance criteria, Verification Matrix, risks, and stop conditions to `$csx-start-goal`. Never invoke execution from a BLOCKED plan.
