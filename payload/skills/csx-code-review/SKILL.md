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

## Scope

Review the current diff unless the user names files, commits, or a PR branch. Preserve unrelated user work.

## Independent Review Lanes

When the caller supplies an evidence or change revision, include it in every required reviewer assignment and require each result plus the composite result to echo it. A missing or mismatched revision is stale review evidence and cannot produce `APPROVE`.

Always spawn `csx-code-reviewer`. Its assignment must include the user request, acceptance criteria when available, review scope, raw diff or commit range, relevant full-file context, tests, and verification artifacts. Require:

- two-stage review: specification and scope compliance before code quality;
- correctness, security, unsafe data handling, error handling, edge cases, regressions, tests, maintainability, and user-facing or documentation impact;
- findings ordered `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, each with path, line, impact, trigger, and concrete fix;
- classification of every finding as `accepted-scope defect`, `change-induced safety/regression`, or `optional hardening`;
- an individual `APPROVE`, `COMMENT`, or `REQUEST CHANGES` recommendation.

Spawn `csx-architect` only when the final diff introduces, changes, or departs from a public interface, persisted-data contract, permission or security boundary, migration, concurrency model, cross-module dependency contract, or operational contract that is not already covered by a current supplied architecture review. Diff size, file count, or ordinary cross-module call flow alone do not require the lane. Its assignment must require boundary, coupling, interface, compatibility, migration, operational-impact, strongest-counterargument, and tradeoff review with an individual `CLEAR`, `WATCH`, or `BLOCK` status.

Record `csx-architect: skipped-trivial` when no unresolved architectural boundary above exists. A current architecture review may be reused only when it covers the same accepted scope, boundary, and evidence revision.

Only `accepted-scope defect` and `change-induced safety/regression` findings may produce `REQUEST CHANGES` or `BLOCK`. `optional hardening` is non-blocking follow-up material. A security or integrity defect introduced by the change is not optional merely because the original request did not name the attack or failure mode.

Use unique task names, `fork_turns: "none"`, lane-specific stop conditions, and the output discipline above. Wait for every required lane. If `csx-code-reviewer`, or a required Architect lane, is unavailable, ask the user to rerun `csx install`; do not report `APPROVE`. Report `COMMENT` with `required csx role unavailable`.

## Composite Verdict

- `REQUEST CHANGES`: Code Reviewer returns `REQUEST CHANGES` for a blocking finding, Architect returns `BLOCK` for an accepted-scope or change-induced boundary defect, or required accepted verification is missing.
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
  Classification: accepted-scope defect / change-induced safety/regression / optional hardening
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
