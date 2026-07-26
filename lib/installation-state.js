import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export const RECEIPT_NAME = ".csx-install-receipt.json";

/** Resolves a path only when every existing component is a non-link beneath root. */
export async function assertSafeContainment(root, path, { allowAbsent = true } = {}) {
  const requestedRoot = resolve(root);
  const absolute = resolve(path);
  if (!within(requestedRoot, absolute)) throw new Error(`path escapes installation root: ${path}`);
  const canonicalRoot = await realpath(requestedRoot).catch((cause) => {
    if (cause?.code === "ENOENT") return requestedRoot;
    throw cause;
  });
  if (!within(canonicalRoot, absolute)) throw new Error(`path escapes installation root: ${path}`);
  const components = [];
  for (let probe = absolute; ; probe = dirname(probe)) {
    components.push(probe);
    if (probe === requestedRoot || probe === dirname(probe)) break;
  }
  let found = false;
  for (const probe of components.reverse()) {
    const entry = await lstat(probe).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (!entry) {
      if (found && !allowAbsent) throw new Error(`path does not exist: ${path}`);
      continue;
    }
    found = true;
    if (entry.isSymbolicLink()) throw new Error(`symlink or junction is not allowed in installation path: ${probe}`);
    const canonical = await realpath(probe);
    if (!within(canonicalRoot, canonical)) throw new Error(`resolved path escapes installation root: ${path}`);
  }
  if (!found && !allowAbsent) throw new Error(`path does not exist: ${path}`);
  return absolute;
}

/** Reads an existing receipt through a no-follow descriptor and proves its path identity. */
export async function readInstallationReceipt({ root, receiptPath }) {
  await assertSafeContainment(root, receiptPath, { allowAbsent: false });
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new Error("no-follow receipt reads are unavailable on this platform");
  let handle;
  try {
    handle = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [info, data, pathInfo] = await Promise.all([handle.stat(), handle.readFile(), lstat(receiptPath)]);
    if (!info.isFile() || pathInfo.isSymbolicLink() || info.dev !== pathInfo.dev || info.ino !== pathInfo.ino) {
      throw new Error(`installation receipt changed or is not a regular file: ${receiptPath}`);
    }
    return { data, mode: info.mode & 0o777 };
  } finally {
    await handle?.close();
  }
}

/** Describes a receipt-owned target plus exact absent upgrade additions. */
export async function existingInstallationTarget({ root, configPath, receiptPath, expectedFiles, additions = [] } = {}) {
  if (!Array.isArray(expectedFiles)) throw new Error("existing installation target requires expected package paths");
  if (!Array.isArray(additions)) throw new Error("existing installation target additions must be an array");
  const receiptSnapshot = await readInstallationReceipt({ root, receiptPath });
  let receipt;
  try {
    receipt = JSON.parse(receiptSnapshot.data.toString("utf8"));
  } catch {
    throw new Error(`invalid csx installation receipt: ${receiptPath}`);
  }
  if (!receipt || resolve(receipt.root) !== resolve(root)) throw new Error(`installation receipt root mismatch: ${receiptPath}`);
  if (!Array.isArray(receipt.files)) throw new Error(`installation receipt files are invalid: ${receiptPath}`);
  const received = receipt.files.map((path) => {
    if (typeof path !== "string") throw new Error(`installation receipt files are invalid: ${receiptPath}`);
    return resolve(path);
  }).sort();
  const expected = [...new Set(expectedFiles.map((path) => resolve(path)))].sort();
  if (expected.length !== expectedFiles.length || received.length !== new Set(received).size || received.length !== expected.length || received.some((path, index) => path !== expected[index])) {
    throw new Error(`receipt does not match the installed package paths: ${receiptPath}`);
  }
  const owned = new Set([...expected, configPath, receiptPath].map((path) => resolve(path)));
  const resolvedAdditions = additions.map((path) => {
    if (typeof path !== "string") throw new Error("existing installation target additions must contain paths");
    return resolve(path);
  }).sort();
  if (resolvedAdditions.length !== new Set(resolvedAdditions).size) throw new Error("existing installation target additions must be unique");
  for (const path of resolvedAdditions) {
    await assertSafeContainment(root, path);
    if (owned.has(path)) throw new Error(`existing installation target addition overlaps an owned path: ${path}`);
    const entry = await lstat(path).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (entry) throw new Error(`existing installation target addition must be absent: ${path}`);
  }
  for (const path of owned) {
    await assertSafeContainment(root, path, { allowAbsent: false });
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`installation path is not a regular file: ${path}`);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.close();
  }
  const frozenAdditions = Object.freeze([...resolvedAdditions]);
  return Object.freeze({ role: "existing-installation-target", root: resolve(root), configPath: resolve(configPath), receiptPath: resolve(receiptPath), receipt, receiptSnapshot: { state: "present", data: receiptSnapshot.data.toString("base64"), hash: digest(receiptSnapshot.data), mode: receiptSnapshot.mode }, paths: [...owned, ...frozenAdditions].sort(), additions: frozenAdditions });
}

/** Describes the only permissible receipt-less target: a fresh install's exact destinations. */
export async function prospectiveInstallationTarget({ operation, root, configPath, receiptPath, payloadPaths }) {
  if (operation !== "install") throw new Error("prospective installation targets are valid only for install");
  if (!Array.isArray(payloadPaths) || payloadPaths.length === 0) throw new Error("prospective installation target requires planned payload paths");
  const paths = [...new Set([...payloadPaths, configPath, receiptPath].map((path) => resolve(path)))].sort();
  if (paths.length !== payloadPaths.length + 2) throw new Error("prospective installation paths must be unique");
  const preimages = {};
  for (const path of paths) {
    await assertSafeContainment(root, path);
    const info = await stat(path).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (!info) { preimages[path] = { state: "absent" }; continue; }
    if (path === resolve(configPath)) {
      const data = await readFile(path);
      preimages[path] = { state: "present", data: data.toString("base64"), hash: digest(data), mode: info.mode & 0o777 };
      continue;
    }
    throw new Error(`refusing unmanaged collision at prospective installation path: ${path}`);
  }
  return Object.freeze({ role: "prospective-installation-target", root: resolve(root), configPath: resolve(configPath), receiptPath: resolve(receiptPath), paths, preimages });
}

/** Metadata has no installation ownership and can only be attached to a declared union. */
export async function metadataParticipant({ root, paths, schema = { version: 1, type: "csx-metadata" } }) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("metadata participant requires exact paths");
  if (!schema || schema.version !== 1 || schema.type !== "csx-metadata") throw new Error("metadata participant schema is invalid");
  for (const path of paths) await assertSafeContainment(root, path);
  return Object.freeze({ role: "metadata-participant", root: resolve(root), schema: structuredClone(schema), paths: [...new Set(paths.map((path) => resolve(path)))].sort() });
}
function within(root, path) { const rel = relative(resolve(root), resolve(path)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`${sep}..${sep}`)); }
function digest(data) { return createHash("sha256").update(data).digest("hex"); }
