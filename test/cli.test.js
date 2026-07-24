import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "csx.js");

test("install without scope fails with usage when stdin is not a TTY", async () => {
  const result = await run([cli, "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /scope is required/);
  assert.match(result.stderr, /Usage:/);
});

test("unknown and misspelled commands are rejected", async () => {
  const result = await run([cli, "unisntall"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown command/);
});

function run(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}
