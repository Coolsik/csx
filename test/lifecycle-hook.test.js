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

test("a copied Stop hook repeatedly blocks an ordinary active bound Root wait lease without mutation", async () => {
  const fixture = await lifecycleFixture();
  try {
    await writeWaitLease(fixture);
    const stateBefore = await readFile(fixture.statePath);
    const leaseBefore = await readFile(fixture.leasePath);
    for (const stop_hook_active of [false, true]) {
      const result = await runLifecycleHook(fixture, "stop", {
        hook_event_name: "Stop",
        cwd: fixture.root,
        stop_hook_active,
      });
      assert.equal(result.code, 0);
      const output = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(output).sort(), ["decision", "reason"]);
      assert.equal(output.decision, "block");
      assert.equal(typeof output.reason, "string");
      assert.equal(result.stdout.includes(fixture.state().instanceToken), false);
      assert.equal(result.stdout.includes(sha256(fixture.state().instanceToken)), false);
      assert.equal(result.stdout.includes("PRIVATE ARTIFACT CONTENT"), false);
    }
    assert.deepEqual(await readFile(fixture.statePath), stateBefore);
    assert.deepEqual(await readFile(fixture.leasePath), leaseBefore);
  } finally {
    await fixture.cleanup();
  }
});

test("Stop blocks Root-boundary phases with a distinct fixed reason", async (t) => {
  const phaseCases = [
    "root_handoff_ready",
    "root_decision_required",
    "root_blocked",
    "root_rotation_required",
  ];
  for (const phase of phaseCases) {
    await t.test(phase, async () => {
      const fixture = await lifecycleFixture();
      try {
        await writeState(fixture, { phase });
        await writeWaitLease(fixture);
        const result = await runLifecycleHook(fixture, "stop", {
          hook_event_name: "Stop",
          cwd: fixture.root,
          stop_hook_active: true,
        });
        assert.equal(result.code, 0);
        const output = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(output).sort(), ["decision", "reason"]);
        assert.equal(output.decision, "block");
        assert.equal(typeof output.reason, "string");
      } finally {
        await fixture.cleanup();
      }
    });
  }

  await t.test("boundary reason differs from ordinary wait reason", async () => {
    const fixture = await lifecycleFixture();
    try {
      await writeWaitLease(fixture);
      const ordinary = JSON.parse((await runLifecycleHook(fixture, "stop", {
        hook_event_name: "Stop",
        cwd: fixture.root,
        stop_hook_active: true,
      })).stdout);
      await writeState(fixture, { phase: "root_handoff_ready" });
      const boundary = JSON.parse((await runLifecycleHook(fixture, "stop", {
        hook_event_name: "Stop",
        cwd: fixture.root,
        stop_hook_active: true,
      })).stdout);
      assert.equal(boundary.decision, "block");
      assert.notEqual(boundary.reason, ordinary.reason);
    } finally {
      await fixture.cleanup();
    }
  });

  for (const [name, arrange] of [
    ["missing lease", async (fixture) => {}],
    ["malformed lease", async (fixture) => writeFile(fixture.leasePath, "{")],
    ["terminal state", async (fixture) => {
      await writeWaitLease(fixture);
      await writeState(fixture, {
        status: "terminal",
        finishedAt: new Date().toISOString(),
        terminalOutcome: "complete",
      });
    }],
    ["mismatched lease", async (fixture) => writeWaitLease(fixture, {
      instanceTokenSha256: "0".repeat(64),
    })],
    ["expired lease", async (fixture) => writeWaitLease(fixture, {
      updatedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:01:30.000Z",
    })],
    ["future lease timestamp", async (fixture) => writeWaitLease(fixture, {
      openedAt: "2999-01-01T00:00:00.000Z",
      updatedAt: "2999-01-01T00:00:00.000Z",
      expiresAt: "2999-01-01T00:01:30.000Z",
    })],
    ["missing artifact", async (fixture) => {
      await writeWaitLease(fixture);
      await rm(fixture.artifactPath);
    }],
    ["drifted artifact", async (fixture) => {
      await writeWaitLease(fixture);
      await writeFile(fixture.artifactPath, "changed artifact");
    }],
    ["symlink artifact", async (fixture) => {
      await writeWaitLease(fixture);
      const target = join(fixture.root, "stop-artifact-target.md");
      await writeFile(target, "PRIVATE ARTIFACT CONTENT");
      await rm(fixture.artifactPath);
      await symlink(target, fixture.artifactPath);
    }],
    ["oversize artifact", async (fixture) => {
      await writeWaitLease(fixture);
      await writeFile(fixture.artifactPath, Buffer.alloc(ARTIFACT_LIMIT + 1, "x"));
    }],
  ]) {
    await t.test(name, async () => {
      const fixture = await lifecycleFixture();
      try {
        await arrange(fixture);
        assert.deepEqual(await runLifecycleHook(fixture, "stop", {
          hook_event_name: "Stop",
          cwd: fixture.root,
          stop_hook_active: false,
        }), { code: 0, stdout: "" });
      } finally {
        await fixture.cleanup();
      }
    });
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
    leasePath: join(root, ".csx", "root-wait-lease-v1.json"),
    state,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeState(fixture, patch) {
  await writeFile(fixture.statePath, `${JSON.stringify({ ...fixture.state(), ...patch })}\n`);
}

function runHook(fixture, payload) {
  return runLifecycleHook(fixture, "session-start", payload);
}

function runLifecycleHook(fixture, operation, payload) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [
      fixture.hook,
      operation,
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

async function writeWaitLease(fixture, patch = {}) {
  const now = new Date();
  const updatedAt = now.toISOString();
  const lease = {
    schema: "csx.root-wait-lease",
    version: 1,
    status: "awaiting_leader",
    workflow: fixture.state().workflow,
    instanceTokenSha256: sha256(fixture.state().instanceToken),
    waitIndex: 1,
    waitSeconds: 45,
    openedAt: updatedAt,
    updatedAt,
    expiresAt: new Date(now.getTime() + 105_000).toISOString(),
    ...patch,
  };
  await writeFile(fixture.leasePath, `${JSON.stringify(lease)}\n`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
