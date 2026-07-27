---
name: csx-plan-pro
description: Higher-rigor planning with bounded Architect then Critic review for broad, risky, or architecture-sensitive work. Use when a normal plan may miss tradeoffs, sequencing, testing strategy, or hidden coupling.
---

# csx-plan-pro

Use this skill when ordinary planning is not enough, but a full external orchestration system would be too heavy.

## Contract

Produce one decision-ready, versioned plan with independent review pressure. Consensus exists only when Architect and Critic approve the same draft version. Do not start implementation unless the user explicitly selects the final `$csx-start-goal` handoff.

Root owns accepted-spec and user-decision authority. A distinct `csx-plan-leader` owns the
planning run, role sequencing, assignment construction, version state, single-writer handoff
artifacts, blocker ledger, consensus routing, and final envelope. `csx-explorer` owns repository
facts, `csx-analyst` owns requirement gaps and readiness, `csx-planner` owns every draft and goal
decomposition, `csx-architect` owns architectural review, and `csx-critic` owns post-clearance
actionability review. Root must not act as Plan Leader, relay large specialist originals,
substitute its own specialist judgment, or rewrite a reviewed draft.

## Canonical Workflow State

Only after creating the repository-relative `.csx/plans/<slug>-pro.md` artifact, call `csx workflow begin` with one bounded JSON request on stdin:

```json
{"version":1,"workflow":"csx-plan-pro","phase":"drafting","artifact":".csx/plans/<slug>-pro.md"}
```

Parse the single JSON stdout result. Retain and propagate its opaque `token` only when `ok` is `true`; never place the token in the plan artifact or command arguments. A missing command, nonzero exit, malformed result, or `ok: false` is state telemetry failure only: continue the planning contract unchanged and do not retry speculatively.

At every persisted review-cycle milestone, write and verify the artifact first, then send `csx workflow checkpoint` a bounded stdin JSON request containing `version: 1`, the retained `token`, the new `phase`, and the same repository-relative `artifact`. After the final `APPROVED` or `BLOCKED` artifact is written and verified, call `csx workflow finish` in the same artifact-first/state-second order with outcome `approved` or `blocked`. A stale-token or other failure is fail-open and must not alter consensus, artifact, handoff, or user-visible workflow outcome. Do not create canonical workflow state for any other skill.

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

## Workflow

1. Establish the requirements input:
   - If an accepted final csx spec is supplied, treat its stable topology IDs, scope,
     non-goals, support boundaries, reliability classes, complexity budget, acceptance
     criteria, decisions, readiness, and evidence packet as binding. Reuse current evidence
     instead of repeating discovery. For brownfield work, call `csx-explorer` only to
     revalidate affected claims when the repository changed or material evidence may be
     stale. Call `csx-analyst` only if that revalidation exposes a material conflict or new
     plan-changing gap.
   - Without an accepted spec, spawn `csx-explorer` for brownfield repository evidence and then pass its completed packet with the request to `csx-analyst`. For repository-independent greenfield work, Explorer may be omitted and Analyst may start directly. Run lanes in parallel only when the Analyst judgment does not depend on repository evidence.
2. Route the accepted spec status or latest Analyst result before drafting:
   - `READY`: continue.
   - `READY_WITH_ASSUMPTIONS`: preserve every reversible assumption in the decision ledger and continue.
   - `BLOCKED`: resolve user-owned decisions in the root thread. If the blocker cannot be resolved, write a pre-draft BLOCKED artifact and skip Planner, Architect, and Critic. In the Output envelope set Approved Version to `N/A`, Planner Body to `Not created — blocked before drafting`, both review sections to `Not run — blocked before drafting`, and record the exact Analyst blockers.
3. In the root thread, resolve user-owned decisions exposed by the Analyst. After an answer, resume the same Analyst when possible, or spawn a fresh Analyst with the complete request, evidence, prior result, and answer. Use the replacement readiness result; do not rescore requirements in the root.
4. Root spawns one `csx-plan-leader` with `fork_turns: "none"`, the Accepted Constraint
   Envelope below, evidence paths, user-decision ledger, run ID, final plan path, and bounded
   scope authority. Root sends paths and digests, not large originals, and does not
   concurrently retain another plan handoff writer.
5. Plan Leader assigns `csx-planner` the accepted inputs and the complete Accepted Constraint
   Envelope. Require `draft_version: 1`, the exact Planner Body Shape, Decision Record,
   implementation plan, Planner-owned execution goal decomposition, acceptance criteria,
   Verification Matrix, risks, stop conditions, and deliberate content when applicable.
   Persist the returned body verbatim as `draft-v001.md` and record its SHA-256 before review.
6. Plan Leader assigns `csx-architect` the complete Accepted Constraint Envelope, bounded
   scope authority, draft path, `draft_version`, and digest. Architect echoes the envelope,
   verifies the accepted-spec and draft digests, reads the originals directly, and returns
   exactly `CLEAR` or `BLOCK`:
   - include the strongest counterargument, hidden coupling or boundary risk, and at least
     one real tradeoff tension;
   - classify every concern as `accepted-scope-defect`, `change-induced-risk`, or
     `optional-hardening` and use the Common Finding Contract below;
   - place non-blocking concerns under `Watch Items` in a `CLEAR` result; `WATCH` is not a
     verdict;
   - for `BLOCK`, include stable blocker IDs and an Architect-owned minimum
     `Revision Brief`.
7. Persist the Architect response verbatim and verify its digest. If it is `BLOCK`, record
   Critic status `SKIPPED_ARCHITECT_NOT_CLEAR`; do not call Critic. Give Planner only the
   Architect-owned Revision Brief path and digest for the next version.
8. Only after Architect `CLEAR`, assign `csx-critic` the complete Accepted Constraint
   Envelope, same draft path, version, digest, stored Architect-review path and digest,
   accepted spec and decision paths, and bounded assignment. Critic echoes the envelope,
   verifies the originals, simulates two representative implementation steps, checks intent,
   criterion traceability, reliability, and complexity limits, and returns `APPROVED`,
   `REVISE`, or `BLOCKED`. A revision includes a Critic-owned minimum `Revision Brief`;
   Critic does not reopen architectural scope or merge its brief with an Architect brief.
9. Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same
   `draft_version` and digest. A missing artifact, mismatched digest, version mismatch, or
   unauthorized write is a structured blocker, never consensus.
10. For a valid blocking review, resume Planner when possible with the exact previous draft
    path, only the owner-specific Revision Brief path, user decisions, and instruction to
    increment `draft_version` by exactly one. A replacement Planner receives verified
    artifact paths and `fork_turns: "none"`; record the fallback. From version 2 onward it
    must include a Scope Delta for every material change. Every new version restarts at
    Architect, even when only Critic requested revision.
11. Repeat with the same scope authority and blocker rules for a maximum of 5 cycles. Do
    not automatically escalate to the user or lower rigor after cycle 2. An unresolvable
    blocker or failure to reach same-version consensus after cycle 5 produces a complete
    BLOCKED artifact containing the best draft, all stored reviews, Review Ledger, and
    unresolved Blocker Ledger.
12. Before finalization, require the final Critic result to confirm that the consensus
    draft matches the original request, accepted spec, and user decisions. A genuine
    user-owned conflict becomes a bounded Decision Packet to Root; after resolution create
    a new version and restart at Architect.
13. Plan Leader writes `.csx/plans/<slug>-pro.md` for both `APPROVED` and `BLOCKED`.
    Assemble the exact stored Planner and reviewer originals into the envelope without
    modification. Persist each artifact milestone before its canonical workflow checkpoint,
    and persist the terminal artifact before `finish`.

## Accepted Constraint Envelope

Every Planner, Architect, and Critic assignment must include these exact fields:

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

`reliability_class` may be a stable feature-to-class mapping when the accepted spec contains
multiple material features. `complexity_budget` must preserve every accepted limit rather than
replace it with only the default goal counts. Plan Leader copies this envelope byte-for-byte
from accepted authority into each assignment. Planner preserves it in the draft; Architect and
Critic echo it in their result and compare it with the accepted spec before reviewing. A missing
field, accepted-spec digest mismatch, silently strengthened reliability mechanism, or unsupported
complexity-budget excess is a structured blocker rather than an inferred default.

## Accepted Scope and Blocker Contract

Only the following are scope authority:

- the user's request and confirmed decisions;
- accepted-spec goals, stable topology IDs, requirements, constraints, criteria, support
  boundaries, non-goals, reliability classes, and complexity budget; and
- a concrete safety or regression risk directly caused by the planned change.

Reviewers cannot create product features, support promises, operating environments, threat
models, compatibility guarantees, or future-extension requirements. A plan is sufficient when
it fixes observable behavior and interfaces, data/authority/security boundaries, invariants,
irreversible decisions and recovery, cross-module ownership and order, and verifiable completion.
Local reversible helper structure, file naming, equivalent mechanisms, fixture details, and
test-confirmable implementation choices belong to execution.

### Common Finding Contract

Every material finding uses this exact schema:

```yaml
finding_id: F001
classification: accepted-scope-defect | change-induced-risk | optional-hardening
scope_authority: AC7 | CONSTRAINT:C3 | NON_GOAL:N2 | REGRESSION:<invariant> | null
affected_boundary: <module, data, permission, migration, or execution boundary>
reachable_scenario: <concrete execution or failure path>
evidence: <file, symbol, test, or artifact>
plan_time_decision: <decision that must be fixed before implementation>
minimal_fix: <smallest scope-preserving correction>
scope_delta: none | requires-user-decision
```

An `accepted-scope-defect` must cite a stable accepted-spec authority ID. A
`change-induced-risk` must cite `REGRESSION:<invariant>` and explain the causal draft change.
Without that authority, downgrade the finding to `optional-hardening` or an implementation note.
`optional-hardening` never blocks and may use `scope_authority: null`.

A blocker must satisfy all four conditions:

1. **Scope-authorized defect or risk:** it is an `accepted-scope-defect` or
   `change-induced-risk` with a non-null stable `scope_authority`;
2. **Concrete evidence and reachable scenario:** it cites specific evidence, the affected
   boundary, a reachable failure condition, and its result;
3. **Plan-time necessity:** it must be decided before implementation rather than delegated as a
   local reversible choice; and
4. **Minimality:** its requested correction is the smallest sufficient scope-preserving change.

Otherwise record it as `optional-hardening` in Watch Items. Before requesting new state, storage,
compatibility, authority, recovery, or migration machinery, reviewers must show why a simpler
local reversible design cannot satisfy accepted criteria.

Maintain stable blocker IDs in a Blocker Ledger. A blocker first discovered after version 1 must
identify the draft delta or newly applicable scope evidence that made it observable. Repeating
the same blocker cannot expand the design indefinitely: narrow it to a minimum correction,
delegate implementation detail, simplify the design, or return exactly
`INFEASIBLE_UNDER_CURRENT_SPEC`.

## Versioned Handoff Artifact

The active Plan Leader is the only writer for:

```text
.csx/handoffs/<run-id>/
├── manifest.json
├── draft-v001.md
├── architect-v001.md
├── critic-v001.md
├── revision-brief-v001.md
└── current.md
```

`manifest.json` contains at least:

```json
{
  "schema_version": 1,
  "run_id": "<run-id>",
  "stage": "plan_review",
  "draft_version": 1,
  "draft_sha256": "<sha256>",
  "status": "awaiting_architect"
}
```

Every version file is immutable. Plan Leader persists specialist results verbatim, computes
SHA-256, and sends later agents only bounded assignments with path, version, and digest.
Architect, Critic, and Planner remain read-only and read the verified original directly. Do not
relay originals over 8 KiB through messages and never create `CHUNK n/m`, `START`, or `END`
courier protocols.

Missing artifacts return `BLOCKED_ARTIFACT_MISSING`; digest mismatches return
`BLOCKED_ARTIFACT_MISMATCH`. A Leader needing a direct write outside the current handoff tree or
final plan returns `BLOCKED_UNAUTHORIZED_WRITE_SCOPE`; an observed unauthorized Leader write
returns `BLOCKED_UNAUTHORIZED_WRITE`. Check workspace state before and after persistence.
Handoff provenance is not runtime workflow state, hook input, or completion authority.

## Leader Session Rotation

At the boundary before the next Planner or review unit, when runtime model-window and last-call
input-token metrics both exist, compute:

```text
context_usage_ratio = last_token_usage.input_tokens / model_context_window
```

Do not subtract cached input. Below 35% continue. At 35% through below 50%, checkpoint the latest
artifact, ledger, digest, and next action. At 50% or after any context compaction, finish and
terminate the current writer, verify the handoff, then start a `fork_turns: "none"` Plan Leader
successor from artifacts. Never overlap writers.

If either metric is unavailable, never estimate a ratio. Rotate after two completed review
cycles, 90 minutes, a compaction, or when continuing would require relaying an original over
8 KiB. Restore the accepted spec, current plan, stable ledger, completed and remaining criteria,
scope fence, phase, next action, Decision Packet, and writer provenance from paths and digests.
Leader rotation alone never creates a new user-visible top-level thread.

## Root Replacement Protocol

Leader rotation replaces only the internal Plan Leader while preserving the current Root and
user-visible thread. A Plan Leader must never create or propose a new top-level thread directly.
It reports a bounded `ROOT_REPLACEMENT_RECOMMENDED` packet to Root only when one of these reason
codes is true:

- `ROOT_DECISION_FIDELITY_LOST`: Root cannot recover confirmed decisions or non-goals after
  compaction;
- `PROJECT_IDENTITY_CHANGED`: the accepted spec is effectively a different project rather than
  a revision of the current goal;
- `UNBOUNDED_TRANSCRIPT_ACCUMULATION`: specialist or implementation detail cannot be separated
  from Root with a bounded Decision Packet;
- `MIXED_GOAL_AUTHORITY`: authority from different goals may be applied incorrectly; or
- `INTERNAL_SUCCESSOR_UNAVAILABLE`: runtime cannot create a transcript-free internal successor.

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

Only Root may present this recommendation to the user. The user or product creates the new
thread; the successor Root restores authority from verified artifacts, not a relayed transcript.
Ordinary Leader context growth is never a Root-replacement reason.

## Enforcement Boundary

The handoff writer, allowed paths, immutable versions, single-writer order, and context rotation
above are prompt contracts that rely on host agent controls. This skill does not create a new JS
orchestrator, handoff ACL, writer lease, context-token meter, or persistent workflow-state
schema. Canonical `csx workflow` state remains limited to the plan artifact and must not be
treated as enforcement for `.csx/handoffs`. When the host cannot expose or enforce a capability,
record that limitation and use the documented fallback; do not claim runtime enforcement.

## csx-loop Composition Contract

Loop-aware behavior is a bounded return path to an invoking `$csx-loop`, not another planning mode. Validate the incoming context against the exact `$csx-loop` schema, with no alternate fields or token:

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

Require `source: csx-loop`, `plan_kind: csx-plan-pro`, a matching accepted spec and `work_slug`, and a complete internally consistent context. Require current live authority bound to this `work_slug`, current stage, the `csx-plan-pro` transition, exact `pending_decision` or `none`, and current user turn with `consumed: false`. The stored `continuation_authority: initial-call | renewed-by-answer | explicit-resume` is audit provenance only; a persisted enum, copied metadata, earlier prompt, stale answer, or unrelated answer is not live authority.

Validate every binding immediately before entry and consume the authority exactly once. Only the parent loop may derive authority for the one next transition from the same current-turn source after a successful child return. A question, blocker, cancellation, unrelated turn, or ended workflow invalidates it. This child must not derive or forward live authority.

This branch never approves deployment, an external message, deletion, additional permission, or an irreversible side effect. Those actions always require their own approval. Missing or invalid loop context or live authority preserves the standalone explicit-selection workflow.

## Material Change Rule

Any post-review change to scope, boundaries, approach, sequence, acceptance criteria, verification, risks, decisions, assumptions, or stop conditions invalidates both verdicts and starts the next cycle. Editorial formatting that does not change meaning may be appended outside the approved plan body.

## Decision Record

Every Planner assignment must require:

```markdown
## Decision Record

### Decision Drivers
1. ...
2. ...
3. ...

### Options Considered
| Option | Benefits | Costs and Risks | Disposition |

### Decision

### Consequences

### Follow-ups
```

Require at least two viable options with bounded tradeoffs. If only one option remains viable, require explicit invalidation rationale for the rejected alternatives.

## Deliberate Profile

Auto-enable deliberate planning when the request involves authentication or authorization, security, data or schema migration, destructive or irreversible changes, incident recovery, compliance or PII, public API breakage, or concurrency/distributed state. Also enable it when the user explicitly requests deliberate or high-risk planning.

When the deliberate profile is active, the Planner assignment must require:

- three concrete failure scenarios
- prevention, detection, and containment or rollback for each scenario
- unit, integration, e2e, and observability verification, or an explicit rationale when a layer does not apply
- compatibility, permissions, or data-integrity checks relevant to the task
- execution stop conditions and recovery confirmation

The Architect assignment must review boundary, threat, compatibility, and rollback risk. The Critic assignment must return `REVISE` or `BLOCKED` for a missing or weak deliberate section.

## Root User Decisions

For initial decisions, review-exposed decisions, and final intent reconciliation, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask one material decision from the bounded Decision Packet at a time, with 2-3 mutually
  exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes in the decision artifact and return its path and digest to Plan Leader.
- Never delegate this tool call to a sub-agent.
- Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, data handling, or acceptance criteria prevents approval.

## Review Assignment Policy

- Use exact installed roles and unique task names with `fork_turns: "none"`.
- Require Architect and Critic to follow the common output discipline while preserving every required review field and verdict.
- Skip lanes only when the task is already narrow and non-architectural; then use `csx-plan`.
- If any required role is unavailable, ask the user to rerun `csx install` for the intended scope and write `BLOCKED: required independent role unavailable`.

## Proportionality Policy

- Classify proposed work and review feedback as `accepted-scope-defect`,
  `change-induced-risk`, or `optional-hardening`.
- Architect and Critic may block only the first two classes. New extremes, environments, threat models, compatibility promises, or general hardening remain follow-ups unless the user explicitly includes them.
- No blocking verdict may be based only on `optional-hardening` or duplicated verification.
- Critic must use the same three concern classes after Architect clearance and must not
  reopen architectural scope.
- Undefined support boundaries that materially alter the design are user-owned decisions; do not resolve them by selecting an unbounded domain.
- Keep the Verification Matrix minimal and deduplicated. Default to one primary-environment full suite plus affected-environment smoke checks, unless the accepted requirements or changed boundary explicitly require a complete matrix.
- Reuse a single scenario across related criteria when it provides direct evidence and preserve stronger explicit evidence without multiplying equivalent checks.

## Planner Body Shape

The Planner owns and returns this complete immutable body:

```markdown
# Plan: <title>

draft_version: <N>
accepted_spec_path: <path>
accepted_spec_sha256: <digest>
reliability_class: <class or stable feature-to-class mapping>
complexity_budget: <accepted budget>

## Decisions and Assumptions
### User-confirmed Decisions
### Reversible Assumptions
### Open Decisions

## Goal and Boundaries

## Reliability and Complexity Budget

## Decision Record

## Acceptance Criteria

## Execution Goals
| Goal ID | Bounded Result | File Ownership | Criteria | Invariants | Verification / Rollback Boundary |

Default to 5 or fewer goals, or 10 or fewer for large or high-risk work. Explain each
exception. Combine strongly coupled changes to one file, state machine, or migration boundary
as a vertical slice.

## Scope Delta
Required from draft_version 2 onward.
| Change | Source | Scope / Criterion Authority | Scope Effect | Disposition |

## Verification Matrix
| Criterion | Evidence | Command or Scenario | Expected Result | Failure Signal |

## Risks and Stop Conditions

## Deliberate Review
Included when deliberate profile is active.
```

## Output

```markdown
# Pro Plan: <title>

## Decision
APPROVED / BLOCKED

## Approved Version
draft_version: <N or N/A>

## Planner Body
<exact Planner body for the approved or best draft version>

## Architect Review
<exact result for that same version>

## Critic Review
<exact result for that same version>

## Review Ledger
| Cycle | Draft Version | Architect | Critic | Revision Reason |

## Blocker Ledger
| Blocker ID | Class | First Seen | Evidence / Failure Path | Minimum Correction | Delta or New Applicability | Status |

## Unresolved Blockers

## Handoff
```

## Final Handoff

For a validated loop context whose selected kind is `csx-plan-pro`, whose accepted spec and slug match, and whose current plan-transition authority was consumed, replace the standalone handoff only for `Decision: APPROVED` backed by Architect `CLEAR` and Critic `APPROVED` for the same accepted `draft_version`. Return `plan_path`, `plan_kind: csx-plan-pro`, `plan_status: APPROVED`, the accepted `draft_version`, accepted reversible assumptions, repository marker, and complete loop provenance to the parent `$csx-loop`; do not call `request_user_input` and do not invoke `$csx-start-goal`. The immutable Planner Body and every existing review, revision, and maximum of 5 review cycles remain unchanged.

Architect `BLOCK`, Critic `REVISE` or `BLOCKED`, an unresolvable blocker, a required-role
failure, and review exhaustion cannot pass this gate. A CLEAR result may contain non-blocking
Watch Items. After the existing bounded review routing finishes without same-version consensus,
return `BLOCKED`, the blocker, and last valid checkpoint to the parent and invalidate authority.
Never auto-select or auto-loop `Refine further`. The parent alone may validate the return and
derive the start-goal transition. If the loop context or live authority is absent or invalid,
use the standalone handoff below unchanged.

After writing the artifact, call `request_user_input` from the root thread.

For `Decision: APPROVED`, show:

1. `Start execution with $csx-start-goal (Recommended)`
2. `Refine further`
3. `Stop`

For `Decision: BLOCKED`, show only:

1. `Refine further (Recommended)`
2. `Stop`

Only an explicit `Start execution with $csx-start-goal` selection authorizes implementation and accepts the listed reversible assumptions. Pass the plan path, approved draft version, boundaries, acceptance criteria, Verification Matrix, risks, and stop conditions to `$csx-start-goal`. Never invoke execution from a BLOCKED plan.
