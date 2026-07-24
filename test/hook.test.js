import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = resolve(root, "payload", "hooks", "csx-hook.mjs");

test("hook routes direct and shorthand csx skill prompts", async () => {
  for (const prompt of [
    "$csx-plan-pro migrate safely",
    "csx spec define this",
    "$csx-deslop clean the bounded diff",
    "csx deslop clean the bounded diff",
  ]) {
    const output = await runHook({ hook_event_name: "UserPromptSubmit", prompt });
    const parsed = JSON.parse(output);
    assert.match(parsed.hookSpecificOutput.additionalContext, /\$csx-(plan-pro|spec|deslop) skill/);
  }
});

test("hook ignores ordinary, unknown, and invalid prompts", async () => {
  assert.equal(await runHook({ hook_event_name: "UserPromptSubmit", prompt: "please plan this" }), "");
  assert.equal(await runHook({ hook_event_name: "UserPromptSubmit", prompt: "csx unknown" }), "");
  assert.equal(await runRaw("{not json"), "");
});

function runHook(payload) {
  return runRaw(JSON.stringify(payload));
}

function runRaw(input) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [hook, "user-prompt-submit"], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => {
      assert.equal(code, 0);
      resolveResult(stdout);
    });
    child.stdin.end(input);
  });
}
