import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FEATURE_MANAGED_END,
  FEATURE_MANAGED_START,
  install as installCore,
  LEADER_MANAGED_END,
  LEADER_MANAGED_START,
  MANAGED_END,
  MANAGED_START,
  uninstall as uninstallCore,
  windowsCommand
} from "../lib/install.js";
import {
  AGENT_NAMES,
  INSTALLED_AGENT_NAMES,
  LEGACY_VERIFIER_NAME,
  WORKFLOW_LEADER_NAMES,
  presetMatrix
} from "../lib/presets.js";
import {
  HISTORICAL_INSTALLATION_FAMILIES,
  historicalInstallationTemplate
} from "../lib/historical-installations.js";
import {
  __setTransactionTestHooks,
  beginTransaction,
  recoverTransactions,
  recoverTransactionsDetailed
} from "../lib/transaction.js";

const roots = [];
const recoveryWorker = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "historical-recovery-worker.js");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const transactionApi = {
  async recoverTransactions() {
    return [];
  },
  async beginTransaction({ snapshotSet }) {
    const snapshots = new Map(await Promise.all(snapshotSet.map(async (path) => {
      try {
        return [path, { data: await readFile(path), present: true }];
      } catch (error) {
        if (error.code === "ENOENT") return [path, { present: false }];
        throw error;
      }
    })));
    return {
      async write(path, data, { mode } = {}) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data, mode ? { mode } : undefined);
      },
      async remove(path) {
        await rm(path, { force: true });
      },
      async commit() {},
      async close() {},
      async rollback() {
        for (const [path, before] of snapshots) {
          if (!before.present) await rm(path, { force: true });
          else await writeFile(path, before.data);
        }
      }
    };
  }
};

const install = (options) => installCore({ ...options, transactionApi });
const uninstall = (options) => uninstallCore({ ...options, transactionApi });

test("global install preserves Root settings and applies Balanced to workflow Leaders", async () => {
  const home = await temporary("global home ");
  const codex = join(home, ".codex");
  await mkdir(codex, { recursive: true });
  await writeFile(join(codex, "config.toml"), 'model = "example"\n');

  const result = await install({ scope: "global", env: { HOME: home } });

  assert.equal(result.root, codex);
  assert.equal(await readFile(join(codex, "skills", "csx-plan", "SKILL.md"), "utf8")
    .then((text) => text.includes("name: csx-plan")), true);
  assert.equal(existsSync(join(codex, "skills", "csx-deslop", "SKILL.md")), true);
  assert.equal(existsSync(join(codex, "skills", "csx-deslop", "agents", "openai.yaml")), true);
  const loopPaths = installedLoopPaths(codex, "global");
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const receipt = JSON.parse(await readFile(join(codex, ".csx-install-receipt.json"), "utf8"));
  assert.deepEqual(receipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);
  assert.equal(loopPaths.every((path) => receipt.files.filter((owned) => resolve(owned) === path).length === 1), true);
  assert.equal(existsSync(join(codex, "agents", "csx-planner.toml")), true);
  for (const name of WORKFLOW_LEADER_NAMES) {
    const path = join(codex, "agents", `${name}.toml`);
    assert.equal(existsSync(path), true);
    const definition = await readFile(path, "utf8");
    assert.match(definition, /^model = "gpt-5\.6-luna"$/m);
    assert.match(definition, /^model_reasoning_effort = "xhigh"$/m);
    assert.equal(receipt.files.includes(path), true);
  }
  assert.deepEqual(Object.keys(receipt.setupAgentMatrix.roles).sort(), ["leader", ...AGENT_NAMES].sort());
  assert.equal(receipt.leaderConfig, undefined);
  assert.equal(existsSync(join(codex, "agents", `${LEGACY_VERIFIER_NAME}.toml`)), false);
  const config = await readFile(join(codex, "config.toml"), "utf8");
  assert.doesNotMatch(config, new RegExp(LEADER_MANAGED_START));
  assert.doesNotMatch(config, new RegExp(LEADER_MANAGED_END));
  assert.match(config, /^model = "example"$/m);
  assert.doesNotMatch(config, /^model_reasoning_effort\s*=/m);
  assert.match(config, new RegExp(MANAGED_START));
  assert.match(config, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.match(config, /user-prompt-submit/);
  assert.match(config, /\[\[hooks\.SessionStart\]\]/);
  assert.match(config, /\[\[hooks\.SubagentStop\]\]/);
  assert.equal((config.match(/\[\[hooks\./g) ?? []).length, 3);
  assert.doesNotMatch(config, /\[agents\.csx-verifier\]/);
  for (const name of INSTALLED_AGENT_NAMES) {
    assert.match(config, new RegExp(`\\[agents\\.${name}\\]`));
  }
  assert.match(config, /\[features\]\ndefault_mode_request_user_input = true/);

  await uninstall({ cwd: join(home, "unrelated"), env: { HOME: home } });
  assert.equal((await readFile(join(codex, "config.toml"), "utf8")).trim(), 'model = "example"');
});

test("repeat install migrates managed Root defaults into workflow Leader files", async () => {
  const root = await temporary("managed root migration ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  await install({ scope: "project", projectRoot: root });

  const leaderRegion = new RegExp(
    `${escapeRegExp(LEADER_MANAGED_START)}[\\s\\S]*?${escapeRegExp(LEADER_MANAGED_END)}\\n*`
  );
  const currentConfig = await readFile(configPath, "utf8");
  const withoutRoot = currentConfig
    .replace(leaderRegion, "")
    .replace(/^model(?:_reasoning_effort)?\\s*=.*\\n?/gm, "");
  await writeFile(
    configPath,
    `${LEADER_MANAGED_START}\nmodel = "legacy-managed"\nmodel_reasoning_effort = "max"\n${LEADER_MANAGED_END}\n\n${withoutRoot}`
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.leaderConfig = {
    version: 1,
    originals: {
      model: 'model = "root-choice"',
      model_reasoning_effort: 'model_reasoning_effort = "high"'
    }
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  const migratedConfig = await readFile(configPath, "utf8");
  assert.doesNotMatch(migratedConfig, leaderRegion);
  assert.match(migratedConfig, /^model = "root-choice"$/m);
  assert.match(migratedConfig, /^model_reasoning_effort = "high"$/m);
  const migratedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(migratedReceipt.leaderConfig, undefined);
  for (const name of WORKFLOW_LEADER_NAMES) {
    const definition = await readFile(join(root, ".codex", "agents", `${name}.toml`), "utf8");
    const pair = migratedReceipt.setupAgentMatrix.roles.leader;
    assert.match(definition, new RegExp(`^model = "${escapeRegExp(pair.model)}"$`, "m"));
    assert.match(definition, new RegExp(`^model_reasoning_effort = "${escapeRegExp(pair.reasoning)}"$`, "m"));
  }
});

test("repeat install migrates an exact legacy verifier receipt and preserves Root on uninstall", async () => {
  const root = await temporary("legacy verifier migration ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  const verifierPath = join(root, ".codex", "agents", `${LEGACY_VERIFIER_NAME}.toml`);
  await install({ scope: "project", projectRoot: root });

  const leaderRegion = new RegExp(
    `${escapeRegExp(LEADER_MANAGED_START)}[\\s\\S]*?${escapeRegExp(LEADER_MANAGED_END)}\\n*`
  );
  let config = (await readFile(configPath, "utf8")).replace(leaderRegion, "");
  config = `model = "legacy-user-model"\nmodel_reasoning_effort = "high"\n\n${config}`;
  config = config.replace(
    "[[hooks.SessionStart]]",
    `[agents.${LEGACY_VERIFIER_NAME}]\nconfig_file = "./agents/${LEGACY_VERIFIER_NAME}.toml"\n\n[[hooks.SessionStart]]`
  );
  await writeFile(configPath, config);
  await writeFile(verifierPath, 'model = "legacy-verifier"\nmodel_reasoning_effort = "high"\n');

  const legacy = presetMatrix("Balanced");
  const legacyAgents = Object.fromEntries([
    ...AGENT_NAMES,
    LEGACY_VERIFIER_NAME
  ].map((name) => [name, {
    model: name === LEGACY_VERIFIER_NAME ? "legacy-verifier" : `saved-${name}`,
    reasoning: "high"
  }]));
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.files.push(verifierPath);
  receipt.setupAgentMatrix = { version: 1, agents: legacyAgents };
  delete receipt.leaderConfig;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  assert.equal(existsSync(verifierPath), false);
  const upgradedConfig = await readFile(configPath, "utf8");
  assert.doesNotMatch(upgradedConfig, /\[agents\.csx-verifier\]/);
  assert.doesNotMatch(upgradedConfig, new RegExp(LEADER_MANAGED_START));
  assert.match(upgradedConfig, /^model = "legacy-user-model"$/m);
  assert.match(upgradedConfig, /^model_reasoning_effort = "high"$/m);
  for (const name of WORKFLOW_LEADER_NAMES) {
    const leader = await readFile(join(root, ".codex", "agents", `${name}.toml`), "utf8");
    assert.match(leader, /^model = "gpt-5\.6-luna"$/m);
    assert.match(leader, /^model_reasoning_effort = "xhigh"$/m);
  }
  const upgradedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(upgradedReceipt.files.includes(verifierPath), false);
  assert.deepEqual(upgradedReceipt.setupAgentMatrix.roles.leader, legacy.leader);
  assert.equal(upgradedReceipt.setupAgentMatrix.roles["csx-explorer"].model, "saved-csx-explorer");

  await uninstall({ projectRoot: root });
  const restored = await readFile(configPath, "utf8");
  assert.match(restored, /model = "legacy-user-model"/);
  assert.match(restored, /model_reasoning_effort = "high"/);
});

test("global install creates the default Codex home when absent", async () => {
  const home = await temporary("new global home ");
  const codex = join(home, ".codex");

  await install({ scope: "global", env: { HOME: home } });

  assert.equal(existsSync(join(codex, ".csx-install-receipt.json")), true);
  assert.equal(existsSync(join(codex, "skills", "csx-analyze", "SKILL.md")), true);
});

test("repeat install upgrades a pre-Leader receipt with both inherited workflow leaders", async () => {
  const root = await temporary("pre leader upgrade ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  await install({ scope: "project", projectRoot: root });

  const leaderPaths = WORKFLOW_LEADER_NAMES.map((name) =>
    join(root, ".codex", "agents", `${name}.toml`));
  let config = await readFile(configPath, "utf8");
  for (const name of WORKFLOW_LEADER_NAMES) {
    config = config.replace(
      new RegExp(`\\[agents\\.${name}\\]\\nconfig_file = "[^"]+"\\n\\n`),
      ""
    );
  }
  await writeFile(configPath, config);
  for (const path of leaderPaths) await rm(path);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.files = receipt.files.filter((path) => !leaderPaths.includes(path));
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  const upgradedConfig = await readFile(configPath, "utf8");
  const upgradedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  for (const [index, path] of leaderPaths.entries()) {
    assert.equal(existsSync(path), true);
    assert.equal(upgradedReceipt.files.includes(path), true);
    assert.match(upgradedConfig, new RegExp(`\\[agents\\.${WORKFLOW_LEADER_NAMES[index]}\\]`));
  }
  assert.deepEqual(
    Object.keys(upgradedReceipt.setupAgentMatrix.roles).sort(),
    ["leader", ...AGENT_NAMES].sort()
  );
});
test("fresh global install moves transaction coordination into CODEX_HOME after bootstrap", async () => {
  const home = await temporary("root-local global coordination ");
  const codex = join(home, ".codex");
  const declarations = [];
  const recoveries = [];
  const recordingApi = {
    async recoverTransactions(root) {
      recoveries.push(root);
      return [];
    },
    async beginTransaction(declaration) {
      declarations.push(declaration);
      return transactionApi.beginTransaction(declaration);
    }
  };

  await installCore({ scope: "global", env: { HOME: home }, transactionApi: recordingApi });

  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].operation, "install");
  assert.equal(declarations[0].participants[0].coordinationRoot, codex);
  assert.deepEqual(recoveries, [codex]);
  assert.equal(existsSync(join(home, ".csx-transactions")), false);
});

test("explicit missing CODEX_HOME fails without creating it", async () => {
  const root = join(await temporary("missing codex "), "does-not-exist");
  await assert.rejects(
    install({ scope: "global", env: { CODEX_HOME: root } }),
    /CODEX_HOME does not exist/
  );
  assert.equal(existsSync(root), false);
});

test("project install uses the current directory and is isolated from global Codex home", async () => {
  const root = await temporary("project ");
  const home = await temporary("isolated home ");

  await install({ scope: "project", cwd: root, env: { HOME: home } });

  assert.equal(existsSync(join(root, ".agents", "skills", "csx-spec", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".agents", "skills", "csx-deslop", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".agents", "skills", "csx-deslop", "agents", "openai.yaml")), true);
  const loopPaths = installedLoopPaths(root, "project");
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const receipt = JSON.parse(await readFile(join(root, ".codex", ".csx-install-receipt.json"), "utf8"));
  assert.deepEqual(receipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);
  assert.equal(loopPaths.every((path) => receipt.files.filter((owned) => resolve(owned) === path).length === 1), true);
  assert.equal(existsSync(join(root, ".codex", "agents", "csx-analyst.toml")), true);
  assert.equal(existsSync(join(home, ".codex")), false);
});

test("explicit project root supports a non-Git directory and paths with spaces", async () => {
  const root = await temporary("plain project with spaces ");
  await install({ scope: "project", projectRoot: root });

  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /command = "node '/);
  assert.match(config, /commandWindows = "node \\"/);
  assert.equal(
    windowsCommand(
      "C:\\Users\\Test User\\csx\\hook.mjs",
      "session-start",
      "project",
      "C:\\Users\\Test User\\project",
    ),
    'node "C:\\Users\\Test User\\csx\\hook.mjs" session-start --authority-scope project ' +
      '--authority-root "C:\\Users\\Test User\\project"'
  );
  assert.equal(
    windowsCommand(
      "C:\\Users\\Test User\\csx\\hook.mjs",
      "subagent-stop",
      "global",
      "C:\\Users\\Test User\\.codex",
    ),
    'node "C:\\Users\\Test User\\csx\\hook.mjs" subagent-stop --authority-scope global ' +
      '--authority-root "C:\\Users\\Test User\\.codex"'
  );
});

test("project install rejects a missing project root", async () => {
  const root = join(await temporary("missing project "), "does-not-exist");
  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /project root does not exist/
  );
});
test("fresh install declares complete preimages and commits the receipt last", async () => {
  const root = await temporary("transaction declaration ");
  const calls = [];
  const recordingApi = {
    recoverTransactions: transactionApi.recoverTransactions,
    async beginTransaction(declaration) {
      calls.push({ declaration, writes: [] });
      const transaction = await transactionApi.beginTransaction(declaration);
      return {
        ...transaction,
        async write(path, data, options) {
          calls[0].writes.push({ path, data: Buffer.from(data), options });
          await transaction.write(path, data, options);
        }
      };
    }
  };

  await installCore({ scope: "project", projectRoot: root, transactionApi: recordingApi });

  const { declaration, writes } = calls[0];
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  assert.equal(declaration.participants[0].role, "prospective-installation-target");
  assert.equal(declaration.snapshotSet.includes(receiptPath), true);
  assert.deepEqual([...declaration.snapshotSet].sort(), [...declaration.writeSet].sort());
  assert.equal(writes.at(-1).path, receiptPath);
  assert.deepEqual(Object.keys(declaration.participants[0].preimages).sort(), [...declaration.snapshotSet].sort());
  assert.equal(declaration.participants[0].preimages[receiptPath].state, "absent");
  assert.deepEqual(declaration.recoveryAuthority.participants, declaration.participants);
  assert.deepEqual(declaration.recoveryAuthority.paths, [...declaration.snapshotSet].sort());
  assert.deepEqual(declaration.recoveryAuthority.roots, declaration.coordinationRoots);
  for (const { path, data, options } of writes) {
    assert.deepEqual(declaration.finalEndpoints[path], {
      state: "present",
      data: data.toString("base64"),
      hash: createHash("sha256").update(data).digest("hex"),
      mode: options.mode
    });
  }
});
test("install endpoint mismatch fails before the first payload write", async () => {
  const root = await temporary("endpoint mismatch ");
  let firstPath;
  const mismatchingApi = {
    recoverTransactions,
    async beginTransaction(declaration) {
      firstPath = declaration.writeSet[0];
      const wrong = Buffer.from("wrong endpoint");
      const finalEndpoints = Object.fromEntries(Object.entries(declaration.finalEndpoints).map(([path, endpoint]) => [
        path,
        endpoint.state === "absent" ? endpoint : {
          ...endpoint,
          data: wrong.toString("base64"),
          hash: createHash("sha256").update(wrong).digest("hex")
        }
      ]));
      return beginTransaction({ ...declaration, finalEndpoints });
    }
  };

  await assert.rejects(
    installCore({ scope: "project", projectRoot: root, transactionApi: mismatchingApi }),
    /transaction write differs from declared final endpoint/
  );
  assert.equal(existsSync(firstPath), false);
  assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), false);
});
test("repeat install and uninstall use exact v3 lifecycle declarations", async () => {
  const root = await temporary("lifecycle declarations ");
  await install({ scope: "project", projectRoot: root });
  const declarations = [];
  const mutations = [];
  const recordingApi = {
    recoverTransactions: transactionApi.recoverTransactions,
    async beginTransaction(declaration) {
      declarations.push(declaration);
      const transaction = await transactionApi.beginTransaction(declaration);
      return {
        ...transaction,
        async write(path, data, options) {
          mutations.push({ operation: declaration.operation, kind: "write", path });
          await transaction.write(path, data, options);
        },
        async remove(path) {
          mutations.push({ operation: declaration.operation, kind: "remove", path });
          await transaction.remove(path);
        }
      };
    }
  };

  await installCore({ scope: "project", projectRoot: root, transactionApi: recordingApi });
  await uninstallCore({ projectRoot: root, transactionApi: recordingApi });

  assert.deepEqual(declarations.map(({ operation }) => operation), ["install", "uninstall"]);
  for (const declaration of declarations) {
    assert.equal(declaration.participants.length, 1);
    assert.deepEqual(Object.keys(declaration.finalEndpoints).sort(), declaration.writeSet);
    assert.deepEqual(declaration.recoveryAuthority.participants, declaration.participants);
    assert.deepEqual(declaration.recoveryAuthority.paths, declaration.snapshotSet);
  }
  assert.equal(declarations[0].participants[0].role, "existing-installation-target");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  assert.deepEqual(declarations[1].finalEndpoints[receiptPath], { state: "absent" });
  assert.deepEqual(mutations.filter(({ operation }) => operation === "uninstall").at(-1), {
    operation: "uninstall",
    kind: "remove",
    path: receiptPath
  });
});
test("install rejects config drift that occurs before transaction authority", async () => {
  const root = await temporary("config drift ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, 'model = "before"\n');
  const driftingApi = {
    recoverTransactions: transactionApi.recoverTransactions,
    async beginTransaction(declaration) {
      await writeFile(configPath, 'model = "concurrent"\n');
      return transactionApi.beginTransaction(declaration);
    }
  };

  await assert.rejects(
    installCore({ scope: "project", projectRoot: root, transactionApi: driftingApi }),
    /installation state changed before transaction authority/
  );
  assert.equal(await readFile(configPath, "utf8"), 'model = "concurrent"\n');
});

test("uninstall rejects a receipt with an extra owned path", async () => {
  const root = await temporary("receipt extra ");
  await install({ scope: "project", projectRoot: root });
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.files.push(join(root, ".codex", "agents", "extra.toml"));
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);

  await assert.rejects(uninstall({ projectRoot: root }), /receipt does not match the installed package paths/);
});

test("uninstall propagates unreadable receipt errors", async () => {
  const root = await temporary("unreadable receipt ");
  await install({ scope: "project", projectRoot: root });
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  await chmod(receiptPath, 0);
  try {
    await assert.rejects(uninstall({ projectRoot: root }), /EACCES|EPERM/);
  } finally {
    await chmod(receiptPath, 0o600);
  }
});

test("fresh global re-entry recovers the stable bootstrap ancestor", async () => {
  const home = await temporary("fresh global re-entry ");
  const codex = join(home, ".codex");
  await mkdir(codex);
  const recovered = [];
  const recordingApi = {
    ...transactionApi,
    async recoverTransactions(root) {
      recovered.push(root);
      return [];
    }
  };

  await installCore({ scope: "global", env: { HOME: home }, transactionApi: recordingApi });
  assert.equal(recovered.includes(codex), true);
  assert.equal(recovered.includes(home), false);
});
test("supported Linux recovers an interrupted transaction after forced process death and re-entry", { skip: process.platform !== "linux" }, async () => {
  const root = await temporary("forced-death recovery ");
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const target = join(root, "managed.txt");
  const transactionUrl = new URL("../lib/transaction.js", import.meta.url).href;
  const declaration = {
    operation: "install",
    participants: [{
      role: "prospective-installation-target",
      root,
      configPath,
      receiptPath,
      paths: [configPath, receiptPath, target],
      preimages: {
        [configPath]: { state: "absent" },
        [receiptPath]: { state: "absent" },
        [target]: { state: "absent" }
      }
    }],
    snapshotSet: [configPath, receiptPath, target],
    writeSet: [target]
  };
  const writer = await runNodeModule(
    `import { beginTransaction } from ${JSON.stringify(transactionUrl)};
const transaction = await beginTransaction(JSON.parse(process.argv.at(-2)));
await transaction.write(process.argv.at(-1), "interrupted replacement\\n", { mode: 0o600 });
process.kill(process.pid, "SIGKILL");`,
    [JSON.stringify(declaration), target]
  );
  assert.equal(writer.signal, "SIGKILL");
  assert.equal(existsSync(target), true);
  assert.equal(await readFile(target, "utf8"), "interrupted replacement\n");

  const recovery = await runNodeModule(
    `import { recoverTransactions, recoveryAuthorityFromDeclaration } from ${JSON.stringify(transactionUrl)};
const declaration = JSON.parse(process.argv.at(-2));
const recovered = await recoverTransactions(process.argv.at(-1), recoveryAuthorityFromDeclaration(declaration));
process.stdout.write(JSON.stringify(recovered));`,
    [JSON.stringify(declaration), root]
  );
  assert.equal(recovery.code, 0, recovery.stderr);
  assert.equal(JSON.parse(recovery.stdout).length, 1);
  assert.equal(existsSync(target), false);
});

test("transaction adapter must provide both core operations", async () => {
  await assert.rejects(
    installCore({ scope: "project", projectRoot: await temporary("bad transaction api "), transactionApi: {} }),
    /transactionApi must provide beginTransaction and recoverTransactions/
  );
});

test("repeat install updates receipt-owned files", async () => {
  const root = await temporary("repeat ");
  await install({ scope: "project", projectRoot: root });
  const skill = join(root, ".agents", "skills", "csx-plan", "SKILL.md");
  await writeFile(skill, "locally modified managed file\n");

  await install({ scope: "project", projectRoot: root });

  assert.match(await readFile(skill, "utf8"), /name: csx-plan/);
  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.equal(config.split(MANAGED_START).length - 1, 1);
  assert.equal(config.split(FEATURE_MANAGED_START).length - 1, 1);
});
test("repeat install upgrades the old managed prompt router without touching user hooks", async () => {
  const root = await temporary("routing upgrade ");
  await install({ scope: "project", projectRoot: root });
  const configPath = join(root, ".codex", "config.toml");
  const current = await readFile(configPath, "utf8");
  const legacy = current.replace(
    /\[\[hooks\.UserPromptSubmit\]\][\s\S]*?\n\n\[\[hooks\.SessionStart\]\][\s\S]*?\n\n\[\[hooks\.SubagentStop\]\][\s\S]*?(?=\n# <<< csx managed <<<)/,
    '[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = "node old-hook.mjs user-prompt-submit" }]'
  );
  await writeFile(configPath, `${legacy}\n[[hooks.Notification]]\nhooks = [{ type = "command", command = "user-owned" }]\n`);

  await install({ scope: "project", projectRoot: root });

  const upgraded = await readFile(configPath, "utf8");
  const managed = upgraded.slice(
    upgraded.indexOf(MANAGED_START),
    upgraded.indexOf(MANAGED_END) + MANAGED_END.length
  );
  assert.match(managed, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.match(managed, /csx-hook\.mjs['"]? user-prompt-submit/);
  assert.doesNotMatch(managed, /old-hook\.mjs/);
  assert.match(managed, /\[\[hooks\.SessionStart\]\]/);
  assert.match(managed, /\[\[hooks\.SubagentStop\]\]/);
  assert.match(upgraded, /\[\[hooks\.Notification\]\][\s\S]*command = "user-owned"/);
});

test("repeat install upgrades an exact pre-loop receipt with only the two loop additions", async () => {
  const root = await temporary("pre-loop upgrade ");
  await install({ scope: "project", projectRoot: root });
  const { loopPaths, receiptPath, receipt: preLoopReceipt } = await makePreLoopInstallation(root);
  const declarations = [];
  const recordingApi = {
    ...transactionApi,
    async beginTransaction(declaration) {
      declarations.push(declaration);
      return transactionApi.beginTransaction(declaration);
    }
  };

  await installCore({ scope: "project", projectRoot: root, transactionApi: recordingApi });

  assert.equal(declarations.length, 1);
  const declaration = declarations[0];
  assert.deepEqual(declaration.participants[0].additions, loopPaths);
  assert.deepEqual(
    declaration.participants[0].paths,
    [...new Set([...preLoopReceipt.files, join(root, ".codex", "config.toml"), receiptPath, ...loopPaths]
      .map((path) => resolve(path)))].sort()
  );
  assert.equal(loopPaths.every((path) => declaration.snapshotSet.includes(path)), true);
  assert.equal(loopPaths.every((path) => declaration.writeSet.includes(path)), true);
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const upgradedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(upgradedReceipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);

  await uninstall({ projectRoot: root });
  assert.equal(loopPaths.every((path) => !existsSync(path)), true);
  assert.equal(existsSync(join(root, ".agents", "skills", "csx-plan", "SKILL.md")), false);
});

test("direct pre-loop uninstall uses only receipt-owned paths and no upgrade additions", async () => {
  const root = await temporary("pre-loop uninstall ");
  await install({ scope: "project", projectRoot: root });
  const { loopPaths } = await makePreLoopInstallation(root);
  const declarations = [];
  const recordingApi = {
    ...transactionApi,
    async beginTransaction(declaration) {
      declarations.push(declaration);
      return transactionApi.beginTransaction(declaration);
    }
  };

  await uninstallCore({ projectRoot: root, transactionApi: recordingApi });

  assert.equal(declarations.length, 1);
  assert.deepEqual(declarations[0].participants[0].additions, []);
  assert.equal(loopPaths.every((path) => !declarations[0].snapshotSet.includes(path)), true);
  assert.equal(loopPaths.every((path) => !declarations[0].writeSet.includes(path)), true);
  assert.equal(existsSync(join(root, ".agents", "skills", "csx-plan", "SKILL.md")), false);
});

test("pre-loop upgrade finalizes additions, config, and receipt after all-final process death", { skip: process.platform !== "linux" }, async () => {
  const root = await temporary("pre-loop forced-death ");
  const configPath = join(root, ".codex", "config.toml");
  await install({ scope: "project", projectRoot: root });
  const {
    loopPaths,
    receiptPath
  } = await makePreLoopInstallation(root);
  const installUrl = new URL("../lib/install.js", import.meta.url).href;
  const transactionUrl = new URL("../lib/transaction.js", import.meta.url).href;
  const writer = await runNodeModule(
    `import { resolve } from "node:path";
import { install } from ${JSON.stringify(installUrl)};
import { beginTransaction, recoverTransactions } from ${JSON.stringify(transactionUrl)};
const root = process.argv.at(-2);
const receiptPath = resolve(process.argv.at(-1));
const transactionApi = {
  recoverTransactions,
  async beginTransaction(declaration) {
    const transaction = await beginTransaction(declaration);
    return {
      async write(path, data, options) {
        await transaction.write(path, data, options);
        if (resolve(path) === receiptPath) process.kill(process.pid, "SIGKILL");
      },
      remove: transaction.remove.bind(transaction),
      commit: transaction.commit.bind(transaction),
      rollback: transaction.rollback.bind(transaction),
      close: transaction.close.bind(transaction)
    };
  }
};
await install({ scope: "project", projectRoot: root, transactionApi });`,
    [root, receiptPath]
  );
  assert.equal(writer.signal, "SIGKILL", writer.stderr);
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const interruptedConfig = await readFile(configPath, "utf8");
  const interruptedReceiptText = await readFile(receiptPath, "utf8");
  const interruptedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(interruptedReceipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);

  const recoveryAttempts = [];
  const recoveryApi = recordingRecoveryApi(
    [...interruptedReceipt.files, configPath, receiptPath],
    recoveryAttempts
  );
  let observedRecoveredFinal = false;
  const restoreHooks = __setTransactionTestHooks({
    async beforeManifest() {
      assert.equal(loopPaths.every((path) => existsSync(path)), true);
      assert.equal(await readFile(configPath, "utf8"), interruptedConfig);
      assert.equal(await readFile(receiptPath, "utf8"), interruptedReceiptText);
      observedRecoveredFinal = true;
    }
  });
  try {
    await installCore({ scope: "project", projectRoot: root, transactionApi: recoveryApi });
  } finally {
    restoreHooks();
  }

  assert.equal(recoveryAttempts.at(-1).recovered, true);
  assert.equal(recoveryAttempts.slice(0, -1).every(({ recovered }) => recovered === false), true);
  assert.equal(recoveryAttempts[0].errorCode, "recovery_required");
  assert.equal(recoveryAttempts.every(({ paths }) =>
    JSON.stringify(paths) === JSON.stringify(recoveryAttempts[0].paths)), true);
  assert.deepEqual(recoveryAttempts[0].additions, []);
  assert.equal(loopPaths.every((path) => recoveryAttempts[0].expectedFiles.includes(path)), true);
  assert.deepEqual(recoveryAttempts.at(-1).additions, loopPaths);
  assert.equal(loopPaths.every((path) => !recoveryAttempts.at(-1).expectedFiles.includes(path)), true);
  assert.equal(observedRecoveredFinal, true);
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const recoveredReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(recoveredReceipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);
  assert.equal(loopPaths.every((path) => recoveredReceipt.files.filter((owned) => resolve(owned) === path).length === 1), true);

  await uninstallCore({ projectRoot: root });
  assert.equal(loopPaths.every((path) => !existsSync(path)), true);
});

test("direct pre-loop uninstall finalizes its exact no-additions split after all-final process death", { skip: process.platform !== "linux" }, async () => {
  const root = await temporary("pre-loop uninstall forced-death ");
  const configPath = join(root, ".codex", "config.toml");
  const keepPath = join(root, ".codex", "agents", "keep.toml");
  await install({ scope: "project", projectRoot: root });
  const {
    loopPaths,
    receiptPath,
    receipt: preLoopReceipt
  } = await makePreLoopInstallation(root);
  await writeFile(keepPath, "keep\n");
  const installUrl = new URL("../lib/install.js", import.meta.url).href;
  const transactionUrl = new URL("../lib/transaction.js", import.meta.url).href;
  const writer = await runNodeModule(
    `import { resolve } from "node:path";
import { uninstall } from ${JSON.stringify(installUrl)};
import { beginTransaction, recoverTransactions } from ${JSON.stringify(transactionUrl)};
const root = process.argv.at(-2);
const receiptPath = resolve(process.argv.at(-1));
const transactionApi = {
  recoverTransactions,
  async beginTransaction(declaration) {
    const transaction = await beginTransaction(declaration);
    return {
      write: transaction.write.bind(transaction),
      async remove(path) {
        await transaction.remove(path);
        if (resolve(path) === receiptPath) process.kill(process.pid, "SIGKILL");
      },
      commit: transaction.commit.bind(transaction),
      rollback: transaction.rollback.bind(transaction),
      close: transaction.close.bind(transaction)
    };
  }
};
await uninstall({ projectRoot: root, transactionApi });`,
    [root, receiptPath]
  );
  assert.equal(writer.signal, "SIGKILL", writer.stderr);
  assert.equal(existsSync(receiptPath), false);
  assert.equal(preLoopReceipt.files.every((path) => !existsSync(path)), true);
  assert.equal(loopPaths.every((path) => !existsSync(path)), true);
  assert.equal(existsSync(keepPath), true);

  const recoveryAttempts = [];
  const recoveryApi = recordingRecoveryApi(
    [...preLoopReceipt.files, ...loopPaths, configPath, receiptPath, keepPath],
    recoveryAttempts
  );
  let beganReplacementTransaction = false;
  const restoreHooks = __setTransactionTestHooks({
    async beforeManifest() {
      beganReplacementTransaction = true;
    }
  });
  let removed;
  try {
    removed = await uninstallCore({ projectRoot: root, transactionApi: recoveryApi });
  } finally {
    restoreHooks();
  }

  assert.equal(removed.removed, true);
  assert.equal(recoveryAttempts.at(-1).recovered, true);
  assert.equal(recoveryAttempts.slice(0, -1).every(({ recovered }) => recovered === false), true);
  assert.equal(recoveryAttempts[0].errorCode, "recovery_required");
  assert.equal(recoveryAttempts.every(({ additions }) => additions.length === 0), true);
  assert.equal(loopPaths.every((path) => recoveryAttempts[0].expectedFiles.includes(path)), true);
  assert.equal(loopPaths.every((path) => !recoveryAttempts.at(-1).expectedFiles.includes(path)), true);
  assert.equal(beganReplacementTransaction, false);
  assert.equal(preLoopReceipt.files.every((path) => !existsSync(path)), true);
  assert.equal(loopPaths.every((path) => !existsSync(path)), true);
  assert.equal(existsSync(receiptPath), false);
  assert.equal(await readFile(keepPath, "utf8"), "keep\n");
  assert.deepEqual(
    await uninstallCore({ projectRoot: root, transactionApi: recoveryApi }),
    { removed: false }
  );
});

test("repeat install retains valid receipt setup agent selections", async () => {
  const root = await temporary("repeat setup receipt ");
  await install({ scope: "project", projectRoot: root });
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.setupAgentMatrix = {
    version: 2,
    roles: Object.fromEntries([
      "leader",
      "csx-explorer", "csx-analyst", "csx-planner", "csx-architect",
      "csx-critic", "csx-executor", "csx-code-reviewer"
    ].map((agent) => [agent, { model: "saved-model", reasoning: "saved-effort" }]))
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  const agent = await readFile(join(root, ".codex", "agents", "csx-explorer.toml"), "utf8");
  assert.match(agent, /model = "saved-model"/);
  assert.match(agent, /model_reasoning_effort = "saved-effort"/);
  for (const name of WORKFLOW_LEADER_NAMES) {
    const leader = await readFile(join(root, ".codex", "agents", `${name}.toml`), "utf8");
    assert.match(leader, /model = "saved-model"/);
    assert.match(leader, /model_reasoning_effort = "saved-effort"/);
  }
  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.doesNotMatch(config, /^model(?:_reasoning_effort)?\s*=/m);
});

test("install retains write, rollback, and close failures", async () => {
  const root = await temporary("aggregate transaction ");
  const writeFailure = new Error("write failed");
  const rollbackFailure = new Error("rollback failed");
  const closeFailure = new Error("close failed");
  const failingApi = {
    async recoverTransactions() {},
    async beginTransaction() {
      return {
        async write() { throw writeFailure; },
        async rollback() { throw rollbackFailure; },
        async close() { throw closeFailure; }
      };
    }
  };

  await assert.rejects(
    installCore({ scope: "project", projectRoot: root, transactionApi: failingApi }),
    (error) => error instanceof AggregateError &&
      error.errors[0] === writeFailure &&
      error.errors[1] === rollbackFailure &&
      error.errors[2] === closeFailure
  );
});

test("repeat install upgrades a receipt from before feature management", async () => {
  const root = await temporary("old receipt ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  await install({ scope: "project", projectRoot: root });

  const featureRegion = new RegExp(
    `\\n*${escapeRegExp(FEATURE_MANAGED_START)}[\\s\\S]*?${escapeRegExp(FEATURE_MANAGED_END)}\\n?`
  );
  await writeFile(configPath, (await readFile(configPath, "utf8")).replace(featureRegion, "\n"));
  const oldReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  delete oldReceipt.featureConfig;
  await writeFile(receiptPath, `${JSON.stringify(oldReceipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  const upgraded = await readFile(configPath, "utf8");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.match(upgraded, new RegExp(FEATURE_MANAGED_START));
  assert.equal(receipt.featureConfig.key, "default_mode_request_user_input");
  assert.equal(receipt.featureConfig.previousLine, null);
});

test("install preserves an existing features table and uninstall removes only the managed key", async () => {
  const root = await temporary("existing features ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    "model = \"example\"\n\n[features]\napps = false # keep this\n"
  );

  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(installed, /apps = false # keep this/);
  assert.match(installed, new RegExp(FEATURE_MANAGED_START));
  assert.match(installed, /default_mode_request_user_input = true/);

  await uninstall({ projectRoot: root });

  const removed = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(removed, /\[features\]\napps = false # keep this/);
  assert.doesNotMatch(removed, /default_mode_request_user_input/);
  assert.match(removed, /model = "example"/);
});

test("install reversibly overrides an explicit false feature across repeat installs", async () => {
  const root = await temporary("false feature ");
  const configPath = join(root, ".codex", "config.toml");
  const original = [
    "model = \"example\"",
    "",
    "[features]",
    "default_mode_request_user_input = false # user preference",
    "apps = true",
    ""
  ].join("\n");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(configPath, original);

  await install({ scope: "project", projectRoot: root });
  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(configPath, "utf8");
  assert.match(installed, /default_mode_request_user_input = true/);
  assert.doesNotMatch(installed, /false # user preference/);
  const receipt = JSON.parse(await readFile(join(root, ".codex", ".csx-install-receipt.json"), "utf8"));
  assert.equal(
    receipt.featureConfig.previousLine,
    "default_mode_request_user_input = false # user preference"
  );

  await uninstall({ projectRoot: root });

  const restored = await readFile(configPath, "utf8");
  assert.match(restored, /default_mode_request_user_input = false # user preference/);
  assert.match(restored, /apps = true/);
  assert.doesNotMatch(restored, new RegExp(FEATURE_MANAGED_START));
});

test("an existing true feature stays user-owned after uninstall", async () => {
  const root = await temporary("true feature ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(configPath, "[features]\ndefault_mode_request_user_input = true # mine\n");

  await install({ scope: "project", projectRoot: root });
  const installed = await readFile(configPath, "utf8");
  assert.doesNotMatch(installed, new RegExp(FEATURE_MANAGED_START));

  await uninstall({ projectRoot: root });
  assert.match(
    await readFile(configPath, "utf8"),
    /default_mode_request_user_input = true # mine/
  );
});

test("unsupported inline features fail before payload writes", async () => {
  const root = await temporary("inline features ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    "features = { default_mode_request_user_input = false }\n"
  );

  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /cannot safely manage default_mode_request_user_input in inline features table/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});
test("escaped basic keys and tables fail before mutation", async () => {
  for (const config of [
    "\"featu\\u0072es\" = { apps = false }\n",
    "[features]\n[\"featu\\u0072es\"]\napps = false\n"
  ]) {
    const root = await temporary("escaped TOML key ");
    const configPath = join(root, ".codex", "config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, config);

    await assert.rejects(
      install({ scope: "project", projectRoot: root }),
      /cannot safely parse TOML before mutation/
    );
    assert.equal(await readFile(configPath, "utf8"), config);
    assert.equal(existsSync(join(root, ".agents")), false);
  }
});

test("quoted dotted TOML table keys remain distinct from dotted paths", async () => {
  const root = await temporary("quoted dotted TOML key ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, "[\"features.experimental\"]\nenabled = true\n");

  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(configPath, "utf8");
  assert.match(installed, /\["features\.experimental"\]\nenabled = true/);
  assert.match(installed, /\[features\]\ndefault_mode_request_user_input = true/);
});
test("install scans BOM CRLF comments and multiline TOML strings before locating features", async () => {
  const root = await temporary("toml scanner ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    configPath,
    "\ufefftitle = \"# not a comment\"\r\nbasic = \"\"\"\r\n[not-a-table]\r\n# not a comment\r\n\"\"\"\r\nliteral = '''\r\n[also-not-a-table]\r\n# still text\r\n'''\r\n# [commented.table]\r\n[features] # real table\r\napps = false\r\n"
  );

  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(configPath, "utf8");
  assert.match(installed, /basic = """/);
  assert.match(installed, /literal = '''/);
  assert.match(installed, /\[features\] # real table/);
  assert.match(installed, /default_mode_request_user_input = true/);
});

test("a quoted dotted key is not treated as a features dotted key", async () => {
  const root = await temporary("quoted dotted key ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(configPath, '"features.default_mode_request_user_input" = false\n');

  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(configPath, "utf8");
  assert.match(installed, /"features\.default_mode_request_user_input" = false/);
  assert.match(installed, /\[features\]\ndefault_mode_request_user_input = true/);
});

test("duplicate top-level TOML keys fail before payload writes", async () => {
  const root = await temporary("duplicate toml key ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), "model = \"one\"\nmodel = \"two\"\n");

  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /duplicate top-level TOML key/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("broken feature markers fail before payload writes", async () => {
  const root = await temporary("broken feature markers ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), `${FEATURE_MANAGED_START}\n`);

  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /broken csx feature default_mode_request_user_input markers/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("unmanaged destination and unmanaged agent table fail before payload writes", async () => {
  const collisionRoot = await temporary("collision ");
  const collision = join(collisionRoot, ".agents", "skills", "csx-plan", "SKILL.md");
  await mkdir(join(collision, ".."), { recursive: true });
  await writeFile(collision, "mine\n");
  await assert.rejects(
    install({ scope: "project", projectRoot: collisionRoot }),
    /unmanaged file/
  );
  assert.equal(existsSync(join(collisionRoot, ".codex", "agents", "csx-planner.toml")), false);

  const tableRoot = await temporary("table collision ");
  await mkdir(join(tableRoot, ".codex"), { recursive: true });
  await writeFile(join(tableRoot, ".codex", "config.toml"), "[agents.csx-planner]\nfoo = true\n");
  await assert.rejects(
    install({ scope: "project", projectRoot: tableRoot }),
    /unmanaged \[agents\.csx-planner\]/
  );
});

test("broken managed markers fail before writing", async () => {
  const root = await temporary("broken markers ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), `${MANAGED_START}\n`);
  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /broken csx managed markers/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("uninstall prefers the current project, then removes global, and is idempotent", async () => {
  const home = await temporary("uninstall home ");
  const globalRoot = join(home, ".codex");
  const project = await temporary("uninstall project ");
  await mkdir(globalRoot, { recursive: true });
  await install({ scope: "global", env: { HOME: home } });
  await install({ scope: "project", projectRoot: project });

  const first = await uninstall({ cwd: project, env: { HOME: home } });
  assert.equal(first.scope, "project");
  assert.equal(existsSync(join(project, ".agents", "skills", "csx-plan", "SKILL.md")), false);
  assert.equal(existsSync(join(globalRoot, "skills", "csx-plan", "SKILL.md")), true);

  const second = await uninstall({ cwd: project, env: { HOME: home } });
  assert.equal(second.scope, "global");
  assert.equal(existsSync(join(globalRoot, "skills", "csx-plan", "SKILL.md")), false);

  assert.deepEqual(await uninstall({ cwd: project, env: { HOME: home } }), { removed: false });
});
test("uninstall recovers candidates strictly in project-first precedence order", async () => {
  const home = await temporary("uninstall recovery home ");
  const globalRoot = join(home, ".codex");
  const project = await temporary("uninstall recovery project ");
  await mkdir(globalRoot, { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  await installCore({ scope: "project", projectRoot: project });

  const recovered = [];
  const recordingApi = {
    ...transactionApi,
    async recoverTransactions(root) {
      recovered.push(resolve(root));
      return [];
    }
  };

  const first = await uninstallCore({ cwd: project, env: { HOME: home }, transactionApi: recordingApi });
  assert.equal(first.scope, "project");
  assert.deepEqual(recovered, [resolve(project)]);

  recovered.length = 0;
  const second = await uninstallCore({ cwd: project, env: { HOME: home }, transactionApi: recordingApi });
  assert.equal(second.scope, "global");
  assert.deepEqual(recovered, [resolve(project), resolve(globalRoot)]);
});

test("all-final current project uninstall re-entry preserves a coexisting global install", async () => {
  const home = await temporary("current uninstall global all-final ");
  const root = await temporary("current uninstall project all-final ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await mkdir(anchor, { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  await installCore({ scope: "project", cwd: anchor });
  const globalPaths = [
    join(home, ".codex", ".csx-install-receipt.json"),
    join(home, ".codex", "config.toml"),
    join(home, ".codex", "hooks", "csx-hook.mjs")
  ];
  const projectPaths = [
    join(root, ".codex", ".csx-install-receipt.json"),
    join(root, ".codex", "hooks", "csx-hook.mjs"),
    join(root, ".agents", "skills", "csx-plan", "SKILL.md")
  ];
  const globalBefore = await Promise.all(globalPaths.map((path) => readFile(path)));

  assert.equal(
    await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, "all-final"], {
      env: { ...process.env, HOME: home }
    }),
    82
  );
  assert.deepEqual(await uninstallCore({ cwd: anchor, env: { HOME: home } }), {
    removed: true,
    scope: "project",
    root
  });

  assert.deepEqual(projectPaths.map((path) => existsSync(path)), [false, false, false]);
  assert.deepEqual(await Promise.all(globalPaths.map((path) => readFile(path))), globalBefore);
});

for (const [label, mutate] of [
  ["operation-only", (bundle) => {
    bundle.operation = "install";
  }],
  ["operation and canonical receipt endpoint", (bundle) => {
    bundle.operation = "install";
    const canonical = bundle.participants.find(({ role }) => role === "existing-installation-target");
    bundle.finalEndpoints[canonical.receiptPath] = bundle.preimages[canonical.receiptPath];
  }]
]) {
  test(`all-final current project uninstall rejects re-signed ${label} authority before global mutation`, async () => {
    const home = await temporary(`re-signed ${label} global `);
    const root = await temporary(`re-signed ${label} project `);
    await runProcess("git", ["init", "-q", root]);
    const anchor = join(root, "nested");
    await mkdir(anchor, { recursive: true });
    await installCore({ scope: "global", env: { HOME: home } });
    await installCore({ scope: "project", cwd: anchor });
    const globalPaths = [
      join(home, ".codex", ".csx-install-receipt.json"),
      join(home, ".codex", "config.toml"),
      join(home, ".codex", "hooks", "csx-hook.mjs")
    ];
    const globalBefore = await Promise.all(globalPaths.map((path) => readFile(path)));

    assert.equal(
      await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, "all-final"], {
        env: { ...process.env, HOME: home }
      }),
      82
    );
    const bundlePath = await onlyBundlePath(root);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    mutate(bundle);
    resignBundle(bundle);
    await writeFile(bundlePath, JSON.stringify(bundle), { mode: 0o600 });
    const controlBefore = await snapshotControlTree(root);

    await assert.rejects(
      uninstallCore({ cwd: anchor, env: { HOME: home } }),
      (error) => error?.code === "recovery_required"
    );
    assert.deepEqual(await snapshotControlTree(root), controlBefore);
    assert.deepEqual(await Promise.all(globalPaths.map((path) => readFile(path))), globalBefore);
  });
}

test("legacy two-method adapter suppresses global fallthrough after real project recovery", async () => {
  const home = await temporary("legacy adapter global ");
  const root = await temporary("legacy adapter project ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await mkdir(anchor, { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  await installCore({ scope: "project", cwd: anchor });
  const globalPaths = [
    join(home, ".codex", ".csx-install-receipt.json"),
    join(home, ".codex", "config.toml"),
    join(home, ".codex", "hooks", "csx-hook.mjs")
  ];
  const globalBefore = await Promise.all(globalPaths.map((path) => readFile(path)));
  assert.equal(
    await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, "all-final"], {
      env: { ...process.env, HOME: home }
    }),
    82
  );
  const legacyAdapter = {
    beginTransaction,
    recoverTransactions
  };

  await assert.rejects(
    uninstallCore({ cwd: anchor, env: { HOME: home }, transactionApi: legacyAdapter }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(await Promise.all(globalPaths.map((path) => readFile(path))), globalBefore);
});

test("multiple detailed recovery outcomes fail closed instead of selecting one completion", async () => {
  const home = await temporary("ambiguous recovery global ");
  const root = await temporary("ambiguous recovery project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);
  const ambiguousAdapter = {
    ...transactionApi,
    async recoverTransactionsDetailed() {
      return {
        recovered: ["first", "second"],
        transactions: [
          { id: "first", operation: "uninstall", boundary: "all-final" },
          { id: "second", operation: "install", boundary: "all-final" }
        ]
      };
    }
  };

  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: ambiguousAdapter }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(await readFile(globalReceipt), globalBefore);
});

test("top-level completion cannot bypass multiple detailed recovery outcomes", async () => {
  const home = await temporary("combined ambiguous recovery global ");
  const root = await temporary("combined ambiguous recovery project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);
  const ambiguousAdapter = {
    ...transactionApi,
    async recoverTransactionsDetailed() {
      return {
        recovered: ["first", "second"],
        operation: "uninstall",
        boundary: "all-final",
        transactions: [
          { id: "first", operation: "uninstall", boundary: "all-final" },
          { id: "second", operation: "install", boundary: "all-final" }
        ]
      };
    }
  };

  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: ambiguousAdapter }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(await readFile(globalReceipt), globalBefore);
});

test("top-level completion must match its single detailed recovery outcome", async () => {
  const home = await temporary("combined recovery summary global ");
  const root = await temporary("combined recovery summary project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);
  const adapter = (operation) => ({
    ...transactionApi,
    async recoverTransactionsDetailed() {
      return {
        recovered: ["current"],
        operation: "uninstall",
        boundary: "all-final",
        transactions: [{ id: "current", operation, boundary: "all-final" }]
      };
    }
  });

  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter("install") }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(
    await uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter("uninstall") }),
    { removed: true, scope: "project", root }
  );
  assert.deepEqual(await readFile(globalReceipt), globalBefore);
});

test("opaque detailed recovery ids suppress global fallback", async () => {
  const home = await temporary("opaque detailed recovery global ");
  const root = await temporary("opaque detailed recovery project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);

  for (const result of [
    { recovered: ["opaque"] },
    { recovered: ["opaque"], transactions: [] }
  ]) {
    const adapter = {
      ...transactionApi,
      async recoverTransactionsDetailed() {
        return result;
      }
    };
    await assert.rejects(
      uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter }),
      (error) => error?.code === "recovery_required"
    );
    assert.deepEqual(await readFile(globalReceipt), globalBefore);
  }
});

test("malformed detailed recovery shapes fail closed before global fallback", async () => {
  const home = await temporary("malformed detailed recovery global ");
  const root = await temporary("malformed detailed recovery project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);

  for (const result of [
    { recovered: [] },
    { recovered: new Array(1), transactions: [] },
    { recovered: ["current"], operation: "install", boundary: "all-final" },
    {
      recovered: ["current"],
      operation: "uninstall",
      boundary: "all-final",
      transactions: {}
    },
    {
      recovered: ["current"],
      transactions: [{ id: "current", operation: 7, boundary: {} }]
    },
    {
      recovered: ["other"],
      transactions: [{ id: "current", operation: "uninstall", boundary: "all-final" }]
    }
  ]) {
    const adapter = {
      ...transactionApi,
      async recoverTransactionsDetailed() {
        return result;
      }
    };
    await assert.rejects(
      uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter }),
      (error) => error?.code === "recovery_required"
    );
    assert.deepEqual(await readFile(globalReceipt), globalBefore);
  }
});

test("recovery outcome must agree with the receipt endpoint before scope selection", async () => {
  const home = await temporary("recovery endpoint global ");
  const root = await temporary("recovery endpoint project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalRoot = join(home, ".codex");
  const globalReceipt = join(globalRoot, ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);
  const adapter = (operation) => ({
    ...transactionApi,
    async recoverTransactionsDetailed() {
      return {
        recovered: ["current"],
        transactions: [{ id: "current", operation, boundary: "all-final" }]
      };
    }
  });

  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter("install") }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(await readFile(globalReceipt), globalBefore);

  await rm(join(root, ".csx-transactions"), { recursive: true, force: true });
  await mkdir(join(globalRoot, ".csx-transactions"), { recursive: true });
  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter("uninstall") }),
    (error) => error?.code === "recovery_required"
  );
  assert.deepEqual(await readFile(globalReceipt), globalBefore);
});

test("injected adapters cannot impersonate the historical recovery producer", async () => {
  const home = await temporary("historical producer authority global ");
  const root = await temporary("historical producer authority project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalPaths = [
    join(home, ".codex", ".csx-install-receipt.json"),
    join(home, ".codex", "config.toml"),
    join(home, ".codex", "hooks", "csx-hook.mjs")
  ];
  const globalBefore = await Promise.all(globalPaths.map((path) => readFile(path)));
  let injectedHistoricalCalls = 0;
  const adapter = {
    ...transactionApi,
    async recoverTransactionsDetailed() {
      throw Object.assign(new Error("retry with historical authority"), {
        code: "recovery_required"
      });
    },
    async recoverHistoricalTransactions() {
      injectedHistoricalCalls += 1;
      return {
        recovered: ["forged"],
        operation: "install",
        boundary: "all-final"
      };
    }
  };

  await assert.rejects(
    uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter }),
    (error) => error?.code === "recovery_required"
  );
  assert.equal(injectedHistoricalCalls, 0);
  assert.deepEqual(await Promise.all(globalPaths.map((path) => readFile(path))), globalBefore);
});

test("top-level historical recovery summary requires exactly one recovered id", async () => {
  const home = await temporary("historical summary cardinality global ");
  const root = await temporary("historical summary cardinality project ");
  await runProcess("git", ["init", "-q", root]);
  await mkdir(join(root, ".csx-transactions"), { recursive: true });
  await installCore({ scope: "global", env: { HOME: home } });
  const globalReceipt = join(home, ".codex", ".csx-install-receipt.json");
  const globalBefore = await readFile(globalReceipt);

  for (const recovered of [[], ["historical", "extra"]]) {
    for (const operation of ["install", "uninstall"]) {
      const adapter = {
        ...transactionApi,
        async recoverTransactionsDetailed() {
          return { recovered, operation, boundary: "all-final" };
        }
      };
      await assert.rejects(
        uninstallCore({ cwd: root, env: { HOME: home }, transactionApi: adapter }),
        (error) => error?.code === "recovery_required"
      );
      assert.deepEqual(await readFile(globalReceipt), globalBefore);
    }
  }
});

test("uninstall preserves unrelated config and non-empty directories", async () => {
  const root = await temporary("preserve ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), "approval_policy = \"never\"\n");
  await install({ scope: "project", projectRoot: root });
  await writeFile(join(root, ".codex", "agents", "keep.toml"), "name = \"keep\"\n");

  await uninstall({ projectRoot: root });

  assert.equal(await readFile(join(root, ".codex", "config.toml"), "utf8")
    .then((text) => text.trim()), 'approval_policy = "never"');
  assert.equal(existsSync(join(root, ".codex", "agents", "keep.toml")), true);
  assert.equal(existsSync(join(root, ".codex", "config.toml")), true);
});

test("all seven registered historical families migrate from the invocation anchor into one canonical project", async () => {
  for (const family of HISTORICAL_INSTALLATION_FAMILIES) {
    const root = await temporary(`historical ${family.id} `);
    await runProcess("git", ["init", "-q", root]);
    const anchor = join(root, "packages", "app");
    await seedHistoricalInstallation(anchor, family);
    const unownedPlugin = join(anchor, ".codex", "plugins", "csx-local", "plugin.json");
    await mkdir(dirname(unownedPlugin), { recursive: true });
    await writeFile(unownedPlugin, "{\"userOwned\":true}\n");

    await installCore({ scope: "project", cwd: anchor });

    assert.equal(existsSync(join(anchor, ".codex", ".csx-install-receipt.json")), false, family.id);
    assert.equal(await readFile(join(anchor, ".codex", "config.toml"), "utf8"), "", family.id);
    assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), true, family.id);
    assert.equal(await readFile(unownedPlugin, "utf8"), "{\"userOwned\":true}\n", family.id);
  }
});

test("same-root H21 upgrades through one canonical existing target with a non-overlapping expansion", async () => {
  const root = await temporary("historical same root ");
  await runProcess("git", ["init", "-q", root]);
  const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h21-3abc221");
  await seedHistoricalInstallation(root, family);
  let declaration;
  const recordingApi = {
    recoverTransactions,
    async beginTransaction(value) {
      declaration = value;
      return beginTransaction(value);
    }
  };

  await installCore({ scope: "project", cwd: root, transactionApi: recordingApi });

  assert.equal(declaration.participants.filter(({ role }) => role === "existing-installation-target").length, 1);
  assert.equal(declaration.participants.filter(({ role }) => role === "historical-installation-target").length, 0);
  assert.equal(declaration.participants.filter(({ role }) => role === "metadata-participant").length, 1);
  assert.equal(existsSync(join(root, ".agents", "skills", "csx-deslop", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".codex", "agents", `${LEGACY_VERIFIER_NAME}.toml`)), false);
});

test("legacy-only uninstall remains a project uninstall and leaves global untouched", async () => {
  const home = await temporary("historical uninstall home ");
  const root = await temporary("historical uninstall project ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await seedHistoricalInstallation(anchor, HISTORICAL_INSTALLATION_FAMILIES[0]);
  await installCore({ scope: "global", env: { HOME: home } });

  assert.deepEqual(await uninstallCore({ cwd: anchor, env: { HOME: home } }), {
    removed: true,
    scope: "project",
    root
  });
  assert.equal(existsSync(join(anchor, ".codex", ".csx-install-receipt.json")), false);
  assert.equal(existsSync(join(home, ".codex", ".csx-install-receipt.json")), true);
});

test("unsupported same-semver historical receipts stop before transaction control or user writes", async () => {
  const root = await temporary("historical unsupported ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await seedHistoricalInstallation(anchor, HISTORICAL_INSTALLATION_FAMILIES[0]);
  const receiptPath = join(anchor, ".codex", ".csx-install-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.files.push(join(anchor, "user-owned.txt"));
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(join(anchor, "user-owned.txt"), "preserve me\n");
  let began = 0;

  await assert.rejects(installCore({
    scope: "project",
    cwd: anchor,
    transactionApi: {
      recoverTransactions: async () => [],
      beginTransaction: async () => { began += 1; throw new Error("must not begin"); }
    }
  }), /unsupported or unsafe historical csx installation/);

  assert.equal(began, 0);
  assert.equal(await readFile(join(anchor, "user-owned.txt"), "utf8"), "preserve me\n");
  assert.equal(existsSync(join(root, ".csx-transactions")), false);
});

for (const drift of ["config", "payload"]) test(`historical ${drift} drift immediately before transaction begin is no-write`, async () => {
  const root = await temporary(`historical ${drift} drift `);
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  const family = HISTORICAL_INSTALLATION_FAMILIES[0];
  await seedHistoricalInstallation(anchor, family);
  const path = drift === "config"
    ? join(anchor, ".codex", "config.toml")
    : join(anchor, family.paths[0]);
  const changed = Buffer.from(`concurrent ${drift} bytes\n`);
  const driftingApi = {
    ...transactionApi,
    async beginTransaction(declaration) {
      await writeFile(path, changed);
      return beginTransaction(declaration);
    }
  };

  await assert.rejects(
    installCore({ scope: "project", cwd: anchor, transactionApi: driftingApi }),
    /historical transaction preimage changed/
  );

  assert.deepEqual(await readFile(path), changed);
  assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), false);
  for (const directory of ["bundles", "journals", "terminals", "bridges", "cleanup"]) {
    const entries = await readdir(join(root, ".csx-transactions", directory)).catch((error) =>
      error.code === "ENOENT" ? [] : Promise.reject(error)
    );
    assert.deepEqual(entries, []);
  }
});

for (const [id, boundary, exitCode] of [
  ["h21-3abc221", "all-preimage", 81],
  ["h23-a221623-fresh", "all-final", 82]
]) test(`historical install re-entry recovers ${boundary} ${id} bundle`, async () => {
  const root = await temporary(`historical install re-entry ${id} `);
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await seedHistoricalInstallation(anchor, HISTORICAL_INSTALLATION_FAMILIES.find((family) => family.id === id));

  assert.equal(await runExitCode(process.execPath, [recoveryWorker, "install", anchor, boundary]), exitCode);
  await installCore({ scope: "project", cwd: anchor });

  assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), true);
  assert.equal(existsSync(join(anchor, ".codex", ".csx-install-receipt.json")), false);
  assert.deepEqual(await readdir(join(root, ".csx-transactions", "bundles")), []);
});

for (const id of ["h21-3abc221", "h23-a221623-fresh"]) {
  for (const [boundary, exitCode] of [["all-preimage", 81], ["all-final", 82]]) {
    test(`same-root ${id} public re-entry recovers ${boundary}`, async () => {
      const root = await temporary(`same-root re-entry ${id} ${boundary} `);
      await runProcess("git", ["init", "-q", root]);
      const family = HISTORICAL_INSTALLATION_FAMILIES.find((candidate) => candidate.id === id);
      await seedHistoricalInstallation(root, family);

      assert.equal(await runExitCode(process.execPath, [recoveryWorker, "install", root, boundary]), exitCode);
      await installCore({ scope: "project", cwd: root });

      assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), true);
      assert.equal(existsSync(join(root, ".agents", "skills", "csx-deslop", "SKILL.md")), true);
      assert.deepEqual(await readdir(join(root, ".csx-transactions", "bundles")), []);
    });
  }
}

test("all-final historical-only H22 uninstall bundle re-entry cleans control without restoring removed files", async () => {
  const root = await temporary("all-final historical uninstall re-entry ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h22-9af4616");
  await seedHistoricalInstallation(anchor, family);

  assert.equal(await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, "all-final"]), 82);
  assert.equal(existsSync(join(anchor, ".codex", ".csx-install-receipt.json")), false);
  assert.deepEqual(await uninstallCore({ cwd: anchor }), { removed: true, scope: "project", root });
  assert.deepEqual(await readdir(join(root, ".csx-transactions", "bundles")), []);
  assert.equal(existsSync(join(anchor, family.paths[0])), false);
});

for (const [boundary, exitCode] of [["all-preimage", 81], ["all-final", 82]]) {
  test(`${boundary} project historical uninstall re-entry preserves a coexisting global install`, async () => {
    const home = await temporary(`historical uninstall global ${boundary} `);
    const root = await temporary(`historical uninstall project ${boundary} `);
    await runProcess("git", ["init", "-q", root]);
    const anchor = join(root, "nested");
    const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h22-9af4616");
    await installCore({ scope: "global", env: { HOME: home } });
    await seedHistoricalInstallation(anchor, family);
    const globalPaths = [
      join(home, ".codex", ".csx-install-receipt.json"),
      join(home, ".codex", "config.toml"),
      join(home, ".codex", "hooks", "csx-hook.mjs")
    ];
    const globalBefore = await Promise.all(globalPaths.map((path) => readFile(path)));

    assert.equal(
      await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, boundary]),
      exitCode
    );
    assert.deepEqual(await uninstallCore({ cwd: anchor, env: { HOME: home } }), {
      removed: true,
      scope: "project",
      root
    });

    assert.equal(existsSync(join(anchor, ".codex", ".csx-install-receipt.json")), false);
    assert.deepEqual(await Promise.all(globalPaths.map((path) => readFile(path))), globalBefore);
  });
}

const metadataTopologyAttacks = [
  ["arbitrary metadata participant", (bundle, metadata) => {
    const path = join(metadata.root, ".codex", "arbitrary-participant");
    bundle.participants.push({
      role: "metadata-participant",
      root: metadata.root,
      coordinationRoot: metadata.coordinationRoot,
      paths: [path],
      schema: { version: 1, type: "csx-metadata" }
    });
    addBundleAbsentPath(bundle, path);
  }],
  ["arbitrary metadata path", (bundle, metadata) => {
    const path = join(metadata.root, ".codex", "arbitrary-path");
    metadata.paths.push(path);
    metadata.paths.sort();
    addBundleAbsentPath(bundle, path);
  }],
  ["arbitrary metadata write", (bundle, metadata) => {
    const path = join(metadata.root, ".codex", "arbitrary-write");
    metadata.paths.push(path);
    metadata.paths.sort();
    addBundleAbsentPath(bundle, path);
    bundle.writeSet.push(path);
    bundle.writeSet.sort();
    bundle.finalEndpoints[path] = { state: "absent" };
  }],
  ["arbitrary final endpoint", (bundle, metadata) => {
    const path = join(metadata.root, ".codex", "arbitrary-final");
    metadata.paths.push(path);
    metadata.paths.sort();
    addBundleAbsentPath(bundle, path);
    bundle.writeSet.push(path);
    bundle.writeSet.sort();
    bundle.finalEndpoints[path] = { state: "absent" };
  }]
];

for (const [attack, mutate] of metadataTopologyAttacks) {
  test(`same-root re-signed bundle rejects ${attack} without target or control mutation`, async () => {
    const root = await temporary(`same-root metadata attack ${attack} `);
    await runProcess("git", ["init", "-q", root]);
    const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h21-3abc221");
    await seedHistoricalInstallation(root, family);
    assert.equal(await runExitCode(process.execPath, [recoveryWorker, "install", root, "all-preimage"]), 81);
    const bundlePath = await onlyBundlePath(root);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    const metadata = bundle.participants.find(({ role }) => role === "metadata-participant");
    mutate(bundle, metadata);
    resignBundle(bundle);
    await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
    const targetPaths = [join(root, family.paths[0]), join(root, ".codex", ".csx-install-receipt.json")];
    const targetBefore = await Promise.all(targetPaths.map((path) => readFile(path)));
    const controlBefore = await snapshotControlTree(root);

    await assert.rejects(
      installCore({ scope: "project", cwd: root }),
      (error) => error?.code === "recovery_required"
    );

    assert.deepEqual(await Promise.all(targetPaths.map((path) => readFile(path))), targetBefore);
    assert.deepEqual(await snapshotControlTree(root), controlBefore);
  });
}

const historicalBundleAttacks = [
  ["changed receipt field", (bundle, historical) => { historical.receipt.version = "forged"; }],
  ["changed config marker", (bundle, historical) => replaceBundlePreimage(
    bundle, historical.configPath, Buffer.from("forged config marker\n")
  )],
  ["changed payload byte", (bundle, historical) => replaceBundlePreimage(
    bundle,
    historical.paths.find((path) => path !== historical.configPath && path !== historical.receiptPath),
    Buffer.from("forged payload\n")
  )],
  ["changed path set", (bundle, historical) => {
    const path = join(historical.root, "extra");
    historical.paths.push(path);
    historical.paths.sort();
    historical.preimages[path] = { state: "absent" };
    bundle.authorizedPaths.push(path);
    bundle.authorizedPaths.sort();
    bundle.snapshotSet.push(path);
    bundle.snapshotSet.sort();
    bundle.preimages[path] = { state: "absent" };
  }],
  ["family mismatch", (bundle, historical) => {
    const other = historicalInstallationTemplate("h23-a221623-fresh", { root: historical.root });
    replaceBundlePreimage(bundle, historical.configPath, Buffer.from(other.config));
  }],
  ["root escape", (bundle, historical) => { historical.paths[0] = resolve(historical.root, "..", "escape"); }],
  ["canonical metadata mismatch", (bundle) => {
    const canonical = bundle.participants.find(({ role }) => role === "prospective-installation-target");
    canonical.configPath = join(canonical.root, ".codex", "forged.toml");
  }]
];

for (const [attack, mutate] of historicalBundleAttacks) {
  test(`bundle historical re-entry rejects ${attack} with no target or control cleanup`, async () => {
    const root = await temporary(`bundle historical ${attack} `);
    await runProcess("git", ["init", "-q", root]);
    const anchor = join(root, "nested");
    const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h21-3abc221");
    await seedHistoricalInstallation(anchor, family);
    assert.equal(await runExitCode(process.execPath, [recoveryWorker, "install", anchor, "all-preimage"]), 81);
    const bundlePath = await onlyBundlePath(root);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    const historical = bundle.participants.find(({ role }) => role === "historical-installation-target");
    mutate(bundle, historical);
    resignBundle(bundle);
    await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
    const before = await readFile(join(anchor, family.paths[0]));

    await assert.rejects(
      installCore({ scope: "project", cwd: anchor }),
      (error) => error?.code === "recovery_required"
    );

    assert.deepEqual(await readFile(join(anchor, family.paths[0])), before);
    assert.equal(existsSync(join(root, ".codex", ".csx-install-receipt.json")), false);
    assert.equal(existsSync(bundlePath), true);
  });
}

test("all-final historical bundle with an unknown family performs no cleanup", async () => {
  const root = await temporary("all-final unknown historical family ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  const family = HISTORICAL_INSTALLATION_FAMILIES.find(({ id }) => id === "h22-9af4616");
  await seedHistoricalInstallation(anchor, family);
  assert.equal(await runExitCode(process.execPath, [recoveryWorker, "uninstall", anchor, "all-final"]), 82);
  const bundlePath = await onlyBundlePath(root);
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const historical = bundle.participants.find(({ role }) => role === "historical-installation-target");
  replaceBundlePreimage(bundle, historical.configPath, Buffer.from("unknown historical family\n"));
  historical.preimages[historical.configPath] = bundle.preimages[historical.configPath];
  resignBundle(bundle);
  await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });

  await assert.rejects(uninstallCore({ cwd: anchor }), (error) => error?.code === "recovery_required");
  assert.equal(existsSync(join(anchor, family.paths[0])), false);
  assert.equal(existsSync(bundlePath), true);
});

test("historical and canonical mutations roll back atomically when the canonical receipt write fails", async () => {
  const root = await temporary("historical rollback ");
  await runProcess("git", ["init", "-q", root]);
  const anchor = join(root, "nested");
  await seedHistoricalInstallation(anchor, HISTORICAL_INSTALLATION_FAMILIES[0]);
  const historicalReceipt = join(anchor, ".codex", ".csx-install-receipt.json");
  const canonicalReceipt = join(root, ".codex", ".csx-install-receipt.json");
  const failingApi = {
    ...transactionApi,
    async beginTransaction(declaration) {
      const transaction = await transactionApi.beginTransaction(declaration);
      return {
        ...transaction,
        async write(path, data, options) {
          if (resolve(path) === resolve(canonicalReceipt)) throw new Error("forced canonical receipt failure");
          await transaction.write(path, data, options);
        }
      };
    }
  };

  await assert.rejects(
    installCore({ scope: "project", cwd: anchor, transactionApi: failingApi }),
    /forced canonical receipt failure/
  );
  assert.equal(existsSync(historicalReceipt), true);
  assert.equal(existsSync(canonicalReceipt), false);
  assert.match(await readFile(join(anchor, ".codex", "config.toml"), "utf8"), new RegExp(MANAGED_START));
});

test("nested symlink navigation and linked worktrees retain their physical canonical project root", async () => {
  const primary = await temporary("historical worktree primary ");
  await runProcess("git", ["init", "-q", primary]);
  await writeFile(join(primary, "seed.txt"), "seed\n");
  await runProcess("git", ["-C", primary, "-c", "user.name=Test", "-c", "user.email=test@example.com", "add", "seed.txt"]);
  await runProcess("git", ["-C", primary, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "seed"]);
  const linked = await temporary("historical linked ");
  await rm(linked, { recursive: true, force: true });
  await runProcess("git", ["-C", primary, "worktree", "add", "-q", "-b", "linked-test", linked]);
  const anchor = join(linked, "packages", "app");
  await seedHistoricalInstallation(anchor, HISTORICAL_INSTALLATION_FAMILIES[0]);
  const navigation = join(primary, "linked-anchor");
  await symlink(anchor, navigation);

  const result = await installCore({ scope: "project", cwd: navigation });

  assert.equal(result.root, linked);
  assert.equal(existsSync(join(linked, ".codex", ".csx-install-receipt.json")), true);
  assert.equal(existsSync(join(primary, ".codex", ".csx-install-receipt.json")), false);
});

async function seedHistoricalInstallation(root, family) {
  const snapshot = historicalInstallationTemplate(family.id, { root });
  for (const relativePath of family.paths) {
    const source = relativePath
      .replace(/^\.agents\/skills\//, "payload/skills/")
      .replace(/^\.codex\/agents\//, "payload/agents/")
      .replace(/^\.codex\/hooks\//, "payload/hooks/");
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    let data = await runProcess("git", ["show", `${family.commit}:${source}`], { encoding: null });
    const agent = /^\.codex\/agents\/(.+)\.toml$/.exec(relativePath)?.[1];
    const roles = snapshot.receipt.setupAgentMatrix?.agents ?? snapshot.receipt.setupAgentMatrix?.roles;
    if (agent && roles?.[agent]) {
      data = Buffer.from(data.toString("utf8")
        .replace(/^(\s*model\s*=\s*)"[^"]*"/m, `$1${JSON.stringify(roles[agent].model)}`)
        .replace(/^(\s*model_reasoning_effort\s*=\s*)"[^"]*"/m, `$1${JSON.stringify(roles[agent].reasoning)}`));
    }
    await writeFile(destination, data);
  }
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), snapshot.config);
  await writeFile(
    join(root, ".codex", ".csx-install-receipt.json"),
    `${JSON.stringify(snapshot.receipt, null, 2)}\n`
  );
}

function runProcess(command, args, { encoding = "utf8" } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`${command} failed (${code}): ${stderr}`));
      else {
        const data = Buffer.concat(stdout);
        resolvePromise(encoding === null ? data : data.toString(encoding));
      }
    });
  });
}

function runExitCode(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", resolvePromise);
  });
}

async function onlyBundlePath(root) {
  const directory = join(root, ".csx-transactions", "bundles");
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  return join(directory, entries[0]);
}

function replaceBundlePreimage(bundle, path, data) {
  const snapshot = {
    state: "present",
    data: data.toString("base64"),
    hash: createHash("sha256").update(data).digest("hex"),
    mode: bundle.preimages[path].mode
  };
  bundle.preimages[path] = snapshot;
  const participant = bundle.participants.find(({ paths }) => paths.includes(path));
  if (participant?.role === "historical-installation-target") participant.preimages[path] = snapshot;
}

function addBundleAbsentPath(bundle, path) {
  bundle.authorizedPaths.push(path);
  bundle.authorizedPaths.sort();
  bundle.snapshotSet.push(path);
  bundle.snapshotSet.sort();
  bundle.preimages[path] = { state: "absent" };
}

async function snapshotControlTree(root) {
  const control = join(root, ".csx-transactions");
  const snapshot = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else snapshot[path.slice(control.length)] = await readFile(path);
    }
  }
  await visit(control);
  return snapshot;
}

function resignBundle(bundle) {
  delete bundle.authorityHash;
  bundle.authorityHash = createHash("sha256").update(canonicalJson(bundle)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function temporary(prefix) {
  const root = await mkdtemp(join(tmpdir(), `csx-${prefix}`));
  roots.push(root);
  return resolve(root);
}

function installedLoopPaths(root, scope = "project") {
  const skillsRoot = scope === "global" ? join(root, "skills") : join(root, ".agents", "skills");
  return [
    resolve(join(skillsRoot, "csx-loop", "SKILL.md")),
    resolve(join(skillsRoot, "csx-loop", "agents", "openai.yaml"))
  ].sort();
}

async function makePreLoopInstallation(root, scope = "project") {
  const receiptPath = scope === "global"
    ? join(root, ".csx-install-receipt.json")
    : join(root, ".codex", ".csx-install-receipt.json");
  const loopPaths = installedLoopPaths(root, scope);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const currentLoopPaths = receipt.files
    .map((path) => resolve(path))
    .filter((path) => loopPaths.includes(path))
    .sort();
  assert.deepEqual(currentLoopPaths, loopPaths, "current-minus-pre-loop additions must be exactly two");
  assert.equal(new Set(currentLoopPaths).size, 2, "current-minus-pre-loop additions must be unique");
  await Promise.all(loopPaths.map((path) => rm(path)));
  receipt.files = receipt.files.filter((path) => !loopPaths.includes(resolve(path)));
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(receiptPath, receiptText);
  return { loopPaths, receiptPath, receipt, receiptText };
}

function recordingRecoveryApi(observedPaths, attempts) {
  const recover = async (root, authority, detailed) => {
    const participant = authority.participants[0];
    const attempt = {
      expectedFiles: [...participant.expectedFiles],
      additions: [...participant.additions],
      paths: [...participant.paths],
      recovered: false
    };
    const before = await fileStates(observedPaths);
    try {
      const result = detailed
        ? await recoverTransactionsDetailed(root, authority)
        : await recoverTransactions(root, authority);
      attempt.recovered = result.recovered ? result.recovered.length > 0 : result.length > 0;
      attempts.push(attempt);
      return result;
    } catch (error) {
      assert.deepEqual(await fileStates(observedPaths), before);
      attempt.errorCode = error.code;
      attempts.push(attempt);
      throw error;
    }
  };
  return {
    beginTransaction,
    recoverTransactions: (root, authority) => recover(root, authority, false),
    recoverTransactionsDetailed: (root, authority) => recover(root, authority, true)
  };
}

async function fileStates(paths) {
  return Promise.all([...new Set(paths.map((path) => resolve(path)))].sort().map(async (path) => {
    try {
      return [path, { state: "present", data: (await readFile(path)).toString("base64") }];
    } catch (error) {
      if (error.code === "ENOENT") return [path, { state: "absent" }];
      throw error;
    }
  }));
}

function runNodeModule(script, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
