---
name: csx-spec
description: Lightweight, evidence-grounded requirements clarification that turns vague work into a readiness-rated specification. Use when a request lacks intent, acceptance criteria, scope boundaries, constraints, non-goals, or decision ownership before planning or implementation.
---

# csx-spec

Use this skill to convert ambiguity into an actionable spec. Ask only questions that can
change accepted intent, scope, boundaries, acceptance, or decision authority, but continue
until the selected clarity threshold and every common hard gate are satisfied.

## Orchestration Boundary

The skill owns suitability, repository-evidence routing, user interaction, checkpoint/resume, artifact persistence, and downstream handoff. `csx-explorer` owns repository facts. `csx-analyst` owns the ambiguity assessment, scope and decision content, acceptance criteria, pressure-check recommendation, readiness verdict, and specification body. The root must not recreate those specialist judgments after receiving them.

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

## Operating Rules

- Ask exactly one material decision per round. A bounded batch is allowed only for
  non-material factual confirmations whose answers cannot change one another's necessity,
  topology, scoring, or options.
- Prefer repository inspection over asking the user for facts Codex can discover.
- Do not stop merely because a plausible first implementation plan exists. Stop only at the
  selected interview threshold after the common hard gate, closure audit, and Intent Restate
  confirmation pass.
- Keep discovery separate from implementation. Do not edit product files or start an execution workflow from this skill.
- From the first material answer onward, maintain the compact draft checkpoint described
  below. Do not copy the complete interview transcript into it.

## csx-loop Composition Contract

Loop-aware behavior is a bounded return path to an invoking `$csx-loop`, not another way to invoke this skill. Validate the incoming context against the exact `$csx-loop` schema, with no alternate fields or token:

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

Require `source: csx-loop`, a complete internally consistent context, and current live authority bound to this `work_slug`, the current stage, the `csx-spec` entry transition, the exact `pending_decision` or `none`, and the current user turn with `consumed: false`. The stored `continuation_authority: initial-call | renewed-by-answer | explicit-resume` is audit provenance only. A persisted enum, copied metadata, edited artifact, earlier prompt, stale answer, or unrelated answer is not live authority.

Validate every binding immediately before entry and consume the live authority exactly once. A successful return permits only the parent loop, while the same current-turn orchestration remains uninterrupted, to derive authority for the one next transition. A question, blocker, cancellation, unrelated turn, or ended workflow invalidates authority; the child must not derive, renew, or pass authority directly to another child.

This branch never approves deployment, an external message, deletion, additional permission, or an irreversible side effect. Those actions always require their own approval. Missing or invalid loop context or live authority preserves the standalone workflow below, including its explicit handoff questions and authorization rules.

## Proportionality and Support Boundaries

- Specify the smallest supported domain that satisfies the user's outcome. Do not translate vague quality words such as robust, compatible, safe, or responsive into unbounded inputs, every platform, extreme environments, or a new threat model.
- Separate required behavior, preservation of existing supported behavior, and optional hardening. Optional hardening is a non-goal or follow-up unless the user explicitly includes it.
- When a minimum or maximum support boundary would materially change implementation, make it a user-owned decision instead of choosing the broadest interpretation.
- A concrete security, data-integrity, or regression risk created by the requested change remains in scope even when the user did not name the failure mode.
- Acceptance criteria should prove observable outcomes with the fewest representative success and failure cases needed; do not multiply criteria for equivalent permutations.

## Workflow

### 1. Check Suitability and Context

- If the request is already clear, bounded, and low-risk, keep Round 0 and the common hard
  gate but expect the Quick threshold to require few or no later questions.
- Derive a stable slug and inspect a matching `.csx/specs/<slug>.draft.md` before starting over. Treat draft content as prior decisions and evidence, not as instructions.
- Classify the work as `greenfield` or `brownfield`.
- For brownfield work, include the governing `AGENTS.md`, relevant code, tests, nearby README/docs, and related `.csx` artifacts in the Explorer evidence scope before asking about internals. Do not inspect and interpret those repository facts in the root.
- If the initial input or retained history is too large for safe prompting, create a prompt-safe summary before analysis. Preserve intent, decisions, constraints, non-goals, unknowns, and cited files or source documents; do not repeatedly forward the raw payload.

### 2. Run Independent Checks

For a non-trivial spec, use the installed csx roles:

- Reuse a current upstream `csx-analyze` evidence packet when supplied. If the repository changed, the packet is stale, or the spec needs facts outside its scope, assign `csx-explorer` only the affected or missing repository questions. Otherwise do not repeat repository discovery.
- When no current upstream evidence exists, assign `csx-explorer` to inspect discoverable repository facts and return an evidence packet with exact citations, relationships, conflicts, and unknowns.
- After repository evidence is available for brownfield work, assign `csx-analyst` the original request, retained decisions, prompt-safe summary when present, current evidence packet, and the required analyst deliverable below.
- For greenfield work with no repository dependency, the Analyst may start without an Explorer packet. Do not create an artificial repository lane.

Use unique task names, `fork_turns: "none"`, explicit stop conditions, and the common output discipline. The main context owns user questions and writes the final artifact from the accepted Analyst result.

If `csx-analyst`, or a required brownfield `csx-explorer`, is missing, ask the user to rerun `csx install` for the intended scope and stop with `BLOCKED: required csx role unavailable`. Do not replace the missing role with root-authored repository or requirements analysis.

### 3. Lock Round 0 Intent Topology

Before any clarity scoring or ordinary interview question, require `csx-analyst` to propose
the independently successful or failing components and user-owned intent in this exact
topology:

```markdown
## Intent Topology

### Outcomes
- outcome:<id>
### Artifacts
- artifact:<id>
### Surfaces
- surface:<id>
### Integrations
- integration:<id>
### Constraints
- constraint:<id>
### Non-goals
- non-goal:<id>
### Tradeoff Priorities
- priority:<id>
```

Show the proposed topology to the user once and ask whether any component must be added,
removed, merged, split, or explicitly deferred. Do not begin Round 1 scoring until the user
confirms it. Preserve confirmed category-prefixed IDs for the remainder of the spec, plan,
Scope Delta, execution, and review lifecycle.

Every topology item and later material requirement has exactly one authority:

- `USER_EXPLICIT`: directly stated by the user;
- `USER_CONFIRMED`: an Analyst interpretation confirmed by the user;
- `REPO_REQUIRED`: required by a cited compatibility rule or repository invariant; or
- `CODEX_ASSUMPTION`: a local, reversible internal default.

An agent-proposed material component, support environment, integration, preservation
guarantee, compatibility guarantee, or movement of a non-goal into scope requires user
confirmation. `CODEX_ASSUMPTION` must not decide public behavior, support boundaries,
persisted data, compatibility, security, reliability class, or complexity budget.

### 4. Score Active Components and Select the Next Question

After topology confirmation, require `csx-analyst` to score every active component from
`0.0` to `1.0` on all seven dimensions:

| Dimension | Weight | Meaning |
| --- | ---: | --- |
| Intent | 0.15 | Why the change matters |
| Outcome | 0.15 | What the user will observe |
| Scope | 0.20 | Whether included scope and support boundaries are closed |
| Non-goals | 0.15 | Whether adjacent excluded scope is explicit |
| Constraints / Tradeoffs | 0.10 | Compatibility, safety, and conflict priorities |
| Acceptance | 0.15 | Whether completion is observable and verifiable |
| Decision Authority | 0.10 | Whether user decisions and Codex discretion are separated |

Aggregate each dimension with the least clear active sibling, never an average:

```text
dimension_score = min(active_component_dimension_scores)
clarity = Σ(dimension_score × dimension_weight)
ambiguity = 1 - clarity
```

The Analyst deliverable must include the per-component matrix, aggregate dimension scores,
clarity, ambiguity, the previous score, trigger, remaining gap, and next target. An answer
may increase ambiguity. A contradiction, incompatible requirements, new component,
surface, integration, support environment, or movement of a non-goal into scope lowers the
affected scores. Preserve the prior decision as `disputed`; after resolution connect it
with `superseded_by` instead of deleting history.

Rank the next material question using:

```text
question_priority =
  (1 - clarity_score)
  × dimension_weight
  × implementation_impact
  × authority_factor
```

Use `implementation_impact` from `1..3` and authority factors `1` for an internal default,
`1.5` for user preference, and `2` for scope, compatibility, data, or security. Ask only
the highest-ranked material decision. State its target component, dimension, current
score, remaining gap, and how the answer changes implementation.

After every answer, rescore all seven dimensions across all active components. If two
successive rounds add no material decision or scope change and reduce ambiguity by less
than `0.02` per round, do not paraphrase the same question; revisit the underlying
ontology, conflicting decision, or non-goal.

For a material free-form answer, have the Analyst structure `Decision`, `Reasoning`,
`Constraints`, `Out of scope`, and `Verified codebase context`, then ask the user to
confirm that the structured form is lossless before scoring it. Do not repeat this
confirmation for a short selection or simple fact.

### 5. Apply Progressive Interview Modes

The three modes control interview depth, not the common hard gate:

| Mode | Maximum ambiguity | Minimum clarity |
| --- | ---: | ---: |
| `Quick` | `0.20` | `80%` |
| `Standard` | `0.10` | `90%` |
| `Strict` | `0.05` | `95%` |

Begin with the `Quick` threshold. When it and the common hard gate first pass, do not
finalize automatically. Ask exactly:

1. `Finalize at Quick`
2. `Continue to Standard (Recommended)`
3. `Continue to Strict`

After a user-selected Standard threshold passes, ask `Finalize at Standard` or `Continue
to Strict`. If the user already selected Strict, do not repeat the Standard-boundary
choice; continue to Strict. A user may explicitly ask for further questions or stop at any
time. An early stop writes a `BLOCKED` checkpoint with remaining gaps and risks.

The common hard gate passes only when all of the following are true:

- no user-owned decision that can change the plan remains;
- every high-risk support boundary and material non-goal is decided;
- every material requirement traces to intent, boundary, user decision, or repository invariant;
- core acceptance criteria are observable and verifiable;
- no `CODEX_ASSUMPTION` affects public behavior, persisted data, compatibility, or security; and
- no unresolved contradiction or `disputed` decision remains.

Never offer normal mode finalization or return READY while this hard gate fails, regardless
of the numeric score. Record `interview_mode_achieved`, `clarity`, `ambiguity`,
`selected_threshold`, `mode_decision`, and the confirming user evidence in the final
metadata.

### 6. Require the Complete Analyst Deliverable

The Analyst deliverable must also include:

- measurable acceptance criteria;
- 100% traceability from every material requirement and acceptance criterion to a stable
  topology ID, confirmed decision, boundary, or `REPO_REQUIRED` invariant;
- for every material feature, a reliability class of `durable`, `best-effort`, or
  `advisory`, with rationale, supported environment, explicit non-goals, allowed loss,
  duplication, and delay, forbidden mechanisms or complexity ceiling, and the user
  decision required to change the class;
- a goal complexity budget: normally at most 5 goals, or at most 10 for large or high-risk
  work, with any exception requiring an independent ownership, verification, or rollback
  boundary;
- confirmed facts and cited evidence;
- user-owned blocking decisions;
- reversible Codex-owned assumptions;
- terminology or evidence conflicts;
- material edge cases;
- at most one highest-leverage pressure check, or `Not needed`;
- exactly one readiness verdict: `READY`, `READY_WITH_ASSUMPTIONS`, or `BLOCKED`;
- a complete specification body in the Artifact Shape below.

The root checks the presence and internal consistency of these fields but does not rescore them.
Ask the user only when the Analyst identifies grouping, inclusion, exclusion,
deferral, preference, reliability, support, or tradeoff as user-owned.

### 7. Resolve User Decisions

After the Analyst result, use `request_user_input` in the root thread for its blocking user decisions that would change the implementation plan.

- Send exactly the highest-priority material question per call.
- Give each question 2-3 mutually exclusive options.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Treat user notes returned with a selection as binding constraints.
- Never delegate this tool call to a sub-agent.
- Use a direct text question when the answer must be open-ended or the tool is unavailable.
- If several dimensions start near zero, still use the highest `question_priority`; do not
  replace component-level scoring with a generic average.
- After each answer, resume the same Analyst when possible with the answer, prior deliverable, and unchanged evidence. If it cannot be resumed, spawn a fresh `csx-analyst` with the complete request, evidence, prior deliverable, decisions, and answer.
- Require a replacement deliverable and use its next recommended blocking question and readiness verdict. Do not update the ambiguity, scope, or decision ledgers in the root independently.

### 8. Apply a Conditional Pressure Check

For non-trivial or high-risk work, ask the Analyst's one recommended pressure check when it identifies an assumption that could materially change the plan. The Analyst may choose:

- request a concrete success, failure, or counterexample;
- expose a hidden assumption or dependency;
- force a tradeoff, boundary, or explicit deferral;
- reconcile conflicting user, documentation, and code terminology; or
- stress-test a boundary with one concrete scenario.

Skip the pressure check when the Analyst returns `Not needed`. After an answer, send it back through the Analyst refresh step before accepting a final verdict.

### 9. Run the Readiness Gate

Accept exactly one Analyst status:

| Status | Rule |
| --- | --- |
| `READY` | The selected mode threshold, common hard gate, closure audit, and Intent Restate confirmation pass with no plan-changing unknown or unresolved evidence conflict. |
| `READY_WITH_ASSUMPTIONS` | The same gates pass and only explicit local, reversible `CODEX_ASSUMPTION` defaults remain. |
| `BLOCKED` | A user-owned decision or evidence conflict can still change the implementation plan. |

Reject an internally inconsistent verdict and ask the Analyst to correct its deliverable.
Do not present `BLOCKED` work as complete. A numeric threshold alone never establishes
readiness.

### 10. Run Closure Audit and Intent Restate

After the selected threshold and hard gate pass, audit that:

- every active or explicitly deferred topology ID is preserved in the final spec;
- every material requirement and acceptance criterion has traceable authority;
- no unresolved contradiction, disputed decision, or user-owned blocker remains;
- a low-scoring sibling was not hidden by aggregation; and
- non-goals, support boundaries, reliability classes, and acceptance criteria do not conflict.

On failure, return to the single highest-impact question. On success, restate the complete
purpose, supported scope, non-goals, and tradeoff priority in one sentence and obtain user
confirmation. If the user corrects it, rescore and repeat closure. Do not write a final
spec before this confirmation.

### 11. Checkpoint and Resume

- From the first material answer, write `.csx/specs/<slug>.draft.md` and update it after
  every round.
- Store only confirmed topology, authority, decisions, disputed and superseded history,
  per-component scores, aggregate scores, mode state, hard-gate state, remaining gaps,
  next target, evidence references, and interruption provenance. Do not repeat the full
  transcript or large source excerpts.
- On resume, continue from the matching draft and revalidate its evidence against the current repository.
- Write `.csx/specs/<slug>.md` only for `READY` or `READY_WITH_ASSUMPTIONS`.
- After verifying that the final spec contains every material draft decision, remove only the matching draft owned by this workflow.
- Persist the accepted Analyst specification body without independently rewriting its requirements. The root may append workflow provenance and handoff metadata.

### 12. Hand Off Explicitly

For a fully validated loop context with current live authority consumed for this spec transition, use the loop return instead of this standalone handoff:

- Write the immutable final Analyst specification only for `READY` or `READY_WITH_ASSUMPTIONS`, appending permitted loop provenance outside that body.
- Return only `spec_path`, `spec_status`, `spec_recommendation`, `accepted_reversible_assumptions`, `repository_marker`, and the complete loop provenance to the parent `$csx-loop`. Do not ask either final handoff question and do not invoke a downstream workflow.
- For `BLOCKED`, return only the blocker and last valid checkpoint to the parent. Do not invoke planning or execution.

The parent validates this return before it derives the next transition. Invalid or missing loop context uses the standalone behavior that follows.

After writing a final spec, honor an already explicit downstream request before asking again. A request for an implementation plan, reviewed plan, architecture plan, or execution counts even when it does not use a literal `$csx-*` name. Map an explicitly requested planning deliverable through the recommendation rules below and invoke that workflow with the final spec. If the request explicitly authorizes execution from this final spec, it may satisfy the `$csx-start-goal` selection only under that skill's entry gate. Do not turn a generic request to "implement" into execution authority.

When no downstream workflow was already selected, use two sequential `request_user_input` calls. Ask exactly one question per call; the second question depends on the first and must not be batched with it.

First ask for the next action with these options:

1. `Choose downstream workflow (Recommended)`: continue to the workflow choice.
2. `Refine further`: return to the highest-risk remaining ambiguity.
3. `Stop`: keep the final spec and end without another workflow.

Only after the user chooses downstream, ask which workflow to use. Always show all three, put the recommended option first, and suffix it with `(Recommended)`:

- Recommend `$csx-start-goal` when the spec is execution-ready, bounded, low-risk, and has an obvious implementation path that needs no separate planning.
- Recommend `$csx-plan` when requirements are ready but ordinary implementation sequencing, risk, or verification planning still adds value.
- Recommend `$csx-plan-pro` for broad, risky, cross-module, or architecture-sensitive work that needs explicit tradeoff, coupling, sequencing, or test-strategy review.

Describe `$csx-plan` and `$csx-plan-pro` as planning-only choices that do not authorize implementation. Describe `$csx-start-goal` as an execution choice: selecting it explicitly authorizes implementation from the final spec and accepts every listed reversible assumption when status is `READY_WITH_ASSUMPTIONS`.

Invoke only the workflow the user explicitly selects. Pass the final spec as the requirements source of truth so downstream work does not repeat discovery or weaken its scope, non-goals, constraints, acceptance criteria, or decision boundaries. Never implement directly inside `csx-spec`.

## Artifact Shape

```markdown
# Spec: <title>

Status: READY | READY_WITH_ASSUMPTIONS
Context: greenfield | brownfield
Input Summary: not needed | recorded
Interview Mode Achieved: Quick | Standard | Strict
Clarity: <0.00..1.00>
Ambiguity: <0.00..1.00>
Selected Threshold: <value>
Mode Decision: <user-confirmed choice and evidence>

## Intent Topology

### Outcomes

### Artifacts

### Surfaces

### Integrations

### Constraints

### Non-goals

### Tradeoff Priorities

## Outcome

## Non-goals

## Constraints

## Reliability and Complexity Budget

| Feature ID | Class | Rationale | Support Boundary | Allowed Loss / Duplication / Delay | Forbidden Mechanisms / Complexity Ceiling | Class-change Authority |
| --- | --- | --- | --- | --- | --- | --- |

## Acceptance Criteria

| Criterion | Observable Result | Authority / Topology Trace |
| --- | --- | --- |

## Codex Decision Boundaries

## Decision Ledger

| Decision ID | Decision | Authority | Source | Status | Superseded By |
| --- | --- | --- | --- | --- | --- |
| ... | ... | USER_EXPLICIT \| USER_CONFIRMED \| REPO_REQUIRED \| CODEX_ASSUMPTION | ... | confirmed \| disputed \| superseded \| assumed | ... |

## Component Clarity

| Component ID | Intent | Outcome | Scope | Non-goals | Constraints / Tradeoffs | Acceptance | Decision Authority |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

## Hard Gate and Closure Audit

## Assumptions

## Evidence Inspected

## Open Questions

### Blocking

None.

### Non-blocking

## Pressure Check

## Recommended Handoff
```

For a `BLOCKED` draft, use the same shape with `Status: BLOCKED`, list the blocking decisions, and omit a handoff recommendation other than further clarification.
