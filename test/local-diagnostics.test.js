import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  DIAGNOSTIC_EVENT_COUNT,
  DIAGNOSTIC_EVENT_MAX_BYTES,
  DIAGNOSTIC_NAMESPACE_MAX_BYTES,
  DIAGNOSTIC_TEMP_COUNT,
  parseDiagnosticTrailer,
  readLocalDiagnostics
} from "../lib/local-diagnostics.js";
import { diagnosticTrailerCorpus } from "./fixtures/diagnostic-trailers.js";

test("normative diagnostic trailer corpus is field tolerant", () => {
  for (const fixture of diagnosticTrailerCorpus) {
    assert.deepEqual(parseDiagnosticTrailer(fixture.response), fixture.expected, fixture.name);
  }
});

test("diagnostics namespace has the exact bounded logical cap", () => {
  assert.equal(DIAGNOSTIC_EVENT_COUNT, 2_304);
  assert.equal(DIAGNOSTIC_TEMP_COUNT, 64);
  assert.equal(DIAGNOSTIC_EVENT_MAX_BYTES, 4_096);
  assert.equal(
    DIAGNOSTIC_EVENT_COUNT * DIAGNOSTIC_EVENT_MAX_BYTES +
      DIAGNOSTIC_TEMP_COUNT * DIAGNOSTIC_EVENT_MAX_BYTES,
    9_699_328
  );
  assert.equal(DIAGNOSTIC_NAMESPACE_MAX_BYTES, 9_699_328);
});

test("reader returns only safe, current, bounded final events in timestamp order", async () => {
  const root = await mkdtemp(join(tmpdir(), "csx-local-diagnostics-"));
  const hook = join(root, ".codex", "hooks", "csx-hook.mjs");
  const receipt = join(root, ".codex", ".csx-install-receipt.json");
  const directory = join(root, ".csx", "diagnostics-v1");
  try {
    await mkdir(dirname(hook), { recursive: true });
    await mkdir(directory, { recursive: true });
    await cp(resolve("payload/hooks/csx-hook.mjs"), hook);
    await writeFile(receipt, `${JSON.stringify({
      version: "test",
      scope: "project",
      root,
      configRoot: join(root, ".codex"),
      files: [hook]
    })}\n`);
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    const base = {
      schema: "csx.diagnostic-event",
      version: 1,
      workflow: "csx-start-goal",
      phase: "verification",
      role: "csx-executor"
    };
    await writeFile(join(directory, "event-0001.json"), `${JSON.stringify({
      ...base,
      timestamp: "2026-07-26T11:00:00.000Z",
      status: "completed"
    })}\n`);
    await writeFile(join(directory, "event-0000.json"), `${JSON.stringify({
      ...base,
      timestamp: "2026-07-26T10:00:00.000Z",
      reason_code: "bounded"
    })}\n`);
    await writeFile(join(directory, "event-0002.json"), `${JSON.stringify({
      ...base,
      timestamp: "2026-06-01T00:00:00.000Z"
    })}\n`);
    await writeFile(join(directory, "event-0003.json"), "PRIVATE RAW BODY");
    await writeFile(join(directory, "event-0004.json"), "x".repeat(4_097));
    await writeFile(join(root, "unsafe-target"), "{}");
    await symlink(join(root, "unsafe-target"), join(directory, "event-0005.json"));
    await writeFile(join(directory, "unknown.json"), JSON.stringify({ secret: true }));

    const result = await readLocalDiagnostics({ cwd: root, now });
    assert.deepEqual(result, {
      schema: "csx.diagnostics",
      version: 1,
      scope: "project",
      events: [
        { ...base, timestamp: "2026-07-26T10:00:00.000Z", reason_code: "bounded" },
        { ...base, timestamp: "2026-07-26T11:00:00.000Z", status: "completed" }
      ]
    });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|unsafe-target|unknown\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
