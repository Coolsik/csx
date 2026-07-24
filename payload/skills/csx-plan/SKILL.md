---
name: csx-plan
description: Create a concise, executable work plan from a clear request or spec. Use when the user asks to plan, break down work, compare implementation paths, or prepare a task before coding.
---

# csx-plan

Use this skill to produce a practical plan that another Codex turn can execute without a second interview.

## Mode Selection

- Use `direct` when the request has scope and acceptance criteria.
- Use `spec-first` when acceptance, non-goals, or decision boundaries are unclear.
- Use `review` when the user provides an existing plan and asks whether it is sound.

## Workflow

1. Read the spec and user request.
2. Spawn `csx-explorer` to gather repository conventions, affected boundaries, and verification commands.
3. In the root thread, resolve any remaining user-owned decisions that would change the plan.
4. Give the evidence packet and user decisions to `csx-planner` and ask it for the smallest viable implementation path, sequencing, risks, and stop conditions.
5. For broad, risky, or cross-module work, give the draft to `csx-critic` to challenge scope, sequencing, and verification.
6. Reconcile the returned evidence and criticism in the main context. Define verification before implementation details.
7. Write `.csx/plans/<slug>.md` for multi-step work.

## Root User Decisions

When step 3 finds unresolved preferences or tradeoffs, call `request_user_input` from the root thread.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them to the planner and critic.
- Do not ask about facts the explorer can discover, and do not call the tool when the request is already decision-ready.
- Never delegate this tool call to a sub-agent. Fall back to a direct text question if the tool is unavailable.

## Review Policy

- Skip the explorer/planner delegation only for a low-risk plan that touches one obvious area.
- Critic lane cap: 2,000 tokens.
- If the critic rejects the plan, revise once or mark the plan `BLOCKED`.
- Use the exact installed roles `csx-explorer`, `csx-planner`, and `csx-critic`; give each a unique task name, `fork_turns: "none"`, and an explicit stop condition.
- If a required role is missing, ask the user to rerun `csx install` for the intended scope. Do not present a non-trivial self-authored plan as independently reviewed.

## Plan Format

```markdown
# Plan: <title>

## Goal

## Assumptions

## Steps
1. ...

## Verification

## Risks

## Self-Critique

## Stop Conditions
```

Keep plans short. Prefer 5-9 concrete steps over exhaustive task trees.
