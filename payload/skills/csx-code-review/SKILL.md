---
name: csx-code-review
description: Review repository changes with findings first, severity labels, security and maintainability checks, file references, and an explicit approve/comment/request-changes verdict. Use when the user asks for code review or wants changes checked before merging.
---

# csx-code-review

Use this skill in review posture. Findings come before summary.

## Scope

Review the current diff unless the user names files, commits, or a PR branch. Preserve unrelated user work.

## Independent Review Lanes

For substantial diffs, run two Codex subagent lanes in parallel:

- `csx-code-reviewer`: correctness, security, tests, maintainability, and concrete file findings.
- `csx-architect`: boundaries, coupling, tradeoffs, long-term design risk, and strongest counterargument.

Give each lane the user request, review scope, raw diff or commit range, and verification artifacts. Use unique task names, `fork_turns: "none"`, and explicit stop conditions. Wait for both and reconcile overlapping findings against source. Skip lanes only for trivial diffs where independent review would add no signal. Lane cap: 3,000 tokens each.

If either required role is unavailable for a substantial review, ask the user to rerun `csx install` for the intended scope; do not report `APPROVE`. Report `COMMENT` with `required csx role unavailable`.

## Checklist

- Correctness and regressions
- Security and unsafe data handling
- Error handling and edge cases
- Test coverage and verification gaps
- Maintainability, duplication, and unnecessary complexity
- User-facing behavior and documentation impact

## Verdict Rules

- `REQUEST CHANGES`: any likely bug, security issue, broken behavior, or missing required verification.
- `REQUEST CHANGES`: architect lane reports an unresolved boundary or design blocker.
- `COMMENT`: non-blocking concerns or tradeoffs.
- `COMMENT`: a required csx role was unavailable for a substantial diff.
- `APPROVE`: no blocking findings after inspecting the relevant diff and tests.

## Output

```markdown
# Code Review: <title>

## Findings
- Severity: CRITICAL/HIGH/MEDIUM/LOW
  Location: file:line
  Issue:
  Recommendation:

## Verification Reviewed

## Independent Review
- csx-code-reviewer: APPROVE / COMMENT / REQUEST CHANGES / unavailable
- csx-architect: CLEAR / WATCH / BLOCK / unavailable

## Verdict
APPROVE / COMMENT / REQUEST CHANGES

## Residual Risk
```

For substantial reviews, also write `.csx/reviews/<slug>.md`.
