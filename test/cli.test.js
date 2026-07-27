import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { promisify } from "node:util";
import test from "node:test";
import { install } from "../lib/install.js";
import { AGENT_NAMES, ROLE_NAMES, WORKFLOW_LEADER_NAMES, presetMatrix } from "../lib/presets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "csx.js");
const harness = resolve(root, "test", "fixtures", "setup-tui-harness.js");
const exec = promisify(execFile);
const ENTER = "\r";
const DOWN = "\u001b[B";
const ESC = "\u001b";

test("install and setup command boundaries reject invalid non-interactive use", async () => {
  const installResult = await run([cli, "install"]);
  assert.equal(installResult.code, 1);
  assert.match(installResult.stderr, /scope is required/);
  assert.match(installResult.stderr, /Usage:/);

  const invalidScope = await run([cli, "install", "--scope", "workspace"]);
  assert.equal(invalidScope.code, 1);
  assert.match(invalidScope.stderr, /invalid scope/);

  const setup = await run([cli, "setup"]);
  assert.equal(setup.code, 1);
  assert.match(setup.stderr, /setup requires an interactive terminal/);

  const setupArgs = await run([cli, "setup", "--preset", "Low"]);
  assert.equal(setupArgs.code, 1);
  assert.match(setupArgs.stderr, /setup does not accept arguments/);
});

test("workflow CLI uses one bounded JSON stdin/stdout protocol and fails open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csx-workflow-cli-"));
  const artifact = ".csx/plans/cli-pro.md";
  try {
    await mkdir(join(directory, ".csx", "plans"), { recursive: true });
    await writeFile(join(directory, artifact), "draft");
    const begin = await run([cli, "workflow", "begin"], {
      input: JSON.stringify({
        version: 1,
        projectRoot: directory,
        workflow: "csx-plan-pro",
        phase: "drafting",
        artifact
      })
    });
    assert.equal(begin.code, 0);
    assert.equal(begin.stderr, "");
    const beginResult = JSON.parse(begin.stdout);
    assert.equal(begin.stdout, `${JSON.stringify(beginResult)}\n`);
    assert.deepEqual(Object.keys(beginResult), [
      "schema", "version", "ok", "operation", "code", "token", "state"
    ]);
    assert.equal(beginResult.schema, "csx.workflow-result");
    assert.equal(beginResult.ok, true);
    assert.equal(beginResult.operation, "begin");
    assert.equal("instanceToken" in beginResult.state, false);

    const stale = await run([cli, "workflow", "checkpoint"], {
      input: JSON.stringify({
        version: 1,
        projectRoot: directory,
        token: "A".repeat(43),
        phase: "review",
        artifact
      })
    });
    assert.equal(stale.code, 0);
    assert.equal(stale.stderr, "");
    assert.equal(stale.stdout, "{\"schema\":\"csx.workflow-result\",\"version\":1,\"ok\":false,\"operation\":\"checkpoint\",\"code\":\"token_mismatch\"}\n");

    const malformed = await run([cli, "workflow", "finish"], { input: "{" });
    assert.equal(malformed.code, 0);
    assert.equal(malformed.stderr, "");
    assert.equal(malformed.stdout, "{\"schema\":\"csx.workflow-result\",\"version\":1,\"ok\":false,\"operation\":\"finish\",\"code\":\"request_malformed\"}\n");

    const oversize = await run([cli, "workflow", "begin"], {
      input: JSON.stringify({ padding: "x".repeat(65_536) })
    });
    assert.equal(oversize.code, 0);
    assert.equal(oversize.stderr, "");
    assert.equal(oversize.stdout, "{\"schema\":\"csx.workflow-result\",\"version\":1,\"ok\":false,\"operation\":\"begin\",\"code\":\"request_too_large\"}\n");

    const invalid = await run([cli, "workflow", "unknown"], { input: "{}" });
    assert.equal(invalid.code, 0);
    assert.equal(invalid.stderr, "");
    assert.equal(invalid.stdout, "{\"schema\":\"csx.workflow-result\",\"version\":1,\"ok\":false,\"operation\":\"unknown\",\"code\":\"invalid_operation\"}\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflow CLI reports unsafe Git authority as a machine failure without state controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csx-workflow-cli-unsafe-"));
  const artifact = ".csx/goals/unsafe.md";
  try {
    await exec("git", ["init", "-q", directory]);
    await mkdir(join(directory, ".csx", "goals"), { recursive: true });
    await writeFile(join(directory, artifact), "R000");
    await mkdir(join(directory, ".codex"), { recursive: true });
    await writeFile(
      join(directory, ".codex", "config.toml"),
      "# >>> csx managed >>>\n"
    );

    const result = await run([cli, "workflow", "begin"], {
      cwd: directory,
      input: JSON.stringify({
        version: 1,
        workflow: "csx-start-goal",
        phase: "entry",
        artifact
      })
    });
    assert.deepEqual(result, {
      code: 0,
      stdout: "{\"schema\":\"csx.workflow-result\",\"version\":1,\"ok\":false,\"operation\":\"begin\",\"code\":\"state_unavailable\"}\n",
      stderr: ""
    });
    await assert.rejects(
      readFile(join(directory, ".csx", ".workflow-state-v1.lock")),
      { code: "ENOENT" }
    );
    await assert.rejects(
      readFile(join(directory, ".csx", ".workflow-state-v1.tmp")),
      { code: "ENOENT" }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics CLI supports only bounded human and one-line JSON output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csx-diagnostics-cli-"));
  const hook = join(directory, ".codex", "hooks", "csx-hook.mjs");
  const receipt = join(directory, ".codex", ".csx-install-receipt.json");
  try {
    await mkdir(dirname(hook), { recursive: true });
    await cp(resolve(root, "payload", "hooks", "csx-hook.mjs"), hook);
    await writeFile(receipt, `${JSON.stringify({
      version: "test",
      scope: "project",
      root: directory,
      configRoot: join(directory, ".codex"),
      files: [hook]
    })}\n`);

    const empty = await run([cli, "diagnostics"], { cwd: directory });
    assert.deepEqual(empty, {
      code: 0,
      stdout: "No csx diagnostics found.\n",
      stderr: ""
    });

    await mkdir(join(directory, ".csx", "diagnostics-v1"), { recursive: true });
    const event = {
      schema: "csx.diagnostic-event",
      version: 1,
      timestamp: new Date().toISOString(),
      workflow: "csx-start-goal",
      phase: "verification",
      role: "csx-executor",
      status: "completed"
    };
    await writeFile(
      join(directory, ".csx", "diagnostics-v1", "event-0000.json"),
      `${JSON.stringify(event)}\n`
    );
    const json = await run([cli, "diagnostics", "--json"], { cwd: directory });
    assert.equal(json.code, 0);
    assert.equal(json.stderr, "");
    assert.equal(json.stdout, `${JSON.stringify({
      schema: "csx.diagnostics",
      version: 1,
      scope: "project",
      events: [event]
    })}\n`);

    for (const args of [["--other"], ["--json", "--json"], ["positional"]]) {
      const invalid = await run([cli, "diagnostics", ...args], { cwd: directory });
      assert.equal(invalid.code, 1);
      assert.match(invalid.stderr, /diagnostics accepts only --json/);
      assert.match(invalid.stderr, /Usage:/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model-first PTY assigns one role and calls Apply exactly once", async () => {
  const fixture = await setupFixture();
  try {
    const before = await readRoleMatrix(fixture);
    const result = await runPty(fixture, harness, [
      ENTER,
      ENTER,
      ENTER,
      ...repeat(DOWN, 5),
      ENTER,
      ENTER
    ], { tracked: trackedFiles(fixture) });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.harness.ok, true);
    assert.equal(result.harness.applyCount, 1);
    assert.equal(result.harness.result.changed, true);
    assert.deepEqual(result.harness.changes, { agents: 2, config: 0, receipt: 1, custom: 0 });
    const after = await readRoleMatrix(fixture);
    assert.deepEqual(after.leader, { model: "gpt-5.6-sol", reasoning: "low" });
    for (const agent of AGENT_NAMES) assert.deepEqual(after[agent], before[agent]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("All roles plus a unique custom preset save commit atomically on final Apply", async () => {
  const fixture = await setupFixture();
  try {
    const result = await runPty(fixture, harness, [
      ENTER,
      ...repeat(DOWN, ROLE_NAMES.length),
      ENTER,
      ENTER,
      ...repeat(DOWN, 4),
      ENTER,
      "Team-sol-low",
      ENTER,
      DOWN,
      ENTER,
      ENTER
    ], { tracked: trackedFiles(fixture) });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.harness.ok, true);
    assert.equal(result.harness.applyCount, 1);
    assert.deepEqual(result.harness.changes, { agents: 9, config: 0, receipt: 1, custom: 1 });
    assert.deepEqual(await readRoleMatrix(fixture), matrix("gpt-5.6-sol", "low"));
    const custom = JSON.parse(await readFile(fixture.customPath, "utf8"));
    assert.deepEqual(custom.presets["Team-sol-low"], matrix("gpt-5.6-sol", "low"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("duplicate built-in/custom matrices render a disabled save row and write nothing", async () => {
  const low = presetMatrix("Low");
  const fixture = await setupFixture({ fixtureOnly: true, baselineMatrix: low });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 2,
      presets: { Team: low }
    })}\n`);
    const result = await runPty(fixture, harness, [
      ...repeat(DOWN, 4),
      { key: ENTER, capture: "duplicate" },
      ESC
    ], { tracked: trackedFiles(fixture) });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.harness.applyCount, 0);
    assert.equal(result.harness.hashesUnchanged, true);
    const frame = capturedFrame(result, "duplicate");
    assert.match(frame, /Already saved as Efficient, Team \[disabled\]/);
    assert.match(frame, /already saved as Efficient, Team/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Load preset previews role mappings and applies the selected full matrix", async () => {
  const fixture = await setupFixture();
  try {
    const result = await runPty(fixture, cli, [
      ...repeat(DOWN, 3),
      { key: ENTER, capture: "preset-preview" },
      ENTER,
      ...repeat(DOWN, 2),
      ENTER,
      ENTER
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(capturedFrame(result, "preset-preview"), /Load preset/);
    assert.match(capturedFrame(result, "preset-preview"), /\[EXPLORE\]/);
    assert.match(result.output, /Updated global csx setup/);
    assert.deepEqual(await readRoleMatrix(fixture), presetMatrix("Efficient"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("top-level Esc cancels without Apply or file changes", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const result = await runPty(fixture, harness, [ESC], { tracked: trackedFiles(fixture) });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, config: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("10×3 PTY pages a tagged model row and keeps actions reachable", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const result = await runPty(fixture, harness, [
      { key: DOWN, capture: "model-page-2" },
      { key: DOWN, capture: "model-page-3" },
      ...repeat(DOWN, 20),
      ESC
    ], {
      columns: 10,
      rows: 3,
      tracked: trackedFiles(fixture)
    });
    assert.equal(result.code, 0, result.output);
    assert.notEqual(capturedFrame(result, "model-page-2"), "");
    assert.notEqual(capturedFrame(result, "model-page-3"), "");
    assert.equal(result.harness.applyCount, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unavailable baseline assignments can be repaired through All roles before Apply", async () => {
  const unavailable = matrix("removed-model", "max");
  const fixture = await setupFixture({
    baselineMatrix: unavailable
  });
  try {
    const result = await runPty(fixture, cli, [
      ENTER,
      ...repeat(DOWN, ROLE_NAMES.length),
      ENTER,
      ENTER,
      ...repeat(DOWN, 5),
      ENTER,
      ENTER
    ]);
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(await readRoleMatrix(fixture), matrix("gpt-5.6-sol", "low"));
    assert.match(result.output, /Updated global csx setup/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("project setup leaves the unrelated global custom preset location untouched", async () => {
  const fixture = await setupFixture({ scope: "project" });
  try {
    const result = await runPty(fixture, cli, [
      ENTER,
      ENTER,
      ENTER,
      ...repeat(DOWN, 5),
      ENTER,
      ENTER
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Updated project csx setup/);
    await assert.rejects(readFile(fixture.customPath), { code: "ENOENT" });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("raw Ctrl+D from a real PTY aborts after terminal cleanup", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const result = await runPty(fixture, cli, ["\u0004"]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Aborted with Ctrl\+D/);
    assert.match(result.output, /\u001b\[\?25h\u001b\[\?1049l/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function matrix(model, reasoning) {
  return Object.fromEntries(ROLE_NAMES.map((agent) => [agent, { model, reasoning }]));
}

function repeat(value, count) {
  return Array.from({ length: count }, () => value);
}

function run(args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd ?? root,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

async function setupFixture({
  scope = "global",
  fixtureOnly = false,
  baselineMatrix,
  catalog = [
    { model: "gpt-5.6-sol", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { model: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { model: "gpt-5.6-terra", efforts: ["low", "medium", "high", "xhigh", "max"] }
  ]
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "csx-pty-"));
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  if (scope === "global") await mkdir(home, { recursive: true });
  const agentsRoot = scope === "project" ? join(directory, ".codex", "agents") : join(home, "agents");
  const receiptPath = scope === "project"
    ? join(directory, ".codex", ".csx-install-receipt.json")
    : join(home, ".csx-install-receipt.json");
  await install({
    scope,
    projectRoot: scope === "project" ? directory : undefined,
    env: { HOME: directory, CODEX_HOME: home }
  });
  const configPath = scope === "project" ? join(directory, ".codex", "config.toml") : join(home, "config.toml");
  if (baselineMatrix) {
    await Promise.all(AGENT_NAMES.map(async (name) => {
      const path = join(agentsRoot, `${name}.toml`);
      const text = await readFile(path, "utf8");
      const pair = baselineMatrix[name];
      const withModel = replaceFixtureAssignment(text, "model", pair.model);
      await writeFile(path, replaceFixtureAssignment(withModel, "model_reasoning_effort", pair.reasoning));
    }));
    await Promise.all(WORKFLOW_LEADER_NAMES.map(async (name) => {
      const path = join(agentsRoot, `${name}.toml`);
      const text = await readFile(path, "utf8");
      const withModel = replaceFixtureAssignment(text, "model", baselineMatrix.leader.model);
      await writeFile(path, replaceFixtureAssignment(withModel, "model_reasoning_effort", baselineMatrix.leader.reasoning));
    }));
  }
  const installedMatrix = await readRoleMatrix({ agentsRoot, configPath });
  await mkdir(bin);
  const server = join(bin, "codex.mjs");
  await writeFile(server, `import readline from "node:readline";\nconst catalog = ${JSON.stringify(catalog)};\nreadline.createInterface({ input: process.stdin }).on("line", (line) => { const request = JSON.parse(line); if (request.id && request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n"); if (request.id && request.method === "model/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { data: catalog.map(({ model, efforts }) => ({ model, hidden: false, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })) })), nextCursor: null } }) + "\\n"); });\n`);
  const command = process.platform === "win32" ? join(bin, "codex.cmd") : join(bin, "codex");
  await writeFile(command, process.platform === "win32"
    ? `@node "${server}"\r\n`
    : `#!/bin/sh\nexec node "${server}"\n`, { mode: 0o755 });
  return {
    root: directory,
    home,
    bin,
    agentsRoot,
    configPath,
    receiptPath,
    customPath: join(home, "csx-model-presets.json"),
    installedMatrix
  };
}

function replaceFixtureAssignment(text, key, value) {
  let replacements = 0;
  const pattern = new RegExp(`(^|\\n)${key}\\s*=\\s*"[^"]+"`, "g");
  const updated = text.replace(pattern, (_assignment, prefix) => {
    replacements += 1;
    return `${prefix}${key} = ${JSON.stringify(value)}`;
  });
  assert.equal(replacements, 1, `fixture must contain exactly one ${key} assignment`);
  return updated;
}

async function readAgentMatrix(agentsRoot) {
  return Object.fromEntries(await Promise.all(AGENT_NAMES.map(async (name) => {
    const text = await readFile(join(agentsRoot, `${name}.toml`), "utf8");
    return [name, {
      model: /(?:^|\n)model\s*=\s*"([^"]+)"/.exec(text)[1],
      reasoning: /(?:^|\n)model_reasoning_effort\s*=\s*"([^"]+)"/.exec(text)[1]
    }];
  })));
}

async function readRoleMatrix(fixture) {
  const leaders = await Promise.all(WORKFLOW_LEADER_NAMES.map(async (name) => {
    const text = await readFile(join(fixture.agentsRoot, `${name}.toml`), "utf8");
    return {
      model: /(?:^|\n)model\s*=\s*"([^"]+)"/.exec(text)[1],
      reasoning: /(?:^|\n)model_reasoning_effort\s*=\s*"([^"]+)"/.exec(text)[1]
    };
  }));
  assert.deepEqual(leaders[1], leaders[0]);
  return {
    leader: leaders[0],
    ...await readAgentMatrix(fixture.agentsRoot)
  };
}

function trackedFiles(fixture) {
  return {
    agents: [...AGENT_NAMES, ...WORKFLOW_LEADER_NAMES].map((name) =>
      join(fixture.agentsRoot, `${name}.toml`)),
    config: [fixture.configPath],
    receipt: [fixture.receiptPath],
    custom: [fixture.customPath]
  };
}

function currentAlternateFrame(output) {
  const alternateStart = output.lastIndexOf("\u001b[?1049h");
  if (alternateStart < 0) return "";
  const alternate = output.slice(alternateStart);
  const synchronizedEnd = alternate.lastIndexOf("\u001b[?2026l");
  if (synchronizedEnd < 0) return "";
  const synchronizedStart = alternate.lastIndexOf("\u001b[?2026h", synchronizedEnd);
  if (synchronizedStart < 0) return "";
  let frame = alternate.slice(synchronizedStart + "\u001b[?2026h".length, synchronizedEnd);
  const cursorHome = frame.lastIndexOf("\u001b[G");
  if (cursorHome >= 0) frame = frame.slice(cursorHome + "\u001b[G".length);
  return frame
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function capturedFrame(result, name) {
  const entry = result.snapshots.find(({ capture }) => capture === name);
  assert.ok(entry, `missing PTY capture: ${name}`);
  return entry.frame;
}

function runPty(fixture, program, actions, options = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = pty.spawn(process.execPath, program === cli ? [cli, "setup"] : [program], {
      cwd: fixture.root,
      cols: options.columns ?? 100,
      rows: options.rows ?? 30,
      env: {
        ...process.env,
        HOME: fixture.root,
        CODEX_HOME: fixture.home,
        PATH: `${fixture.bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        ...(program === harness ? { CSX_SETUP_TUI_HARNESS: "1" } : {}),
        ...(options.tracked ? { CSX_HARNESS_TRACKED: JSON.stringify(options.tracked) } : {})
      }
    });
    let output = "";
    let started = false;
    let exited = false;
    let drivePromise;
    let revision = 0;
    const snapshots = [];
    const timer = setTimeout(() => {
      rejectResult(new Error(`PTY timed out before exit:\n${output}`));
      child.kill();
    }, options.timeout ?? 15_000);
    child.onData((data) => {
      output += data;
      revision += 1;
      if (!started && currentAlternateFrame(output) !== "") {
        started = true;
        drivePromise = drive();
        void drivePromise.catch(() => child.kill());
      }
    });
    child.onExit(({ exitCode }) => {
      exited = true;
      clearTimeout(timer);
      void Promise.resolve(drivePromise).then(() => {
        const match = /HARNESS_RESULT ([^\r\n]+)/.exec(output);
        resolveResult({
          code: exitCode,
          output,
          snapshots,
          harness: match ? JSON.parse(match[1]) : undefined
        });
      }, rejectResult);
    });

    async function drive() {
      for (const [index, action] of actions.entries()) {
        const previousRevision = revision;
        const previousFrame = currentAlternateFrame(output);
        const key = typeof action === "string" ? action : action.key;
        child.write(key);
        await waitForChange(previousRevision, previousFrame, index === actions.length - 1);
        snapshots.push({
          capture: typeof action === "string" ? undefined : action.capture,
          frame: currentAlternateFrame(output)
        });
      }
    }

    async function waitForChange(previousRevision, previousFrame, finalAction) {
      const deadline = Date.now() + 2_000;
      while (!exited) {
        if (revision !== previousRevision && currentAlternateFrame(output) !== previousFrame) return;
        if (Date.now() >= deadline) throw new Error(`PTY action produced no rendered output:\n${output}`);
        await delay(5);
      }
      if (!finalAction) throw new Error(`PTY exited before action rendered:\n${output}`);
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
