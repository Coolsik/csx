import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import {
  classifyInstallationAuthority,
  resolveProjectContext
} from "../lib/project-context.js";

const exec = promisify(execFile);

test("linked worktrees use their own top-level and never the common Git directory", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "csx-context-"));
  const primary = join(base, "primary");
  const linked = join(base, "linked");
  await mkdir(primary);
  await exec("git", ["init", "-q", primary]);
  await exec("git", ["-C", primary, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", primary, "config", "user.name", "Test"]);
  await exec("git", ["-C", primary, "commit", "--allow-empty", "-qm", "base"]);
  await exec("git", ["-C", primary, "worktree", "add", "-q", linked]);
  t.after(async () => {
    await exec("git", ["-C", primary, "worktree", "remove", "--force", linked]).catch(() => {});
  });

  const nested = join(linked, "nested");
  await mkdir(nested);
  const context = await resolveProjectContext({ cwd: nested });
  const { stdout: common } = await exec("git", ["-C", linked, "rev-parse", "--git-common-dir"]);

  assert.deepEqual(context, { root: resolve(linked), source: "git-worktree" });
  assert.notEqual(context.root, resolve(linked, common.trim()));
  assert.notEqual(context.root, resolve(primary, ".git"));
});

test("a cwd entered through a directory symlink resolves to the physical linked worktree", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "csx-context-linked-cwd-"));
  const primary = join(base, "primary");
  const linked = join(base, "linked");
  const alias = join(base, "linked-alias");
  await mkdir(primary);
  await exec("git", ["init", "-q", primary]);
  await exec("git", ["-C", primary, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", primary, "config", "user.name", "Test"]);
  await exec("git", ["-C", primary, "commit", "--allow-empty", "-qm", "base"]);
  await exec("git", ["-C", primary, "worktree", "add", "-q", linked]);
  t.after(async () => {
    await exec("git", ["-C", primary, "worktree", "remove", "--force", linked]).catch(() => {});
  });
  await mkdir(join(linked, "nested"));
  await symlink(linked, alias);

  const context = await resolveProjectContext({ cwd: join(alias, "nested") });
  assert.deepEqual(context, { root: resolve(linked), source: "git-worktree" });
  assert.notEqual(context.root, resolve(primary, ".git"));
});

test("Git authority validation allows valid or absent roots and rejects unsafe residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-context-git-authority-"));
  const nested = join(root, "nested");
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  try {
    await exec("git", ["init", "-q", root]);
    await mkdir(nested);
    assert.deepEqual(await resolveProjectContext({
      projectRoot: nested,
      requireSafeGitAuthority: true
    }), { root: resolve(root), source: "git-worktree" });

    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex", "config.toml"), "# >>> csx managed >>>\n");
    await assert.rejects(
      resolveProjectContext({ cwd: nested, requireSafeGitAuthority: true }),
      /unsafe project csx installation authority/
    );
    assert.deepEqual(await resolveProjectContext({ cwd: nested }), {
      root: resolve(root),
      source: "git-worktree"
    });

    await rm(join(root, ".codex"), { recursive: true });
    await mkdir(join(root, ".codex", "hooks"), { recursive: true });
    await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
    await writeFile(join(root, ".codex", ".csx-install-receipt.json"), `${JSON.stringify({
      scope: "project",
      root,
      configRoot: join(root, ".codex"),
      files: [hook]
    })}\n`);
    assert.deepEqual(await resolveProjectContext({
      cwd: nested,
      requireSafeGitAuthority: true
    }), { root: resolve(root), source: "git-worktree" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit non-Git roots are fresh roots; implicit roots require exact ancestor proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-context-nongit-"));
  const nested = join(root, "a", "b");
  await mkdir(nested, { recursive: true });

  assert.deepEqual(await resolveProjectContext({ projectRoot: root, cwd: nested }), {
    root: resolve(root),
    source: "explicit-non-git"
  });
  await assert.rejects(resolveProjectContext({ cwd: nested }), /exact receipt proof/);
  assert.deepEqual(await resolveProjectContext({
    cwd: nested,
    proveReceipt: async (candidate) => candidate === resolve(root)
  }), { root: resolve(root), source: "receipt-ancestor" });
});

test("explicit non-Git symlinks return their physical root while .git symlinks remain rejected", async () => {
  const base = await mkdtemp(join(tmpdir(), "csx-context-link-"));
  const root = join(base, "root");
  const alias = join(base, "alias");
  await mkdir(root);
  await symlink(root, alias);
  assert.deepEqual(await resolveProjectContext({ projectRoot: alias, git: async () => null }), {
    root: resolve(root),
    source: "explicit-non-git"
  });

  const nested = join(root, "nested");
  await mkdir(nested);
  await symlink(join(base, "missing-git"), join(root, ".git"));
  await assert.rejects(resolveProjectContext({
    cwd: nested,
    git: async () => null,
    proveReceipt: async () => false
  }), /Git boundary must not be a symlink/);
});

test("exact installation classification fails closed on partial authority and managed residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-context-authority-"));
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  const receipt = join(root, ".codex", ".csx-install-receipt.json");
  const config = join(root, ".codex", "config.toml");
  try {
    await mkdir(join(root, ".codex", "hooks"), { recursive: true });
    await writeFile(config, "[unrelated]\nvalue = true\n");
    assert.equal(await classifyInstallationAuthority("project", root), "absent");

    await writeFile(config, "# >>> csx managed >>>\n");
    assert.equal(await classifyInstallationAuthority("project", root), "unsafe");

    await writeFile(config, "[unrelated]\nvalue = true\n");
    await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
    assert.equal(await classifyInstallationAuthority("project", root), "unsafe");
    await writeFile(receipt, `${JSON.stringify({
      scope: "project",
      root,
      configRoot: join(root, ".codex"),
      files: [hook]
    })}\n`);
    assert.equal(await classifyInstallationAuthority("project", root), "valid");

    await writeFile(config, Buffer.alloc(1_048_577));
    assert.equal(await classifyInstallationAuthority("project", root), "unsafe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("implicit non-Git authority stops at unsafe residue before a higher valid receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-context-barrier-"));
  const nested = join(root, "nested");
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  try {
    await mkdir(join(nested, ".codex"), { recursive: true });
    await mkdir(join(root, ".codex", "hooks"), { recursive: true });
    await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
    await writeFile(join(root, ".codex", ".csx-install-receipt.json"), `${JSON.stringify({
      scope: "project",
      root,
      configRoot: join(root, ".codex"),
      files: [hook]
    })}\n`);
    await writeFile(join(nested, ".codex", "config.toml"), "# >>> csx managed >>>\n");
    await assert.rejects(
      resolveProjectContext({ cwd: nested, git: async () => null }),
      /unsafe project csx installation authority/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
