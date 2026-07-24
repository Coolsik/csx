import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { classifyLocalFilesystem, controlPath, createFilesystemClassifier, rootKey } from "../lib/transaction-lock.js";
import { acquireRootLock, TransactionLockError } from "../lib/transaction-lock.js";

async function probeInChild(root) {
  const script = `import { acquireRootLock } from ${JSON.stringify(new URL("../lib/transaction-lock.js", import.meta.url).href)}; try { const lock = await acquireRootLock(process.argv[1]); await lock.close(); process.stdout.write("acquired"); } catch (error) { process.stdout.write(error.code || "error"); process.exitCode = 1; }`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, root], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "exit");
  return { code, output };
}

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("control paths and canonical lock keys are stable for equivalent roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-lock-"));
  roots.push(root);
  const equivalent = join(root, ".");
  assert.equal(rootKey(root), rootKey(equivalent));
  assert.equal(controlPath(root), join(resolve(root), ".csx-transactions"));
});

test("filesystem classification refuses a non-directory probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-lock-file-"));
  roots.push(root);
  const file = join(root, "not-a-directory");
  await writeFile(file, "x");
  await assert.rejects(classifyLocalFilesystem(file), /filesystem probe is not a directory/);
});
test("fixture classifier keeps Windows volume boundaries fail-closed", async () => {
  const directory = { isDirectory: () => true, isSymbolicLink: () => false };
  const windows = createFilesystemClassifier({
    platform: "win32",
    operations: {
      stat: async () => directory,
      lstat: async () => directory
    }
  });
  await assert.rejects(windows("C:\\fixture-root"), /fixed-volume and final-path boundaries cannot be established/);
  await assert.rejects(windows("\\\\server\\share"), /UNC transaction roots are unsupported/);
});

test("fixture classifier rejects unsupported Linux architecture before mount access", async () => {
  const classifier = createFilesystemClassifier({
    platform: "linux",
    arch: "ppc64",
    operations: {
      stat: async () => ({ isDirectory: () => true })
    }
  });
  await assert.rejects(classifier("/fixture-root"), /unsupported Linux architecture/);
});
test("lock acquisition rejects a symlinked root before creating control state", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-lock-link-"));
  roots.push(root);
  const link = join(tmpdir(), `csx-lock-link-${Date.now()}`);
  await symlink(root, link);
  try {
    await assert.rejects(acquireRootLock(link), (error) => error instanceof TransactionLockError && error.code === "lock_filesystem_unsupported");
  } finally {
    await rm(link, { force: true });
  }
});
test("native locks contend across processes and release on supported Linux platforms", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-native-lock-"));
  roots.push(root);
  const lock = await acquireRootLock(root);

  try {
    const busy = await probeInChild(root);
    assert.equal(busy.code, 1);
    assert.equal(busy.output, "lock_busy");
  } finally {
    await lock.close();
  }
  const released = await probeInChild(root);
  assert.equal(released.code, 0);
  assert.equal(released.output, "acquired");
});
test("Windows refuses transaction locks before mutation with a classified platform boundary", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-windows-lock-"));
  roots.push(root);
  await assert.rejects(
    acquireRootLock(root),
    (error) => error instanceof TransactionLockError &&
      error.code === "lock_filesystem_unsupported" &&
      /fixed-volume and final-path boundaries cannot be established/.test(error.message)
  );
});
