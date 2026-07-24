---
name: csx-analyze
description: Read-only repository analysis with ranked conclusions, file-backed evidence, confidence labels, and clear evidence-vs-inference boundaries. Use when the user asks to analyze, investigate, explain behavior, identify likely causes, or understand impact before changes.
---

# csx-analyze

Use this skill for read-only understanding. Do not edit files or turn the answer into an implementation plan unless the user separately asks for one.

## Orchestration Boundary

The skill owns question framing, lane selection, parallelism, token budgets, and delivery. `csx-explorer` owns repository investigation and the evidence-backed answer. The root must not replace a required Explorer result with self-authored repository analysis.

Every Explorer assignment must state:

```text
Objective:
Inputs:
Scope:
Required work/checks:
Expected deliverable:
Required vocabulary:
Constraints:
Stop conditions:
```

## Workflow

1. Restate the question in one sentence.
2. Confirm `csx-explorer` is available. If it is missing, ask the user to rerun `csx install` for the intended scope and stop with `BLOCKED: csx-explorer unavailable`. Do not replace repository investigation with root-authored analysis.
3. For a simple lookup, assign one `csx-explorer` the question, likely scope, required evidence, output shape, and stop condition. Return its answer after checking that cited evidence exists.
4. For cross-file or complex questions, spawn 2-3 bounded `csx-explorer` agents in parallel:
   - primary path and contracts
   - configuration, generated files, or orchestration
   - tests, docs, or corroborating evidence
5. Give each agent a unique task name, `fork_turns: "none"`, the original question, an explicit lane scope, required evidence, expected packet, and stop condition.
6. Wait for every lane. If a lane fails or returns a malformed packet, resend its complete bounded assignment once. If it still fails, mark that lane missing; the final Explorer must inspect that missing scope itself within the final synthesis cap or return `BLOCKED: required evidence lane unavailable`. The root must not fill the evidence gap.
7. Assign one final `csx-explorer` the original question plus every successful evidence packet and any missing-lane scope. Require it to:
   - validate material packet claims against repository source;
   - reconcile conflicts and identify stale or missing evidence;
   - rank competing explanations by support;
   - separate every material conclusion as `Evidence`, `Inference`, or `Unknown`;
   - assign `High`, `Medium`, or `Low` confidence with a concise reason;
   - return the complete final answer in the Output shape below.
8. Deliver the final Explorer result without independently replacing its technical conclusions. Check only that required fields, citations, and evidence boundaries are present. If final synthesis fails or returns `BLOCKED`, report that blocker rather than synthesizing in the root.
9. When the same user request also explicitly asks for requirements or a plan, pass the final Explorer evidence packet and original question to `$csx-spec` as current upstream evidence. Do not make the downstream skill rediscover unchanged facts.
10. End with the next read-only probe only when the final Explorer says it would materially reduce uncertainty.

## Token Budget

- Simple lookup: 1-3 files.
- Cross-file behavior: 4-8 files.
- Architecture or failure explanation: stop after two search waves unless new evidence changes the ranking.
- Subagent lane cap: 2,000 tokens per lane. Use one Explorer lane rather than parallel lanes for one-file or obvious answers.
- Final synthesis cap: 3,000 tokens.

Do not substitute root self-review or a generic agent when `csx-explorer` is required.

## Output

```text
Question: ...

Ranked Synthesis
1. ... Confidence: High/Medium/Low
   Evidence: file:line ...
   Inference: ...

Unknowns
- ...
```
