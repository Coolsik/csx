#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SKILL_HINTS = {
  analyze: "read-only repository analysis with file-backed evidence and confidence labels",
  spec: "evidence-grounded requirements clarification with readiness, scope, constraints, acceptance criteria, non-goals, and decision boundaries",
  loop: "explicit bounded orchestration through specification, planning, goal execution, and completion",
  plan: "concise implementation plan with verification and risk checks",
  "plan-pro": "higher-rigor plan with bounded architect and critic review",
  "start-goal": "durable task execution with success criteria and evidence",
  deslop: "behavior-preserving cleanup of a bounded change followed by the same verification",
  "code-review": "severity-first diff review with independent reviewer lanes for substantial changes",
};

const execFileAsync = promisify(execFile);
const STATE_PATH = ".csx/workflow-state-v1.json";
const STATE_LIMIT = 65_536;
const ARTIFACT_LIMIT = 1_048_576;
const RECEIPT_LIMIT = 65_536;
const CONFIG_LIMIT = 1_048_576;
const HOOK_LIMIT = 1_048_576;
const HOOK_INPUT_LIMIT = 1_048_576;
const DIAGNOSTICS_PATH = ".csx/diagnostics-v1";
const DIAGNOSTIC_EVENT_LIMIT = 4_096;
const DIAGNOSTIC_EVENT_COUNT = 2_304;
const DIAGNOSTIC_TEMP_COUNT = 64;
const DIAGNOSTIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DIAGNOSTIC_ROLES = new Set([
  "csx-analyst",
  "csx-architect",
  "csx-code-reviewer",
  "csx-critic",
  "csx-executor",
  "csx-explorer",
  "csx-planner",
]);
const DIAGNOSTIC_STATUSES = new Set(["completed", "blocked", "failed", "terminated"]);
const ACTIVE_STATE_KEYS = [
  "artifact",
  "artifactSha256",
  "instanceToken",
  "phase",
  "schema",
  "startedAt",
  "status",
  "updatedAt",
  "version",
  "workflow",
].sort();
const TERMINAL_STATE_KEYS = [...ACTIVE_STATE_KEYS, "finishedAt", "terminalOutcome"].sort();
const WORKFLOW_ARTIFACT_PREFIX = new Map([
  ["csx-plan-pro", ".csx/plans/"],
  ["csx-start-goal", ".csx/goals/"],
]);
const TERMINAL_OUTCOMES = new Set(["approved", "blocked", "complete", "stopped"]);
const SESSION_SOURCES = new Set(["startup", "resume", "clear"]);
const MANAGED_MARKERS = [
  "# >>> csx managed >>>",
  "# <<< csx managed <<<",
  "# >>> csx feature default_mode_request_user_input >>>",
  "# <<< csx feature default_mode_request_user_input <<<",
  "# >>> csx leader defaults >>>",
  "# <<< csx leader defaults <<<",
];

await main().catch(() => {});

async function main() {
  if (process.argv[2] === "user-prompt-submit") {
    await runUserPromptSubmitHook(process.stdin, process.stdout);
    return;
  }
  const authority = parseAuthority(process.argv.slice(2));
  if (authority === null || await inspectInstallation(authority.scope, authority.root, true) !== "valid") {
    return;
  }
  if (authority.operation === "session-start") {
    await runSessionStart(process.stdin, process.stdout, authority);
  } else if (authority.operation === "subagent-stop") {
    await runSubagentStop(process.stdin, authority);
  }
}

async function runSessionStart(stdin, stdout, authority) {
  try {
    const payload = parsePayload(await readAll(stdin));
    if (!payload ||
        payload.hook_event_name !== "SessionStart" ||
        !SESSION_SOURCES.has(payload.source) ||
        typeof payload.cwd !== "string") {
      return;
    }

    const root = await resolveProjectRoot(payload.cwd, authority.scope === "global");
    if (root === null) return;
    if (authority.scope === "project") {
      if (root !== authority.root) return;
    } else {
      const projectInstallation = await inspectInstallation("project", root);
      if (projectInstallation !== "absent") return;
    }
    const state = await readActiveState(root);
    if (state === null || !await artifactIsCurrent(root, state)) return;

    stdout.write(formatRestoreContext(state));
  } catch {
    // Lifecycle restoration is advisory and must never block a Codex session.
  }
}

function parseAuthority(argv) {
  if (argv.length !== 5 ||
      !["session-start", "subagent-stop"].includes(argv[0]) ||
      argv[1] !== "--authority-scope" ||
      !["project", "global"].includes(argv[2]) ||
      argv[3] !== "--authority-root" ||
      typeof argv[4] !== "string" ||
      !isAbsolute(argv[4])) {
    return null;
  }
  return {
    operation: argv[0],
    scope: argv[2],
    root: argv[4],
  };
}

async function runUserPromptSubmitHook(stdin, stdout) {
  try {
    const payload = parsePayload(await readAll(stdin));
    if (!payload || payload.hook_event_name !== "UserPromptSubmit") return;
    const skill = detectCsxSkill(payload.prompt);
    if (!skill) return;
    stdout.write(formatSkillContext(skill));
  } catch {
    // Prompt routing is advisory and must never block a user prompt.
  }
}

function detectCsxSkill(prompt) {
  if (typeof prompt !== "string") return null;

  const match = prompt.match(
    /^\s*(?:\$csx-(analyze|spec|loop|plan-pro|plan|start-goal|deslop|code-review)|csx\s+(analyze|spec|loop|plan-pro|plan|start-goal|deslop|code-review))\b/i,
  );
  if (!match) return null;

  const skill = (match[1] || match[2]).toLowerCase();
  if (skill === "loop") {
    const invocation = prompt.match(/^\s*(?:\$csx-loop|csx\s+loop)\b([\s\S]*)$/i);
    const request = invocation[1].trim();
    if (!request) return null;
    if (/^resume(?:\s|$)/i.test(request) && !/^resume\s+\S+$/i.test(request)) return null;
  }

  return Object.hasOwn(SKILL_HINTS, skill) ? skill : null;
}

function formatSkillContext(skill) {
  const additionalContext = [
    "<csx-routing>",
    `Use the $csx-${skill} skill for this request: ${SKILL_HINTS[skill]}.`,
    "Keep the workflow lightweight. Use bounded Codex subagent review only where that skill says it adds signal; otherwise stay in the main context.",
    "Do not require a custom runner, background service, or MCP server for csx work.",
    "</csx-routing>",
  ].join("\n");
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  })}\n`;
}

async function inspectInstallation(scope, root, running = false) {
  const layout = installationLayout(scope, root);
  if (layout === null) return "unsafe";
  if (!await isCanonicalDirectory(layout.root).catch(() => false)) return "unsafe";
  if (scope === "project" && !await isSafeOptionalDirectory(layout.configRoot)) return "unsafe";

  const [receiptInfo, hookInfo] = await Promise.all([
    pathInfo(layout.receipt),
    pathInfo(layout.hook),
  ]);
  const configInfo = await pathInfo(layout.config);
  let configContent = null;
  if (configInfo !== null) {
    configContent = await readBoundedNoFollowFile(layout.config, CONFIG_LIMIT);
    if (configContent === null) return "unsafe";
  }
  if (receiptInfo === null && hookInfo === null) {
    return configContent !== null && hasExactManagedMarker(configContent.toString("utf8"))
      ? "unsafe"
      : "absent";
  }
  if (receiptInfo === null || hookInfo === null) return "unsafe";

  try {
    if (await readBoundedNoFollowFile(layout.hook, HOOK_LIMIT) === null) return "unsafe";
    const receiptContent = await readBoundedNoFollowFile(layout.receipt, RECEIPT_LIMIT);
    if (receiptContent === null) return "unsafe";
    const receipt = JSON.parse(receiptContent.toString("utf8"));
    if (!validInstallationReceipt(receipt, layout)) return "unsafe";
    if (running && await realpath(fileURLToPath(import.meta.url)) !== layout.hook) return "unsafe";
    return "valid";
  } catch {
    return "unsafe";
  }
}

function installationLayout(scope, root) {
  if (!isAbsolute(root) || resolve(root) !== root) return null;
  if (scope === "project") {
    return {
      scope,
      root,
      configRoot: resolve(root, ".codex"),
      config: resolve(root, ".codex", "config.toml"),
      receipt: resolve(root, ".codex", ".csx-install-receipt.json"),
      hook: resolve(root, ".codex", "hooks", "csx-hook.mjs"),
    };
  }
  if (scope === "global") {
    return {
      scope,
      root,
      configRoot: root,
      config: resolve(root, "config.toml"),
      receipt: resolve(root, ".csx-install-receipt.json"),
      hook: resolve(root, "hooks", "csx-hook.mjs"),
    };
  }
  return null;
}

async function pathInfo(path) {
  return lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

async function isCanonicalDirectory(path) {
  const info = await lstat(path);
  return info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path;
}

async function isSafeOptionalDirectory(path) {
  const info = await pathInfo(path);
  if (info === null) return true;
  return info.isDirectory() &&
    !info.isSymbolicLink() &&
    await realpath(path).catch(() => null) === path;
}

function validInstallationReceipt(receipt, layout) {
  if (!isObject(receipt) ||
      receipt.scope !== layout.scope ||
      receipt.root !== layout.root ||
      receipt.configRoot !== layout.configRoot ||
      !Array.isArray(receipt.files)) {
    return false;
  }
  const files = receipt.files;
  if (files.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
      new Set(files).size !== files.length) {
    return false;
  }
  return files.filter((path) => path === layout.hook).length === 1;
}

function hasExactManagedMarker(content) {
  return content.split(/\r?\n/).some((line) => MANAGED_MARKERS.includes(line));
}

async function runSubagentStop(stdin, authority) {
  try {
    const payload = parsePayload(await readAll(stdin));
    if (!payload ||
        payload.hook_event_name !== "SubagentStop" ||
        typeof payload.cwd !== "string" ||
        typeof payload.agent_type !== "string" ||
        (typeof payload.last_assistant_message !== "string" &&
         payload.last_assistant_message !== null) ||
        !DIAGNOSTIC_ROLES.has(payload.agent_type)) {
      return;
    }

    const root = await resolveProjectRoot(payload.cwd, authority.scope === "global");
    if (root === null) return;
    if (authority.scope === "project") {
      if (root !== authority.root) return;
    } else {
      const projectStatus = await inspectInstallation("project", root);
      if (projectStatus !== "absent") return;
    }
    if (!await receiptOwnsRole(authority, payload.agent_type)) return;

    const state = await readActiveState(root);
    if (state === null) return;
    const event = {
      schema: "csx.diagnostic-event",
      version: 1,
      timestamp: new Date().toISOString(),
      workflow: state.workflow,
      phase: state.phase,
      role: payload.agent_type,
      ...(typeof payload.last_assistant_message === "string"
        ? parseDiagnosticTrailer(payload.last_assistant_message)
        : {}),
    };
    const content = Buffer.from(`${JSON.stringify(event)}\n`);
    if (content.length > DIAGNOSTIC_EVENT_LIMIT) return;
    await writeDiagnosticEvent(root, content);
  } catch {
    // Diagnostics are advisory and must never affect the subagent stop event.
  }
}

async function receiptOwnsRole(authority, role) {
  const layout = installationLayout(authority.scope, authority.root);
  if (layout === null) return false;
  const content = await readBoundedNoFollowFile(layout.receipt, RECEIPT_LIMIT);
  if (content === null) return false;
  let receipt;
  try {
    receipt = JSON.parse(content.toString("utf8"));
  } catch {
    return false;
  }
  if (!validInstallationReceipt(receipt, layout)) return false;
  const expected = resolve(layout.configRoot, "agents", `${role}.toml`);
  if (receipt.files.filter((path) => path === expected).length !== 1) return false;
  const info = await lstat(expected).catch(() => null);
  return info?.isFile() &&
    !info.isSymbolicLink() &&
    await realpath(expected).catch(() => null) === expected;
}

function parseDiagnosticTrailer(response) {
  const lines = response.split(/\r?\n/);
  let line = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].length !== 0) {
      line = lines[index];
      break;
    }
  }
  const prefix = "<!-- csx-metrics:v1 ";
  if (!line ||
      Buffer.byteLength(line, "utf8") > 6_144 ||
      !line.startsWith(prefix) ||
      !line.endsWith(" -->")) {
    return {};
  }
  const source = line.slice(prefix.length, -4);
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return {};
  }
  if (!isObject(value)) return {};
  const counts = topLevelKeyCounts(source);
  if (counts === null) return {};
  const fields = {};
  if (counts.get("status") === 1 && DIAGNOSTIC_STATUSES.has(value.status)) {
    fields.status = value.status;
  }
  if (counts.get("reason_code") === 1 &&
      typeof value.reason_code === "string" &&
      /^[a-z0-9_]{1,64}$/.test(value.reason_code)) {
    fields.reason_code = value.reason_code;
  }
  if (fields.reason_code &&
      counts.get("failure_detail") === 1 &&
      typeof value.failure_detail === "string" &&
      Buffer.byteLength(value.failure_detail, "utf8") <= 2_048) {
    fields.failure_detail = value.failure_detail;
  }
  return fields;
}

async function writeDiagnosticEvent(root, content) {
  const parent = resolve(root, ".csx");
  if (!await isCanonicalDirectory(parent)) return;
  const directory = resolve(root, DIAGNOSTICS_PATH);
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  if (!await isCanonicalDirectory(directory)) return;
  await cleanupDiagnosticNamespace(directory, Date.now());

  for (let reservationIndex = 0; reservationIndex < DIAGNOSTIC_TEMP_COUNT; reservationIndex += 1) {
    const suffix = String(reservationIndex).padStart(2, "0");
    const reservation = resolve(directory, `reservation-${suffix}`);
    let reservationHandle;
    try {
      reservationHandle = await open(
        reservation,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ELOOP") continue;
      throw error;
    }
    try {
      await reservationHandle.close();
      reservationHandle = null;
      await writeFromReservation(directory, reservationIndex, content);
    } finally {
      await reservationHandle?.close().catch(() => {});
      await unlinkSafeRegular(reservation, 0);
    }
    return;
  }
}

async function writeFromReservation(directory, reservationIndex, content) {
  const temp = resolve(directory, `temp-${String(reservationIndex).padStart(2, "0")}.json`);
  let tempHandle;
  try {
    tempHandle = await open(
      temp,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await tempHandle.writeFile(content);
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    for (let eventIndex = 0; eventIndex < DIAGNOSTIC_EVENT_COUNT; eventIndex += 1) {
      const finalPath = resolve(directory, `event-${String(eventIndex).padStart(4, "0")}.json`);
      try {
        await link(temp, finalPath);
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  } finally {
    await tempHandle?.close().catch(() => {});
    await unlinkSafeRegular(temp, DIAGNOSTIC_EVENT_LIMIT);
  }
}

async function cleanupDiagnosticNamespace(directory, now) {
  const names = await readdir(directory).catch(() => []);
  for (const name of names) {
    let limit;
    if (/^event-(?:0\d{3}|1\d{3}|2[0-2]\d{2}|230[0-3])\.json$/.test(name) ||
        /^temp-(?:0\d|[1-5]\d|6[0-3])\.json$/.test(name)) {
      limit = DIAGNOSTIC_EVENT_LIMIT;
    } else if (/^reservation-(?:0\d|[1-5]\d|6[0-3])$/.test(name)) {
      limit = 0;
    } else {
      continue;
    }
    const path = resolve(directory, name);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() ||
        info.isSymbolicLink() ||
        info.size > limit ||
        now - info.mtimeMs < DIAGNOSTIC_MAX_AGE_MS) {
      continue;
    }
    await unlinkSafeRegular(path, limit);
  }
}

async function unlinkSafeRegular(path, limit) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > limit) return;
  await unlink(path).catch(() => {});
}

async function resolveProjectRoot(cwd, allowStateFallback = false) {
  const navigationRoot = resolve(cwd);
  const canonicalCwd = await realpath(navigationRoot);
  const cwdInfo = await lstat(canonicalCwd);
  if (!cwdInfo.isDirectory() || cwdInfo.isSymbolicLink()) return null;

  const gitRoot = await gitWorktreeRoot(canonicalCwd);
  if (gitRoot !== null) return safeRoot(gitRoot);

  for (let candidate = canonicalCwd; ;) {
    const status = await inspectInstallation("project", candidate);
    if (status === "unsafe") return null;
    if (status === "valid") return safeRoot(candidate);
    if (allowStateFallback && await readActiveState(candidate) !== null) {
      return safeRoot(candidate);
    }
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

async function gitWorktreeRoot(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    const root = stdout.trim();
    return root ? resolve(root) : null;
  } catch (error) {
    if (error?.code === 128 || error?.code === "ENOENT") return null;
    throw error;
  }
}

async function safeRoot(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(absolute) !== absolute) {
    return null;
  }
  const gitBoundary = await lstat(resolve(absolute, ".git")).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  return gitBoundary?.isSymbolicLink() ? null : absolute;
}

async function readActiveState(root) {
  const content = await readBoundedNoFollowFile(resolve(root, STATE_PATH), STATE_LIMIT);
  if (content === null) return null;

  let state;
  try {
    state = JSON.parse(content.toString("utf8"));
  } catch {
    return null;
  }
  if (!validState(state) || state.status !== "active") return null;
  return state;
}

function validState(state) {
  if (!isObject(state) ||
      state.schema !== "csx.workflow-state" ||
      state.version !== 1 ||
      !["active", "terminal"].includes(state.status) ||
      !WORKFLOW_ARTIFACT_PREFIX.has(state.workflow) ||
      typeof state.instanceToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(state.instanceToken) ||
      !validLabel(state.phase) ||
      !validArtifactPath(state.artifact, WORKFLOW_ARTIFACT_PREFIX.get(state.workflow)) ||
      typeof state.artifactSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(state.artifactSha256) ||
      !validTimestamp(state.startedAt) ||
      !validTimestamp(state.updatedAt)) {
    return false;
  }
  const expectedKeys = state.status === "active" ? ACTIVE_STATE_KEYS : TERMINAL_STATE_KEYS;
  if (!sameKeys(state, expectedKeys)) return false;
  return state.status === "active" ||
    (validTimestamp(state.finishedAt) && TERMINAL_OUTCOMES.has(state.terminalOutcome));
}

async function artifactIsCurrent(root, state) {
  const absolute = resolve(root, ...state.artifact.split("/"));
  if (!isContained(root, absolute)) return false;
  const beforePath = await lstat(absolute).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!beforePath?.isFile() || beforePath.isSymbolicLink()) return false;
  if (await realpath(absolute) !== absolute) return false;

  const handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const beforeDescriptor = await handle.stat();
    if (!beforeDescriptor.isFile() ||
        beforeDescriptor.dev !== beforePath.dev ||
        beforeDescriptor.ino !== beforePath.ino ||
        beforeDescriptor.size > ARTIFACT_LIMIT) {
      return false;
    }
    const content = await handle.readFile();
    if (content.length > ARTIFACT_LIMIT) return false;
    const [afterDescriptor, afterPath, afterCanonical] = await Promise.all([
      handle.stat(),
      lstat(absolute).catch(() => null),
      realpath(absolute).catch(() => null),
    ]);
    if (!afterPath?.isFile() ||
        afterPath.isSymbolicLink() ||
        afterDescriptor.dev !== beforeDescriptor.dev ||
        afterDescriptor.ino !== beforeDescriptor.ino ||
        afterDescriptor.size !== beforeDescriptor.size ||
        afterDescriptor.mtimeMs !== beforeDescriptor.mtimeMs ||
        afterDescriptor.ctimeMs !== beforeDescriptor.ctimeMs ||
        afterPath.dev !== beforeDescriptor.dev ||
        afterPath.ino !== beforeDescriptor.ino ||
        afterCanonical !== absolute ||
        content.length !== afterDescriptor.size) {
      return false;
    }
    return createHash("sha256").update(content).digest("hex") === state.artifactSha256;
  } finally {
    await handle.close();
  }
}

async function readBoundedNoFollowFile(path, limit) {
  const pathInfo = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (pathInfo === null) return null;
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.size > limit) return null;
  if (await realpath(path) !== path) return null;

  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorInfo = await handle.stat();
    if (!descriptorInfo.isFile() ||
        descriptorInfo.dev !== pathInfo.dev ||
        descriptorInfo.ino !== pathInfo.ino ||
        descriptorInfo.size > limit) {
      return null;
    }
    const content = await handle.readFile();
    if (content.length > limit) return null;
    const [afterDescriptor, afterPath] = await Promise.all([
      handle.stat(),
      lstat(path).catch(() => null),
    ]);
    if (!afterPath?.isFile() ||
        afterPath.isSymbolicLink() ||
        afterDescriptor.dev !== descriptorInfo.dev ||
        afterDescriptor.ino !== descriptorInfo.ino ||
        afterDescriptor.size !== descriptorInfo.size ||
        afterDescriptor.mtimeMs !== descriptorInfo.mtimeMs ||
        afterDescriptor.ctimeMs !== descriptorInfo.ctimeMs ||
        afterPath.dev !== descriptorInfo.dev ||
        afterPath.ino !== descriptorInfo.ino ||
        content.length !== afterDescriptor.size) {
      return null;
    }
    return content;
  } finally {
    await handle.close();
  }
}

function formatRestoreContext(state) {
  const additionalContext =
    `Restore the active ${state.workflow} workflow at phase ${JSON.stringify(state.phase)} ` +
    `from the repository-relative artifact ${JSON.stringify(state.artifact)}. ` +
    "Read that artifact before continuing the workflow.";
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  })}\n`;
}

function parsePayload(raw) {
  if (raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function topLevelKeyCounts(source) {
  const recognized = new Set(["status", "reason_code", "failure_detail"]);
  try {
    let index = skipWhitespace(source, 0);
    if (source[index++] !== "{") return null;
    const counts = new Map();
    index = skipWhitespace(source, index);
    if (source[index] === "}") return counts;
    while (index < source.length) {
      const keyEnd = scanString(source, index);
      const key = JSON.parse(source.slice(index, keyEnd));
      index = skipWhitespace(source, keyEnd);
      if (source[index++] !== ":") return null;
      index = skipJsonValue(source, skipWhitespace(source, index));
      if (recognized.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      index = skipWhitespace(source, index);
      if (source[index] === "}") return counts;
      if (source[index++] !== ",") return null;
      index = skipWhitespace(source, index);
    }
  } catch {
    return null;
  }
  return null;
}

function skipJsonValue(source, index) {
  const character = source[index];
  if (character === "\"") return scanString(source, index);
  if (character === "{") return skipContainer(source, index, "{", "}");
  if (character === "[") return skipContainer(source, index, "[", "]");
  const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(index));
  if (!match) throw new Error("invalid JSON");
  return index + match[0].length;
}

function skipContainer(source, index, openCharacter, closeCharacter) {
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "\"") {
      index = scanString(source, index) - 1;
    } else if (source[index] === openCharacter) {
      depth += 1;
    } else if (source[index] === closeCharacter && --depth === 0) {
      return index + 1;
    } else if (openCharacter === "{" && source[index] === "[") {
      index = skipContainer(source, index, "[", "]") - 1;
    } else if (openCharacter === "[" && source[index] === "{") {
      index = skipContainer(source, index, "{", "}") - 1;
    }
  }
  throw new Error("unterminated JSON");
}

function scanString(source, index) {
  if (source[index++] !== "\"") throw new Error("expected JSON string");
  for (; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === "\"") return index + 1;
  }
  throw new Error("unterminated JSON string");
}

function skipWhitespace(source, index) {
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validLabel(value) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validArtifactPath(value, prefix) {
  return typeof value === "string" &&
    value.length <= 1024 &&
    value.startsWith(prefix) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isContained(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function readAll(stream) {
  return new Promise((resolveRead, rejectRead) => {
    let data = "";
    let length = 0;
    let oversized = false;
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      length += Buffer.byteLength(chunk, "utf8");
      if (length <= HOOK_INPUT_LIMIT) data += chunk;
      else oversized = true;
    });
    stream.once("error", rejectRead);
    stream.once("end", () => {
      if (oversized) rejectRead(new Error("hook input is too large"));
      else resolveRead(data);
    });
  });
}
