import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  "csx-code-review"
];

export async function install({ scope, projectRoot, cwd = process.cwd(), env = process.env } = {}) {
  const layout = await resolveLayout({ scope, projectRoot, cwd, env });
  const version = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const entries = await payloadEntries(layout);
  const receiptPath = join(layout.configRoot, RECEIPT);
  const oldReceipt = await readReceipt(receiptPath);

  if (oldReceipt && (oldReceipt.scope !== scope || resolve(oldReceipt.root) !== layout.root)) {
    throw new Error(`installation receipt does not match the requested ${scope} root: ${receiptPath}`);
  }

  const existingConfig = await readOptional(layout.configPath);
  validateMarkers(layout.configPath, existingConfig);
  validateFeatureMarkers(layout.configPath, existingConfig, oldReceipt);
  validateAgentTables(layout.configPath, existingConfig, oldReceipt);
  await validateDestinations(entries, oldReceipt);

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

  await mkdir(layout.configRoot, { recursive: true });
  await runTransaction([
    ...entries.map((entry) => ({ path: entry.destination, source: entry.source, mode: entry.mode })),
    { path: layout.configPath, data: nextConfig },
    { path: receiptPath, data: `${JSON.stringify(receipt, null, 2)}\n` }
  ]);
  return { ...layout, version };
}

export async function uninstall({ projectRoot, cwd = process.cwd(), env = process.env } = {}) {
  const project = await projectLayoutForUninstall(projectRoot, cwd);
  const global = globalLayout(env, false);
  const candidate = project && existsSync(join(project.configRoot, RECEIPT)) ? project : global;
  const receiptPath = join(candidate.configRoot, RECEIPT);
  const receipt = await readReceipt(receiptPath);
  if (!receipt) return { removed: false };

  if (resolve(receipt.root) !== candidate.root || receipt.scope !== candidate.scope) {
    throw new Error(`refusing to use a mismatched installation receipt: ${receiptPath}`);
  }
  for (const file of receipt.files || []) {
    if (!isWithin(candidate.root, file)) {
      throw new Error(`receipt contains a path outside its installation root: ${file}`);
    }
  }

  const config = await readOptional(candidate.configPath);
  validateMarkers(candidate.configPath, config);
  validateFeatureMarkers(candidate.configPath, config, receipt);
  const withoutManagedBlock = removeManagedBlock(config);
  const nextConfig = restoreDefaultModeInput(withoutManagedBlock, receipt.featureConfig);
  if (nextConfig !== config) await atomicWrite(candidate.configPath, nextConfig);

  for (const file of receipt.files || []) await rm(file, { force: true });
  await rm(receiptPath, { force: true });
  await removeEmptyParents(receipt.files || [], candidate);
  return { removed: true, scope: candidate.scope, root: candidate.root };
}

async function resolveLayout({ scope, projectRoot, cwd, env }) {
  if (scope === "global") return globalLayout(env, true);
  if (scope !== "project") throw new Error("scope must be global or project.");
  const root = resolve(projectRoot || cwd);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`project root does not exist or is not a directory: ${root}`);
  }
  return projectLayout(root);
}

function globalLayout(env, createDefault) {
  const explicit = Boolean(env.CODEX_HOME);
  const root = resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"));
  if (explicit && createDefault && !existsSync(root)) {
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
    if (existsSync(destination) && !owned.has(resolve(destination))) {
      throw new Error(`refusing to overwrite an unmanaged file: ${destination}`);
    }
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
  const unmanaged = removeManagedBlock(content);
  for (const name of agentNames()) {
    if (new RegExp(`^\\s*\\[agents\\.${escapeRegExp(name)}\\]\\s*(?:#.*)?$`, "m").test(unmanaged)) {
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

  const firstTable = findNextTable(content, 0);
  const topLevelEnd = firstTable?.index ?? content.length;
  const topLevel = content.slice(0, topLevelEnd);
  if (/^[ \t]*features[ \t]*=[ \t]*\{/m.test(topLevel)) {
    throw new Error(
      `cannot safely manage ${DEFAULT_MODE_INPUT_FEATURE} in inline features table: ${configPath}`
    );
  }

  const table = findFeaturesTable(content, configPath);
  const tableAssignment = table
    ? findFeatureAssignment(content, table.bodyStart, table.bodyEnd, false, configPath)
    : null;
  const dottedAssignment = findFeatureAssignment(content, 0, topLevelEnd, true, configPath);
  if (tableAssignment && dottedAssignment) {
    throw new Error(`duplicate ${DEFAULT_MODE_INPUT_FEATURE} settings in ${configPath}`);
  }

  const assignment = tableAssignment || dottedAssignment;
  if (assignment?.value === true) return { config: content, state: null };
  if (assignment) {
    return {
      config: replaceSlice(content, assignment.start, assignment.end, featureBlock(assignment.dotted)),
      state: {
        key: DEFAULT_MODE_INPUT_FEATURE,
        previousLine: assignment.line
      }
    };
  }

  if (table) {
    return {
      config: insertBlock(content, table.bodyEnd, featureBlock(false)),
      state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: null }
    };
  }

  const topLevelFeatureKey = /^[ \t]*features[ \t]*\.[ \t]*[A-Za-z0-9_-]+[ \t]*=/gm;
  const sibling = topLevelFeatureKey.exec(topLevel);
  if (sibling) {
    return {
      config: insertBlock(content, sibling.index, featureBlock(true)),
      state: { key: DEFAULT_MODE_INPUT_FEATURE, previousLine: null }
    };
  }

  const featureSubtable = /^[ \t]*\[features\.[^\]\r\n]+\][ \t]*(?:#.*)?$/gm;
  const subtable = featureSubtable.exec(content);
  const block = `${FEATURE_MANAGED_START}\n[features]\n${DEFAULT_MODE_INPUT_FEATURE} = true\n${FEATURE_MANAGED_END}`;
  return {
    config: insertBlock(content, subtable?.index ?? content.length, block, !subtable),
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

function findFeaturesTable(content, configPath) {
  const pattern = /^[ \t]*\[features\][ \t]*(?:#.*)?(?:\r?\n|$)/gm;
  const matches = [...content.matchAll(pattern)];
  if (matches.length > 1) throw new Error(`duplicate [features] tables in ${configPath}`);
  if (!matches.length) return null;
  const match = matches[0];
  const bodyStart = match.index + match[0].length;
  const next = findNextTable(content, bodyStart);
  return { bodyStart, bodyEnd: next?.index ?? content.length };
}

function findNextTable(content, from) {
  const pattern = /^[ \t]*\[{1,2}[^\]\r\n]+\]{1,2}[ \t]*(?:#.*)?$/gm;
  pattern.lastIndex = from;
  const match = pattern.exec(content);
  return match ? { index: match.index, text: match[0] } : null;
}

function findFeatureAssignment(content, start, end, dotted, configPath) {
  const prefix = dotted ? "features[ \\t]*\\.[ \\t]*" : "";
  const pattern = new RegExp(
    `^[ \\t]*${prefix}(?:${DEFAULT_MODE_INPUT_FEATURE}|"${DEFAULT_MODE_INPUT_FEATURE}")[ \\t]*=[ \\t]*([^\\r\\n]*)$`,
    "gm"
  );
  const section = content.slice(start, end);
  const matches = [...section.matchAll(pattern)];
  if (matches.length > 1) {
    throw new Error(`duplicate ${DEFAULT_MODE_INPUT_FEATURE} settings in ${configPath}`);
  }
  if (!matches.length) return null;
  const match = matches[0];
  const value = match[1].trim().replace(/\s+#.*$/, "").trim();
  if (value !== "true" && value !== "false") {
    throw new Error(`${DEFAULT_MODE_INPUT_FEATURE} must be a boolean in ${configPath}`);
  }
  return {
    start: start + match.index,
    end: start + match.index + match[0].length,
    line: match[0],
    value: value === "true",
    dotted
  };
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

async function runTransaction(writes) {
  const backups = [];
  try {
    for (const item of writes) {
      await mkdir(dirname(item.path), { recursive: true });
      const prior = existsSync(item.path) ? await readFile(item.path) : null;
      backups.push({ path: item.path, prior });
      const data = item.source ? await readFile(item.source) : item.data;
      await atomicWrite(item.path, data, item.mode);
    }
  } catch (error) {
    for (const { path, prior } of backups.reverse()) {
      if (prior === null) await rm(path, { force: true }).catch(() => {});
      else await atomicWrite(path, prior).catch(() => {});
    }
    throw error;
  }
}

async function atomicWrite(path, data, mode) {
  const temporary = `${path}.csx-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, data, mode ? { mode } : undefined);
    if (mode) await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readReceipt(path) {
  const content = await readOptional(path);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.files)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`invalid csx installation receipt: ${path}`);
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function removeEmptyParents(files, layout) {
  const stops = new Set([layout.root, layout.configRoot, layout.skillsRoot, layout.agentsRoot, layout.hooksRoot]);
  const directories = [...new Set(files.map(dirname))].sort((a, b) => b.length - a.length);
  for (let directory of directories) {
    while (isWithin(layout.root, directory) && directory !== layout.root) {
      const contents = await readdir(directory).catch(() => null);
      if (!contents || contents.length) break;
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
