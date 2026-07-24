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

  validateMarkers(layout.configPath, await readOptional(layout.configPath));
  validateAgentTables(layout.configPath, await readOptional(layout.configPath), oldReceipt);
  await validateDestinations(entries, oldReceipt);

  const existingConfig = await readOptional(layout.configPath);
  const block = managedBlock(layout, entries);
  const nextConfig = replaceManagedBlock(existingConfig, block, layout.configPath);
  const receipt = {
    version,
    scope,
    root: layout.root,
    configRoot: layout.configRoot,
    files: entries.map(({ destination }) => destination),
    installedAt: new Date().toISOString()
  };

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
  const nextConfig = removeManagedBlock(config);
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
  const starts = occurrences(content, MANAGED_START);
  const ends = occurrences(content, MANAGED_END);
  if (starts !== ends || starts > 1 || (starts === 1 && content.indexOf(MANAGED_END) < content.indexOf(MANAGED_START))) {
    throw new Error(`broken csx managed markers in ${configPath}`);
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
