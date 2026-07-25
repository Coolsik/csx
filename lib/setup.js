import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beginTransaction, recoverTransactions, recoveryAuthorityFromDeclaration } from "./transaction.js";
import { existingInstallationTarget, metadataParticipant, RECEIPT_NAME } from "./installation-state.js";
import { receiptOwnedPaths } from "./install.js";
import { AGENT_NAMES, cloneMatrix, presetMatrix, validateMatrix } from "./presets.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CUSTOM_PRESETS_FILE = "csx-model-presets.json";

export function setupLayout({ cwd = process.cwd(), env = process.env } = {}) {
  const projectRoot = resolve(cwd);
  const project = {
    scope: "project",
    root: projectRoot,
    configRoot: join(projectRoot, ".codex"),
    configPath: join(projectRoot, ".codex", "config.toml"),
    skillsRoot: join(projectRoot, ".agents", "skills"),
    agentsRoot: join(projectRoot, ".codex", "agents"),
    hooksRoot: join(projectRoot, ".codex", "hooks")
  };
  const globalRoot = resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"));
  const global = {
    scope: "global",
    root: globalRoot,
    configRoot: globalRoot,
    configPath: join(globalRoot, "config.toml"),
    skillsRoot: join(globalRoot, "skills"),
    agentsRoot: join(globalRoot, "agents"),
    hooksRoot: join(globalRoot, "hooks")
  };
  return { project, global };
}
export function codexModelContext(layout, { env = process.env } = {}) {
  return {
    cwd: layout.root,
    env: { ...env, CODEX_HOME: setupLayout({ env }).global.root }
  };
}
export async function requestUniqueCustomPresetName(requestName, existingNames, onDuplicate = () => {}) {
  const normalizedNames = new Set(existingNames.map((name) => {
    if (typeof name !== "string") throw new Error("custom preset names are invalid.");
    return name.trim().toLowerCase();
  }));
  while (true) {
    const requested = await requestName();
    const name = typeof requested === "string" ? requested.trim() : "";
    if (!name) continue;
    if (!normalizedNames.has(name.toLowerCase())) return name;
    onDuplicate(name);
  }
}

/** Project wins only when its csx receipt exists; an unmanaged project config is never bypassed. */
export function selectSetupScope(options = {}) {
  const { project, global } = setupLayout(options);
  const probe = options.statSync ?? statSync;
  try {
    probe(join(project.configRoot, RECEIPT_NAME));
    return project;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    probe(project.configPath);
  } catch (error) {
    if (error?.code === "ENOENT") return global;
    throw error;
  }
  throw new Error(`refusing to bypass unmanaged project Codex configuration: ${project.configPath}`);
}

export async function readAgentMatrix(agentsRoot) {
  const matrix = {};
  for (const name of AGENT_NAMES) matrix[name] = parseAgent(await readFile(join(agentsRoot, `${name}.toml`), "utf8"), name);
  return matrix;
}

export async function payloadAgentMatrix() { return readAgentMatrix(join(PACKAGE_ROOT, "payload", "agents")); }

/** Read-only exact probe of global custom presets. */
export async function readCustomPresets({ env = process.env } = {}) {
  const global = setupLayout({ env }).global;
  const path = join(global.root, CUSTOM_PRESETS_FILE);
  const text = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (text === null) return { path, hash: null, presets: {} };
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error(`invalid custom preset file: ${path}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1 || !parsed.presets || typeof parsed.presets !== "object" || Array.isArray(parsed.presets)) {
    throw new Error(`invalid custom preset file: ${path}`);
  }
  const names = new Set();
  for (const [name, matrix] of Object.entries(parsed.presets)) {
    const normalized = name.trim().toLowerCase();
    if (!name.trim() || ["low", "medium", "high", "custom"].includes(normalized) || names.has(normalized)) throw new Error(`invalid custom preset file: ${path}`);
    names.add(normalized);
    cloneMatrix(matrix);
  }
  return { path, hash: digest(text), presets: parsed.presets };
}

export async function applySetup({ layout, cwd = process.cwd(), matrix, baselineMatrix, catalog, catalogLoader = async () => catalog, customPresetName, selectedAgents = AGENT_NAMES, env = process.env, transactionFactory = beginTransaction, expectedFilesLoader = receiptOwnedPaths } = {}) {
  validateMatrix(matrix, catalog);
  const previewMatrix = baselineMatrix === undefined ? undefined : cloneMatrix(baselineMatrix);
  if (customPresetName !== undefined) {
    const name = customPresetName?.trim();
    if (!name) throw new Error("custom preset name is required.");
    if (["low", "medium", "high", "custom"].includes(name.toLowerCase())) {
      throw new Error(`custom preset name is reserved: ${name}`);
    }
    customPresetName = name;
  }
  const selected = new Set(selectedAgents);
  if (!Array.isArray(selectedAgents) || selected.size !== selectedAgents.length || [...selected].some((name) => !AGENT_NAMES.includes(name))) {
    throw new Error("selected setup agents are invalid.");
  }
  if (!layout) layout = selectSetupScope({ cwd, env });

  let probe; let metadata; let metadataText;

  const agentPaths = AGENT_NAMES.map((name) => join(layout.agentsRoot, `${name}.toml`));
  const selectedAgentNames = AGENT_NAMES.filter((name) => selected.has(name));
  const selectedAgentPaths = selectedAgentNames.map((name) => join(layout.agentsRoot, `${name}.toml`));
  const target = await existingInstallationTarget({
    root: layout.root,
    configPath: layout.configPath,
    receiptPath: join(layout.configRoot, RECEIPT_NAME),
    expectedFiles: await expectedFilesLoader(layout)
  });
  if (customPresetName !== undefined) {
    const global = setupLayout({ env }).global;
    probe = await readCustomPresets({ env });
    if (Object.keys(probe.presets).some((existing) => existing.toLowerCase() === customPresetName.toLowerCase())) throw new Error(`custom preset already exists: ${customPresetName}`);
    const existingMatrices = {
      ...(await builtInPresets()),
      ...probe.presets
    };
    const identical = Object.entries(existingMatrices)
      .filter(([, existing]) => sameMatrix(existing, matrix))
      .map(([name]) => name);
    if (identical.length) {
      throw new Error(`custom preset matrix already exists as: ${identical.join(", ")}`);
    }
    const presets = { ...probe.presets, [customPresetName]: cloneMatrix(matrix) };
    metadataText = `${JSON.stringify({ version: 1, presets }, null, 2)}\n`;
    metadata = { ...(await metadataParticipant({ root: global.root, paths: [probe.path] })), coordinationRoot: setupCoordinationRoot(global) };
  }
  await Promise.all(selectedAgentPaths.map(async (path, index) => scanTopLevelAssignments(await readFile(path, "utf8"), selectedAgentNames[index])));
  const participants = [{ ...target, coordinationRoot: setupCoordinationRoot(layout) }, ...(metadata ? [metadata] : [])];
  const snapshotSet = [...new Set([...target.paths, ...(metadata ? metadata.paths : [])])];
  await recoverTransactions(setupCoordinationRoot(layout), recoveryAuthorityFromDeclaration({
    coordinationRoots: [...new Set(participants.map(({ coordinationRoot, root }) => coordinationRoot ?? root))],
    participants,
    snapshotSet
  }));
  const receiptMatrix = { version: 1, agents: cloneMatrix(matrix) };
  let changes;
  let receiptDrifted;
  const createDeclaration = async () => {
      const finalCatalog = await catalogLoader(codexModelContext(layout, { env }));
      validateMatrix(matrix, finalCatalog);
      const current = await readAgentMatrix(layout.agentsRoot);
      if (previewMatrix !== undefined && !sameMatrix(current, previewMatrix)) {
        throw new Error("agent matrix changed after preview; rerun setup.");
      }
      if (selected.size !== AGENT_NAMES.length && AGENT_NAMES.some((name) => !selected.has(name) && (current[name].model !== matrix[name].model || current[name].reasoning !== matrix[name].reasoning))) {
        throw new Error("unselected agent settings changed after preview; rerun setup.");
      }
      changes = selectedAgentPaths.filter((path, index) => {
        const name = selectedAgentNames[index]; const next = matrix[name]; const now = current[name];
        return now.model !== next.model || now.reasoning !== next.reasoning;
      });
      if (metadata) {
        const currentMetadata = await readFile(probe.path, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
        if ((currentMetadata === null ? null : digest(currentMetadata)) !== probe.hash) {
          throw new Error("custom preset file changed before confirmation; rerun setup.");
        }
      }
      receiptDrifted = !sameSetupAgentMatrix(target.receipt.setupAgentMatrix, receiptMatrix);
      return {
        operation: "setup",
        participants,
        snapshotSet,
        writeSet: [...changes, ...(receiptDrifted ? [target.receiptPath] : []), ...(metadata ? [probe.path] : [])]
    };
  };
  const transaction = await transactionFactory({
    coordinationRoots: [...new Set(participants.map(({ coordinationRoot, root }) => coordinationRoot ?? root))],
    recoveryAuthority: recoveryAuthorityFromDeclaration({
      coordinationRoots: [...new Set(participants.map(({ coordinationRoot, root }) => coordinationRoot ?? root))],
      participants,
      snapshotSet
    }),
    createDeclaration,
    snapshotSet,
  });
  if (!changes) await createDeclaration();
  let committed = false;
  try {
    for (const path of changes) {
      const name = AGENT_NAMES[agentPaths.indexOf(path)];
      const text = await readFile(path, "utf8");
      await transaction.write(path, updateAgent(text, matrix[name]));
    }
    if (changes.length) {
      const effective = await readAgentMatrix(layout.agentsRoot);
      if (!sameMatrix(effective, receiptMatrix.agents)) throw new Error("agent matrix did not match setup receipt after write.");
    }
    if (metadata) await transaction.write(probe.path, metadataText, { mode: 0o600 });
    if (receiptDrifted) {
      const receipt = { ...target.receipt, setupAgentMatrix: receiptMatrix };
      await transaction.write(target.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    if (!changes.length && !metadata && !receiptDrifted) {
      await transaction.rollback();
      await transaction.close?.();
      return { changed: false, scope: layout.scope };
    }
    await transaction.commit();
    committed = true;
    return { changed: true, scope: layout.scope, paths: [...changes, ...(receiptDrifted ? [target.receiptPath] : []), ...(metadata ? [probe.path] : [])] };
  } catch (error) {
    const cleanupErrors = [];
    try { await transaction.rollback(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    try { await transaction.close?.(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "setup transaction failed and cleanup was incomplete", { cause: error });
    throw error;
  } finally {
    if (committed) await transaction.close?.();
  }
}

export async function builtInPresets() { const payload = await payloadAgentMatrix(); return { Low: presetMatrix("Low"), Medium: presetMatrix("Medium"), High: presetMatrix("High", payload) }; }
function parseAgent(text, name) {
  const assignments = scanTopLevelAssignments(text, name);
  return {
    model: assignments.model.value,
    reasoning: assignments.model_reasoning_effort.value
  };
}

function updateAgent(text, { model, reasoning }) {
  const assignments = scanTopLevelAssignments(text);
  return [
    ["model", model],
    ["model_reasoning_effort", reasoning]
  ].sort(([left], [right]) => assignments[right].start - assignments[left].start)
    .reduce((updated, [key, value]) => replaceAssignment(updated, assignments[key], value), text);
}

function scanTopLevelAssignments(text, name = "agent") {
  const found = {};
  let inTable = false;
  let offset = text.startsWith("\uFEFF") ? 1 : 0;
  while (offset < text.length) {
    const lineEnd = text.indexOf("\n", offset);
    const end = lineEnd === -1 ? text.length : lineEnd + 1;
    const line = text.slice(offset, end).replace(/\r?\n$/, "");
    const unrelatedMultiline = /^\s*(?!(?:model|model_reasoning_effort)\s*=)[A-Za-z0-9_-]+\s*=\s*("""|''')/.exec(line);
    if (unrelatedMultiline) {
      const delimiterStart = offset + unrelatedMultiline.index + unrelatedMultiline[0].lastIndexOf(unrelatedMultiline[1]);
      const assignment = parseTomlString(text, delimiterStart, name, { decode: false });
      offset = text.indexOf("\n", assignment.end) + 1 || text.length;
      continue;
    }
    if (/^\s*\[\[?[^\]\r\n]+\]?\]\s*(?:#.*)?$/.test(line)) {
      inTable = true;
      offset = end;
      continue;
    }
    const match = /^\s*(model|model_reasoning_effort)\s*=\s*/.exec(line);
    if (!match) {
      offset = end;
      continue;
    }
    if (inTable || found[match[1]]) throw new Error(`invalid agent model configuration: ${name}`);
    const valueStart = offset + match[0].length;
    const assignment = parseTomlString(text, valueStart, name);
    const trailingLineEnd = text.indexOf("\n", assignment.end);
    const trailing = text.slice(assignment.end, trailingLineEnd === -1 ? text.length : trailingLineEnd).replace(/\r$/, "");
    if (!/^\s*(?:#.*)?$/.test(trailing) || !assignment.value) throw new Error(`invalid agent model configuration: ${name}`);
    found[match[1]] = assignment;
    offset = trailingLineEnd === -1 ? text.length : trailingLineEnd + 1;
  }
  if (!found.model || !found.model_reasoning_effort) throw new Error(`invalid agent model configuration: ${name}`);
  return found;
}

function parseTomlString(text, start, name, { decode = true } = {}) {
  const quote = text[start];
  if (quote !== "\"" && quote !== "'") throw new Error(`invalid agent model configuration: ${name}`);
  const multiline = text.startsWith(quote.repeat(3), start);
  const delimiter = multiline ? quote.repeat(3) : quote;
  let cursor = start + delimiter.length;
  for (;;) {
    const index = text.indexOf(delimiter, cursor);
    if (index === -1) throw new Error(`invalid agent model configuration: ${name}`);
    let slashes = 0;
    for (let probe = index - 1; probe >= start && text[probe] === "\\"; probe -= 1) slashes += 1;
    if (quote === "'" || slashes % 2 === 0) {
      const source = text.slice(start, index + delimiter.length);
      if (!multiline && /[\r\n]/.test(source)) throw new Error(`invalid agent model configuration: ${name}`);
      if (!decode) return { start, end: index + delimiter.length };
      let value;
      try {
        if (!multiline && quote === "\"") value = JSON.parse(source);
        else if (!multiline) value = source.slice(1, -1);
        else {
          const raw = source.slice(3, -3).replace(/^\r?\n/, "");
          value = quote === "'" ? raw : JSON.parse(`"${raw.replace(/\r?\n/g, "\\n")}"`);
        }
      } catch {
        throw new Error(`invalid agent model configuration: ${name}`);
      }
      return { value, start, end: index + delimiter.length };
    }
    cursor = index + 1;
  }
}

function replaceAssignment(text, assignment, value) {
  return `${text.slice(0, assignment.start)}${JSON.stringify(value)}${text.slice(assignment.end)}`;
}
function digest(text) { return createHash("sha256").update(text).digest("hex"); }
function sameMatrix(left, right) {
  return AGENT_NAMES.every((name) =>
    left[name]?.model === right[name]?.model &&
    left[name]?.reasoning === right[name]?.reasoning
  );
}
function sameSetupAgentMatrix(left, right) {
  if (!left || left.version !== 1 || !left.agents || typeof left.agents !== "object" || Array.isArray(left.agents)) return false;
  if (Object.keys(left).length !== 2 || Object.keys(left.agents).length !== AGENT_NAMES.length) return false;
  return AGENT_NAMES.every((name) =>
    left.agents[name]?.model === right.agents[name].model &&
    left.agents[name]?.reasoning === right.agents[name].reasoning
  );
}
function setupCoordinationRoot(layout) {
  return layout.root;
}
