import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import {
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
