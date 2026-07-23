#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(PLUGIN_ROOT, "agents");
const MANAGED_START = "# >>> csx managed agents >>>";
const MANAGED_END = "# <<< csx managed agents <<<";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    user: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

if (values.user && values.project) {
  fail("Choose exactly one scope: --user or --project <path>.");
}

const configRoot = values.user
  ? process.env.CODEX_HOME || join(homedir(), ".codex")
  : join(resolve(values.project || process.cwd()), ".codex");
const targetDir = join(configRoot, "agents");
const configPath = join(configRoot, "config.toml");

const files = (await readdir(SOURCE_DIR))
  .filter((file) => file.endsWith(".toml"))
  .sort();

if (files.length === 0) {
  fail(`No agent TOML files found in ${SOURCE_DIR}.`);
}

const agentNames = files.map((file) => file.slice(0, -".toml".length));
const existingConfig = existsSync(configPath)
  ? await readFile(configPath, "utf8")
  : "";
const nextConfig = buildConfig(existingConfig, agentNames);

if (!values["dry-run"]) {
  await mkdir(targetDir, { recursive: true });
}

let installed = 0;
let skipped = 0;

for (const file of files) {
  const source = join(SOURCE_DIR, file);
  const destination = join(targetDir, file);

  if (existsSync(destination) && !values.force) {
    skipped += 1;
    process.stdout.write(`skip ${destination}\n`);
    continue;
  }

  installed += 1;
  process.stdout.write(`${values["dry-run"] ? "would install" : "install"} ${destination}\n`);
  if (!values["dry-run"]) {
    await copyFile(source, destination);
  }
}

process.stdout.write(
  `${values["dry-run"] ? "would register" : "register"} ${configPath}\n`,
);
if (!values["dry-run"] && nextConfig !== existingConfig) {
  const temporaryConfigPath = `${configPath}.csx-${process.pid}.tmp`;
  await writeFile(temporaryConfigPath, nextConfig);
  await rename(temporaryConfigPath, configPath);
}

process.stdout.write(
  `csx agents: installed=${installed} skipped=${skipped} target=${targetDir} config=${configPath}\n`,
);

function buildConfig(content, names) {
  const managedBlock = [
    MANAGED_START,
    ...names.flatMap((name) => [
      `[agents.${name}]`,
      `config_file = "./agents/${name}.toml"`,
      "",
    ]),
    MANAGED_END,
  ].join("\n");

  const startIndex = content.indexOf(MANAGED_START);
  const endIndex = content.indexOf(MANAGED_END);

  if ((startIndex === -1) !== (endIndex === -1) || endIndex < startIndex) {
    fail(`Managed markers are incomplete in ${configPath}. Resolve them before rerunning setup.`);
  }

  if (startIndex !== -1) {
    const replaceEnd = endIndex + MANAGED_END.length;
    return normalizeConfig(
      `${content.slice(0, startIndex)}${managedBlock}${content.slice(replaceEnd)}`,
    );
  }

  for (const name of names) {
    if (new RegExp(`^\\[agents\\.${escapeRegExp(name)}\\]$`, "m").test(content)) {
      fail(
        `Unmanaged [agents.${name}] already exists in ${configPath}. Remove or rename it before setup.`,
      );
    }
  }

  return normalizeConfig(`${content}${content.trim() ? "\n\n" : ""}${managedBlock}`);
}

function normalizeConfig(content) {
  return `${content.trimEnd()}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  process.stderr.write(`csx agent setup: ${message}\n`);
  process.exit(1);
}
