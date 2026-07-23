---
name: plan
description: Create a concise, executable work plan from a clear request or spec. Use when the user asks to plan, break down work, compare implementation paths, or prepare a task before coding.
---

# plan

Use this skill to produce a practical plan that another Codex turn can execute without a second interview.

## Mode Selection

- Use `direct` when the request has scope and acceptance criteria.
- Use `spec-first` when acceptance, non-goals, or decision boundaries are unclear.
- Use `review` when the user provides an existing plan and asks whether it is sound.

## Workflow

1. Read the spec and user request.
2. Spawn `csx-explorer` to gather repository conventions, affected boundaries, and verification commands.
3. Give the evidence packet to `csx-planner` and ask it for the smallest viable implementation path, sequencing, risks, and stop conditions.
4. For broad, risky, or cross-module work, give the draft to `csx-critic` to challenge scope, sequencing, and verification.
5. Reconcile the returned evidence and criticism in the main context. Define verification before implementation details.
6. Write `.csx/plans/<slug>.md` for multi-step work.

## Review Policy

- Skip the explorer/planner delegation only for a low-risk plan that touches one obvious area.
- Critic lane cap: 2,000 tokens.
- If the critic rejects the plan, revise once or mark the plan `BLOCKED`.
- Use the exact installed roles `csx-explorer`, `csx-planner`, and `csx-critic`; give each a unique task name, `fork_turns: "none"`, and an explicit stop condition.
- If a required role is missing, ask the user to run `$csx:setup`. Do not present a non-trivial self-authored plan as independently reviewed.

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
