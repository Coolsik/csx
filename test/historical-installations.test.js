import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HISTORICAL_INSTALLATION_FAMILIES,
  discoverHistoricalInstallation,
  historicalInstallationTemplate,
  matchHistoricalInstallation,
  UnsupportedHistoricalInstallationError
} from "../lib/historical-installations.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "historical-installations",
  "registry.json"
);
const fixtureRegistry = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

test("the immutable registry contains the supported commit-produced family", () => {
  assert.equal(Object.isFrozen(HISTORICAL_INSTALLATION_FAMILIES), true);
  assert.deepEqual(HISTORICAL_INSTALLATION_FAMILIES.map((entry) => ({
    id: entry.id,
    family: entry.family,
    commit: entry.commit,
    paths: entry.paths.length,
    payloadDigest: entry.payloadDigest
  })), fixtureRegistry.map(({ id, family, commit, paths, payloadDigest }) => ({
    id, family, commit, paths, payloadDigest
  })));
});

test("the exact snapshot matches with only root and installedAt substituted", async () => {
  for (const fixture of fixtureRegistry) {
    const root = "/fixture/project";
    const snapshot = historicalInstallationTemplate(fixture.id, {
      root,
      installedAt: "2000-01-01T00:00:00.000Z"
    });
    const digest = (value) => createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value))
      .digest("hex");
    const match = matchHistoricalInstallation({
      root,
      receipt: snapshot.receipt,
      config: snapshot.config,
      payloadDigest: snapshot.payloadDigest
    });
    assert.equal(match?.id, fixture.id);
    assert.equal(digest(snapshot.receipt), fixture.receiptDigest);
    assert.equal(digest(snapshot.config), fixture.configDigest);
    assert.equal(
      snapshot.receipt.setupAgentMatrix ? digest(snapshot.receipt.setupAgentMatrix) : null,
      fixture.matrixDigest
    );
    assert.equal(snapshot.receipt.featureConfig !== undefined, fixture.config !== "legacy");
    assert.equal(snapshot.receipt.leaderConfig !== undefined, fixture.config === "leader");
    assert.equal(snapshot.receipt.setupAgentMatrix?.version ?? null, fixture.matrix);
  }
});

test("same-semver subsets, supersets, mismatched configurations, and duplicate paths are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-history-paths-"));
  const base = historicalInstallationTemplate("h22-9af4616", { root });
  const mutate = (fn) => {
    const receipt = structuredClone(base.receipt);
    fn(receipt);
    return matchHistoricalInstallation({
      root,
      receipt,
      config: base.config,
      payloadDigest: base.payloadDigest
    });
  };
  assert.equal(mutate((receipt) => receipt.files.pop()), null);
  assert.equal(mutate((receipt) => receipt.files.push(join(root, ".codex", "agents", "extra.toml"))), null);
  assert.equal(mutate((receipt) => receipt.files.push(receipt.files[0])), null);

  assert.equal(matchHistoricalInstallation({
    root,
    receipt: base.receipt,
    config: `${base.config}\n# mismatched historical configuration\n`,
    payloadDigest: base.payloadDigest
  }), null);
});

test("escape paths and forged feature, matrix, leader, or marker metadata are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-history-forged-"));
  for (const id of ["h22-9af4616"]) {
    const base = historicalInstallationTemplate(id, { root });
    const rejectReceipt = (edit) => {
      const receipt = structuredClone(base.receipt);
      edit(receipt);
      assert.equal(matchHistoricalInstallation({
        root, receipt, config: base.config, payloadDigest: base.payloadDigest
      }), null);
    };
    rejectReceipt((receipt) => { receipt.files[0] = join(root, "..", "escape"); });
    rejectReceipt((receipt) => { receipt.featureConfig.key = "forged"; });
    if (base.receipt.setupAgentMatrix) {
      rejectReceipt((receipt) => {
        const roles = receipt.setupAgentMatrix.agents ?? receipt.setupAgentMatrix.roles;
        roles[Object.keys(roles)[0]].model = "forged";
      });
    }
    if (base.receipt.leaderConfig) {
      rejectReceipt((receipt) => { receipt.leaderConfig.originals.model = "forged"; });
    }
    assert.equal(matchHistoricalInstallation({
      root,
      receipt: base.receipt,
      config: base.config.replace("# >>> csx managed >>>", "# forged"),
      payloadDigest: base.payloadDigest
    }), null);
  }
});

test("receipt-less old csx-local plugins are unowned", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-history-plugin-"));
  await mkdir(join(root, ".codex", "plugins", "csx-local"), { recursive: true });
  await writeFile(join(root, ".codex", "plugins", "csx-local", "plugin.json"), "{}\n");
  assert.equal(await discoverHistoricalInstallation({ root }), null);
});

test("discovery rejects symlink boundaries before adopting a receipt", async () => {
  const base = await mkdtemp(join(tmpdir(), "csx-history-link-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, ".csx-install-receipt.json"), "{}\n");
  await symlink(outside, join(root, ".codex"));
  await assert.rejects(
    discoverHistoricalInstallation({ root }),
    (error) => error instanceof UnsupportedHistoricalInstallationError
  );
});
