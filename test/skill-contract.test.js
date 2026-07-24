import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("csx-spec defines the P0-P2 readiness workflow", async () => {
  const skill = await readFile(resolve(root, "payload/skills/csx-spec/SKILL.md"), "utf8");

  for (const dimension of [
    "Intent",
    "Outcome",
    "Scope",
    "Non-goals",
    "Constraints",
    "Acceptance",
    "Decisions",
  ]) {
    assert.match(skill, new RegExp(`\\| ${dimension} \\|`));
  }

  for (const status of ["READY", "READY_WITH_ASSUMPTIONS", "BLOCKED"]) {
    assert.match(skill, new RegExp(`\\b${status}\\b`));
  }

  assert.match(skill, /up to three questions in one call only when they are independent/);
  assert.match(skill, /lightweight scope ledger when/);
  assert.match(skill, /Conditional Pressure Check/);
  assert.match(skill, /prompt-safe summary/);
  assert.match(skill, /\.csx\/specs\/<slug>\.draft\.md/);
  assert.match(skill, /Write `\.csx\/specs\/<slug>\.md` only for `READY` or `READY_WITH_ASSUMPTIONS`/);
  assert.match(skill, /use two sequential `request_user_input` calls/);
  assert.match(skill, /`Choose downstream workflow \(Recommended\)`/);
  assert.match(skill, /`Refine further`/);
  assert.match(skill, /`Stop`/);
  assert.match(skill, /Recommend `\$csx-start-goal` when the spec is execution-ready/);
  assert.match(skill, /Recommend `\$csx-plan` when requirements are ready/);
  assert.match(skill, /Recommend `\$csx-plan-pro` for broad, risky, cross-module, or architecture-sensitive work/);
  assert.match(skill, /Always show all three, put the recommended option first/);
  assert.match(skill, /selecting it explicitly authorizes implementation/);
  assert.match(skill, /Invoke only the workflow the user explicitly selects/);
});

test("csx analyst, start-goal, and routing hint match the readiness contract", async () => {
  const [analyst, startGoal, hook] = await Promise.all([
    readFile(resolve(root, "payload/agents/csx-analyst.toml"), "utf8"),
    readFile(resolve(root, "payload/skills/csx-start-goal/SKILL.md"), "utf8"),
    readFile(resolve(root, "payload/hooks/csx-hook.mjs"), "utf8"),
  ]);

  assert.match(analyst, /READY, READY_WITH_ASSUMPTIONS, or BLOCKED/);
  assert.match(analyst, /pressure check/);
  assert.match(startGoal, /reject `BLOCKED`/);
  assert.match(startGoal, /accept `READY_WITH_ASSUMPTIONS` only when the user explicitly selected execution/);
  assert.match(startGoal, /Preserve the spec's scope, non-goals, constraints, acceptance criteria, and decision boundaries/);
  assert.match(hook, /evidence-grounded requirements clarification with readiness/);
});

test("csx-plan versions revisions and requires an approved re-review", async () => {
  const skill = await readFile(resolve(root, "payload/skills/csx-plan/SKILL.md"), "utf8");

  assert.match(skill, /draft_version: 1/);
  assert.match(skill, /`APPROVED`:[\s\S]*same draft version is ready to finalize/);
  assert.match(skill, /`REVISE`:[\s\S]*`draft_version: 2`/);
  assert.match(skill, /A revised draft MUST receive one fresh Critic review/);
  assert.match(skill, /do not revise a third version in `csx-plan`/);
  assert.match(skill, /Any material change after approval invalidates that verdict/);
  assert.match(skill, /Decision[\s\S]*READY \/ BLOCKED/);
  assert.match(skill, /Review[\s\S]*APPROVED \/ SKIPPED_LOW_RISK \/ BLOCKED/);
  assert.match(skill, /for every completed plan whether the final Decision is `READY` or `BLOCKED`/);
  assert.match(skill, /## Acceptance Criteria/);
  assert.match(skill, /\| Criterion \| Evidence \| Command or Scenario \| Expected Result \| Failure Signal \|/);
  assert.match(skill, /Start execution with `?\$csx-start-goal/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx-plan-pro binds consensus to one reviewed draft version", async () => {
  const skill = await readFile(resolve(root, "payload/skills/csx-plan-pro/SKILL.md"), "utf8");

  assert.match(skill, /Architect and Critic approve the same draft version/);
  assert.match(skill, /Spawn `csx-architect`[\s\S]*After the Architect result returns, spawn `csx-critic`/);
  assert.match(skill, /Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same `draft_version`/);
  assert.match(skill, /increment `draft_version` by exactly one/);
  assert.match(skill, /Run a fresh Architect review followed by a fresh Critic review for the new version/);
  assert.match(skill, /maximum of 5 review cycles/);
  assert.match(skill, /BLOCKED artifact containing the best draft and unresolved blockers/);
  assert.match(skill, /Any post-review change[\s\S]*invalidates both verdicts/);
  assert.match(skill, /### Decision Drivers/);
  assert.match(skill, /### Options Considered/);
  assert.match(skill, /## Goal and Boundaries/);
  assert.match(skill, /## Acceptance Criteria/);
  assert.match(skill, /## Risks and Stop Conditions/);
  assert.match(skill, /## Review Ledger/);
  assert.match(skill, /three concrete failure scenarios/);
  assert.match(skill, /unit, integration, e2e, and observability verification/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx planning roles preserve versioned review and deliberate gates", async () => {
  const [planner, architect, critic] = await Promise.all([
    readFile(resolve(root, "payload/agents/csx-planner.toml"), "utf8"),
    readFile(resolve(root, "payload/agents/csx-architect.toml"), "utf8"),
    readFile(resolve(root, "payload/agents/csx-critic.toml"), "utf8"),
  ]);

  assert.match(planner, /increment the prior draft_version by exactly one/);
  assert.match(planner, /Decision Drivers/);
  assert.match(planner, /three failure scenarios/);
  assert.match(architect, /echo the supplied draft_version exactly/);
  assert.match(architect, /WATCH requires another revision cycle and is not approval/);
  assert.match(critic, /echo the supplied draft_version exactly/);
  assert.match(critic, /simulate two representative implementation steps/);
  assert.match(critic, /same draft_version/);
  assert.match(critic, /unit\/integration\/e2e\/observability coverage/);
});

test("csx-start-goal accepts only explicitly authorized ready plans", async () => {
  const skill = await readFile(resolve(root, "payload/skills/csx-start-goal/SKILL.md"), "utf8");

  assert.match(skill, /For a csx plan, accept only `Decision: READY`/);
  assert.match(skill, /For a csx pro plan, accept only `Decision: APPROVED`/);
  assert.match(skill, /Reject every `BLOCKED` plan/);
  assert.match(skill, /explicit `Start execution with \$csx-start-goal` selection/);
  assert.match(skill, /equivalent current-turn request that names `\$csx-start-goal`/);
  assert.match(skill, /Verification Matrix/);
  assert.match(skill, /instead of weakening or rediscovering them/);
});

test("csx-start-goal uses one aggregate goal and preserves unlimited acceptance criteria", async () => {
  const skill = await readFile(resolve(root, "payload/skills/csx-start-goal/SKILL.md"), "utf8");

  assert.match(skill, /Use exactly one aggregate Codex goal for the entire accepted plan/);
  assert.match(skill, /Never create one Codex goal per execution goal/);
  assert.match(skill, /implementation of the whole accepted plan/);
  assert.match(skill, /direct evidence for every acceptance criterion/);
  assert.match(skill, /Do not impose a count limit on acceptance criteria/);
  assert.match(skill, /Every acceptance criterion from the accepted input is a required criterion/);
  assert.match(skill, /Optionally group criteria under 2-5 top-level outcomes only when that improves readability/);
  assert.match(skill, /do not replace, merge, weaken, or summarize away original criteria or failure signals/);
  assert.match(skill, /Before implementation, assign each criterion concrete expected evidence/);
});

test("csx-start-goal defines risk-based ownership, deslop ordering, and execution states", async () => {
  const [skill, executor] = await Promise.all([
    readFile(resolve(root, "payload/skills/csx-start-goal/SKILL.md"), "utf8"),
    readFile(resolve(root, "payload/agents/csx-executor.toml"), "utf8"),
  ]);

  assert.match(skill, /`G001\.\.\.Gnnn` bounded implementation results/);
  assert.match(skill, /`pending -> in_progress -> ready_for_review -> complete`/);
  assert.match(skill, /`ready_for_review -> rework -> in_progress -> ready_for_review`/);
  assert.match(skill, /public API, schema, security, concurrency, migration, dependency, or architecture boundary/);
  assert.match(skill, /requires no coordination across modules/);
  assert.match(skill, /One focused verification can prove the result/);
  assert.match(skill, /If any condition is false or uncertain, assign the bounded goal to `csx-executor`/);
  assert.match(
    skill,
    /Run the assigned initial verification[\s\S]*invoke `\$csx-deslop` after initial verification[\s\S]*post-deslop verification/,
  );
  assert.match(skill, /Run independent goals in parallel only when they have no dependency and no overlapping file ownership/);
  assert.match(executor, /invoke \$csx-deslop after the initial verification/);
  assert.match(executor, /run the assigned post-deslop verification/);
});

test("csx-start-goal repeats cumulative review and never depends on csx-verifier", async () => {
  const [skill, verifier, installer] = await Promise.all([
    readFile(resolve(root, "payload/skills/csx-start-goal/SKILL.md"), "utf8"),
    readFile(resolve(root, "payload/agents/csx-verifier.toml"), "utf8"),
    readFile(resolve(root, "lib/install.js"), "utf8"),
  ]);

  assert.match(skill, /Begin final review only when every execution goal is `ready_for_review`/);
  assert.match(skill, /entire cumulative diff/);
  assert.match(skill, /`csx-code-reviewer: APPROVE`/);
  assert.match(skill, /`csx-architect: CLEAR`/);
  assert.match(skill, /final `Verdict: APPROVE`/);
  assert.match(skill, /`COMMENT`, `WATCH`, `REQUEST CHANGES`, `BLOCK`, a missing required lane/);
  assert.match(
    skill,
    /Move affected goals to `rework`[\s\S]*assign every rework fix to `csx-executor`[\s\S]*Re-run scoped deslop and post-deslop verification[\s\S]*re-run integrated verification and `\$csx-code-review`/,
  );
  assert.match(skill, /Any code change after a review invalidates every earlier approval/);
  assert.match(skill, /Keep the aggregate goal active/);
  assert.match(skill, /call `update_goal` with `complete` exactly once/);
  assert.doesNotMatch(skill, /csx-verifier/);
  assert.match(verifier, /name = "csx-verifier"/);
  assert.match(installer, /"csx-verifier"/);
});

test("csx-deslop locks behavior, limits scope, verifies cleanup, and escalates risk", async () => {
  const [skill, metadata] = await Promise.all([
    readFile(resolve(root, "payload/skills/csx-deslop/SKILL.md"), "utf8"),
    readFile(resolve(root, "payload/skills/csx-deslop/agents/openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /Lock existing behavior before cleanup by running the assigned verification unchanged/);
  assert.match(skill, /only the owned changed files and corresponding tests/);
  assert.match(skill, /speculative or masking fallbacks/);
  assert.match(skill, /duplicated logic/);
  assert.match(skill, /dead or unreachable code/);
  assert.match(skill, /unnecessary abstractions or indirection/);
  assert.match(skill, /violations of an existing module or ownership boundary/);
  assert.match(skill, /weak, swallowed, or misleading error handling/);
  assert.match(skill, /Apply one safe smell category at a time/);
  assert.match(skill, /Re-run the same behavior-lock verification after cleanup/);
  assert.match(skill, /passed\/no-op report/);
  assert.match(skill, /Return it to the leader as a blocker/);
  assert.match(metadata, /allow_implicit_invocation: false/);
});
