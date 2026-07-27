import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  rm,
  stat
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existingInstallationTarget, metadataParticipant, prospectiveInstallationTarget } from "./installation-state.js";
import {
  UnsupportedHistoricalInstallationError,
  discoverHistoricalInstallation,
  proveHistoricalInstallation
} from "./historical-installations.js";
import { resolveProjectContext } from "./project-context.js";
import {
  beginTransaction,
  preflightTransaction,
  recoverHistoricalTransactions,
  recoverTransactions,
  recoverTransactionsDetailed,
  recoveryAuthorityFromDeclaration
} from "./transaction.js";
import {
  AGENT_NAMES,
  INSTALLED_AGENT_NAMES,
  LEGACY_VERIFIER_NAME,
  WORKFLOW_LEADER_NAMES,
  cloneMatrix,
  presetMatrix,
  upgradeLegacyMatrix
} from "./presets.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD_ROOT = join(PACKAGE_ROOT, "payload");
const RECEIPT = ".csx-install-receipt.json";
export const MANAGED_START = "# >>> csx managed >>>";
export const MANAGED_END = "# <<< csx managed <<<";
export const FEATURE_MANAGED_START = "# >>> csx feature default_mode_request_user_input >>>";
export const FEATURE_MANAGED_END = "# <<< csx feature default_mode_request_user_input <<<";
export const LEADER_MANAGED_START = "# >>> csx leader defaults >>>";
export const LEADER_MANAGED_END = "# <<< csx leader defaults <<<";
const DEFAULT_MODE_INPUT_FEATURE = "default_mode_request_user_input";
const SKILLS = [
  "csx-analyze",
  "csx-spec",
  "csx-plan",
  "csx-plan-pro",
  "csx-loop",
  "csx-start-goal",
  "csx-deslop",
  "csx-code-review"
];

export async function install({ scope, projectRoot, cwd = process.cwd(), env = process.env, transactionApi } = {}) {
  const transactions = transactionOperations(transactionApi);
  const projectMigration = scope === "project"
    ? await projectMigrationContext({ projectRoot, cwd })
    : null;
  const layout = await resolveLayout({ scope, projectRoot, cwd, env, projectMigration });
  const entries = await payloadEntries(layout);
  const receiptPath = join(layout.configRoot, RECEIPT);
  const expectedFiles = entries.map(({ destination }) => destination);
  const receiptCandidates = exactReceiptCandidates(layout, expectedFiles);
  await establishInstallationCoordination(transactions, layout, false);
  await recoverInstallationVariants(transactions, layout, receiptCandidates);
  const sameRootHistorical = projectMigration?.historical.find(({ root }) => root === layout.root);
  const existingTarget = sameRootHistorical
    ? { ...await historicalParticipant(sameRootHistorical), role: "existing-installation-target" }
    : await pathExists(receiptPath)
      ? await existingInstallationTargetForUpgrade(layout, receiptPath, receiptCandidates)
      : null;
  const historicalTargets = await Promise.all(projectMigration?.historical
    .filter(({ root }) => root !== layout.root)
    .map(historicalParticipant) ?? []);
  const version = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const receiptState = existingTarget
    ? { state: "present", data: Buffer.from(existingTarget.receiptSnapshot.data, "base64").toString("utf8") }
    : await readOptionalState(receiptPath);
  const oldReceipt = existingTarget?.receipt ?? parseReceipt(receiptState, receiptPath);
  if (oldReceipt && (oldReceipt.scope !== scope || resolve(oldReceipt.root) !== layout.root)) {
    throw new Error(`installation receipt does not match the requested ${scope} root: ${receiptPath}`);
  }
  const setupMatrix = normalizeReceiptSetupMatrix(oldReceipt?.setupAgentMatrix);
  const desiredMatrix = setupMatrix ?? presetMatrix("Balanced");
  await overlayReceiptAgentMatrix(entries, desiredMatrix);

  const configState = await readOptionalState(layout.configPath);
  const existingConfig = configState.data;
  validateMarkers(layout.configPath, existingConfig);
  validateFeatureMarkers(layout.configPath, existingConfig, oldReceipt);
  scanToml(existingConfig, layout.configPath);
  if (!oldReceipt && (
    existingConfig.includes(MANAGED_START) ||
    existingConfig.includes(FEATURE_MANAGED_START) ||
    existingConfig.includes(LEADER_MANAGED_START)
  )) {
    throw new Error(`refusing to adopt unmanaged csx configuration: ${layout.configPath}`);
  }
  validateAgentTables(layout.configPath, existingConfig, oldReceipt);
  await validateDestinations(entries, oldReceipt);

  const target = existingTarget ?? await prospectiveInstallationTarget({
    operation: "install",
    root: await nearestExistingSafeDirectory(layout.root),
    configPath: layout.configPath,
    receiptPath,
    payloadPaths: expectedFiles
  });
  const block = managedBlock(layout, entries);
  const rootConfig = restoreLeaderConfig(existingConfig, oldReceipt?.leaderConfig, layout.configPath);
  const configWithManagedBlock = replaceManagedBlock(rootConfig, block, layout.configPath);
  const feature = enableDefaultModeInput(configWithManagedBlock, layout.configPath, oldReceipt);
  const nextConfig = feature.config;
  const receipt = {
    version,
    scope,
    root: layout.root,
    configRoot: layout.configRoot,
    files: expectedFiles,
    installedAt: new Date().toISOString(),
    setupAgentMatrix: setupReceiptMatrix(desiredMatrix)
  };
  if (feature.state) receipt.featureConfig = feature.state;
  const removals = existingTarget
    ? existingTarget.receipt.files.filter((path) => !expectedFiles.includes(resolve(path)))
    : [];
  const expansionPaths = sameRootHistorical
    ? expectedFiles.filter((path) => !existingTarget.paths.includes(resolve(path)))
    : [];
  const expansion = expansionPaths.length
    ? { ...(await metadataParticipant({ root: layout.root, paths: expansionPaths })), coordinationRoot: layout.root }
    : null;
  const historicalMutations = historicalTargets.map(historicalRestoration);
  await applyTransaction(transactions, {
    operation: "install",
    participants: [
      { ...target, coordinationRoot: await installationCoordinationRoot(layout) },
      ...(expansion ? [expansion] : []),
      ...historicalTargets.map((participant) => ({ ...participant, coordinationRoot: layout.root }))
    ],
    snapshotSet: [
      ...transactionPaths(target),
      ...(expansion?.paths ?? []),
      ...historicalTargets.flatMap(transactionPaths)
    ],
    preflight: async () => assertStatesUnchanged([
      [layout.configPath, configState],
      [receiptPath, receiptState]
    ]),
    writes: [
      ...entries.map((entry) => ({ path: entry.destination, source: entry.source, data: entry.data, mode: entry.mode })),
      { path: layout.configPath, data: nextConfig },
      ...historicalMutations.flatMap(({ writes }) => writes),
      { path: receiptPath, data: `${JSON.stringify(receipt, null, 2)}\n` }
    ],
    removals: [...removals, ...historicalMutations.flatMap(({ removals }) => removals)]
  });
  return { ...layout, version };
}

export async function uninstall({ projectRoot, cwd = process.cwd(), env = process.env, transactionApi } = {}) {
  const transactions = transactionOperations(transactionApi);
  const migration = await projectMigrationContext({ projectRoot, cwd, allowMissingAnchor: true });
  const project = projectLayout(migration.root);
  const global = await globalLayout(env, false);
  const projectExpectedFiles = await receiptOwnedPaths(project);
  const globalExpectedFiles = await receiptOwnedPaths(global);
  const projectRecoveryCandidates = exactUninstallRecoveryCandidates(project, projectExpectedFiles);
  const globalRecoveryCandidates = exactUninstallRecoveryCandidates(global, globalExpectedFiles);
  const projectRecovery = await recoverExistingControlStoreVariants(
    transactions,
    project,
    projectRecoveryCandidates
  );
  const projectRecoveryStatus = uninstallRecoveryStatus(projectRecovery);
  const projectReceipt = await pathExists(join(project.configRoot, RECEIPT));
  assertRecoveryReceipt(projectRecoveryStatus, projectReceipt);
  if (projectRecoveryStatus.completed) {
    return { removed: true, scope: "project", root: project.root };
  }
  if (!projectReceipt && projectRecoveryStatus.opaque) {
    throw recoveryRequired("project recovery completed without authenticated endpoint detail");
  }
  const sameRootHistorical = migration.historical.some(({ root }) => root === project.root);
  if (sameRootHistorical || (!projectReceipt && migration.historical.length)) {
    const historicalTargets = await Promise.all(migration.historical.map(historicalParticipant));
    const historicalMutations = historicalTargets.map(historicalRestoration);
    await applyTransaction(transactions, {
      operation: "uninstall",
      participants: historicalTargets.map((participant) => ({
        ...participant,
        coordinationRoot: project.root
      })),
      snapshotSet: historicalTargets.flatMap(transactionPaths),
      writes: historicalMutations.flatMap(({ writes }) => writes),
      removals: historicalMutations.flatMap(({ removals }) => removals)
    });
    for (const target of historicalTargets) await removeEmptyParents(target.receipt.files, projectLayout(target.root));
    return { removed: true, scope: "project", root: project.root };
  }
  let globalRecoveryStatus;
  let globalReceipt;
  if (!projectReceipt) {
    await rejectUnmanagedProjectCollision(project);
    globalRecoveryStatus = uninstallRecoveryStatus(await recoverExistingControlStoreVariants(
      transactions,
      global,
      globalRecoveryCandidates
    ));
    globalReceipt = await pathExists(join(global.configRoot, RECEIPT));
    assertRecoveryReceipt(globalRecoveryStatus, globalReceipt);
    if (globalRecoveryStatus.completed) {
      return { removed: true, scope: "global", root: global.root };
    }
  }
  const candidate = projectReceipt ? project : global;
  const receiptPath = join(candidate.configRoot, RECEIPT);
  const candidateReceipt = projectReceipt || globalReceipt;
  if (!candidateReceipt) {
    if (candidate === global && globalRecoveryStatus?.opaque) {
      throw recoveryRequired("global recovery completed without authenticated endpoint detail");
    }
    return { removed: false };
  }
  const expectedFiles = candidate === project ? projectExpectedFiles : globalExpectedFiles;
  const receiptCandidates = exactReceiptCandidates(candidate, expectedFiles, { includeUpgradeAdditions: false });
  const target = await existingInstallationTargetForUpgrade(
    candidate,
    receiptPath,
    receiptCandidates
  );
  const ownedFiles = target.receipt.files.map((path) => resolve(path)).sort();
  const receipt = target.receipt;
  const receiptState = { state: "present", data: Buffer.from(target.receiptSnapshot.data, "base64").toString("utf8") };
  if (resolve(receipt.root) !== candidate.root || receipt.scope !== candidate.scope) {
    throw new Error(`refusing to use a mismatched installation receipt: ${receiptPath}`);
  }
  validateReceiptFiles(receipt, ownedFiles, receiptPath);
  const configState = await readOptionalState(candidate.configPath);
  const config = configState.data;
  validateMarkers(candidate.configPath, config);
  validateFeatureMarkers(candidate.configPath, config, receipt);
  const withoutManagedBlock = removeManagedBlock(config);
  const withoutFeature = restoreDefaultModeInput(withoutManagedBlock, receipt.featureConfig);
  const nextConfig = restoreLeaderConfig(withoutFeature, receipt.leaderConfig, candidate.configPath);
  const removals = [...ownedFiles, receiptPath];
  const writes = nextConfig === config ? [] : [{ path: candidate.configPath, data: nextConfig }];
  await applyTransaction(transactions, {
    operation: "uninstall",
    participants: [{ ...target, coordinationRoot: await installationCoordinationRoot(candidate) }],
    snapshotSet: transactionPaths(target),
    preflight: async () => assertStatesUnchanged([
      [candidate.configPath, configState],
      [receiptPath, receiptState]
    ]),
    writes,
    removals
  });
  await removeEmptyParents(ownedFiles, candidate);
  return { removed: true, scope: candidate.scope, root: candidate.root };
}

export async function projectMigrationPreflight({ projectRoot, cwd = process.cwd() } = {}) {
  const context = await projectMigrationContext({ projectRoot, cwd });
  return Object.freeze({
    root: context.root,
    source: context.source,
    historicalCount: context.historical.length
  });
}

async function resolveLayout({ scope, projectRoot, cwd, env, projectMigration }) {
  if (scope === "global") return globalLayout(env, true);
  if (scope !== "project") throw new Error("scope must be global or project.");
  const root = projectMigration?.root ?? resolve(projectRoot || cwd);
  let info;
  try {
    info = await stat(root);
  } catch (cause) {
    if (cause?.code === "ENOENT") info = null;
    else throw cause;
  }
  if (!info?.isDirectory()) {
    throw new Error(`project root does not exist or is not a directory: ${root}`);
  }
  return projectLayout(root);
}

async function globalLayout(env, createDefault) {
  const explicit = Boolean(env.CODEX_HOME);
  const root = resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"));
  if (explicit && createDefault && !await pathExists(root)) {
    throw new Error(`CODEX_HOME does not exist: ${root}`);
  }
  return {
    scope: "global",
    root,
    configRoot: root,
    configPath: join(root, "config.toml"),
    skillsRoot: join(root, "skills"),
    agentsRoot: join(root, "agents"),
    hooksRoot: join(root, "hooks"),
    createDefault
  };
}

function projectLayout(root) {
  root = resolve(root);
  return {
    scope: "project",
    root,
    configRoot: join(root, ".codex"),
    configPath: join(root, ".codex", "config.toml"),
    skillsRoot: join(root, ".agents", "skills"),
    agentsRoot: join(root, ".codex", "agents"),
    hooksRoot: join(root, ".codex", "hooks")
  };
}

async function projectMigrationContext({ projectRoot, cwd, allowMissingAnchor = false }) {
  const requestedAnchor = projectRoot ?? cwd;
  const requested = resolve(requestedAnchor);
  const anchor = await realpath(requested).catch((error) => {
    if (error?.code === "ENOENT" && allowMissingAnchor) return requested;
    if (error?.code === "ENOENT") throw new Error(`project root does not exist or is not a directory: ${requested}`);
    throw error;
  });
  if (!await pathExists(anchor)) {
    return Object.freeze({ root: anchor, source: "missing-fallback", anchor, historical: Object.freeze([]) });
  }
  let context;
  try {
    context = await resolveProjectContext({
      cwd: anchor,
      projectRoot,
      proveReceipt: async (candidate) => pathExists(join(candidate, ".codex", RECEIPT))
    });
  } catch (error) {
    if (!/cannot resolve a project root outside Git/.test(error.message)) throw error;
    context = await resolveProjectContext({ projectRoot: anchor });
  }
  const candidates = [];
  if (isWithin(context.root, anchor)) {
    for (let candidate = anchor; ; candidate = dirname(candidate)) {
      candidates.push(candidate);
      if (candidate === context.root) break;
    }
  } else {
    candidates.push(context.root);
  }
  const historical = [];
  for (const candidate of candidates.reverse()) {
    const receiptPath = join(candidate, ".codex", RECEIPT);
    let match;
    try {
      match = await discoverHistoricalInstallation({ root: candidate });
    } catch (error) {
      if (
        candidate === context.root &&
        error instanceof UnsupportedHistoricalInstallationError &&
        await looksLikeCanonicalReceipt(candidate, receiptPath)
      ) {
        continue;
      }
      throw error;
    }
    if (match) {
      historical.push(match);
      continue;
    }
    if (candidate !== context.root) await rejectManagedLookingAmbiguity(candidate);
  }
  return Object.freeze({ ...context, anchor, historical: Object.freeze(historical) });
}

async function looksLikeCanonicalReceipt(root, path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return false;
  try {
    const receipt = JSON.parse(text);
    if (!Array.isArray(receipt?.files) || resolve(receipt.root) !== resolve(root)) return false;
    const received = receipt.files.map((file) => resolve(file)).sort();
    const expected = await receiptOwnedPaths(projectLayout(root));
    const candidates = exactReceiptCandidates(projectLayout(root), expected, { includeUpgradeAdditions: false });
    return candidates.some(({ expectedFiles }) =>
      received.length === expectedFiles.length &&
      received.every((file, index) => file === expectedFiles[index])
    ) || (
      receipt.setupAgentMatrix?.version === 2 &&
      expected.every((file) => received.includes(file))
    );
  } catch {
    return false;
  }
}

async function rejectManagedLookingAmbiguity(root) {
  const configPath = join(root, ".codex", "config.toml");
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (text !== null && (
    text.includes(MANAGED_START) ||
    text.includes(FEATURE_MANAGED_START) ||
    text.includes(LEADER_MANAGED_START)
  )) {
    throw new UnsupportedHistoricalInstallationError(configPath);
  }
}

async function historicalParticipant(discovery) {
  const proof = await proveHistoricalInstallation({
    root: discovery.root,
    expectedId: discovery.id
  });
  const receiptSnapshot = proof.preimages[proof.receiptPath];
  const configData = Buffer.from(proof.preimages[proof.configPath].data, "base64").toString("utf8");
  return Object.freeze({
    role: "historical-installation-target",
    root: proof.root,
    configPath: proof.configPath,
    receiptPath: proof.receiptPath,
    receipt: structuredClone(proof.receipt),
    historicalConfig: configData,
    receiptSnapshot,
    preimages: structuredClone(proof.preimages),
    paths: Object.keys(proof.preimages).sort()
  });
}

function historicalRestoration(target) {
  validateMarkers(target.configPath, target.historicalConfig);
  validateFeatureMarkers(target.configPath, target.historicalConfig, target.receipt);
  const restored = restoreLeaderConfig(
    restoreDefaultModeInput(removeManagedBlock(target.historicalConfig), target.receipt.featureConfig),
    target.receipt.leaderConfig,
    target.configPath
  );
  return {
    writes: [{ path: target.configPath, data: restored }],
    removals: [...target.receipt.files, target.receiptPath]
  };
}
async function nearestExistingSafeDirectory(path) {
  let candidate = resolve(path);
  for (;;) {
    const info = await lstat(candidate).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`installation bootstrap root is not a safe directory: ${candidate}`);
      }
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`installation bootstrap root does not exist: ${path}`);
    candidate = parent;
  }
}

async function payloadEntries(layout) {
  const entries = [];
  for (const skill of SKILLS) {
    const sourceRoot = join(PAYLOAD_ROOT, "skills", skill);
    for (const relativePath of await walk(sourceRoot)) {
      entries.push({
        source: join(sourceRoot, relativePath),
        destination: join(layout.skillsRoot, skill, relativePath)
      });
    }
  }
  for (const file of (await readdir(join(PAYLOAD_ROOT, "agents"))).filter((x) => x.endsWith(".toml")).sort()) {
    entries.push({
      source: join(PAYLOAD_ROOT, "agents", file),
      destination: join(layout.agentsRoot, file)
    });
  }
  entries.push({
    source: join(PAYLOAD_ROOT, "hooks", "csx-hook.mjs"),
    destination: join(layout.hooksRoot, "csx-hook.mjs"),
    mode: 0o755
  });
  return entries;
}
export async function receiptOwnedPaths(layout) {
  return (await payloadEntries(layout)).map(({ destination }) => resolve(destination)).sort();
}

function exactReceiptCandidates(layout, expectedFiles, { includeUpgradeAdditions = true } = {}) {
  const current = expectedFiles.map((path) => resolve(path)).sort();
  if (current.length !== new Set(current).size) throw new Error("current payload destinations must be unique");
  const loopRoot = resolve(join(layout.skillsRoot, "csx-loop"));
  const loopDestinations = [
    resolve(join(loopRoot, "SKILL.md")),
    resolve(join(loopRoot, "agents", "openai.yaml"))
  ].sort();
  const currentLoopDestinations = current.filter((path) => isWithin(loopRoot, path));
  if (
    currentLoopDestinations.length !== 2
    || currentLoopDestinations.some((path, index) => path !== loopDestinations[index])
  ) {
    throw new Error("current-minus-pre-loop additions must be exactly the two csx-loop payload destinations");
  }
  const loopSet = new Set(loopDestinations);
  const leaderDestinations = [
    resolve(join(layout.agentsRoot, "csx-plan-leader.toml")),
    resolve(join(layout.agentsRoot, "csx-start-goal-leader.toml"))
  ].sort();
  const currentLeaderDestinations = current.filter((path) => leaderDestinations.includes(path));
  if (
    currentLeaderDestinations.length !== 2
    || currentLeaderDestinations.some((path, index) => path !== leaderDestinations[index])
  ) {
    throw new Error("current-minus-pre-leader additions must be exactly the two workflow leader definitions");
  }
  const leaderSet = new Set(leaderDestinations);
  const preLeader = current.filter((path) => !leaderSet.has(path));
  const preLoopCurrent = current.filter((path) => !loopSet.has(path));
  const preLoop = preLeader.filter((path) => !loopSet.has(path));
  const verifier = legacyVerifierPath(layout);
  const candidate = (name, receiptOwnedPaths) => {
    const expected = receiptOwnedPaths.map((path) => resolve(path)).sort();
    const owned = new Set(expected);
    const additions = includeUpgradeAdditions ? current.filter((path) => !owned.has(path)) : [];
    return { name, expectedFiles: expected, additions };
  };
  const candidates = [
    candidate("current", current),
    candidate("pre-leader", preLeader),
    candidate("pre-loop", preLoopCurrent),
    candidate("pre-loop-pre-leader", preLoop),
    candidate("current-verifier-legacy", [...current, verifier]),
    candidate("pre-leader-verifier-legacy", [...preLeader, verifier]),
    candidate("pre-loop-verifier-legacy", [...preLoopCurrent, verifier]),
    candidate("pre-loop-pre-leader-verifier-legacy", [...preLoop, verifier])
  ];
  for (const entry of candidates) {
    const expectedAdditionCount = includeUpgradeAdditions
      ? entry.name.startsWith("pre-loop-pre-leader")
        ? 4
        : entry.name.startsWith("pre-loop")
          ? 2
        : entry.name.startsWith("pre-leader")
          ? 2
          : 0
      : 0;
    if (entry.additions.length !== expectedAdditionCount) {
      throw new Error(`invalid ${entry.name} receipt additions`);
    }
  }
  return candidates;
}

function exactUninstallRecoveryCandidates(layout, expectedFiles) {
  const uninstallCandidates = exactReceiptCandidates(layout, expectedFiles, { includeUpgradeAdditions: false });
  const upgradeOnlyCandidates = exactReceiptCandidates(layout, expectedFiles)
    .filter(({ additions }) => additions.length > 0);
  return [...uninstallCandidates, ...upgradeOnlyCandidates];
}

function legacyVerifierPath(layout) {
  return resolve(join(layout.agentsRoot, `${LEGACY_VERIFIER_NAME}.toml`));
}

async function existingInstallationTargetForUpgrade(layout, receiptPath, candidates) {
  let mismatch;
  for (const { expectedFiles, additions } of candidates) {
    try {
      return await existingInstallationTarget({
        root: layout.root,
        configPath: layout.configPath,
        receiptPath,
        expectedFiles,
        additions
      });
    } catch (error) {
      if (!/receipt does not match the installed package paths/.test(error.message)) throw error;
      mismatch ??= error;
    }
  }
  throw mismatch;
}

function validateReceiptFiles(receipt, expectedFiles, receiptPath) {
  const received = receipt.files.map((file) => {
    if (typeof file !== "string") throw new Error(`receipt contains an invalid installation path: ${receiptPath}`);
    return resolve(file);
  }).sort();
  if (received.length !== new Set(received).size) {
    throw new Error(`receipt contains duplicate installation paths: ${receiptPath}`);
  }
  if (received.length !== expectedFiles.length || received.some((file, index) => file !== expectedFiles[index])) {
    throw new Error(`receipt does not match the installed package paths: ${receiptPath}`);
  }
}
async function overlayReceiptAgentMatrix(entries, matrix) {
  cloneMatrix(matrix);
  for (const agent of INSTALLED_AGENT_NAMES) {
    const entry = entries.find(({ destination }) => basename(destination) === `${agent}.toml`);
    if (!entry) throw new Error(`missing payload agent definition: ${agent}.`);
    const source = await readFile(entry.source, "utf8");
    const role = WORKFLOW_LEADER_NAMES.includes(agent) ? "leader" : agent;
    const data = overlayAgentDefinition(source, matrix[role], agent);
    delete entry.source;
    entry.data = data;
  }
}

export function normalizeReceiptSetupMatrix(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid setupAgentMatrix in installation receipt.");
  }
  try {
    if (value.version === 2 && Object.keys(value).length === 2) return cloneMatrix(value.roles);
    if (value.version === 1 && Object.keys(value).length === 2) return upgradeLegacyMatrix(value.agents);
  } catch {
    throw new Error("invalid setupAgentMatrix in installation receipt.");
  }
  throw new Error("invalid setupAgentMatrix in installation receipt.");
}

export function setupReceiptMatrix(matrix) {
  return { version: 2, roles: cloneMatrix(matrix) };
}

function overlayAgentDefinition(source, { model, reasoning }, agent) {
  const replace = (key, value, text) => {
    const expression = new RegExp(`^(\\s*${key}\\s*=\\s*)"(?:[^"\\\\\\r\\n]|\\\\.)*"`, "m");
    if (!expression.test(text)) throw new Error(`invalid payload agent definition: ${agent}.`);
    return text.replace(expression, `$1${JSON.stringify(value)}`);
  };
  return replace("model_reasoning_effort", reasoning, replace("model", model, source));
}

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      for (const child of await walk(join(root, rel))) output.push(join(rel, child));
    } else if (entry.isFile()) output.push(rel);
  }
  return output.sort();
}

async function validateDestinations(entries, receipt) {
  const owned = new Set(receipt?.files?.map((file) => resolve(file)) || []);
  for (const { destination } of entries) {
    if (await pathExists(destination) && !owned.has(resolve(destination))) {
      throw new Error(`refusing to overwrite an unmanaged file: ${destination}`);
    }
  }
}

async function rejectUnmanagedProjectCollision(layout) {
  const config = await readFile(layout.configPath, "utf8").catch((cause) => {
    if (cause?.code === "ENOENT") return "";
    throw cause;
  });
  if (
    config.includes(MANAGED_START) ||
    config.includes(FEATURE_MANAGED_START) ||
    config.includes(LEADER_MANAGED_START)
  ) {
    throw new Error(`refusing to select global scope over unmanaged project csx configuration: ${layout.configPath}`);
  }
}
function validateMarkers(configPath, content) {
  validateMarkerPair(configPath, content, MANAGED_START, MANAGED_END, "csx managed");
  validateMarkerPair(configPath, content, LEADER_MANAGED_START, LEADER_MANAGED_END, "csx leader defaults");
}

function validateMarkerPair(configPath, content, start, end, label) {
  const starts = occurrences(content, start);
  const ends = occurrences(content, end);
  if (starts !== ends || starts > 1 || (starts === 1 && content.indexOf(end) < content.indexOf(start))) {
    throw new Error(`broken ${label} markers in ${configPath}`);
  }
}

function validateFeatureMarkers(configPath, content, receipt) {
  validateMarkerPair(
    configPath,
    content,
    FEATURE_MANAGED_START,
    FEATURE_MANAGED_END,
    `csx feature ${DEFAULT_MODE_INPUT_FEATURE}`
  );
  if (!content.includes(FEATURE_MANAGED_START)) return;
  if (!receipt?.featureConfig || receipt.featureConfig.key !== DEFAULT_MODE_INPUT_FEATURE) {
    throw new Error(`managed ${DEFAULT_MODE_INPUT_FEATURE} marker has no matching receipt metadata in ${configPath}`);
  }
  const previousLine = receipt.featureConfig.previousLine;
  const previousAssignment = new RegExp(
    `^[ \\t]*(?:features[ \\t]*\\.[ \\t]*)?(?:${DEFAULT_MODE_INPUT_FEATURE}|"${DEFAULT_MODE_INPUT_FEATURE}")[ \\t]*=[ \\t]*false[ \\t]*(?:#.*)?$`
  );
  if (previousLine !== null && (typeof previousLine !== "string" || !previousAssignment.test(previousLine))) {
    throw new Error(`managed ${DEFAULT_MODE_INPUT_FEATURE} receipt metadata is invalid in ${configPath}`);
  }
  const region = managedRegion(content, FEATURE_MANAGED_START, FEATURE_MANAGED_END);
  const assignment = new RegExp(
    `^[ \\t]*(?:features[ \\t]*\\.[ \\t]*)?${DEFAULT_MODE_INPUT_FEATURE}[ \\t]*=[ \\t]*true[ \\t]*(?:#.*)?$`,
    "gm"
  );
  if ([...region.text.matchAll(assignment)].length !== 1) {
    throw new Error(`managed ${DEFAULT_MODE_INPUT_FEATURE} value is invalid in ${configPath}`);
  }
}

function validateAgentTables(configPath, content, receipt) {
  if (receipt) return;
  const document = scanToml(content, configPath);
  for (const name of agentNames()) {
    if (document.headers.some(({ path }) => samePath(path, ["agents", name]))) {
      throw new Error(`unmanaged [agents.${name}] already exists in ${configPath}`);
    }
  }
}

function managedBlock(layout, entries) {
  const hookPath = entries.find(({ destination }) => basename(destination) === "csx-hook.mjs").destination;
  const lines = [MANAGED_START];
  for (const name of agentNames()) {
    lines.push(`[agents.${name}]`);
    lines.push(`config_file = ${tomlString(`./agents/${name}.toml`)}`);
    lines.push("");
  }
  appendLifecycleHook(lines, hookPath, {
    event: "UserPromptSubmit",
    operation: "user-prompt-submit",
    scope: layout.scope,
    root: layout.root,
    statusMessage: "(csx) Routing explicit workflow"
  });
  lines.push("");
  appendLifecycleHook(lines, hookPath, {
    event: "SessionStart",
    operation: "session-start",
    scope: layout.scope,
    root: layout.root,
    statusMessage: "(csx) Restoring workflow"
  });
  lines.push("");
  appendLifecycleHook(lines, hookPath, {
    event: "SubagentStop",
    operation: "subagent-stop",
    scope: layout.scope,
    root: layout.root,
    statusMessage: "(csx) Checking workflow lifecycle"
  });
  lines.push(MANAGED_END);
  return lines.join("\n");
}

function appendLifecycleHook(lines, hookPath, { event, operation, scope, root, statusMessage }) {
  lines.push(`[[hooks.${event}]]`);
  lines.push("hooks = [{ type = \"command\", " +
    `command = ${tomlString(posixCommand(hookPath, operation, scope, root))}, ` +
    `commandWindows = ${tomlString(windowsCommand(hookPath, operation, scope, root))}, ` +
    `timeout = 3, statusMessage = ${tomlString(statusMessage)} }]`);
}

function replaceManagedBlock(content, block, configPath) {
  validateMarkers(configPath, content);
  const without = removeManagedBlock(content).trimEnd();
  return `${without}${without ? "\n\n" : ""}${block}\n`;
}

function removeManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  if (start < 0) return content;
  const end = content.indexOf(MANAGED_END, start) + MANAGED_END.length;
  return `${content.slice(0, start)}${content.slice(end)}`.replace(/^\s*\n/, "").replace(/\n{3,}/g, "\n\n");
}

function enableDefaultModeInput(content, configPath, receipt) {
  if (content.includes(FEATURE_MANAGED_START)) {
    return { config: content, state: receipt.featureConfig };
  }

  const document = scanToml(content, configPath);
  const topLevelFeatures = document.assignments.filter(({ table, key }) =>
    table.length === 0 && samePath(key, ["features"])
  );
  if (topLevelFeatures.length) {
    throw new Error(
      `cannot safely manage ${DEFAULT_MODE_INPUT_FEATURE} in inline features table: ${configPath}`
    );
  }

  const tables = document.headers.filter(({ path, array }) => samePath(path, ["features"]) && !array);
  if (tables.length > 1) throw new Error(`duplicate [features] tables in ${configPath}`);
  const table = tables[0] || null;
  const tableAssignment = document.assignments.filter(({ table: owner, key }) =>
    table && samePath(owner, ["features"]) && samePath(key, [DEFAULT_MODE_INPUT_FEATURE])
  );
  const dottedAssignment = document.assignments.filter(({ table: owner, key }) =>
    owner.length === 0 && samePath(key, ["features", DEFAULT_MODE_INPUT_FEATURE])
  );
  const matching = [...tableAssignment, ...dottedAssignment];
  if (matching.length > 1) throw new Error(`duplicate ${DEFAULT_MODE_INPUT_FEATURE} settings in ${configPath}`);

  const assignment = matching[0];
  if (assignment) {
    if (assignment.value !== "true" && assignment.value !== "false") {
      throw new Error(`${DEFAULT_MODE_INPUT_FEATURE} must be a boolean in ${configPath}`);
    }
    if (assignment.value === "true") return { config: content, state: null };
    return {
      config: replaceSlice(content, assignment.start, assignment.end, `${featureBlock(assignment.table.length === 0)}\n`),
      state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: assignment.line }
    };
  }

  if (table) {
    return {
      config: insertBlock(content, table.bodyEnd, featureBlock(false)),
      state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: null }
    };
  }

  const sibling = document.assignments.find(({ table: owner, key }) =>
    owner.length === 0 && key[0] === "features" && key.length > 1
  );
  if (sibling) {
    return {
      config: insertBlock(content, sibling.start, featureBlock(true)),
      state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: null }
    };
  }

  const subtable = document.headers.find(({ path }) => path[0] === "features" && path.length > 1);
  const block = `${FEATURE_MANAGED_START}\n[features]\n${DEFAULT_MODE_INPUT_FEATURE} = true\n${FEATURE_MANAGED_END}`;
  return {
    config: insertBlock(content, subtable?.start ?? content.length, block, !subtable),
    state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: null }
  };
}

function restoreDefaultModeInput(content, state) {
  if (!content.includes(FEATURE_MANAGED_START)) return content;
  const region = managedRegion(content, FEATURE_MANAGED_START, FEATURE_MANAGED_END);
  const replacement = state?.previousLine ? `${state.previousLine}\n` : "";
  return `${content.slice(0, region.lineStart)}${replacement}${content.slice(region.lineEnd)}`
    .replace(/^\s*\n/, "")
    .replace(/\n{3,}/g, "\n\n");
}

function restoreLeaderConfig(content, state, configPath) {
  if (!content.includes(LEADER_MANAGED_START)) {
    if (state) throw new Error(`managed leader defaults are missing in ${configPath}`);
    return content;
  }
  validateLeaderReceipt(state, configPath);
  const region = managedRegion(content, LEADER_MANAGED_START, LEADER_MANAGED_END);
  const lines = ["model", "model_reasoning_effort"]
    .map((key) => state.originals[key])
    .filter((line) => line !== null);
  const after = content.slice(region.lineEnd);
  const replacement = lines.length
    ? `${lines.join("\n")}${after.startsWith("\n") ? "" : "\n"}`
    : "";
  return `${content.slice(0, region.lineStart)}${replacement}${after}`
    .replace(/^\s*\n/, "")
    .replace(/\n{3,}/g, "\n\n");
}

function validateLeaderReceipt(state, configPath) {
  if (
    !state ||
    state.version !== 1 ||
    !state.originals ||
    typeof state.originals !== "object" ||
    Array.isArray(state.originals) ||
    Object.keys(state.originals).length !== 2
  ) {
    throw new Error(`managed leader receipt metadata is invalid in ${configPath}`);
  }
  for (const key of ["model", "model_reasoning_effort"]) {
    const line = state.originals[key];
    if (line === null) continue;
    if (typeof line !== "string") throw new Error(`managed leader receipt metadata is invalid in ${configPath}`);
    const assignment = parseTomlAssignment(withoutTomlComment(line).trim());
    if (!assignment || !samePath(assignment.key, [key])) {
      throw new Error(`managed leader receipt metadata is invalid in ${configPath}`);
    }
    decodeTomlString(assignment.value, configPath);
  }
}

function decodeTomlString(value, configPath) {
  const source = withoutTomlComment(value).trim();
  let decoded;
  try {
    if (source.startsWith("\"") && source.endsWith("\"")) decoded = JSON.parse(source);
    else if (source.startsWith("'") && source.endsWith("'")) decoded = source.slice(1, -1);
  } catch {
    decoded = null;
  }
  if (typeof decoded !== "string" || !decoded) {
    throw new Error(`leader model settings must be non-empty TOML strings in ${configPath}`);
  }
  return decoded;
}

function scanToml(content, configPath) {
  const lines = [...content.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)]
    .filter((match) => match[0] !== "" || match.index < content.length);
  const document = { headers: [], assignments: [] };
  const topLevelKeys = new Set();
  let table = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index];
    const start = match.index + (match.index === 0 && content.charCodeAt(0) === 0xfeff ? 1 : 0);
    let line = content.slice(start, match.index + match[0].length).replace(/[\r\n]+$/, "");
    const code = withoutTomlComment(line).trim();
    if (!code) continue;
    const header = parseTomlHeader(code);
    if (header) {
      table = header.path;
      const previous = document.headers.at(-1);
      if (previous) previous.bodyEnd = start;
      const entry = { ...header, start, bodyEnd: content.length };
      if (document.headers.some(({ path, array }) => !array && !header.array && samePath(path, header.path))) {
        throw new Error(`duplicate TOML table in ${configPath}`);
      }
      document.headers.push(entry);
      continue;
    }
    const assignment = parseTomlAssignment(code);
    if (!assignment) throw new Error(`cannot safely parse TOML before mutation: ${configPath}`);
    const lineEnd = match.index + match[0].length;
    if (multilineDelimiter(assignment.value)) {
      const delimiter = multilineDelimiter(assignment.value);
      const opening = line.indexOf(delimiter);
      let closed = hasMultilineClose(line, delimiter, opening + delimiter.length);
      while (!closed && ++index < lines.length) {
        const next = lines[index];
        const text = content.slice(next.index, next.index + next[0].length);
        line += text;
        closed = hasMultilineClose(text, delimiter, 0);
      }
      if (!closed) {
        throw new Error(`unterminated multiline TOML string in ${configPath}`);
      }
    }
    if (table.length === 0) {
      const signature = assignment.key.join("\u0000");
      if (topLevelKeys.has(signature)) throw new Error(`duplicate top-level TOML key in ${configPath}`);
      topLevelKeys.add(signature);
    }
    document.assignments.push({
      ...assignment,
      table: [...table],
      start,
      end: lineEnd,
      line: content.slice(start, lineEnd).replace(/[\r\n]+$/, ""),
      value: withoutTomlComment(assignment.value).trim()
    });
  }
  return document;
}

function withoutTomlComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "\"" && character === "\\") {
      index += 1;
    } else if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "#") {
      return value.slice(0, index);
    }
  }
  return value;
}

function parseTomlHeader(code) {
  const array = code.startsWith("[[");
  if (!code.startsWith("[")) return null;
  const close = array ? "]]" : "]";
  if (!code.endsWith(close)) return null;
  const body = code.slice(array ? 2 : 1, -close.length).trim();
  const path = parseTomlKey(body);
  return path ? { path, array } : null;
}

function parseTomlAssignment(code) {
  let quote = null;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (quote === "\"" && character === "\\") index += 1;
    else if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === "=") {
      const key = parseTomlKey(code.slice(0, index).trim());
      return key ? { key, value: code.slice(index + 1) } : null;
    }
  }
  return null;
}

function parseTomlKey(value) {
  const parts = [];
  let index = 0;
  while (index < value.length) {
    while (/[ \t]/.test(value[index])) index += 1;
    if (value[index] === "\"" || value[index] === "'") {
      const quote = value[index++];
      let part = "";
      for (; index < value.length && value[index] !== quote; index += 1) {
        if (quote === "\"" && value[index] === "\\") return null;
        part += value[index];
      }
      if (value[index++] !== quote) return null;
      parts.push(part);
    } else {
      const match = /^[A-Za-z0-9_-]+/.exec(value.slice(index));
      if (!match) return null;
      parts.push(match[0]);
      index += match[0].length;
    }
    while (/[ \t]/.test(value[index])) index += 1;
    if (index === value.length) return parts;
    if (value[index++] !== ".") return null;
  }
  return null;
}

function multilineDelimiter(value) {
  const trimmed = value.trimStart();
  return trimmed.startsWith("\"\"\"") ? "\"\"\"" : trimmed.startsWith("'''") ? "'''" : null;
}
function hasMultilineClose(value, delimiter, from) {
  for (let index = value.indexOf(delimiter, from); index >= 0; index = value.indexOf(delimiter, index + delimiter.length)) {
    const preceding = value.slice(0, index).match(/\\+$/)?.[0].length || 0;
    const quoteRun = value.slice(index).match(/^"+|^'+/)?.[0].length || 0;
    if (preceding % 2 === 0 && quoteRun === delimiter.length) return true;
  }
  return false;
}


function samePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function featureBlock(dotted) {
  const key = dotted ? `features.${DEFAULT_MODE_INPUT_FEATURE}` : DEFAULT_MODE_INPUT_FEATURE;
  return `${FEATURE_MANAGED_START}\n${key} = true\n${FEATURE_MANAGED_END}`;
}

function insertBlock(content, index, block, separate = false) {
  const before = content.slice(0, index);
  const after = content.slice(index);
  const leading = before && !before.endsWith("\n") ? "\n" : "";
  const spacing = separate && before ? "\n" : "";
  const trailing = after && !after.startsWith("\n") ? "\n" : "";
  return `${before}${leading}${spacing}${block}\n${trailing}${after}`;
}

function replaceSlice(content, start, end, replacement) {
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function managedRegion(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start) + endMarker.length;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const newline = content.indexOf("\n", end);
  const lineEnd = newline < 0 ? content.length : newline + 1;
  return {
    lineStart,
    lineEnd,
    text: content.slice(lineStart, lineEnd)
  };
}
function installationRecoveryAuthority(layout, { expectedFiles, additions }) {
  const receiptPath = join(layout.configRoot, RECEIPT);
  const paths = [...new Set([
    ...expectedFiles,
    ...additions,
    layout.configPath,
    receiptPath
  ].map((path) => resolve(path)))].sort();
  const preimages = Object.fromEntries(paths.map((path) => [path, { state: "absent" }]));
  const participant = {
    role: "prospective-installation-target",
    root: layout.root,
    coordinationRoot: layout.root,
    configPath: layout.configPath,
    receiptPath,
    paths,
    preimages,
    expectedFiles,
    additions
  };
  return recoveryAuthorityFromDeclaration({
    coordinationRoots: [layout.root],
    participants: [participant],
    snapshotSet: paths,
    operationEndpoints: "installation-receipts"
  });
}

function transactionOperations(transactionApi) {
  if (transactionApi === undefined) {
    return { beginTransaction, recoverHistoricalTransactions, recoverTransactions, recoverTransactionsDetailed };
  }
  if (!transactionApi || typeof transactionApi.beginTransaction !== "function" || typeof transactionApi.recoverTransactions !== "function") {
    throw new Error("transactionApi must provide beginTransaction and recoverTransactions");
  }
  return { ...transactionApi, recoverHistoricalTransactions };
}
async function recoverInstallationTransactions(transactions, layout, authority, allowHistorical = true) {
  if (layout.scope === "global" && !await pathExists(layout.root)) return;
  const root = await installationCoordinationRoot(layout);
  try {
    return await transactions.recoverTransactions(root, authority);
  } catch (error) {
    if (!allowHistorical
      || !isRetryableRecoveryAuthorityError(error)
      || typeof transactions.recoverHistoricalTransactions !== "function") throw error;
    return transactions.recoverHistoricalTransactions(root, authority);
  }
}
async function recoverInstallationVariants(transactions, layout, candidates) {
  let mismatch;
  for (const candidate of candidates) {
    try {
      return await recoverInstallationTransactions(
        transactions,
        layout,
        installationRecoveryAuthority(layout, candidate),
        false
      );
    } catch (error) {
      if (!isRetryableRecoveryAuthorityError(error)) throw error;
      mismatch = error;
    }
  }
  if (typeof transactions.recoverHistoricalTransactions === "function") {
    const root = await installationCoordinationRoot(layout);
    for (const candidate of candidates) {
      try {
        return await transactions.recoverHistoricalTransactions(
          root,
          installationRecoveryAuthority(layout, candidate)
        );
      } catch (error) {
        if (!isRetryableRecoveryAuthorityError(error)) throw error;
        mismatch = error;
      }
    }
  }
  throw mismatch;
}
async function recoverExistingControlStore(transactions, layout, authority, allowHistorical = true) {
  if (!await pathExists(layout.root) || !await pathExists(join(layout.root, ".csx-transactions"))) return;
  try {
    if (typeof transactions.recoverTransactionsDetailed === "function") {
      const result = await transactions.recoverTransactionsDetailed(layout.root, authority);
      return { ...result, recoveryKind: "normal-detailed" };
    }
    return {
      recovered: await transactions.recoverTransactions(layout.root, authority),
      recoveryKind: "legacy"
    };
  } catch (error) {
    if (!allowHistorical
      || !isRetryableRecoveryAuthorityError(error)
      || typeof transactions.recoverHistoricalTransactions !== "function") throw error;
    return {
      ...await transactions.recoverHistoricalTransactions(layout.root, authority),
      recoveryKind: "historical-summary"
    };
  }
}
function uninstallRecoveryStatus(recovery) {
  if (recovery === undefined) return { completed: false, opaque: false };
  if (!isPlainRecord(recovery)
    || !isDenseStringArray(recovery.recovered)
    || new Set(recovery.recovered).size !== recovery.recovered.length) {
    throw recoveryRequired("malformed transaction recovery result");
  }
  const opaque = recovery.recovered.length > 0;
  const hasTransactions = Object.hasOwn(recovery, "transactions");
  const hasOperation = Object.hasOwn(recovery, "operation");
  const hasBoundary = Object.hasOwn(recovery, "boundary");
  if (recovery.recoveryKind === "legacy") {
    if (hasTransactions || hasOperation || hasBoundary) {
      throw recoveryRequired("malformed legacy transaction recovery result");
    }
    return { completed: false, opaque };
  }
  if (!["normal-detailed", "historical-summary"].includes(recovery.recoveryKind)) {
    throw recoveryRequired("transaction recovery result has no provenance");
  }
  if (recovery.recoveryKind === "normal-detailed" && !hasTransactions) {
    throw recoveryRequired("normal transaction recovery result has no outcomes");
  }
  if (recovery.recoveryKind === "historical-summary" && hasTransactions) {
    throw recoveryRequired("historical transaction recovery result has unexpected outcomes");
  }
  if (hasTransactions && !Array.isArray(recovery.transactions)) {
    throw recoveryRequired("malformed transaction recovery outcomes");
  }
  if (hasOperation !== hasBoundary) {
    throw recoveryRequired("incomplete transaction recovery summary");
  }
  if (hasOperation
    && (!["install", "uninstall"].includes(recovery.operation)
      || !["all-preimage", "all-final"].includes(recovery.boundary))) {
    throw recoveryRequired("malformed transaction recovery summary");
  }
  if (!hasTransactions) {
    if (!hasOperation || recovery.recovered.length !== 1) {
      throw recoveryRequired("historical transaction recovery summary requires one recovered id");
    }
    return {
      completed: recovery.operation === "uninstall" && recovery.boundary === "all-final",
      opaque: false,
      operation: recovery.operation,
      boundary: recovery.boundary,
      kind: recovery.recoveryKind
    };
  }
  if (recovery.transactions.length > 1) throw recoveryRequired("ambiguous transaction recovery outcomes");
  if (recovery.transactions.length === 0) {
    if (hasOperation || hasBoundary) throw recoveryRequired("inconsistent transaction recovery summary");
    return { completed: false, opaque };
  }
  const [transaction] = recovery.transactions;
  if (!isPlainRecord(transaction)
    || typeof transaction.id !== "string"
    || transaction.id.length === 0
    || !["install", "uninstall"].includes(transaction.operation)
    || !["all-preimage", "all-final"].includes(transaction.boundary)
    || recovery.recovered.length !== 1
    || recovery.recovered[0] !== transaction.id) {
    throw recoveryRequired("malformed transaction recovery outcome");
  }
  if ((hasOperation || hasBoundary)
    && (!hasOperation
      || !hasBoundary
      || recovery.operation !== transaction.operation
      || recovery.boundary !== transaction.boundary)) {
    throw recoveryRequired("inconsistent transaction recovery summary");
  }
  return {
    completed: transaction.operation === "uninstall" && transaction.boundary === "all-final",
    opaque: false,
    operation: transaction.operation,
    boundary: transaction.boundary,
    kind: recovery.recoveryKind
  };
}
function assertRecoveryReceipt(recovery, receiptPresent) {
  if (recovery.kind !== "normal-detailed") return;
  if ((recovery.operation === "install" && recovery.boundary === "all-final")
    || (recovery.operation === "uninstall" && recovery.boundary === "all-preimage")) {
    if (!receiptPresent) throw recoveryRequired("transaction recovery outcome disagrees with receipt endpoint");
  }
  if (recovery.operation === "uninstall"
    && recovery.boundary === "all-final"
    && receiptPresent) {
    throw recoveryRequired("transaction recovery outcome disagrees with receipt endpoint");
  }
}
function isDenseStringArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)
      || typeof value[index] !== "string"
      || value[index].length === 0) return false;
  }
  return true;
}
function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function recoveryRequired(message) {
  const error = new Error(message);
  error.code = "recovery_required";
  return error;
}
async function recoverExistingControlStoreVariants(transactions, layout, candidates) {
  let mismatch;
  for (const candidate of candidates) {
    try {
      return await recoverExistingControlStore(
        transactions,
        layout,
        installationRecoveryAuthority(layout, candidate),
        false
      );
    } catch (error) {
      if (!isRetryableRecoveryAuthorityError(error)) throw error;
      mismatch = error;
    }
  }
  if (typeof transactions.recoverHistoricalTransactions === "function") {
    for (const candidate of candidates) {
      try {
        return {
          ...await transactions.recoverHistoricalTransactions(
            layout.root,
            installationRecoveryAuthority(layout, candidate)
          ),
          recoveryKind: "historical-summary"
        };
      } catch (error) {
        if (!isRetryableRecoveryAuthorityError(error)) throw error;
        mismatch = error;
      }
    }
  }
  throw mismatch;
}
function isRetryableRecoveryAuthorityError(error) {
  return error?.code === "recovery_required" && !error?.authorizedRecoveryBundle;
}

async function establishInstallationCoordination(transactions, layout, recover = true) {
  if (layout.scope !== "global") {
    if (recover) await recoverInstallationTransactions(transactions, layout);
    return;
  }
  if (!await pathExists(layout.root)) {
    const authority = await nearestExistingSafeDirectory(dirname(layout.root));
    await preflightTransaction({
      coordinationRoots: [authority],
      snapshotSet: [join(layout.root, ".csx-root-preflight")]
    });
    if (await pathExists(layout.root)) {
      throw new Error(`installation root changed during bootstrap preflight: ${layout.root}`);
    }
    await mkdir(layout.root, { mode: 0o700 });
  }
  if (recover) await recoverInstallationTransactions(transactions, layout);
}

async function installationCoordinationRoot(layout) {
  return layout.root;
}

async function assertStatesUnchanged(states) {
  for (const [path, expected] of states) {
    const current = await readOptionalState(path);
    if (current.state !== expected.state || current.data !== expected.data) {
      throw new Error(`installation state changed before transaction authority: ${path}`);
    }
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function transactionPaths(target) {
  return [...new Set([...target.paths, target.configPath, target.receiptPath].map((path) => resolve(path)))].sort();
}

async function applyTransaction(transactions, { operation, participants, snapshotSet, preflight, writes = [], removals = [] }) {
  if (!Array.isArray(participants) || participants.length === 0) throw new Error("install transaction requires participants");
  const plannedWrites = await Promise.all(writes.map(async (item) => {
    const path = resolve(item.path);
    const data = item.data === undefined ? await readFile(item.source) : item.data;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const info = item.mode === undefined
      ? await stat(path).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))
      : null;
    return { path, data: buffer, mode: item.mode ?? (info ? info.mode & 0o777 : 0o600) };
  }));
  const removalPaths = removals.map((path) => resolve(path));
  const mutationPaths = [...plannedWrites.map(({ path }) => path), ...removalPaths];
  if (new Set(mutationPaths).size !== mutationPaths.length) throw new Error("install transaction mutations must be unique");
  const writeSet = [...mutationPaths].sort();
  const declaredPaths = participants.flatMap(({ paths }) => paths.map((path) => resolve(path)));
  const sortedDeclaredPaths = [...declaredPaths].sort();
  const normalizedSnapshotSet = snapshotSet.map((path) => resolve(path)).sort();
  if (
    new Set(declaredPaths).size !== declaredPaths.length ||
    normalizedSnapshotSet.length !== sortedDeclaredPaths.length ||
    normalizedSnapshotSet.some((path, index) => path !== sortedDeclaredPaths[index])
  ) {
    throw new Error("install transaction snapshotSet must exactly match participant authority");
  }
  const finalEndpoints = Object.fromEntries([
    ...plannedWrites.map(({ path, data, mode }) => [path, {
      state: "present",
      data: data.toString("base64"),
      hash: createHash("sha256").update(data).digest("hex"),
      mode
    }]),
    ...removalPaths.map((path) => [path, { state: "absent" }])
  ]);
  const coordinationRoots = [...new Set(participants.map(({ coordinationRoot, root }) => coordinationRoot ?? root))];
  const recoveryAuthority = recoveryAuthorityFromDeclaration({
    coordinationRoots,
    participants,
    snapshotSet: normalizedSnapshotSet,
    operationEndpoints: "installation-receipts"
  });
  const transaction = await transactions.beginTransaction({
    operation,
    coordinationRoots,
    recoveryAuthority,
    participants,
    snapshotSet: normalizedSnapshotSet,
    writeSet,
    finalEndpoints
  });
  try {
    await preflight?.();
    const receiptPaths = new Set(participants
      .filter(({ receiptPath }) => receiptPath)
      .map(({ receiptPath }) => resolve(receiptPath)));
    const canonicalReceiptPath = resolve(participants.find(({ role }) =>
      role === "prospective-installation-target" || role === "existing-installation-target"
    )?.receiptPath ?? "");
    for (const item of plannedWrites.filter(({ path }) => !receiptPaths.has(path))) {
      await transaction.write(item.path, item.data, { mode: item.mode });
    }
    for (const path of removalPaths.filter((path) => !receiptPaths.has(path))) await transaction.remove(path);
    for (const item of plannedWrites.filter(({ path }) =>
      receiptPaths.has(path) && path !== canonicalReceiptPath
    )) {
      await transaction.write(item.path, item.data, { mode: item.mode });
    }
    for (const path of removalPaths.filter((path) =>
      receiptPaths.has(path) && path !== canonicalReceiptPath
    )) await transaction.remove(path);
    for (const item of plannedWrites.filter(({ path }) => path === canonicalReceiptPath)) {
      await transaction.write(item.path, item.data, { mode: item.mode });
    }
    for (const path of removalPaths.filter((path) => path === canonicalReceiptPath)) {
      await transaction.remove(path);
    }
    await transaction.commit();
  } catch (error) {
    const cleanupErrors = [];
    try { await transaction.rollback(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    try { await transaction.close?.(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], "install transaction failed and cleanup was incomplete", { cause: error });
    }
    throw error;
  }
}


function parseReceipt(state, path) {
  if (state.state === "absent") return null;
  try {
    const parsed = JSON.parse(state.data);
    if (!parsed || !Array.isArray(parsed.files)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`invalid csx installation receipt: ${path}`);
  }
}

async function readOptionalState(path) {
  try {
    return { state: "present", data: await readFile(path, "utf8") };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "absent", data: "" };
    throw error;
  }
}

async function removeEmptyParents(files, layout) {
  const stops = new Set([layout.root, layout.configRoot, layout.skillsRoot, layout.agentsRoot, layout.hooksRoot]);
  const directories = [...new Set(files.map(dirname))].sort((a, b) => b.length - a.length);
  for (let directory of directories) {
    while (isWithin(layout.root, directory) && directory !== layout.root) {
      let contents;
      try {
        contents = await readdir(directory);
      } catch (cause) {
        if (cause?.code === "ENOENT") break;
        throw cause;
      }
      if (contents.length) break;
      await rmdir(directory);
      if (stops.has(directory)) break;
      directory = dirname(directory);
    }
  }
}

function isWithin(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function agentNames() {
  return INSTALLED_AGENT_NAMES;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function posixCommand(path, operation, scope, root) {
  return `node ${shellQuote(path)} ${operation} --authority-scope ${scope} ` +
    `--authority-root ${shellQuote(root)}`;
}

function windowsQuote(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function windowsCommand(path, operation, scope, root) {
  return `node ${windowsQuote(path)} ${operation} --authority-scope ${scope} ` +
    `--authority-root ${windowsQuote(root)}`;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}
