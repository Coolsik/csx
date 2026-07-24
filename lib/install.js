import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rmdir,
  rm,
  stat
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existingInstallationTarget, metadataParticipant, prospectiveInstallationTarget } from "./installation-state.js";
import { beginTransaction, preflightTransaction, recoverTransactions, recoveryAuthorityFromDeclaration } from "./transaction.js";
import { AGENT_NAMES, cloneMatrix } from "./presets.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD_ROOT = join(PACKAGE_ROOT, "payload");
const RECEIPT = ".csx-install-receipt.json";
export const MANAGED_START = "# >>> csx managed >>>";
export const MANAGED_END = "# <<< csx managed <<<";
export const FEATURE_MANAGED_START = "# >>> csx feature default_mode_request_user_input >>>";
export const FEATURE_MANAGED_END = "# <<< csx feature default_mode_request_user_input <<<";
const DEFAULT_MODE_INPUT_FEATURE = "default_mode_request_user_input";
const SKILLS = [
  "csx-analyze",
  "csx-spec",
  "csx-plan",
  "csx-plan-pro",
  "csx-start-goal",
  "csx-deslop",
  "csx-code-review"
];

export async function install({ scope, projectRoot, cwd = process.cwd(), env = process.env, transactionApi } = {}) {
  const transactions = transactionOperations(transactionApi);
  const layout = await resolveLayout({ scope, projectRoot, cwd, env });
  const entries = await payloadEntries(layout);
  const receiptPath = join(layout.configRoot, RECEIPT);
  await establishInstallationCoordination(transactions, layout, false);
  await recoverInstallationTransactions(
    transactions,
    layout,
    installationRecoveryAuthority(layout, entries.map(({ destination }) => destination))
  );
  const existingTarget = await pathExists(receiptPath)
    ? await existingInstallationTarget({
      root: layout.root,
      configPath: layout.configPath,
      receiptPath,
      expectedFiles: entries.map(({ destination }) => destination)
    })
    : null;
  const version = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const receiptState = existingTarget
    ? { state: "present", data: Buffer.from(existingTarget.receiptSnapshot.data, "base64").toString("utf8") }
    : await readOptionalState(receiptPath);
  const oldReceipt = existingTarget?.receipt ?? parseReceipt(receiptState, receiptPath);
  if (oldReceipt && (oldReceipt.scope !== scope || resolve(oldReceipt.root) !== layout.root)) {
    throw new Error(`installation receipt does not match the requested ${scope} root: ${receiptPath}`);
  }
  await overlayReceiptAgentMatrix(entries, oldReceipt);

  const configState = await readOptionalState(layout.configPath);
  const existingConfig = configState.data;
  validateMarkers(layout.configPath, existingConfig);
  validateFeatureMarkers(layout.configPath, existingConfig, oldReceipt);
  scanToml(existingConfig, layout.configPath);
  if (!oldReceipt && (existingConfig.includes(MANAGED_START) || existingConfig.includes(FEATURE_MANAGED_START))) {
    throw new Error(`refusing to adopt unmanaged csx configuration: ${layout.configPath}`);
  }
  validateAgentTables(layout.configPath, existingConfig, oldReceipt);
  await validateDestinations(entries, oldReceipt);

  const target = existingTarget ?? await prospectiveInstallationTarget({
    operation: "install",
    root: await nearestExistingSafeDirectory(layout.root),
    configPath: layout.configPath,
    receiptPath,
    payloadPaths: entries.map(({ destination }) => destination)
  });
  const block = managedBlock(layout, entries);
  const configWithManagedBlock = replaceManagedBlock(existingConfig, block, layout.configPath);
  const feature = enableDefaultModeInput(configWithManagedBlock, layout.configPath, oldReceipt);
  const nextConfig = feature.config;
  const receipt = {
    version,
    scope,
    root: layout.root,
    configRoot: layout.configRoot,
    files: entries.map(({ destination }) => destination),
    installedAt: new Date().toISOString()
  };
  if (feature.state) receipt.featureConfig = feature.state;
  if (oldReceipt?.setupAgentMatrix) receipt.setupAgentMatrix = oldReceipt.setupAgentMatrix;
  await applyTransaction(transactions, {
    operation: "install",
    participant: { ...target, coordinationRoot: await installationCoordinationRoot(layout) },
    snapshotSet: transactionPaths(target),
    preflight: async () => assertStatesUnchanged([
      [layout.configPath, configState],
      [receiptPath, receiptState]
    ]),
    writes: [
      ...entries.map((entry) => ({ path: entry.destination, source: entry.source, data: entry.data, mode: entry.mode })),
      { path: layout.configPath, data: nextConfig },
      { path: receiptPath, data: `${JSON.stringify(receipt, null, 2)}\n` }
    ]
  });
  return { ...layout, version };
}

export async function uninstall({ projectRoot, cwd = process.cwd(), env = process.env, transactionApi } = {}) {
  const transactions = transactionOperations(transactionApi);
  const project = await projectLayoutForUninstall(projectRoot, cwd);
  const global = await globalLayout(env, false);
  const projectExpectedFiles = await receiptOwnedPaths(project);
  const globalExpectedFiles = await receiptOwnedPaths(global);
  await recoverExistingControlStore(transactions, project, installationRecoveryAuthority(project, projectExpectedFiles));
  const projectReceipt = await pathExists(join(project.configRoot, RECEIPT));
  if (!projectReceipt) {
    await rejectUnmanagedProjectCollision(project);
    await recoverExistingControlStore(transactions, global, installationRecoveryAuthority(global, globalExpectedFiles));
  }
  const candidate = projectReceipt ? project : global;
  const receiptPath = join(candidate.configRoot, RECEIPT);
  if (!await pathExists(receiptPath)) return { removed: false };
  const expectedFiles = candidate === project ? projectExpectedFiles : globalExpectedFiles;
  const target = await existingInstallationTarget({
    root: candidate.root,
    configPath: candidate.configPath,
    receiptPath,
    expectedFiles
  });
  const receipt = target.receipt;
  const receiptState = { state: "present", data: Buffer.from(target.receiptSnapshot.data, "base64").toString("utf8") };
  if (resolve(receipt.root) !== candidate.root || receipt.scope !== candidate.scope) {
    throw new Error(`refusing to use a mismatched installation receipt: ${receiptPath}`);
  }
  validateReceiptFiles(receipt, expectedFiles, receiptPath);
  const configState = await readOptionalState(candidate.configPath);
  const config = configState.data;
  validateMarkers(candidate.configPath, config);
  validateFeatureMarkers(candidate.configPath, config, receipt);
  const withoutManagedBlock = removeManagedBlock(config);
  const nextConfig = restoreDefaultModeInput(withoutManagedBlock, receipt.featureConfig);
  const removals = [...expectedFiles, receiptPath];
  const writes = nextConfig === config ? [] : [{ path: candidate.configPath, data: nextConfig }];
  await applyTransaction(transactions, {
    operation: "uninstall",
    participant: { ...target, coordinationRoot: await installationCoordinationRoot(candidate) },
    snapshotSet: transactionPaths(target),
    preflight: async () => assertStatesUnchanged([
      [candidate.configPath, configState],
      [receiptPath, receiptState]
    ]),
    writes,
    removals
  });
  await removeEmptyParents(expectedFiles, candidate);
  return { removed: true, scope: candidate.scope, root: candidate.root };
}

async function resolveLayout({ scope, projectRoot, cwd, env }) {
  if (scope === "global") return globalLayout(env, true);
  if (scope !== "project") throw new Error("scope must be global or project.");
  const root = resolve(projectRoot || cwd);
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

async function projectLayoutForUninstall(projectRoot, cwd) {
  return projectLayout(resolve(projectRoot || cwd));
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
async function overlayReceiptAgentMatrix(entries, receipt) {
  if (receipt?.setupAgentMatrix === undefined) return;
  if (
    !receipt.setupAgentMatrix ||
    receipt.setupAgentMatrix.version !== 1 ||
    typeof receipt.setupAgentMatrix !== "object" ||
    Array.isArray(receipt.setupAgentMatrix)
  ) {
    throw new Error("invalid setupAgentMatrix in installation receipt.");
  }
  const matrix = cloneMatrix(receipt.setupAgentMatrix.agents);
  for (const agent of AGENT_NAMES) {
    const entry = entries.find(({ destination }) => basename(destination) === `${agent}.toml`);
    if (!entry) throw new Error(`missing payload agent definition: ${agent}.`);
    const source = await readFile(entry.source, "utf8");
    const data = overlayAgentDefinition(source, matrix[agent], agent);
    delete entry.source;
    entry.data = data;
  }
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
  if (config.includes(MANAGED_START) || config.includes(FEATURE_MANAGED_START)) {
    throw new Error(`refusing to select global scope over unmanaged project csx configuration: ${layout.configPath}`);
  }
}
function validateMarkers(configPath, content) {
  validateMarkerPair(configPath, content, MANAGED_START, MANAGED_END, "csx managed");
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
  const posix = `node ${shellQuote(hookPath)} user-prompt-submit`;
  const windows = windowsCommand(hookPath);
  const lines = [MANAGED_START];
  for (const name of agentNames()) {
    lines.push(`[agents.${name}]`);
    lines.push(`config_file = ${tomlString(`./agents/${name}.toml`)}`);
    lines.push("");
  }
  lines.push("[[hooks.UserPromptSubmit]]");
  lines.push("hooks = [{ type = \"command\", " +
    `command = ${tomlString(posix)}, commandWindows = ${tomlString(windows)}, ` +
    "timeout = 3, statusMessage = \"(csx) Checking skill routing\" }]");
  lines.push(MANAGED_END);
  return lines.join("\n");
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
function installationRecoveryAuthority(layout, expectedFiles) {
  const receiptPath = join(layout.configRoot, RECEIPT);
  const paths = [...new Set([...expectedFiles, layout.configPath, receiptPath].map((path) => resolve(path)))].sort();
  const preimages = Object.fromEntries(paths.map((path) => [path, { state: "absent" }]));
  const participant = {
    role: "prospective-installation-target",
    root: layout.root,
    coordinationRoot: layout.root,
    configPath: layout.configPath,
    receiptPath,
    paths,
    preimages
  };
  return recoveryAuthorityFromDeclaration({
    coordinationRoots: [layout.root],
    participants: [participant],
    snapshotSet: paths
  });
}

function transactionOperations(transactionApi) {
  if (transactionApi === undefined) return { beginTransaction, recoverTransactions };
  if (!transactionApi || typeof transactionApi.beginTransaction !== "function" || typeof transactionApi.recoverTransactions !== "function") {
    throw new Error("transactionApi must provide beginTransaction and recoverTransactions");
  }
  return transactionApi;
}
async function recoverInstallationTransactions(transactions, layout, authority) {
  if (layout.scope === "global" && !await pathExists(layout.root)) return;
  await transactions.recoverTransactions(await installationCoordinationRoot(layout), authority);
}
async function recoverExistingControlStore(transactions, layout, authority) {
  if (!await pathExists(layout.root) || !await pathExists(join(layout.root, ".csx-transactions"))) return;
  await transactions.recoverTransactions(layout.root, authority);
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

async function applyTransaction(transactions, { operation, participant, snapshotSet, preflight, writes = [], removals = [] }) {
  const writeSet = [...new Set([...writes.map(({ path }) => resolve(path)), ...removals.map((path) => resolve(path))])].sort();
  const transaction = await transactions.beginTransaction({
    operation,
    participants: [participant],
    snapshotSet,
    writeSet
  });
  try {
    await preflight?.();
    for (const item of writes) {
      const data = item.data === undefined ? await readFile(item.source) : item.data;
      await transaction.write(item.path, data, { mode: item.mode });
    }
    for (const path of removals) await transaction.remove(path);
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
  return [
    "csx-analyst",
    "csx-architect",
    "csx-code-reviewer",
    "csx-critic",
    "csx-executor",
    "csx-explorer",
    "csx-planner",
    "csx-verifier"
  ];
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function windowsQuote(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function windowsCommand(path) {
  return `node ${windowsQuote(path)} user-prompt-submit`;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}
