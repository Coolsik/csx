import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acquireRootLock, classifyLocalFilesystem, controlPath, isContained, loadLockCapability, rootKey, rootIdentity, TransactionLockError } from "./transaction-lock.js";
import { assertSafeContainment } from "./installation-state.js";
import { matchHistoricalParticipantPreimages } from "./historical-installations.js";

export const TRANSACTION_VERSION = 3;
const LEGACY_TRANSACTION_VERSION = 2;
const TERMINAL = new Set(["committed", "rolled_back"]);
const ROLES = new Set(["existing-installation-target", "prospective-installation-target", "historical-installation-target", "metadata-participant"]);
const INTENT_STATES = new Set(["present", "absent"]);
const BRIDGE_STATES = new Set(["intent", "ready", "committed", "terminal"]);
let transactionTestHooks;
export function __setTransactionTestHooks(hooks) {
  const previous = transactionTestHooks;
  transactionTestHooks = hooks;
  return () => { transactionTestHooks = previous; };
}
async function runTransactionTestHook(name, detail) { await transactionTestHooks?.[name]?.(detail); }
export function recoveryAuthorityFromDeclaration({ coordinationRoots, participants, snapshotSet, operationEndpoints } = {}) {
  if (!Array.isArray(participants) || participants.length === 0) throw new Error("recovery authority requires participants");
  const normalizedParticipants = participants.map(normalizeParticipant);
  const paths = [...new Set(snapshotSet?.map((path) => resolve(path)) ?? normalizedParticipants.flatMap(({ paths }) => paths))].sort();
  if (paths.length !== normalizedParticipants.flatMap(({ paths }) => paths).length || paths.some((path) => !normalizedParticipants.some((participant) => participant.paths.includes(path)))) throw new Error("recovery authority paths are invalid");
  const roots = [...new Set((coordinationRoots ?? normalizedParticipants.map(({ coordinationRoot }) => coordinationRoot)).map((root) => resolve(root)))].sort((left, right) => rootKey(left).localeCompare(rootKey(right)));
  if (!sameRoots(roots, canonicalRoots(normalizedParticipants))) throw new Error("recovery authority roots are invalid");
  if (operationEndpoints !== undefined && operationEndpoints !== "installation-receipts") {
    throw new Error("recovery authority operation endpoints are invalid");
  }
  return { roots, participants: normalizedParticipants, paths, operationEndpoints };
}
function normalizeRecoveryAuthority(authority) {
  if (!authority || typeof authority !== "object") throw new TransactionLockError("recovery_required", "explicit recovery authority is required");
  try {
    return recoveryAuthorityFromDeclaration({
      coordinationRoots: authority.roots,
      participants: authority.participants,
      snapshotSet: authority.paths,
      operationEndpoints: authority.operationEndpoints
    });
  } catch (cause) {
    throw new TransactionLockError("recovery_required", "recovery authority is invalid", cause);
  }
}


export async function preflightTransaction({ coordinationRoots = [], snapshotSet = [] } = {}) {
  const roots = [...new Set(coordinationRoots.map((root) => resolve(root)))];
  if (roots.length === 0) throw new Error("transaction requires coordination roots");
  loadLockCapability();
  await Promise.all([
    ...roots.map((root) => classifyLocalFilesystem(root)),
    ...snapshotSet.map((path) => classifyLocalFilesystem(dirname(resolve(path))))
  ]);
  return { coordinationRoots: roots.sort((left, right) => rootKey(left).localeCompare(rootKey(right))), snapshotSet: [...new Set(snapshotSet.map((path) => resolve(path)))].sort() };
}

export async function beginTransaction(declaration) {
  if (typeof declaration?.createDeclaration === "function") {
    const coordinationRoots = [...new Set(declaration.coordinationRoots ?? [])];
    if (coordinationRoots.length === 0) throw new Error("transaction requires coordination roots");
    await preflightTransaction({ coordinationRoots, snapshotSet: declaration.snapshotSet ?? [] });
    const roots = (await Promise.all(coordinationRoots.map(rootIdentity))).sort((a, b) => rootKey(a).localeCompare(rootKey(b)));
    for (;;) {
      const locks = [];
      try {
        for (const root of roots) locks.push(await acquireRootLock(root));
        await assertManifestLocks(undefined, locks);
        if (await hasNonterminalOverlap(locks)) {
          await Promise.all(locks.reverse().map((lock) => lock.close()));
          for (const root of roots) await recoverTransactions(root, declaration.recoveryAuthority);
          continue;
        }
        const resolved = await declaration.createDeclaration();
        await assertManifestLocks(undefined, locks);
        const { operation, participants, snapshotSet, writeSet, intended = {}, finalEndpoints, id = randomUUID() } = resolved;
        validateDeclaration(operation, participants, snapshotSet, writeSet, finalEndpoints);
        await preflightTransaction({ coordinationRoots: [...coordinationRoots, ...participants.map((participant) => participant.coordinationRoot ?? participant.root)], snapshotSet });
        const stabilizedParticipants = await Promise.all(participants.map(async (participant) => ({ ...participant, coordinationRoot: await rootIdentity(participant.coordinationRoot ?? participant.root) })));
        const lockedRoots = locks.map(({ root }) => root).sort((a, b) => rootKey(a).localeCompare(rootKey(b)));
        const declaredRoots = [...new Set(stabilizedParticipants.map(({ coordinationRoot }) => coordinationRoot))].sort((a, b) => rootKey(a).localeCompare(rootKey(b)));
        if (!sameRoots(declaredRoots, lockedRoots)) throw new TransactionLockError("recovery_required", "transaction coordination roots changed while locked");
        const manifest = await createManifest({ id, operation, participants: stabilizedParticipants, snapshotSet, writeSet, intended, finalEndpoints, roots: lockedRoots, locks });
        await assertManifestLocks(manifest, locks);
        await publishAuthorityBundle(manifest, locks);
        await publishBridges(manifest, "intent", locks);
        await writeManifest(manifest, "prepared", locks);
        if (manifest.compatibility !== "v2-single-target") await publishBridges(manifest, "ready", locks);
        return new Transaction(manifest, locks);
      } catch (error) {
        await Promise.all(locks.reverse().map((lock) => lock.close()));
        throw error;
      }
    }
  }
  const { operation, participants, snapshotSet, writeSet, intended = {}, finalEndpoints, id = randomUUID() } = declaration;
  validateDeclaration(operation, participants, snapshotSet, writeSet, finalEndpoints);
  await preflightTransaction({ coordinationRoots: participants.map((participant) => participant.coordinationRoot ?? participant.root), snapshotSet });
  const stabilizedParticipants = await Promise.all(participants.map(async (participant) => ({ ...participant, coordinationRoot: await rootIdentity(participant.coordinationRoot ?? participant.root) })));
  const roots = [...new Set(stabilizedParticipants.map(({ coordinationRoot }) => coordinationRoot))].sort((a, b) => rootKey(a).localeCompare(rootKey(b)));
  for (;;) {
    const locks = [];
    try {
      for (const root of roots) locks.push(await acquireRootLock(root));
      await assertManifestLocks(undefined, locks);
      if (await hasNonterminalOverlap(locks)) {
        await Promise.all(locks.reverse().map((lock) => lock.close()));
        for (const root of roots) await recoverTransactions(root, declaration.recoveryAuthority ?? recoveryAuthorityFromDeclaration(declaration));
        continue;
      }
      const manifest = await createManifest({ id, operation, participants: stabilizedParticipants, snapshotSet, writeSet, intended, finalEndpoints, roots: locks.map(({ root }) => root).sort((a, b) => rootKey(a).localeCompare(rootKey(b))), locks });
      await assertManifestLocks(manifest, locks);
      await publishAuthorityBundle(manifest, locks);
      await publishBridges(manifest, "intent", locks);
      await writeManifest(manifest, "prepared", locks);
      if (manifest.compatibility !== "v2-single-target") await publishBridges(manifest, "ready", locks);
      return new Transaction(manifest, locks);
    } catch (error) {
      await Promise.all(locks.reverse().map((lock) => lock.close()));
      throw error;
    }
  }
}

export class Transaction {
  #manifest; #locks; #closed = false;
  constructor(manifest, locks) { this.#manifest = manifest; this.#manifest.progress ??= {}; this.#locks = locks; }
  get id() { return this.#manifest.id; }
  get manifest() { return structuredClone(this.#manifest); }
  async write(path, data, { mode } = {}) {
    this.#assertOpen();
    await this.#assertLocks();
    const target = resolve(path);
    await assertAuthorizedPath(this.#manifest, target);
    if (!this.#manifest.writeSet.includes(target)) throw new Error(`transaction write is outside writeSet: ${target}`);
    await assertExpected(target, this.#manifest.snapshots[target], this.#manifest, this.#locks);
    const effectiveMode = mode ?? (this.#manifest.snapshots[target].state === "present" ? this.#manifest.snapshots[target].mode : 0o600);
    const intent = { state: "present", hash: digest(data), data: Buffer.from(data).toString("base64"), mode: effectiveMode };
    if (this.#manifest.finalEndpoints && this.#manifest.compatibility !== "v2-single-target" && JSON.stringify(intent) !== JSON.stringify(this.#manifest.finalEndpoints[target])) throw new TransactionLockError("recovery_required", `transaction write differs from declared final endpoint: ${target}`);
    await this.#assertLocks();
    await recordIntent(this.#manifest, target, intent, this.#locks);
    await assertAuthorizedPath(this.#manifest, target);
    await this.#assertLocks();
    await durableReplace(target, data, effectiveMode, this.#manifest, this.#locks, this.#manifest.snapshots[target]);
    await this.#assertLocks();
    await recordProgress(this.#manifest, target, this.#locks);
  }
  async remove(path) {
    this.#assertOpen();
    await this.#assertLocks();
    const target = resolve(path);
    await assertAuthorizedPath(this.#manifest, target);
    if (!this.#manifest.writeSet.includes(target)) throw new Error(`transaction write is outside writeSet: ${target}`);
    await assertExpected(target, this.#manifest.snapshots[target], this.#manifest, this.#locks);
    if (this.#manifest.finalEndpoints && this.#manifest.compatibility !== "v2-single-target" && this.#manifest.finalEndpoints[target]?.state !== "absent") throw new TransactionLockError("recovery_required", `transaction removal differs from declared final endpoint: ${target}`);
    await this.#assertLocks();
    await recordIntent(this.#manifest, target, { state: "absent" }, this.#locks);
    await assertAuthorizedPath(this.#manifest, target);
    await this.#assertLocks();
    await durableRemove(target, this.#manifest, this.#locks, this.#manifest.snapshots[target]);
    await this.#assertLocks();
    await recordProgress(this.#manifest, target, this.#locks);
  }
  async commit() {
    this.#assertOpen();
    await this.#assertLocks();
    if (this.#manifest.finalEndpoints && this.#manifest.compatibility !== "v2-single-target") {
      for (const path of this.#manifest.writeSet) {
        const current = await snapshot(path, this.#manifest, this.#locks);
        if (!matchesIntent(current, this.#manifest.finalEndpoints[path])) throw new TransactionLockError("recovery_required", `transaction final endpoint is not applied: ${path}`);
      }
    }
    this.#manifest.status = "committed";
    this.#manifest.terminalAt = Date.now();
    await this.#assertLocks();
    await writeManifest(this.#manifest, "committed", this.#locks);
    await this.#assertLocks();
    await publishBridges(this.#manifest, "committed", this.#locks);
    await this.#assertLocks();
    await publishBridges(this.#manifest, "terminal", this.#locks);
    await this.#assertLocks();
    await publishTerminal(this.#manifest, this.#locks);
    if (this.#manifest.version === TRANSACTION_VERSION) await pruneTerminal(this.#manifest, this.#locks);
    await this.close();
  }
  async rollback() {
    this.#assertOpen();
    await this.#assertLocks();
    await restoreManifest(this.#manifest, this.#locks);
    this.#manifest.status = "rolled_back";
    this.#manifest.terminalAt = Date.now();
    await this.#assertLocks();
    await writeManifest(this.#manifest, "rolled_back", this.#locks);
    await this.#assertLocks();
    await publishBridges(this.#manifest, "terminal", this.#locks);
    await this.#assertLocks();
    await publishTerminal(this.#manifest, this.#locks);
    if (this.#manifest.version === TRANSACTION_VERSION) await pruneTerminal(this.#manifest, this.#locks);
    await this.close();
  }
  async close() { if (this.#closed) return; this.#closed = true; await Promise.all(this.#locks.reverse().map((lock) => lock.close())); }
  #assertOpen() { if (this.#closed) throw new Error("transaction is closed"); }
  async #assertLocks() { await assertManifestLocks(this.#manifest, this.#locks); }
}

export async function recoverTransactions(root, authority) {
  return (await recoverTransactionsDetailed(root, authority)).recovered;
}

export async function recoverTransactionsDetailed(root, authority) {
  const recoveryAuthority = normalizeRecoveryAuthority(authority);
  for (;;) {
    const { roots, sources } = await discoverRecoveryGraph(root, recoveryAuthority);
    await runTransactionTestHook("afterRecoveryDiscovery", { root, roots: [...roots], sources: [...sources] });
    const locks = [], recovered = [], transactions = [], processedIds = new Set();
    try {
      for (const participantRoot of roots) locks.push(await acquireRootLock(participantRoot));
      await assertManifestLocks(undefined, locks);
      const rescanned = (await Promise.all(locks.map(scanRecoverySources))).flat();
      const rescannedRoots = new Set(roots);
      for (const source of rescanned) for (const participantRoot of await recoverySourceRoots(source, recoveryAuthority)) rescannedRoots.add(participantRoot);
      const sourceKeys = new Set(sources.map(recoverySourceKey));
      if (rescannedRoots.size !== roots.length || rescanned.some((source) => !sourceKeys.has(recoverySourceKey(source)))) continue;
      for (const id of [...new Set(rescanned.map(({ id }) => id))]) {
        const idSources = rescanned.filter((source) => source.id === id);
        if (!await isV3Recovery(idSources, locks)) continue;
        const outcome = await recoverV3Transaction(id, idSources, locks, recoveryAuthority);
        if (!outcome.handled) continue;
        if (outcome.recovered) recovered.push(id);
        if (outcome.operation !== undefined) {
          transactions.push({ id, operation: outcome.operation, boundary: outcome.boundary });
        }
        processedIds.add(id);
      }
      for (const source of rescanned.filter(({ kind }) => kind === "cleanup")) {
        if (processedIds.has(source.id)) continue;
        if (rescanned.some((candidate) => candidate.id === source.id && (candidate.kind === "bundle" || candidate.kind === "journal" || candidate.kind === "terminal"))) continue;
        await recoverCleanupAcknowledgement(source, locks, recoveryAuthority);
        processedIds.add(source.id);
      }
      for (const source of rescanned) {
        if (processedIds.has(source.id)) continue;
        if (source.kind === "bundle") continue;
        if (source.kind === "bridge") {
          const bridge = await recoverOrphanBridge(source, locks, recoveryAuthority);
          if (bridge.orphan) processedIds.add(source.id);
          continue;
        }
        const manifest = await readManifest(source.path, undefined, locks);
        validateManifest(manifest);
        await assertRecoveryAuthority(manifest, locks, recoveryAuthority);
        await assertManifestLocks(manifest, locks);
        if (TERMINAL.has(manifest.status)) {
          await verifyBridges(manifest, "terminal", locks);
          await publishTerminal(manifest, locks);
          await pruneTerminal(manifest, locks);
        } else {
          await verifyJournalReplicas(manifest, locks);
          await assertRecoveryAuthority(manifest, locks, recoveryAuthority);
          await verifyBridges(manifest, "intent", locks);
          await restoreManifest(manifest, locks);
          manifest.status = "rolled_back";
          manifest.terminalAt = Date.now();
          await writeManifest(manifest, "rolled_back", locks);
          await publishBridges(manifest, "terminal", locks);
          await publishTerminal(manifest, locks);
          await pruneTerminal(manifest, locks);
          recovered.push(manifest.id);
        }
        processedIds.add(manifest.id);
      }
      return { recovered, transactions };
    } finally { await Promise.all(locks.reverse().map((lock) => lock.close())); }
  }
}

/**
 * Recovers only a v3 migration bundle whose extra authority is independently
 * proven by the immutable historical registry. This is deliberately not a
 * general bundle-to-authority conversion.
 */
export async function recoverHistoricalTransactions(root, canonicalAuthority) {
  const authority = normalizeRecoveryAuthority(canonicalAuthority);
  const entrant = await rootIdentity(root);
  if (authority.roots.length !== 1 || authority.roots[0] !== entrant
    || authority.participants.length !== 1
    || authority.participants[0].role !== "prospective-installation-target"
    || authority.participants[0].root !== entrant
    || authority.participants[0].coordinationRoot !== entrant) {
    throw new TransactionLockError("recovery_required", "historical recovery requires one canonical caller root");
  }
  const caller = authority.participants[0];
  if (caller.configPath !== join(entrant, ".codex", "config.toml")
    || caller.receiptPath !== join(entrant, ".codex", ".csx-install-receipt.json")) {
    throw new TransactionLockError("recovery_required", "historical recovery canonical layout is invalid");
  }
  const bundleSources = (await collectRecoverySources(entrant)).filter(({ kind }) => kind === "bundle");
  if (bundleSources.length !== 1) {
    throw new TransactionLockError("recovery_required", "historical recovery requires one authority bundle");
  }
  const bundle = await readAuthorityBundle(bundleSources[0].path, bundleSources[0].id);
  assertOperationEndpointAuthority(bundle, authority);
  const roots = await validateCanonicalRecoveryRoots(bundle.roots);
  if (roots.length !== 1 || roots[0] !== entrant || bundle.compatibility === "v2-single-target") {
    throw new TransactionLockError("recovery_required", "historical recovery bundle coordination is invalid");
  }
  const historical = bundle.participants.filter(({ role }) => role === "historical-installation-target");
  const canonical = bundle.participants.filter(({ role }) =>
    role === "prospective-installation-target" || role === "existing-installation-target"
  );
  const metadata = bundle.participants.filter(({ role }) => role === "metadata-participant");
  for (const participant of historical) {
    assertRegisteredHistoricalParticipant(participant, bundle.preimages);
  }
  const differentRootInstall = bundle.operation === "install"
    && canonical.length === 1
    && canonical[0].role === "prospective-installation-target"
    && historical.length >= 1
    && metadata.length === 0
    && historical.every((participant) => participant.root !== entrant);
  const sameRootInstall = bundle.operation === "install"
    && canonical.length === 1
    && canonical[0].role === "existing-installation-target"
    && canonical[0].root === entrant
    && canonical[0].coordinationRoot === entrant
    && metadata.length <= 1
    && metadata.every((participant) => participant.root === entrant && participant.coordinationRoot === entrant)
    && historical.every((participant) => participant.root !== entrant);
  const historicalOnlyUninstall = bundle.operation === "uninstall"
    && canonical.length === 0
    && metadata.length === 0
    && historical.length >= 1;
  if (!differentRootInstall && !sameRootInstall && !historicalOnlyUninstall) {
    throw new TransactionLockError("recovery_required", "historical recovery bundle topology is invalid");
  }
  if (differentRootInstall) assertCanonicalBundleParticipant(canonical[0], caller, bundle.preimages);
  if (sameRootInstall) {
    assertRegisteredHistoricalParticipant(canonical[0], bundle.preimages);
    const expansion = [...new Set(caller.paths)].filter((path) => !canonical[0].paths.includes(path)).sort();
    if (canonical[0].paths.some((path) => !caller.paths.includes(path))
      || metadata.length !== (expansion.length ? 1 : 0)
      || metadata[0]?.paths.join("\0") !== (expansion.length ? expansion.join("\0") : undefined)) {
      throw new TransactionLockError("recovery_required", "historical recovery metadata is not the exact canonical expansion");
    }
  }
  const participantPaths = bundle.participants.flatMap(({ paths }) => paths).sort();
  const snapshotSet = [...bundle.snapshotSet].sort();
  const writeSet = [...bundle.writeSet].sort();
  if (participantPaths.length !== new Set(participantPaths).size
    || participantPaths.join("\0") !== snapshotSet.join("\0")
    || writeSet.join("\0") !== snapshotSet.join("\0")
    || Object.keys(bundle.finalEndpoints).sort().join("\0") !== writeSet.join("\0")) {
    throw new TransactionLockError("recovery_required", "historical recovery operation paths are not exact");
  }
  const endpointStates = await Promise.all(bundle.writeSet.map(async (path) => {
    const current = await readCurrentSnapshot(path);
    return {
      preimage: sameSnapshot(current, bundle.preimages[path]),
      final: matchesIntent(current, bundle.finalEndpoints[path])
    };
  }));
  const boundary = endpointStates.every(({ preimage }) => preimage)
    ? "all-preimage"
    : endpointStates.every(({ final }) => final) ? "all-final" : "mixed";
  const expanded = recoveryAuthorityFromDeclaration({
    coordinationRoots: [entrant],
    participants: bundle.participants,
    snapshotSet: bundle.snapshotSet,
    operationEndpoints: authority.operationEndpoints
  });
  const recovered = await recoverTransactions(entrant, expanded);
  return { recovered, operation: bundle.operation, boundary };
}

function assertRegisteredHistoricalParticipant(participant, preimages) {
  if (!participant.paths.every((path) => preimages[path])
    || participant.paths.some((path) => !sameSnapshot(participant.preimages?.[path], preimages[path]))
    || !matchHistoricalParticipantPreimages(participant, Object.fromEntries(
      participant.paths.map((path) => [path, preimages[path]])
    ))) {
    throw new TransactionLockError("recovery_required", "historical recovery bundle is not an exact registered family");
  }
}
async function readCurrentSnapshot(path) {
  try {
    return await readRegularFile(path);
  } catch (cause) {
    if (cause?.code === "ENOENT") return { state: "absent" };
    throw cause;
  }
}

function assertCanonicalBundleParticipant(participant, caller, preimages) {
  if (participant.root !== caller.root
    || participant.coordinationRoot !== caller.coordinationRoot
    || participant.configPath !== caller.configPath
    || participant.receiptPath !== caller.receiptPath
    || participant.paths.join("\0") !== caller.paths.join("\0")) {
    throw new TransactionLockError("recovery_required", "historical recovery canonical metadata does not match caller layout");
  }
  if (participant.role === "prospective-installation-target") {
    if (participant.paths.some((path) => !sameSnapshot(participant.preimages[path], preimages[path]))) {
      throw new TransactionLockError("recovery_required", "historical recovery canonical preimages are invalid");
    }
    return;
  }
  if (!sameSnapshot(participant.receiptSnapshot, preimages[participant.receiptPath])) {
    throw new TransactionLockError("recovery_required", "historical recovery canonical receipt preimage is invalid");
  }
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(preimages[participant.receiptPath].data, "base64").toString("utf8"));
  } catch (cause) {
    throw new TransactionLockError("recovery_required", "historical recovery canonical receipt is invalid", cause);
  }
  const receiptPaths = receipt.files?.map((path) => resolve(path));
  const expected = [...new Set([...(receiptPaths ?? []), participant.configPath, participant.receiptPath])].sort();
  if (JSON.stringify(receipt) !== JSON.stringify(participant.receipt)
    || resolve(receipt.root) !== participant.root
    || expected.length !== participant.paths.length
    || expected.join("\0") !== participant.paths.join("\0")) {
    throw new TransactionLockError("recovery_required", "historical recovery canonical receipt authority is invalid");
  }
}
async function isV3Recovery(sources, locks) {
  if (sources.some(({ kind }) => kind === "bundle")) return true;
  for (const source of sources.filter(({ kind }) => kind !== "cleanup")) {
    let record;
    try { record = JSON.parse(await readControlFile(source.path, undefined, locks)); }
    catch (cause) {
      if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", `transaction ${source.kind} is malformed`, cause);
      throw cause;
    }
    if (record?.version === TRANSACTION_VERSION) return true;
  }
  return false;
}
async function recoverV3Transaction(id, sources, locks, authority) {
  const bundleSources = sources.filter(({ kind }) => kind === "bundle");
  let canonicalBytes;
  let bundle;
  for (const source of bundleSources) {
    const bytes = await readControlFile(source.path, undefined, locks);
    if (canonicalBytes !== undefined && bytes !== canonicalBytes) throw new TransactionLockError("recovery_required", "transaction authority bundle replicas disagree");
    canonicalBytes ??= bytes;
    let replica;
    try { replica = JSON.parse(bytes); }
    catch (cause) { throw new TransactionLockError("recovery_required", "transaction authority bundle is malformed", cause); }
    validateAuthorityBundle(replica, id);
    bundle ??= replica;
  }
  if (!bundle) {
    await recoverBundlelessV3(id, sources, locks, authority);
    return { handled: true, recovered: false };
  }
  const rootSet = bundle.roots.map(({ root }) => resolve(root));
  if (rootSet.length !== locks.length || rootSet.some((root) => !locks.some((lock) => lock.root === root))) throw new TransactionLockError("recovery_required", "transaction authority bundle roots are not locked");
  assertRecoveryBundleAuthorized(bundle, authority);
  const operationAuthorized = assertOperationEndpointAuthority(bundle, authority);
  const records = [];
  for (const source of sources.filter(({ kind }) => kind === "journal" || kind === "terminal")) {
    const record = await readManifest(source.path, undefined, locks);
    validateManifest(record);
    if (record.version !== TRANSACTION_VERSION || record.authorityHash !== bundle.authorityHash || !manifestMatchesBundle(record, bundle)) throw new TransactionLockError("recovery_required", "transaction journal exceeds immutable bundle authority");
    records.push(record);
  }
  for (const source of sources.filter(({ kind }) => kind === "bridge")) {
    let bridge;
    try { bridge = JSON.parse(await readControlFile(source.path, undefined, locks)); }
    catch (cause) { throw new TransactionLockError("recovery_required", "transaction bridge is malformed", cause); }
    if (bridge.version !== TRANSACTION_VERSION || bridge.id !== id || !BRIDGE_STATES.has(bridge.state)) throw new TransactionLockError("recovery_required", "transaction bridge is malformed");
    assertRecoveryBridgeAuthorized(bridge, authority);
    const bridgeRoots = [{ root: bridge.root, rootKey: bridge.rootKey, control: bridge.control }, ...bridge.peers].sort((left, right) => rootKey(left.root).localeCompare(rootKey(right.root)));
    if (JSON.stringify(bridge.participants) !== JSON.stringify(bundle.participants)
      || JSON.stringify(bridge.snapshotSet) !== JSON.stringify(bundle.snapshotSet)
      || JSON.stringify(bridge.writeSet) !== JSON.stringify(bundle.writeSet)
      || JSON.stringify(bridgeRoots) !== JSON.stringify(bundle.roots)) {
      throw new TransactionLockError("recovery_required", "transaction bridge disagrees with immutable bundle authority");
    }
  }
  for (const source of sources.filter(({ kind }) => kind === "cleanup")) {
    const acknowledgement = await readCleanupAcknowledgement(source.path, id, undefined, locks);
    if (acknowledgement.version !== TRANSACTION_VERSION
      || JSON.stringify(acknowledgement.participants) !== JSON.stringify(bundle.participants)
      || JSON.stringify(acknowledgement.snapshotSet) !== JSON.stringify(bundle.snapshotSet)
      || JSON.stringify(acknowledgement.writeSet) !== JSON.stringify(bundle.writeSet)
      || JSON.stringify(acknowledgement.roots) !== JSON.stringify(bundle.roots)) {
      throw new TransactionLockError("recovery_required", "transaction cleanup residue disagrees with immutable bundle authority");
    }
  }
  if (bundle.compatibility === "v2-single-target") {
    if (records.length) return { handled: false, recovered: false };
    await removeV3ArtifactsLast(bundle, locks);
    return { handled: true, recovered: false };
  }
  const view = {
    id,
    participants: bundle.participants,
    roots: bundle.roots,
    snapshotSet: bundle.snapshotSet,
    writeSet: bundle.writeSet,
    snapshots: bundle.preimages,
    intended: bundle.finalEndpoints
  };
  const states = [];
  for (const path of bundle.writeSet) {
    await assertAuthorizedPath(view, path);
    const current = await snapshot(path, view, locks);
    states.push({
      preimage: sameSnapshot(current, bundle.preimages[path]),
      final: matchesIntent(current, bundle.finalEndpoints[path])
    });
  }
  const allPreimage = states.every(({ preimage }) => preimage);
  const allFinal = states.every(({ final }) => final);
  if (!allPreimage && !allFinal) {
    const error = new TransactionLockError("recovery_required", "transaction endpoints are mixed or unsafe");
    if (operationAuthorized) error.authorizedRecoveryBundle = true;
    throw error;
  }
  await removeV3ArtifactsLast(bundle, locks);
  return {
    handled: true,
    recovered: operationAuthorized || allPreimage || records.some(({ status }) => !TERMINAL.has(status)),
    ...(operationAuthorized
      ? { operation: bundle.operation, boundary: allPreimage ? "all-preimage" : "all-final" }
      : {})
  };
}
async function recoverBundlelessV3(id, sources, locks, authority) {
  const records = [];
  for (const source of sources) {
    let record;
    try { record = JSON.parse(await readControlFile(source.path, undefined, locks)); }
    catch (cause) { throw new TransactionLockError("recovery_required", `transaction ${source.kind} is malformed`, cause); }
    records.push({ source, record });
  }
  for (const { source, record } of records) {
    if (record?.version !== TRANSACTION_VERSION || record.id !== id) throw new TransactionLockError("recovery_required", "bundle-less transaction residue is invalid");
    if (source.kind === "journal" && !TERMINAL.has(record.status)) throw new TransactionLockError("recovery_required", "bundle-less nonterminal transaction requires recovery");
    if (source.kind === "bridge" && record.state !== "intent") throw new TransactionLockError("recovery_required", "bundle-less mutation-capable bridge requires recovery");
    if (source.kind === "journal" || source.kind === "terminal") {
      validateManifest(record);
      assertRecoveryManifestAuthorized(record, authority);
    } else if (source.kind === "bridge") {
      assertRecoveryBridgeAuthorized(record, authority);
    } else if (source.kind === "cleanup") {
      assertRecoveryManifestAuthorized({ participants: record.participants, roots: record.roots, snapshotSet: record.snapshotSet, writeSet: record.writeSet, intended: {} }, authority);
    }
    assertExactResidueAuthority(record, authority);
  }
  for (const directory of ["journals", "terminals", "bridges", "cleanup"]) {
    for (const lock of locks) await durableRemove(join(controlPath(lock.root), directory, `${id}.json`), undefined, locks);
  }
}
function assertExactResidueAuthority(record, authority) {
  if (!Array.isArray(record.participants) || !Array.isArray(record.snapshotSet) || !Array.isArray(record.writeSet)) throw new TransactionLockError("recovery_required", "bundle-less residue lacks exact authority");
  const participants = record.participants.map(normalizeParticipant);
  const roots = (record.roots ?? [{ root: record.root }, ...(record.peers ?? [])]).map(({ root }) => resolve(root)).sort((left, right) => rootKey(left).localeCompare(rootKey(right)));
  const paths = [...record.snapshotSet].map((path) => resolve(path)).sort();
  if (JSON.stringify(participants) !== JSON.stringify(authority.participants)
    || !sameRoots(roots, authority.roots)
    || JSON.stringify(paths) !== JSON.stringify(authority.paths)
    || record.writeSet.some((path) => !authority.paths.includes(resolve(path)))) {
    throw new TransactionLockError("recovery_required", "bundle-less residue does not exactly match caller authority");
  }
}
async function removeV3ArtifactsLast(bundle, locks) {
  for (const directory of ["journals", "terminals", "bridges", "cleanup"]) {
    for (const { root, control } of bundle.roots) {
      await durableRemove(join(control, directory, `${bundle.id}.json`), undefined, locks);
      await runTransactionTestHook("afterCleanupRootDeletion", { manifest: undefined, root, control, directory });
    }
  }
  for (const { control } of bundle.roots) {
    await durableRemove(authorityBundlePath(control, bundle.id), undefined, locks);
    await runTransactionTestHook("afterAuthorityBundleDeletion", { bundle, control });
  }
}
async function discoverRecoveryGraph(root, authority) {
  const entrant = await rootIdentity(root);
  if (!authority.roots.includes(entrant)) throw new TransactionLockError("recovery_required", "recovery entrant is outside caller authority");
  const queue = [entrant], queuedRoots = new Set(queue), sources = [], sourceKeys = new Set();
  while (queue.length) {
    const current = queue.shift();
    for (const source of await collectRecoverySources(current)) {
      const key = recoverySourceKey(source);
      if (sourceKeys.has(key)) continue;
      sourceKeys.add(key);
      sources.push(source);
      for (const participantRoot of await recoverySourceRoots(source, authority)) {
        if (!queuedRoots.has(participantRoot)) { queuedRoots.add(participantRoot); queue.push(participantRoot); }
      }
    }
  }
  return { roots: [...queuedRoots].sort((left, right) => rootKey(left).localeCompare(rootKey(right))), sources };
}
function recoverySourceKey(source) { return `${source.kind}:${source.root}:${source.id}`; }
async function recoverySourceRoots(source, authority) {
  let record;
  if (source.kind === "bundle") {
    record = await readAuthorityBundle(source.path, source.id);
  } else if (source.kind === "bridge") {
    try { record = JSON.parse(await readControlFile(source.path)); }
    catch (cause) { if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", "transaction bridge is malformed", cause); throw cause; }
    if (!record || ![LEGACY_TRANSACTION_VERSION, TRANSACTION_VERSION].includes(record.version) || record.id !== source.id || !BRIDGE_STATES.has(record.state) || record.root !== source.root || record.rootKey !== rootKey(source.root) || record.control !== controlPath(source.root) || !Array.isArray(record.peers)) throw new TransactionLockError("recovery_required", "transaction bridge is malformed");
    record = { ...record, roots: [{ root: record.root, rootKey: record.rootKey, control: record.control }, ...record.peers] };
  } else if (source.kind === "cleanup") {
    record = await readCleanupAcknowledgement(source.path, source.id);
  } else {
    record = await readManifest(source.path);
    validateManifest(record);
  }
  const roots = await validateCanonicalRecoveryRoots(record.roots);
  if (source.kind === "bridge") assertRecoveryBridgeAuthorized(record, authority);
  assertRecoveryRootsAuthorized(roots, authority);
  if (!roots.includes(source.root)) throw new TransactionLockError("recovery_required", "transaction recovery source root is not declared");
  return roots;
}
async function validateCanonicalRecoveryRoots(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) throw new TransactionLockError("recovery_required", "transaction recovery roots are invalid");
  const roots = [];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.root !== "string" || descriptor.rootKey !== rootKey(descriptor.root) || descriptor.control !== controlPath(descriptor.root)) throw new TransactionLockError("recovery_required", "transaction recovery root descriptor is invalid");
    const root = await rootIdentity(descriptor.root).catch((cause) => { throw new TransactionLockError("recovery_required", "transaction recovery root is invalid", cause); });
    if (descriptor.root !== root || !isContained(root, descriptor.control)) throw new TransactionLockError("recovery_required", "transaction recovery root is not canonical");
    const control = await lstat(descriptor.control).catch((cause) => {
      if (cause?.code === "ENOENT") throw new TransactionLockError("recovery_required", "transaction recovery control path is missing", cause);
      throw cause;
    });
    if (!control.isDirectory() || control.isSymbolicLink()) throw new TransactionLockError("recovery_required", "transaction recovery control path is unsafe");
    roots.push(root);
  }
  if (new Set(roots).size !== roots.length) throw new TransactionLockError("recovery_required", "transaction recovery roots are duplicated");
  return roots;
}
async function collectRecoverySources(root) {
  const canonicalRoot = await rootIdentity(root);
  const control = controlPath(canonicalRoot);
  const info = await lstat(control).catch((cause) => cause?.code === "ENOENT" ? null : Promise.reject(cause));
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TransactionLockError("recovery_required", "transaction recovery control path is unsafe");
  return scanRecoverySourcesAtRoot(canonicalRoot);
}
async function scanRecoverySourcesAtRoot(root) {
  const control = controlPath(root);
  const entries = async (name) => (await readdir(join(control, name)).catch((cause) => cause?.code === "ENOENT" ? [] : Promise.reject(cause))).filter((entry) => entry.endsWith(".json"));
  const [bundles, journals, terminals, bridges, cleanup] = await Promise.all([entries("bundles"), entries("journals"), entries("terminals"), entries("bridges"), entries("cleanup")]);
  return [
    ...bundles.map((name) => ({ kind: "bundle", id: name.slice(0, -5), path: join(control, "bundles", name), root })),
    ...journals.map((name) => ({ kind: "journal", id: name.slice(0, -5), path: join(control, "journals", name), root })),
    ...terminals.map((name) => ({ kind: "terminal", id: name.slice(0, -5), path: join(control, "terminals", name), root })),
    ...bridges.map((name) => ({ kind: "bridge", id: name.slice(0, -5), path: join(control, "bridges", name), root })),
    ...cleanup.map((name) => ({ kind: "cleanup", id: name.slice(0, -5), path: join(control, "cleanup", name), root }))
  ].sort((left, right) => left.id.localeCompare(right.id) || ({ bundle: 0, journal: 1, terminal: 2, bridge: 3, cleanup: 4 }[left.kind] - { bundle: 0, journal: 1, terminal: 2, bridge: 3, cleanup: 4 }[right.kind]));
}
async function scanRecoverySources(lock) {
  await assertManifestLocks(undefined, [lock]);
  return scanRecoverySourcesAtRoot(lock.root);
}
async function recoverOrphanBridge(source, heldLocks, authority) {
  let bridge;
  try { bridge = JSON.parse(await readControlFile(source.path, undefined, heldLocks)); }
  catch (cause) { if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", "transaction bridge is malformed", cause); throw cause; }
  if (!bridge || ![LEGACY_TRANSACTION_VERSION, TRANSACTION_VERSION].includes(bridge.version) || bridge.id !== source.id || !BRIDGE_STATES.has(bridge.state) || bridge.root !== source.root || bridge.rootKey !== rootKey(source.root) || bridge.control !== controlPath(source.root) || !Array.isArray(bridge.peers)) throw new TransactionLockError("recovery_required", "transaction bridge is malformed");
  const roots = (await validateCanonicalRecoveryRoots([{ root: bridge.root, rootKey: bridge.rootKey, control: bridge.control }, ...bridge.peers])).sort((left, right) => rootKey(left).localeCompare(rootKey(right)));
  assertRecoveryRootsAuthorized(roots, authority);
  assertRecoveryBridgeAuthorized(bridge, authority);
  const locks = heldLocks ?? [];
  try {
    if (!heldLocks) for (const root of roots) locks.push(await acquireRootLock(root));
    await assertManifestLocks(undefined, locks);
    for (const root of roots) for (const directory of ["journals", "terminals"]) {
      try { await readControlFile(join(controlPath(root), directory, `${source.id}.json`), undefined, locks); return { roots, orphan: false }; }
      catch (cause) { if (cause?.code !== "ENOENT") throw cause; }
    }
    if (bridge.state !== "intent") return { roots, orphan: false };
    for (const root of roots) await durableRemove(join(controlPath(root), "bridges", `${source.id}.json`), undefined, locks);
    return { roots, orphan: true };
  } finally { if (!heldLocks) await Promise.all(locks.reverse().map((lock) => lock.close())); }
}

function validateDeclaration(operation, participants, snapshotSet, writeSet, finalEndpoints) {
  if (typeof operation !== "string" || !Array.isArray(participants) || participants.length === 0) throw new Error("transaction requires participants");
  if (!Array.isArray(snapshotSet) || !Array.isArray(writeSet)) throw new Error("transaction requires snapshotSet and writeSet");
  for (const participant of participants) {
    if (!ROLES.has(participant?.role)) throw new Error("transaction participant role is invalid");
    if (participant.role === "prospective-installation-target" && operation !== "install") throw new Error("prospective participant is valid only for install");
    if (participant.role === "historical-installation-target" && !["install", "uninstall"].includes(operation)) throw new Error("historical participant is valid only for migration");
    if (typeof participant.root !== "string" || (participant.coordinationRoot !== undefined && typeof participant.coordinationRoot !== "string") || !Array.isArray(participant.paths)) throw new Error("transaction participant role is invalid");
    validateParticipantDescriptor(participant);
  }
  const canonicalTargets = participants.filter(({ role }) => role === "prospective-installation-target" || role === "existing-installation-target");
  const historicalTargets = participants.filter(({ role }) => role === "historical-installation-target");
  if (operation === "install" && canonicalTargets.length !== 1) throw new Error("install transaction requires exactly one canonical installation target");
  if (operation === "uninstall" && (canonicalTargets.length > 1 || canonicalTargets.some(({ role }) => role !== "existing-installation-target") || canonicalTargets.length + historicalTargets.length < 1)) throw new Error("uninstall transaction topology is invalid");
  if (!["install", "uninstall"].includes(operation) && (canonicalTargets.length !== 1 || historicalTargets.length !== 0)) throw new Error("transaction requires exactly one installation target");
  if (historicalTargets.length === 0 && new Set(participants.map(({ root }) => resolve(root))).size > 1 && participants.filter(({ role }) => role === "metadata-participant").length !== 1) throw new Error("multi-root transactions require exactly one declared metadata participant");
  if (historicalTargets.length && canonicalRoots(participants).length !== 1) throw new Error("migration participants require one canonical coordination root");
  const snapshot = new Set(snapshotSet.map((path) => resolve(path)));
  const writes = new Set(writeSet.map((path) => resolve(path)));
  if (snapshot.size !== snapshotSet.length || writes.size !== writeSet.length || [...writes].some((path) => !snapshot.has(path))) throw new Error("writeSet must be a unique subset of snapshotSet");
  const ownedPaths = participants.flatMap(({ paths }) => paths.map((path) => resolve(path)));
  const authorized = new Set(ownedPaths);
  if (authorized.size !== ownedPaths.length) throw new Error("transaction participant ownership overlaps");
  if ([...snapshot].some((path) => !authorized.has(path))) throw new Error("transaction paths must be declared by a participant");
  if (historicalTargets.length && (snapshot.size !== authorized.size || [...authorized].some((path) => !snapshot.has(path)))) throw new Error("migration snapshotSet must exactly match participant authority");
  if (finalEndpoints !== undefined) normalizeFinalEndpoints(finalEndpoints, [...writes], true);
  else if (historicalTargets.length) throw new Error("migration transaction requires declared final endpoints");
}
function canonicalRoots(participants) { return [...new Set(participants.map(({ root, coordinationRoot = root }) => resolve(coordinationRoot)))].sort((a, b) => rootKey(a).localeCompare(rootKey(b))); }
function sameRoots(left, right) { return left.length === right.length && left.every((root, index) => root === right[index]); }
async function assertManifestLocks(manifest, locks) {
  await Promise.all(locks.map((lock) => lock.assertValid?.()));
  if (!manifest?.participants) return;
  for (const participant of manifest.participants) {
    const root = await rootIdentity(participant.coordinationRoot ?? participant.root);
    const lock = locks.find((candidate) => candidate.root === root);
    const declared = manifest.roots.find((candidate) => candidate.root === root && candidate.rootKey === rootKey(root) && candidate.control === controlPath(root));
    if (!lock || !declared) throw new TransactionLockError("recovery_required", "transaction coordination root changed while held");
  }
}
async function hasNonterminalOverlap(locks) {
  for (const lock of locks) {
    const directory = join(controlPath(lock.root), "journals");
    let entries;
    try {
      entries = await readdir(directory);
    } catch (cause) {
      if (cause?.code === "ENOENT") continue;
      throw cause;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const manifest = await readManifest(join(directory, entry), undefined, locks);
      validateManifest(manifest);
      if (!TERMINAL.has(manifest.status)) return true;
    }
  }
  return false;
}
async function createManifest({ id, operation, participants, snapshotSet, writeSet, intended, finalEndpoints, roots, locks }) {
  const normalizedParticipants = participants.map(normalizeParticipant);
  const snapshots = {};
  for (const path of snapshotSet.map((path) => resolve(path))) {
    const owner = normalizedParticipants.find((participant) => participant.paths.includes(path));
    await assertSafeContainment(owner.root, path);
    await classifyLocalFilesystem(dirname(path));
    snapshots[path] = await snapshot(path, undefined, locks);
  }
  assertParticipantSnapshots(normalizedParticipants, snapshots);
  const bridgeRequired = roots.length > 1 && normalizedParticipants.some(({ role }) => role === "metadata-participant");
  const normalizedIntended = {};
  for (const [path, value] of Object.entries(intended)) normalizedIntended[resolve(path)] = normalizeIntent(value);
  const normalizedWriteSet = writeSet.map((path) => resolve(path)).sort();
  const normalizedFinalEndpoints = normalizeFinalEndpoints(finalEndpoints ?? {}, normalizedWriteSet, finalEndpoints !== undefined);
  const manifest = { version: TRANSACTION_VERSION, id, operation, status: "prepared", participants: normalizedParticipants, roots: roots.map((root) => ({ root, rootKey: rootKey(root), control: controlPath(root) })), snapshotSet: Object.keys(snapshots).sort(), writeSet: normalizedWriteSet, snapshots, finalEndpoints: normalizedFinalEndpoints, compatibility: finalEndpoints === undefined ? "v2-single-target" : undefined, intended: normalizedIntended, progress: {}, bridges: bridgeRequired ? roots.map((root) => ({ root, rootKey: rootKey(root), control: controlPath(root), peers: roots.filter((peer) => peer !== root).map((peer) => ({ root: peer, rootKey: rootKey(peer), control: controlPath(peer) })) })) : [] };
  const bundle = authorityBundle(manifest);
  manifest.authorityHash = bundle.authorityHash;
  return manifest;
}
function normalizeFinalEndpoints(finalEndpoints, writeSet, requireExact) {
  if (!plainObject(finalEndpoints)) throw new Error("transaction final endpoints are invalid");
  const normalized = {};
  for (const [path, value] of Object.entries(finalEndpoints)) {
    const target = resolve(path);
    const endpoint = normalizeIntent(value);
    if (endpoint.state === "present" && typeof endpoint.data !== "string") throw new Error("transaction final endpoint requires exact data");
    normalized[target] = endpoint;
  }
  const paths = Object.keys(normalized).sort();
  if (paths.length !== Object.keys(finalEndpoints).length || paths.some((path) => !writeSet.includes(path)) || (requireExact && (paths.length !== writeSet.length || writeSet.some((path) => !normalized[path])))) {
    throw new Error("transaction final endpoints must exactly match writeSet");
  }
  return Object.fromEntries(paths.map((path) => [path, normalized[path]]));
}
function authorityBundle(manifest) {
  const unsigned = {
    version: TRANSACTION_VERSION,
    id: manifest.id,
    operation: manifest.operation,
    roots: manifest.roots.map(({ root, rootKey: key, control }) => ({ root, rootKey: key, control })),
    participants: manifest.participants,
    authorizedPaths: [...new Set(manifest.participants.flatMap(({ paths }) => paths))].sort(),
    snapshotSet: manifest.snapshotSet,
    writeSet: manifest.writeSet,
    preimages: manifest.snapshots,
    finalEndpoints: manifest.finalEndpoints,
    compatibility: manifest.compatibility
  };
  return { ...unsigned, authorityHash: digest(canonicalJson(unsigned)) };
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function authorityBundlePath(control, id) { return join(control, "bundles", `${id}.json`); }
async function publishAuthorityBundle(manifest, locks) {
  const bundle = authorityBundle(manifest);
  if (bundle.authorityHash !== manifest.authorityHash) throw new TransactionLockError("recovery_required", "transaction authority bundle changed before publication");
  for (const { control } of manifest.roots) {
    await durableJson(authorityBundlePath(control, manifest.id), bundle, manifest, locks);
    await runTransactionTestHook("afterAuthorityBundleReplication", { manifest, control });
  }
}
async function readAuthorityBundle(path, id, manifest, locks) {
  let bundle;
  try { bundle = JSON.parse(await readControlFile(path, manifest, locks)); }
  catch (cause) {
    if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", "transaction authority bundle is malformed", cause);
    throw cause;
  }
  validateAuthorityBundle(bundle, id);
  return bundle;
}
function validateAuthorityBundle(bundle, id) {
  if (!plainObject(bundle) || bundle.version !== TRANSACTION_VERSION || bundle.id !== id || typeof bundle.operation !== "string" || !Array.isArray(bundle.roots) || !Array.isArray(bundle.participants) || !Array.isArray(bundle.authorizedPaths) || !Array.isArray(bundle.snapshotSet) || !Array.isArray(bundle.writeSet) || !plainObject(bundle.preimages) || !plainObject(bundle.finalEndpoints) || typeof bundle.authorityHash !== "string") {
    throw new TransactionLockError("recovery_required", "transaction authority bundle is invalid");
  }
  try { validateDeclaration(bundle.operation, bundle.participants, bundle.snapshotSet, bundle.writeSet, bundle.compatibility === "v2-single-target" ? undefined : bundle.finalEndpoints); }
  catch (cause) { throw new TransactionLockError("recovery_required", "transaction authority bundle topology is invalid", cause); }
  const roots = canonicalRoots(bundle.participants);
  const authorizedPaths = [...new Set(bundle.participants.flatMap(({ paths }) => paths.map((path) => resolve(path))))].sort();
  if (bundle.roots.length !== roots.length
    || bundle.roots.some(({ root, rootKey: key, control }, index) => resolve(root) !== roots[index] || key !== rootKey(root) || control !== controlPath(root))
    || JSON.stringify(bundle.authorizedPaths) !== JSON.stringify(authorizedPaths)
    || Object.keys(bundle.preimages).sort().join("\0") !== [...bundle.snapshotSet].sort().join("\0")) {
    throw new TransactionLockError("recovery_required", "transaction authority bundle paths or roots are invalid");
  }
  for (const path of bundle.snapshotSet) {
    const before = bundle.preimages[path];
    if (!validSnapshot(before) || (before.state === "present" && digest(Buffer.from(before.data, "base64")) !== before.hash)) throw new TransactionLockError("recovery_required", "transaction authority bundle preimage is invalid");
  }
  const { authorityHash, ...unsigned } = bundle;
  if (digest(canonicalJson(unsigned)) !== authorityHash) throw new TransactionLockError("recovery_required", "transaction authority bundle hash is invalid");
}
function manifestMatchesBundle(manifest, bundle) {
  return JSON.stringify(authorityBundle(manifest)) === JSON.stringify(bundle);
}
function assertRecoveryBundleAuthorized(bundle, authority) {
  assertRecoveryManifestAuthorized({
    participants: bundle.participants,
    roots: bundle.roots,
    snapshotSet: bundle.snapshotSet,
    writeSet: bundle.writeSet,
    intended: bundle.finalEndpoints
  }, authority);
  if (bundle.authorizedPaths.length !== authority.paths.length || bundle.authorizedPaths.some((path) => !authority.paths.includes(path))) {
    throw new TransactionLockError("recovery_required", "transaction authority bundle does not exactly match caller authority");
  }
}
function assertOperationEndpointAuthority(bundle, authority) {
  if (authority.operationEndpoints !== "installation-receipts") return false;
  const targets = bundle.participants.filter(({ role }) => role !== "metadata-participant");
  const expectedState = (participant) =>
    bundle.operation === "install" && participant.role !== "historical-installation-target"
      ? "present"
      : bundle.operation === "uninstall" || participant.role === "historical-installation-target"
        ? "absent"
        : undefined;
  const valid = targets.length > 0 && targets.every((participant) => {
    const receiptPath = resolve(participant.receiptPath);
    const endpoint = bundle.finalEndpoints[receiptPath];
    return expectedState(participant) !== undefined
      && bundle.writeSet.includes(receiptPath)
      && endpoint?.state === expectedState(participant);
  });
  if (!valid) {
    const error = new TransactionLockError(
      "recovery_required",
      "transaction operation is not bound to exact installation receipt endpoints"
    );
    error.authorizedRecoveryBundle = true;
    throw error;
  }
  return true;
}
async function snapshot(path, manifest, locks) {
  const ancestors = await ancestorIdentityChain(manifest, path, locks);
  await assertHeld(manifest, locks);
  await assertAncestorIdentityChain(ancestors);
  try {
    return await readRegularFile(path, { manifest, locks, ancestors });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { state: "absent" };
    throw cause;
  }
}
function bridgeValue(manifest, bridge, state) { return { version: manifest.version, id: manifest.id, state, root: bridge.root, rootKey: bridge.rootKey, control: bridge.control, peers: bridge.peers, participants: manifest.participants, snapshotSet: manifest.snapshotSet, writeSet: manifest.writeSet }; }
async function publishBridges(manifest, state, locks) { for (const bridge of manifest.bridges ?? []) await durableJson(join(bridge.control, "bridges", `${manifest.id}.json`), bridgeValue(manifest, bridge, state), manifest, locks); }
async function verifyBridges(manifest, expectedState, locks) {
  let needsRepair = false;
  for (const bridge of manifest.bridges) {
    let persisted;
    try {
      persisted = JSON.parse(await readControlFile(join(bridge.control, "bridges", `${manifest.id}.json`), manifest, locks));
    } catch (cause) {
      if (cause?.code === "ENOENT") { needsRepair = true; continue; }
      if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", "transaction bridge is malformed", cause);
      throw cause;
    }
    if (!BRIDGE_STATES.has(persisted.state) || JSON.stringify(persisted) !== JSON.stringify(bridgeValue(manifest, bridge, persisted.state))) throw new TransactionLockError("recovery_required", "transaction bridge is asymmetric or invalid");
    if (persisted.state !== expectedState) needsRepair = true;
  }
  if (needsRepair) await publishBridges(manifest, expectedState, locks);
}
function manifestPath(manifest, root) { const found = manifest.roots.find(({ root: candidate }) => resolve(candidate) === resolve(root)); return join(found?.control ?? controlPath(root), "journals", `${manifest.id}.json`); }
async function readManifest(path, manifest, locks) {
  let source;
  try {
    source = await readControlFile(path, manifest, locks);
  } catch (cause) {
    if (cause?.code === "ENOENT") throw new TransactionLockError("recovery_required", "transaction manifest is missing", cause);
    throw cause;
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new TransactionLockError("recovery_required", "transaction manifest is malformed", cause);
  }
}
async function verifyJournalReplicas(manifest, locks) {
  const replicas = [];
  for (const { control } of manifest.roots) {
    try {
      const replica = await readManifest(join(control, "journals", `${manifest.id}.json`), manifest, locks);
      validateManifest(replica);
      replicas.push(replica);
    } catch (cause) {
      if (!(cause instanceof TransactionLockError) || cause.message !== "transaction manifest is missing") throw cause;
    }
  }
  const canonical = chooseReplica(replicas);
  if (!canonical) throw new TransactionLockError("recovery_required", "transaction manifest is missing");
  if (!sameImmutableManifest(manifest, canonical)) throw new TransactionLockError("recovery_required", "transaction journals disagree on immutable declaration");
  Object.assign(manifest, canonical);
  await writeManifest(manifest, manifest.status, locks);
}
function chooseReplica(replicas) {
  return replicas.sort((left, right) => progressRank(right) - progressRank(left))[0];
}
function progressRank(manifest) {
  const status = { prepared: 0, committing: 1, committed: 2, rolled_back: 3 }[manifest.status] ?? -1;
  return status * 1_000_000 + Object.values(manifest.progress).filter((value) => value === "applied").length * 1_000 + Object.keys(manifest.intended).length;
}
function sameImmutableManifest(left, right) {
  const omitMutable = ({ status, intended, progress, terminalAt, ...immutable }) => immutable;
  return JSON.stringify(omitMutable(left)) === JSON.stringify(omitMutable(right));
}
async function writeManifest(manifest, status, locks) { manifest.status = status; for (const { control } of manifest.roots) await durableJson(join(control, "journals", `${manifest.id}.json`), manifest, manifest, locks); }
async function recordIntent(manifest, path, intent, locks) { manifest.intended[path] = intent; manifest.progress[path] = "pending"; await writeManifest(manifest, "committing", locks); }
async function recordProgress(manifest, path, locks) { manifest.progress[path] = "applied"; await writeManifest(manifest, "committing", locks); }
async function restoreManifest(manifest, locks) {
  for (const path of manifest.writeSet) {
    await assertAuthorizedPath(manifest, path);
    const before = manifest.snapshots[path], current = await snapshot(path, manifest, locks), intended = manifest.intended[path];
    if (!intended) {
      if (sameSnapshot(before, current)) continue;
      throw new TransactionLockError("recovery_required", `third-state recovery conflict: ${path}`);
    }
    if (sameSnapshot(before, current)) continue;
    if (matchesIntent(current, intended)) {
      await assertAuthorizedPath(manifest, path);
      const expected = intended.state === "absent" ? { state: "absent" } : { state: "present", data: intended.data, hash: intended.hash, mode: intended.mode };
      if (before.state === "absent") await durableRemove(path, manifest, locks, expected);
      else await durableReplace(path, Buffer.from(before.data, "base64"), before.mode, manifest, locks, expected);
      continue;
    }
    throw new TransactionLockError("recovery_required", `third-state recovery conflict: ${path}`);
  }
}
function sameSnapshot(left, right) { return left.state === right.state && (left.state === "absent" || (left.hash === right.hash && left.mode === right.mode)); }
function matchesIntent(current, intent) { return intent.state === "absent" ? current.state === "absent" : current.state === "present" && current.hash === intent.hash && current.mode === intent.mode; }
async function assertExpected(path, before, manifest, locks) { if (manifest) await assertAuthorizedPath(manifest, path); const current = await snapshot(path, manifest, locks); if (!sameSnapshot(before, current)) throw new TransactionLockError("recovery_required", `compare-and-swap preimage changed: ${path}`); }
async function assertHeld(manifest, locks) { if (locks) await assertManifestLocks(manifest, locks); }
async function durableReplace(path, data, mode, manifest, locks, expected) {
  await assertHeld(manifest, locks);
  const ancestors = await pinAndCreateAncestorChain(manifest, path, locks);
  await assertAncestorIdentityChain(ancestors);
  await assertHeld(manifest, locks);
  let effectiveMode = mode;
  if (effectiveMode === undefined) {
    const existing = await stat(path).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    effectiveMode = existing ? existing.mode & 0o777 : 0o600;
  }
  const temporary = `${path}.csx-${randomUUID()}.tmp`;
  await assertAncestorIdentityChain(ancestors);
  await assertHeld(manifest, locks);
  const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, effectiveMode);
  await chmod(temporary, effectiveMode);
  try {
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await assertAncestorIdentityChain(ancestors);
    await handle.writeFile(data);
    await runTransactionTestHook("afterTemporaryWrite", { path, temporary });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await handle.sync();
    await runTransactionTestHook("afterTemporaryFsync", { path, temporary });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
  } finally {
    await handle.close();
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
  }
  try {
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await assertExactMutationPreimage(path, expected, manifest, locks);
    await runTransactionTestHook("beforeTargetRename", { path, temporary });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await assertExactMutationPreimage(path, expected, manifest, locks);
    await rename(temporary, path);
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
  } catch (cause) {
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await runTransactionTestHook("beforeTemporaryCleanup", { path, temporary });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await rm(temporary, { force: true });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    throw cause;
  }
  await fsyncDirectory(dirname(path), manifest, locks, ancestors);
}
async function durableRemove(path, manifest, locks, expected) {
  await assertHeld(manifest, locks);
  const ancestors = await ancestorIdentityChain(manifest, path, locks);
  await assertAncestorIdentityChain(ancestors);
  await assertExactMutationPreimage(path, expected, manifest, locks);
  await runTransactionTestHook("beforeTargetRemove", { path });
  await assertAncestorIdentityChain(ancestors);
  await assertHeld(manifest, locks);
  await assertExactMutationPreimage(path, expected, manifest, locks);
  await rm(path, { force: true });
  await assertAncestorIdentityChain(ancestors);
  await assertHeld(manifest, locks);
  await fsyncDirectory(dirname(path), manifest, locks, ancestors);
}
async function durableJson(path, value, manifest, locks) {
  await assertSafeControlFile(path);
  await durableReplace(path, `${JSON.stringify(value)}\n`, 0o600, manifest, locks);
  await assertSafeControlFile(path);
}
async function fsyncDirectory(path, manifest, locks, ancestors) {
  ancestors ??= await ancestorIdentityChain(manifest, join(path, ".csx-directory-fsync"), locks);
  await assertHeld(manifest, locks);
  await assertAncestorIdentityChain(ancestors);
  const handle = await open(path, "r");
  try {
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
    await assertAncestorIdentityChain(ancestors);
    await handle.sync();
    await runTransactionTestHook("afterDirectoryFsync", { path });
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
  } finally {
    await handle.close();
    await assertAncestorIdentityChain(ancestors);
    await assertHeld(manifest, locks);
  }
}
async function assertExactMutationPreimage(path, expected, manifest, locks) {
  if (expected) await assertExpected(path, expected, manifest, locks);
}
async function pinAndCreateAncestorChain(manifest, path, locks) {
  const parent = resolve(dirname(path));
  const root = manifest?.participants?.find(({ root: candidate }) => isContained(candidate, parent))?.root
    ?? manifest?.roots?.map(({ root: candidate, control }) => candidate ?? dirname(control)).find((candidate) => isContained(candidate, parent))
    ?? locks?.map(({ root: candidate, control }) => candidate ?? (control ? dirname(control) : undefined)).find((candidate) => candidate && isContained(candidate, parent));
  if (!root) return ancestorIdentityChain(manifest, path, locks);
  const resolvedRoot = resolve(root);
  if (!isContained(resolvedRoot, parent)) throw new TransactionLockError("recovery_required", `transaction parent escapes its authorized root: ${parent}`);
  const chain = [{ path: resolvedRoot, identity: await directoryIdentity(resolvedRoot) }];
  const segments = parent.slice(resolvedRoot.length).replace(/^[/\\]+/, "").split(/[/\\]+/).filter(Boolean);
  let current = resolvedRoot, missing = false;
  for (const segment of segments) {
    current = join(current, segment);
    if (!missing) {
      try { chain.push({ path: current, identity: await directoryIdentity(current) }); continue; }
      catch (cause) { if (cause?.code !== "ENOENT") throw cause; missing = true; }
    }
    await assertAncestorIdentityChain(chain);
    await assertHeld(manifest, locks);
    await runTransactionTestHook("beforeParentCreation", { path, parent: current });
    await assertAncestorIdentityChain(chain);
    await assertHeld(manifest, locks);
    await mkdir(current);
    chain.push({ path: current, identity: await directoryIdentity(current) });
  }
  return chain;
}
async function ancestorIdentityChain(manifest, path, locks) {
  const parent = resolve(dirname(path));
  const participant = manifest?.participants?.find(({ root }) => isContained(root, parent));
  const root = participant?.root
    ?? manifest?.roots?.map(({ root: candidate, control }) => candidate ?? dirname(control)).find((candidate) => isContained(candidate, parent))
    ?? locks?.map(({ root: candidate, control }) => candidate ?? (control ? dirname(control) : undefined)).find((candidate) => candidate && isContained(candidate, parent));
  if (!root) return [{ path: parent, identity: await directoryIdentity(parent) }];
  const resolvedRoot = resolve(root);
  if (!isContained(resolvedRoot, parent)) throw new TransactionLockError("recovery_required", `transaction parent escapes its authorized root: ${parent}`);
  const chain = [];
  let current = resolvedRoot;
  chain.push({ path: current, identity: await directoryIdentity(current) });
  const relative = parent.slice(resolvedRoot.length).replace(/^[/\\]+/, "");
  for (const segment of relative ? relative.split(/[/\\]+/) : []) {
    current = join(current, segment);
    try {
      chain.push({ path: current, identity: await directoryIdentity(current) });
    } catch (cause) {
      if (cause?.code === "ENOENT") break;
      throw cause;
    }
  }
  return chain;
}
async function assertAncestorIdentityChain(chain) {
  for (const { path, identity } of chain) await assertDirectoryIdentity(path, identity);
}
async function directoryIdentity(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TransactionLockError("recovery_required", `transaction parent directory is unsafe: ${path}`);
  return { dev: info.dev, ino: info.ino };
}
async function assertDirectoryIdentity(path, expected) {
  const current = await directoryIdentity(path);
  if (current.dev !== expected.dev || current.ino !== expected.ino) throw new TransactionLockError("recovery_required", `transaction parent directory changed during mutation: ${path}`);
}
async function assertSafeControlFile(path) {
  const info = await lstat(path).catch((cause) => {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  });
  if (info && (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600)) throw new TransactionLockError("recovery_required", `transaction control file is unsafe: ${path}`);
}
async function readControlFile(path, manifest, locks) {
  return Buffer.from((await readRegularFile(path, { control: true, manifest, locks })).data, "base64").toString("utf8");
}
async function readRegularFile(path, { control = false, manifest, locks, ancestors } = {}) {
  ancestors ??= await ancestorIdentityChain(manifest, path, locks);
  await assertHeld(manifest, locks);
  await assertAncestorIdentityChain(ancestors);
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || (control && (info.mode & 0o777) !== 0o600)) {
      throw new TransactionLockError("recovery_required", `${control ? "transaction control file" : "snapshot path"} is unsafe: ${path}`);
    }
    await assertHeld(manifest, locks);
    await assertAncestorIdentityChain(ancestors);
    const data = await handle.readFile();
    await assertHeld(manifest, locks);
    await assertAncestorIdentityChain(ancestors);
    return { state: "present", data: data.toString("base64"), hash: digest(data), mode: info.mode & 0o777 };
  } catch (cause) {
    if (cause?.code === "ELOOP") throw new TransactionLockError("recovery_required", `${control ? "transaction control file" : "snapshot path"} is unsafe: ${path}`, cause);
    throw cause;
  } finally {
    await handle?.close();
  }
}
function digest(data) { return createHash("sha256").update(data).digest("hex"); }
function normalizeIntent(value) {
  if (typeof value === "string") return { state: "present", hash: value };
  if (!value || !INTENT_STATES.has(value.state)) throw new Error("transaction intended output is invalid");
  if (value.state === "absent") return { state: "absent" };
  if (typeof value.hash !== "string" || !Number.isInteger(value.mode) || (value.data !== undefined && (typeof value.data !== "string" || digest(Buffer.from(value.data, "base64")) !== value.hash))) throw new Error("transaction intended output is invalid");
  return { state: "present", hash: value.hash, ...(value.data === undefined ? {} : { data: value.data }), mode: value.mode };
}
function validateManifest(manifest) {
  if (!manifest || ![LEGACY_TRANSACTION_VERSION, TRANSACTION_VERSION].includes(manifest.version) || typeof manifest.id !== "string" || !/^[A-Za-z0-9-]+$/.test(manifest.id) || !["prepared", "committing", "committed", "rolled_back"].includes(manifest.status) || !Array.isArray(manifest.participants) || !Array.isArray(manifest.snapshotSet) || !Array.isArray(manifest.writeSet) || !Array.isArray(manifest.roots) || !Array.isArray(manifest.bridges) || !plainObject(manifest.snapshots) || !plainObject(manifest.intended) || !plainObject(manifest.progress)) throw new TransactionLockError("recovery_required", "transaction manifest is invalid");
  if (manifest.version === TRANSACTION_VERSION && (!plainObject(manifest.finalEndpoints) || typeof manifest.authorityHash !== "string")) throw new TransactionLockError("recovery_required", "transaction manifest lacks immutable authority");
  try { validateDeclaration(manifest.operation, manifest.participants, manifest.snapshotSet, manifest.writeSet, manifest.version === TRANSACTION_VERSION && manifest.compatibility !== "v2-single-target" ? manifest.finalEndpoints : undefined); } catch (cause) { throw new TransactionLockError("recovery_required", "transaction manifest authorization is invalid", cause); }
  for (const participant of manifest.participants) {
    if (!Array.isArray(participant.paths) || participant.paths.some((path) => typeof path !== "string" || !isContained(participant.root, path))) {
      throw new TransactionLockError("recovery_required", "transaction participant paths escape their declared root");
    }
  }
  try { manifest.participants.forEach(validateParticipantDescriptor); } catch (cause) { throw new TransactionLockError("recovery_required", "transaction manifest authorization is invalid", cause); }
  const roots = canonicalRoots(manifest.participants);
  if (manifest.roots.length !== roots.length || manifest.roots.some(({ root, rootKey: key, control }, index) => resolve(root) !== roots[index] || key !== rootKey(root) || control !== controlPath(root))) throw new TransactionLockError("recovery_required", "transaction manifest roots are invalid");
  const bridgeRequired = roots.length > 1 && manifest.participants.some(({ role }) => role === "metadata-participant");
  if (manifest.bridges.length !== (bridgeRequired ? roots.length : 0) || manifest.bridges.some((bridge) => !bridge || !roots.includes(resolve(bridge.root)) || bridge.rootKey !== rootKey(bridge.root) || bridge.control !== controlPath(bridge.root) || !Array.isArray(bridge.peers) || bridge.peers.length !== roots.length - 1 || bridge.peers.some((peer) => !peer || !roots.includes(resolve(peer.root)) || resolve(peer.root) === resolve(bridge.root) || peer.rootKey !== rootKey(peer.root) || peer.control !== controlPath(peer.root)))) throw new TransactionLockError("recovery_required", "transaction manifest bridges are invalid");
  if (Object.keys(manifest.snapshots).length !== manifest.snapshotSet.length || Object.keys(manifest.intended).some((path) => !manifest.writeSet.includes(path)) || Object.keys(manifest.progress).some((path) => !manifest.writeSet.includes(path))) throw new TransactionLockError("recovery_required", "transaction manifest paths are invalid");
  for (const path of manifest.snapshotSet) {
    const value = manifest.snapshots[path];
    if (!validSnapshot(value) || (value.state === "present" && digest(Buffer.from(value.data, "base64")) !== value.hash)) throw new TransactionLockError("recovery_required", "transaction manifest snapshot is invalid");
    if (manifest.intended[path]) normalizeIntent(manifest.intended[path]);
    if (manifest.progress[path] && !["pending", "applied"].includes(manifest.progress[path])) throw new TransactionLockError("recovery_required", "transaction manifest progress is invalid");
  }
  for (const participant of manifest.participants) {
    if (participant.role === "prospective-installation-target" && participant.paths.some((path) => !sameSnapshot(participant.preimages[path], manifest.snapshots[path]))) throw new TransactionLockError("recovery_required", "prospective transaction preimage is invalid");
    if (participant.preimages !== undefined && participant.paths.some((path) => !sameSnapshot(participant.preimages[path], manifest.snapshots[path]))) throw new TransactionLockError("recovery_required", "historical transaction preimage is invalid");
    if (participant.role === "existing-installation-target" && participant.preimages === undefined && !sameSnapshot(participant.receiptSnapshot, manifest.snapshots[participant.receiptPath])) throw new TransactionLockError("recovery_required", "existing transaction receipt snapshot is invalid");
  }
}

async function assertRecoveryAuthority(manifest, locks, authority) {
  assertRecoveryManifestAuthorized(manifest, authority);
  for (const participant of manifest.participants) {
    const root = resolve(participant.root);
    const authorized = new Set(participant.paths.map((path) => resolve(path)));
    for (const path of participant.paths) {
      if (!isContained(root, path)) throw new TransactionLockError("recovery_required", `transaction participant path escapes its root: ${path}`);
      await assertSafeContainment(root, path);
      await classifyLocalFilesystem(dirname(path));
    }
    if (participant.role === "prospective-installation-target") continue;
    if (!["existing-installation-target", "historical-installation-target"].includes(participant.role)) continue;
    const receiptSnapshot = manifest.snapshots[participant.receiptPath];
    const receipt = await authoritativeReceipt(manifest, participant, receiptSnapshot, locks);
    if (resolve(receipt.root) !== root || !Array.isArray(receipt.files)) throw new TransactionLockError("recovery_required", "existing transaction receipt authority is invalid");
    const receiptPaths = new Set(receipt.files.map((path) => resolve(path)));
    const expectedAuthority = new Set([...receiptPaths, resolve(participant.configPath), resolve(participant.receiptPath)]);
    if (receiptPaths.size !== receipt.files.length || authorized.size !== expectedAuthority.size || [...authorized].some((path) => !expectedAuthority.has(path))) {
      throw new TransactionLockError("recovery_required", "existing transaction authority does not exactly match its receipt");
    }
  }
  for (const path of manifest.snapshotSet) {
    const owner = manifest.participants.find((participant) => participant.paths.map((candidate) => resolve(candidate)).includes(resolve(path)));
    if (!owner || !isContained(owner.root, path)) throw new TransactionLockError("recovery_required", `transaction snapshot path is not independently authorized: ${path}`);
  }
}
function plainObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function normalizeParticipant(participant) {
  const paths = [...new Set(participant.paths.map((path) => resolve(path)))].sort();
  const base = { role: participant.role, root: resolve(participant.root), coordinationRoot: resolve(participant.coordinationRoot ?? participant.root), paths };
  if (participant.role === "metadata-participant") return { ...base, schema: structuredClone(participant.schema) };
  const configPath = resolve(participant.configPath);
  const receiptPath = resolve(participant.receiptPath);
  if (participant.role === "prospective-installation-target") return { ...base, configPath, receiptPath, preimages: structuredClone(participant.preimages) };
  return {
    ...base,
    configPath,
    receiptPath,
    receipt: structuredClone(participant.receipt),
    receiptSnapshot: structuredClone(participant.receiptSnapshot),
    ...(participant.preimages !== undefined
      ? { preimages: structuredClone(participant.preimages) }
      : {})
  };
}
function validateParticipantDescriptor(participant) {
  if (participant.role === "metadata-participant") {
    if (!plainObject(participant.schema) || participant.schema.version !== 1 || participant.schema.type !== "csx-metadata") throw new Error("metadata participant schema is invalid");
    return;
  }
  if (typeof participant.configPath !== "string" || typeof participant.receiptPath !== "string" || !participant.paths.includes(resolve(participant.configPath)) || !participant.paths.includes(resolve(participant.receiptPath))) throw new Error("installation participant descriptor is invalid");
  if (participant.role === "prospective-installation-target") {
    if (!plainObject(participant.preimages) || Object.keys(participant.preimages).length !== participant.paths.length || participant.paths.some((path) => !validSnapshot(participant.preimages[path]))) throw new Error("prospective participant preimages are invalid");
    return;
  }
  if (!plainObject(participant.receipt) || !validSnapshot(participant.receiptSnapshot) || participant.receiptSnapshot.state !== "present") throw new Error("existing participant receipt snapshot is invalid");
  if (digest(Buffer.from(participant.receiptSnapshot.data, "base64")) !== participant.receiptSnapshot.hash) throw new Error("existing participant receipt snapshot hash is invalid");
  if (participant.preimages !== undefined) {
    if (!plainObject(participant.preimages)
      || Object.keys(participant.preimages).sort().join("\0") !== participant.paths.join("\0")
      || participant.paths.some((path) => !validSnapshot(participant.preimages[path]))
      || !matchHistoricalParticipantPreimages(participant, participant.preimages)) {
      throw new Error("historical participant exact registry preimages are invalid");
    }
  }
}
function validSnapshot(value) { return value && INTENT_STATES.has(value.state) && (value.state === "absent" || (typeof value.data === "string" && typeof value.hash === "string" && Number.isInteger(value.mode))); }
function assertParticipantSnapshots(participants, snapshots) {
  for (const participant of participants) {
    if (participant.role === "prospective-installation-target") {
      for (const path of participant.paths) {
        if (!sameSnapshot(participant.preimages[path], snapshots[path])) {
          throw new TransactionLockError("recovery_required", `prospective transaction preimage changed: ${path}`);
        }
      }
    } else if (participant.preimages !== undefined) {
      for (const path of participant.paths) {
        if (!sameSnapshot(participant.preimages[path], snapshots[path])) {
          throw new TransactionLockError("recovery_required", `historical transaction preimage changed: ${path}`);
        }
      }
    } else if (participant.role === "existing-installation-target" && !sameSnapshot(participant.receiptSnapshot, snapshots[participant.receiptPath])) {
      throw new TransactionLockError("recovery_required", `existing transaction receipt snapshot changed: ${participant.receiptPath}`);
    }
  }
}
async function authoritativeReceipt(manifest, participant, snapshot, locks) {
  if (!validSnapshot(snapshot) || snapshot.state !== "present" || digest(Buffer.from(snapshot.data, "base64")) !== snapshot.hash) throw new TransactionLockError("recovery_required", "transaction receipt snapshot is invalid");
  const intended = manifest.intended[participant.receiptPath];
  let current;
  try {
    current = await readRegularFile(participant.receiptPath, { manifest, locks });
  } catch (cause) {
    if (cause?.code !== "ENOENT" || intended?.state !== "absent") throw new TransactionLockError("recovery_required", "existing transaction receipt is unavailable", cause);
    current = { state: "absent" };
  }
  if (!sameSnapshot(current, snapshot) && !matchesIntent(current, intended)) throw new TransactionLockError("recovery_required", "existing transaction receipt authority is invalid");
  if (sameSnapshot(current, snapshot)) {
    let receipt;
    try {
      receipt = JSON.parse(Buffer.from(current.data, "base64").toString("utf8"));
    } catch (cause) {
      throw new TransactionLockError("recovery_required", "existing transaction receipt is malformed", cause);
    }
    if (JSON.stringify(receipt) !== JSON.stringify(participant.receipt)) throw new TransactionLockError("recovery_required", "existing transaction receipt authority is invalid");
  }
  return participant.receipt;
}
async function publishTerminal(manifest, locks) {
  for (const { control } of manifest.roots) await durableJson(join(control, "terminals", `${manifest.id}.json`), manifest, manifest, locks);
}
async function pruneTerminal(manifest, locks) {
  await publishCleanupAcknowledgement(manifest, locks);
  await verifyCleanupAcknowledgement(manifest, locks);
  for (const { root, control } of manifest.roots) {
    await durableRemove(join(control, "journals", `${manifest.id}.json`), manifest, locks);
    await runTransactionTestHook("afterCleanupRootDeletion", { manifest, root, control, directory: "journals" });
  }
  for (const { root, control } of manifest.roots) {
    await durableRemove(join(control, "terminals", `${manifest.id}.json`), manifest, locks);
    await runTransactionTestHook("afterCleanupRootDeletion", { manifest, root, control, directory: "terminals" });
  }
  for (const { root, control } of manifest.roots) if (manifest.bridges.length) {
    await durableRemove(join(control, "bridges", `${manifest.id}.json`), manifest, locks);
    await runTransactionTestHook("afterCleanupRootDeletion", { manifest, root, control, directory: "bridges" });
  }
  for (const { control } of manifest.roots) {
    await durableRemove(join(control, "cleanup", `${manifest.id}.json`), manifest, locks);
    await runTransactionTestHook("afterCleanupAcknowledgementDeletion", { manifest, control });
  }
  for (const { control } of manifest.roots) {
    await durableRemove(authorityBundlePath(control, manifest.id), manifest, locks);
    await runTransactionTestHook("afterAuthorityBundleDeletion", { bundle: authorityBundle(manifest), control });
  }
}
async function publishCleanupAcknowledgement(manifest, locks) {
  const acknowledgement = cleanupAcknowledgement(manifest);
  for (const { control } of manifest.roots) {
    await durableJson(join(control, "cleanup", `${manifest.id}.json`), acknowledgement, manifest, locks);
    await runTransactionTestHook("afterCleanupAcknowledgementReplication", { manifest, control });
  }
}
async function verifyCleanupAcknowledgement(manifest, locks) {
  const expected = JSON.stringify(cleanupAcknowledgement(manifest));
  for (const { control } of manifest.roots) {
    await assertManifestLocks(manifest, locks);
    const acknowledged = await readCleanupAcknowledgement(join(control, "cleanup", `${manifest.id}.json`), manifest.id, manifest, locks);
    if (JSON.stringify(acknowledged) !== expected) throw new TransactionLockError("recovery_required", "transaction cleanup acknowledgements disagree");
    await assertManifestLocks(manifest, locks);
  }
}
async function recoverCleanupAcknowledgement(source, locks, authority) {
  const acknowledgement = await readCleanupAcknowledgement(source.path, source.id, undefined, locks);
  const acknowledgementRoots = acknowledgement.roots.map(({ root }) => resolve(root));
  if (new Set(acknowledgementRoots).size !== acknowledgementRoots.length || acknowledgementRoots.some((root) => !locks.some((lock) => lock.root === root))) throw new TransactionLockError("recovery_required", "transaction cleanup acknowledgement roots are not locked");
  assertRecoveryRootsAuthorized(acknowledgement.roots.map(({ root }) => resolve(root)), authority);
  assertRecoveryManifestAuthorized({
    participants: acknowledgement.participants,
    roots: acknowledgement.roots,
    snapshotSet: acknowledgement.snapshotSet,
    writeSet: acknowledgement.writeSet,
    intended: {}
  }, authority);
  const expected = JSON.stringify(acknowledgement);
  for (const { control } of acknowledgement.roots) {
    await assertManifestLocks(undefined, locks);
    try {
      const replica = await readCleanupAcknowledgement(join(control, "cleanup", `${source.id}.json`), source.id, undefined, locks);
      if (JSON.stringify(replica) !== expected) throw new TransactionLockError("recovery_required", "transaction cleanup acknowledgements disagree");
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
    await assertManifestLocks(undefined, locks);
  }
  for (const { root, control } of acknowledgement.roots) for (const directory of ["journals", "terminals", "bridges"]) {
    await assertManifestLocks(undefined, locks);
    await durableRemove(join(control, directory, `${source.id}.json`), undefined, locks);
    await runTransactionTestHook("afterCleanupRootDeletion", { manifest: undefined, root, control, directory });
    await assertManifestLocks(undefined, locks);
  }
  const sourceControl = dirname(dirname(source.path));
  const cleanupRoots = [
    ...acknowledgement.roots.filter(({ control }) => control !== sourceControl),
    ...acknowledgement.roots.filter(({ control }) => control === sourceControl)
  ];
  for (const { control } of cleanupRoots) {
    await assertManifestLocks(undefined, locks);
    await durableRemove(join(control, "cleanup", `${source.id}.json`), undefined, locks);
    await runTransactionTestHook("afterCleanupAcknowledgementDeletion", { manifest: undefined, control });
    await assertManifestLocks(undefined, locks);
  }
  for (const { control } of acknowledgement.roots) {
    await durableRemove(authorityBundlePath(control, source.id), undefined, locks);
    await runTransactionTestHook("afterAuthorityBundleDeletion", { bundle: undefined, control });
  }
}
async function readCleanupAcknowledgement(path, id, manifest, locks) {
  let value;
  let source;
  try {
    source = await readControlFile(path, manifest, locks);
    value = JSON.parse(source);
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new TransactionLockError("recovery_required", "transaction cleanup acknowledgement is malformed", cause);
    throw cause;
  }
  if (!value || ![LEGACY_TRANSACTION_VERSION, TRANSACTION_VERSION].includes(value.version) || value.id !== id || value.state !== "cleaned" || !Array.isArray(value.roots) || !Array.isArray(value.participants) || !Array.isArray(value.snapshotSet) || !Array.isArray(value.writeSet) || value.roots.length === 0 || value.roots.some(({ root, rootKey: key, control }) => typeof root !== "string" || key !== rootKey(root) || control !== controlPath(root))) throw new TransactionLockError("recovery_required", "transaction cleanup acknowledgement is invalid");
  return value;
}
function cleanupAcknowledgement(manifest) { return { version: manifest.version, id: manifest.id, state: "cleaned", roots: manifest.roots.map(({ root, rootKey: key, control }) => ({ root, rootKey: key, control })), participants: manifest.participants, snapshotSet: manifest.snapshotSet, writeSet: manifest.writeSet }; }
async function assertAuthorizedPath(manifest, path) {
  const participant = manifest.participants?.find(({ paths }) => paths?.map((candidate) => resolve(candidate)).includes(resolve(path)));
  if (!participant) {
    if (!manifest.participants) return;
    throw new TransactionLockError("recovery_required", `transaction path is not authorized: ${path}`);
  }
  await assertSafeContainment(participant.root, path);
}
function assertRecoveryRootsAuthorized(roots, authority) {
  const normalized = [...new Set(roots.map((root) => resolve(root)))];
  if (normalized.some((root) => !authority.roots.includes(root))) {
    throw new TransactionLockError("recovery_required", "transaction recovery roots exceed caller authority");
  }
}
function assertRecoveryManifestAuthorized(manifest, authority) {
  const participants = manifest.participants.map(normalizeParticipant);
  for (const participant of participants) {
    const participantRoot = resolve(participant.root);
    const coordinationRoot = resolve(participant.coordinationRoot ?? participant.root);
    if (!authority.roots.includes(coordinationRoot)
      || participant.paths.some((path) => !authority.paths.includes(resolve(path)))
      || participant.paths.some((path) => !isContained(participantRoot, path))) {
      throw new TransactionLockError("recovery_required", "transaction recovery participants exceed caller authority");
    }
    if (participant.role === "metadata-participant") {
      const authorizedMetadata = authority.participants.some((candidate) =>
        candidate.role === "metadata-participant"
        && resolve(candidate.root) === participantRoot
        && JSON.stringify(candidate.paths) === JSON.stringify(participant.paths)
      );
      if (!authorizedMetadata) throw new TransactionLockError("recovery_required", "transaction recovery metadata participant exceeds caller authority");
    }
  }
  assertRecoveryRootsAuthorized(manifest.roots.map(({ root }) => resolve(root)), authority);
  const paths = [...manifest.snapshotSet].map((path) => resolve(path));
  if (paths.some((path) => !authority.paths.includes(path))
    || manifest.writeSet.some((path) => !authority.paths.includes(resolve(path)))
    || Object.keys(manifest.intended).some((path) => !authority.paths.includes(resolve(path)))) {
    throw new TransactionLockError("recovery_required", "transaction recovery paths exceed caller authority");
  }
}
function assertRecoveryBridgeAuthorized(bridge, authority) {
  if (!Array.isArray(bridge.participants) || !Array.isArray(bridge.snapshotSet) || !Array.isArray(bridge.writeSet)) {
    throw new TransactionLockError("recovery_required", "transaction bridge lacks recovery authority");
  }
  assertRecoveryManifestAuthorized({
    participants: bridge.participants,
    roots: [{ root: bridge.root }, ...bridge.peers],
    snapshotSet: bridge.snapshotSet,
    writeSet: bridge.writeSet,
    intended: {}
  }, authority);
}
