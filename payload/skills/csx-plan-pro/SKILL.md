---
name: csx-plan-pro
description: Higher-rigor planning with bounded Architect then Critic review for broad, risky, or architecture-sensitive work. Use when a normal plan may miss tradeoffs, sequencing, testing strategy, or hidden coupling.
---

# csx-plan-pro

Use this skill when ordinary planning is not enough, but a full external orchestration system would be too heavy.

## Contract

Produce one decision-ready, versioned plan with independent review pressure. Consensus exists only when Architect and Critic approve the same draft version. Do not start implementation unless the user explicitly selects the final `$csx-start-goal` handoff.

The skill owns role sequencing, user decisions, assignment construction, version state, consensus routing, artifact persistence, and handoff. `csx-explorer` owns repository facts, `csx-analyst` owns requirement gaps and readiness, `csx-planner` owns every draft, `csx-architect` owns architectural review, and `csx-critic` owns actionability review. The root must not substitute its own specialist judgment or rewrite a reviewed draft.

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

## Workflow

1. Establish the requirements input:
   - If an accepted final csx spec is supplied, treat its scope, non-goals, constraints, acceptance criteria, decisions, readiness, and evidence packet as binding. Reuse current evidence instead of repeating discovery. For brownfield work, call `csx-explorer` only to revalidate affected claims when the repository changed or material evidence may be stale. Call `csx-analyst` only if that revalidation exposes a material conflict or new plan-changing gap.
   - Without an accepted spec, spawn `csx-explorer` for brownfield repository evidence and then pass its completed packet with the request to `csx-analyst`. For repository-independent greenfield work, Explorer may be omitted and Analyst may start directly. Run lanes in parallel only when the Analyst judgment does not depend on repository evidence.
2. Route the accepted spec status or latest Analyst result before drafting:
   - `READY`: continue.
   - `READY_WITH_ASSUMPTIONS`: preserve every reversible assumption in the decision ledger and continue.
   - `BLOCKED`: resolve user-owned decisions in the root thread. If the blocker cannot be resolved, write a pre-draft BLOCKED artifact and skip Planner, Architect, and Critic. In the Output envelope set Approved Version to `N/A`, Planner Body to `Not created — blocked before drafting`, both review sections to `Not run — blocked before drafting`, and record the exact Analyst blockers.
3. In the root thread, resolve user-owned decisions exposed by the Analyst. After an answer, resume the same Analyst when possible, or spawn a fresh Analyst with the complete request, evidence, prior result, and answer. Use the replacement readiness result; do not rescore requirements in the root.
4. Give the accepted requirements, evidence packets, latest Analyst result when one was required, and user decisions to `csx-planner`. The Planner assignment must require `draft_version: 1`, the exact Planner Body Shape below, the Decision Record, implementation plan, acceptance criteria, Verification Matrix, risks, stop conditions, and deliberate content when applicable.
5. Spawn `csx-architect` with the complete exact draft and version. Its assignment must require it to echo that version and provide:
   - strongest counterargument against the favored path
   - hidden coupling or boundary risk
   - at least one tradeoff tension
   - classification of every concern as accepted scope, concrete change-induced safety or regression risk, or optional hardening
   - no blocking verdict based only on optional hardening or duplicated verification
   - `CLEAR`, `WATCH`, or `BLOCK`
6. After the Architect result returns, spawn `csx-critic` with the original request or input spec, user decisions, same complete draft, version, evidence, and Architect result. Its assignment must require the same version, verification of referenced files and symbols, simulation of two representative implementation steps, explicit reconciliation of the draft against original intent and decisions, and exactly one `APPROVED`, `REVISE`, or `BLOCKED` verdict. For `REVISE` or architectural `WATCH`/`BLOCK`, require one `Revision Brief` that reconciles both reviews, preserves every material blocker, identifies conflicting recommendations, and either gives the Planner an unambiguous correction or marks the unresolved user decision `BLOCKED`.
   The Critic must use the same three concern classes and reject optional hardening, hypothetical unsupported environments, or duplicated checks as revision blockers.
7. Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same `draft_version`. A missing or mismatched version is not consensus.
8. Route every non-consensus result back through a complete review cycle:
   - Architect `WATCH` or `BLOCK`, Critic `REVISE` or `BLOCKED`, or an accepted material improvement requires revision.
   - Resolve any new user-owned decision in the root thread before revision.
   - Resume the same `csx-planner` when possible with the exact prior draft, Critic-owned `Revision Brief`, user decisions, and instruction to increment `draft_version` by exactly one. The root must not synthesize or reinterpret specialist feedback.
   - If the Planner cannot be resumed, spawn a fresh `csx-planner` with the complete evidence, decisions, prior draft, and exact `Revision Brief`; record the fallback in the Review Ledger.
   - Run a fresh Architect review followed by a fresh Critic review for the new version.
9. Repeat until consensus or a maximum of 5 review cycles. An unresolvable blocker or failure to reach consensus after cycle 5 produces a BLOCKED artifact containing the best draft and unresolved blockers.
10. Before finalization, require the final Critic result to confirm that the consensus draft matches the original request, input spec, and user decisions. If it reports a conflicting assumption or open decision that can change implementation, reconcile it with the user and start a new versioned review cycle.
11. Write `.csx/plans/<slug>-pro.md` for both `APPROVED` and `BLOCKED`. Place the exact Planner body reviewed in the consensus cycle inside the artifact envelope without modification. Append the exact Architect and Critic results, Review Ledger, and handoff as provenance outside that immutable body.

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

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them through Planner, Architect, and Critic reviews.
- Never delegate this tool call to a sub-agent.
- Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, data handling, or acceptance criteria prevents approval.

## Review Assignment Policy

- Use exact installed roles and unique task names with `fork_turns: "none"`.
- Require Architect and Critic to follow the common output discipline while preserving every required review field and verdict.
- Skip lanes only when the task is already narrow and non-architectural; then use `csx-plan`.
- If any required role is unavailable, ask the user to rerun `csx install` for the intended scope and write `BLOCKED: required independent role unavailable`.

## Proportionality Policy

- Classify proposed work and review feedback as accepted scope, concrete change-induced safety or regression risk, or optional hardening.
- Architect and Critic may block only the first two classes. New extremes, environments, threat models, compatibility promises, or general hardening remain follow-ups unless the user explicitly includes them.
- Undefined support boundaries that materially alter the design are user-owned decisions; do not resolve them by selecting an unbounded domain.
- Keep the Verification Matrix minimal and deduplicated. Default to one primary-environment full suite plus affected-environment smoke checks, unless the accepted requirements or changed boundary explicitly require a complete matrix.
- Reuse a single scenario across related criteria when it provides direct evidence and preserve stronger explicit evidence without multiplying equivalent checks.

## Planner Body Shape

The Planner owns and returns this complete immutable body:

```markdown
# Plan: <title>

draft_version: <N>

## Decisions and Assumptions
### User-confirmed Decisions
### Reversible Assumptions
### Open Decisions

## Goal and Boundaries

## Decision Record

## Acceptance Criteria

## Plan

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

## Unresolved Blockers

## Handoff
```

## Final Handoff

After writing the artifact, call `request_user_input` from the root thread.

For `Decision: APPROVED`, show:

1. `Start execution with $csx-start-goal (Recommended)`
2. `Refine further`
3. `Stop`

For `Decision: BLOCKED`, show only:

1. `Refine further (Recommended)`
2. `Stop`

Only an explicit `Start execution with $csx-start-goal` selection authorizes implementation and accepts the listed reversible assumptions. Pass the plan path, approved draft version, boundaries, acceptance criteria, Verification Matrix, risks, and stop conditions to `$csx-start-goal`. Never invoke execution from a BLOCKED plan.
