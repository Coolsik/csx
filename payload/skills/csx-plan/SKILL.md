---
name: csx-plan
description: Create a concise, executable work plan from a clear request or spec. Use when the user asks to plan, break down work, compare implementation paths, or prepare a task before coding.
---

# csx-plan

Use this skill to produce a practical plan that another Codex turn can execute without a second interview.

## Contract

Produce one versioned plan with explicit readiness, verification, and review provenance. Do not start implementation unless the user explicitly selects the final `$csx-start-goal` handoff.

## Mode Selection

- Use `direct` when the request has scope and acceptance criteria.
- Use `spec-first` when acceptance, non-goals, or decision boundaries are unclear.
- Use `review` when the user provides an existing plan and asks whether it is sound.

## Workflow

1. Read the spec and user request.
2. Spawn `csx-explorer` to gather repository conventions, affected boundaries, referenced files or symbols, and verification commands.
3. In the root thread, resolve remaining user-owned decisions that would change the plan. Record confirmed decisions, reversible assumptions, and open decisions separately.
4. Give the evidence packet and user decisions to `csx-planner`. Ask for the smallest viable implementation path with `draft_version: 1`, boundaries, acceptance criteria, sequencing, risks, verification, and stop conditions.
5. A low-risk plan touching one obvious area may skip independent review and record `Review: SKIPPED_LOW_RISK`. For broad, risky, or cross-module work, give the exact draft version to `csx-critic`.
6. Require the Critic to return the reviewed `draft_version` and exactly one verdict:
   - `APPROVED`: the same draft version is ready to finalize.
   - `REVISE`: resume the same Planner when possible and produce `draft_version: 2` from the consolidated feedback. If the Planner cannot be resumed, spawn a fresh `csx-planner` with the complete evidence, decisions, prior draft, and feedback, and record the fallback in the Review Summary.
   - `BLOCKED`: preserve the best draft with unresolved blockers and do not offer execution.
7. A revised draft MUST receive one fresh Critic review. If that review is not `APPROVED`, mark the plan `BLOCKED`; do not revise a third version in `csx-plan`.
8. Any material change after approval invalidates that verdict. A material change alters scope, boundaries, approach, sequence, acceptance criteria, verification, risks, assumptions, or stop conditions.
9. Write `.csx/plans/<slug>.md` for every completed plan whether the final Decision is `READY` or `BLOCKED`. This artifact is the source passed to refinement or execution.

## Root User Decisions

For step 3 and any decision exposed during review, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them to the Planner and Critic.
- Do not ask about facts the Explorer can discover, and do not call the tool when the request is already decision-ready.
- Never delegate this tool call to a sub-agent. Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, or acceptance criteria makes the final plan `BLOCKED`.

## Review Policy

- Skip Explorer/Planner delegation only for a low-risk plan that touches one obvious area; still assign `draft_version: 1` and record `Review: SKIPPED_LOW_RISK`.
- Critic lane cap: 2,000 tokens.
- Use the exact installed roles `csx-explorer`, `csx-planner`, and `csx-critic`; give each a unique task name, `fork_turns: "none"`, and an explicit stop condition.
- If a required role is missing, ask the user to rerun `csx install` for the intended scope. Mark a non-trivial plan `BLOCKED: required independent role unavailable`; do not present a self-authored plan as independently reviewed.
- The final plan body must be the exact approved draft body. The root may append review provenance and handoff metadata without invalidating approval.

## Verification Matrix

Map every acceptance criterion to at least one row:

| Criterion | Evidence | Command or Scenario | Expected Result | Failure Signal |
|---|---|---|---|---|
| C1 | ... | ... | ... | ... |

Reject vague verification such as "works", "fast", or "robust" unless the plan defines an observable threshold.

## Plan Format

```markdown
# Plan: <title>

## Decision
READY / BLOCKED

## Review
APPROVED / SKIPPED_LOW_RISK / BLOCKED
Approved draft_version: <N or N/A>

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
