import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { spawn } from "node:child_process";
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
import { AGENT_NAMES, LEGACY_VERIFIER_NAME, presetMatrix } from "../lib/presets.js";
import {
  __setTransactionTestHooks,
  beginTransaction as beginRealTransaction,
  recoverTransactions as recoverRealTransactions
} from "../lib/transaction.js";

const roots = [];

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

test("global install applies Balanced Leader while preserving the original for uninstall", async () => {
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
  assert.equal(existsSync(join(codex, "agents", `${LEGACY_VERIFIER_NAME}.toml`)), false);
  const config = await readFile(join(codex, "config.toml"), "utf8");
  assert.match(config, new RegExp(LEADER_MANAGED_START));
  assert.match(config, new RegExp(LEADER_MANAGED_END));
  assert.match(config, /model = "gpt-5\.6-luna"/);
  assert.match(config, /model_reasoning_effort = "max"/);
  assert.doesNotMatch(config, /model = "example"/);
  assert.match(config, new RegExp(MANAGED_START));
  assert.match(config, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.doesNotMatch(config, /\[agents\.csx-verifier\]/);
  assert.match(config, /\[features\]\ndefault_mode_request_user_input = true/);

  await uninstall({ cwd: join(home, "unrelated"), env: { HOME: home } });
  assert.equal(await readFile(join(codex, "config.toml"), "utf8"), 'model = "example"\n');
});

test("repeat install migrates an exact legacy verifier receipt and restores the old Leader on uninstall", async () => {
  const root = await temporary("legacy verifier migration ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  const verifierPath = join(root, ".codex", "agents", `${LEGACY_VERIFIER_NAME}.toml`);
  await install({ scope: "project", projectRoot: root });

  const leaderRegion = new RegExp(
    `${escapeRegExp(LEADER_MANAGED_START)}[\\s\\S]*?${escapeRegExp(LEADER_MANAGED_END)}\\n*`
  );
  let config = (await readFile(configPath, "utf8")).replace(
    leaderRegion,
    'model = "legacy-user-model"\nmodel_reasoning_effort = "high"\n\n'
  );
  config = config.replace(
    "[[hooks.UserPromptSubmit]]",
    `[agents.${LEGACY_VERIFIER_NAME}]\nconfig_file = "./agents/${LEGACY_VERIFIER_NAME}.toml"\n\n[[hooks.UserPromptSubmit]]`
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
  assert.match(upgradedConfig, /model = "gpt-5\.6-luna"/);
  assert.match(upgradedConfig, /model_reasoning_effort = "max"/);
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
    windowsCommand("C:\\Users\\Test User\\csx\\hook.mjs"),
    'node "C:\\Users\\Test User\\csx\\hook.mjs" user-prompt-submit'
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
          calls[0].writes.push(path);
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
  assert.equal(writes.at(-1), receiptPath);
  assert.deepEqual(Object.keys(declaration.participants[0].preimages).sort(), [...declaration.snapshotSet].sort());
  assert.equal(declaration.participants[0].preimages[receiptPath].state, "absent");
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

test("pre-loop upgrade recovers additions, config, and receipt after forced process death", { skip: process.platform !== "linux" }, async () => {
  const root = await temporary("pre-loop forced-death ");
  const configPath = join(root, ".codex", "config.toml");
  await install({ scope: "project", projectRoot: root });
  const {
    loopPaths,
    receiptPath,
    receiptText: preLoopReceiptText
  } = await makePreLoopInstallation(root);
  const preLoopConfig = await readFile(configPath, "utf8");
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
  const interruptedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(interruptedReceipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);

  const recoveryAttempts = [];
  const recoveryApi = recordingRecoveryApi(
    [...interruptedReceipt.files, configPath, receiptPath],
    recoveryAttempts
  );
  let observedRecoveredPreimage = false;
  const restoreHooks = __setTransactionTestHooks({
    async beforeManifest() {
      assert.equal(loopPaths.every((path) => !existsSync(path)), true);
      assert.equal(await readFile(configPath, "utf8"), preLoopConfig);
      assert.equal(await readFile(receiptPath, "utf8"), preLoopReceiptText);
      observedRecoveredPreimage = true;
    }
  });
  try {
    await installCore({ scope: "project", projectRoot: root, transactionApi: recoveryApi });
  } finally {
    restoreHooks();
  }

  assert.deepEqual(recoveryAttempts.map(({ recovered }) => recovered), [false, true]);
  assert.equal(recoveryAttempts[0].errorCode, "recovery_required");
  assert.deepEqual(recoveryAttempts[0].paths, recoveryAttempts[1].paths);
  assert.deepEqual(recoveryAttempts[0].additions, []);
  assert.equal(loopPaths.every((path) => recoveryAttempts[0].expectedFiles.includes(path)), true);
  assert.deepEqual(recoveryAttempts[1].additions, loopPaths);
  assert.equal(loopPaths.every((path) => !recoveryAttempts[1].expectedFiles.includes(path)), true);
  assert.equal(observedRecoveredPreimage, true);
  assert.equal(loopPaths.every((path) => existsSync(path)), true);
  const recoveredReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(recoveredReceipt.files.filter((path) => loopPaths.includes(resolve(path))).sort(), loopPaths);
  assert.equal(loopPaths.every((path) => recoveredReceipt.files.filter((owned) => resolve(owned) === path).length === 1), true);

  await uninstallCore({ projectRoot: root });
  assert.equal(loopPaths.every((path) => !existsSync(path)), true);
});

test("direct pre-loop uninstall recovers its exact no-additions split after forced process death", { skip: process.platform !== "linux" }, async () => {
  const root = await temporary("pre-loop uninstall forced-death ");
  const configPath = join(root, ".codex", "config.toml");
  const keepPath = join(root, ".codex", "agents", "keep.toml");
  await install({ scope: "project", projectRoot: root });
  const {
    loopPaths,
    receiptPath,
    receipt: preLoopReceipt,
    receiptText: preLoopReceiptText
  } = await makePreLoopInstallation(root);
  const preLoopConfig = await readFile(configPath, "utf8");
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
  let observedRecoveredPreimage = false;
  const restoreHooks = __setTransactionTestHooks({
    async beforeManifest({ operation, participants }) {
      assert.equal(operation, "uninstall");
      assert.deepEqual(participants[0].additions, []);
      assert.equal(loopPaths.every((path) => !participants[0].paths.includes(path)), true);
      assert.equal(preLoopReceipt.files.every((path) => existsSync(path)), true);
      assert.equal(loopPaths.every((path) => !existsSync(path)), true);
      assert.equal(await readFile(configPath, "utf8"), preLoopConfig);
      assert.equal(await readFile(receiptPath, "utf8"), preLoopReceiptText);
      observedRecoveredPreimage = true;
    }
  });
  let removed;
  try {
    removed = await uninstallCore({ projectRoot: root, transactionApi: recoveryApi });
  } finally {
    restoreHooks();
  }

  assert.equal(removed.removed, true);
  assert.deepEqual(recoveryAttempts.map(({ recovered }) => recovered), [false, true]);
  assert.equal(recoveryAttempts[0].errorCode, "recovery_required");
  assert.equal(recoveryAttempts.every(({ additions }) => additions.length === 0), true);
  assert.equal(loopPaths.every((path) => recoveryAttempts[0].expectedFiles.includes(path)), true);
  assert.equal(loopPaths.every((path) => !recoveryAttempts[1].expectedFiles.includes(path)), true);
  assert.equal(observedRecoveredPreimage, true);
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
  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /model = "saved-model"/);
  assert.match(config, /model_reasoning_effort = "saved-effort"/);
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
  return {
    beginTransaction: beginRealTransaction,
    async recoverTransactions(root, authority) {
      const participant = authority.participants[0];
      const attempt = {
        expectedFiles: [...participant.expectedFiles],
        additions: [...participant.additions],
        paths: [...participant.paths],
        recovered: false
      };
      const before = await fileStates(observedPaths);
      try {
        const recovered = await recoverRealTransactions(root, authority);
        attempt.recovered = recovered.length > 0;
        attempts.push(attempt);
        return recovered;
      } catch (error) {
        assert.deepEqual(await fileStates(observedPaths), before);
        attempt.errorCode = error.code;
        attempts.push(attempt);
        throw error;
      }
    }
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
