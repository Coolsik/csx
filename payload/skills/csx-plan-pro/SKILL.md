---
name: csx-plan-pro
description: Higher-rigor planning with bounded Architect then Critic review for broad, risky, or architecture-sensitive work. Use when a normal plan may miss tradeoffs, sequencing, testing strategy, or hidden coupling.
---

# csx-plan-pro

Use this skill when ordinary planning is not enough, but a full external orchestration system would be too heavy.

## Contract

Produce one decision-ready plan with independent review pressure. Do not start implementation.

## Workflow

1. Spawn `csx-explorer` for repository evidence and `csx-analyst` for requirement gaps. Run them in parallel when independent.
2. Give both evidence packets to `csx-planner` for the first draft.
3. Spawn `csx-architect` first. It must provide:
   - strongest counterargument against the favored path
   - hidden coupling or boundary risk
   - at least one tradeoff tension
   - `CLEAR`, `WATCH`, or `BLOCK`
4. After the Architect result returns, spawn `csx-critic` with the draft and that result. It checks:
   - missing acceptance criteria
   - unsafe sequencing
   - weak verification
   - unresolved architect concerns
   - unnecessary complexity
5. Ask `csx-planner` to revise after each review pair.
6. Repeat the sequential Architect then Critic review until no blockers remain, capped at maximum 5 review cycles.
7. Write `.csx/plans/<slug>-pro.md` only after Architect `CLEAR` and Critic `APPROVED`. Mark `BLOCKED` after 5 cycles or any unresolvable blocker.

## Token Budget

- Use exact installed roles and unique task names with `fork_turns: "none"`.
- Architect lane cap: 3,000 tokens.
- Critic lane cap: 3,000 tokens.
- Skip lanes only when the task is already narrow and non-architectural; then use `plan`.
- If any required role is unavailable, ask the user to rerun `csx install` for the intended scope and mark the plan `BLOCKED: required independent role unavailable`.

## Output

```markdown
# Pro Plan: <title>

## Decision
APPROVED / BLOCKED

## Plan

## Architect Review

## Critic Review

## Revisions Made

## Verification Matrix

## Handoff
```

One `csx-architect` pass followed by one `csx-critic` pass is the first cycle. Do not run the two review roles in parallel because the critic must inspect the architect result. Continue until no blockers remain, stopping early only for consensus or `BLOCKED` status.
