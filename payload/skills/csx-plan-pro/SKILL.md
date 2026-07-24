---
name: csx-plan-pro
description: Higher-rigor planning with bounded Architect then Critic review for broad, risky, or architecture-sensitive work. Use when a normal plan may miss tradeoffs, sequencing, testing strategy, or hidden coupling.
---

# csx-plan-pro

Use this skill when ordinary planning is not enough, but a full external orchestration system would be too heavy.

## Contract

Produce one decision-ready, versioned plan with independent review pressure. Consensus exists only when Architect and Critic approve the same draft version. Do not start implementation unless the user explicitly selects the final `$csx-start-goal` handoff.

## Workflow

1. Spawn `csx-explorer` for repository evidence and `csx-analyst` for requirement gaps. Run them in parallel when independent.
2. Route the Analyst result before drafting:
   - `READY`: continue.
   - `READY_WITH_ASSUMPTIONS`: preserve every reversible assumption in the decision ledger and continue.
   - `BLOCKED`: resolve user-owned decisions in the root thread. If the blocker cannot be resolved, write a BLOCKED artifact and skip Planner, Architect, and Critic.
3. In the root thread, resolve user-owned decisions exposed by the evidence packets. Record user-confirmed decisions, reversible assumptions, and open decisions separately.
4. Give both evidence packets and user decisions to `csx-planner`. Ask for `draft_version: 1`, a Decision Record, the implementation plan, acceptance criteria, a Verification Matrix, risks, and stop conditions.
5. Spawn `csx-architect` with the exact draft version. It must echo that version and provide:
   - strongest counterargument against the favored path
   - hidden coupling or boundary risk
   - at least one tradeoff tension
   - `CLEAR`, `WATCH`, or `BLOCK`
6. After the Architect result returns, spawn `csx-critic` with the same draft version and the Architect result. It must echo that version, verify referenced files and symbols, simulate two representative implementation steps against the repository, and issue `APPROVED`, `REVISE`, or `BLOCKED`.
7. Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same `draft_version`. A missing or mismatched version is not consensus.
8. Route every non-consensus result back through a complete review cycle:
   - Architect `WATCH` or `BLOCK`, Critic `REVISE` or `BLOCKED`, or an accepted material improvement requires revision.
   - Resolve any new user-owned decision in the root thread before revision.
   - Resume the same `csx-planner` when possible with consolidated feedback and increment `draft_version` by exactly one.
   - If the Planner cannot be resumed, spawn a fresh `csx-planner` with the complete evidence, decisions, prior draft, and feedback; record the fallback in the Review Ledger.
   - Run a fresh Architect review followed by a fresh Critic review for the new version.
9. Repeat until consensus or a maximum of 5 review cycles. An unresolvable blocker or failure to reach consensus after cycle 5 produces a BLOCKED artifact containing the best draft and unresolved blockers.
10. Before finalization, compare the consensus draft with the original request, input spec, and user decisions. If the plan introduces a conflicting assumption or open decision that can change implementation, reconcile it with the user and start a new versioned review cycle.
11. Write `.csx/plans/<slug>-pro.md` for both `APPROVED` and `BLOCKED`. The approved plan body must be the exact body reviewed in the consensus cycle; the root may append review provenance and handoff metadata.

## Material Change Rule

Any post-review change to scope, boundaries, approach, sequence, acceptance criteria, verification, risks, decisions, assumptions, or stop conditions invalidates both verdicts and starts the next cycle. Editorial formatting that does not change meaning may be appended outside the approved plan body.

## Decision Record

Every draft must include:

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

Include at least two viable options with bounded tradeoffs. If only one option remains viable, include explicit invalidation rationale for the rejected alternatives.

## Deliberate Profile

Auto-enable deliberate planning when the request involves authentication or authorization, security, data or schema migration, destructive or irreversible changes, incident recovery, compliance or PII, public API breakage, or concurrency/distributed state. Also enable it when the user explicitly requests deliberate or high-risk planning.

A deliberate draft must include:

- three concrete failure scenarios
- prevention, detection, and containment or rollback for each scenario
- unit, integration, e2e, and observability verification, or an explicit rationale when a layer does not apply
- compatibility, permissions, or data-integrity checks relevant to the task
- execution stop conditions and recovery confirmation

Architect must review boundary, threat, compatibility, and rollback risk. Critic must reject a missing or weak deliberate section.

## Root User Decisions

For initial decisions, review-exposed decisions, and final intent reconciliation, call `request_user_input` from the root thread only when a preference or tradeoff belongs to the user.

- Ask 1-3 material questions, each with 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Preserve user notes as plan constraints and pass them through Planner, Architect, and Critic reviews.
- Never delegate this tool call to a sub-agent.
- Fall back to a direct text question if the tool is unavailable.
- An open decision that changes the execution path, public behavior, data handling, or acceptance criteria prevents approval.

## Token Budget

- Use exact installed roles and unique task names with `fork_turns: "none"`.
- Architect lane cap: 3,000 tokens.
- Critic lane cap: 3,000 tokens.
- Skip lanes only when the task is already narrow and non-architectural; then use `csx-plan`.
- If any required role is unavailable, ask the user to rerun `csx install` for the intended scope and write `BLOCKED: required independent role unavailable`.

## Output

```markdown
# Pro Plan: <title>

## Decision
APPROVED / BLOCKED

## Approved Version
draft_version: <N or N/A>

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

## Architect Review

## Critic Review

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
