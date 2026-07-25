#!/usr/bin/env node

import { parseArgs } from "node:util";
import { install, uninstall } from "../lib/install.js";
import { runSetupCommand } from "../lib/setup-command.js";
import { escapeTerminalText } from "../lib/terminal-text.js";
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
      process.stdout.write(`Installed csx ${escapeTerminalText(result.version)} (${escapeTerminalText(result.scope)}) in ${escapeTerminalText(result.root)}\n`);
      process.stdout.write("Enabled Codex Default mode user-input choices for this install scope.\n");
      process.stdout.write("Start a new Codex session to load the installed skills and agents.\n");
      process.stdout.write("On first hook use, review and trust the csx hook when Codex prompts you.\n");
    }
  } else if (command === "setup") {
    if (args.length) throw new UsageError("setup does not accept arguments.");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new UsageError("setup requires an interactive terminal; use Codex configuration directly in automation.");
    }
    await runSetupCommand();
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
        process.stdout.write(`Removed the ${escapeTerminalText(result.scope)} csx installation from ${escapeTerminalText(result.root)}\n`);
      } else {
        process.stdout.write("No csx installation was found; nothing was removed.\n");
      }
      process.stdout.write("The npm CLI remains installed. Remove it with: npm uninstall -g @coolsik/csx\n");
    }
  } else {
    throw new UsageError(`unknown command "${command}".`);
  }
} catch (error) {
  process.stderr.write(`csx: ${escapeTerminalText(renderError(error))}\n`);
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
