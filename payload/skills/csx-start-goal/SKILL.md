---
name: csx-start-goal
description: Execute an explicitly accepted spec or plan as one durable aggregate Codex goal with bounded implementation goals, proportional evidence, goal-scoped deslop cleanup, one final cumulative verification, and a cumulative code-review loop.
---

# csx-start-goal

Execute an accepted input with one Codex goal and a compact Markdown control artifact. Keep the goal active until the accepted plan is implemented, every original acceptance criterion has current evidence, required cleanup has passed, the final cumulative verification succeeds once on the unchanged revision, and the cumulative code review approves it.

## Orchestration Boundary

Root owns current-turn execution authority, active-goal compatibility, and user decisions. After
entry, one `csx-start-goal-leader` is the logical owner for approved-goal intake, aggregate goal
state, assignment construction, dependency scheduling, control-artifact persistence, targeted
and cumulative verification, review routing, bounded rework, conditional deslop, and final
completion. `csx-planner` alone owns execution-goal decomposition, `csx-executor` owns product
implementation and code-changing rework, `$csx-deslop` owns at most one bounded cleanup per
production-code goal, and `$csx-code-review` owns cumulative change review. Do not nest a
separate Execution Leader or Review Leader.

## Canonical Workflow State

After creating or resuming the repository-relative `.csx/goals/<slug>.md` control artifact and persisting its current entry state, call `csx workflow begin` with one bounded JSON request on stdin:

```json
{"version":1,"workflow":"csx-start-goal","phase":"entry","artifact":".csx/goals/<slug>.md"}
```

Parse the single JSON stdout result. Retain and propagate its opaque `token` only when `ok` is `true`; never write the token into the goal artifact or pass JSON content through command arguments. A missing command, nonzero exit, malformed result, or `ok: false` is state telemetry failure only: continue the execution contract unchanged and do not retry speculatively.

Whenever the control artifact records a material phase transition or current revision milestone, persist and verify the artifact first, then call `csx workflow checkpoint` with bounded JSON stdin containing `version: 1`, the retained `token`, the new `phase`, and the same repository-relative `artifact`. After the completed artifact is persisted and verified, call `csx workflow finish` in the same artifact-first/state-second order with phase `complete` and outcome `complete`. If this workflow reaches a genuine terminal blocked or stopped decision rather than a resumable pause, finish with outcome `blocked` or `stopped`; otherwise leave the active state at its latest checkpoint. A stale-token or any other state failure is fail-open and must not change goal status, evidence, retry counters, review decisions, or `update_goal` behavior. Do not create canonical workflow state for any other skill.

Every subagent assignment must state:

```text
Objective:
Inputs:
Scope:
Required work/checks:
Expected deliverable:
Required verdict or vocabulary:
Constraints:
Stop conditions:
Diagnostics trailer:
```

For every direct subagent assignment, require the normal response body followed by this exact final nonempty line:

```text
<!-- csx-metrics:v1 {"status":"completed"} -->
```

The compact JSON may contain only `status` (`completed`, `blocked`, `failed`, or `terminated`), `reason_code` (`[a-z0-9_]{1,64}`), and `failure_detail` (at most 2048 UTF-8 bytes and only with a valid `reason_code`). Keep the complete trailer at most 6144 UTF-8 bytes. Never put prompt or artifact text, agent/thread/run IDs, workflow tokens, or other identifiers in the trailer.

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

## Root-Owned Leader Wait Lease

After one Leader spawn, Root calls `csx workflow wait-open` and retains the returned wait lease
only in the Root thread. Root calls `wait_agent` for the returned 30-second wait, then advances
the same lease through `csx workflow wait-next` and calls `wait_agent` for 45, 75, 120, and 180
seconds. For every nonterminal wake, Root uses `csx workflow wait-next` and keeps 180-second
waits thereafter; the cadence is 30, 45, 75, 120, 180, 180, ... and never resets merely because
the Leader reported progress.

Root calls `csx workflow wait-close` before any user decision, terminal artifact
integration/finish, Leader rotation/replacement, or final output. A timeout alone only advances
the wait/lease and never triggers finalization/replacement. This lease cadence preserves the
existing five-minute grace, activity-aware status check, and single non-overlapping replacement
policy; Root still applies those liveness rules from observable activity rather than from a wait
timeout alone. The Start-Goal Leader does not open, renew, or close Root's lease.

## Root-Leader Result Protocol

The existing canonical workflow-state schema remains version 1. The following machine-readable
schema defines the complete first-line result envelope; it is not a new persistent state schema.

<!-- csx.leader-result-schema:v1 -->
```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"csx.leader-result","version":1,"type":"object","additionalProperties":false,"required":["schema","version","workflow","state","phase","artifactPath","artifactSha256","nextAction"],"properties":{"schema":{"const":"csx.leader-result"},"version":{"const":1},"workflow":{"const":"csx-start-goal"},"state":{"enum":["working","handoff_ready","user_decision_required","blocked","rotation_required"]},"phase":{"type":"string","minLength":1},"artifactPath":{"type":"string","minLength":1},"artifactSha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"nextAction":{"type":"string","minLength":1}},"x-phase-sentinels":{"handoff_ready":"root_handoff_ready","user_decision_required":"root_decision_required","blocked":"root_blocked","rotation_required":"root_rotation_required"},"x-stop-recovery":{"guardWhile":"active_valid_lease","releaseOn":"successful_wait_close","rootBoundaryOrder":["validate_envelope","wait_close","transition"],"waitAgentAfterBoundaryStop":false}}
```

A normal domain phase means the Start-Goal Leader is still working and therefore uses state
`working`. Reserve `root_handoff_ready`, `root_decision_required`, `root_blocked`, and
`root_rotation_required` exclusively for the corresponding Root boundaries in the schema. Before
every progress or boundary result, the Leader persists and verifies the current goal artifact or
bounded Decision Packet and checkpoints its exact phase and artifact. At a Root boundary it
checkpoints the reserved sentinel, then emits exactly one JSON object conforming to the schema as
the first line of its response. The envelope never contains or reveals the workflow token.

Root accepts a wake only after validating the envelope and matching its phase, repository-relative
artifact path, and SHA-256 digest against the persisted checkpoint. Malformed JSON, an unknown or
inconsistent state/phase pair, a missing artifact, or a path/digest mismatch becomes
`protocol_unavailable`: Root closes the wait lease and does not continue waiting. Root calls
`csx workflow wait-next` only after a valid `working` wake.

An active valid wait lease remains the Stop recovery guard until `csx workflow wait-close`
succeeds; a reserved `root_*` phase never bypasses that guard. When Stop continuation wakes at a
Root boundary, Root inspects and strictly validates the matching Leader envelope, then calls
`csx workflow wait-close` without calling `wait_agent` again. Only a successful close releases the
guard and permits workflow finish, `request_user_input`, Leader replacement, or terminal output.
If close does not succeed, keep the guard and do not perform the transition.

For `handoff_ready`, Root closes the wait lease, verifies the completed goal artifact and digest,
calls `csx workflow finish`, and only then performs aggregate completion or final output. For
`user_decision_required`, Root closes the lease and calls `request_user_input`; the workflow stays
active. Root persists the answer in the decision artifact, resumes the Leader with its path and
digest, and opens a new wait lease for that resumed Leader. For `blocked`, `rotation_required`, or
`protocol_unavailable`, Root closes the lease before terminal handling, replacing the Leader, or
producing output. A timeout alone never selects any terminal state or replacement.

## Entry Gate

1. Confirm current-turn execution authority through exactly one of these parallel branches.
   - Standalone branch:
     - For a csx spec, reject `BLOCKED`; accept `READY_WITH_ASSUMPTIONS` only when the user explicitly selected execution and thereby accepted its listed reversible assumptions.
     - For a csx plan, accept only `Decision: READY`.
     - For a csx pro plan, accept only `Decision: APPROVED`.
     - Reject every `BLOCKED` plan and every plan handed over without the user's explicit `Start execution with $csx-start-goal` selection or an equivalent current-turn request that names `$csx-start-goal` and the accepted plan.
   - `$csx-loop` authority branch: apply every validation in `csx-loop Entry Contract` below. A successful validation is the current-turn execution selection equivalent for this entry only.
2. Preserve the accepted input as binding execution context. Preserve its scope, non-goals, constraints, acceptance criteria, decisions, assumptions, Verification Matrix, risks, and stop conditions.
3. Call `get_goal` before creating anything. Use exactly one aggregate Codex goal for the entire accepted plan. Resume the same goal and artifact when active, stop for a different active goal, and otherwise call `create_goal` once. Persist the created or resumed control artifact before beginning canonical workflow state.
4. Spawn exactly one `csx-start-goal-leader` with `fork_turns: "none"`, accepted spec and
   plan paths and digests, the complete Accepted Constraint Envelope, current goal-artifact path
   and digest, repository marker, decision ledger, approved execution goals, criteria progress,
   scope fences, and next action. Root does not remain a competing goal-artifact writer.

## csx-loop Entry Contract

Validate a claimed loop entry against the exact `$csx-loop` context schema, with no alternate fields or token:

```text
source
original_invocation
original_request
work_slug
spec_path
spec_status
spec_recommendation
plan_kind
plan_path
plan_status
accepted_reversible_assumptions
last_completed_stage
remaining_stages
continuation_authority
repository_marker
affected_evidence
pending_decision
attempt_counters
```

The loop branch requires all of the following before implementation or goal creation:

- `source: csx-loop`, one bounded original request and matching `work_slug`, complete original invocation provenance, preserved counters, and internally consistent completed/remaining stages;
- a matching final spec with `spec_status: READY | READY_WITH_ASSUMPTIONS`, its accepted reversible assumptions explicitly present in `accepted_reversible_assumptions`, and no unaccepted assumption;
- exactly one matching plan artifact: `plan_kind: csx-plan` with `plan_status: READY` or `plan_kind: csx-plan-pro` with `plan_status: APPROVED`, plus matching path, slug, original boundary, accepted `draft_version`, and artifact status;
- for a pro plan, Architect `CLEAR` and Critic `APPROVED` for that same accepted `draft_version`;
- a current repository marker, or bounded revalidation of only the `affected_evidence` whose boundary the marker change can invalidate;
- `get_goal` reporting no active goal or the same compatible aggregate goal and matching goal artifact; a distinct active goal is a hard stop; and
- current live authority bound to this `work_slug`, current stage, the `csx-start-goal` entry transition, exact `pending_decision` or `none`, and current user turn with `consumed: false`.

The stored `continuation_authority: initial-call | renewed-by-answer | explicit-resume` is audit provenance only. A persisted enum, past prompt, copied or edited artifact, stale answer, unrelated answer, or mismatched resume command cannot satisfy entry. Validate the current-turn source and every binding immediately before entry. Consume the entry authority exactly once only after every check, including active-goal compatibility, succeeds; it cannot authorize a repeated entry.

If `source: csx-loop` or any other loop claim is present but the complete context, accepted artifacts, repository freshness, active-goal compatibility, or live authority fails validation, stop before `create_goal` with exactly `BLOCKED: invalid loop approval context`. Never fall back from a malformed loop claim to standalone authorization. When there is no loop claim, preserve the standalone Entry Gate unchanged.

A question, blocker, cancellation, unrelated turn, permission stop, or ended workflow invalidates live authority. This skill cannot renew or derive it. Deployment, an external message, deletion, additional permission, and irreversible effects always require separate approval regardless of a Recommended label or loop provenance.

## Proportionality and Scope Control

Classify every requirement, test failure, review finding, and rework request as exactly one:

- `accepted-scope-defect`: required by the accepted input;
- `change-induced-risk`: a concrete correctness, security, data-integrity, compatibility, or
  supported-behavior defect introduced or exposed by the change;
- `optional-hardening`: a new extreme, environment, threat model, compatibility promise, or
  robustness improvement outside accepted scope.

Only the first two may block completion. `optional-hardening` remains a follow-up and cannot
become a new criterion, goal, file, mechanism, or review gate. Preserve accepted reliability
classes. Do not add stronger ordering, persistence, recovery, compatibility, or audit machinery
without accepted scope authority.

## Accepted Constraint Envelope

Every Planner or Architect assignment created by this skill must include:

```yaml
accepted_spec_path: .csx/specs/<slug>.md
accepted_spec_sha256: <digest>
reliability_class: durable | best-effort | advisory
complexity_budget:
  default_goal_budget: 5
  large_or_high_risk_goal_budget: 10
  additional_constraints:
    - <accepted limits>
```

Preserve per-feature reliability mappings and every accepted complexity limit. Do not infer
missing values. Planner preserves and echoes the envelope in any execution-goal decomposition;
Architect echoes it before boundary review. A missing field, digest mismatch, silently
strengthened reliability mechanism, or unsupported complexity-budget excess is a structured
blocker.

## Goal Artifact

The active Start-Goal Leader is the only direct writer of `.csx/goals/<slug>.md`. Product
source changes are always delegated to an Executor. Keep this compact control shape:

```markdown
# Goal: <title>

## Objective and Accepted Boundaries
- Accepted spec / plan path and SHA-256:
- Reliability classes and support boundaries:
- Explicit non-goals:

## Current Revision
Current: R000
Latest cause:
Changed paths:
Invalidated evidence:

## Lifecycle Phase
approved_goal_intake | implementation | targeted_verification | integration_static |
first_full_suite | review | bounded_rework | final_verification | complete | blocked

## Attempt Counters
- Full suite: 0/2
- Goal deslop passes: <sum; each production-code goal 0/1>
- Assignment timeout status checks:
- Same-cause tool retries:

## Success Criteria
- [ ] AC1: <preserved stable criterion>
  - Evidence:

## Approved Execution Goals
### G001: <bounded result>
- Dependencies:
- Files and ownership:
- Criteria:
- Invariants:
- Allowed dependencies:
- Forbidden scope:
- Focused verification:
- Production code changed: unknown | yes | no
- Deslop status: pending | DESLOP_SKIPPED_CONCISE_GOAL | DESLOP_NOT_APPLICABLE | DESLOP_COMPLETED
- Status: pending | in_progress | implemented | rework | complete | blocked

## Finding Ledger
## Boundary Review
## Verification Evidence
## Completion Decision
```

Record validated loop provenance as checkpoint provenance only, never renewed authority.
Validate every recovered spec, plan, and goal-artifact digest. Keep current evidence, counters,
open findings, and next action; collapse history to provenance rows. A legacy missing count is
recorded as `legacy baseline`, never guessed.

Before and after Leader writes, inspect workspace state. Direct writes outside the current goal
artifact return `BLOCKED_UNAUTHORIZED_WRITE_SCOPE`; an observed unauthorized Leader write
returns `BLOCKED_UNAUTHORIZED_WRITE` and prevents completion.

## Approved Goal Intake

1. Preserve every accepted criterion, stable scope ID, goal, file ownership, invariant,
   reliability class, support boundary, non-goal, risk, and stop condition.
2. If an approved plan already contains execution goals, import that decomposition unchanged.
   Start-Goal Leader must not merge, split, reorder, or redesign it.
3. A direct accepted spec or legacy plan without goals requires one `csx-planner`
   decomposition before execution. Pass the complete Accepted Constraint Envelope and require
   it to be echoed with bounded results, dependencies, file ownership, criteria, invariants,
   allowed dependencies, forbidden scope, focused evidence, and stop conditions. Planner
   remains the only owner of goal structure.
4. Default planning budgets are 5 goals for normal work and 10 for large or high-risk work.
   An excess goal needs an independent ownership, verification, or rollback boundary.
   Strongly coupled work on one file, state machine, or migration boundary is a vertical slice.
5. If the decomposition is defective or new scope is required, stop and route it to Planner or
   Root. Start-Goal Leader never repairs goal structure itself and never nests an Execution
   Leader or Review Leader.

## Architecture Boundary Review

Before implementation, require one `csx-architect` boundary review only when the accepted work
changes a public interface, persisted data, permission/security boundary, migration, concurrency
model, cross-module contract, or operational contract.

- Reuse Architect `CLEAR` from an approved pro plan only for the same version, digest, and
  boundaries.
- Otherwise run one bounded read-only review inside accepted scope with the complete Accepted
  Constraint Envelope and require Architect to echo it before review.
- `BLOCK` stops only for an `accepted-scope-defect` or `change-induced-risk`. Non-blocking items
  are `Watch Items` in `CLEAR`; `WATCH` is not a verdict.
- Localized or non-architectural work records `skipped-not-architectural`.

## Executor Scope Fence

Always assign implementation and code-changing rework to `csx-executor`. Every assignment must
state:

- exact allowed files and ownership;
- responsible acceptance criteria and stable scope IDs;
- invariants that must remain true;
- allowed dependency paths;
- explicit forbidden files, behavior, schema, support, and authority boundaries;
- focused tests with expected results and failure signals; and
- the required structured stop result for scope expansion.

The Executor may make local reversible implementation choices. If implementation needs an
unapproved file, criterion, public behavior, persisted schema, support environment, permission
boundary, reliability guarantee, or irreversible choice, it must make no expansion edit and
return:

```text
SCOPE_EXPANSION_REQUIRED
Reason:
Affected criterion:
Required files or boundary:
User decision required: yes | no
```

Do not automatically add that work to the current or a new goal. Root resolves user-owned
decisions; Planner owns any approved decomposition change.

## Implementation and Test-First Review Gate

For each approved goal, Executor implements within its scope fence and runs its focused tests.
Start-Goal Leader records changed files, criteria, exact commands, results, failure reasons,
remaining verification, and residual risk. Before sealing that goal checkpoint, apply the
Goal-Scoped Deslop contract below and record its structured status. Independent non-overlapping
goals may run in parallel with one active owner per path, but each goal has its own deslop
decision and at most one cleanup owner.

After all focused tests pass:

1. run the accepted integration and static checks;
2. run the first full suite in the primary supported environment, or the plan-authorized
   proportional substitute for documentation/config-only work;
3. only if all required evidence is green, invoke cumulative code and conditional architecture
   review;
4. group all `accepted-scope-defect` and `change-induced-risk` findings by invariant family
   into one bounded rework assignment;
5. run affected focused tests after any code change; and
6. run one final full suite only when review rework changed code.

Code review must not begin while focused, integration/static, or first full-suite evidence is
failing. If review makes no code change, the full suite runs exactly once. If code changes, the
final full suite makes at most two total full-suite runs. A first-suite failure is repaired before
review and consumes the possible second full-suite run; later review code changes then require a
structured verification-budget blocker rather than an unproven third run. A new revision never
resets the 2-run ceiling.

Reviewers do not rerun the full suite. They may run only 1-3 focused reproductions to confirm a
concrete finding. Code changes after review invalidate affected evidence and any prior completion
decision.

## Goal-Scoped Deslop

Apply the following gate once at the boundary of every approved goal:

1. If the goal changed no production code, record `DESLOP_NOT_APPLICABLE`.
2. If the changed code is already concise, the goal's purpose fits one clear sentence, and no
   duplication, dead code, unnecessary abstraction, or cleanup finding exists, record
   `DESLOP_SKIPPED_CONCISE_GOAL`.
3. Otherwise invoke `$csx-deslop` exactly once for that goal, record `DESLOP_COMPLETED`, and run
   affected focused regression tests before sealing the goal checkpoint.

A concise skip must persist this evidence:

```yaml
deslop_status: DESLOP_SKIPPED_CONCISE_GOAL
one_line_purpose: <one clear sentence>
changed_paths:
  - <goal-owned production path>
cleanup_findings: none
```

The deslop assignment contains only the current `goal_id`, one-line outcome, goal-owned changed
paths, directly affected shared helpers or interfaces, focused tests, and explicit non-goals.
Never relay prior-goal transcripts or the integrated repository diff. Deslop cannot change
public behavior, schema, authority, support, or reliability. A goal may never run deslop more
than once.

The final cumulative review may discover cross-goal duplication or cleanup risk. Handle that as
one bounded invariant-family rework packet over the cited paths; do not run a final integrated
deslop or rerun deslop for an earlier goal. Goal-scoped deslop occurs before integration/static
checks and the first full suite, so it does not consume the post-review final-suite allowance.

## Bounded Waiting, Retry, and Leader Rotation

Do not repeatedly short-poll agents. Give every assignment a justified expected duration and hard
timeout, then use one sufficient wait. At timeout, send one status check. If progress still does
not resume, terminate the old agent, confirm termination, and start at most one replacement with
`fork_turns: "none"` from verified artifact paths, digests, completed work, open findings, and
the next action—not a transcript.

For the same tool-failure cause, correct the arguments and retry once. A second same-cause failure
becomes a structured blocker until its cause changes.

At a work-unit boundary, compute context usage only when runtime last-call input tokens and model
window are both available:

```text
context_usage_ratio = last_token_usage.input_tokens / model_context_window
```

Below 35% continue; at 35% through below 50% checkpoint; at 50% or after any compaction, end the
old Start-Goal Leader writer, verify the goal artifact, then start a `fork_turns: "none"`
successor. If metrics are unavailable, never estimate them: rotate after ten rework passes,
90 minutes, compaction, or when continuing requires relaying more than 8 KiB. Never overlap
writers, and never create a user-visible top-level thread merely because Leader context grew.

## Root Replacement Protocol

Leader rotation replaces only the internal Start-Goal Leader while preserving the current Root
and user-visible thread. A Start-Goal Leader must never create or propose a new top-level thread
directly. It reports a bounded `ROOT_REPLACEMENT_RECOMMENDED` packet to Root only for one of
these reason codes:

- `ROOT_DECISION_FIDELITY_LOST`;
- `PROJECT_IDENTITY_CHANGED`;
- `UNBOUNDED_TRANSCRIPT_ACCUMULATION`;
- `MIXED_GOAL_AUTHORITY`; or
- `INTERNAL_SUCCESSOR_UNAVAILABLE`.

```yaml
status: ROOT_REPLACEMENT_RECOMMENDED
reason: ROOT_DECISION_FIDELITY_LOST
resume:
  accepted_spec_path: <path>
  accepted_spec_sha256: <digest>
  current_artifact_path: <path>
  current_artifact_sha256: <digest>
  current_phase: <phase>
  next_action: <one bounded action>
  open_findings: []
  unresolved_user_decisions: []
```

Only Root may present the recommendation to the user. The user or product creates the new
thread, and the successor Root restores accepted authority from verified artifacts rather than
a transcript. Ordinary Leader context growth is never a Root-replacement reason.

## Enforcement Boundary

The goal-artifact write fence, single-writer order, scope fence, and context rotation are prompt
contracts that rely on host agent controls. This skill does not create a new JS orchestrator,
product or handoff ACL, writer lease, context-token meter, or persistent workflow-state schema.
Canonical `csx workflow` state remains limited to the goal artifact and is not path enforcement.
When the host cannot expose or enforce a capability, record the limitation and use the documented
fallback; do not claim runtime enforcement.

## Message and Evidence Budgets

- Explorer and Analyst results: 2 KiB soft limit.
- Planner status: 2 KiB soft limit; the complete plan is exempt.
- Architect, Critic, Code Reviewer, and Executor completion: 4 KiB soft limit.

These are message limits, not permission changes. Preserve read-only specialist sandboxes and
exceed a limit rather than omit a material blocker or finding. Store or reference large evidence
by verified path instead of relaying it.

## Complete

Complete only when:

- every accepted criterion and approved execution goal has current direct evidence;
- every approved goal records exactly one applicable deslop status, and every
  `DESLOP_COMPLETED` goal has passing affected focused regression evidence;
- every focused, integration/static, and required full-suite check passes on the final revision;
- cumulative code review returns `APPROVE` and required architecture review is `CLEAR`;
- no blocking finding, scope expansion, Decision Packet, unauthorized write, or stale digest
  remains; and
- no product code changed after final evidence.

Then mark approved goals complete, persist the completion decision, finish canonical workflow
state after that artifact write, and call `update_goal` with `complete` exactly once.
