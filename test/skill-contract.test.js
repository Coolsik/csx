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
