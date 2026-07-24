---
name: csx-spec
description: Lightweight requirements clarification that turns vague work into a concise specification artifact. Use when a request lacks acceptance criteria, scope boundaries, user intent, non-goals, or decision ownership before planning or implementation.
---

# csx-spec

Use this skill to convert ambiguity into an actionable spec with minimal questioning.

## Rules

- Ask at most one question at a time.
- Prefer repository inspection over asking the user for facts Codex can discover.
- Stop questioning when the remaining unknowns do not change the first implementation plan.
- Write the final artifact to `.csx/specs/<slug>.md` when the task is more than a one-turn clarification.

## Independent Checks

For a non-trivial spec, use the installed csx roles:

- `csx-explorer`: inspect discoverable repository facts and return an evidence packet.
- `csx-analyst`: independently challenge outcome, scope, non-goals, acceptance criteria, assumptions, and decision boundaries.

Spawn independent lanes in parallel when neither depends on the other's result. Use unique task names, `fork_turns: "none"`, explicit stop conditions, and a combined cap of about 4,000 tokens. The main context owns user questions and writes the final artifact.

If a required csx role is missing, ask the user to rerun `csx install` for the intended scope. For a trivial clarification only, continue with explicit `Assumptions` and `Open Questions` and label the artifact `DEGRADED: independent analysis unavailable`.

## Fast Ambiguity Check

Score each dimension as `clear`, `partial`, or `unknown`:

| Dimension | Meaning |
| --- | --- |
| Outcome | What should change for the user |
| Scope | Files, surfaces, or systems likely involved |
| Non-goals | What must stay out |
| Acceptance | How done will be recognized |
| Decisions | What Codex may decide without asking |

Ask only about the highest-risk `unknown`. If three or more dimensions are `unknown`, ask for a one-paragraph target outcome before planning.

## Artifact Shape

```markdown
# Spec: <title>

## Outcome

## Scope

## Non-goals

## Acceptance Criteria

## Codex Decision Boundaries

## Assumptions

## Evidence Inspected

## Open Questions
```
