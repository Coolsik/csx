---
name: csx-code-review
description: Review repository changes with findings first, severity labels, security and maintainability checks, file references, and an explicit approve/comment/request-changes verdict. Use when the user asks for code review or wants changes checked before merging.
---

# csx-code-review

Use this skill in review posture. Findings come before summary.

## Orchestration Boundary

The skill owns review scope, lane selection, parallelism, fail-closed routing, the composite verdict, and artifact persistence. `csx-code-reviewer` owns code-quality findings and its individual recommendation. `csx-architect` owns architectural findings and its individual status. The root must not perform either specialist review itself.

Every reviewer assignment must state:

```text
Objective:
Inputs:
Scope:
Required work/checks:
Expected deliverable:
Required verdict:
Constraints:
Stop conditions:
```

## Scope

Review the current diff unless the user names files, commits, or a PR branch. Preserve unrelated user work.

## Independent Review Lanes

When the caller supplies an evidence or change revision, include it in every required reviewer assignment and require each result plus the composite result to echo it. A missing or mismatched revision is stale review evidence and cannot produce `APPROVE`.

Always spawn `csx-code-reviewer`. Its assignment must include the user request, acceptance criteria when available, review scope, raw diff or commit range, relevant full-file context, tests, and verification artifacts. Require:

- two-stage review: specification and scope compliance before code quality;
- correctness, security, unsafe data handling, error handling, edge cases, regressions, tests, maintainability, and user-facing or documentation impact;
- findings ordered `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, each with path, line, impact, trigger, and concrete fix;
- an individual `APPROVE`, `COMMENT`, or `REQUEST CHANGES` recommendation.

For substantial, cross-module, public-interface, security-sensitive, migration, concurrency, dependency-boundary, or architecture-affecting diffs, also spawn `csx-architect` in parallel. Its assignment must require boundary, coupling, interface, compatibility, migration, operational-impact, strongest-counterargument, and tradeoff review with an individual `CLEAR`, `WATCH`, or `BLOCK` status.

Record `csx-architect: skipped-trivial` only when every condition holds: the diff is localized to one implementation concern; it changes no public interface, persisted data, permission or security boundary, migration, concurrency behavior, cross-module dependency, or operational contract; and targeted evidence covers the behavior. Uncertainty makes the Architect lane required.

Use unique task names, `fork_turns: "none"`, lane-specific stop conditions, and a cap of 3,000 tokens per lane. Wait for every required lane. If `csx-code-reviewer`, or a required Architect lane, is unavailable, ask the user to rerun `csx install`; do not report `APPROVE`. Report `COMMENT` with `required csx role unavailable`.

## Composite Verdict

- `REQUEST CHANGES`: Code Reviewer returns `REQUEST CHANGES`, Architect returns `BLOCK`, or any required verification is missing.
- `COMMENT`: no blocking finding remains, but either lane returns a non-blocking concern, Architect returns `WATCH`, or a required role is unavailable.
- `APPROVE`: Code Reviewer returns `APPROVE`; Architect is `CLEAR` or was validly skipped as trivial; no required evidence is missing.

Reconcile duplicate findings without weakening their severity or required fix. The root may normalize presentation but must not independently dismiss an evidence-backed blocking finding.

## Output

```markdown
# Code Review: <title>

## Evidence Revision
<supplied revision or not supplied>

## Findings
- Severity: CRITICAL/HIGH/MEDIUM/LOW
  Location: file:line
  Issue:
  Recommendation:

## Verification Reviewed

## Independent Review
- csx-code-reviewer: APPROVE / COMMENT / REQUEST CHANGES / unavailable
- csx-architect: CLEAR / WATCH / BLOCK / skipped-trivial / unavailable

## Verdict
APPROVE / COMMENT / REQUEST CHANGES

## Residual Risk
```

For substantial reviews, also write `.csx/reviews/<slug>.md`.
