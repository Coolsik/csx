import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import pty from "node-pty";
import test from "node:test";
import { install } from "../lib/install.js";
import { presetMatrix } from "../lib/presets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "csx.js");

test("install without scope fails with usage when stdin is not a TTY", async () => {
  const result = await run([cli, "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /scope is required/);
  assert.match(result.stderr, /Usage:/);
});
test("install rejects an invalid scope without attempting installation", async () => {
  const result = await run([cli, "install", "--scope", "workspace"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid scope "workspace"; expected global or project/);
  assert.match(result.stderr, /Usage:/);
});
test("setup is routed and refuses non-interactive terminals", async () => {
  const result = await run([cli, "setup"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /setup requires an interactive terminal/);
  assert.match(result.stderr, /Usage:/);
});

test("setup rejects argv instead of treating it as interactive input", async () => {
  const result = await run([cli, "setup", "--preset", "Low"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /setup does not accept arguments/);
});

test("unknown and misspelled commands are rejected", async () => {
  const result = await run([cli, "unisntall"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown command/);
});
test("setup completes through a real PTY", async () => {
  const fixture = await setupFixture();
  try {
    const result = await runPty(fixture, [
      ["Enter 1-5: ", "1"],
      ["Select a row or d: ", "d"],
      ...["csx-explorer", "csx-analyst", "csx-planner", "csx-architect", "csx-critic", "csx-executor", "csx-verifier", "csx-code-reviewer"].map((agent) => [`Apply change for ${agent}? [y/N] `, "y"]),
      ["Save this full matrix as a global custom preset? [y/N] ", "n"],
      ["Apply these changes? [y/N] ", "y"]
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Updated global csx setup/);
    assert.match(result.output, new RegExp(`Setup preview for global scope at ${fixture.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test("every starting preset can save its final effective matrix through a PTY", async () => {
  const cases = [
    ["Low", "1", true],
    ["Medium", "2", true],
    ["High", "3", false],
    ["Saved custom presets", "4", true],
    ["Edit current matrix", "5", false]
  ];
  for (const [label, selection, changesAllRows] of cases) {
    const fixture = await setupFixture();
    try {
      if (label === "Saved custom presets") {
        await writeFile(join(fixture.home, "csx-model-presets.json"), `${JSON.stringify({ version: 1, presets: { Team: presetMatrix("Low") } })}\n`);
      }
      const changedAgents = changesAllRows
        ? ["csx-explorer", "csx-analyst", "csx-planner", "csx-architect", "csx-critic", "csx-executor", "csx-verifier", "csx-code-reviewer"]
        : ["csx-explorer"];
      const responses = [
        ["Enter 1-5: ", selection],
        ...(label === "Saved custom presets" ? [["Enter 1-1: ", "1"]] : []),
        ...(changesAllRows ? [["Select a row or d: ", "d"]] : [["Select a row or d: ", "1"], ["Enter 1-3: ", "3"], ["Enter 1-4: ", "1"], ["Select a row or d: ", "d"]]),
        ...changedAgents.map((agent) => [`Apply change for ${agent}? [y/N] `, "y"]),
        ["Save this full matrix as a global custom preset? [y/N] ", "y"],
        ["Custom preset name: ", `${selection}-final`],
        ["Apply these changes? [y/N] ", "y"]
      ];
      const result = await runPty(fixture, responses);
      assert.equal(result.code, 0, `${label}: ${result.output}`);
      assert.match(result.output, /Save this full matrix as a global custom preset/);
      assert.ok(JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(join(fixture.home, "csx-model-presets.json"), "utf8"))).presets[`${selection}-final`]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});
test("project setup through a PTY leaves the unrelated global Codex home untouched", async () => {
  const fixture = await setupFixture({ scope: "project" });
  try {
    const result = await runPty(fixture, [
      ["Enter 1-5: ", "1"],
      ["Select a row or d: ", "d"],
      ...["csx-explorer", "csx-analyst", "csx-planner", "csx-architect", "csx-critic", "csx-executor", "csx-verifier", "csx-code-reviewer"].map((agent) => [`Apply change for ${agent}? [y/N] `, "n"]),
      ["Apply these changes? [y/N] ", "y"]
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Updated project csx setup/);
    assert.match(result.output, new RegExp(`Setup preview for project scope at ${fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`));
    await assert.rejects(import("node:fs/promises").then(({ access }) => access(fixture.home)));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("setup cancellation through a real PTY makes no changes", async () => {
  const fixture = await setupFixture();
  try {
    const result = await runPty(fixture, [
      ["Enter 1-5: ", "1"],
      ["Select a row or d: ", "d"],
      ...["csx-explorer", "csx-analyst", "csx-planner", "csx-architect", "csx-critic", "csx-executor", "csx-verifier", "csx-code-reviewer"].map((agent, index) => [`Apply change for ${agent}? [y/N] `, index === 0 ? "y" : "n"]),
      ["Save this full matrix as a global custom preset? [y/N] ", "n"],
      ["Apply these changes? [y/N] ", "n"]
    ]);
    assert.equal(result.code, 0);
    assert.match(result.output, /Setup cancelled/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("setup reports EOF from a real PTY", async () => {
  const fixture = await setupFixture();
  try {
    const result = await runPty(fixture);
    assert.equal(result.code, 1);
    assert.match(result.output, /Aborted with Ctrl\+D/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
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
async function setupFixture({ scope = "global" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "csx-pty-"));
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  if (scope === "global") await mkdir(home, { recursive: true });
  await install({
    scope,
    projectRoot: scope === "project" ? directory : undefined,
    env: { HOME: directory, CODEX_HOME: home }
  });
  const server = join(bin, "codex.mjs");
  await mkdir(bin);
  await writeFile(server, `import readline from "node:readline";\nconst efforts = ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort }));\nreadline.createInterface({ input: process.stdin }).on("line", (line) => { const request = JSON.parse(line); if (request.id && request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n"); if (request.id && request.method === "model/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { data: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"].map((model) => ({ model, hidden: false, supportedReasoningEfforts: efforts })), nextCursor: null } }) + "\\n"); });\n`);
  const command = process.platform === "win32" ? join(bin, "codex.cmd") : join(bin, "codex");
  await writeFile(command, process.platform === "win32" ? `@node "${server}"\r\n` : `#!/bin/sh\nexec node "${server}"\n`, { mode: 0o755 });
  return { root: directory, home, bin };
}

function runPty(fixture, answers) {
  return new Promise((resolveResult) => {
    const child = pty.spawn(process.execPath, [cli, "setup"], {
      cwd: fixture.root,
      env: { ...process.env, CODEX_HOME: fixture.home, PATH: `${fixture.bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` }
    });
    const responses = answers ? [...answers] : null;
    let output = "";
    const timer = setTimeout(() => child.kill(), 5_000);
    child.onData((data) => {
      output += data;
      if (responses?.length && output.includes(responses[0][0])) {
        child.write(`${responses.shift()[1]}\r`);
      }
      if (!responses && output.includes("Enter 1-5: ")) child.write("\u0004");
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolveResult({ code: exitCode, output });
    });
  });
}
