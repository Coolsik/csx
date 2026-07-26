import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { install } from "../lib/install.js";
import { activeWorkflowState } from "./fixtures/workflow-state-schema.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceHook = join(repositoryRoot, "payload", "hooks", "csx-hook.mjs");

test("project-only and global-only authorities restore their exact worktree", async () => {
  const fixture = await precedenceFixture();
  try {
    await createInstallation("project", fixture.project);
    assert.notEqual((await runSession(fixture.projectHook, "project", fixture.project, fixture.project)).stdout, "");

    await removeInstallation("project", fixture.project);
    await createInstallation("global", fixture.global);
    assert.notEqual((await runSession(fixture.globalHook, "global", fixture.global, fixture.project)).stdout, "");
  } finally {
    await fixture.cleanup();
  }
});

test("coexisting authorities emit only the project restore in either invocation order", async () => {
  const fixture = await precedenceFixture();
  try {
    await createInstallation("project", fixture.project);
    await createInstallation("global", fixture.global);
    for (const order of [
      [["global", fixture.globalHook, fixture.global], ["project", fixture.projectHook, fixture.project]],
      [["project", fixture.projectHook, fixture.project], ["global", fixture.globalHook, fixture.global]],
    ]) {
      const results = [];
      for (const [scope, hook, root] of order) {
        results.push([scope, await runSession(hook, scope, root, fixture.project)]);
      }
      assert.equal(results.filter(([, result]) => result.stdout !== "").length, 1);
      assert.notEqual(results.find(([scope]) => scope === "project")[1].stdout, "");
      assert.equal(results.find(([scope]) => scope === "global")[1].stdout, "");
    }
  } finally {
    await fixture.cleanup();
  }
});

test("a valid project authority suppresses global restore when project state is absent or invalid", async () => {
  const fixture = await precedenceFixture();
  try {
    await createInstallation("project", fixture.project);
    await createInstallation("global", fixture.global);
    await rm(fixture.statePath);
    for (const [scope, hook, root] of [
      ["project", fixture.projectHook, fixture.project],
      ["global", fixture.globalHook, fixture.global],
    ]) {
      assert.equal((await runSession(hook, scope, root, fixture.project)).stdout, "");
    }

    await writeFile(fixture.statePath, "{");
    assert.equal((await runSession(fixture.projectHook, "project", fixture.project, fixture.project)).stdout, "");
    assert.equal((await runSession(fixture.globalHook, "global", fixture.global, fixture.project)).stdout, "");
  } finally {
    await fixture.cleanup();
  }
});

test("project uninstall permits global fallback", async () => {
  const fixture = await precedenceFixture();
  try {
    await createInstallation("project", fixture.project);
    await createInstallation("global", fixture.global);
    await removeInstallation("project", fixture.project);
    assert.notEqual((await runSession(fixture.globalHook, "global", fixture.global, fixture.project)).stdout, "");
  } finally {
    await fixture.cleanup();
  }
});

test("malformed or unsafe project authority suppresses both restores", async (t) => {
  await t.test("malformed receipt", async () => {
    const fixture = await precedenceFixture();
    try {
      await createInstallation("project", fixture.project);
      await createInstallation("global", fixture.global);
      await writeFile(fixture.projectReceipt, "{");
      assert.equal((await runSession(fixture.projectHook, "project", fixture.project, fixture.project)).stdout, "");
      assert.equal((await runSession(fixture.globalHook, "global", fixture.global, fixture.project)).stdout, "");
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("symlinked hook", async () => {
    const fixture = await precedenceFixture();
    try {
      await createInstallation("project", fixture.project);
      await createInstallation("global", fixture.global);
      await rm(fixture.projectHook);
      await symlink(sourceHook, fixture.projectHook);
      assert.equal((await runSession(fixture.projectHook, "project", fixture.project, fixture.project)).stdout, "");
      assert.equal((await runSession(fixture.globalHook, "global", fixture.global, fixture.project)).stdout, "");
    } finally {
      await fixture.cleanup();
    }
  });
});

test("linked worktrees sharing a common Git directory remain independent", async () => {
  const fixture = await linkedWorktreeFixture();
  try {
    await createInstallation("project", fixture.primary);
    await createInstallation("global", fixture.global);
    await writeActiveState(fixture.sibling);

    assert.equal((await runSession(fixture.globalHook, "global", fixture.global, fixture.primary)).stdout, "");
    assert.notEqual((await runSession(fixture.primaryHook, "project", fixture.primary, fixture.primary)).stdout, "");
    assert.notEqual((await runSession(fixture.globalHook, "global", fixture.global, fixture.sibling)).stdout, "");
  } finally {
    await fixture.cleanup();
  }
});

test("generated lifecycle commands carry identical exact authority on POSIX and Windows", async () => {
  const base = await mkdtemp(join(tmpdir(), "csx argv layout "));
  const project = join(base, "project root");
  const global = join(base, "global root");
  try {
    await mkdir(project);
    await mkdir(global);
    await execFileAsync("git", ["init", project]);
    await install({ scope: "project", projectRoot: project });
    await install({ scope: "global", env: { CODEX_HOME: global } });

    for (const [scope, root, configRoot, hook] of [
      ["project", project, join(project, ".codex"), join(project, ".codex", "hooks", "csx-hook.mjs")],
      ["global", global, global, join(global, "hooks", "csx-hook.mjs")],
    ]) {
      const config = await readFile(join(configRoot, "config.toml"), "utf8");
      for (const operation of ["session-start", "subagent-stop"]) {
        const posix = `node '${hook}' ${operation} --authority-scope ${scope} --authority-root '${root}'`;
        const windows = `node \\"${hook}\\" ${operation} --authority-scope ${scope} --authority-root \\"${root}\\"`;
        assert.equal(config.includes(posix), true);
        assert.equal(config.includes(windows), true);
      }
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

async function precedenceFixture() {
  const base = await mkdtemp(join(tmpdir(), "csx-precedence-"));
  const project = join(base, "project");
  const global = join(base, "global");
  await mkdir(project);
  await execFileAsync("git", ["init", project]);
  await writeActiveState(project);
  return {
    base,
    project,
    global,
    statePath: join(project, ".csx", "workflow-state-v1.json"),
    projectHook: installationLayout("project", project).hook,
    projectReceipt: installationLayout("project", project).receipt,
    globalHook: installationLayout("global", global).hook,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

async function linkedWorktreeFixture() {
  const base = await mkdtemp(join(tmpdir(), "csx-linked-precedence-"));
  const primary = join(base, "primary");
  const sibling = join(base, "sibling");
  const global = join(base, "global");
  await mkdir(primary);
  await execFileAsync("git", ["init", primary]);
  await execFileAsync("git", ["-C", primary, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", primary, "config", "user.name", "CSX Test"]);
  await writeFile(join(primary, "tracked.txt"), "tracked");
  await execFileAsync("git", ["-C", primary, "add", "tracked.txt"]);
  await execFileAsync("git", ["-C", primary, "commit", "-m", "initial"]);
  await execFileAsync("git", ["-C", primary, "worktree", "add", sibling, "-b", "sibling"]);
  await writeActiveState(primary);
  return {
    base,
    primary,
    sibling,
    global,
    primaryHook: installationLayout("project", primary).hook,
    globalHook: installationLayout("global", global).hook,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

async function writeActiveState(root) {
  const artifact = ".csx/goals/work.md";
  const content = "PRIVATE ARTIFACT CONTENT";
  await mkdir(join(root, ".csx", "goals"), { recursive: true });
  await writeFile(join(root, artifact), content);
  await writeFile(join(root, ".csx", "workflow-state-v1.json"), `${JSON.stringify(activeWorkflowState({
    artifact,
    artifactSha256: createHash("sha256").update(content).digest("hex"),
  }))}\n`);
}

async function createInstallation(scope, root) {
  const layout = installationLayout(scope, root);
  await mkdir(dirname(layout.hook), { recursive: true });
  await cp(sourceHook, layout.hook);
  await writeFile(layout.receipt, `${JSON.stringify({
    version: "test",
    scope,
    root,
    configRoot: layout.configRoot,
    files: [layout.hook],
  })}\n`);
}

async function removeInstallation(scope, root) {
  const layout = installationLayout(scope, root);
  await rm(layout.receipt);
  await rm(layout.hook);
}

function installationLayout(scope, root) {
  const configRoot = scope === "project" ? join(root, ".codex") : root;
  return {
    configRoot,
    receipt: join(configRoot, ".csx-install-receipt.json"),
    hook: join(configRoot, "hooks", "csx-hook.mjs"),
  };
}

function runSession(hook, scope, authorityRoot, cwd) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [
      hook,
      "session-start",
      "--authority-scope",
      scope,
      "--authority-root",
      authorityRoot,
    ], { cwd, encoding: "utf8" }, (error, stdout) => {
      resolveRun({ code: error?.code ?? 0, stdout });
    });
    child.stdin.end(JSON.stringify({
      hook_event_name: "SessionStart",
      source: "resume",
      cwd,
    }));
  });
}
