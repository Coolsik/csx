#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { install, uninstall } from "../lib/install.js";
import { applySetup, builtInPresets, codexModelContext, readAgentMatrix, readCustomPresets, requestUniqueCustomPresetName, selectSetupScope } from "../lib/setup.js";
import { discoverCodexModels } from "../lib/codex-models.js";
import { TransactionLockError } from "../lib/transaction-lock.js";

class UsageError extends Error {}

const USAGE = `Usage:
  csx install [--scope global|project] [--project-root <path>]
  csx uninstall [--project-root <path>]
  csx setup
  csx --help

Install scopes:
  global   Install under \${CODEX_HOME:-~/.codex}
  project  Install only in the current directory
`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    process.exitCode = command ? 0 : 1;
  } else if (command === "install") {
    const { values } = parseArgs({
      args,
      options: {
        scope: { type: "string" },
        "project-root": { type: "string" },
        help: { type: "boolean", short: "h" }
      },
      strict: true
    });
    if (values.help) {
      process.stdout.write(USAGE);
    } else {
      let scope = values.scope;
      if (!scope && process.stdin.isTTY && process.stdout.isTTY) {
        scope = await promptScope();
      }
      if (!scope) throw new UsageError("install scope is required in a non-interactive environment.");
      if (scope !== "global" && scope !== "project") {
        throw new UsageError(`invalid scope "${scope}"; expected global or project.`);
      }
      if (scope === "global" && values["project-root"]) {
        throw new UsageError("--project-root can only be used with --scope project.");
      }
      const result = await install({
        scope,
        projectRoot: values["project-root"],
        cwd: process.cwd()
      });
      process.stdout.write(`Installed csx ${result.version} (${scope}) in ${result.root}\n`);
      process.stdout.write("Enabled Codex Default mode user-input choices for this install scope.\n");
      process.stdout.write("Start a new Codex session to load the installed skills and agents.\n");
      process.stdout.write("On first hook use, review and trust the csx hook when Codex prompts you.\n");
    }
  } else if (command === "setup") {
    if (args.length) throw new UsageError("setup does not accept arguments.");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new UsageError("setup requires an interactive terminal; use Codex configuration directly in automation.");
    }
    await runSetup();
  } else if (command === "uninstall") {
    const { values } = parseArgs({
      args,
      options: {
        "project-root": { type: "string" },
        help: { type: "boolean", short: "h" }
      },
      strict: true
    });
    if (values.help) {
      process.stdout.write(USAGE);
    } else {
      const result = await uninstall({
        projectRoot: values["project-root"],
        cwd: process.cwd()
      });
      if (result.removed) {
        process.stdout.write(`Removed the ${result.scope} csx installation from ${result.root}\n`);
      } else {
        process.stdout.write("No csx installation was found; nothing was removed.\n");
      }
      process.stdout.write("The npm CLI remains installed. Remove it with: npm uninstall -g @coolsik/csx\n");
    }
  } else {
    throw new UsageError(`unknown command "${command}".`);
  }
} catch (error) {
  process.stderr.write(`csx: ${renderError(error)}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${USAGE}`);
  process.exitCode = 1;
}

async function promptScope() {
  const { createInterface } = await import("node:readline/promises");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write([
      "Select an install scope:",
      "  1) global",
      "  2) project",
      ""
    ].join("\n"));
    while (true) {
      const answer = (await prompt.question("Enter 1 or 2: ")).trim();
      if (answer === "1") return "global";
      if (answer === "2") return "project";
      process.stdout.write("Please enter 1 for global or 2 for project.\n");
    }
  } finally {
    prompt.close();
  }
}
async function runSetup() {
  const layout = selectSetupScope();
  const modelContext = codexModelContext(layout);
  const catalog = await discoverCodexModels(modelContext);
  const current = await readAgentMatrix(layout.agentsRoot);
  const builtIns = await builtInPresets();
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let custom;
  try {
    const selected = await choose(prompt, "Select a preset:", [...Object.keys(builtIns), "Saved custom presets", "Edit current matrix"]);
    let matrix;
    if (selected === "Saved custom presets") {
      custom = await readCustomPresets();
      const names = Object.keys(custom.presets);
      if (!names.length) throw new Error("no saved custom presets.");
      matrix = custom.presets[await choose(prompt, "Select a saved custom matrix:", names)];
    } else if (selected === "Edit current matrix") {
      matrix = current;
    } else {
      matrix = builtIns[selected];
    }
    matrix = structuredClone(matrix);
    await editRows(prompt, matrix, catalog);
    const invalid = invalidRows(matrix, catalog);
    if (invalid.length) throw new Error(`repair unavailable model settings before applying: ${invalid.join(", ")}`);
    const changed = Object.keys(matrix).filter((name) => matrix[name].model !== current[name].model || matrix[name].reasoning !== current[name].reasoning);
    const selectedRows = await selectDiffRows(prompt, changed, current, matrix, catalog);
    for (const name of changed) if (!selectedRows.has(name)) matrix[name] = current[name];
    const finalChanged = Object.keys(matrix).filter((name) => matrix[name].model !== current[name].model || matrix[name].reasoning !== current[name].reasoning);
    process.stdout.write(`\nSetup preview for ${layout.scope} scope at ${layout.root}:\n`);
    for (const name of finalChanged) process.stdout.write(`  ${formatRowDiff(name, current[name], matrix[name])}\n`);
    if (!finalChanged.length) process.stdout.write("  No agent model changes.\n");
    const saveCustom = finalChanged.length > 0 && await yesNo(prompt, "Save this full matrix as a global custom preset?");
    let customPresetName;
    if (saveCustom) {
      custom ??= await readCustomPresets();
      customPresetName = await requestUniqueCustomPresetName(
        () => question(prompt, "Custom preset name: "),
        Object.keys(custom.presets),
        (name) => process.stdout.write(`A custom preset named "${name}" already exists.\n`)
      );
    }
    if (!await yesNo(prompt, "Apply these changes?")) {
      process.stdout.write("Setup cancelled.\n");
      return;
    }
    const result = await applySetup({ layout, matrix, baselineMatrix: current, catalog, catalogLoader: () => discoverCodexModels(modelContext), customPresetName, selectedAgents: [...selectedRows] });
    process.stdout.write(result.changed ? `Updated ${layout.scope} csx setup.\n` : "Setup already matches the selected matrix.\n");
    } finally {
      prompt.close();
    }
}
function renderError(error) {
  if (error?.name === "AbortError") return "Aborted with Ctrl+D.";
  const guidance = {
    lock_busy: "Another csx operation is running for this scope. Wait for it to finish, then retry.",
    lock_capability_unavailable: "This filesystem cannot safely lock csx transactions. Use a supported local filesystem with native locking support.",
    lock_filesystem_unsupported: "This filesystem does not support safe csx transactions. Move the Codex home or project to a supported local filesystem.",
    recovery_required: "A previous csx transaction needs recovery. Resolve the reported transaction state before retrying."
  };
  if (error instanceof TransactionLockError || guidance[error?.code]) {
    return `[${error.code}] ${error.message}. ${guidance[error.code] ?? "Resolve the transaction issue before retrying."}`;
  }
  return error.message;
}

function selectedChoice(answer, choices) {
  const index = Number(answer) - 1;
  return Number.isInteger(index) ? choices[index] : undefined;
}

async function choose(prompt, title, choices) {
  process.stdout.write(`${title}\n${choices.map((value, index) => `  ${index + 1}) ${value}`).join("\n")}\n`);
  while (true) {
    const choice = selectedChoice((await prompt.question(`Enter 1-${choices.length}: `)).trim(), choices);
    if (choice) return choice;
    process.stdout.write("Select a listed number.\n");
  }
}

async function question(prompt, label) {
  while (true) {
    const answer = (await prompt.question(label)).trim();
    if (answer) return answer;
    process.stdout.write("A value is required.\n");
  }
}

function parseYesNo(answer) {
  const normalized = answer.trim().toLowerCase();
  if (!normalized || normalized === "n" || normalized === "no") return false;
  if (normalized === "y" || normalized === "yes") return true;
  return undefined;
}

async function yesNo(prompt, label) {
  while (true) {
    const answer = parseYesNo(await prompt.question(`${label} [y/N] `));
    if (answer !== undefined) return answer;
    process.stdout.write("Enter y or n.\n");
  }
}

async function editRows(prompt, matrix, catalog) {
  const rows = Object.keys(matrix);
  while (true) {
    process.stdout.write(`\nAgent matrix:\n${rows.map((name, index) => `  ${index + 1}) ${name}: ${matrix[name].model}/${matrix[name].reasoning}`).join("\n")}\n  d) continue to diff\n`);
    const answer = await question(prompt, "Select a row or d: ");
    if (answer.toLowerCase() === "d") {
      const invalid = invalidRows(matrix, catalog);
      if (!invalid.length) return;
      process.stdout.write(`Repair unavailable settings before continuing: ${invalid.join(", ")}\n`);
      continue;
    }
    const name = selectedChoice(answer, rows);
    if (!name) { process.stdout.write("Select a listed row.\n"); continue; }
    const model = await choose(prompt, `Model for ${name}:`, catalog.map(({ model }) => model));
    const efforts = catalog.find((entry) => entry.model === model).efforts;
    matrix[name] = { model, reasoning: await choose(prompt, `Reasoning effort for ${name}:`, efforts) };
  }
}
function invalidRows(matrix, catalog) {
  const available = new Map(catalog.map(({ model, efforts }) => [model, new Set(efforts)]));
  return Object.keys(matrix).filter((name) => !available.get(matrix[name].model)?.has(matrix[name].reasoning));
}
function formatRowDiff(name, before, after) {
  return `${name}: model ${JSON.stringify(before.model)} → ${JSON.stringify(after.model)}; reasoning ${JSON.stringify(before.reasoning)} → ${JSON.stringify(after.reasoning)}`;
}
async function selectDiffRows(prompt, changed, current, matrix, catalog) {
  const mandatory = new Set(invalidRows(current, catalog).filter((name) => changed.includes(name)));
  const selected = new Set(changed);
  process.stdout.write("\nReview changes:\n");
  for (const name of changed) {
    process.stdout.write(`  ${formatRowDiff(name, current[name], matrix[name])}\n`);
    if (mandatory.has(name)) {
      process.stdout.write("    repair is required and will be applied.\n");
      continue;
    }
    if (!await yesNo(prompt, `Apply change for ${name}?`)) selected.delete(name);
  }
  return selected;
}
