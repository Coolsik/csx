import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const roles = [
  "csx-analyst", "csx-architect", "csx-code-reviewer", "csx-critic",
  "csx-executor", "csx-explorer", "csx-planner"
];

test("workflow skills require the bounded final diagnostics trailer", async () => {
  for (const skill of ["csx-plan-pro", "csx-start-goal"]) {
    const content = await readFile(resolve("payload", "skills", skill, "SKILL.md"), "utf8");
    assert.match(content, /every direct subagent assignment/i);
    assert.match(content, /<!-- csx-metrics:v1 \{"status":"completed"\} -->/);
    assert.match(content, /at most 6144 UTF-8 bytes/);
    assert.match(content, /Never put prompt or artifact text, agent\/thread\/run IDs, workflow tokens/);
  }
});

test("all receipt-owned agents preserve their body and require the trailer", async () => {
  for (const role of roles) {
    const content = await readFile(resolve("payload", "agents", `${role}.toml`), "utf8");
    assert.match(content, /Preserve the normal response body/);
    assert.match(content, /<!-- csx-metrics:v1 \{"status":"completed"\} -->/);
    assert.match(content, /Never include prompt or artifact text, agent\/thread\/run IDs, workflow tokens/);
  }
});
