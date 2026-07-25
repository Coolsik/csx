import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ROLE_NAMES } from "../lib/presets.js";
import { runSetupCommand } from "../lib/setup-command.js";

const catalog = [{ model: "model", efforts: ["low", "high"] }];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "csx.js");

function matrix(reasoning = "low") {
  return Object.fromEntries(ROLE_NAMES.map((name) => [name, { model: "model", reasoning }]));
}

function harness(overrides = {}) {
  const calls = [];
  const layout = {
    scope: "project",
    root: "/project",
    agentsRoot: "/project/.codex/agents"
  };
  const baseline = matrix();
  const deps = {
    selectSetupScopeFn: (options) => {
      calls.push(["scope", options]);
      return layout;
    },
    codexModelContextFn: (selected, options) => {
      calls.push(["context", selected, options]);
      return { cwd: selected.root, env: options.env };
    },
    catalogLoader: async (context) => {
      calls.push(["catalog", context]);
      return catalog;
    },
    readSetupMatrixFn: async (selectedLayout) => {
      calls.push(["baseline", selectedLayout]);
      return baseline;
    },
    builtInPresetsFn: async () => {
      calls.push(["builtins"]);
      return { Efficient: matrix() };
    },
    readCustomPresetsFn: async (options) => {
      calls.push(["custom", options]);
      return { path: "/custom.json", hash: null, presets: { Team: matrix("high") } };
    },
    runSetupTuiFn: async (options) => {
      calls.push(["tui", options]);
      return { outcome: "cancel" };
    },
    applySetupFn: async (options) => {
      calls.push(["apply", options]);
      return { changed: true, scope: layout.scope };
    },
    resultOutputFn: (result, context) => calls.push(["output", result, context]),
    ...overrides
  };
  return { calls, deps, layout, baseline };
}

const options = {
  cwd: "/project",
  env: { HOME: "/home/test" },
  input: { name: "input" },
  output: { text: "", write(value) { this.text += value; } },
  errorOutput: { name: "stderr" }
};

test("orchestration preserves preflight, discovery, load, and TUI order", async () => {
  const { calls, deps } = harness();
  assert.deepEqual(await runSetupCommand(options, deps), { cancelled: true });
  assert.deepEqual(calls.map(([name]) => name), [
    "scope", "context", "catalog", "baseline", "builtins", "custom", "tui"
  ]);
  const tui = calls.at(-1)[1];
  assert.equal(tui.input, options.input);
  assert.equal(tui.output, options.output);
  assert.equal(tui.errorOutput, options.errorOutput);
  assert.deepEqual(tui.presets.map(({ name, kind }) => [name, kind]), [
    ["Efficient", undefined],
    ["Team", "custom"]
  ]);
  assert.deepEqual(tui.customPresetNames, ["Team"]);
});

test("a legacy custom preset colliding with a new built-in is labeled as custom", async () => {
  let names;
  const { deps } = harness({
    readCustomPresetsFn: async () => ({
      path: "/custom.json",
      hash: null,
      presets: { Efficient: matrix("high") }
    }),
    runSetupTuiFn: async (options) => {
      names = options.presets.map(({ name, kind }) => [name, kind]);
      return { outcome: "cancel" };
    }
  });

  await runSetupCommand(options, deps);

  assert.deepEqual(names, [
    ["Efficient", undefined],
    ["Efficient (custom)", "custom"]
  ]);
});

test("unmanaged scope failure happens before catalog, TUI, Apply, or write-equivalent work", async () => {
  const unmanaged = new Error("refusing to bypass unmanaged project Codex configuration");
  const { calls, deps } = harness({
    selectSetupScopeFn: () => {
      calls.push(["scope"]);
      throw unmanaged;
    }
  });
  await assert.rejects(runSetupCommand(options, deps), (error) => error === unmanaged);
  assert.deepEqual(calls.map(([name]) => name), ["scope"]);
});

test("cancel writes only its status and never calls Apply", async () => {
  const output = { text: "", write(value) { this.text += value; } };
  const { calls, deps } = harness();
  const result = await runSetupCommand({ ...options, output }, deps);
  assert.deepEqual(result, { cancelled: true });
  assert.equal(calls.some(([name]) => name === "apply"), false);
  assert.equal(calls.some(([name]) => name === "output"), false);
  assert.equal(output.text, "Setup cancelled.\n");
});

test("EOF AbortError and ordinary TUI errors propagate without Apply", async () => {
  for (const error of [
    Object.assign(new Error("ended"), { name: "AbortError" }),
    new Error("render \u001B]8;;https://example.invalid\u0007failed\u009B31m\u202E")
  ]) {
    const { calls, deps } = harness({
      runSetupTuiFn: async () => {
        calls.push(["tui"]);
        throw error;
      }
    });
    await assert.rejects(runSetupCommand(options, deps), (caught) => caught === error);
    assert.equal(calls.some(([name]) => name === "apply"), false);
  }
});

test("CLI stderr boundary visibly escapes hostile error text without changing usage or exit semantics", async () => {
  const hostile = "bad\\name\u001B]8;;https://example.invalid\u0007link\u001B]8;;\u0007\u009B31m\u007F\u202E";
  const result = await runCli(["unknown", hostile]);
  assert.equal(result.code, 1);
  const firstLine = result.stderr.split("\n", 1)[0];
  assert.equal(firstLine, 'csx: unknown command "unknown".');
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(firstLine, /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u);

  const hostileCommand = `unknown-${hostile}`;
  const direct = await runCli([hostileCommand]);
  assert.equal(direct.code, 1);
  assert.equal(
    direct.stderr.split("\n", 1)[0],
    'csx: unknown command "unknown-bad\\\\name\\x1B]8;;https://example.invalid\\x07link\\x1B]8;;\\x07\\x9B31m\\x7F\\u202E".'
  );
  assert.doesNotMatch(
    direct.stderr,
    /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u
  );
  assert.doesNotMatch(
    direct.stderr.split("\n", 1)[0],
    /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u
  );
});

test("Apply is called exactly once with isolated, validated transaction inputs", async () => {
  const final = matrix("high");
  const selectedAgents = [ROLE_NAMES[0], ROLE_NAMES[3]];
  let applyArgs;
  const { calls, deps, layout, baseline } = harness({
    runSetupTuiFn: async (tuiOptions) => {
      calls.push(["tui", tuiOptions]);
      tuiOptions.baselineMatrix[ROLE_NAMES[0]].reasoning = "high";
      tuiOptions.catalog[0].efforts.length = 0;
      tuiOptions.presets[0].matrix[ROLE_NAMES[0]].reasoning = "high";
      return {
        outcome: "apply",
        matrix: final,
        selectedAgents,
        customPresetName: "Team Two"
      };
    },
    applySetupFn: async (args) => {
      calls.push(["apply", args]);
      applyArgs = args;
      args.matrix[ROLE_NAMES[1]].reasoning = "low";
      args.baselineMatrix[ROLE_NAMES[1]].reasoning = "high";
      args.selectedAgents.push(ROLE_NAMES[7]);
      return { changed: true, scope: "project" };
    }
  });

  const result = await runSetupCommand(options, deps);
  assert.deepEqual(result, { changed: true, scope: "project" });
  assert.equal(calls.filter(([name]) => name === "apply").length, 1);
  assert.equal(applyArgs.layout, layout);
  assert.equal(applyArgs.cwd, options.cwd);
  assert.equal(applyArgs.env, options.env);
  assert.deepEqual(applyArgs.baselineMatrix[ROLE_NAMES[0]], baseline[ROLE_NAMES[0]]);
  assert.notEqual(applyArgs.baselineMatrix, baseline);
  assert.notEqual(applyArgs.matrix, final);
  assert.equal(final[ROLE_NAMES[1]].reasoning, "high");
  assert.deepEqual(selectedAgents, [ROLE_NAMES[0], ROLE_NAMES[3]]);
  assert.equal(applyArgs.customPresetName, "Team Two");
  assert.deepEqual(applyArgs.catalog, catalog);
  assert.notEqual(applyArgs.catalog, catalog);

  const refreshed = await applyArgs.catalogLoader();
  assert.deepEqual(refreshed, catalog);
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ["context", "catalog"]);
});

test("invalid final matrix is rejected before Apply", async () => {
  const invalid = matrix();
  invalid[ROLE_NAMES[0]] = { model: "missing", reasoning: "low" };
  const { calls, deps } = harness({
    runSetupTuiFn: async () => ({
      outcome: "apply",
      matrix: invalid,
      selectedAgents: [ROLE_NAMES[0]]
    })
  });
  await assert.rejects(runSetupCommand(options, deps), /unavailable model\/effort pair/);
  assert.equal(calls.some(([name]) => name === "apply"), false);
});

test("drift and delegated transaction failures are rethrown after one Apply attempt", async () => {
  for (const message of [
    "agent matrix changed after preview; rerun setup.",
    "custom preset file changed before confirmation; rerun setup."
  ]) {
    const delegated = new Error(message);
    let applyCount = 0;
    const { deps } = harness({
      runSetupTuiFn: async () => ({
        outcome: "apply",
        matrix: matrix(),
        selectedAgents: []
      }),
      applySetupFn: async () => {
        applyCount += 1;
        throw delegated;
      }
    });
    await assert.rejects(runSetupCommand(options, deps), (error) => error === delegated);
    assert.equal(applyCount, 1);
  }
});

test("custom preset load errors remain early errors and skip TUI and Apply", async () => {
  const schemaError = new Error("invalid custom preset file: /custom.json");
  const { calls, deps } = harness({
    readCustomPresetsFn: async () => {
      calls.push(["custom"]);
      throw schemaError;
    }
  });
  await assert.rejects(runSetupCommand(options, deps), (error) => error === schemaError);
  assert.deepEqual(calls.map(([name]) => name), [
    "scope", "context", "catalog", "baseline", "builtins", "custom"
  ]);
});

test("changed and no-change results retain existing output behavior", async () => {
  for (const [changed, expected] of [
    [true, "Updated project csx setup.\n"],
    [false, "Setup already matches the selected matrix.\n"]
  ]) {
    const output = { text: "", write(value) { this.text += value; } };
    const { deps } = harness({
      runSetupTuiFn: async () => ({
        outcome: "apply",
        matrix: matrix(),
        selectedAgents: []
      }),
      applySetupFn: async () => ({ changed, scope: "project" }),
      resultOutputFn: undefined
    });
    await runSetupCommand({ ...options, output }, deps);
    assert.equal(output.text, expected);
  }
});

test("default setup result output escapes a dynamic scope only at the stdout boundary", async () => {
  const hostileScope = "pro\\ject\u001B]0;owned\u0007\u009B31m\u202E";
  const output = { text: "", write(value) { this.text += value; } };
  const { deps } = harness({
    selectSetupScopeFn: () => ({
      scope: hostileScope,
      root: "/project",
      agentsRoot: "/project/.codex/agents"
    }),
    runSetupTuiFn: async () => ({
      outcome: "apply",
      matrix: matrix(),
      selectedAgents: []
    }),
    applySetupFn: async () => ({ changed: true, scope: hostileScope }),
    resultOutputFn: undefined
  });
  await runSetupCommand({ ...options, output }, deps);
  assert.equal(output.text, "Updated pro\\\\ject\\x1B]0;owned\\x07\\x9B31m\\u202E csx setup.\n");
  assert.doesNotMatch(
    output.text.slice(0, -1),
    /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u
  );
});

function runCli(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [cli, ...args], {
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
