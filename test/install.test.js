import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import {
  FEATURE_MANAGED_END,
  FEATURE_MANAGED_START,
  install,
  MANAGED_END,
  MANAGED_START,
  uninstall,
  windowsCommand
} from "../lib/install.js";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("global install preserves existing config", async () => {
  const home = await temporary("global home ");
  const codex = join(home, ".codex");
  await mkdir(codex, { recursive: true });
  await writeFile(join(codex, "config.toml"), 'model = "example"\n');

  const result = await install({ scope: "global", env: { HOME: home } });

  assert.equal(result.root, codex);
  assert.equal(await readFile(join(codex, "skills", "csx-plan", "SKILL.md"), "utf8")
    .then((text) => text.includes("name: csx-plan")), true);
  assert.equal(existsSync(join(codex, "agents", "csx-planner.toml")), true);
  const config = await readFile(join(codex, "config.toml"), "utf8");
  assert.match(config, /model = "example"/);
  assert.match(config, new RegExp(MANAGED_START));
  assert.match(config, /\[\[hooks\.UserPromptSubmit\]\]/);
  assert.match(config, /\[features\]\ndefault_mode_request_user_input = true/);
});

test("global install creates the default Codex home when absent", async () => {
  const home = await temporary("new global home ");
  const codex = join(home, ".codex");

  await install({ scope: "global", env: { HOME: home } });

  assert.equal(existsSync(join(codex, ".csx-install-receipt.json")), true);
  assert.equal(existsSync(join(codex, "skills", "csx-analyze", "SKILL.md")), true);
});

test("explicit missing CODEX_HOME fails without creating it", async () => {
  const root = join(await temporary("missing codex "), "does-not-exist");
  await assert.rejects(
    install({ scope: "global", env: { CODEX_HOME: root } }),
    /CODEX_HOME does not exist/
  );
  assert.equal(existsSync(root), false);
});

test("project install uses the current directory and is isolated from global Codex home", async () => {
  const root = await temporary("project ");
  const home = await temporary("isolated home ");

  await install({ scope: "project", cwd: root, env: { HOME: home } });

  assert.equal(existsSync(join(root, ".agents", "skills", "csx-spec", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".codex", "agents", "csx-analyst.toml")), true);
  assert.equal(existsSync(join(home, ".codex")), false);
});

test("explicit project root supports a non-Git directory and paths with spaces", async () => {
  const root = await temporary("plain project with spaces ");
  await install({ scope: "project", projectRoot: root });

  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /command = "node '/);
  assert.match(config, /commandWindows = "node \\"/);
  assert.equal(
    windowsCommand("C:\\Users\\Test User\\csx\\hook.mjs"),
    'node "C:\\Users\\Test User\\csx\\hook.mjs" user-prompt-submit'
  );
});

test("project install rejects a missing project root", async () => {
  const root = join(await temporary("missing project "), "does-not-exist");
  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /project root does not exist/
  );
});

test("repeat install updates receipt-owned files", async () => {
  const root = await temporary("repeat ");
  await install({ scope: "project", projectRoot: root });
  const skill = join(root, ".agents", "skills", "csx-plan", "SKILL.md");
  await writeFile(skill, "locally modified managed file\n");

  await install({ scope: "project", projectRoot: root });

  assert.match(await readFile(skill, "utf8"), /name: csx-plan/);
  const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.equal(config.split(MANAGED_START).length - 1, 1);
  assert.equal(config.split(FEATURE_MANAGED_START).length - 1, 1);
});

test("repeat install upgrades a receipt from before feature management", async () => {
  const root = await temporary("old receipt ");
  const configPath = join(root, ".codex", "config.toml");
  const receiptPath = join(root, ".codex", ".csx-install-receipt.json");
  await install({ scope: "project", projectRoot: root });

  const featureRegion = new RegExp(
    `\\n*${escapeRegExp(FEATURE_MANAGED_START)}[\\s\\S]*?${escapeRegExp(FEATURE_MANAGED_END)}\\n?`
  );
  await writeFile(configPath, (await readFile(configPath, "utf8")).replace(featureRegion, "\n"));
  const oldReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  delete oldReceipt.featureConfig;
  await writeFile(receiptPath, `${JSON.stringify(oldReceipt, null, 2)}\n`);

  await install({ scope: "project", projectRoot: root });

  const upgraded = await readFile(configPath, "utf8");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.match(upgraded, new RegExp(FEATURE_MANAGED_START));
  assert.equal(receipt.featureConfig.key, "default_mode_request_user_input");
  assert.equal(receipt.featureConfig.previousLine, null);
});

test("install preserves an existing features table and uninstall removes only the managed key", async () => {
  const root = await temporary("existing features ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    "model = \"example\"\n\n[features]\napps = false # keep this\n"
  );

  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(installed, /apps = false # keep this/);
  assert.match(installed, new RegExp(FEATURE_MANAGED_START));
  assert.match(installed, /default_mode_request_user_input = true/);

  await uninstall({ projectRoot: root });

  const removed = await readFile(join(root, ".codex", "config.toml"), "utf8");
  assert.match(removed, /\[features\]\napps = false # keep this/);
  assert.doesNotMatch(removed, /default_mode_request_user_input/);
  assert.match(removed, /model = "example"/);
});

test("install reversibly overrides an explicit false feature across repeat installs", async () => {
  const root = await temporary("false feature ");
  const configPath = join(root, ".codex", "config.toml");
  const original = [
    "model = \"example\"",
    "",
    "[features]",
    "default_mode_request_user_input = false # user preference",
    "apps = true",
    ""
  ].join("\n");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(configPath, original);

  await install({ scope: "project", projectRoot: root });
  await install({ scope: "project", projectRoot: root });

  const installed = await readFile(configPath, "utf8");
  assert.match(installed, /default_mode_request_user_input = true/);
  assert.doesNotMatch(installed, /false # user preference/);
  const receipt = JSON.parse(await readFile(join(root, ".codex", ".csx-install-receipt.json"), "utf8"));
  assert.equal(
    receipt.featureConfig.previousLine,
    "default_mode_request_user_input = false # user preference"
  );

  await uninstall({ projectRoot: root });

  const restored = await readFile(configPath, "utf8");
  assert.match(restored, /default_mode_request_user_input = false # user preference/);
  assert.match(restored, /apps = true/);
  assert.doesNotMatch(restored, new RegExp(FEATURE_MANAGED_START));
});

test("an existing true feature stays user-owned after uninstall", async () => {
  const root = await temporary("true feature ");
  const configPath = join(root, ".codex", "config.toml");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(configPath, "[features]\ndefault_mode_request_user_input = true # mine\n");

  await install({ scope: "project", projectRoot: root });
  const installed = await readFile(configPath, "utf8");
  assert.doesNotMatch(installed, new RegExp(FEATURE_MANAGED_START));

  await uninstall({ projectRoot: root });
  assert.match(
    await readFile(configPath, "utf8"),
    /default_mode_request_user_input = true # mine/
  );
});

test("unsupported inline features fail before payload writes", async () => {
  const root = await temporary("inline features ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    "features = { default_mode_request_user_input = false }\n"
  );

  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /cannot safely manage default_mode_request_user_input in inline features table/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("broken feature markers fail before payload writes", async () => {
  const root = await temporary("broken feature markers ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), `${FEATURE_MANAGED_START}\n`);

  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /broken csx feature default_mode_request_user_input markers/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("unmanaged destination and unmanaged agent table fail before payload writes", async () => {
  const collisionRoot = await temporary("collision ");
  const collision = join(collisionRoot, ".agents", "skills", "csx-plan", "SKILL.md");
  await mkdir(join(collision, ".."), { recursive: true });
  await writeFile(collision, "mine\n");
  await assert.rejects(
    install({ scope: "project", projectRoot: collisionRoot }),
    /unmanaged file/
  );
  assert.equal(existsSync(join(collisionRoot, ".codex", "agents", "csx-planner.toml")), false);

  const tableRoot = await temporary("table collision ");
  await mkdir(join(tableRoot, ".codex"), { recursive: true });
  await writeFile(join(tableRoot, ".codex", "config.toml"), "[agents.csx-planner]\nfoo = true\n");
  await assert.rejects(
    install({ scope: "project", projectRoot: tableRoot }),
    /unmanaged \[agents\.csx-planner\]/
  );
});

test("broken managed markers fail before writing", async () => {
  const root = await temporary("broken markers ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), `${MANAGED_START}\n`);
  await assert.rejects(
    install({ scope: "project", projectRoot: root }),
    /broken csx managed markers/
  );
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("uninstall prefers the current project, then removes global, and is idempotent", async () => {
  const home = await temporary("uninstall home ");
  const globalRoot = join(home, ".codex");
  const project = await temporary("uninstall project ");
  await mkdir(globalRoot, { recursive: true });
  await install({ scope: "global", env: { HOME: home } });
  await install({ scope: "project", projectRoot: project });

  const first = await uninstall({ cwd: project, env: { HOME: home } });
  assert.equal(first.scope, "project");
  assert.equal(existsSync(join(project, ".agents", "skills", "csx-plan", "SKILL.md")), false);
  assert.equal(existsSync(join(globalRoot, "skills", "csx-plan", "SKILL.md")), true);

  const second = await uninstall({ cwd: project, env: { HOME: home } });
  assert.equal(second.scope, "global");
  assert.equal(existsSync(join(globalRoot, "skills", "csx-plan", "SKILL.md")), false);

  assert.deepEqual(await uninstall({ cwd: project, env: { HOME: home } }), { removed: false });
});

test("uninstall preserves unrelated config and non-empty directories", async () => {
  const root = await temporary("preserve ");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), "approval_policy = \"never\"\n");
  await install({ scope: "project", projectRoot: root });
  await writeFile(join(root, ".codex", "agents", "keep.toml"), "name = \"keep\"\n");

  await uninstall({ projectRoot: root });

  assert.equal(await readFile(join(root, ".codex", "config.toml"), "utf8")
    .then((text) => text.trim()), 'approval_policy = "never"');
  assert.equal(existsSync(join(root, ".codex", "agents", "keep.toml")), true);
  assert.equal(existsSync(join(root, ".codex", "config.toml")), true);
});

async function temporary(prefix) {
  const root = await mkdtemp(join(tmpdir(), `csx-${prefix}`));
  roots.push(root);
  return resolve(root);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
