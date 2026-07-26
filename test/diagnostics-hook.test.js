import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { activeWorkflowState } from "./fixtures/workflow-state-schema.js";
import { diagnosticTrailerCorpus } from "./fixtures/diagnostic-trailers.js";

const sourceHook = resolve("payload/hooks/csx-hook.mjs");
const writerWorker = resolve("test/fixtures/diagnostics-writer-worker.js");

test("copied SubagentStop hook matches the normative trailer corpus without raw data", async () => {
  const fixture = await diagnosticsFixture();
  try {
    for (const corpus of diagnosticTrailerCorpus) {
      const before = new Set(await eventNames(fixture));
      const result = await runHook(fixture, {
        hook_event_name: "SubagentStop",
        cwd: fixture.root,
        agent_type: "csx-executor",
        last_assistant_message: corpus.response,
        session_id: "SECRET_SESSION",
        turn_id: "SECRET_TURN",
        transcript_path: "/SECRET/PATH"
      });
      assert.deepEqual(result, { code: 0, stdout: "", stderr: "" }, corpus.name);
      const created = (await eventNames(fixture)).filter((name) => !before.has(name));
      assert.equal(created.length, 1, corpus.name);
      const event = JSON.parse(await readFile(join(fixture.directory, created[0]), "utf8"));
      assert.deepEqual(
        optionalFields(event),
        corpus.expected,
        corpus.name
      );
      const serialized = JSON.stringify(event);
      assert.doesNotMatch(serialized, /SECRET|normal body|csx-metrics|workflow-state-v1|diagnostics-v1/);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("SubagentStop gate requires active state, allowlisted role, and exact receipt ownership", async () => {
  const fixture = await diagnosticsFixture();
  try {
    const baseline = await eventCount(fixture);
    for (const patch of [
      { agent_type: "default" },
      { cwd: join(fixture.root, "missing") },
      { hook_event_name: "Stop" }
    ]) {
      const result = await runHook(fixture, {
        hook_event_name: "SubagentStop",
        cwd: fixture.root,
        agent_type: "csx-executor",
        last_assistant_message: "body",
        ...patch
      });
      assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
    }
    assert.equal(await eventCount(fixture), baseline);

    const receipt = JSON.parse(await readFile(fixture.receipt, "utf8"));
    receipt.files = receipt.files.filter((path) => path !== fixture.agent);
    await writeFile(fixture.receipt, `${JSON.stringify(receipt)}\n`);
    await runHook(fixture, {
      hook_event_name: "SubagentStop",
      cwd: fixture.root,
      agent_type: "csx-executor",
      last_assistant_message: "body"
    });
    assert.equal(await eventCount(fixture), baseline);
  } finally {
    await fixture.cleanup();
  }
});

test("SubagentStop null writes one base event while missing and non-string values write none", async () => {
  const fixture = await diagnosticsFixture();
  try {
    const base = {
      hook_event_name: "SubagentStop",
      cwd: fixture.root,
      agent_type: "csx-executor"
    };
    const before = await eventCount(fixture);
    await runHook(fixture, { ...base, last_assistant_message: null });
    assert.equal(await eventCount(fixture), before + 1);
    const event = JSON.parse(await readFile(join(
      fixture.directory,
      (await eventNames(fixture)).at(-1)
    ), "utf8"));
    assert.deepEqual(Object.keys(event).sort(), [
      "phase", "role", "schema", "timestamp", "version", "workflow"
    ]);
    for (const value of [undefined, 3, { status: "completed" }]) {
      const payload = { ...base };
      if (value !== undefined) payload.last_assistant_message = value;
      await runHook(fixture, payload);
    }
    assert.equal(await eventCount(fixture), before + 1);
  } finally {
    await fixture.cleanup();
  }
});

test("concurrent worker invocations stay inside the fixed bounded namespace", async () => {
  const fixture = await diagnosticsFixture();
  try {
    const results = await Promise.all(Array.from({ length: 24 }, () => runWorker(fixture)));
    for (const result of results) {
      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), { code: 0, stdout: "", stderr: "" });
    }
    const namespace = await inspectNamespace(fixture);
    assert.ok(namespace.finals.length >= 1);
    assert.ok(namespace.finals.length <= 2_304);
    assert.ok(namespace.temps.length <= 64);
    assert.ok(namespace.reservations.length <= 64);
    assert.deepEqual(namespace.unknown, []);
    for (const entry of [...namespace.finals, ...namespace.temps]) {
      assert.ok(entry.size <= 4_096, entry.name);
    }
    for (const entry of namespace.reservations) assert.equal(entry.size, 0, entry.name);
  } finally {
    await fixture.cleanup();
  }
});

test("preseeded abrupt-death residue and 64 stranded reservations cause a fixed fail-open drop", async () => {
  const fixture = await diagnosticsFixture();
  try {
    await mkdir(fixture.directory, { recursive: true });
    await writeFile(join(fixture.directory, "temp-00.json"), "x".repeat(4_096));
    for (let index = 0; index < 64; index += 1) {
      await writeFile(
        join(fixture.directory, `reservation-${String(index).padStart(2, "0")}`),
        ""
      );
    }
    const before = (await readdir(fixture.directory)).sort();
    const result = await runWorker(fixture);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { code: 0, stdout: "", stderr: "" });
    assert.deepEqual((await readdir(fixture.directory)).sort(), before);

    const namespace = await inspectNamespace(fixture);
    assert.equal(namespace.finals.length, 0);
    assert.equal(namespace.temps.length, 1);
    assert.equal(namespace.temps[0].size, 4_096);
    assert.equal(namespace.reservations.length, 64);
    assert.ok(namespace.reservations.every(({ size }) => size === 0));
    assert.deepEqual(namespace.unknown, []);
  } finally {
    await fixture.cleanup();
  }
});

test("saturated finals drop after bounded stale cleanup without allocating new names", async () => {
  const fixture = await diagnosticsFixture();
  try {
    await mkdir(fixture.directory, { recursive: true });
    for (let start = 0; start < 2_304; start += 128) {
      await Promise.all(Array.from(
        { length: Math.min(128, 2_304 - start) },
        (_, offset) => writeFile(
          join(fixture.directory, `event-${String(start + offset).padStart(4, "0")}.json`),
          "{}\n"
        )
      ));
    }
    const staleTemp = join(fixture.directory, "temp-63.json");
    const staleReservation = join(fixture.directory, "reservation-63");
    await writeFile(staleTemp, "{}\n");
    await writeFile(staleReservation, "");
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await utimes(staleTemp, stale, stale);
    await utimes(staleReservation, stale, stale);

    const result = await runWorker(fixture);
    assert.deepEqual(JSON.parse(result.stdout), { code: 0, stdout: "", stderr: "" });
    const namespace = await inspectNamespace(fixture);
    assert.equal(namespace.finals.length, 2_304);
    assert.equal(namespace.temps.length, 0);
    assert.equal(namespace.reservations.length, 0);
    assert.deepEqual(namespace.unknown, []);
  } finally {
    await fixture.cleanup();
  }
});

test("symlink, directory, and oversize fixed slots are never followed or overwritten", async () => {
  const fixture = await diagnosticsFixture();
  try {
    await mkdir(fixture.directory, { recursive: true });
    const target = join(fixture.root, "outside-target");
    const symlinkSlot = join(fixture.directory, "event-0000.json");
    const directorySlot = join(fixture.directory, "event-0001.json");
    const oversizeSlot = join(fixture.directory, "event-0002.json");
    await writeFile(target, "OUTSIDE");
    await symlink(target, symlinkSlot);
    await mkdir(directorySlot);
    await writeFile(oversizeSlot, "u".repeat(4_097));

    const result = await runWorker(fixture);
    assert.deepEqual(JSON.parse(result.stdout), { code: 0, stdout: "", stderr: "" });
    assert.equal(await readFile(target, "utf8"), "OUTSIDE");
    assert.equal((await lstat(symlinkSlot)).isSymbolicLink(), true);
    assert.equal((await lstat(directorySlot)).isDirectory(), true);
    assert.equal((await lstat(oversizeSlot)).size, 4_097);
    assert.equal((await lstat(join(fixture.directory, "event-0003.json"))).isFile(), true);

    const namespace = await inspectNamespace(fixture);
    assert.ok(namespace.finals.length <= 2_304);
    assert.ok(namespace.temps.length <= 64);
    assert.ok(namespace.reservations.length <= 64);
    assert.deepEqual(namespace.unknown, []);
  } finally {
    await fixture.cleanup();
  }
});

async function diagnosticsFixture() {
  const root = await mkdtemp(join(tmpdir(), "csx-diagnostics-hook-"));
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  const agent = join(root, ".codex", "agents", "csx-executor.toml");
  const receipt = join(root, ".codex", ".csx-install-receipt.json");
  const state = join(root, ".csx", "workflow-state-v1.json");
  await mkdir(dirname(hook), { recursive: true });
  await mkdir(dirname(agent), { recursive: true });
  await mkdir(dirname(state), { recursive: true });
  await cp(sourceHook, hook);
  await writeFile(agent, 'name = "csx-executor"\n');
  await writeFile(receipt, `${JSON.stringify({
    version: "test",
    scope: "project",
    root,
    configRoot: join(root, ".codex"),
    files: [hook, agent]
  })}\n`);
  await writeFile(state, `${JSON.stringify(activeWorkflowState())}\n`);
  return {
    root,
    hook,
    agent,
    receipt,
    directory: join(root, ".csx", "diagnostics-v1"),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

function runHook(fixture, payload) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [
      fixture.hook,
      "subagent-stop",
      "--authority-scope",
      "project",
      "--authority-root",
      fixture.root
    ], { cwd: fixture.root, encoding: "utf8" }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function runWorker(fixture) {
  const payload = JSON.stringify({
    hook_event_name: "SubagentStop",
    cwd: fixture.root,
    agent_type: "csx-executor",
    last_assistant_message: "normal body\n<!-- csx-metrics:v1 {\"status\":\"completed\"} -->"
  });
  return new Promise((resolveRun) => {
    execFile(process.execPath, [
      writerWorker,
      "--run",
      fixture.hook,
      "project",
      fixture.root,
      payload
    ], { cwd: fixture.root, encoding: "utf8" }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

async function eventCount(fixture) {
  return (await eventNames(fixture)).length;
}

async function eventNames(fixture) {
  return (await readdir(fixture.directory).catch(() => []))
    .filter((name) => /^event-\d{4}\.json$/.test(name));
}

function optionalFields(event) {
  return Object.fromEntries(["status", "reason_code", "failure_detail"]
    .filter((key) => key in event)
    .map((key) => [key, event[key]]));
}

async function inspectNamespace(fixture) {
  const names = await readdir(fixture.directory);
  const result = { finals: [], temps: [], reservations: [], unknown: [] };
  for (const name of names) {
    const info = await lstat(join(fixture.directory, name));
    const entry = { name, size: info.size };
    if (/^event-(?:0\d{3}|1\d{3}|2[0-2]\d{2}|230[0-3])\.json$/.test(name)) {
      result.finals.push(entry);
    } else if (/^temp-(?:0\d|[1-5]\d|6[0-3])\.json$/.test(name)) {
      result.temps.push(entry);
    } else if (/^reservation-(?:0\d|[1-5]\d|6[0-3])$/.test(name)) {
      result.reservations.push(entry);
    } else {
      result.unknown.push(entry);
    }
  }
  return result;
}
