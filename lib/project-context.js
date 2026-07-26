import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RECEIPT_LIMIT = 65_536;
const CONFIG_LIMIT = 1_048_576;
const HOOK_LIMIT = 1_048_576;
const MANAGED_MARKERS = [
  "# >>> csx managed >>>",
  "# <<< csx managed <<<",
  "# >>> csx feature default_mode_request_user_input >>>",
  "# <<< csx feature default_mode_request_user_input <<<",
  "# >>> csx leader defaults >>>",
  "# <<< csx leader defaults <<<"
];

/**
 * Resolve project identity without ever using Git's common directory.
 *
 * An explicit non-Git directory is a valid fresh project. An implicit non-Git
 * directory is accepted only when proveReceipt identifies that exact ancestor.
 */
export async function resolveProjectContext({
  cwd = process.cwd(),
  projectRoot,
  proveReceipt,
  requireSafeGitAuthority = false,
  git = gitTopLevel
} = {}) {
  const start = await canonicalNavigationDirectory(projectRoot ?? cwd);
  const gitRoot = await git(start);
  if (gitRoot !== null) {
    const root = await safeDirectory(gitRoot);
    if (requireSafeGitAuthority &&
        await classifyInstallationAuthority("project", root) === "unsafe") {
      throw new Error(`unsafe project csx installation authority: ${root}`);
    }
    return Object.freeze({ root, source: "git-worktree" });
  }
  if (projectRoot !== undefined) {
    return Object.freeze({ root: start, source: "explicit-non-git" });
  }
  for (let candidate = start; ;) {
    await rejectSymlinkGitBoundary(candidate);
    if (proveReceipt) {
      if (await proveReceipt(candidate)) {
        return Object.freeze({ root: candidate, source: "receipt-ancestor" });
      }
    } else {
      const status = await classifyInstallationAuthority("project", candidate);
      if (status === "valid") {
        return Object.freeze({ root: candidate, source: "receipt-ancestor" });
      }
      if (status === "unsafe") {
        throw new Error(`unsafe project csx installation authority: ${candidate}`);
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`cannot resolve a project root outside Git without an explicit root or exact receipt proof: ${start}`);
}

/**
 * Classify the exact package installation at root. Unsafe evidence always wins;
 * only a clean receipt/hook absence with safe unrelated config is absent.
 */
export async function classifyInstallationAuthority(scope, root) {
  const layout = installationLayout(scope, root);
  if (layout === null || !await isCanonicalDirectory(layout.root)) return "unsafe";
  if (scope === "project" && !await isSafeOptionalDirectory(layout.configRoot)) {
    return "unsafe";
  }

  const [receipt, hook, config] = await Promise.all([
    inspectBoundedFile(layout.receipt, RECEIPT_LIMIT),
    inspectBoundedFile(layout.hook, HOOK_LIMIT),
    inspectBoundedFile(layout.config, CONFIG_LIMIT)
  ]);
  if (config.status === "unsafe") return "unsafe";
  if (receipt.status === "missing" && hook.status === "missing") {
    if (config.status === "file" && hasExactManagedMarker(config.content)) {
      return "unsafe";
    }
    return "absent";
  }
  if (receipt.status !== "file" || hook.status !== "file") return "unsafe";

  let parsed;
  try {
    parsed = JSON.parse(receipt.content);
  } catch {
    return "unsafe";
  }
  return validReceipt(parsed, layout) ? "valid" : "unsafe";
}

export function installationLayout(scope, root) {
  if (!["project", "global"].includes(scope) ||
      typeof root !== "string" ||
      !isAbsolute(root) ||
      resolve(root) !== root) {
    return null;
  }
  const configRoot = scope === "project" ? resolve(root, ".codex") : root;
  return Object.freeze({
    scope,
    root,
    configRoot,
    config: resolve(configRoot, "config.toml"),
    receipt: resolve(configRoot, ".csx-install-receipt.json"),
    hook: resolve(configRoot, "hooks", "csx-hook.mjs")
  });
}

/** Returns `git rev-parse --show-toplevel`, never `--git-common-dir`. */
export async function gitTopLevel(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" }
    );
    const root = stdout.trim();
    if (!root) throw new Error(`Git returned an empty worktree root for ${cwd}`);
    return resolve(root);
  } catch (error) {
    if (error?.code === 128 || error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Navigation may enter through a link, but authority is always the physical directory. */
async function canonicalNavigationDirectory(path) {
  const requested = resolve(path);
  const canonical = await realpath(requested).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (canonical === null) throw new Error(`project root is not a safe directory: ${requested}`);
  return safeDirectory(canonical);
}

async function safeDirectory(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`project root is not a safe directory: ${absolute}`);
  }
  const canonical = await realpath(absolute);
  if (canonical !== absolute) throw new Error(`project root contains a symlink boundary: ${absolute}`);
  await rejectSymlinkGitBoundary(absolute);
  return absolute;
}

async function rejectSymlinkGitBoundary(root) {
  const dotGit = resolve(root, ".git");
  const info = await lstat(dotGit).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error(`Git boundary must not be a symlink: ${dotGit}`);
}

async function inspectBoundedFile(path, limit) {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "unsafe" };
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) {
    return { status: "unsafe" };
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const descriptor = await handle.stat();
    if (!descriptor.isFile() ||
        descriptor.dev !== before.dev ||
        descriptor.ino !== before.ino ||
        descriptor.size > limit) {
      return { status: "unsafe" };
    }
    const content = await handle.readFile();
    const [afterDescriptor, afterPath, canonical] = await Promise.all([
      handle.stat(),
      lstat(path).catch(() => null),
      realpath(path).catch(() => null)
    ]);
    if (!afterPath?.isFile() ||
        afterPath.isSymbolicLink() ||
        afterDescriptor.dev !== descriptor.dev ||
        afterDescriptor.ino !== descriptor.ino ||
        afterDescriptor.size !== descriptor.size ||
        afterDescriptor.mtimeMs !== descriptor.mtimeMs ||
        afterDescriptor.ctimeMs !== descriptor.ctimeMs ||
        afterPath.dev !== descriptor.dev ||
        afterPath.ino !== descriptor.ino ||
        canonical !== path ||
        content.length !== descriptor.size) {
      return { status: "unsafe" };
    }
    return { status: "file", content: content.toString("utf8") };
  } catch {
    return { status: "unsafe" };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function isCanonicalDirectory(path) {
  const info = await lstat(path).catch(() => null);
  return info?.isDirectory() &&
    !info.isSymbolicLink() &&
    await realpath(path).catch(() => null) === path;
}

async function isSafeOptionalDirectory(path) {
  const info = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    return false;
  });
  if (info === null) return true;
  return info !== false &&
    info.isDirectory() &&
    !info.isSymbolicLink() &&
    await realpath(path).catch(() => null) === path;
}

function validReceipt(receipt, layout) {
  return receipt !== null &&
    typeof receipt === "object" &&
    !Array.isArray(receipt) &&
    receipt.scope === layout.scope &&
    receipt.root === layout.root &&
    receipt.configRoot === layout.configRoot &&
    Array.isArray(receipt.files) &&
    receipt.files.every((path) => typeof path === "string" && isAbsolute(path)) &&
    new Set(receipt.files).size === receipt.files.length &&
    receipt.files.filter((path) => path === layout.hook).length === 1;
}

function hasExactManagedMarker(content) {
  return content.split(/\r?\n/).some((line) => MANAGED_MARKERS.includes(line));
}
