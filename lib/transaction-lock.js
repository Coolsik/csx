import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, stat, statfs } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const LOCK_PACKAGE = "fs-ext-extra-prebuilt";
const LOCK_VERSION = "2.2.9";
const CONTROL_DIRECTORY = ".csx-transactions";
const LINUX_LOCAL_FILESYSTEMS = new Map([
  ["ext2", 0xef53],
  ["ext3", 0xef53],
  ["ext4", 0xef53],
  ["xfs", 0x58465342],
  ["btrfs", 0x9123683e],
  ["tmpfs", 0x01021994],
  ["ramfs", 0x858458f6]
]);
const SUPPORTED_LINUX_ARCHITECTURES = new Set(["x64", "arm64"]);
const DARWIN_LOCAL_FILESYSTEM_TYPES = new Set([0x1c, 0x482b]);
let contentionProbe;

export class TransactionLockError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "TransactionLockError";
    this.code = code;
  }
}

/** Dynamically validates the exact optional native locking capability. Performs no writes. */
export function loadLockCapability() {
  let binding;
  let manifest;
  try {
    manifest = require(`${LOCK_PACKAGE}/package.json`);
    binding = require(LOCK_PACKAGE);
  } catch (cause) {
    throw new TransactionLockError("lock_capability_unavailable", "native transaction locking is unavailable", cause);
  }
  if (manifest?.name !== LOCK_PACKAGE || manifest.version !== LOCK_VERSION) {
    throw new TransactionLockError("lock_capability_unavailable", `native transaction locking must be ${LOCK_PACKAGE}@${LOCK_VERSION}`);
  }
  const lock = binding?.flock;
  if (typeof lock !== "function") {
    throw new TransactionLockError("lock_capability_unavailable", "native transaction locking requires the asynchronous flock API");
  }
  return { binding, lock, version: manifest.version };
}

/** Returns the root-local durable control directory without creating it. */
export function controlPath(root) {
  return resolve(root, CONTROL_DIRECTORY);
}

/**
 * Builds a fixture-injectable filesystem classifier. The production adapter uses
 * only Node APIs; it deliberately refuses platforms whose local-volume boundary
 * Node cannot prove.
 */
export function createFilesystemClassifier(fixtures = {}) {
  const operations = {
    readFile,
    stat,
    lstat,
    realpath,
    statfs,
    ...fixtures.operations
  };
  const platform = fixtures.platform ?? process.platform;
  const arch = fixtures.arch ?? process.arch;
  return async function classifyLocalFilesystem(path) {
    const absolute = resolve(path);
    const existing = await nearestExisting(absolute, operations.stat);
    const info = await operations.stat(existing);
    if (!info.isDirectory()) throw unsupported(`filesystem probe is not a directory: ${existing}`);
    if (platform === "linux") return classifyLinux(existing, arch, operations);
    if (platform === "darwin") return classifyDarwin(existing, operations);
    if (platform === "win32") return classifyWindows(path, existing, operations);
    throw unsupported(`unsupported platform for transaction locking: ${platform}/${arch}`);
  };
}

export const classifyLocalFilesystem = createFilesystemClassifier();

async function classifyLinux(path, arch, operations) {
  if (!SUPPORTED_LINUX_ARCHITECTURES.has(arch)) {
    throw unsupported(`unsupported Linux architecture for transaction locking: ${arch}`);
  }
  let mounts;
  let fileSystem;
  try {
    [mounts, fileSystem] = await Promise.all([operations.readFile("/proc/self/mountinfo", "utf8"), operations.statfs(path)]);
  } catch (cause) {
    throw unsupported("cannot positively classify transaction filesystem", cause);
  }
  const canonical = await operations.realpath(path).catch((cause) => { throw unsupported("cannot resolve transaction filesystem", cause); });
  const mount = parseMountinfo(mounts, canonical);
  const expectedMagic = LINUX_LOCAL_FILESYSTEMS.get(mount?.type);
  if (expectedMagic === undefined || mount.options.includes("bind") || mount.root !== "/" || Number(fileSystem.type) !== expectedMagic) {
    throw unsupported("transaction filesystem is not a supported unambiguous local Linux filesystem");
  }
  const magic = Number(fileSystem.type);
  return { platform: "linux", path: canonical, mountPoint: mount.mountPoint, type: mount.type, magic };
}

async function classifyDarwin(path, operations) {
  let fileSystem;
  try {
    fileSystem = await operations.statfs(path);
  } catch (cause) {
    throw unsupported("cannot classify macOS transaction filesystem", cause);
  }
  if (!DARWIN_LOCAL_FILESYSTEM_TYPES.has(Number(fileSystem.type))) {
    throw unsupported("transaction filesystem is not APFS or HFS");
  }
  // statfs reports APFS/HFS format, but Node exposes neither MNT_LOCAL nor a
  // mount source API. Format alone cannot distinguish an untrusted remote mount.
  throw unsupported("macOS APFS/HFS locality cannot be established by available Node/native APIs");
}

async function classifyWindows(requestedPath, path, operations) {
  if (/^(\\\\|\/\/)/.test(requestedPath)) throw unsupported("UNC transaction roots are unsupported");
  const info = await operations.lstat(path);
  if (info.isSymbolicLink()) throw unsupported("reparse transaction roots are unsupported");
  // Node does not expose GetDriveTypeW or GetFinalPathNameByHandleW, and this
  // package exposes flock rather than those Windows volume/final-path APIs.
  throw unsupported("Windows fixed-volume and final-path boundaries cannot be established by available Node/native APIs");
}

function parseMountinfo(text, target) {
  let best;
  for (const line of text.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    const mountPoint = unescapeMount(left[4]);
    if (!isContained(mountPoint, target)) continue;
    if (!best || mountPoint.length > best.mountPoint.length) best = { root: unescapeMount(left[3]), mountPoint, options: left[5]?.split(",") ?? [], type: right[0] };
  }
  return best;
}
function unescapeMount(value) { return value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\"); }
function unsupported(message, cause) { return new TransactionLockError("lock_filesystem_unsupported", message, cause); }

export async function rootIdentity(root) {
  const requestedRoot = resolve(root);
  const existingRoot = await nearestExisting(requestedRoot);
  const rootInfo = await lstat(existingRoot).catch((cause) => { throw unsupported("transaction root cannot be inspected", cause); });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw unsupported("transaction root is not a safe directory");
  return realpath(existingRoot).catch((cause) => { throw unsupported("transaction root cannot be resolved", cause); });
}

/** Creates an inert anchor only after capability and filesystem gates have passed. */
export async function acquireRootLock(root) {
  const canonicalRoot = await rootIdentity(root);
  const capability = loadLockCapability();
  const classification = await classifyLocalFilesystem(canonicalRoot);
  if (classification.path !== canonicalRoot) throw unsupported("transaction root identity does not match its filesystem probe");
  await verifyNativeContention(capability);
  const directory = controlPath(canonicalRoot);
  await ensureControlDirectory(directory);
  for (const name of ["journals", "terminals", "bridges", "cleanup"]) await ensureControlDirectory(resolve(directory, name));
  if (await rootIdentity(root) !== canonicalRoot) throw unsupported("transaction root identity changed during lock setup");
  const anchor = resolve(directory, `v1-${rootKey(canonicalRoot)}.lock`);
  let handle;
  try {
    handle = await open(anchor, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
    await chmod(anchor, 0o600);
    await handle.sync();
    await syncDirectory(directory);
  } catch (cause) {
    if (cause?.code !== "EEXIST") throw new TransactionLockError("lock_capability_unavailable", "cannot safely create transaction lock anchor", cause);
    handle = await open(anchor, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600).catch((openCause) => {
      throw new TransactionLockError("lock_capability_unavailable", "cannot safely open transaction lock anchor", openCause);
    });
  }
  try {
    const pathInfo = await lstat(anchor);
    const descriptorInfo = await handle.stat();
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || (pathInfo.mode & 0o777) !== 0o600 || pathInfo.dev !== descriptorInfo.dev || pathInfo.ino !== descriptorInfo.ino) throw unsupported("transaction lock anchor identity is unsafe");
    await nativeLock(capability, handle, "exnb");
  } catch (cause) {
    await handle.close();
    if (cause instanceof TransactionLockError) throw cause;
    if (isBusy(cause)) throw new TransactionLockError("lock_busy", "transaction lock is busy", cause);
    throw new TransactionLockError("lock_capability_unavailable", "native transaction locking failed", cause);
  }
  const rootDirectory = await stat(canonicalRoot);
  const identity = { dev: rootDirectory.dev, ino: rootDirectory.ino, filesystem: `${classification.platform}:${classification.mountPoint}:${classification.type}:${classification.magic}` };
  async function assertValid() {
    const current = await stat(canonicalRoot).catch((cause) => { throw new TransactionLockError("recovery_required", "transaction root is unavailable while locked", cause); });
    const currentClassification = await classifyLocalFilesystem(canonicalRoot);
    if (current.dev !== identity.dev || current.ino !== identity.ino || `${currentClassification.platform}:${currentClassification.mountPoint}:${currentClassification.type}:${currentClassification.magic}` !== identity.filesystem || await rootIdentity(canonicalRoot) !== canonicalRoot) {
      throw new TransactionLockError("recovery_required", "transaction root changed while locked");
    }
  }
  return { root: canonicalRoot, rootKey: rootKey(canonicalRoot), anchor, classification, identity, assertValid, async close() {
    try { await nativeLock(capability, handle, "un"); } finally { await handle.close(); }
  } };
}

async function nativeLock(capability, handle, operation) {
  return new Promise((resolveLock, rejectLock) => {
    capability.lock(handle.fd, operation, (error) => error ? rejectLock(error) : resolveLock());
  });
}

async function verifyNativeContention(capability) {
  if (!contentionProbe) {
    contentionProbe = runNativeContentionProbe(capability).catch((cause) => {
      contentionProbe = undefined;
      throw cause;
    });
  }
  return contentionProbe;
}

async function runNativeContentionProbe(capability) {
  let handle;
  try {
    handle = await open("/dev/null", "r");
    for (let attempt = 0;; attempt += 1) {
      try {
        await nativeLock(capability, handle, "exnb");
        break;
      } catch (cause) {
        if (!isBusy(cause) || attempt >= 99) throw cause;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    const script = `
      import { openSync } from "node:fs";
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const binding = require(process.argv[1]);
      const descriptor = openSync("/dev/null", "r");
      binding.flock(descriptor, "exnb", (error) => {
        process.stdout.write(error && ["EAGAIN", "EACCES", "EBUSY"].includes(error.code) ? "busy" : "acquired");
        process.exitCode = error ? 0 : 1;
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, require.resolve(LOCK_PACKAGE)], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "exit");
    if (code !== 0 || output !== "busy") {
      throw new TransactionLockError("lock_capability_unavailable", "native transaction locking did not contend across processes");
    }
  } catch (cause) {
    if (cause instanceof TransactionLockError) throw cause;
    throw new TransactionLockError("lock_capability_unavailable", "cannot verify native transaction lock contention", cause);
  } finally {
    if (handle) {
      try { await nativeLock(capability, handle, "un"); } finally { await handle.close(); }
    }
  }
}
function isBusy(error) { return ["EAGAIN", "EACCES", "EBUSY"].includes(error?.code); }
export function rootKey(root) { return Buffer.from(resolve(root)).toString("base64url"); }
export function isContained(root, candidate) { const rel = relative(resolve(root), resolve(candidate)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`${sep}..${sep}`)); }
async function ensureControlDirectory(path) {
  let existing;
  try { existing = await lstat(path); } catch (cause) { if (cause?.code !== "ENOENT") throw cause; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o700) throw unsupported("transaction control directory is unsafe");
    return;
  }
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  const created = await lstat(path);
  if (!created.isDirectory() || created.isSymbolicLink() || (created.mode & 0o777) !== 0o700) throw unsupported("transaction control directory is unsafe");
}
async function nearestExisting(path, statOperation = stat) {
  let current = path;
  for (;;) {
    const info = await statOperation(current).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (info) return current;
    const parent = dirname(current);
    if (parent === current) throw unsupported(`no existing parent for ${path}`);
    current = parent;
  }
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
