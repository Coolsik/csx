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
import {
  activeWorkflowState,
  WORKFLOW_STATE_SCHEMA_CASES,
} from "./fixtures/workflow-state-schema.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceHook = join(repositoryRoot, "payload", "hooks", "csx-hook.mjs");
const STATE_LIMIT = 65_536;
const ARTIFACT_LIMIT = 1_048_576;

test("a copied hook restores valid active workflows for every SessionStart source without mutation", async () => {
  const fixture = await lifecycleFixture();
  try {
    const source = await readFile(fixture.hook, "utf8");
    assert.deepEqual(
      [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])
        .filter((specifier) => !specifier.startsWith("node:")),
      [],
    );
    const stateBefore = await readFile(fixture.statePath);
    for (const sessionSource of ["startup", "resume", "clear"]) {
      const result = await runHook(fixture, {
        hook_event_name: "SessionStart",
        source: sessionSource,
        cwd: fixture.root,
      });
      assert.equal(result.code, 0);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
      assert.match(parsed.hookSpecificOutput.additionalContext, /csx-start-goal/);
      assert.match(parsed.hookSpecificOutput.additionalContext, /phase "implementation"/);
      assert.match(parsed.hookSpecificOutput.additionalContext, /\.csx\/goals\/work\.md/);
      assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /PRIVATE ARTIFACT CONTENT/);
      assert.equal(result.stdout.trim().split("\n").length, 1);
    }
    assert.deepEqual(await readFile(fixture.statePath), stateBefore);
  } finally {
    await fixture.cleanup();
  }
});

test("copied hook follows the shared exact-key workflow state schema corpus", async (t) => {
  for (const schemaCase of WORKFLOW_STATE_SCHEMA_CASES) {
    await t.test(schemaCase.name, async () => {
      const fixture = await lifecycleFixture();
      try {
        const state = schemaCase.makeState({
          artifact: ".csx/goals/work.md",
          artifactSha256: sha256("PRIVATE ARTIFACT CONTENT"),
        });
        await writeFile(fixture.statePath, `${JSON.stringify(state)}\n`);
        const result = await runHook(fixture, {
          hook_event_name: "SessionStart",
          source: "resume",
          cwd: fixture.root,
        });
        assert.equal(result.code, 0);
        if (schemaCase.restore) {
          assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, "SessionStart");
        } else {
          assert.equal(result.stdout, "");
        }
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("SessionStart state and artifact validator corpus fails open", async (t) => {
  const cases = [
    ["unsupported source", async (fixture) => {
      fixture.payload.source = "compact";
    }],
    ["missing state", async (fixture) => {
      await rm(fixture.statePath);
    }],
    ["malformed state", async (fixture) => {
      await writeFile(fixture.statePath, "{");
    }],
    ["invalid workflow", async (fixture) => {
      await writeState(fixture, { workflow: "csx-plan" });
    }],
    ["invalid token", async (fixture) => {
      await writeState(fixture, { instanceToken: "short" });
    }],
    ["invalid phase", async (fixture) => {
      await writeState(fixture, { phase: "bad\nphase" });
    }],
    ["escaping artifact path", async (fixture) => {
      await writeState(fixture, { artifact: ".csx/goals/../outside.md" });
    }],
    ["invalid artifact hash", async (fixture) => {
      await writeState(fixture, { artifactSha256: "0".repeat(63) });
    }],
    ["drifted artifact", async (fixture) => {
      await writeFile(fixture.artifactPath, "changed");
    }],
    ["symlink state", async (fixture) => {
      const target = join(fixture.root, "state-target.json");
      await cp(fixture.statePath, target);
      await rm(fixture.statePath);
      await symlink(target, fixture.statePath);
    }],
    ["symlink state directory", async (fixture) => {
      const state = await readFile(fixture.statePath);
      const target = join(fixture.root, "csx-target");
      await mkdir(join(target, "goals"), { recursive: true });
      await writeFile(join(target, "workflow-state-v1.json"), state);
      await writeFile(join(target, "goals", "work.md"), "PRIVATE ARTIFACT CONTENT");
      await rm(join(fixture.root, ".csx"), { recursive: true });
      await symlink(target, join(fixture.root, ".csx"));
    }],
    ["oversize state", async (fixture) => {
      await writeFile(fixture.statePath, Buffer.alloc(STATE_LIMIT + 1, "x"));
    }],
    ["symlink artifact", async (fixture) => {
      const target = join(fixture.root, "artifact-target.md");
      await cp(fixture.artifactPath, target);
      await rm(fixture.artifactPath);
      await symlink(target, fixture.artifactPath);
    }],
    ["oversize artifact", async (fixture) => {
      await writeFile(fixture.artifactPath, Buffer.alloc(ARTIFACT_LIMIT + 1));
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const fixture = await lifecycleFixture();
      try {
        fixture.payload = {
          hook_event_name: "SessionStart",
          source: "resume",
          cwd: fixture.root,
        };
        await mutate(fixture);
        assert.deepEqual(await runHook(fixture, fixture.payload), { code: 0, stdout: "" });
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("copied hook resolves nested and symlink navigation cwd to the physical Git worktree", async () => {
  const fixture = await lifecycleFixture();
  const navigationParent = await mkdtemp(join(tmpdir(), "csx-hook-navigation-"));
  try {
    await execFileAsync("git", ["-C", fixture.root, "init", "-q"]);
    const nested = join(fixture.root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const navigation = join(navigationParent, "linked-app");
    await symlink(nested, navigation);

    for (const cwd of [nested, navigation]) {
      const result = await runHook(fixture, {
        hook_event_name: "SessionStart",
        source: "startup",
        cwd,
      });
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, "SessionStart");
    }
  } finally {
    await fixture.cleanup();
    await rm(navigationParent, { recursive: true, force: true });
  }
});

test("non-Git SessionStart requires an exact project receipt proof", async () => {
  const fixture = await lifecycleFixture();
  try {
    const receiptPath = join(fixture.root, ".codex", ".csx-install-receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.root = join(fixture.root, "other");
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
    assert.deepEqual(await runHook(fixture, {
      hook_event_name: "SessionStart",
      source: "clear",
      cwd: fixture.root,
    }), { code: 0, stdout: "" });
  } finally {
    await fixture.cleanup();
  }
});

async function lifecycleFixture({ receipt = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "csx-installed-hook-"));
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  const artifact = ".csx/goals/work.md";
  const artifactPath = join(root, ".csx", "goals", "work.md");
  const statePath = join(root, ".csx", "workflow-state-v1.json");
  await mkdir(dirname(hook), { recursive: true });
  await mkdir(dirname(artifactPath), { recursive: true });
  await cp(sourceHook, hook);
  await writeFile(artifactPath, "PRIVATE ARTIFACT CONTENT");
  const state = () => activeWorkflowState({
    artifact,
    artifactSha256: sha256("PRIVATE ARTIFACT CONTENT"),
  });
  await writeFile(statePath, `${JSON.stringify(state())}\n`);
  if (receipt) {
    await writeFile(join(root, ".codex", ".csx-install-receipt.json"), `${JSON.stringify({
      version: "test",
      scope: "project",
      root,
      configRoot: join(root, ".codex"),
      files: [hook],
    })}\n`);
  }
  return {
    root,
    hook,
    artifactPath,
    statePath,
    state,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeState(fixture, patch) {
  await writeFile(fixture.statePath, `${JSON.stringify({ ...fixture.state(), ...patch })}\n`);
}

function runHook(fixture, payload) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [
      fixture.hook,
      "session-start",
      "--authority-scope",
      "project",
      "--authority-root",
      fixture.root,
    ], {
      cwd: fixture.root,
      encoding: "utf8",
    }, (error, stdout) => {
      resolveRun({ code: error?.code ?? 0, stdout });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
