import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  WORKFLOW_ARTIFACT_LIMIT,
  WORKFLOW_STATE_LIMIT,
  WORKFLOW_STATE_PATH,
  readWorkflowState,
  runWorkflowOperation
} from "../lib/workflow-state.js";
import { WORKFLOW_STATE_SCHEMA_CASES } from "./fixtures/workflow-state-schema.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);

test("begin, checkpoint, and finish maintain one canonical terminal record", async () => {
  const fixture = await workflowFixture("plans", "work-pro.md", "initial");
  try {
    const begin = await operation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting"
    });
    assert.equal(begin.ok, true);
    assert.match(begin.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(begin.state.artifactSha256, sha256("initial"));

    await writeFile(fixture.artifactPath, "reviewed");
    const checkpoint = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "review-1"
    });
    assert.equal(checkpoint.ok, true);
    assert.equal(checkpoint.state.status, "active");
    assert.equal(checkpoint.state.artifactSha256, sha256("reviewed"));

    await writeFile(fixture.artifactPath, "approved");
    const finish = await operation(fixture, "finish", {
      token: begin.token,
      phase: "complete",
      outcome: "approved"
    });
    assert.equal(finish.ok, true);
    assert.equal(finish.state.status, "terminal");
    assert.equal(finish.state.terminalOutcome, "approved");
    assert.equal(finish.state.artifactSha256, sha256("approved"));

    const disk = JSON.parse(await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8"));
    assert.equal(disk.instanceToken, begin.token);
    assert.equal(disk.status, "terminal");
    assert.equal((await readWorkflowState({ projectRoot: fixture.root })).ok, true);
  } finally {
    await fixture.cleanup();
  }
});

test("a replacement begin makes stale checkpoint and finish fail open without mutation", async () => {
  const fixture = await workflowFixture("goals", "execute.md", "R000");
  try {
    const first = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    const second = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "resume"
    });
    assert.notEqual(first.token, second.token);
    const before = await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8");

    const staleCheckpoint = await operation(fixture, "checkpoint", {
      token: first.token,
      phase: "implementation"
    });
    const staleFinish = await operation(fixture, "finish", {
      token: first.token,
      phase: "complete",
      outcome: "complete"
    });
    assert.deepEqual(staleCheckpoint, machineFailure("checkpoint", "token_mismatch"));
    assert.deepEqual(staleFinish, machineFailure("finish", "token_mismatch"));
    assert.equal(await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8"), before);
  } finally {
    await fixture.cleanup();
  }
});

test("concurrent begin calls leave one complete state owned by a returned token", async () => {
  const fixture = await workflowFixture("plans", "parallel-pro.md", "draft");
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      operation(fixture, "begin", {
        workflow: "csx-plan-pro",
        phase: `draft-${index}`
      })));
    assert.equal(results.every(({ ok }) => ok), true);
    const stateText = await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8");
    assert.ok(Buffer.byteLength(stateText) <= WORKFLOW_STATE_LIMIT);
    const state = JSON.parse(stateText);
    assert.equal(state.schema, "csx.workflow-state");
    assert.equal(results.some(({ token }) => token === state.instanceToken), true);
    assert.equal(state.status, "active");
  } finally {
    await fixture.cleanup();
  }
});

test("concurrent replacement begin wins over stale checkpoint and finish CAS", async () => {
  const fixture = await workflowFixture("goals", "race.md", "R000");
  try {
    const original = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    const [replacement, staleCheckpoint, staleFinish] = await Promise.all([
      operation(fixture, "begin", {
        workflow: "csx-start-goal",
        phase: "replacement"
      }),
      operation(fixture, "checkpoint", {
        token: original.token,
        phase: "stale-checkpoint"
      }),
      operation(fixture, "finish", {
        token: original.token,
        phase: "stale-finish",
        outcome: "complete"
      })
    ]);
    assert.equal(replacement.ok, true);
    assert.ok([true, false].includes(staleCheckpoint.ok));
    assert.ok([true, false].includes(staleFinish.ok));
    const state = JSON.parse(await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8"));
    assert.equal(state.instanceToken, replacement.token);
    assert.equal(state.status, "active");
    assert.equal(state.phase, "replacement");
  } finally {
    await fixture.cleanup();
  }
});

test("kernel release after lock-holder death lets a stable anchor be reused", {
  skip: process.platform !== "linux"
}, async () => {
  const fixture = await workflowFixture("goals", "crash.md", "R000");
  let child;
  try {
    const begin = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    const anchor = join(fixture.root, ".csx", ".workflow-state-v1.lock");
    const anchorInfo = await lstat(anchor);
    assert.equal(anchorInfo.isFile(), true);
    assert.equal(anchorInfo.mode & 0o777, 0o600);

    const lockModule = pathToFileURL(join(repositoryRoot, "lib", "transaction-lock.js")).href;
    const script = `
      import { open } from "node:fs/promises";
      import { loadLockCapability } from ${JSON.stringify(lockModule)};
      const handle = await open(process.argv[1], "r+");
      const { lock } = loadLockCapability();
      await new Promise((resolveLock, rejectLock) => lock(handle.fd, "exnb", (error) => error ? rejectLock(error) : resolveLock()));
      process.stdout.write("locked\\n");
      setInterval(() => {}, 60_000);
    `;
    child = spawn(process.execPath, ["--input-type=module", "--eval", script, anchor], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForChildText(child, "locked\n");
    const exitPromise = waitForChildExit(child);
    child.kill("SIGKILL");
    const exit = await exitPromise;
    child = undefined;
    assert.equal(exit.signal, "SIGKILL");
    assert.equal((await lstat(anchor)).isFile(), true);

    await writeFile(fixture.artifactPath, "R001");
    const checkpoint = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "implementation"
    });
    assert.equal(checkpoint.ok, true);
    assert.equal(checkpoint.token, begin.token);
    assert.equal(checkpoint.state.artifactSha256, sha256("R001"));
  } finally {
    child?.kill("SIGKILL");
    await fixture.cleanup();
  }
});

test("lock anchor must be a no-follow regular mode-0600 file", async () => {
  const fixture = await workflowFixture("plans", "anchor-pro.md", "draft");
  try {
    const anchor = join(fixture.root, ".csx", ".workflow-state-v1.lock");
    const target = join(fixture.root, "outside-lock");
    await writeFile(target, "unchanged");
    await symlink(target, anchor);
    const linked = await operation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting"
    });
    assert.equal(linked.ok, false);
    assert.equal(await readFile(target, "utf8"), "unchanged");

    await rm(anchor);
    await writeFile(anchor, "", { mode: 0o644 });
    const wrongMode = await operation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting"
    });
    assert.equal(wrongMode.ok, false);
    assert.equal(wrongMode.code, "state_lock_unsafe");
  } finally {
    await fixture.cleanup();
  }
});

test("artifact validation rejects escape, workflow pairing, symlinks, and oversize files", async () => {
  const fixture = await workflowFixture("plans", "safe-pro.md", "draft");
  try {
    const escape = await rawOperation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting",
      artifact: ".csx/plans/../goals/escape.md"
    });
    assert.equal(escape.code, "artifact_escape");

    const pairing = await rawOperation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry",
      artifact: fixture.artifact
    });
    assert.equal(pairing.code, "artifact_escape");

    const target = join(fixture.root, ".csx", "plans", "target.md");
    const linked = join(fixture.root, ".csx", "plans", "linked-pro.md");
    await writeFile(target, "target");
    await symlink(target, linked);
    const symlinkResult = await rawOperation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting",
      artifact: ".csx/plans/linked-pro.md"
    });
    assert.equal(symlinkResult.code, "artifact_unsafe");

    await writeFile(fixture.artifactPath, Buffer.alloc(WORKFLOW_ARTIFACT_LIMIT + 1));
    const oversize = await operation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting"
    });
    assert.equal(oversize.code, "artifact_too_large");
  } finally {
    await fixture.cleanup();
  }
});

test("malformed and oversize state fail open and artifact drift is observable", async () => {
  const fixture = await workflowFixture("goals", "drift.md", "R000");
  try {
    const begin = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    await writeFile(fixture.artifactPath, "R001");
    const drift = await readWorkflowState({ projectRoot: fixture.root });
    assert.equal(drift.ok, false);
    assert.equal(drift.code, "artifact_drift");
    assert.equal(drift.state.artifactSha256, begin.state.artifactSha256);

    const statePath = join(fixture.root, WORKFLOW_STATE_PATH);
    await writeFile(statePath, "{");
    const malformed = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "implementation"
    });
    assert.equal(malformed.code, "state_malformed");

    await writeFile(statePath, Buffer.alloc(WORKFLOW_STATE_LIMIT + 1, "x"));
    const oversize = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "implementation"
    });
    assert.equal(oversize.code, "state_unsafe");
  } finally {
    await fixture.cleanup();
  }
});

test("shared workflow state schema corpus enforces exact keys without mutating malformed state", async (t) => {
  for (const schemaCase of WORKFLOW_STATE_SCHEMA_CASES) {
    await t.test(schemaCase.name, async () => {
      const fixture = await workflowFixture("goals", "work.md", "schema corpus");
      try {
        const statePath = join(fixture.root, WORKFLOW_STATE_PATH);
        const state = schemaCase.makeState({
          artifact: fixture.artifact,
          artifactSha256: sha256("schema corpus"),
        });
        const bytes = Buffer.from(`${JSON.stringify(state)}\n`);
        await writeFile(statePath, bytes);

        const read = await readWorkflowState({ projectRoot: fixture.root });
        if (schemaCase.valid) {
          assert.equal(read.ok, true);
          assert.equal(read.code, "state_current");
        } else {
          assert.equal(read.ok, false);
          assert.equal(read.code, "state_malformed");
          const checkpoint = await runWorkflowOperation("checkpoint", {
            version: 1,
            projectRoot: fixture.root,
            token: "A".repeat(43),
            phase: "still-active",
            artifact: fixture.artifact,
          });
          assert.equal(checkpoint.ok, false);
          assert.equal(checkpoint.code, "state_malformed");
          assert.deepEqual(await readFile(statePath), bytes);
        }
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("a symlinked state file is rejected without following its target", async () => {
  const fixture = await workflowFixture("plans", "state-link-pro.md", "draft");
  try {
    const begin = await operation(fixture, "begin", {
      workflow: "csx-plan-pro",
      phase: "drafting"
    });
    const statePath = join(fixture.root, WORKFLOW_STATE_PATH);
    const target = join(fixture.root, "outside-state.json");
    const original = await readFile(statePath, "utf8");
    await rm(statePath);
    await writeFile(target, original);
    await symlink(target, statePath);
    const result = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "review"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "state_unsafe");
    assert.equal(await readFile(target, "utf8"), original);
  } finally {
    await fixture.cleanup();
  }
});

test("terminal state rejects later checkpoint and finish while preserving the record", async () => {
  const fixture = await workflowFixture("goals", "terminal.md", "done");
  try {
    const begin = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    await operation(fixture, "finish", {
      token: begin.token,
      phase: "complete",
      outcome: "complete"
    });
    const before = await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8");
    const later = await operation(fixture, "checkpoint", {
      token: begin.token,
      phase: "reopened"
    });
    assert.deepEqual(later, machineFailure("checkpoint", "token_mismatch"));
    assert.equal(await readFile(join(fixture.root, WORKFLOW_STATE_PATH), "utf8"), before);
  } finally {
    await fixture.cleanup();
  }
});

test("implicit non-Git operations and reads use the exact installed ancestor root", async () => {
  const fixture = await workflowFixture("goals", "non-git.md", "R000");
  const nested = join(fixture.root, "packages", "app");
  const hook = join(fixture.root, ".codex", "hooks", "csx-hook.mjs");
  try {
    await mkdir(nested, { recursive: true });
    await mkdir(dirname(hook), { recursive: true });
    await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
    await writeFile(join(fixture.root, ".codex", ".csx-install-receipt.json"), `${JSON.stringify({
      scope: "project",
      root: fixture.root,
      configRoot: join(fixture.root, ".codex"),
      files: [hook]
    })}\n`);
    const begin = await runWorkflowOperation("begin", {
      version: 1,
      workflow: "csx-start-goal",
      phase: "implementation",
      artifact: fixture.artifact
    }, { cwd: nested });
    assert.equal(begin.ok, true);
    assert.equal((await readWorkflowState({ cwd: nested })).ok, true);
    assert.equal((await lstat(join(fixture.root, WORKFLOW_STATE_PATH))).isFile(), true);

    await mkdir(join(nested, ".codex"), { recursive: true });
    await writeFile(join(nested, ".codex", "config.toml"), "# >>> csx managed >>>\n");
    const blocked = await runWorkflowOperation("begin", {
      version: 1,
      workflow: "csx-start-goal",
      phase: "blocked",
      artifact: fixture.artifact
    }, { cwd: nested });
    assert.deepEqual(blocked, machineFailure("begin", "state_unavailable"));
  } finally {
    await fixture.cleanup();
  }
});

test("Git workflow state accepts valid installation authority and true absence", async (t) => {
  for (const authority of ["absent", "valid"]) {
    await t.test(authority, async () => {
      const fixture = await workflowFixture("goals", `${authority}.md`, "R000");
      const nested = join(fixture.root, "packages", "app");
      try {
        await exec("git", ["init", "-q", fixture.root]);
        await mkdir(nested, { recursive: true });
        if (authority === "valid") await writeValidAuthority(fixture.root);

        const begin = await runWorkflowOperation("begin", {
          version: 1,
          workflow: "csx-start-goal",
          phase: "implementation",
          artifact: fixture.artifact
        }, { cwd: nested });
        assert.equal(begin.ok, true);
        assert.equal((await readWorkflowState({ cwd: nested })).ok, true);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("unsafe Git authority blocks every state access before lock or tree mutation", async () => {
  const fixture = await workflowFixture("goals", "unsafe.md", "R000");
  const nested = join(fixture.root, "packages", "app");
  try {
    await exec("git", ["init", "-q", fixture.root]);
    await mkdir(nested, { recursive: true });
    const established = await operation(fixture, "begin", {
      workflow: "csx-start-goal",
      phase: "entry"
    });
    assert.equal(established.ok, true);
    await rm(join(fixture.root, ".csx", ".workflow-state-v1.lock"));
    await mkdir(join(fixture.root, ".codex"), { recursive: true });
    await writeFile(
      join(fixture.root, ".codex", "config.toml"),
      "# >>> csx managed >>>\n"
    );
    const before = await snapshotControlTree(fixture.root);

    const begin = await runWorkflowOperation("begin", {
      version: 1,
      workflow: "csx-start-goal",
      phase: "replacement",
      artifact: fixture.artifact
    }, { cwd: nested });
    const checkpoint = await runWorkflowOperation("checkpoint", {
      version: 1,
      projectRoot: fixture.root,
      token: established.token,
      phase: "implementation",
      artifact: fixture.artifact
    });
    const finish = await runWorkflowOperation("finish", {
      version: 1,
      token: established.token,
      phase: "complete",
      artifact: fixture.artifact,
      outcome: "complete"
    }, { cwd: nested });
    assert.deepEqual(begin, machineFailure("begin", "state_unavailable"));
    assert.deepEqual(checkpoint, machineFailure("checkpoint", "state_unavailable"));
    assert.deepEqual(finish, machineFailure("finish", "state_unavailable"));
    assert.deepEqual(await readWorkflowState({ cwd: nested }), {
      ok: false,
      code: "state_unavailable"
    });
    assert.deepEqual(await readWorkflowState({ projectRoot: fixture.root }), {
      ok: false,
      code: "state_unavailable"
    });
    assert.deepEqual(await snapshotControlTree(fixture.root), before);
    await assert.rejects(lstat(join(fixture.root, ".csx", ".workflow-state-v1.lock")), {
      code: "ENOENT"
    });
    await assert.rejects(lstat(join(fixture.root, ".csx", ".workflow-state-v1.tmp")), {
      code: "ENOENT"
    });
  } finally {
    await fixture.cleanup();
  }
});

async function workflowFixture(directory, name, content) {
  const root = await mkdtemp(join(tmpdir(), "csx-workflow-"));
  const artifact = `.csx/${directory}/${name}`;
  const artifactPath = join(root, ...artifact.split("/"));
  await mkdir(join(root, ".csx", directory), { recursive: true });
  await writeFile(artifactPath, content);
  return {
    root,
    artifact,
    artifactPath,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function writeValidAuthority(root) {
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  await mkdir(dirname(hook), { recursive: true });
  await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
  await writeFile(join(root, ".codex", ".csx-install-receipt.json"), `${JSON.stringify({
    scope: "project",
    root,
    configRoot: join(root, ".codex"),
    files: [hook]
  })}\n`);
}

async function snapshotControlTree(root) {
  const entries = [];
  for (const directory of [".codex", ".csx"]) {
    await snapshotDirectory(join(root, directory), directory, entries);
  }
  return entries;
}

async function snapshotDirectory(path, relativePath, entries) {
  const info = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) {
    entries.push([relativePath, "missing"]);
    return;
  }
  if (info.isDirectory()) {
    entries.push([relativePath, "directory", info.mode & 0o777]);
    for (const name of await readdir(path)) {
      await snapshotDirectory(join(path, name), `${relativePath}/${name}`, entries);
    }
    return;
  }
  entries.push([
    relativePath,
    info.isSymbolicLink() ? "symlink" : "file",
    info.mode & 0o777,
    info.size,
    info.isFile() ? (await readFile(path)).toString("base64") : null
  ]);
}

function operation(fixture, name, fields) {
  return rawOperation(fixture, name, { ...fields, artifact: fixture.artifact });
}

function rawOperation(fixture, name, fields) {
  return runWorkflowOperation(name, {
    version: 1,
    projectRoot: fixture.root,
    ...fields
  });
}

function machineFailure(operationName, code) {
  return {
    schema: "csx.workflow-result",
    version: 1,
    ok: false,
    operation: operationName,
    code
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function waitForChildText(child, expected) {
  return new Promise((resolveText, rejectText) => {
    let output = "";
    const timer = setTimeout(() => rejectText(new Error(`child did not emit ${JSON.stringify(expected)}`)), 5_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolveText();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectText(error);
    });
    child.once("exit", (code, signal) => {
      if (!output.includes(expected)) {
        clearTimeout(timer);
        rejectText(new Error(`child exited before locking: code=${code} signal=${signal}`));
      }
    });
  });
}

function waitForChildExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}
