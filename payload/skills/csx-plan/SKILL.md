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

## Workflow

1. Read the spec and user request.
2. For a raw brownfield request, spawn `csx-explorer` to gather repository conventions, affected boundaries, referenced files or symbols, tests, and verification commands. When an accepted spec already contains current repository evidence, reuse its packet. If the repository changed or material evidence may be stale, ask Explorer to revalidate only the affected claims. A repository-independent greenfield plan may omit Explorer and record that no repository evidence applies.
3. In the root thread, resolve remaining user-owned decisions that would change the plan. Record confirmed decisions, reversible assumptions, and open decisions separately.
4. Always give the request or spec, evidence packet, and user decisions to `csx-planner`. In its assignment require the exact Planner Body Shape below, the smallest viable implementation path, `draft_version: 1`, preserved boundaries, acceptance criteria, concrete sequencing and ownership, the Verification Matrix, risks, stop conditions, and its strongest unresolved risk.
5. A low-risk plan touching one obvious area may skip only independent Critic review and record `Review: SKIPPED_LOW_RISK`. For broad, risky, or cross-module work, give `csx-critic` the original request or accepted spec, every user decision and assumption, the current repository evidence packet, the exact Planner body candidate, and its draft version. Require the Critic to cross-check the draft against all of those inputs before issuing a verdict.
6. Require the Critic to return the reviewed `draft_version` and exactly one verdict:
   - `APPROVED`: the same draft version is ready to finalize.
   - `REVISE`: resume the same Planner when possible with the exact Critic findings and produce `draft_version: 2`. If the Planner cannot be resumed, spawn a fresh `csx-planner` with the complete evidence, decisions, prior draft, and exact Critic findings, and record the fallback in the Review Summary. The root must not rewrite the draft.
   - `BLOCKED`: preserve the best draft with unresolved blockers and do not offer execution.
7. A revised draft MUST receive one fresh Critic review with the same complete input set plus the prior Critic findings. If that review is not `APPROVED`, mark the plan `BLOCKED`; do not revise a third version in `csx-plan`.
8. Any material change after approval invalidates that verdict. A material change alters scope, boundaries, approach, sequence, acceptance criteria, verification, risks, assumptions, or stop conditions.
9. Write `.csx/plans/<slug>.md` for every completed plan whether the final Decision is `READY` or `BLOCKED`. Place the exact final Planner body inside the Artifact Format envelope without modification, then append Critic review provenance and handoff metadata outside that immutable body.

## Root User Decisions

For step 3 and any decision exposed during review, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them to the Planner and Critic.
- Do not ask about facts the Explorer can discover, and do not call the tool when the request is already decision-ready.
- Never delegate this tool call to a sub-agent. Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, or acceptance criteria makes the final plan `BLOCKED`.

## Review Policy

- Never skip Planner delegation while this skill is active. Only repository-independent greenfield work may omit Explorer, and only a low-risk plan touching one obvious area may omit Critic.
- Require Critic to follow the common output discipline while preserving every required review field and verdict.
- Use the exact installed roles `csx-explorer`, `csx-planner`, and `csx-critic`; give each a unique task name, `fork_turns: "none"`, and an explicit stop condition.
- If a required role is missing, ask the user to rerun `csx install` for the intended scope. Mark a non-trivial plan `BLOCKED: required independent role unavailable`; do not present a self-authored plan as independently reviewed.
- The final plan body must be the exact approved draft body. The root may append review provenance and handoff metadata without invalidating approval.

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
APPROVED / SKIPPED_LOW_RISK / BLOCKED
Approved draft_version: <N or N/A>

## Planner Body
<exact final Planner body>

## Critic Review
<exact result for the final reviewed version, or SKIPPED_LOW_RISK>

## Review Summary

## Handoff
```

Keep plans short. Prefer 5-9 concrete steps over exhaustive task trees.

## Final Handoff

After writing the artifact, call `request_user_input` from the root thread.

For `Decision: READY`, show:

1. `Start execution with $csx-start-goal (Recommended)`
2. `Refine further`
3. `Stop`

For `Decision: BLOCKED`, show only:

1. `Refine further (Recommended)`
2. `Stop`

Only an explicit `Start execution with $csx-start-goal` selection authorizes implementation and accepts the listed reversible assumptions. Pass the plan path, approved draft version, boundaries, acceptance criteria, Verification Matrix, risks, and stop conditions to `$csx-start-goal`. Never invoke execution from a BLOCKED plan.
