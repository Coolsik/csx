import { homedir } from "node:os";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  classifyInstallationAuthority,
  installationLayout,
  resolveProjectContext
} from "./project-context.js";
import { readWorkflowState } from "./workflow-state.js";

export const DIAGNOSTICS_SCHEMA = "csx.diagnostics";
export const DIAGNOSTIC_EVENT_SCHEMA = "csx.diagnostic-event";
export const DIAGNOSTICS_VERSION = 1;
export const DIAGNOSTICS_DIRECTORY = ".csx/diagnostics-v1";
export const DIAGNOSTIC_TRAILER_PREFIX = "<!-- csx-metrics:v1 ";
export const DIAGNOSTIC_TRAILER_MAX_BYTES = 6_144;
export const DIAGNOSTIC_EVENT_MAX_BYTES = 4_096;
export const DIAGNOSTIC_EVENT_COUNT = 2_304;
export const DIAGNOSTIC_TEMP_COUNT = 64;
export const DIAGNOSTIC_NAMESPACE_MAX_BYTES =
  DIAGNOSTIC_EVENT_COUNT * DIAGNOSTIC_EVENT_MAX_BYTES +
  DIAGNOSTIC_TEMP_COUNT * DIAGNOSTIC_EVENT_MAX_BYTES;
export const DIAGNOSTIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const DIAGNOSTIC_ROLES = Object.freeze([
  "csx-analyst",
  "csx-architect",
  "csx-code-reviewer",
  "csx-critic",
  "csx-executor",
  "csx-explorer",
  "csx-planner"
]);

const RECOGNIZED = new Set(["status", "reason_code", "failure_detail"]);
const STATUSES = new Set(["completed", "blocked", "failed", "terminated"]);
const EVENT_KEYS = new Set([
  "schema", "version", "timestamp", "workflow", "phase", "role",
  "status", "reason_code", "failure_detail"
]);

/** Parse only the exact final nonempty metrics line. Invalid fields fail independently. */
export function parseDiagnosticTrailer(response) {
  if (typeof response !== "string") return {};
  const lines = response.split(/\r?\n/);
  let line = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].length !== 0) {
      line = lines[index];
      break;
    }
  }
  if (!line ||
      Buffer.byteLength(line, "utf8") > DIAGNOSTIC_TRAILER_MAX_BYTES ||
      !line.startsWith(DIAGNOSTIC_TRAILER_PREFIX) ||
      !line.endsWith(" -->")) {
    return {};
  }
  const source = line.slice(DIAGNOSTIC_TRAILER_PREFIX.length, -4);
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return {};
  }
  if (!isObject(value)) return {};

  const counts = topLevelKeyCounts(source);
  if (counts === null) return {};
  const event = {};
  if (counts.get("status") === 1 && STATUSES.has(value.status)) {
    event.status = value.status;
  }
  if (counts.get("reason_code") === 1 &&
      typeof value.reason_code === "string" &&
      /^[a-z0-9_]{1,64}$/.test(value.reason_code)) {
    event.reason_code = value.reason_code;
  }
  if (event.reason_code &&
      counts.get("failure_detail") === 1 &&
      typeof value.failure_detail === "string" &&
      Buffer.byteLength(value.failure_detail, "utf8") <= 2_048) {
    event.failure_detail = value.failure_detail;
  }
  return event;
}

/**
 * Read project-local diagnostics under the same project-over-global authority
 * rule as the installed hook.
 */
export async function readLocalDiagnostics({
  cwd = process.cwd(),
  codexHome = process.env.CODEX_HOME,
  now = Date.now()
} = {}) {
  const context = await resolveProjectContext({
    cwd,
    proveReceipt: async (candidate) => {
      const status = await classifyInstallationAuthority("project", candidate);
      if (status === "unsafe") {
        throw new Error(`unsafe project csx installation authority: ${candidate}`);
      }
      if (status === "valid") return true;
      return (await readWorkflowState({ projectRoot: candidate })).ok;
    }
  });
  const project = installationLayout("project", context.root);
  const projectStatus = await classifyInstallationAuthority("project", context.root);
  let authority;
  if (projectStatus === "valid") {
    authority = project;
  } else if (projectStatus === "unsafe") {
    throw new Error(`unsafe project csx installation authority: ${project.receipt}`);
  } else {
    const globalRoot = resolve(codexHome || resolve(homedir(), ".codex"));
    const global = installationLayout("global", globalRoot);
    const globalStatus = await classifyInstallationAuthority("global", globalRoot);
    if (globalStatus === "unsafe") {
      throw new Error(`unsafe global csx installation authority: ${global.receipt}`);
    }
    authority = globalStatus === "valid" ? global : null;
  }

  const result = {
    schema: DIAGNOSTICS_SCHEMA,
    version: DIAGNOSTICS_VERSION,
    scope: authority?.scope ?? "global",
    events: []
  };
  if (authority === null) return result;
  result.events = await readEvents(context.root, now);
  return result;
}

async function readEvents(root, now) {
  const directory = resolve(root, DIAGNOSTICS_DIRECTORY);
  const directoryInfo = await lstat(directory).catch(missingAsNull);
  if (!directoryInfo?.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      await realpath(directory).catch(() => null) !== directory) {
    return [];
  }
  const names = await readdir(directory).catch(() => []);
  const events = [];
  for (const name of names.sort()) {
    if (!/^event-(?:0\d{3}|1\d{3}|2[0-2]\d{2}|230[0-3])\.json$/.test(name)) continue;
    const content = await readSafeFile(resolve(directory, name), DIAGNOSTIC_EVENT_MAX_BYTES);
    if (content === null) continue;
    let event;
    try {
      event = JSON.parse(content.toString("utf8"));
    } catch {
      continue;
    }
    if (!validStoredEvent(event, now)) continue;
    events.push(event);
  }
  return events.sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) ||
    left.role.localeCompare(right.role) ||
    left.workflow.localeCompare(right.workflow) ||
    left.phase.localeCompare(right.phase)
  );
}

function validStoredEvent(event, now) {
  if (!isObject(event) ||
      Object.keys(event).some((key) => !EVENT_KEYS.has(key)) ||
      event.schema !== DIAGNOSTIC_EVENT_SCHEMA ||
      event.version !== DIAGNOSTICS_VERSION ||
      typeof event.timestamp !== "string" ||
      !validBoundedTimestamp(event.timestamp, now) ||
      !["csx-plan-pro", "csx-start-goal"].includes(event.workflow) ||
      !validLabel(event.phase) ||
      !DIAGNOSTIC_ROLES.includes(event.role)) {
    return false;
  }
  return validStoredOptionalFields(event);
}

function validStoredOptionalFields(event) {
  if ("status" in event && !STATUSES.has(event.status)) return false;
  if ("reason_code" in event &&
      (typeof event.reason_code !== "string" || !/^[a-z0-9_]{1,64}$/.test(event.reason_code))) {
    return false;
  }
  if ("failure_detail" in event &&
      (!("reason_code" in event) ||
       typeof event.failure_detail !== "string" ||
       Buffer.byteLength(event.failure_detail, "utf8") > 2_048)) {
    return false;
  }
  return true;
}

function validBoundedTimestamp(value, now) {
  if (Buffer.byteLength(value, "utf8") > 32) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    timestamp <= now + 5 * 60 * 1_000 &&
    timestamp >= now - DIAGNOSTIC_MAX_AGE_MS;
}

async function readSafeFile(path, limit) {
  const before = await lstat(path).catch(missingAsNull);
  if (!before?.isFile() || before.isSymbolicLink() || before.size > limit) return null;
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => null);
  if (handle === null) return null;
  try {
    const descriptor = await handle.stat();
    if (!descriptor.isFile() ||
        descriptor.dev !== before.dev ||
        descriptor.ino !== before.ino ||
        descriptor.size > limit) return null;
    const content = await handle.readFile();
    const [afterDescriptor, afterPath, canonical] = await Promise.all([
      handle.stat(),
      lstat(path).catch(() => null),
      realpath(path).catch(() => null)
    ]);
    if (!afterPath?.isFile() || afterPath.isSymbolicLink() ||
        afterDescriptor.dev !== descriptor.dev ||
        afterDescriptor.ino !== descriptor.ino ||
        afterDescriptor.size !== descriptor.size ||
        afterDescriptor.mtimeMs !== descriptor.mtimeMs ||
        afterDescriptor.ctimeMs !== descriptor.ctimeMs ||
        afterPath.dev !== descriptor.dev ||
        afterPath.ino !== descriptor.ino ||
        canonical !== path ||
        content.length !== descriptor.size) return null;
    return content;
  } finally {
    await handle.close();
  }
}

function topLevelKeyCounts(source) {
  try {
    let index = skipWhitespace(source, 0);
    if (source[index++] !== "{") return null;
    const counts = new Map();
    index = skipWhitespace(source, index);
    if (source[index] === "}") return counts;
    while (index < source.length) {
      const keyToken = scanString(source, index);
      const key = JSON.parse(source.slice(index, keyToken));
      index = skipWhitespace(source, keyToken);
      if (source[index++] !== ":") return null;
      index = skipJsonValue(source, skipWhitespace(source, index));
      if (RECOGNIZED.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
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

function validLabel(value) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function missingAsNull(error) {
  if (error?.code === "ENOENT") return null;
  throw error;
}
