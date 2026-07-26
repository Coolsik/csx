import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { existingInstallationTarget } from "../lib/installation-state.js";
import { Transaction, __setTransactionTestHooks, beginTransaction, preflightTransaction, recoverTransactions, recoveryAuthorityFromDeclaration } from "../lib/transaction.js";
import { controlPath } from "../lib/transaction-lock.js";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "csx-transaction-"));
  roots.push(root);
  return root;
}
async function withTransactionTestHooks(hooks, operation) {
  const restore = __setTransactionTestHooks(hooks);
  try { return await operation(); } finally { restore(); }
}
function recoveryAuthority(transaction) {
  const { participants, roots, snapshotSet } = transaction.manifest;
  return recoveryAuthorityFromDeclaration({ coordinationRoots: roots.map(({ root }) => root), participants, snapshotSet });
}
function bridgeRecord(manifest, bridge, state = "terminal") {
  return {
    version: 2,
    id: manifest.id,
    state,
    root: bridge.root,
    rootKey: bridge.rootKey,
    control: bridge.control,
    peers: bridge.peers,
    participants: manifest.participants,
    snapshotSet: manifest.snapshotSet,
    writeSet: manifest.writeSet
  };
}
async function seedTerminalArtifacts(manifest, { journals = true, terminals = true, bridges = true } = {}) {
  for (const { control } of manifest.roots) {
    if (journals) await writeFile(join(control, "journals", `${manifest.id}.json`), JSON.stringify(manifest), { mode: 0o600 });
    if (terminals) await writeFile(join(control, "terminals", `${manifest.id}.json`), JSON.stringify(manifest), { mode: 0o600 });
  }
  if (bridges) for (const bridge of manifest.bridges) {
    await writeFile(join(bridge.control, "bridges", `${manifest.id}.json`), JSON.stringify(bridgeRecord(manifest, bridge)), { mode: 0o600 });
  }
}
async function assertNoTransactionArtifacts(transaction) {
  for (const { control } of transaction.manifest.roots) {
    for (const directory of ["bridges", "journals", "terminals", "cleanup"]) {
      assert.equal(
        await readFile(join(control, directory, `${transaction.id}.json`)).catch((error) => error.code),
        "ENOENT",
        `${control}:${directory}`
      );
    }
  }
}
async function beginCrossRootTransaction() {
  const root = await temporary();
  const metadataRoot = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const target = join(root, "managed.txt");
  const metadataPath = join(metadataRoot, "presets.json");
  const transaction = await beginTransaction({
    operation: "install",
    participants: [
      {
        role: "prospective-installation-target",
        root,
        configPath,
        receiptPath,
        paths: [configPath, receiptPath, target],
        preimages: {
          [configPath]: { state: "absent" },
          [receiptPath]: { state: "absent" },
          [target]: { state: "absent" }
        }
      },
      {
        role: "metadata-participant",
        root: metadataRoot,
        paths: [metadataPath],
        schema: { version: 1, type: "csx-metadata" }
      }
    ],
    snapshotSet: [configPath, receiptPath, target, metadataPath],
    writeSet: [target, metadataPath]
  });
  return { root, metadataRoot, target, metadataPath, transaction };
}
async function existingUpgrade(additionNames = ["added.txt"]) {
  const root = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const managed = join(root, "managed.txt");
  const additions = additionNames.map((name) => join(root, name));
  const receipt = { root, files: [managed] };
  await writeFile(configPath, "managed = true\n", { mode: 0o600 });
  await writeFile(managed, "original\n", { mode: 0o640 });
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const participant = await existingInstallationTarget({ root, configPath, receiptPath, expectedFiles: [managed], additions });
  return { root, configPath, receiptPath, managed, additions, participant };
}

test("recovery refuses forged peer descriptors without creating the peer control store", async () => {
  const root = await temporary(), victim = await temporary(), id = "forged-peer";
  const rootDescriptor = { root, rootKey: Buffer.from(resolve(root)).toString("base64url"), control: controlPath(root) };
  const victimDescriptor = { root: victim, rootKey: Buffer.from(resolve(victim)).toString("base64url"), control: controlPath(victim) };
  for (const directory of ["bridges", "journals", "cleanup"]) await mkdir(join(controlPath(root), directory), { recursive: true, mode: 0o700 });
  await writeFile(join(controlPath(root), "bridges", `${id}.json`), JSON.stringify({ version: 2, id, state: "intent", ...rootDescriptor, peers: [victimDescriptor] }), { mode: 0o600 });
  await assert.rejects(recoverTransactions(root), /explicit recovery authority|recovery.*control path.*missing|recovery_required/);
  assert.equal(await readFile(controlPath(victim)).catch((error) => error.code), "ENOENT");

  await rm(join(controlPath(root), "bridges", `${id}.json`));
  await writeFile(join(controlPath(root), "cleanup", `${id}.json`), JSON.stringify({ version: 2, id, state: "cleaned", roots: [rootDescriptor, victimDescriptor] }), { mode: 0o600 });
  await assert.rejects(recoverTransactions(root), /explicit recovery authority|recovery.*control path.*missing|recovery_required/);
  assert.equal(await readFile(controlPath(victim)).catch((error) => error.code), "ENOENT");

  await rm(join(controlPath(root), "cleanup", `${id}.json`));
  await writeFile(join(controlPath(root), "journals", `${id}.json`), JSON.stringify({ version: 2, id, roots: [rootDescriptor, victimDescriptor] }), { mode: 0o600 });
  await assert.rejects(recoverTransactions(root), /explicit recovery authority|manifest is invalid|recovery_required/);
  assert.equal(await readFile(controlPath(victim)).catch((error) => error.code), "ENOENT");
});
test("transaction refuses a permissive preexisting control directory", async () => {
  const root = await temporary();
  await mkdir(controlPath(root), { mode: 0o755 });
  await chmod(controlPath(root), 0o755);
  const configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
  await assert.rejects(beginTransaction({
    operation: "install",
    participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } }],
    snapshotSet: [configPath, receiptPath, target],
    writeSet: [target]
  }), /control directory is unsafe/);
});

test("transaction declaration rejects prospective uninstall and duplicate snapshots before locking", async () => {
  const root = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const path = join(root, "managed");
  const participant = {
    role: "prospective-installation-target",
    root,
    configPath,
    receiptPath,
    paths: [configPath, path, receiptPath],
    preimages: {
      [configPath]: { state: "absent" },
      [path]: { state: "absent" },
      [receiptPath]: { state: "absent" }
    }
  };
  await assert.rejects(
    beginTransaction({ operation: "uninstall", participants: [participant], snapshotSet: [path], writeSet: [path] }),
    /prospective participant is valid only for install/
  );
  await assert.rejects(
    beginTransaction({ operation: "install", participants: [participant], snapshotSet: [path, path], writeSet: [path] }),
    /writeSet must be a unique subset of snapshotSet/
  );
  await assert.rejects(
    beginTransaction({ operation: "install", participants: [participant], snapshotSet: [path], writeSet: [path, path] }),
    /writeSet must be a unique subset of snapshotSet/
  );
});
test("transaction declaration rejects forged in-root prospective authority", async () => {
  const root = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  await assert.rejects(
    beginTransaction({
      operation: "install",
      participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath], preimages: { [configPath]: { state: "absent" } } }],
      snapshotSet: [configPath, receiptPath],
      writeSet: [configPath, receiptPath]
    }),
    /prospective participant preimages are invalid/
  );
});

test("remove records an absent intent and rollback restores the exact preimage", async () => {
  const root = await temporary();
  const path = join(root, "managed.txt");
  await writeFile(path, "original\n", { mode: 0o640 });
  const control = controlPath(root);
  await mkdir(join(control, "journals"), { recursive: true });
  const transaction = new Transaction({
    id: "remove-restore",
    writeSet: [resolve(path)],
    snapshots: { [resolve(path)]: { state: "present", data: Buffer.from("original\n").toString("base64"), hash: createHash("sha256").update("original\n").digest("hex"), mode: 0o640 } },
    intended: {},
    roots: [{ control }]
  }, []);

  await transaction.remove(path);
  await transaction.rollback();

  assert.equal(await readFile(path, "utf8"), "original\n");
});
test("write fails closed before journaling when the output path cannot be inspected", async () => {
  const root = await temporary();
  const blockingFile = join(root, "blocking");
  const target = join(blockingFile, "child");
  const control = join(root, "control");
  await writeFile(blockingFile, "not a directory");
  const transaction = new Transaction({
    id: "write-boundary",
    writeSet: [resolve(target)],
    snapshots: { [resolve(target)]: { state: "absent" } },
    intended: {},
    progress: {},
    roots: [{ control }]
  }, []);

  await assert.rejects(transaction.write(target, "new"), /parent directory is unsafe|EEXIST|ENOTDIR/);
  assert.equal(transaction.manifest.intended[resolve(target)], undefined);
  assert.equal(transaction.manifest.progress[resolve(target)], undefined);
});

test("write does not change output when intent persistence fails", async () => {
  const root = await temporary();
  const target = join(root, "managed.txt");
  const control = join(root, "not-a-control-directory");
  await writeFile(target, "original", { mode: 0o600 });
  await writeFile(control, "not a directory");
  const transaction = new Transaction({
    id: "journal-boundary",
    writeSet: [resolve(target)],
    snapshots: { [resolve(target)]: { state: "present", data: Buffer.from("original").toString("base64"), hash: createHash("sha256").update("original").digest("hex"), mode: 0o600 } },
    intended: {},
    progress: {},
    roots: [{ control }]
  }, []);

  await assert.rejects(transaction.write(target, "new"), /ENOTDIR/);
  assert.equal(await readFile(target, "utf8"), "original");
});
test("remove does not change output when absent intent persistence fails", async () => {
  const root = await temporary();
  const target = join(root, "managed.txt");
  const control = join(root, "not-a-control-directory");
  await writeFile(target, "original", { mode: 0o600 });
  await writeFile(control, "not a directory");
  const transaction = new Transaction({
    id: "remove-journal-boundary",
    writeSet: [resolve(target)],
    snapshots: { [resolve(target)]: { state: "present", data: Buffer.from("original").toString("base64"), hash: createHash("sha256").update("original").digest("hex"), mode: 0o600 } },
    intended: {},
    progress: {},
    roots: [{ control }]
  }, []);

  await assert.rejects(transaction.remove(target), /ENOTDIR/);
  assert.equal(await readFile(target, "utf8"), "original");
});
test("recovery restores persisted writes byte-for-byte and preserves the original mode", async () => {
  const root = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const target = join(root, "managed.txt");
  await writeFile(target, "original\n", { mode: 0o640 });
  const participant = {
    role: "prospective-installation-target",
    root,
    configPath,
    receiptPath,
    paths: [configPath, receiptPath, target],
    preimages: {
      [configPath]: { state: "absent" },
      [receiptPath]: { state: "absent" },
      [target]: { state: "present", data: Buffer.from("original\n").toString("base64"), hash: createHash("sha256").update("original\n").digest("hex"), mode: 0o640 }
    }
  };
  const transaction = await beginTransaction({
    operation: "install",
    participants: [participant],
    snapshotSet: participant.paths,
    writeSet: [target]
  });
  await transaction.write(target, "replacement\n", { mode: 0o600 });
  await transaction.close();

  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), [transaction.id]);
  assert.equal(await readFile(target, "utf8"), "original\n");
  assert.equal((await stat(target)).mode & 0o777, 0o640);
});

test("recovery fails closed when journal listing cannot be read", async () => {
  const root = await temporary();
  const control = controlPath(root);
  await mkdir(control, { recursive: true, mode: 0o700 });
  await writeFile(join(control, "journals"), "not a directory");

  await assert.rejects(recoverTransactions(root, recoveryAuthorityFromDeclaration({
    coordinationRoots: [root],
    participants: [{ role: "metadata-participant", root, paths: [join(root, "dummy")], schema: { version: 1, type: "csx-metadata" } }],
    snapshotSet: [join(root, "dummy")]
  })), /unsafe|ENOTDIR|EACCES|EPERM/);
});

test("transaction declaration rejects receipt snapshots that drift from the locked preimage", async () => {
  const root = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const managed = join(root, "managed.toml");
  const receipt = { root, files: [managed] };
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  await writeFile(managed, "original\n", { mode: 0o640 });
  const receiptData = Buffer.from(JSON.stringify(receipt));
  const receiptSnapshot = { state: "present", data: receiptData.toString("base64"), hash: createHash("sha256").update(receiptData).digest("hex"), mode: 0o600 };

  await assert.rejects(
    beginTransaction({
      operation: "setup",
      participants: [{
        role: "existing-installation-target",
        root,
        configPath,
        receiptPath,
        paths: [configPath, receiptPath, managed],
        receipt,
        receiptSnapshot: { ...receiptSnapshot, hash: "0".repeat(64) }
      }],
      snapshotSet: [configPath, receiptPath, managed],
      writeSet: [managed]
    }),
    /receipt snapshot|preimage|authority/
  );
});
test("existing upgrade additions are exact absent authority and recover to their locked absent preimage", async () => {
  const { root, additions: [addition], participant } = await existingUpgrade();
  assert.equal(Object.isFrozen(participant.additions), true);
  assert.deepEqual(participant.additions, [addition]);
  assert.equal(participant.receipt.files.includes(addition), false);
  assert.equal(participant.paths.includes(addition), true);

  const transaction = await beginTransaction({
    operation: "install",
    participants: [participant],
    snapshotSet: participant.paths,
    writeSet: [addition]
  });
  assert.deepEqual(transaction.manifest.participants[0].additions, [addition]);
  assert.deepEqual(transaction.manifest.snapshots[addition], { state: "absent" });
  assert.deepEqual(recoveryAuthority(transaction).participants[0].additions, [addition]);
  const exactPathAuthority = recoveryAuthorityFromDeclaration({
    coordinationRoots: transaction.manifest.roots.map(({ root: coordinationRoot }) => coordinationRoot),
    participants: [{
      role: "prospective-installation-target",
      root: participant.root,
      coordinationRoot: participant.coordinationRoot ?? participant.root,
      configPath: participant.configPath,
      receiptPath: participant.receiptPath,
      paths: participant.paths,
      preimages: Object.fromEntries(participant.paths.map((path) => [path, { state: "absent" }])),
      expectedFiles: participant.receipt.files,
      additions: participant.additions
    }],
    snapshotSet: participant.paths
  });
  assert.deepEqual(exactPathAuthority.participants[0].expectedFiles, participant.receipt.files);
  assert.deepEqual(exactPathAuthority.participants[0].additions, participant.additions);
  assert.equal(Object.isFrozen(exactPathAuthority.participants[0].expectedFiles), true);
  assert.equal(Object.isFrozen(exactPathAuthority.participants[0].additions), true);

  await transaction.write(addition, "partial upgrade\n", { mode: 0o600 });
  await transaction.close();
  assert.equal(await readFile(addition, "utf8"), "partial upgrade\n");
  assert.deepEqual(await recoverTransactions(root, exactPathAuthority), [transaction.id]);
  assert.equal(await readFile(addition).catch((error) => error.code), "ENOENT");
});
test("existing installation target rejects malformed, escaping, overlapping, and present additions", async () => {
  const { root, configPath, receiptPath, managed, additions: [addition] } = await existingUpgrade();
  const declaration = { root, configPath, receiptPath, expectedFiles: [managed] };

  await assert.rejects(existingInstallationTarget({ ...declaration, additions: "not-an-array" }), /additions must be an array/);
  await assert.rejects(existingInstallationTarget({ ...declaration, additions: [join(root, "..", "escape.txt")] }), /escapes installation root/);
  await assert.rejects(existingInstallationTarget({ ...declaration, additions: [addition, addition] }), /additions must be unique/);
  await assert.rejects(existingInstallationTarget({ ...declaration, additions: [managed] }), /overlaps an owned path/);
  await writeFile(addition, "collision\n");
  await assert.rejects(existingInstallationTarget({ ...declaration, additions: [addition] }), /addition must be absent/);
});
test("existing upgrade declaration rejects additions and snapshot or write authority mismatches", async () => {
  const { root, managed, additions: [addition], participant } = await existingUpgrade(["added.txt"]);
  const other = join(root, "other.txt");
  const declaration = (candidate, snapshotSet = candidate.paths, writeSet = [addition]) => ({
    operation: "install",
    participants: [candidate],
    snapshotSet,
    writeSet
  });

  await assert.rejects(beginTransaction(declaration({ ...participant, additions: [addition, addition] })), /additions must be unique/);
  await assert.rejects(beginTransaction(declaration({ ...participant, additions: [managed], paths: participant.paths })), /overlaps receipt ownership|paths do not exactly match/);
  await assert.rejects(beginTransaction(declaration({ ...participant, paths: participant.paths.filter((path) => path !== addition) })), /paths do not exactly match/);
  await assert.rejects(beginTransaction(declaration({ ...participant, additions: [addition, other] })), /paths do not exactly match/);
  await assert.rejects(beginTransaction(declaration(participant, participant.paths.filter((path) => path !== addition), [])), /snapshotSet must exactly cover/);
  await assert.rejects(beginTransaction(declaration(participant, participant.paths, [])), /additions must be included in writeSet/);
});
test("existing upgrade rechecks addition absence after acquiring the transaction lock", async () => {
  const { additions: [addition], participant } = await existingUpgrade();
  await withTransactionTestHooks({
    beforeManifest: async () => writeFile(addition, "raced\n")
  }, async () => {
    await assert.rejects(beginTransaction({
      operation: "install",
      participants: [participant],
      snapshotSet: participant.paths,
      writeSet: [addition]
    }), /addition became present while locked/);
  });
  assert.equal(await readFile(addition, "utf8"), "raced\n");
});
test("existing upgrade recovery rejects mismatched caller and manifest additions", async () => {
  const { root, additions: [addition], participant } = await existingUpgrade();
  const transaction = await beginTransaction({
    operation: "install",
    participants: [participant],
    snapshotSet: participant.paths,
    writeSet: [addition]
  });
  await transaction.write(addition, "partial\n", { mode: 0o600 });
  await transaction.close();

  const legacyParticipant = { ...participant, paths: participant.paths.filter((path) => path !== addition) };
  delete legacyParticipant.additions;
  const mismatchedAuthority = recoveryAuthorityFromDeclaration({
    coordinationRoots: transaction.manifest.roots.map(({ root: coordinationRoot }) => coordinationRoot),
    participants: [legacyParticipant],
    snapshotSet: legacyParticipant.paths
  });
  await assert.rejects(recoverTransactions(root, mismatchedAuthority), /does not exactly match caller authority|exceed caller authority/);
  const unionPaths = [...participant.paths, join(root, "other-variant.txt")].sort();
  const unionAuthority = recoveryAuthorityFromDeclaration({
    coordinationRoots: transaction.manifest.roots.map(({ root: coordinationRoot }) => coordinationRoot),
    participants: [{
      role: "prospective-installation-target",
      root,
      configPath: participant.configPath,
      receiptPath: participant.receiptPath,
      paths: unionPaths,
      preimages: Object.fromEntries(unionPaths.map((path) => [path, { state: "absent" }]))
    }],
    snapshotSet: unionPaths
  });
  await assert.rejects(recoverTransactions(root, unionAuthority), /does not exactly match caller authority/);

  const manifestPath = join(controlPath(root), "journals", `${transaction.id}.json`);
  const forged = JSON.parse(await readFile(manifestPath, "utf8"));
  forged.participants[0].additions = [];
  await writeFile(manifestPath, `${JSON.stringify(forged)}\n`, { mode: 0o600 });
  await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /manifest authorization is invalid|paths do not exactly match/);
  assert.equal(await readFile(addition, "utf8"), "partial\n");
});
test("prospective recovery requires an exact receipt-owned and additions split for an existing manifest", async () => {
  const { root, managed, additions: [addition], participant } = await existingUpgrade();
  const transaction = await beginTransaction({
    operation: "install",
    participants: [participant],
    snapshotSet: participant.paths,
    writeSet: [addition]
  });
  await transaction.write(addition, "partial\n", { mode: 0o600 });
  await transaction.close();
  const manifestPath = join(controlPath(root), "journals", `${transaction.id}.json`);
  const manifestBefore = await readFile(manifestPath, "utf8");
  const candidate = (expectedFiles, additions, includeSplit = true) => recoveryAuthorityFromDeclaration({
    coordinationRoots: transaction.manifest.roots.map(({ root: coordinationRoot }) => coordinationRoot),
    participants: [{
      role: "prospective-installation-target",
      root,
      configPath: participant.configPath,
      receiptPath: participant.receiptPath,
      paths: participant.paths,
      preimages: Object.fromEntries(participant.paths.map((path) => [path, { state: "absent" }])),
      ...(includeSplit ? { expectedFiles, additions } : {})
    }],
    snapshotSet: participant.paths
  });

  await assert.rejects(recoverTransactions(root, candidate([], [], false)), /does not exactly match caller authority/);
  await assert.rejects(recoverTransactions(root, candidate([managed, addition], [])), /does not exactly match caller authority/);
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
  assert.equal(await readFile(addition, "utf8"), "partial\n");

  assert.deepEqual(await recoverTransactions(root, candidate([managed], [addition])), [transaction.id]);
  assert.equal(await readFile(addition).catch((error) => error.code), "ENOENT");
});
test("legacy existing participant without additions normalizes to empty authority only", async () => {
  const { root, managed, participant } = await existingUpgrade([]);
  const legacyParticipant = { ...participant };
  delete legacyParticipant.additions;
  const authority = recoveryAuthorityFromDeclaration({ participants: [legacyParticipant], snapshotSet: legacyParticipant.paths });
  assert.deepEqual(authority.participants[0].additions, []);
  await assert.rejects(
    async () => recoveryAuthorityFromDeclaration({ participants: [legacyParticipant], snapshotSet: [...legacyParticipant.paths, join(root, "unauthorized.txt")] }),
    /recovery authority paths are invalid/
  );

  const transaction = await beginTransaction({
    operation: "setup",
    participants: [legacyParticipant],
    snapshotSet: legacyParticipant.paths,
    writeSet: [managed]
  });
  await transaction.write(managed, "changed\n", { mode: 0o640 });
  await transaction.close();
  const manifestPath = join(controlPath(root), "journals", `${transaction.id}.json`);
  const legacyManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete legacyManifest.participants[0].additions;
  await writeFile(manifestPath, `${JSON.stringify(legacyManifest)}\n`, { mode: 0o600 });

  assert.deepEqual(await recoverTransactions(root, authority), [transaction.id]);
  assert.equal(await readFile(managed, "utf8"), "original\n");
});
test("normal cross-root commit and rollback remove every transaction control record", async () => {
  for (const outcome of ["commit", "rollback"]) {
    const { target, metadataPath, transaction } = await beginCrossRootTransaction();
    await transaction.write(target, "replacement", { mode: 0o600 });
    await transaction.write(metadataPath, '{"version":1}\n', { mode: 0o600 });
    await transaction[outcome]();
    await assertNoTransactionArtifacts(transaction);
    if (outcome === "rollback") {
      assert.equal(await readFile(target).catch((error) => error.code), "ENOENT");
      assert.equal(await readFile(metadataPath).catch((error) => error.code), "ENOENT");
    }
  }
});
test("interrupted terminal cleanup remains recoverable and full-authority recovery converges", async () => {
  const { root, transaction } = await beginCrossRootTransaction();
  let interrupted = false;
  await withTransactionTestHooks({
    afterCleanupAcknowledgementReplication: async () => {
      if (interrupted) return;
      interrupted = true;
      throw new Error("terminal cleanup interrupted");
    }
  }, async () => {
    await assert.rejects(transaction.commit(), /terminal cleanup interrupted/);
  });
  await transaction.close();
  assert.equal(interrupted, true);
  assert.ok(transaction.manifest.roots.some(({ control }) =>
    ["journals", "terminals", "bridges", "cleanup"].some((directory) =>
      existsSync(join(control, directory, `${transaction.id}.json`))
    )
  ));
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
  await assertNoTransactionArtifacts(transaction);
});
test("recovery converges an interrupted cross-root transaction through its bridge closure", async () => {
  const root = await temporary();
  const metadataRoot = await temporary();
  const configPath = join(root, "config.toml");
  const receiptPath = join(root, ".csx-install-receipt.json");
  const target = join(root, "managed.txt");
  const metadataPath = join(metadataRoot, "csx-model-presets.json");
  const transaction = await beginTransaction({
    operation: "install",
    participants: [
      {
        role: "prospective-installation-target",
        root,
        configPath,
        receiptPath,
        paths: [configPath, receiptPath, target],
        preimages: {
          [configPath]: { state: "absent" },
          [receiptPath]: { state: "absent" },
          [target]: { state: "absent" }
        }
      },
      {
        role: "metadata-participant",
        root: metadataRoot,
        paths: [metadataPath],
        schema: { version: 1, type: "csx-metadata" }
      }
    ],
    snapshotSet: [configPath, receiptPath, target, metadataPath],
    writeSet: [target, metadataPath]
  });
  await transaction.write(target, "replacement\n", { mode: 0o600 });
  await transaction.write(metadataPath, '{"version":1}\n', { mode: 0o600 });
  await transaction.close();

  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), [transaction.id]);
  assert.equal(await readFile(target).catch((error) => error.code), "ENOENT");
  assert.equal(await readFile(metadataPath).catch((error) => error.code), "ENOENT");
  await assertNoTransactionArtifacts(transaction);
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
});
test("recovery removes bridge-only intent records under every peer lock", async () => {
  const root = await temporary(), peer = await temporary();
  const configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({
    operation: "install",
    participants: [
      { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
      { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
    ],
    snapshotSet: [configPath, receiptPath, target, metadataPath],
    writeSet: [target, metadataPath]
  });
  await transaction.close();
  for (const current of [root, peer]) await rm(join(controlPath(current), "journals", `${transaction.id}.json`));
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
  for (const current of [root, peer]) assert.equal(await readFile(join(controlPath(current), "bridges", `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
});
test("recovery follows a peer bridge to a journal published only in another root", async () => {
  const root = await temporary(), metadataRoot = await temporary();
  const configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(metadataRoot, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: metadataRoot, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.write(target, "changed");
  await transaction.close();
  await rm(join(controlPath(metadataRoot), "journals", `${transaction.id}.json`));
  assert.deepEqual(await recoverTransactions(metadataRoot, recoveryAuthority(transaction)), [transaction.id]);
  assert.equal(await readFile(target).catch((error) => error.code), "ENOENT");
});
test("declaration root replacement fails before bridge or journal publication", async () => {
  const root = await temporary(), moved = `${root}-moved`;
  const configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
  await assert.rejects(beginTransaction({
    coordinationRoots: [root],
    createDeclaration: async () => {
      await rename(root, moved);
      await mkdir(root);
      return { operation: "install", participants: [{ role: "prospective-installation-target", root: moved, coordinationRoot: root, configPath: join(moved, "config.toml"), receiptPath: join(moved, ".csx-install-receipt.json"), paths: [join(moved, "config.toml"), join(moved, ".csx-install-receipt.json"), join(moved, "managed.txt")], preimages: { [join(moved, "config.toml")]: { state: "absent" }, [join(moved, ".csx-install-receipt.json")]: { state: "absent" }, [join(moved, "managed.txt")]: { state: "absent" } } }], snapshotSet: [join(moved, "config.toml"), join(moved, ".csx-install-receipt.json"), join(moved, "managed.txt")], writeSet: [join(moved, "managed.txt")] };
    }
  }), /root changed while locked|recovery_required/);
  assert.equal(await readFile(join(controlPath(root), "journals")).catch((error) => error.code), "ENOENT");
});
test("terminal cleanup converges from journal, bridge, and terminal recovery states", async () => {
  for (const state of ["journals", "bridges", "terminals"]) {
    const root = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
    const transaction = await beginTransaction({ operation: "install", participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } }], snapshotSet: [configPath, receiptPath, target], writeSet: [target] });
    await transaction.commit();
    const manifest = transaction.manifest;
    await seedTerminalArtifacts(manifest, { journals: state === "journals", bridges: state === "bridges" });
    assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
    for (const directory of ["journals", "bridges", "terminals"]) assert.equal(await readFile(join(controlPath(root), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
  }
});
test("recovery rescans a late A-B/B-C graph expansion before mutating", async () => {
  const root = await temporary(), peer = await temporary(), latePeer = await temporary();
  const configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.write(target, "replacement");
  await transaction.close();

  let expanded = false;
  await withTransactionTestHooks({ afterRecoveryDiscovery: async ({ roots: discovered }) => {
    if (expanded || !discovered.includes(peer)) return;
    expanded = true;
    const id = "late-bridge", bridgeRoots = [peer, latePeer].sort();
    for (const current of bridgeRoots) {
      const peers = bridgeRoots.filter((candidate) => candidate !== current).map((candidate) => ({ root: candidate, rootKey: Buffer.from(resolve(candidate)).toString("base64url"), control: controlPath(candidate) }));
      await mkdir(join(controlPath(current), "bridges"), { recursive: true, mode: 0o700 });
      await writeFile(join(controlPath(current), "bridges", `${id}.json`), JSON.stringify({ version: 2, id, state: "intent", root: current, rootKey: Buffer.from(resolve(current)).toString("base64url"), control: controlPath(current), peers }), { mode: 0o600 });
    }
  } }, async () => {
    await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /recovery_required|authority/);
  });
  assert.equal(expanded, true);
  assert.equal(await readFile(target, "utf8"), "replacement");
  for (const current of [peer, latePeer]) assert.equal(await readFile(join(controlPath(current), "bridges", "late-bridge.json"), "utf8").then(Boolean), true);
});

test("root replacement during temporary durability fails before replacing the target", async () => {
  const root = await temporary(), moved = `${root}-moved`, configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
  await writeFile(target, "original");
  const transaction = await beginTransaction({ operation: "install", participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "present", data: Buffer.from("original").toString("base64"), hash: createHash("sha256").update("original").digest("hex"), mode: (await stat(target)).mode & 0o777 } } }], snapshotSet: [configPath, receiptPath, target], writeSet: [target] });

  let replaced = false;
  await withTransactionTestHooks({ afterTemporaryWrite: async ({ path }) => {
    if (path !== target || replaced) return;
    replaced = true;
    await rename(root, moved);
    roots.push(moved);
    await mkdir(root);
  } }, async () => {
    await assert.rejects(transaction.write(target, "replacement"), /parent directory changed|root changed while (?:held|locked)|recovery_required/);
  });
  await transaction.close();
  assert.equal(replaced, true);
  assert.equal(await readFile(join(moved, "managed.txt"), "utf8"), "original");
});
test("root replacement during directory fsync fails without writing into the replacement root", async () => {
  const root = await temporary(), moved = `${root}-moved`, configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
  await writeFile(target, "original");
  const transaction = await beginTransaction({ operation: "install", participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "present", data: Buffer.from("original").toString("base64"), hash: createHash("sha256").update("original").digest("hex"), mode: (await stat(target)).mode & 0o777 } } }], snapshotSet: [configPath, receiptPath, target], writeSet: [target] });

  let replaced = false;
  await withTransactionTestHooks({ afterDirectoryFsync: async ({ path }) => {
    if (path !== root || replaced) return;
    replaced = true;
    await rename(root, moved);
    roots.push(moved);
    await mkdir(root);
  } }, async () => {
    await assert.rejects(transaction.write(target, "replacement"), /parent directory changed|root changed while (?:held|locked)|recovery_required/);
  });
  await transaction.close();
  assert.equal(replaced, true);
  assert.equal(await readFile(target).catch((error) => error.code), "ENOENT");
  assert.equal(await readFile(join(moved, "managed.txt"), "utf8"), "replacement");
});
test("intermediate ancestor replacement during temporary durability fails before target replacement", async () => {
  const root = await temporary(), nested = join(root, "nested"), moved = `${nested}-moved`, configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(nested, "managed.txt");
  await mkdir(nested);
  await writeFile(target, "original");
  const transaction = await beginTransaction({ operation: "install", participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "present", data: Buffer.from("original").toString("base64"), hash: createHash("sha256").update("original").digest("hex"), mode: (await stat(target)).mode & 0o777 } } }], snapshotSet: [configPath, receiptPath, target], writeSet: [target] });
  await withTransactionTestHooks({ afterTemporaryWrite: async ({ path }) => {
    if (path !== target) return;
    await rename(nested, moved);
    await mkdir(nested);
  } }, async () => {
    await assert.rejects(transaction.write(target, "replacement"), /parent directory changed|recovery_required/);
  });
  await transaction.close();
  assert.equal(await readFile(join(moved, "managed.txt"), "utf8"), "original");
});
test("cleanup acknowledgement rejects unsafe modes and symlinks before deleting records", async () => {
  for (const unsafe of ["mode", "symlink"]) {
    const root = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt");
    const transaction = await beginTransaction({ operation: "install", participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } }], snapshotSet: [configPath, receiptPath, target], writeSet: [target] });
    await transaction.commit();
    const manifest = transaction.manifest;
    await seedTerminalArtifacts(manifest, { journals: false, bridges: false });
    await withTransactionTestHooks({ afterCleanupAcknowledgementReplication: async () => {
      const acknowledgement = join(controlPath(root), "cleanup", `${transaction.id}.json`);
      if (unsafe === "mode") await chmod(acknowledgement, 0o644);
      else { await rm(acknowledgement); await symlink(target, acknowledgement); }
    } }, async () => {
      await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /control file is unsafe/);
    });
    assert.equal(await readFile(join(controlPath(root), "terminals", `${transaction.id}.json`), "utf8").then(Boolean), true);
  }
});
test("cleanup acknowledgements authoritatively remove terminal-bridge-only residuals", async () => {
  const root = await temporary(), peer = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.commit();
  const acknowledgement = { version: 2, id: transaction.id, state: "cleaned", roots: transaction.manifest.roots, participants: transaction.manifest.participants, snapshotSet: transaction.manifest.snapshotSet, writeSet: transaction.manifest.writeSet };
  await seedTerminalArtifacts(transaction.manifest, { journals: false, terminals: false });
  for (const current of [root, peer]) {
    await writeFile(join(controlPath(current), "cleanup", `${transaction.id}.json`), JSON.stringify(acknowledgement), { mode: 0o600 });
  }
  await recoverTransactions(root, recoveryAuthority(transaction));
  for (const current of [root, peer]) for (const directory of ["journals", "terminals", "bridges", "cleanup"]) assert.equal(await readFile(join(controlPath(current), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
});

test("cleanup acknowledgement replication failure preserves terminal records until restart", async () => {
  const root = await temporary(), peer = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.commit();
  const manifest = transaction.manifest;
  await seedTerminalArtifacts(manifest, { journals: false });

  let acknowledgements = 0;
  await withTransactionTestHooks({ afterCleanupAcknowledgementReplication: async () => {
    acknowledgements += 1;
    if (acknowledgements === 1) throw new Error("acknowledgement replication interrupted");
  } }, async () => {
    await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /acknowledgement replication interrupted/);
  });
  assert.equal(await readFile(join(controlPath(root), "terminals", `${transaction.id}.json`), "utf8").then(Boolean), true);
  assert.doesNotMatch(await readFile(join(manifest.roots[0].control, "cleanup", `${transaction.id}.json`), "utf8"), /"snapshots"/);
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
  for (const current of [root, peer]) for (const directory of ["journals", "terminals", "bridges"]) assert.equal(await readFile(join(controlPath(current), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
});

test("cleanup resumes after first-root deletion failure without pre-seeded acknowledgements", async () => {
  const root = await temporary(), peer = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.commit();
  const manifest = transaction.manifest;
  await seedTerminalArtifacts(manifest, { journals: false });

  let emptied = false;
  await withTransactionTestHooks({ afterCleanupRootDeletion: async ({ root: deletedRoot, directory }) => {
    if (deletedRoot !== root || directory !== "bridges") return;
    emptied = true;
    throw new Error("first-root cleanup interrupted after ordinary records were removed");
  } }, async () => {
    await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /first-root cleanup interrupted after ordinary records were removed/);
  });
  assert.equal(emptied, true);
  for (const directory of ["journals", "terminals", "bridges"]) assert.equal(await readFile(join(controlPath(root), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
  assert.equal(await readFile(join(controlPath(root), "cleanup", `${transaction.id}.json`), "utf8").then(Boolean), true);
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
  for (const current of [root, peer]) {
    for (const directory of ["journals", "terminals", "bridges"]) assert.equal(await readFile(join(controlPath(current), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
    assert.equal(await readFile(join(controlPath(current), "cleanup", `${transaction.id}.json`)).catch((error) => error.code), "ENOENT");
  }
});
test("surviving cleanup acknowledgement completes after acknowledgement deletion crash", async () => {
  const root = await temporary(), peer = await temporary(), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json"), target = join(root, "managed.txt"), metadataPath = join(peer, "presets.json");
  const transaction = await beginTransaction({ operation: "install", participants: [
    { role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } },
    { role: "metadata-participant", root: peer, paths: [metadataPath], schema: { version: 1, type: "csx-metadata" } }
  ], snapshotSet: [configPath, receiptPath, target, metadataPath], writeSet: [target, metadataPath] });
  await transaction.commit();
  const acknowledgement = { version: 2, id: transaction.id, state: "cleaned", roots: transaction.manifest.roots, participants: transaction.manifest.participants, snapshotSet: transaction.manifest.snapshotSet, writeSet: transaction.manifest.writeSet };
  await seedTerminalArtifacts(transaction.manifest, { journals: false, terminals: false });
  for (const current of [root, peer]) {
    await writeFile(join(controlPath(current), "cleanup", `${transaction.id}.json`), JSON.stringify(acknowledgement), { mode: 0o600 });
  }
  let interrupted = false;
  await withTransactionTestHooks({ afterCleanupAcknowledgementDeletion: async () => {
    if (interrupted) return;
    interrupted = true;
    throw new Error("acknowledgement deletion interrupted");
  } }, async () => {
    await assert.rejects(recoverTransactions(root, recoveryAuthority(transaction)), /acknowledgement deletion interrupted/);
  });
  assert.equal(interrupted, true);
  assert.deepEqual(await recoverTransactions(root, recoveryAuthority(transaction)), []);
  assert.deepEqual(await recoverTransactions(peer, recoveryAuthority(transaction)), []);
  for (const current of [root, peer]) for (const directory of ["journals", "terminals", "bridges", "cleanup"]) {
    assert.equal(await readFile(join(controlPath(current), directory, `${transaction.id}.json`)).catch((error) => error.code), "ENOENT", `${current}:${directory}`);
  }
});
test("preflight is write-free and snapshot reads reject symlinks", async () => {
  const root = await temporary(), target = join(root, "managed.txt"), source = join(root, "source.txt"), configPath = join(root, "config.toml"), receiptPath = join(root, ".csx-install-receipt.json");
  await writeFile(source, "outside");
  await preflightTransaction({ coordinationRoots: [root], snapshotSet: [target] });
  assert.equal(await readFile(controlPath(root)).catch((error) => error.code), "ENOENT");
  await symlink(source, target);
  await assert.rejects(beginTransaction({
    operation: "install",
    participants: [{ role: "prospective-installation-target", root, configPath, receiptPath, paths: [configPath, receiptPath, target], preimages: { [configPath]: { state: "absent" }, [receiptPath]: { state: "absent" }, [target]: { state: "absent" } } }],
    snapshotSet: [configPath, receiptPath, target],
    writeSet: [target]
  }), /snapshot path is unsafe|symlink or junction is not allowed/);
});
