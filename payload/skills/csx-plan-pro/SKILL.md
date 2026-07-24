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
2. In the root thread, resolve user-owned decisions exposed by those evidence packets.
3. Give both evidence packets and user decisions to `csx-planner` for the first draft.
4. Spawn `csx-architect` first. It must provide:
   - strongest counterargument against the favored path
   - hidden coupling or boundary risk
   - at least one tradeoff tension
   - `CLEAR`, `WATCH`, or `BLOCK`
5. After the Architect result returns, spawn `csx-critic` with the draft and that result. It checks:
   - missing acceptance criteria
   - unsafe sequencing
   - weak verification
   - unresolved architect concerns
   - unnecessary complexity
6. If either review exposes a new user-owned decision, resolve it in the root thread before revision.
7. Ask `csx-planner` to revise after each review pair, including any new user decision.
8. Repeat the sequential Architect then Critic review until no blockers remain, capped at maximum 5 review cycles.
9. Write `.csx/plans/<slug>-pro.md` only after Architect `CLEAR` and Critic `APPROVED`. Mark `BLOCKED` after 5 cycles or any unresolvable blocker.

## Root User Decisions

For steps 2 and 6, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them through planner, architect, and critic reviews.
- Never delegate this tool call to a sub-agent.
- Fall back to a direct text question if the tool is unavailable.

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
