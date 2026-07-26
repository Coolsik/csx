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
    const { code, stdout } = await runHook("user-prompt-submit", {
      hook_event_name: "UserPromptSubmit",
      prompt,
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /\$csx-(plan-pro|spec|deslop) skill/);
  }
});

test("SubagentStop is a successful empty lifecycle hook", async () => {
  assert.deepEqual(
    await runHook("subagent-stop", { hook_event_name: "SubagentStop" }),
    { code: 0, stdout: "" },
  );
  assert.deepEqual(await runRaw("subagent-stop", "{not json"), { code: 0, stdout: "" });
});

test("hook routes explicit loop requests and resume prompts", async () => {
  for (const prompt of [
    "$csx-loop implement the bounded request",
    "csx loop implement the bounded request",
    "$csx-loop resume bounded-request",
    "csx loop resume bounded-request",
  ]) {
    const { code, stdout } = await runHook("user-prompt-submit", {
      hook_event_name: "UserPromptSubmit",
      prompt,
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /Use the \$csx-loop skill/);
  }
});

test("hook ignores ordinary, unknown, and invalid prompts", async () => {
  for (const prompt of [
    "please plan this",
    "please loop this",
    "csx unknown",
    "$csx-looping request",
    "csx loopy request",
    "$csx-loop",
    "csx loop resume",
    "$csx-loop resume bounded-request extra",
  ]) {
    assert.deepEqual(
      await runHook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt }),
      { code: 0, stdout: "" },
    );
  }
  assert.deepEqual(await runRaw("user-prompt-submit", "{not json"), { code: 0, stdout: "" });
});

test("unsupported lifecycle argv and malformed input fail open", async () => {
  assert.deepEqual(await runRaw("session-start", "{not json"), { code: 0, stdout: "" });
  assert.deepEqual(await runRaw("unknown", "{}"), { code: 0, stdout: "" });
});

function runHook(operation, payload) {
  return runRaw(operation, JSON.stringify(payload));
}

function runRaw(operation, input) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [hook, operation], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout }));
    child.stdin.end(input);
  });
}
