import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const RECEIPT_NAME = ".csx-install-receipt.json";
const ROOT_TOKEN = "{{root}}";
const INSTALLED_AT_TOKEN = "{{installedAt}}";

const AGENTS = [
  "csx-analyst", "csx-architect", "csx-code-reviewer", "csx-critic",
  "csx-executor", "csx-explorer", "csx-planner"
];
const SKILLS = [
  "csx-analyze", "csx-spec", "csx-plan", "csx-plan-pro",
  "csx-start-goal", "csx-code-review"
];
const H20 = Object.freeze([
  ...SKILLS.flatMap((name) => [
    `.agents/skills/${name}/SKILL.md`,
    `.agents/skills/${name}/agents/openai.yaml`
  ]),
  ...AGENTS.map((name) => `.codex/agents/${name}.toml`),
  ".codex/hooks/csx-hook.mjs"
]);
const DESLOP = [
  ".agents/skills/csx-deslop/SKILL.md",
  ".agents/skills/csx-deslop/agents/openai.yaml"
];
const H21 = Object.freeze([...H20.slice(0, 12), ...H20.slice(12, -1), ".codex/agents/csx-verifier.toml", H20.at(-1)]);
const H23 = Object.freeze([...H21.slice(0, 10), ...DESLOP, ...H21.slice(10)]);
const H22 = Object.freeze([...H20.slice(0, 10), ...DESLOP, ...H20.slice(10)]);

const LEGACY_MATRIX = Object.freeze({
  version: 1,
  agents: {
    "csx-explorer": { model: "gpt-5.6-terra", reasoning: "low" },
    "csx-analyst": { model: "gpt-5.6-luna", reasoning: "high" },
    "csx-planner": { model: "gpt-5.6-luna", reasoning: "high" },
    "csx-architect": { model: "gpt-5.6-terra", reasoning: "high" },
    "csx-critic": { model: "gpt-5.6-terra", reasoning: "xhigh" },
    "csx-executor": { model: "gpt-5.6-luna", reasoning: "low" },
    "csx-verifier": { model: "gpt-5.6-terra", reasoning: "xhigh" },
    "csx-code-reviewer": { model: "gpt-5.6-terra", reasoning: "xhigh" }
  }
});
const V2_MATRIX = Object.freeze({
  version: 2,
  roles: {
    leader: { model: "gpt-5.6-luna", reasoning: "max" },
    "csx-explorer": { model: "gpt-5.6-luna", reasoning: "xhigh" },
    "csx-analyst": { model: "gpt-5.6-sol", reasoning: "medium" },
    "csx-planner": { model: "gpt-5.6-sol", reasoning: "medium" },
    "csx-architect": { model: "gpt-5.6-sol", reasoning: "high" },
    "csx-critic": { model: "gpt-5.6-sol", reasoning: "medium" },
    "csx-executor": { model: "gpt-5.6-sol", reasoning: "medium" },
    "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "high" }
  }
});
const FEATURE = Object.freeze({ key: "default_mode_request_user_input", previousLine: null });
const LEADER = Object.freeze({ version: 1, originals: { model: null, model_reasoning_effort: null } });

const DEFINITIONS = [
  definition("h21-3abc221", "H21", "3abc221", H21, "legacy", "c3a5ac67501f237d59911c87277a926cdf9db3a96c02a322a01da2e9bfa11212"),
  definition("h21-8933704", "H21", "8933704", H21, "feature", "0204621cb278aefecb17393bde32e1971b6a1f5d4fb30efbd3354f7fa0f5ecf5"),
  definition("h21-64de366-fresh", "H21", "64de366", H21, "feature", "0537ba63ac7aa1a9d6c93a20153b27d546abcee60eda83d935d3dba6b0f0a0e1"),
  definition("h21-64de366-setup", "H21", "64de366", H21, "feature", "39a68719fc43d6c6391de2feb4fcd66041f3c4fc03d4d78719b854c0b5797b66", { setupAgentMatrix: LEGACY_MATRIX }),
  definition("h23-a221623-fresh", "H23", "a221623", H23, "feature", "387efa4b854511ec22bd8eaf8cd8c8b0033a165a051be251f812441d2c9965ba"),
  definition("h23-a221623-setup", "H23", "a221623", H23, "feature", "e264a7496007a8872af2888bc1797788450eb45ea7800ccfcb2d7ee52205a25b", { setupAgentMatrix: LEGACY_MATRIX }),
  definition("h22-9af4616", "H22", "9af4616", H22, "leader", "92ba7ea6c48b6ef74fbac8132be6d859ec6a470f25ac6745ca4e1607d0f32f55", {
    leaderConfig: LEADER,
    setupAgentMatrix: V2_MATRIX
  })
];

export const HISTORICAL_INSTALLATION_FAMILIES = Object.freeze(DEFINITIONS.map(publicDefinition));

export class UnsupportedHistoricalInstallationError extends Error {
  constructor(path) {
    super(`unsupported or unsafe historical csx installation: ${path}`);
    this.name = "UnsupportedHistoricalInstallationError";
    this.code = "unsupported_historical_installation";
  }
}

/** Exact, side-effect-free tuple matcher used by discovery and fixture tests. */
export function matchHistoricalInstallation({ root, receipt, config, payloadDigest }) {
  root = resolve(root);
  const normalized = normalizeReceipt(receipt, root);
  if (!normalized) return null;
  const matches = DEFINITIONS.filter((candidate) =>
    candidate.payloadDigest === payloadDigest &&
    config === configFor(candidate.configVariant, root) &&
    isDeepStrictEqual(normalized, candidate.receipt)
  );
  return matches.length === 1 ? publicDefinition(matches[0]) : null;
}

/** Materializes an immutable accepted tuple with only the three allowed substitutions. */
export function historicalInstallationTemplate(id, {
  root,
  installedAt = "2000-01-01T00:00:00.000Z"
} = {}) {
  const candidate = DEFINITIONS.find((definition) => definition.id === id);
  if (!candidate) throw new Error(`unknown historical installation family: ${id}`);
  root = resolve(root);
  const receipt = replaceTokens(candidate.receipt, root, installedAt);
  return deepFreeze({
    ...publicDefinition(candidate),
    root,
    receipt,
    config: configFor(candidate.configVariant, root)
  });
}

/**
 * Safely discover an exact receipt-owned historical installation.
 * Receipt-less legacy plugins deliberately return null and gain no ownership.
 */
export async function discoverHistoricalInstallation({ root }) {
  const proof = await proveHistoricalInstallation({ root, optional: true });
  if (proof === null) return null;
  const { preimages, ...discovery } = proof;
  return Object.freeze(discovery);
}

/**
 * Re-derives an exact registry proof and pins every bounded regular-file
 * preimage. Callers carry these preimages into the held transaction check.
 */
export async function proveHistoricalInstallation({ root, expectedId, optional = false }) {
  root = resolve(root);
  await assertSafeDirectory(root);
  const configRoot = resolve(root, ".codex");
  const receiptPath = resolve(configRoot, RECEIPT_NAME);
  const receiptSnapshot = await safeSnapshot(root, receiptPath, { optional: true });
  if (receiptSnapshot === null) {
    if (optional) return null;
    throw new UnsupportedHistoricalInstallationError(receiptPath);
  }
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(receiptSnapshot.data, "base64").toString("utf8"));
  } catch {
    throw new UnsupportedHistoricalInstallationError(receiptPath);
  }
  const configPath = resolve(configRoot, "config.toml");
  const configSnapshot = await safeSnapshot(root, configPath).catch(() => {
    throw new UnsupportedHistoricalInstallationError(receiptPath);
  });
  const config = Buffer.from(configSnapshot.data, "base64").toString("utf8");
  const normalized = normalizeReceipt(receipt, root);
  const metadataMatches = normalized && DEFINITIONS.filter((candidate) =>
    config === configFor(candidate.configVariant, root) &&
    isDeepStrictEqual(normalized, candidate.receipt)
  );
  if (!metadataMatches?.length) throw new UnsupportedHistoricalInstallationError(receiptPath);

  const receivedPaths = receipt.files.map((path) => resolve(path));
  const payloadSnapshots = {};
  const payloadDigest = await digestPayload(root, receivedPaths, payloadSnapshots);
  const match = metadataMatches.find((candidate) => candidate.payloadDigest === payloadDigest);
  if (!match || (expectedId !== undefined && match.id !== expectedId)) {
    throw new UnsupportedHistoricalInstallationError(receiptPath);
  }
  const paths = [...new Set([...receivedPaths, configPath, receiptPath])].sort();
  if (paths.length !== receivedPaths.length + 2) throw new UnsupportedHistoricalInstallationError(receiptPath);
  return deepFreeze({
    ...publicDefinition(match),
    root,
    configRoot,
    configPath,
    receiptPath,
    files: Object.freeze([...receivedPaths]),
    receipt: structuredClone(receipt),
    preimages: Object.fromEntries(paths.map((path) => [
      path,
      path === configPath ? configSnapshot
        : path === receiptPath ? receiptSnapshot
          : payloadSnapshots[path]
    ]))
  });
}

/** Pure validation for immutable v3 bundle preimages. */
export function matchHistoricalParticipantPreimages(participant, preimages) {
  try {
    const root = resolve(participant.root);
    const configPath = resolve(root, ".codex", "config.toml");
    const receiptPath = resolve(root, ".codex", RECEIPT_NAME);
    if (resolve(participant.configPath) !== configPath || resolve(participant.receiptPath) !== receiptPath) return null;
    const paths = participant.paths.map((path) => resolve(path)).sort();
    if (new Set(paths).size !== paths.length || Object.keys(preimages).sort().join("\0") !== paths.join("\0")) return null;
    if (paths.some((path) => !within(root, path) || preimages[path]?.state !== "present")) return null;
    const receiptData = snapshotData(preimages[receiptPath]);
    const configData = snapshotData(preimages[configPath]);
    const receipt = JSON.parse(receiptData.toString("utf8"));
    if (!isDeepStrictEqual(receipt, participant.receipt)) return null;
    const files = receipt.files.map((path) => resolve(path));
    const expectedPaths = [...new Set([...files, configPath, receiptPath])].sort();
    if (expectedPaths.length !== files.length + 2 || expectedPaths.join("\0") !== paths.join("\0")) return null;
    const digest = createHash("sha256");
    for (const path of files) {
      const data = snapshotData(preimages[path]);
      digest.update(relative(root, path).split(sep).join("/")).update("\0");
      digest.update(createHash("sha256").update(data).digest("hex")).update("\n");
    }
    return matchHistoricalInstallation({
      root,
      receipt,
      config: configData.toString("utf8"),
      payloadDigest: digest.digest("hex")
    });
  } catch {
    return null;
  }
}

function definition(id, family, commit, paths, configVariant, payloadDigest, extra = {}) {
  const receipt = {
    version: "0.1.0",
    scope: "project",
    root: ROOT_TOKEN,
    configRoot: `${ROOT_TOKEN}/.codex`,
    files: paths.map((path) => `${ROOT_TOKEN}/${path}`),
    installedAt: INSTALLED_AT_TOKEN,
    ...(configVariant !== "legacy" ? { featureConfig: FEATURE } : {}),
    ...extra
  };
  return deepFreeze({ id, family, commit, paths, configVariant, payloadDigest, receipt });
}

function publicDefinition(candidate) {
  return deepFreeze({
    id: candidate.id,
    family: candidate.family,
    commit: candidate.commit,
    paths: [...candidate.paths],
    payloadDigest: candidate.payloadDigest
  });
}

function normalizeReceipt(receipt, root) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  if (typeof receipt.installedAt !== "string" || !receipt.installedAt) return null;
  const normalized = structuredClone(receipt);
  normalized.installedAt = INSTALLED_AT_TOKEN;
  normalized.root = normalized.root === root ? ROOT_TOKEN : normalized.root;
  normalized.configRoot = normalized.configRoot === resolve(root, ".codex")
    ? `${ROOT_TOKEN}/.codex`
    : normalized.configRoot;
  if (Array.isArray(normalized.files)) {
    normalized.files = normalized.files.map((path) => {
      if (typeof path !== "string") return path;
      const absolute = resolve(path);
      const rel = relative(root, absolute);
      return within(root, absolute) && rel ? `${ROOT_TOKEN}/${rel.split(sep).join("/")}` : path;
    });
  }
  return normalized;
}

function configFor(variant, root) {
  const agents = variant === "leader"
    ? ["csx-explorer", "csx-analyst", "csx-planner", "csx-architect", "csx-critic", "csx-executor", "csx-code-reviewer"]
    : ["csx-analyst", "csx-architect", "csx-code-reviewer", "csx-critic", "csx-executor", "csx-explorer", "csx-planner", "csx-verifier"];
  const hookPath = `${root}/.codex/hooks/csx-hook.mjs`;
  const posixCommand = `node '${hookPath.replaceAll("'", `'\"'\"'`)}' user-prompt-submit`;
  const windowsCommand = `node "${hookPath.replaceAll('"', '""')}" user-prompt-submit`;
  const managed = `# >>> csx managed >>>\n${agents.map((name) =>
    `[agents.${name}]\nconfig_file = "./agents/${name}.toml"\n`
  ).join("\n")}\n[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = ${JSON.stringify(posixCommand)}, commandWindows = ${JSON.stringify(windowsCommand)}, timeout = 3, statusMessage = "(csx) Checking skill routing" }]\n# <<< csx managed <<<\n`;
  const feature = `\n# >>> csx feature default_mode_request_user_input >>>\n[features]\ndefault_mode_request_user_input = true\n# <<< csx feature default_mode_request_user_input <<<\n`;
  const leader = `# >>> csx leader defaults >>>\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n# <<< csx leader defaults <<<\n\n`;
  return `${variant === "leader" ? leader : ""}${managed}${variant === "legacy" ? "" : feature}`;
}

async function digestPayload(root, paths, snapshots) {
  const digest = createHash("sha256");
  for (const path of paths) {
    const proof = await safeSnapshot(root, path).catch(() => {
      throw new UnsupportedHistoricalInstallationError(path);
    });
    snapshots[path] = proof;
    const data = snapshotData(proof);
    const rel = relative(root, path).split(sep).join("/");
    digest.update(rel).update("\0");
    digest.update(createHash("sha256").update(data).digest("hex")).update("\n");
  }
  return digest.digest("hex");
}

async function assertSafeDirectory(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
    throw new UnsupportedHistoricalInstallationError(root);
  }
}

async function safeSnapshot(root, path, { optional = false } = {}) {
  if (!within(root, path)) throw new UnsupportedHistoricalInstallationError(path);
  const probes = [];
  for (let probe = path; ; probe = dirname(probe)) {
    probes.push(probe);
    if (probe === root) break;
  }
  let absent = false;
  for (const probe of probes.reverse()) {
    const info = await lstat(probe).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!info) {
      absent = true;
      continue;
    }
    if (info.isSymbolicLink()) throw new UnsupportedHistoricalInstallationError(path);
  }
  if (absent) {
    if (optional) return null;
    throw Object.assign(new Error(`missing historical installation path: ${path}`), { code: "ENOENT" });
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new UnsupportedHistoricalInstallationError(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [descriptor, pathInfo] = await Promise.all([handle.stat(), lstat(path)]);
    if (!descriptor.isFile() || pathInfo.isSymbolicLink() || descriptor.dev !== pathInfo.dev || descriptor.ino !== pathInfo.ino) {
      throw new UnsupportedHistoricalInstallationError(path);
    }
    const data = await handle.readFile();
    return {
      state: "present",
      data: data.toString("base64"),
      hash: createHash("sha256").update(data).digest("hex"),
      mode: descriptor.mode & 0o777
    };
  } finally {
    await handle.close();
  }
}

function snapshotData(snapshot) {
  if (!snapshot || snapshot.state !== "present" || !Number.isInteger(snapshot.mode)) throw new Error("invalid historical snapshot");
  const data = Buffer.from(snapshot.data, "base64");
  if (createHash("sha256").update(data).digest("hex") !== snapshot.hash) throw new Error("invalid historical snapshot");
  return data;
}

function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function replaceTokens(value, root, installedAt) {
  if (value === ROOT_TOKEN) return root;
  if (value === INSTALLED_AT_TOKEN) return installedAt;
  if (typeof value === "string") return value.replaceAll(`${ROOT_TOKEN}/`, `${root}/`);
  if (Array.isArray(value)) return value.map((nested) => replaceTokens(nested, root, installedAt));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      replaceTokens(nested, root, installedAt)
    ]));
  }
  return value;
}
