import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { resolveProjectContext } from "./project-context.js";
import {
  classifyLocalFilesystem,
  loadLockCapability,
  rootIdentity
} from "./transaction-lock.js";

export const WORKFLOW_REQUEST_LIMIT = 65_536;
export const WORKFLOW_STATE_LIMIT = 65_536;
export const WORKFLOW_ARTIFACT_LIMIT = 1_048_576;
export const WORKFLOW_STATE_PATH = ".csx/workflow-state-v1.json";

const RESULT_SCHEMA = "csx.workflow-result";
const STATE_SCHEMA = "csx.workflow-state";
const ALLOWED_WORKFLOWS = new Map([
  ["csx-plan-pro", ".csx/plans/"],
  ["csx-start-goal", ".csx/goals/"]
]);
const ALLOWED_OUTCOMES = new Set(["approved", "blocked", "complete", "stopped"]);
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
  "workflow"
].sort();
const TERMINAL_STATE_KEYS = [...ACTIVE_STATE_KEYS, "finishedAt", "terminalOutcome"].sort();
const LOCK_ATTEMPTS = 200;
const LOCK_RETRY_MS = 10;

class WorkflowStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowStateError";
    this.code = code;
  }
}

export async function runWorkflowOperation(operation, request, options = {}) {
  try {
    if (!["begin", "checkpoint", "finish"].includes(operation)) {
      throw failure("invalid_operation", "workflow operation must be begin, checkpoint, or finish");
    }
    validateRequestObject(request);
    const context = await resolveWorkflowProjectContext(
      options.cwd,
      request.projectRoot
    );
    const result = await withStateLock(context.root, async () => {
      if (operation === "begin") return begin(context.root, request, options.now);
      if (operation === "checkpoint") return checkpoint(context.root, request, options.now);
      return finish(context.root, request, options.now);
    });
    return successResult(operation, result);
  } catch (error) {
    return errorResult(operation, error);
  }
}

export async function readWorkflowState({
  cwd = process.cwd(),
  projectRoot
} = {}) {
  try {
    const context = await resolveWorkflowProjectContext(cwd, projectRoot);
    const state = await readStateFile(context.root);
    if (state === null) return { ok: false, code: "state_missing" };
    const artifact = await inspectArtifact(context.root, state.workflow, state.artifact);
    if (artifact.sha256 !== state.artifactSha256) {
      return { ok: false, code: "artifact_drift", state: publicState(state) };
    }
    return { ok: true, code: "state_current", state: publicState(state) };
  } catch (error) {
    return { ok: false, code: workflowErrorCode(error) };
  }
}

export async function readBoundedJson(input, limit = WORKFLOW_REQUEST_LIMIT) {
  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > limit) throw failure("request_too_large", `workflow request exceeds ${limit} bytes`);
    chunks.push(buffer);
  }
  if (length === 0) throw failure("request_malformed", "workflow request is empty");
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  } catch {
    throw failure("request_malformed", "workflow request is not valid JSON");
  }
}

export function workflowErrorResult(operation, error) {
  return errorResult(operation, error);
}

function resolveWorkflowProjectContext(cwd, projectRoot) {
  return resolveProjectContext({
    cwd,
    projectRoot,
    requireSafeGitAuthority: true
  });
}

async function begin(root, request, now) {
  requireKeys(request, ["workflow", "phase", "artifact"]);
  const artifact = await inspectArtifact(root, request.workflow, request.artifact);
  const timestamp = timestampFrom(now);
  const state = {
    schema: STATE_SCHEMA,
    version: 1,
    status: "active",
    instanceToken: randomBytes(32).toString("base64url"),
    workflow: request.workflow,
    phase: validateLabel(request.phase, "phase"),
    artifact: artifact.path,
    artifactSha256: artifact.sha256,
    startedAt: timestamp,
    updatedAt: timestamp
  };
  await writeStateFile(root, state);
  return state;
}

async function checkpoint(root, request, now) {
  requireKeys(request, ["token", "phase", "artifact"]);
  const state = await activeStateForToken(root, request.token);
  if (!state) return null;
  if (request.artifact !== state.artifact) {
    throw failure("artifact_mismatch", "checkpoint artifact does not match the active workflow");
  }
  const artifact = await inspectArtifact(root, state.workflow, request.artifact);
  const updated = {
    ...state,
    phase: validateLabel(request.phase, "phase"),
    artifactSha256: artifact.sha256,
    updatedAt: timestampFrom(now)
  };
  await writeStateFile(root, updated);
  return updated;
}

async function finish(root, request, now) {
  requireKeys(request, ["token", "phase", "artifact", "outcome"]);
  const state = await activeStateForToken(root, request.token);
  if (!state) return null;
  if (request.artifact !== state.artifact) {
    throw failure("artifact_mismatch", "finish artifact does not match the active workflow");
  }
  if (!ALLOWED_OUTCOMES.has(request.outcome)) {
    throw failure("invalid_outcome", "finish outcome is not supported");
  }
  const artifact = await inspectArtifact(root, state.workflow, request.artifact);
  const timestamp = timestampFrom(now);
  const updated = {
    ...state,
    status: "terminal",
    phase: validateLabel(request.phase, "phase"),
    artifactSha256: artifact.sha256,
    updatedAt: timestamp,
    finishedAt: timestamp,
    terminalOutcome: request.outcome
  };
  await writeStateFile(root, updated);
  return updated;
}

async function activeStateForToken(root, token) {
  validateToken(token);
  const state = await readStateFile(root);
  if (state === null || state.status !== "active" || state.instanceToken !== token) return null;
  return state;
}

async function inspectArtifact(root, workflow, artifactPath) {
  const prefix = ALLOWED_WORKFLOWS.get(workflow);
  if (!prefix) throw failure("workflow_not_allowed", "workflow is not allowed to create canonical state");
  const path = validateArtifactPath(artifactPath, prefix);
  const absolute = resolve(root, ...path.split("/"));
  if (!isContained(root, absolute)) throw failure("artifact_escape", "artifact escapes the canonical project root");

  const pathInfo = await lstat(absolute).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!pathInfo?.isFile() || pathInfo.isSymbolicLink()) {
    throw failure("artifact_unsafe", "artifact must be a no-follow regular file");
  }
  const canonical = await realpath(absolute);
  if (canonical !== absolute || !isContained(root, canonical)) {
    throw failure("artifact_unsafe", "artifact contains a symlink boundary");
  }

  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const descriptorInfo = await handle.stat();
    if (!descriptorInfo.isFile() ||
        descriptorInfo.dev !== pathInfo.dev ||
        descriptorInfo.ino !== pathInfo.ino) {
      throw failure("artifact_unsafe", "artifact identity changed during validation");
    }
    if (descriptorInfo.size > WORKFLOW_ARTIFACT_LIMIT) {
      throw failure("artifact_too_large", `artifact exceeds ${WORKFLOW_ARTIFACT_LIMIT} bytes`);
    }
    const content = await handle.readFile();
    if (content.length > WORKFLOW_ARTIFACT_LIMIT) {
      throw failure("artifact_too_large", `artifact exceeds ${WORKFLOW_ARTIFACT_LIMIT} bytes`);
    }
    const [afterDescriptor, afterPath, afterCanonical] = await Promise.all([
      handle.stat(),
      lstat(absolute).catch(() => null),
      realpath(absolute).catch(() => null)
    ]);
    if (!afterPath?.isFile() || afterPath.isSymbolicLink() ||
        afterDescriptor.dev !== descriptorInfo.dev ||
        afterDescriptor.ino !== descriptorInfo.ino ||
        afterDescriptor.size !== descriptorInfo.size ||
        afterDescriptor.mtimeMs !== descriptorInfo.mtimeMs ||
        afterDescriptor.ctimeMs !== descriptorInfo.ctimeMs ||
        afterPath.dev !== descriptorInfo.dev ||
        afterPath.ino !== descriptorInfo.ino ||
        afterCanonical !== absolute ||
        content.length !== afterDescriptor.size) {
      throw failure("artifact_changed", "artifact changed during validation");
    }
    return {
      path,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  } finally {
    await handle?.close();
  }
}

async function readStateFile(root) {
  const path = resolve(root, WORKFLOW_STATE_PATH);
  const info = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > WORKFLOW_STATE_LIMIT) {
    throw failure("state_unsafe", "workflow state must be a bounded no-follow regular file");
  }
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorInfo = await handle.stat();
    if (!descriptorInfo.isFile() ||
        descriptorInfo.dev !== info.dev ||
        descriptorInfo.ino !== info.ino ||
        descriptorInfo.size > WORKFLOW_STATE_LIMIT) {
      throw failure("state_unsafe", "workflow state identity is unsafe");
    }
    const content = await handle.readFile();
    if (content.length > WORKFLOW_STATE_LIMIT) {
      throw failure("state_unsafe", "workflow state exceeds its size limit");
    }
    let state;
    try {
      state = JSON.parse(content.toString("utf8"));
    } catch {
      throw failure("state_malformed", "workflow state is not valid JSON");
    }
    validateState(state);
    return state;
  } finally {
    await handle.close();
  }
}

async function writeStateFile(root, state) {
  const directory = resolve(root, ".csx");
  await ensureStateDirectory(root, directory);
  const path = resolve(root, WORKFLOW_STATE_PATH);
  const temporary = resolve(directory, ".workflow-state-v1.tmp");
  const content = Buffer.from(`${JSON.stringify(state)}\n`);
  if (content.length > WORKFLOW_STATE_LIMIT) {
    throw failure("state_too_large", "workflow state exceeds its size limit");
  }

  await unlink(temporary).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  const handle = await open(
    temporary,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
  await syncDirectory(directory);
}

async function withStateLock(root, action) {
  const canonicalRoot = await rootIdentity(root);
  if (canonicalRoot !== root) throw failure("state_root_unsafe", "workflow state root identity is unsafe");
  const capability = loadLockCapability();
  const classification = await classifyLocalFilesystem(canonicalRoot);
  if (classification.path !== canonicalRoot) {
    throw failure("state_lock_unavailable", "workflow state filesystem identity is unsafe");
  }

  const directory = resolve(root, ".csx");
  await ensureStateDirectory(root, directory);
  const lockPath = resolve(directory, ".workflow-state-v1.lock");
  let handle;
  let created = false;
  try {
    try {
      handle = await open(
        lockPath,
        fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600
      );
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      handle = await open(lockPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
    }
    if (created) await handle.chmod(0o600);
    await validateLockAnchor(lockPath, handle);

    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      try {
        await nativeLock(capability, handle, "exnb");
        break;
      } catch (error) {
        if (!isLockBusy(error)) {
          throw failure("state_lock_unavailable", "native workflow state locking failed");
        }
        if (attempt === LOCK_ATTEMPTS - 1) throw failure("state_busy", "workflow state is busy");
        await delay(LOCK_RETRY_MS);
      }
    }

    try {
      const currentClassification = await classifyLocalFilesystem(canonicalRoot);
      if (await rootIdentity(root) !== canonicalRoot ||
          !sameFilesystem(classification, currentClassification)) {
        throw failure("state_root_unsafe", "workflow state root changed while locked");
      }
      await validateLockAnchor(lockPath, handle);
      return await action();
    } finally {
      await nativeLock(capability, handle, "un");
    }
  } finally {
    await handle?.close();
  }
}

async function validateLockAnchor(path, handle) {
  const [pathInfo, descriptorInfo] = await Promise.all([lstat(path), handle.stat()]);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() ||
      !descriptorInfo.isFile() ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      pathInfo.dev !== descriptorInfo.dev ||
      pathInfo.ino !== descriptorInfo.ino) {
    throw failure("state_lock_unsafe", "workflow state lock anchor is unsafe");
  }
}

function nativeLock(capability, handle, operation) {
  return new Promise((resolveLock, rejectLock) => {
    capability.lock(handle.fd, operation, (error) => {
      if (error) rejectLock(error);
      else resolveLock();
    });
  });
}

function isLockBusy(error) {
  return ["EAGAIN", "EACCES", "EBUSY"].includes(error?.code);
}

function sameFilesystem(expected, current) {
  return expected.platform === current.platform &&
    expected.path === current.path &&
    expected.mountPoint === current.mountPoint &&
    expected.type === current.type &&
    expected.magic === current.magic;
}

async function ensureStateDirectory(root, directory) {
  let info = await lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) {
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    info = await lstat(directory);
  }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory ||
      !isContained(root, directory)) {
    throw failure("state_directory_unsafe", "workflow state directory is unsafe");
  }
}

function validateRequestObject(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw failure("request_malformed", "workflow request must be a JSON object");
  }
  if (request.version !== 1) throw failure("unsupported_version", "workflow request version must be 1");
}

function requireKeys(request, keys) {
  for (const key of keys) {
    if (!(key in request)) throw failure("request_malformed", `workflow request is missing ${key}`);
  }
}

function validateLabel(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw failure(`invalid_${name}`, `${name} must be 1-128 printable characters`);
  }
  return value;
}

function validateToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw failure("invalid_token", "workflow token is malformed");
  }
}

function validateArtifactPath(value, prefix) {
  if (typeof value !== "string" || value.length > 1024 || !value.startsWith(prefix) ||
      value.includes("\\") || value.includes("\0") || value.startsWith("/") ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw failure("artifact_escape", "artifact path is not an allowed repository-relative path");
  }
  return value;
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      state.schema !== STATE_SCHEMA || state.version !== 1 ||
      !["active", "terminal"].includes(state.status) ||
      !ALLOWED_WORKFLOWS.has(state.workflow)) {
    throw failure("state_malformed", "workflow state schema is invalid");
  }
  const expectedKeys = state.status === "active" ? ACTIVE_STATE_KEYS : TERMINAL_STATE_KEYS;
  const keys = Object.keys(state).sort();
  if (keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])) {
    throw failure("state_malformed", "workflow state keys are invalid");
  }
  validateToken(state.instanceToken);
  validateLabel(state.phase, "phase");
  validateArtifactPath(state.artifact, ALLOWED_WORKFLOWS.get(state.workflow));
  if (!/^[a-f0-9]{64}$/.test(state.artifactSha256) ||
      !validTimestamp(state.startedAt) ||
      !validTimestamp(state.updatedAt)) {
    throw failure("state_malformed", "workflow state fields are invalid");
  }
  if (state.status === "terminal" &&
      (!validTimestamp(state.finishedAt) || !ALLOWED_OUTCOMES.has(state.terminalOutcome))) {
    throw failure("state_malformed", "terminal workflow state is invalid");
  }
}

function successResult(operation, state) {
  if (state === null) {
    return {
      schema: RESULT_SCHEMA,
      version: 1,
      ok: false,
      operation,
      code: "token_mismatch"
    };
  }
  return {
    schema: RESULT_SCHEMA,
    version: 1,
    ok: true,
    operation,
    code: "state_updated",
    token: state.instanceToken,
    state: publicState(state)
  };
}

function publicState(state) {
  const result = {
    status: state.status,
    workflow: state.workflow,
    phase: state.phase,
    artifact: state.artifact,
    artifactSha256: state.artifactSha256,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt
  };
  if (state.status === "terminal") {
    result.finishedAt = state.finishedAt;
    result.terminalOutcome = state.terminalOutcome;
  }
  return result;
}

function errorResult(operation, error) {
  return {
    schema: RESULT_SCHEMA,
    version: 1,
    ok: false,
    operation: typeof operation === "string" ? operation : "unknown",
    code: workflowErrorCode(error)
  };
}

function workflowErrorCode(error) {
  if (error instanceof WorkflowStateError) return error.code;
  if (error?.code === "invalid_operation") return error.code;
  if (error?.code === "lock_capability_unavailable") return "state_lock_unavailable";
  if (error?.code === "lock_filesystem_unsupported") return "state_lock_unsupported";
  if (error?.code === "ENOENT") return "path_missing";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "permission_denied";
  return "state_unavailable";
}

function failure(code, message) {
  return new WorkflowStateError(code, message);
}

function timestampFrom(now) {
  const value = typeof now === "function" ? now() : new Date();
  const timestamp = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!validTimestamp(timestamp)) throw failure("invalid_timestamp", "workflow timestamp is invalid");
  return timestamp;
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isContained(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
