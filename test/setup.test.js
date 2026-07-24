import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverCodexModels } from "../lib/codex-models.js";
import { AGENT_NAMES, cloneMatrix, presetMatrix } from "../lib/presets.js";
import { applySetup, builtInPresets, codexModelContext, CUSTOM_PRESETS_FILE, readAgentMatrix, readCustomPresets, requestUniqueCustomPresetName, selectSetupScope, setupLayout } from "../lib/setup.js";
import { install } from "../lib/install.js";
import { RECEIPT_NAME } from "../lib/installation-state.js";
import { acquireRootLock, TransactionLockError } from "../lib/transaction-lock.js";

const catalog = [
  { model: "gpt-5.6-luna", efforts: ["low", "high"] },
  { model: "gpt-5.6-terra", efforts: ["low", "high", "xhigh"] },
  { model: "gpt-5.6-sol", efforts: ["low", "high", "xhigh"] }
];
const declaredTransaction = (onDeclare, transaction) => async ({ createDeclaration }) => {
  onDeclare?.(await createDeclaration());
  return transaction;
};

test("setup selects a receipt-owned project, rejects unmanaged project configuration, and propagates probe failures", () => {
  const cwd = "/work/project";
  const env = { HOME: "/home/test" };
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  assert.equal(selectSetupScope({ cwd, env, statSync: () => { throw missing; } }).scope, "global");
  assert.equal(selectSetupScope({ cwd, env, statSync: (path) => path.endsWith(RECEIPT_NAME) ? {} : (() => { throw missing; })() }).scope, "project");
  assert.throws(() => selectSetupScope({ cwd, env, statSync: (path) => path.endsWith(RECEIPT_NAME) ? (() => { throw missing; })() : {} }), /unmanaged project Codex configuration/);
  assert.throws(() => selectSetupScope({ cwd, env, statSync: () => { throw new Error("access denied"); } }), /access denied/);
  assert.equal(CUSTOM_PRESETS_FILE, "csx-model-presets.json");
});

test("Low, Medium, and payload-derived High define every agent", async () => {
  const expected = {
    Low: {
      "csx-analyst": { model: "gpt-5.6-luna", reasoning: "high" },
      "csx-architect": { model: "gpt-5.6-terra", reasoning: "high" },
      "csx-code-reviewer": { model: "gpt-5.6-terra", reasoning: "xhigh" },
      "csx-critic": { model: "gpt-5.6-terra", reasoning: "xhigh" },
      "csx-executor": { model: "gpt-5.6-luna", reasoning: "low" },
      "csx-explorer": { model: "gpt-5.6-terra", reasoning: "low" },
      "csx-planner": { model: "gpt-5.6-luna", reasoning: "high" },
      "csx-verifier": { model: "gpt-5.6-terra", reasoning: "xhigh" }
    },
    Medium: {
      "csx-analyst": { model: "gpt-5.6-terra", reasoning: "high" },
      "csx-architect": { model: "gpt-5.6-sol", reasoning: "high" },
      "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "xhigh" },
      "csx-critic": { model: "gpt-5.6-sol", reasoning: "xhigh" },
      "csx-executor": { model: "gpt-5.6-terra", reasoning: "low" },
      "csx-explorer": { model: "gpt-5.6-sol", reasoning: "low" },
      "csx-planner": { model: "gpt-5.6-terra", reasoning: "high" },
      "csx-verifier": { model: "gpt-5.6-sol", reasoning: "xhigh" }
    }
  };
  for (const [name, matrix] of Object.entries(expected)) assert.deepEqual(presetMatrix(name), matrix);
  const builtIns = await builtInPresets();
  assert.deepEqual(Object.keys(builtIns.High), AGENT_NAMES);
  assert.equal(builtIns.High["csx-explorer"].model, "gpt-5.6-luna");
});
test("preset names normalize and matrices reject missing or extra agents", () => {
  assert.deepEqual(presetMatrix(" low "), presetMatrix("Low"));
  const matrix = presetMatrix("Low");
  assert.throws(() => cloneMatrix({ ...matrix, unexpected: { model: "x", reasoning: "low" } }), /exactly the eight/);
  const missing = { ...matrix };
  delete missing["csx-explorer"];
  assert.throws(() => cloneMatrix(missing), /exactly the eight/);
});
test("setup model probes target the selected root and resolved CODEX_HOME", async () => {
  const layout = setupLayout({ cwd: "/work/project", env: { HOME: "/home/test" } }).project;
  assert.deepEqual(codexModelContext(layout, { env: { HOME: "/home/test" } }), {
    cwd: "/work/project",
    env: { HOME: "/home/test", CODEX_HOME: "/home/test/.codex" }
  });
});
test("duplicate custom preset names are retried case-insensitively", async () => {
  const answers = ["Work", "fresh"];
  const duplicates = [];
  const name = await requestUniqueCustomPresetName(
    async () => answers.shift(),
    ["work"],
    (duplicate) => duplicates.push(duplicate)
  );
  assert.equal(name, "fresh");
  assert.deepEqual(duplicates, ["Work"]);
});

test("setup snapshots the complete installation target while limiting writes to selected agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-"));
  try {
    const layout = setupLayout({ cwd: root, env: { HOME: root } }).project;
    await mkdir(layout.agentsRoot, { recursive: true });
    await writeFile(layout.configPath, "# preserve this TOML\n");
    const paths = AGENT_NAMES.map((name) => join(layout.agentsRoot, `${name}.toml`));
    const matrix = presetMatrix("Low");
    for (const [index, path] of paths.entries()) {
      const value = matrix[AGENT_NAMES[index]];
      await writeFile(path, `name = \"${AGENT_NAMES[index]}\"\nmodel = \"${value.model}\"\nmodel_reasoning_effort = \"${value.reasoning}\"\nextra = \"preserved\"\n`);
    }
    const receiptPath = join(layout.configRoot, ".csx-install-receipt.json");
    await writeFile(receiptPath, JSON.stringify({ root, files: paths }));
    matrix[AGENT_NAMES[0]] = { model: "gpt-5.6-terra", reasoning: "high" };
    let request; let initialSnapshotSet; let finalProbe;
    const writes = [];
    await applySetup({ layout, matrix, catalog, selectedAgents: [AGENT_NAMES[0]], env: { HOME: root }, expectedFilesLoader: async () => paths, catalogLoader: async (context) => {
      finalProbe = context;
      return catalog;
    }, transactionFactory: async (declaration) => {
      initialSnapshotSet = declaration.snapshotSet;
      return declaredTransaction((value) => { request = value; }, { write: async (path, text) => { writes.push({ path, text }); await writeFile(path, text); }, commit: async () => {}, rollback: async () => {} })(declaration);
    } });
    assert.deepEqual(request.writeSet, [paths[0], receiptPath]);
    assert.deepEqual(new Set(request.snapshotSet), new Set([...paths, layout.configPath, receiptPath]));
    assert.deepEqual(new Set(initialSnapshotSet), new Set([...paths, layout.configPath, receiptPath]));
    assert.match(writes[0].text, /extra = "preserved"/);
    const receiptWrite = writes.find((write) => write.path === receiptPath);
    assert.deepEqual(JSON.parse(receiptWrite.text).setupAgentMatrix, { version: 1, agents: matrix });
    assert.deepEqual(finalProbe, { cwd: root, env: { HOME: root, CODEX_HOME: join(root, ".codex") } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("global setup coordinates its transaction under CODEX_HOME", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-global-"));
  try {
    const codex = join(root, ".codex");
    await mkdir(codex);
    await install({ scope: "global", env: { CODEX_HOME: codex } });
    const layout = setupLayout({ cwd: root, env: { CODEX_HOME: codex } }).global;
    const matrix = presetMatrix("Low");
    let coordinationRoots;
    await applySetup({
      layout,
      matrix,
      catalog,
      transactionFactory: async (declaration) => {
        coordinationRoots = declaration.coordinationRoots;
        await declaration.createDeclaration();
        return {
          write: async (path, text) => writeFile(path, text),
          commit: async () => {},
          rollback: async () => {}
        };
      }
    });
    assert.deepEqual(coordinationRoots, [codex]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("setup accepts the complete receipt produced by a real install", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-real-install-"));
  try {
    await install({ scope: "project", projectRoot: root });
    const layout = setupLayout({ cwd: root, env: { HOME: root } }).project;
    const matrix = presetMatrix("Low");
    const result = await applySetup({ layout, matrix, catalog, customPresetName: "Low-derived", env: { HOME: root } });
    assert.equal(result.changed, true);
    assert.deepEqual(await readAgentMatrix(layout.agentsRoot), matrix);
    assert.deepEqual((await readCustomPresets({ env: { HOME: root } })).presets["Low-derived"], matrix);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("setup rewrites legal multiline assignments and records the effective matrix", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-multiline-"));
  try {
    await install({ scope: "project", projectRoot: root });
    const layout = setupLayout({ cwd: root, env: { HOME: root } }).project;
    const matrix = presetMatrix("Low");
    const path = join(layout.agentsRoot, "csx-analyst.toml");
    const preserved = '\uFEFF# retained\r\nmodel = """\r\ngpt-5.6-terra"""\r\nmodel_reasoning_effort = """\r\nlow"""\r\nprompt = """\r\nPreserve\r\nthese lines\r\n"""\r\n';
    await writeFile(path, preserved);
    const result = await applySetup({ layout, matrix, catalog, env: { HOME: root } });
    const updated = await readFile(path, "utf8");
    const receipt = JSON.parse(await readFile(join(layout.configRoot, RECEIPT_NAME), "utf8"));

    assert.equal(result.changed, true);
    assert.match(updated, /^\uFEFF# retained\r\nmodel = "gpt-5\.6-luna"\r\nmodel_reasoning_effort = "high"\r\n/);
    assert.ok(updated.endsWith('prompt = """\r\nPreserve\r\nthese lines\r\n"""\r\n'));
    assert.deepEqual(await readAgentMatrix(layout.agentsRoot), matrix);
    assert.deepEqual(receipt.setupAgentMatrix, { version: 1, agents: matrix });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("setup persists receipt drift without agent changes and no-ops when the receipt matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-receipt-"));
  try {
    const layout = setupLayout({ cwd: root, env: { HOME: root } }).project;
    const matrix = presetMatrix("Low");
    const paths = AGENT_NAMES.map((name) => join(layout.agentsRoot, `${name}.toml`));
    await mkdir(layout.agentsRoot, { recursive: true });
    await writeFile(layout.configPath, "# preserve this TOML\n");
    for (const [index, path] of paths.entries()) {
      await writeFile(path, `name = "${AGENT_NAMES[index]}"\nmodel = "${matrix[AGENT_NAMES[index]].model}"\nmodel_reasoning_effort = "${matrix[AGENT_NAMES[index]].reasoning}"\n`);
    }
    const receiptPath = join(layout.configRoot, ".csx-install-receipt.json");
    await writeFile(receiptPath, JSON.stringify({ root, files: paths }));
    const writes = [];
    const result = await applySetup({ layout, matrix, catalog, expectedFilesLoader: async () => paths, transactionFactory: declaredTransaction(undefined, {
      write: async (path, text) => { writes.push({ path, text }); await writeFile(path, text); }, commit: async () => {}, rollback: async () => {}
    }) });
    assert.equal(result.changed, true);
    assert.deepEqual(writes.map(({ path }) => path), [receiptPath]);
    assert.deepEqual(JSON.parse(writes[0].text).setupAgentMatrix, { version: 1, agents: matrix });

    await writeFile(receiptPath, writes[0].text);
    let rolledBack = false;
    const noOp = await applySetup({ layout, matrix, catalog, expectedFilesLoader: async () => paths, transactionFactory: declaredTransaction(undefined, {
      write: async () => assert.fail("a matching receipt must not be written"),
      commit: async () => assert.fail("a matching receipt must not commit"),
      rollback: async () => { rolledBack = true; }
    }) });
    assert.deepEqual(noOp, { changed: false, scope: "project" });
    assert.equal(rolledBack, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("fresh install leaves no configuration directories when locking capability is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-install-refusal-"));
  try {
    await assert.rejects(
      install({
        scope: "project",
        projectRoot: root,
        transactionApi: {
          recoverTransactions: async () => [],
          beginTransaction: async () => { throw new TransactionLockError("lock_capability_unavailable", "native transaction locking is unavailable"); }
        }
      }),
      /native transaction locking is unavailable/
    );
    assert.equal(existsSync(join(root, ".codex")), false);
    assert.equal(existsSync(join(root, ".agents")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Windows classifies transaction-lock refusal without creating control paths", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-windows-refusal-"));
  try {
    await assert.rejects(
      acquireRootLock(root),
      (error) => error instanceof TransactionLockError &&
        error.code === "lock_filesystem_unsupported" &&
        /fixed-volume and final-path boundaries cannot be established/.test(error.message)
    );
    assert.equal(existsSync(join(root, ".csx-transactions")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("setup rejects reserved custom preset names regardless of case", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-setup-reserved-"));
  try {
    for (const name of ["Low", "MEDIUM", "high", "cUsToM"]) {
      await assert.rejects(
        applySetup({ matrix: presetMatrix("Low"), catalog, customPresetName: name, env: { HOME: root } }),
        /custom preset name is reserved/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("agent scanner rejects duplicate, table-decoy, and malformed escaped assignments", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-agent-scan-"));
  try {
    const agents = join(root, "agents");
    await mkdir(agents);
    for (const name of AGENT_NAMES) {
      await writeFile(join(agents, `${name}.toml`), 'model = "gpt-5.4-mini"\nmodel_reasoning_effort = "low"\n');
    }
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), '\uFEFFmodel = """gpt-5.4-mini"""\nmodel_reasoning_effort = """low"""\n');
    assert.deepEqual((await readAgentMatrix(agents))[AGENT_NAMES[0]], { model: "gpt-5.4-mini", reasoning: "low" });
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), 'model = "gpt-5.4-mini"\nmodel_reasoning_effort = "low"\n[decoy]\nmodel = "other"\n');
    await assert.rejects(readAgentMatrix(agents), /invalid agent model configuration/);
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), 'model = "gpt-5.4-mini"\nmodel = "other"\nmodel_reasoning_effort = "low"\n');
    await assert.rejects(readAgentMatrix(agents), /invalid agent model configuration/);
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), 'model = "bad\\q"\nmodel_reasoning_effort = "low"\n');
    await assert.rejects(readAgentMatrix(agents), /invalid agent model configuration/);
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), 'model = "gpt-5.4-mini\ncontinued"\nmodel_reasoning_effort = "low"\n');
    await assert.rejects(readAgentMatrix(agents), /invalid agent model configuration/);
    await writeFile(join(agents, `${AGENT_NAMES[0]}.toml`), "model = 'gpt-5.4-mini\ncontinued'\nmodel_reasoning_effort = \"low\"\n");
    await assert.rejects(readAgentMatrix(agents), /invalid agent model configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom preset files require a versioned schema and unique normalized names", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-custom-schema-"));
  try {
    const path = join(root, ".codex", CUSTOM_PRESETS_FILE);
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, presets: { Foo: presetMatrix("Low"), fOO: presetMatrix("Low") } }));
    await assert.rejects(readCustomPresets({ env: { HOME: root } }), /invalid custom preset file/);
    await writeFile(path, JSON.stringify({ Foo: presetMatrix("Low") }));
    await assert.rejects(readCustomPresets({ env: { HOME: root } }), /invalid custom preset file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("setup rejects custom-preset drift after preview without writing either scope", async () => {
  const home = await mkdtemp(join(tmpdir(), "csx-setup-preview-drift-"));
  try {
    const layout = setupLayout({ cwd: home, env: { HOME: home } }).global;
    const matrix = presetMatrix("Low");
    const paths = AGENT_NAMES.map((name) => join(layout.agentsRoot, `${name}.toml`));
    await mkdir(layout.agentsRoot, { recursive: true });
    await writeFile(layout.configPath, "# preserve this TOML\n");
    for (const [index, path] of paths.entries()) {
      const value = matrix[AGENT_NAMES[index]];
      await writeFile(path, `model = "${value.model}"\nmodel_reasoning_effort = "${value.reasoning}"\n`);
    }
    await writeFile(join(layout.configRoot, ".csx-install-receipt.json"), JSON.stringify({ root: layout.root, files: paths }));
    const presetsPath = join(layout.root, CUSTOM_PRESETS_FILE);
    await writeFile(presetsPath, JSON.stringify({ version: 1, presets: {} }));

    let writes = 0;
    let rolledBack = false;
    let initialSnapshotSet;
    await assert.rejects(
      applySetup({
        layout,
        matrix,
        catalog,
        customPresetName: "Team",
        env: { HOME: home },
        expectedFilesLoader: async () => paths,
        catalogLoader: async () => {
          await writeFile(presetsPath, JSON.stringify({ version: 1, presets: { Outside: matrix } }));
          return catalog;
        },
        transactionFactory: async (declaration) => {
          initialSnapshotSet = declaration.snapshotSet;
          return declaredTransaction(undefined, {
            write: async () => { writes += 1; },
            commit: async () => assert.fail("drifted preview must not commit"),
            rollback: async () => { rolledBack = true; }
          })(declaration);
        }
      }),
      /changed before confirmation/
    );
    assert.deepEqual(new Set(initialSnapshotSet), new Set([...paths, layout.configPath, join(layout.configRoot, RECEIPT_NAME), presetsPath]));
    assert.equal(writes, 0);
    assert.equal(rolledBack, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("catalog discovery paginates injected requests and rejects malformed pages", async () => {
  const calls = [];
  const result = await discoverCodexModels({ request: async (_method, params) => {
    calls.push(params);
    return params.cursor ? { data: [{ model: "b", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: null } : { data: [{ model: "a", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: "next" };
  } });
  assert.deepEqual(calls, [{ includeHidden: false }, { cursor: "next", includeHidden: false }]);
  assert.deepEqual(result.map(({ model }) => model), ["a", "b"]);
  await assert.rejects(discoverCodexModels({ request: async () => ({ data: "bad" }) }), /invalid model catalog page/);
});
