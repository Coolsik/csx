---
name: analyze
description: Read-only repository analysis with ranked conclusions, file-backed evidence, confidence labels, and clear evidence-vs-inference boundaries. Use when the user asks to analyze, investigate, explain behavior, identify likely causes, or understand impact before changes.
---

# analyze

Use this skill for read-only understanding. Do not edit files or turn the answer into an implementation plan unless the user separately asks for one.

## Workflow

1. Restate the question in one sentence.
2. Confirm `csx-explorer` is available. If it is missing, ask the user to run `$csx:setup`; continue only for a trivial one-file lookup and label it `DEGRADED: custom agent unavailable`.
3. Inspect the smallest relevant file set first; widen only when evidence conflicts or a call path crosses boundaries.
4. For cross-file or complex questions, spawn 2-3 bounded `csx-explorer` agents in parallel:
   - primary path and contracts
   - configuration, generated files, or orchestration
   - tests, docs, or corroborating evidence
5. Give each agent a unique lane, an explicit stop condition, and the evidence it must return. Use `fork_turns: "none"` so lanes rebuild context from repository facts.
6. Wait for every spawned lane, reconcile conflicts against source, and separate each material claim as `Evidence`, `Inference`, or `Unknown`.
7. Rank competing explanations by support.
8. End with the next read-only probe only when it would materially reduce uncertainty.

## Token Budget

- Simple lookup: 1-3 files.
- Cross-file behavior: 4-8 files.
- Architecture or failure explanation: stop after two search waves unless new evidence changes the ranking.
- Subagent lane cap: 2,000 tokens per lane. Skip delegation only for one-file or obvious answers.

Do not substitute generic or self-review lanes when `csx-explorer` is required.

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
