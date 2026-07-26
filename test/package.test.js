import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HISTORICAL_INSTALLATION_FAMILIES } from "../lib/historical-installations.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("npm dry-run package contains the complete runtime and no local residue", async () => {
  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 }
  );
  const report = JSON.parse(stdout);
  assert.equal(Array.isArray(report), true);
  assert.equal(report.length, 1);
  const packed = new Set(report[0].files.map(({ path }) => normalize(path)));

  const required = new Set([
    "bin/csx.js",
    "payload/hooks/csx-hook.mjs",
    "README.md",
    "LICENSE",
    ...await sourceFiles("lib"),
    ...await sourceFiles("payload/agents"),
    ...await sourceFiles("payload/skills")
  ]);
  for (const path of required) {
    assert.equal(packed.has(path), true, `missing packaged runtime file: ${path}`);
  }
  for (const path of [
    "lib/historical-installations.js",
    "lib/local-diagnostics.js",
    "lib/project-context.js",
    "lib/workflow-state.js"
  ]) {
    assert.equal(packed.has(path), true, `missing new runtime module: ${path}`);
  }

  for (const path of packed) {
    assert.equal(
      path.startsWith(".csx/") ||
        path.startsWith("test/") ||
        path.includes("/fixtures/") ||
        path.includes(".csx-transactions") ||
        /(?:^|\/)(?:workflow-state-v1\.json|diagnostics-v1)(?:\/|$)/.test(path) ||
        path.endsWith(".tgz"),
      false,
      `unexpected local or runtime residue in package: ${path}`
    );
  }
});

test("the packaged historical registry is code-owned and exactly seven families", () => {
  assert.deepEqual(HISTORICAL_INSTALLATION_FAMILIES.map(({ id }) => id), [
    "h21-3abc221",
    "h21-8933704",
    "h21-64de366-fresh",
    "h21-64de366-setup",
    "h23-a221623-fresh",
    "h23-a221623-setup",
    "h22-9af4616"
  ]);
});

async function sourceFiles(directory) {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(relative(root, path)));
    } else if (entry.isFile()) {
      files.push(normalize(relative(root, path)));
    }
  }
  return files;
}

function normalize(path) {
  return path.split(sep).join("/");
}
