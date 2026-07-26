import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = resolve(root, "payload", "hooks", "csx-hook.mjs");

test("hook has no prompt routing dispatcher", async () => {
  const result = await runHook("user-prompt-submit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "$csx-plan-pro migrate safely",
  });
  assert.deepEqual(result, { code: 0, stdout: "" });
});

test("SubagentStop is a successful empty lifecycle hook", async () => {
  assert.deepEqual(
    await runHook("subagent-stop", { hook_event_name: "SubagentStop" }),
    { code: 0, stdout: "" },
  );
  assert.deepEqual(await runRaw("subagent-stop", "{not json"), { code: 0, stdout: "" });
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
