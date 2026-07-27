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

## Test-First Entry Gate

Begin expensive code review only after the current evidence revision has green focused tests,
required integration/static checks, and its first full-suite run. A failing or stale check is
`TESTS_NOT_GREEN`: return it to the execution owner for repair and do not spawn a reviewer.
Do not use review to diagnose a generally red test baseline.

The caller must supply the evidence revision and exact verification results. Reviewers never
rerun the full suite. They may run only 1-3 focused reproductions in total when a concrete
finding needs confirmation, and must record each command and result.

## Independent Review Lanes

When the caller supplies an evidence or change revision, include it in every required reviewer assignment and require each result plus the composite result to echo it. A missing or mismatched revision is stale review evidence and cannot produce `APPROVE`.

Always spawn `csx-code-reviewer`. Its assignment must include the user request, acceptance criteria when available, review scope, raw diff or commit range, relevant full-file context, tests, and verification artifacts. Require:

- two-stage review: specification and scope compliance before code quality;
- correctness, security, unsafe data handling, error handling, edge cases, regressions, tests, maintainability, and user-facing or documentation impact;
- findings ordered `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, each with path, line, impact, trigger, and concrete fix;
- classification of every finding as exactly `accepted-scope-defect`,
  `change-induced-risk`, or `optional-hardening`;
- the common fields `finding_id`, `classification`, `scope_authority`, `affected_boundary`,
  `reachable_scenario`, `evidence`, `plan_time_decision`, `minimal_fix`, and `scope_delta`
  for every material finding;
- one stable finding ID and the fields `invariant`, `affected_producers`,
  `affected_consumers`, `required_sweep`, `inspected_paths`, and `uninspected_boundaries` for
  every blocking finding;
- an individual `APPROVE`, `COMMENT`, or `REQUEST CHANGES` recommendation.

Spawn `csx-architect` only when the final diff introduces, changes, or departs from a public interface, persisted-data contract, permission or security boundary, migration, concurrency model, cross-module dependency contract, or operational contract that is not already covered by a current supplied architecture review. Diff size, file count, or ordinary cross-module call flow alone do not require the lane. Its assignment must require boundary, coupling, interface, compatibility, migration, operational-impact, strongest-counterargument, and tradeoff review with an individual `CLEAR` or `BLOCK` status. Non-blocking concerns are `Watch Items` inside `CLEAR`; `WATCH` is not a verdict.

Record `csx-architect: skipped-trivial` when no unresolved architectural boundary above exists. A current architecture review may be reused only when it covers the same accepted scope, boundary, and evidence revision.

Only `accepted-scope-defect` and `change-induced-risk` findings may produce `REQUEST CHANGES`
or `BLOCK`. An `accepted-scope-defect` requires a stable accepted-spec authority ID; a
`change-induced-risk` requires `REGRESSION:<invariant>`. Without non-null scope authority,
downgrade it to `optional-hardening` or a non-blocking implementation note.
`optional-hardening` and unrelated refactoring are non-blocking follow-up material. A security
or integrity defect introduced by the change is not optional merely because the original
request did not name the attack or failure mode.

Use unique task names, `fork_turns: "none"`, lane-specific stop conditions, and the output discipline above. Wait for every required lane. If `csx-code-reviewer`, or a required Architect lane, is unavailable, ask the user to rerun `csx install`; do not report `APPROVE`. Report `COMMENT` with `required csx role unavailable`.

## Common Finding Contract

Every material finding uses this exact schema:

```yaml
finding_id: F001
classification: accepted-scope-defect | change-induced-risk | optional-hardening
scope_authority: AC7 | CONSTRAINT:C3 | NON_GOAL:N2 | REGRESSION:<invariant> | null
affected_boundary: <module, data, permission, migration, or execution boundary>
reachable_scenario: <concrete execution or failure path>
evidence: <file, symbol, test, diff, or artifact>
plan_time_decision: <required pre-implementation decision or none-local-correction>
minimal_fix: <smallest scope-preserving correction>
scope_delta: none | requires-user-decision
```

For an implementation defect that needs no new product decision,
`plan_time_decision: none-local-correction` records that it remains bounded Executor rework.
The Plan-Pro four-condition blocker gate applies to planning review; execution review may still
block a concrete accepted-scope or change-induced implementation defect without inventing a new
plan-time decision.

## Invariant-Family Sweep

A blocking finding is incomplete until it defines the violated invariant and performs one
bounded sweep across every directly relevant producer and consumer. Where the same invariant
applies, inspect the normal, resume, recovery or historical, adapter, and migration paths
together. Do not turn this into repository-wide exploration: `required_sweep` names the bounded
path or symbol set, `inspected_paths` records what was actually checked, and
`uninspected_boundaries` records relevant boundaries that evidence or scope did not permit.

Assign a stable finding ID on first observation and retain it through rework. A later review may
create a new blocker for another manifestation of the same invariant only when it records either
a draft or code delta since the earlier review that exposed the path, or a concrete reason the
path was not observable in the earlier bounded sweep. Without one of those reasons, attach the
manifestation to the existing invariant family and do not create a new blocker ID.

Reconcile all related findings for the same invariant before returning. Emit one bounded rework
packet per invariant family with the stable IDs, affected producers and consumers, required
sweep, inspected and uninspected boundaries, concrete fix conditions, and 1-3 focused
reproductions. The review skill and both reviewers remain read-only; the execution owner assigns
that packet to one Executor.

## Composite Verdict

- `REQUEST CHANGES`: Code Reviewer returns `REQUEST CHANGES` for a blocking finding, Architect returns `BLOCK` for an accepted-scope or change-induced boundary defect, or required accepted verification is missing.
- `COMMENT`: no blocking finding remains, but either lane returns a non-blocking concern or a required role is unavailable.
- `APPROVE`: Code Reviewer returns `APPROVE`; Architect is `CLEAR` or was validly skipped as trivial; no required evidence is missing.

Reconcile duplicate findings without weakening their severity or required fix. The root may normalize presentation but must not independently dismiss an evidence-backed blocking finding.

## Output

```markdown
# Code Review: <title>

## Evidence Revision
<supplied revision or not supplied>

## Findings
- Finding ID:
  Severity: CRITICAL/HIGH/MEDIUM/LOW
  Classification: accepted-scope-defect / change-induced-risk / optional-hardening
  Scope authority:
  Location: file:line
  Affected boundary:
  Reachable scenario:
  Evidence:
  Plan-time decision:
  Minimal fix:
  Scope delta: none / requires-user-decision
  Invariant:
  Affected producers:
  Affected consumers:
  Required sweep:
  Inspected paths:
  Uninspected boundaries:
  New-observation authority: initial | draft/code delta | previously unobservable
  Issue:
  Recommendation:

## Verification Reviewed
## Focused Reproductions

## Independent Review
- csx-code-reviewer: APPROVE / COMMENT / REQUEST CHANGES / unavailable
- csx-architect: CLEAR / BLOCK / skipped-trivial / unavailable
- Watch Items:

## Verdict
APPROVE / COMMENT / REQUEST CHANGES

## Bounded Rework Packets
## Residual Risk
```

Keep each reviewer result within a 4 KiB soft limit. Exceed the limit rather than omit a
material finding, evidence boundary, or verdict, and never grant a read-only reviewer general
workspace write access to work around the limit.

For substantial reviews, also write `.csx/reviews/<slug>.md`.
