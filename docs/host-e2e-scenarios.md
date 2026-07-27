# CSX Host-Level Workflow Scenarios

These scenarios verify behavior that static `node:test` contract checks cannot prove. They must
run in a Codex host that can invoke the installed CSX skills and agents. A passing contract test
does not mark a scenario passed.

For every run, record:

- host and Codex version;
- repository revision;
- accepted spec, plan, goal, and handoff artifact paths and SHA-256 digests;
- invoked roles in order;
- structured statuses and blocker/finding IDs;
- changed paths;
- focused, integration/static, and full-suite commands and results; and
- final verdict.

Do not record a scenario as passed without the listed direct evidence.

## H01 — Architect BLOCK skips Critic

Setup:

- Supply an accepted spec and a Plan-Pro draft with one scope-authorized architectural defect.

Expected:

- Architect returns `BLOCK` with the common finding schema.
- `scope_authority` is non-null.
- Critic is not invoked.
- Critic status is `SKIPPED_ARCHITECT_NOT_CLEAR`.

Evidence:

- immutable Architect review path and digest;
- invocation trace showing no Critic call; and
- Review Ledger entry.

## H02 — Accepted Constraint Envelope blocks unsupported complexity

Setup:

- Accepted spec uses `best-effort` reliability and forbids new persistent storage.
- Draft adds a database-backed retry queue without scope authority.

Expected:

- Planner, Architect, and Critic assignments contain `accepted_spec_path`,
  `accepted_spec_sha256`, `reliability_class`, and `complexity_budget`.
- Architect blocks the unsupported mechanism as `accepted-scope-defect`.
- The finding cites the relevant stable constraint ID.

Evidence:

- bounded assignments;
- accepted spec digest;
- Architect result with the echoed envelope and common finding fields.

## H03 — Missing scope authority cannot block

Setup:

- Reviewer reports a plausible improvement without an accepted-spec ID or
  `REGRESSION:<invariant>`.

Expected:

- The finding is downgraded to `optional-hardening` or a non-blocking implementation note.
- Verdict remains `CLEAR`, `COMMENT`, or `APPROVE` as otherwise appropriate.

Evidence:

- reviewer result showing `scope_authority: null`; and
- final ledger disposition.

## H04 — Repeated infeasible blocker converges

Setup:

- Reproduce the same scope-authorized blocker through bounded revisions until no correction can
  satisfy the accepted spec.

Expected:

- Stable finding ID is retained.
- The reviewer simplifies before requesting new machinery.
- Terminal result contains exactly `INFEASIBLE_UNDER_CURRENT_SPEC`.

Evidence:

- versioned reviews and revision briefs;
- stable Blocker Ledger; and
- terminal artifact and digest.

## H05 — Concise production-code goal skips Deslop

Setup:

- Execute a production-code goal whose changed code is concise, has no cleanup smell, and whose
  purpose fits one clear sentence.

Expected:

- Deslop is not invoked.
- Goal records `DESLOP_SKIPPED_CONCISE_GOAL`.
- Record includes `one_line_purpose`, changed paths, and `cleanup_findings: none`.

Evidence:

- goal checkpoint;
- invocation trace showing no Deslop call; and
- passing focused tests.

## H06 — Non-concise production-code goal runs Deslop once

Setup:

- Execute a goal with production-code changes that cannot satisfy the concise skip gate.

Expected:

- Deslop receives only the goal ID, one-line outcome, goal-owned changed paths, directly
  affected boundaries, focused tests, and non-goals.
- Deslop runs exactly once for that goal.
- Goal records `DESLOP_COMPLETED`.
- Affected focused regression tests pass afterward.

Evidence:

- bounded Deslop assignment;
- invocation count;
- before/after behavior-lock result; and
- goal checkpoint.

## H07 — Cross-goal cleanup stays bounded

Setup:

- Two completed goals introduce a duplicated invariant that becomes visible only during
  cumulative review.

Expected:

- No integrated Deslop call occurs.
- No earlier goal receives a second Deslop call.
- Reviewer returns one invariant-family rework packet covering only cited paths.

Evidence:

- cumulative review;
- Deslop invocation counts by goal; and
- bounded Executor rework assignment.

## H08 — Leader rotation does not replace Root

Setup:

- Trigger a Plan Leader or Start-Goal Leader rotation through a documented context or fallback
  threshold while Root retains decision fidelity.

Expected:

- Old writer terminates before the successor starts.
- Successor uses `fork_turns: "none"` and verified artifacts.
- Root and the user-visible thread remain unchanged.
- No `ROOT_REPLACEMENT_RECOMMENDED` packet appears.

Evidence:

- writer provenance;
- successor assignment;
- artifact digests; and
- Root/thread continuity record.

## H09 — Root fidelity loss recommends Root replacement

Setup:

- Demonstrate one allowed reason: lost Root decision fidelity, project identity change,
  unbounded transcript accumulation, mixed goal authority, or unavailable internal successor.

Expected:

- Workflow leader returns `ROOT_REPLACEMENT_RECOMMENDED` only to Root.
- Packet contains a valid reason code and bounded resume paths, digests, phase, next action,
  findings, and unresolved user decisions.
- Leader does not create or directly propose a user-visible thread.
- Root presents the recommendation; the user or product creates the new thread.

Evidence:

- structured recommendation packet;
- Root response;
- successor Root artifact verification; and
- absence of transcript relay.

## H10 — Artifact failure and host enforcement remain explicit

Setup:

- Run once with a missing artifact, once with a digest mismatch, and once with an attempted
  Leader write outside its prompt-authorized path.

Expected:

- Missing artifact returns `BLOCKED_ARTIFACT_MISSING`.
- Digest mismatch returns `BLOCKED_ARTIFACT_MISMATCH`.
- Out-of-scope write returns the applicable unauthorized-write blocker when the host exposes it.
- If the host cannot enforce or expose the write boundary, the run records that limitation and
  does not claim runtime enforcement.

Evidence:

- structured statuses;
- before/after workspace state;
- host capability record; and
- no fabricated success artifact.
