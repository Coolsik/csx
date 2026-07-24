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
