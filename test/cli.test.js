import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import test from "node:test";
import { install } from "../lib/install.js";
import { AGENT_NAMES, presetMatrix } from "../lib/presets.js";
import {
  classifyLocalFilesystem,
  loadLockCapability,
  TransactionLockError
} from "../lib/transaction-lock.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "csx.js");
const harness = resolve(root, "test", "fixtures", "setup-tui-harness.js");
const ENTER = "\r";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";
const ESC = "\u001b";

test("install without scope fails with usage when stdin is not a TTY", async () => {
  const result = await run([cli, "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /scope is required/);
  assert.match(result.stderr, /Usage:/);
});

test("install rejects an invalid scope without attempting installation", async () => {
  const result = await run([cli, "install", "--scope", "workspace"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid scope "workspace"; expected global or project/);
  assert.match(result.stderr, /Usage:/);
});

test("setup is routed and refuses non-interactive terminals", async () => {
  const result = await run([cli, "setup"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /setup requires an interactive terminal/);
  assert.match(result.stderr, /Usage:/);
});

test("setup rejects argv instead of treating it as interactive input", async () => {
  const result = await run([cli, "setup", "--preset", "Low"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /setup does not accept arguments/);
});

test("unknown and misspelled commands are rejected", async () => {
  const result = await run([cli, "unisntall"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown command/);
});

test("separate harness calls Apply exactly once through the real TUI command path", async () => {
  const fixture = await setupFixture();
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { Team: fixture.installedMatrix }
    })}\n`);
    const tracked = trackedFiles(fixture);
    const actions = [
      ENTER, ESC, ENTER,
      DOWN, ENTER,
      ...repeat(DOWN, AGENT_NAMES.length), ENTER,
      ENTER,
      ENTER
    ];
    const result = await runPty(fixture, harness, actions, { tracked });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.harness.ok, true);
    assert.equal(result.harness.result.changed, true);
    assert.equal(result.harness.result.scope, "global");
    assert.equal(result.harness.result.paths.length, 9);
    assert.equal(result.harness.applyCount, 1);
    assert.deepEqual(result.harness.changes, { agents: 8, receipt: 1, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("10x3 current-frame snapshots prove list/detail pairs, exact active, actions, and resize focus", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { Team: fixture.installedMatrix }
    })}\n`);
    const matrixItemCount = AGENT_NAMES.length * 3;
    const detailCount = matrixItemCount + 3;
    const low = presetMatrix("Low");
    const focusedAgent = AGENT_NAMES[0];
    const focusedPair = low[focusedAgent];
    const listPages = [
      ...AGENT_NAMES.flatMap((agent) => {
        const pair = fixture.installedMatrix[agent];
        return [
          expectedPages(`>${agent}`, 10, 3),
          expectedPages(`>Model:${pair.model}`, 10, 3),
          expectedPages(`>Reasoning:${pair.reasoning}`, 10, 3)
        ];
      }),
      expectedPresetPages({ name: "Low", kind: "preset", active: false }, 10, 2)
        .map((page) => `Presets:\n${page}`),
      expectedPresetPages({ name: "Medium", kind: "preset", active: false }, 10, 2)
        .map((page) => `Presets:\n${page}`),
      expectedPresetPages({ name: "High", kind: "preset", active: true }, 10, 2)
        .map((page) => `Presets:\n${page}`),
      expectedPresetPages({ name: "Team", kind: "custom", active: true }, 10, 2)
        .map((page) => `Presets:\n${page}`),
      expectedPresetPages({ name: "Edit current", kind: "current", active: false }, 10, 2)
        .map((page) => `Presets:\n${page}`)
    ];
    const actions = [];
    for (let index = matrixItemCount; index < listPages.length; index += 1) {
      const firstPage = index === matrixItemCount ? 1 : 0;
      for (let page = firstPage; page < listPages[index].length; page += 1) {
        actions.push({ key: DOWN, capture: `list-${index}-${page}` });
      }
    }
    for (let index = 0; index < matrixItemCount; index += 1) {
      for (let page = 0; page < listPages[index].length; page += 1) {
        actions.push({ key: DOWN, capture: `list-${index}-${page}` });
      }
    }
    actions.push({ key: DOWN });
    actions.push({ key: ENTER, capture: "detail-24" });
    for (let step = 1; step <= detailCount; step += 1) {
      const index = (matrixItemCount + step) % detailCount;
      actions.push({
        key: DOWN,
        capture: index === matrixItemCount ? undefined : `detail-${index}`
      });
    }
    actions.push(
      { key: DOWN },
      { key: DOWN },
      { key: DOWN, capture: "focus-tiny-before" },
      {
        resize: [80, 24],
        capture: "focus-normal",
        ready: (frame) => frame.includes("Screen: detail") &&
          frame.includes(`> ${focusedAgent}: Model ${focusedPair.model} | Reasoning ${focusedPair.reasoning}`)
      },
      {
        resize: [10, 3],
        capture: "focus-tiny-after",
        ready: (frame) => compactFrame(frame) === `>${focusedAgent}`
      },
      { key: ESC },
      { key: ESC }
    );
    const result = await runPty(fixture, harness, actions, {
      columns: 10,
      rows: 3,
      tracked: trackedFiles(fixture),
      initialCapture: "list-24"
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    for (const [index, agent] of AGENT_NAMES.entries()) {
      const pair = fixture.installedMatrix[agent];
      assert.equal(capturedFrame(frames, `list-${index * 3}-0`), listPages[index * 3][0]);
      assert.equal(capturedFrame(frames, `list-${index * 3 + 1}-0`), listPages[index * 3 + 1][0]);
      assert.equal(capturedFrame(frames, `list-${index * 3 + 2}-0`), listPages[index * 3 + 2][0]);
    }
    assert.equal(compactFrame(capturedFrame(frames, "list-24")), "Presets:> Low");
    assert.equal(capturedFrame(frames, "list-25-0"), listPages[matrixItemCount + 1][0]);
    assert.equal(capturedFrame(frames, "list-26-0"), listPages[matrixItemCount + 2][0]);
    assert.equal(capturedFrame(frames, "list-27-0"), listPages[matrixItemCount + 3][0]);
    assert.equal(capturedFrame(frames, "list-27-1"), listPages[matrixItemCount + 3][1]);
    assert.equal(capturedFrame(frames, "list-28-0"), listPages[matrixItemCount + 4][0]);
    assert.equal(capturedFrame(frames, "list-28-1"), listPages[matrixItemCount + 4][1]);

    for (const [index, agent] of AGENT_NAMES.entries()) {
      const pair = low[agent];
      assert.equal(compactFrame(capturedFrame(frames, `detail-${index * 3}`)), `>${agent}`);
      assert.equal(compactFrame(capturedFrame(frames, `detail-${index * 3 + 1}`)), `>Model:${pair.model}`);
      assert.equal(compactFrame(capturedFrame(frames, `detail-${index * 3 + 2}`)), `>Reasoning:${pair.reasoning}`);
    }
    assert.equal(capturedFrame(frames, "detail-24"), "> Edit\nPreset:Low");
    assert.equal(compactFrame(capturedFrame(frames, "detail-25")), "> Apply");
    assert.equal(compactFrame(capturedFrame(frames, "detail-26")), "> Cancel");
    assert.equal(compactFrame(capturedFrame(frames, "focus-tiny-before")), `>${AGENT_NAMES[0]}`);
    assert.match(capturedFrame(frames, "focus-normal"), new RegExp(`> ${AGENT_NAMES[0]}: Model ${low[AGENT_NAMES[0]].model} \\| Reasoning ${low[AGENT_NAMES[0]].reasoning}`));
    assert.equal(compactFrame(capturedFrame(frames, "focus-tiny-after")), `>${AGENT_NAMES[0]}`);
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("10x3 actual PTY exposes long ASCII/CJK pages and distinct custom/current collision boundaries", async () => {
  const longModelA = `shared-model-${"a".repeat(32)}-TAIL-A`;
  const longModelB = `shared-model-${"a".repeat(32)}-TAIL-B`;
  const longReasoningA = `공통추론-${"가나다라마바사".repeat(5)}-꼬리A`;
  const longReasoningB = `공통추론-${"가나다라마바사".repeat(5)}-꼬리B`;
  const longAsciiName = `shared-custom-${"x".repeat(36)}-NAME-A`;
  const longCjkName = `공통사용자설정-${"한글이름".repeat(8)}-이름B`;
  const collisionName = "eDiT CuRrEnT";
  const matrix = (model, reasoning) => Object.fromEntries(
    AGENT_NAMES.map((name) => [name, { model, reasoning }])
  );
  const baseline = matrix(longModelA, longReasoningA);
  baseline[AGENT_NAMES[1]] = { model: longModelB, reasoning: longReasoningB };
  const collisionMatrix = matrix(longModelB, longReasoningB);
  const catalog = [
    { model: longModelA, efforts: [longReasoningA] },
    { model: longModelB, efforts: [longReasoningB] },
    { model: "gpt-5.6-sol", efforts: ["low", "medium", "high", "xhigh"] },
    { model: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh"] },
    { model: "gpt-5.6-terra", efforts: ["low", "medium", "high", "xhigh"] }
  ];
  const fixture = await setupFixture({
    fixtureOnly: true,
    baselineMatrix: baseline,
    catalog
  });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: {
        [longAsciiName]: baseline,
        [longCjkName]: collisionMatrix,
        [collisionName]: collisionMatrix
      }
    })}\n`);

    const presetSpecs = [
      { name: "Low", kind: "preset", active: false },
      { name: "Medium", kind: "preset", active: false },
      { name: "High", kind: "preset", active: false },
      { name: longAsciiName, kind: "custom", active: true },
      { name: longCjkName, kind: "custom", active: false },
      { name: collisionName, kind: "custom", active: false },
      { name: "Edit current", kind: "current", active: false }
    ];
    const matrixItemCount = AGENT_NAMES.length * 3;
    const firstPresetIndex = matrixItemCount;
    const longAsciiPresetIndex = firstPresetIndex + 3;
    const longCjkPresetIndex = firstPresetIndex + 4;
    const collisionPresetIndex = firstPresetIndex + 5;
    const currentPresetIndex = firstPresetIndex + 6;
    const detailEditIndex = matrixItemCount;
    const detailApplyIndex = detailEditIndex + 1;
    const detailCancelIndex = detailEditIndex + 2;
    const firstModelIndex = 1;
    const firstReasoningIndex = 2;
    const secondModelIndex = 4;
    const secondReasoningIndex = 5;
    const matrixItems = (value) => AGENT_NAMES.flatMap((agent) => [
      expectedPages(`>${agent}`, 10, 3),
      expectedPages(`>Model:${value[agent].model}`, 10, 3),
      expectedPages(`>Reasoning:${value[agent].reasoning}`, 10, 3)
    ]);
    const listItems = [
      ...matrixItems(baseline),
      ...presetSpecs.map((preset) =>
        expectedPresetPages(preset, 10, 2).map((page) => `Presets:\n${page}`))
    ];
    const detailItems = (value, preset) => [
      ...matrixItems(value),
      chunkPages([
        "> Edit",
        ...expectedChunks(`Preset:${preset.name}`, 10),
        preset.kind === "custom" ? "[custom]" : "[current]"
      ], 3),
      ["> Apply"],
      ["> Cancel"]
    ];
    const editItems = AGENT_NAMES.flatMap((agent) => [
      expectedPages(`>Model:${baseline[agent].model}`, 10, 3),
      expectedPages(`>Reasoning:${baseline[agent].reasoning}`, 10, 3)
    ]);
    const actions = [];
    const expectedFrames = new Map();
    const addCapture = (action, capture, frame) => {
      assert.equal(expectedFrames.has(capture), false, `duplicate expected frame: ${capture}`);
      expectedFrames.set(capture, frame);
      actions.push({
        ...action,
        capture,
        ...(action.resize ? { ready: (current) => current === frame } : {})
      });
    };
    const addDown = (capture, frame) => addCapture({ key: DOWN }, capture, frame);
    const initialCapture = `boundary-list-${firstPresetIndex}-0`;
    expectedFrames.set(initialCapture, listItems[firstPresetIndex][0]);

    for (let index = firstPresetIndex; index <= currentPresetIndex; index += 1) {
      const firstPage = index === firstPresetIndex ? 1 : 0;
      for (let page = firstPage; page < listItems[index].length; page += 1) {
        addDown(`boundary-list-${index}-${page}`, listItems[index][page]);
      }
    }
    for (let index = 0; index <= secondReasoningIndex; index += 1) {
      for (let page = 0; page < listItems[index].length; page += 1) {
        addDown(`boundary-list-${index}-${page}`, listItems[index][page]);
      }
    }

    const reasoningB20 = expectedPages(`>Reasoning:${longReasoningB}`, 20, 3);
    const clampedPage = Math.min(
      listItems[secondReasoningIndex].length - 1,
      reasoningB20.length - 1
    );
    addCapture(
      { resize: [20, 3] },
      "boundary-resize-20-clamped",
      reasoningB20[clampedPage]
    );
    addCapture(
      { resize: [10, 3] },
      "boundary-resize-10-revisit",
      listItems[secondReasoningIndex][clampedPage]
    );
    for (
      let page = clampedPage + 1;
      page < listItems[secondReasoningIndex].length;
      page += 1
    ) {
      addDown(
        `boundary-list-${secondReasoningIndex}-revisited-${page}`,
        listItems[secondReasoningIndex][page]
      );
    }
    addDown("boundary-list-next-agent-after-revisit", listItems[secondReasoningIndex + 1][0]);
    actions.push({ resize: [80, 24], deferRender: true });
    const thirdAgentModelIndex = secondReasoningIndex + 2;
    const modelAt80 = expectedPages(`>Model:${longModelA}`, 80, 24)[0];
    addCapture(
      { key: DOWN, ready: (current) => current === modelAt80 },
      "boundary-list-80-overflow-next",
      modelAt80
    );
    actions.push({ resize: [10, 3], deferRender: true });

    for (let index = thirdAgentModelIndex - 1; index >= 0; index -= 1) {
      for (let page = listItems[index].length - 1; page >= 0; page -= 1) {
        const frame = listItems[index][page];
        addCapture(
          {
            key: "\u001b[A",
            ...(index === thirdAgentModelIndex - 1 &&
              page === listItems[index].length - 1
              ? { ready: (current) => current === frame }
              : {})
          },
          `boundary-list-overflow-reverse-${index}-${page}`,
          frame
        );
      }
    }
    for (let page = listItems[currentPresetIndex].length - 1; page >= 0; page -= 1) {
      addCapture(
        { key: "\u001b[A" },
        `boundary-list-current-reverse-${page}`,
        listItems[currentPresetIndex][page]
      );
    }
    for (let page = listItems[collisionPresetIndex].length - 1; page >= 0; page -= 1) {
      addCapture(
        { key: "\u001b[A" },
        `boundary-list-collision-reverse-${page}`,
        listItems[collisionPresetIndex][page]
      );
    }
    const collisionDetail = detailItems(collisionMatrix, {
      name: collisionName,
      kind: "custom"
    });
    addCapture(
      { key: ENTER },
      `boundary-detail-collision-${detailEditIndex}-0`,
      collisionDetail[detailEditIndex][0]
    );
    for (let page = 1; page < collisionDetail[detailEditIndex].length; page += 1) {
      addDown(
        `boundary-detail-collision-${detailEditIndex}-${page}`,
        collisionDetail[detailEditIndex][page]
      );
    }
    for (const index of [
      detailApplyIndex,
      detailCancelIndex,
      0,
      firstModelIndex,
      firstReasoningIndex
    ]) {
      for (let page = 0; page < collisionDetail[index].length; page += 1) {
        addDown(
          `boundary-detail-collision-${index}-${page}`,
          collisionDetail[index][page]
        );
      }
    }

    actions.push({ key: ESC });
    for (let page = 1; page < listItems[collisionPresetIndex].length; page += 1) {
      addDown(
        `boundary-list-collision-forward-${page}`,
        listItems[collisionPresetIndex][page]
      );
    }
    addDown("boundary-list-current-select", listItems[currentPresetIndex][0]);
    const currentDetail = detailItems(baseline, {
      name: "Edit current",
      kind: "current"
    });
    addCapture(
      { key: ENTER },
      `boundary-detail-current-${detailEditIndex}-0`,
      currentDetail[detailEditIndex][0]
    );
    for (let page = 1; page < currentDetail[detailEditIndex].length; page += 1) {
      addDown(
        `boundary-detail-current-${detailEditIndex}-${page}`,
        currentDetail[detailEditIndex][page]
      );
    }
    for (const index of [
      detailApplyIndex,
      detailCancelIndex,
      0,
      firstModelIndex,
      firstReasoningIndex
    ]) {
      for (let page = 0; page < currentDetail[index].length; page += 1) {
        addDown(`boundary-detail-current-${index}-${page}`, currentDetail[index][page]);
      }
    }

    actions.push({ key: ESC });
    addCapture(
      { key: ENTER },
      "boundary-detail-current-reselected",
      currentDetail[detailEditIndex][0]
    );
    addCapture({ key: ENTER }, "boundary-edit-current-0-0", editItems[0][0]);
    for (let index = 0; index <= 3; index += 1) {
      const firstPage = index === 0 ? 1 : 0;
      for (let page = firstPage; page < editItems[index].length; page += 1) {
        addDown(`boundary-edit-current-${index}-${page}`, editItems[index][page]);
      }
    }
    actions.push({ key: ESC }, { key: ESC }, { key: ESC });

    const result = await runPty(fixture, harness, actions, {
      columns: 10,
      rows: 3,
      tracked: trackedFiles(fixture),
      initialCapture,
      timeout: 20_000
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    assert.equal(frames.size, expectedFrames.size);
    for (const [capture, expected] of expectedFrames) {
      assert.equal(capturedFrame(frames, capture), expected, capture);
    }

    const capturedByPrefix = (prefix) => [...frames]
      .filter(([capture]) => capture.startsWith(prefix))
      .map(([, frame]) => frame);
    assert.ok(capturedByPrefix(`boundary-list-${firstModelIndex}-`)
      .some((frame) => frame.includes("TAIL-A")));
    assert.ok(capturedByPrefix(`boundary-list-${secondModelIndex}-`)
      .some((frame) => frame.includes("TAIL-B")));
    assert.ok(capturedByPrefix(`boundary-list-${firstReasoningIndex}-`)
      .some((frame) => frame.includes("꼬리A")));
    assert.ok(capturedByPrefix(`boundary-list-${secondReasoningIndex}-`)
      .some((frame) => frame.includes("꼬리B")));
    assert.ok(capturedByPrefix(`boundary-list-${longAsciiPresetIndex}-`)
      .some((frame) => frame.includes("NAME-A")));
    assert.ok(capturedByPrefix(`boundary-list-${longAsciiPresetIndex}-`)
      .some((frame) => frame.includes("[custom]\n[active]")));
    assert.ok(capturedByPrefix(`boundary-list-${longCjkPresetIndex}-`)
      .some((frame) => frame.includes("이름B")));
    assert.ok(capturedByPrefix(`boundary-list-${currentPresetIndex}-`)
      .some((frame) => frame.includes("[current]")));
    assert.equal(capturedByPrefix(`boundary-list-${currentPresetIndex}-`)
      .some((frame) => frame.includes("[active]")), false);
    assert.ok(capturedByPrefix(`boundary-detail-collision-${detailEditIndex}-`)
      .some((frame) => frame.includes("[custom]")));
    assert.ok(capturedByPrefix(`boundary-detail-current-${detailEditIndex}-`)
      .some((frame) => frame.includes("[current]")));
    assert.ok(capturedByPrefix(`boundary-detail-collision-${firstModelIndex}-`)
      .some((frame) => frame.includes("TAIL-B")));
    assert.ok(capturedByPrefix(`boundary-detail-collision-${firstReasoningIndex}-`)
      .some((frame) => frame.includes("꼬리B")));
    assert.ok(capturedByPrefix(`boundary-detail-current-${firstModelIndex}-`)
      .some((frame) => frame.includes("TAIL-A")));
    assert.ok(capturedByPrefix(`boundary-detail-current-${firstReasoningIndex}-`)
      .some((frame) => frame.includes("꼬리A")));
    assert.ok(capturedByPrefix("boundary-edit-current-0-")
      .some((frame) => frame.includes("TAIL-A")));
    assert.ok(capturedByPrefix("boundary-edit-current-1-")
      .some((frame) => frame.includes("꼬리A")));
    assert.ok(capturedByPrefix("boundary-edit-current-2-")
      .some((frame) => frame.includes("TAIL-B")));
    assert.ok(capturedByPrefix("boundary-edit-current-3-")
      .some((frame) => frame.includes("꼬리B")));
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("actual PTY preserves focused overflow paging at 10x4, across 3↔4, and at 80x24", async () => {
  const numbered = (prefix, count) => Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(3, "0")}`
  ).join("-");
  const longModel = `overflow-model-${numbered("M", 64)}-MODEL-END`;
  const longReasoning = `넘침추론-${numbered("가", 48)}-추론끝`;
  const longName = `overflow-profile-${numbered("N", 64)}-NAME-END`;
  const matrix = Object.fromEntries(
    AGENT_NAMES.map((name) => [name, { model: longModel, reasoning: longReasoning }])
  );
  const fixture = await setupFixture({
    fixtureOnly: true,
    baselineMatrix: matrix,
    catalog: [{ model: longModel, efforts: [longReasoning] }]
  });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { [longName]: matrix }
    })}\n`);
    const matrixItemCount = AGENT_NAMES.length * 3;
    const presetSpecs = [
      { name: "Low", kind: "preset", active: false },
      { name: "Medium", kind: "preset", active: false },
      { name: "High", kind: "preset", active: false },
      { name: longName, kind: "custom", active: true },
      { name: "Edit current", kind: "current", active: false }
    ];
    const matrixItems = (columns, rows) => AGENT_NAMES.flatMap((agent) => [
      expectedPages(`>${agent}`, columns, rows),
      expectedPages(`>Model:${matrix[agent].model}`, columns, rows),
      expectedPages(`>Reasoning:${matrix[agent].reasoning}`, columns, rows)
    ]);
    const listItems = (columns, rows) => [
      ...matrixItems(columns, rows),
      ...presetSpecs.map((preset) =>
        expectedPresetPages(preset, columns, rows - 1)
          .map((page) => `Presets:\n${page}`))
    ];
    const list10x4 = listItems(10, 4);
    const list80x24 = listItems(80, 24);
    const customIndex = matrixItemCount + 3;
    const actions = [];
    const expectedFrames = new Map();
    const addCapture = (action, capture, frame, rows) => {
      assert.equal(expectedFrames.has(capture), false, `duplicate expected frame: ${capture}`);
      expectedFrames.set(capture, { frame, rows });
      actions.push({
        ...action,
        capture,
        ...(action.resize ? { ready: (current) => current === frame } : {})
      });
    };
    const initialCapture = "overflow-list-low";
    expectedFrames.set(initialCapture, { frame: list10x4[matrixItemCount][0], rows: 4 });

    for (let index = matrixItemCount; index < list10x4.length; index += 1) {
      const firstPage = index === matrixItemCount ? 1 : 0;
      for (let page = firstPage; page < list10x4[index].length; page += 1) {
        addCapture(
          { key: DOWN },
          `overflow-list10-${index}-${page}`,
          list10x4[index][page],
          4
        );
      }
    }
    for (let index = 0; index <= 2; index += 1) {
      for (let page = 0; page < list10x4[index].length; page += 1) {
        addCapture(
          { key: DOWN },
          `overflow-list10-${index}-${page}`,
          list10x4[index][page],
          4
        );
      }
    }
    const reasoning10x3 = expectedPages(`>Reasoning:${longReasoning}`, 10, 3);
    const preservedPage = Math.min(
      list10x4[2].length - 1,
      reasoning10x3.length - 1
    );
    addCapture(
      { resize: [10, 3] },
      "overflow-resize-10x3",
      reasoning10x3[preservedPage],
      3
    );
    addCapture(
      { resize: [10, 4] },
      "overflow-resize-10x4",
      list10x4[2][preservedPage],
      4
    );
    for (let page = preservedPage + 1; page < list10x4[2].length; page += 1) {
      addCapture(
        { key: DOWN },
        `overflow-list10-revisited-2-${page}`,
        list10x4[2][page],
        4
      );
    }
    addCapture(
      { resize: [80, 24] },
      "overflow-list80-reasoning",
      list80x24[2][0],
      24
    );
    for (let index = 3; index <= customIndex; index += 1) {
      for (let page = 0; page < list80x24[index].length; page += 1) {
        addCapture(
          { key: DOWN },
          `overflow-list80-${index}-${page}`,
          list80x24[index][page],
          24
        );
      }
    }

    const detailEdit = chunkPages([
      "> Edit",
      ...expectedChunks(`Preset:${longName}`, 80),
      "[custom]"
    ], 24);
    addCapture({ key: ENTER }, "overflow-detail80-edit", detailEdit[0], 24);
    addCapture({ key: DOWN }, "overflow-detail80-apply", "> Apply", 24);
    addCapture({ key: DOWN }, "overflow-detail80-cancel", "> Cancel", 24);
    addCapture({ key: DOWN }, "overflow-detail80-agent", `>${AGENT_NAMES[0]}`, 24);
    const model80 = expectedPages(`>Model:${longModel}`, 80, 24);
    const reasoning80 = expectedPages(`>Reasoning:${longReasoning}`, 80, 24);
    addCapture({ key: DOWN }, "overflow-detail80-model", model80[0], 24);
    addCapture({ key: DOWN }, "overflow-detail80-reasoning", reasoning80[0], 24);
    actions.push({ key: ESC });
    addCapture({ key: ENTER }, "overflow-detail80-reselected", detailEdit[0], 24);
    addCapture({ key: ENTER }, "overflow-edit80-model", model80[0], 24);
    addCapture({ key: DOWN }, "overflow-edit80-reasoning", reasoning80[0], 24);
    actions.push({ key: ESC }, { key: ESC }, { key: ESC });

    const result = await runPty(fixture, harness, actions, {
      columns: 10,
      rows: 4,
      tracked: trackedFiles(fixture),
      initialCapture,
      timeout: 20_000
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    assert.equal(frames.size, expectedFrames.size);
    for (const [capture, expected] of expectedFrames) {
      const frame = capturedFrame(frames, capture);
      assert.equal(frame, expected.frame, capture);
      assert.ok(frame.split("\n").length <= expected.rows, `${capture} physical rows`);
    }
    assert.ok(capturedFrame(frames, "overflow-list80-reasoning").includes("추론끝"));
    assert.ok(capturedFrame(frames, `overflow-list80-${customIndex}-0`)
      .includes("NAME-END"));
    assert.ok(capturedFrame(frames, `overflow-list80-${customIndex}-0`)
      .includes("[custom]\n[active]"));
    assert.ok(capturedFrame(frames, "overflow-detail80-edit").includes("[custom]"));
    assert.ok(capturedFrame(frames, "overflow-detail80-model").includes("MODEL-END"));
    assert.ok(capturedFrame(frames, "overflow-edit80-reasoning").includes("추론끝"));
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("actual PTY visibly escapes adversarial external text without control injection", async () => {
  const rawName = "preset\\literal\n\r\t\0\x7f\x9b\x1b]8;;https://invalid\x07OSC\u061c\u200e\u200f\u2028\u2029\u202a\u202e\u2066\u2069-END";
  const rawModel = "model\\path\n\r\t\0\x7f\x9b\x1b]0;injected\x07\u202e-MODEL-END";
  const rawReasoning = "reason\\value\n\r\t\0\x7f\x9b\x1b[31mRED\x1b[0m\u2066-REASON-END";
  const shownName = expectedVisibleText(rawName);
  const shownModel = expectedVisibleText(rawModel);
  const shownReasoning = expectedVisibleText(rawReasoning);
  const matrix = Object.fromEntries(
    AGENT_NAMES.map((name) => [name, { model: rawModel, reasoning: rawReasoning }])
  );
  const catalogEntry = { model: rawModel, efforts: [rawReasoning] };
  const fixture = await setupFixture({
    fixtureOnly: true,
    baselineMatrix: matrix,
    catalog: [catalogEntry]
  });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { [rawName]: matrix }
    })}\n`);
    const matrixItemCount = AGENT_NAMES.length * 3;
    const customIndex = matrixItemCount + 3;
    const presetSpecs = [
      { name: "Low", kind: "preset", active: false },
      { name: "Medium", kind: "preset", active: false },
      { name: "High", kind: "preset", active: false },
      { name: shownName, kind: "custom", active: true },
      { name: "Edit current", kind: "current", active: false }
    ];
    const matrixItems = AGENT_NAMES.flatMap((agent) => [
      expectedPages(`>${agent}`, 10, 4),
      expectedPages(`>Model:${shownModel}`, 10, 4),
      expectedPages(`>Reasoning:${shownReasoning}`, 10, 4)
    ]);
    const listItems = [
      ...matrixItems,
      ...presetSpecs.map((preset) =>
        expectedPresetPages(preset, 10, 3)
          .map((page) => `Presets:\n${page}`))
    ];
    const actions = [];
    const expectedFrames = new Map();
    const addExpected = (capture, frame) => {
      assert.equal(expectedFrames.has(capture), false, `duplicate expected frame: ${capture}`);
      expectedFrames.set(capture, frame);
    };
    const addDown = (capture, frame) => {
      addExpected(capture, frame);
      actions.push({ key: DOWN, capture });
    };
    const initialCapture = "adversarial-list-low";
    addExpected(initialCapture, listItems[matrixItemCount][0]);

    for (let index = matrixItemCount; index < listItems.length; index += 1) {
      const firstPage = index === matrixItemCount ? 1 : 0;
      for (let page = firstPage; page < listItems[index].length; page += 1) {
        addDown(`adversarial-list-first-${index}-${page}`, listItems[index][page]);
      }
    }
    for (let index = 0; index < matrixItemCount; index += 1) {
      for (let page = 0; page < listItems[index].length; page += 1) {
        addDown(`adversarial-list-matrix-${index}-${page}`, listItems[index][page]);
      }
    }
    for (let index = matrixItemCount; index <= customIndex; index += 1) {
      for (let page = 0; page < listItems[index].length; page += 1) {
        addDown(`adversarial-list-select-${index}-${page}`, listItems[index][page]);
      }
    }

    const detailItems = [
      ...matrixItems,
      chunkPages([
        "> Edit",
        ...expectedChunks(`Preset:${shownName}`, 10),
        "[custom]"
      ], 4),
      ["> Apply"],
      ["> Cancel"]
    ];
    addExpected("adversarial-detail-edit-0", detailItems[matrixItemCount][0]);
    actions.push({ key: ENTER, capture: "adversarial-detail-edit-0" });
    for (let page = 1; page < detailItems[matrixItemCount].length; page += 1) {
      addDown(`adversarial-detail-edit-${page}`, detailItems[matrixItemCount][page]);
    }
    for (const index of [matrixItemCount + 1, matrixItemCount + 2, 0, 1, 2]) {
      for (let page = 0; page < detailItems[index].length; page += 1) {
        addDown(`adversarial-detail-${index}-${page}`, detailItems[index][page]);
      }
    }
    actions.push({ key: ESC }, { key: ESC });

    const result = await runPty(fixture, harness, actions, {
      columns: 10,
      rows: 4,
      tracked: trackedFiles(fixture),
      initialCapture,
      timeout: 20_000,
      expectedRaw: {
        baselineMatrix: matrix,
        custom: { name: rawName, matrix },
        catalog: catalogEntry
      }
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    assert.equal(frames.size, expectedFrames.size);
    for (const [capture, expected] of expectedFrames) {
      const frame = capturedFrame(frames, capture);
      assert.equal(frame, expected, capture);
      assert.ok(frame.split("\n").length <= 4, `${capture} physical rows`);
      assert.doesNotMatch(
        frame,
        /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/
      );
    }
    const allFrames = [...frames.values()];
    const visibleNameChunks = expectedChunks(`> ${shownName}`, 10);
    const visibleModelChunks = expectedChunks(`>Model:${shownModel}`, 10);
    const visibleReasoningChunks = expectedChunks(`>Reasoning:${shownReasoning}`, 10);
    for (const chunk of [
      ...visibleNameChunks,
      ...visibleModelChunks,
      ...visibleReasoningChunks
    ]) {
      assert.ok(allFrames.some((frame) => frame.includes(chunk)), `visible chunk ${chunk}`);
    }
    assert.ok(allFrames.some((frame) => frame.includes(visibleNameChunks.at(-1))));
    assert.ok(allFrames.some((frame) => frame.includes(visibleModelChunks.at(-1))));
    assert.ok(allFrames.some((frame) => frame.includes(visibleReasoningChunks.at(-1))));
    assert.ok(allFrames.some((frame) => frame.includes("[custom]\n[active]")));
    for (const injected of [
      "\0",
      "\x7f",
      "\x9b",
      "\x1b]8;;https://invalid\x07",
      "\x1b]0;injected\x07",
      "\x1b[31mRED\x1b[0m",
      "\u061c",
      "\u200e",
      "\u200f",
      "\u2028",
      "\u2029",
      "\u202a",
      "\u202e",
      "\u2066",
      "\u2069"
    ]) {
      assert.equal(result.output.includes(injected), false, `raw injection ${JSON.stringify(injected)}`);
    }
    assert.equal(result.harness.rawInputsMatch, true);
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("actual PTY pages long escaped review and confirm frames across 3↔4↔80 then cancels", async () => {
  const numbered = (prefix, count) => Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(3, "0")}`
  ).join("-");
  const baselineModel = `base\\\\model-${numbered("B", 240)}-BASE-Z`;
  const baselineReasoning = `기준\\t-${numbered("가", 165)}-기준끝`;
  const draftModel = `draft\\\\model-${numbered("M", 240)}-DRAFT-Y`;
  const draftReasoning = `변경\\t-${numbered("라", 170)}-변경끝`;
  const presetName = `Long\\\\Preset-${numbered("P", 175)}-PRESET-Q`;
  const customName = `Review\\\\Save-${numbered("C", 375)}-CUSTOM-W`;
  const matrix = (model, reasoning) => Object.fromEntries(
    AGENT_NAMES.map((name) => [name, { model, reasoning }])
  );
  const baseline = matrix(baselineModel, baselineReasoning);
  const draft = structuredClone(baseline);
  draft[AGENT_NAMES[0]] = { model: draftModel, reasoning: draftReasoning };
  const fixture = await setupFixture({
    fixtureOnly: true,
    baselineMatrix: baseline,
    catalog: [
      { model: baselineModel, efforts: [baselineReasoning] },
      { model: draftModel, efforts: [draftReasoning] }
    ]
  });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { [presetName]: draft }
    })}\n`);

    const shown = {
      baselineModel: expectedVisibleText(baselineModel),
      baselineReasoning: expectedVisibleText(baselineReasoning),
      draftModel: expectedVisibleText(draftModel),
      draftReasoning: expectedVisibleText(draftReasoning),
      presetName: expectedVisibleText(presetName),
      customName: expectedVisibleText(customName)
    };
    const renderedPages = (chunks, rows) => chunkPages(chunks, rows).map((page) =>
      page.split("\n").map((line) => line.trimEnd()).join("\n"));
    const diffPages = (columns, rows) => renderedPages([
      ...expectedChunks(`> [x] ${AGENT_NAMES[0]}`, columns),
      ...expectedChunks(
        `${shown.baselineModel}/${shown.baselineReasoning} -> ` +
          `${shown.draftModel}/${shown.draftReasoning}`,
        columns
      )
    ], rows);
    const confirmRowPages = (columns, rows) => renderedPages(expectedChunks(
      `> ${AGENT_NAMES[0]}: Model ${shown.draftModel} | Reasoning ${shown.draftReasoning}`,
      columns
    ), rows);
    const confirmNamePages = (columns, rows) => renderedPages(expectedChunks(
      `> Save custom preset: ${shown.customName}`,
      columns
    ), rows);
    const listPages = expectedPresetPages({
      name: shown.presetName,
      kind: "custom",
      active: false
    }, 80, 23).map((page) => `Presets:\n${page}`);
    const detailPages = chunkPages([
      "> Edit",
      ...expectedChunks(`Preset:${shown.presetName}`, 80),
      "[custom]"
    ], 24);
    const actions = [DOWN, DOWN];
    const expectedFrames = new Map();
    const addCapture = (action, capture, frame, rows) => {
      assert.equal(expectedFrames.has(capture), false, `duplicate expected frame: ${capture}`);
      expectedFrames.set(capture, { frame, rows });
      actions.push({
        ...action,
        capture,
        ...((action.ready || action.resize)
          ? { ready: action.ready ?? ((current) => current === frame) }
          : {})
      });
    };
    const addDown = (capture, frame, rows) =>
      addCapture({ key: DOWN }, capture, frame, rows);
    const addPages = (prefix, pages, start, rows) => {
      for (let page = start; page < pages.length; page += 1) {
        addDown(`${prefix}-${page}`, pages[page], rows);
      }
    };

    addCapture(
      { key: DOWN, ready: (frame) => frame.includes("[custom]") },
      "review-list-custom-0",
      listPages[0],
      24
    );
    addPages("review-list-custom", listPages, 1, 24);
    addCapture({ key: ENTER }, "review-detail-edit-0", detailPages[0], 24);
    addPages("review-detail-edit", detailPages, 1, 24);
    addDown("review-detail-apply", "> Apply", 24);

    const diff80 = diffPages(80, 24);
    addCapture({ key: ENTER }, "review-diff-80-0", diff80[0], 24);
    addPages("review-diff-80", diff80, 1, 24);
    addDown("review-diff-80-continue", "> Continue", 24);
    addDown("review-diff-80-wrap", diff80[0], 24);

    const diff3 = diffPages(10, 3);
    addCapture({ resize: [10, 3] }, "review-diff-3-0", diff3[0], 3);
    addPages("review-diff-3", diff3, 1, 3);
    addDown("review-diff-3-continue", "> Continue", 3);
    addDown("review-diff-3-wrap", diff3[0], 3);
    const diffPivot = Math.min(3, diff3.length - 1);
    addPages("review-diff-3-pivot", diff3.slice(0, diffPivot + 1), 1, 3);

    const diff4 = diffPages(10, 4);
    const diff4Pivot = Math.min(diffPivot, diff4.length - 1);
    addCapture(
      { resize: [10, 4] },
      `review-diff-4-resize-${diff4Pivot}`,
      diff4[diff4Pivot],
      4
    );
    addPages("review-diff-4-tail", diff4, diff4Pivot + 1, 4);
    addDown("review-diff-4-continue", "> Continue", 4);
    addDown("review-diff-4-wrap", diff4[0], 4);
    addPages("review-diff-4-head", diff4.slice(0, diff4Pivot + 1), 1, 4);

    const diff80Clamp = Math.min(diff4Pivot, diff80.length - 1);
    addCapture(
      { resize: [80, 24] },
      `review-diff-80-clamp-${diff80Clamp}`,
      diff80[diff80Clamp],
      24
    );
    addPages("review-diff-80-after-clamp", diff80, diff80Clamp + 1, 24);
    addDown("review-diff-80-final-continue", "> Continue", 24);
    actions.push({ key: ENTER });
    actions.push({ key: "\u001b[A" });
    actions.push({ key: ENTER });
    actions.push({ key: customName });

    const confirm80Rows = confirmRowPages(80, 24);
    const confirm80Name = confirmNamePages(80, 24);
    addCapture({ key: ENTER }, "review-confirm-80-apply", "> Apply", 24);
    addDown("review-confirm-80-cancel", "> Cancel", 24);
    addDown("review-confirm-80-row-0", confirm80Rows[0], 24);
    addPages("review-confirm-80-row", confirm80Rows, 1, 24);
    addDown("review-confirm-80-name-0", confirm80Name[0], 24);
    addPages("review-confirm-80-name", confirm80Name, 1, 24);
    addDown("review-confirm-80-apply-cycle", "> Apply", 24);
    addDown("review-confirm-80-cancel-cycle", "> Cancel", 24);
    addDown("review-confirm-80-preview", confirm80Rows[0], 24);
    actions.push({ key: ENTER, deferNoop: true });
    addCapture(
      { key: DOWN, ready: (frame) => frame === confirm80Rows[1] },
      "review-confirm-80-preview-next",
      confirm80Rows[1],
      24
    );

    const confirm3Rows = confirmRowPages(10, 3);
    const confirm3Name = confirmNamePages(10, 3);
    addCapture({ resize: [10, 3] }, "review-confirm-3-resize-1", confirm3Rows[1], 3);
    addPages("review-confirm-3-row", confirm3Rows, 2, 3);
    addDown("review-confirm-3-name-0", confirm3Name[0], 3);
    addPages("review-confirm-3-name", confirm3Name, 1, 3);
    addDown("review-confirm-3-apply", "> Apply", 3);
    addDown("review-confirm-3-cancel", "> Cancel", 3);
    addDown("review-confirm-3-row-0", confirm3Rows[0], 3);
    const confirmPivot = Math.min(3, confirm3Rows.length - 1);
    addPages(
      "review-confirm-3-pivot",
      confirm3Rows.slice(0, confirmPivot + 1),
      1,
      3
    );

    const confirm4Rows = confirmRowPages(10, 4);
    const confirm4Name = confirmNamePages(10, 4);
    const confirm4Pivot = Math.min(confirmPivot, confirm4Rows.length - 1);
    addCapture(
      { resize: [10, 4] },
      `review-confirm-4-resize-${confirm4Pivot}`,
      confirm4Rows[confirm4Pivot],
      4
    );
    addPages("review-confirm-4-row-tail", confirm4Rows, confirm4Pivot + 1, 4);
    addDown("review-confirm-4-name-0", confirm4Name[0], 4);
    addPages("review-confirm-4-name", confirm4Name, 1, 4);
    addDown("review-confirm-4-apply", "> Apply", 4);
    addDown("review-confirm-4-cancel", "> Cancel", 4);
    addDown("review-confirm-4-row-0", confirm4Rows[0], 4);
    addPages(
      "review-confirm-4-row-head",
      confirm4Rows.slice(0, confirm4Pivot + 1),
      1,
      4
    );

    const confirm80Pivot = Math.min(confirm4Pivot, confirm80Rows.length - 1);
    addCapture(
      { resize: [80, 24] },
      `review-confirm-80-clamp-${confirm80Pivot}`,
      confirm80Rows[confirm80Pivot],
      24
    );
    addPages(
      "review-confirm-80-final-row",
      confirm80Rows,
      confirm80Pivot + 1,
      24
    );
    addDown("review-confirm-80-final-name-0", confirm80Name[0], 24);
    addPages("review-confirm-80-final-name", confirm80Name, 1, 24);
    addDown("review-confirm-80-final-apply", "> Apply", 24);
    addDown("review-confirm-80-final-cancel", "> Cancel", 24);
    actions.push({ key: ENTER });

    const result = await runPty(fixture, harness, actions, {
      columns: 80,
      rows: 24,
      tracked: trackedFiles(fixture),
      timeout: 45_000
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    assert.equal(frames.size, expectedFrames.size);
    for (const [capture, { frame, rows }] of expectedFrames) {
      const actual = capturedFrame(frames, capture);
      assert.equal(actual, frame, capture);
      assert.ok(actual.split("\n").length <= rows, `${capture} physical rows`);
    }
    assert.ok(capturedFrame(
      frames,
      `review-list-custom-${listPages.length - 1}`
    ).split("\n").includes("[custom]"), "normal-height custom marker stays atomic");
    assert.equal(result.harness.applyCount, 0);
    assert.deepEqual(result.harness.changes, { agents: 0, receipt: 0, custom: 0 });
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("real CLI rejects hostile Apply-time catalog drift after cleanup without writes", async (t) => {
  const hostileModel =
    "drift\\\\model\u0000\n\r\t\u001b]0;OSC\u0007\u001b[31mCSI\u001b[0m\u202eMODEL";
  const hostileReasoning =
    "reason\u007f\u0080\u009f\u061c\u200e\u200f\u2028\u2029\u202a\u2066\u2069END";
  const hostileCatalog = [{ model: hostileModel, efforts: [hostileReasoning] }];
  const replacementCatalog = [{ model: "replacement-model", efforts: ["safe"] }];
  const baseline = Object.fromEntries(AGENT_NAMES.map((name) => [
    name,
    { model: hostileModel, reasoning: hostileReasoning }
  ]));
  const fixture = await setupFixture({
    baselineMatrix: baseline,
    catalog: hostileCatalog,
    catalogSequence: [hostileCatalog, replacementCatalog]
  });
  try {
    try {
      loadLockCapability();
      await classifyLocalFilesystem(fixture.home);
    } catch (error) {
      if (!(error instanceof TransactionLockError)) throw error;
      t.skip(`native transaction mutation unavailable: ${error?.code ?? error?.message}`);
      return;
    }
    const tracked = trackedFiles(fixture);
    const before = await trackedHashes(tracked);
    const editCurrentFrame = "Presets:\n> Edit current\n[current]";
    const detailEditFrame = "> Edit\nPreset:Edit current\n[current]";
    const diffContinueFrame = [
      "csx setup",
      "Screen: diff",
      "",
      "Review selected changes:",
      "  No agent model changes.",
      "> Continue",
      "Enter toggles/continues  Esc Edit"
    ].join("\n");
    const confirmApplyFrame = [
      "csx setup",
      "Screen: confirm",
      "",
      "Final setup preview:",
      "  No agent model changes.",
      "> Apply",
      "  Cancel"
    ].join("\n");
    const actions = [
      DOWN,
      DOWN,
      {
        key: DOWN,
        capture: "drift-edit-current",
        ready: (frame) => frame === editCurrentFrame
      },
      {
        key: ENTER,
        capture: "drift-detail-edit",
        ready: (frame) => frame === detailEditFrame
      },
      {
        key: DOWN,
        capture: "drift-detail-apply",
        ready: (frame) => frame === "> Apply"
      },
      {
        key: ENTER,
        capture: "drift-diff-continue",
        ready: (frame) => frame === diffContinueFrame
      },
      {
        key: ENTER,
        capture: "drift-confirm-apply",
        ready: (frame) => frame === confirmApplyFrame
      },
      { key: ENTER }
    ];
    const result = await runPty(fixture, cli, actions, {
      columns: 80,
      rows: 24,
      timeout: 20_000
    });
    assert.equal(result.code, 1, result.output);
    assert.equal(await readFile(fixture.catalogRequestPath, "utf8"), "2\n", result.output);
    assert.deepEqual(await trackedHashes(tracked), before);
    const frames = capturedFrames(result);
    assert.deepEqual([...frames], [
      ["drift-edit-current", editCurrentFrame],
      ["drift-detail-edit", detailEditFrame],
      ["drift-detail-apply", "> Apply"],
      ["drift-diff-continue", diffContinueFrame],
      ["drift-confirm-apply", confirmApplyFrame]
    ]);

    const alternateLeft = result.output.lastIndexOf("\u001b[?1049l");
    const cursorShown = result.output.lastIndexOf("\u001b[?25h", alternateLeft);
    const errorStart = result.output.lastIndexOf("csx: ");
    assert.ok(cursorShown >= 0 && cursorShown < alternateLeft, result.output);
    assert.ok(alternateLeft < errorStart, result.output);
    const rawMessage =
      `${AGENT_NAMES[0]} uses unavailable model/effort pair ` +
      `${hostileModel}/${hostileReasoning}.`;
    const errorEnd = result.output.indexOf("\n", errorStart);
    const errorLine = result.output.slice(errorStart, errorEnd).replace(/\r/g, "");
    assert.equal(errorLine, `csx: ${expectedVisibleText(rawMessage)}`);
    assert.equal(
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u
        .test(errorLine),
      false
    );
    for (const injected of [
      "\u001b]0;OSC\u0007",
      "\u001b[31mCSI\u001b[0m",
      "\u061c",
      "\u200e",
      "\u200f",
      "\u2028",
      "\u2029",
      "\u202a",
      "\u202e",
      "\u2066",
      "\u2069"
    ]) {
      assert.equal(
        result.output.includes(injected),
        false,
        `raw drift injection ${JSON.stringify(injected)}`
      );
    }
    assert.equal(result.output.includes("Updated global csx setup."), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("every Low/Medium/High/custom/Edit-current start edits and applies through a real PTY", async () => {
  const cases = [
    ["Low", 0, false, 8],
    ["Medium", 1, false, 7],
    ["High", 2, false, 1],
    ["Saved custom", 3, true, 8],
    ["Edit current", 3, false, 1]
  ];
  for (const [label, listIndex, withCustom, expectedChanges] of cases) {
    const fixture = await setupFixture();
    try {
      if (withCustom) {
        await writeFile(fixture.customPath, `${JSON.stringify({
          version: 1,
          presets: { Team: presetMatrix("Low") }
        })}\n`);
      }
      const name = `${label.replaceAll(" ", "-")}-final`;
      const actions = [
        ...repeat(DOWN, listIndex), ENTER,
        ENTER,
        RIGHT,
        ...repeat(DOWN, AGENT_NAMES.length * 2), ENTER,
        ...repeat(DOWN, expectedChanges), ENTER,
        DOWN, ENTER,
        name, ENTER,
        ENTER
      ];
      const result = await runPty(fixture, cli, actions);
      assert.equal(result.code, 0, `${label}: ${result.output}`);
      assert.match(result.output, /Save this full matrix as a global custom preset/);
      assert.match(result.output, /Updated global csx setup/);
      const custom = JSON.parse(await readFile(fixture.customPath, "utf8"));
      assert.ok(custom.presets[name], `${label}: custom preset was not saved`);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("project setup through a PTY leaves the unrelated global Codex home untouched", async () => {
  const fixture = await setupFixture({ scope: "project" });
  try {
    const actions = [
      ...repeat(DOWN, 3), ENTER,
      DOWN, ENTER,
      ENTER,
      ENTER
    ];
    const result = await runPty(fixture, cli, actions);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Updated project csx setup/);
    await assert.rejects(readFile(fixture.customPath));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("detail Cancel action calls Apply zero times and preserves agent, receipt, and custom hashes", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    await writeFile(fixture.customPath, `${JSON.stringify({
      version: 1,
      presets: { Team: presetMatrix("Low") }
    })}\n`);
    const result = await runPty(fixture, harness, [ENTER, DOWN, DOWN, ENTER], {
      tracked: trackedFiles(fixture)
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Setup cancelled/);
    assert.match(result.output, /\u001b\[\?25h\u001b\[\?1049l/);
    assert.deepEqual(result.harness, {
      ok: true,
      result: { cancelled: true },
      applyCount: 0,
      changes: { agents: 0, receipt: 0, custom: 0 },
      hashesUnchanged: true
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("top-level Esc separately cancels without Apply or file changes", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const result = await runPty(fixture, harness, [ESC], {
      tracked: trackedFiles(fixture)
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Setup cancelled/);
    assert.match(result.output, /\u001b\[\?25h\u001b\[\?1049l/);
    assert.deepEqual(result.harness, {
      ok: true,
      result: { cancelled: true },
      applyCount: 0,
      changes: { agents: 0, receipt: 0, custom: 0 },
      hashesUnchanged: true
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("tiny PTY resize uses current frames to keep edit fields reachable and focus stable", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const actions = [
      { key: DOWN },
      { key: DOWN },
      { key: ENTER },
      { key: ENTER, capture: "edit-0" },
      ...Array.from({ length: AGENT_NAMES.length * 2 }, (_, index) => ({
        key: DOWN,
        capture: `edit-${index + 1}`
      })),
      {
        resize: [80, 24],
        capture: "edit-normal",
        ready: (frame) => frame.includes("Screen: edit") && frame.includes("> Continue to diff")
      },
      { key: ESC },
      { key: ESC },
      { key: ESC }
    ];
    const result = await runPty(fixture, harness, actions, {
      columns: 24,
      rows: 3,
      tracked: trackedFiles(fixture)
    });
    assert.equal(result.code, 0, result.output);
    const frames = capturedFrames(result);
    for (const [index, agent] of AGENT_NAMES.entries()) {
      const pair = fixture.installedMatrix[agent];
      assert.equal(compactFrame(capturedFrame(frames, `edit-${index * 2}`)), `>Model:${pair.model}`);
      assert.equal(compactFrame(capturedFrame(frames, `edit-${index * 2 + 1}`)), `>Reasoning:${pair.reasoning}`);
    }
    assert.equal(compactFrame(capturedFrame(frames, "edit-16")), "> Continue to diff");
    assert.match(capturedFrame(frames, "edit-normal"), /> Continue to diff/);
    assert.equal(result.harness.applyCount, 0);
    assert.equal(result.harness.hashesUnchanged, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("stale catalog-invalid baseline keeps mandatory repair selected, rejects exclusion, then applies", async () => {
  const fixture = await setupFixture();
  try {
    const stalePath = join(fixture.agentsRoot, `${AGENT_NAMES[0]}.toml`);
    const stale = await readFile(stalePath, "utf8");
    await writeFile(stalePath, stale.replace(
      /model_reasoning_effort\s*=\s*"[^"]+"/,
      'model_reasoning_effort = "catalog-invalid"'
    ));
    const actions = [
      ...repeat(DOWN, 2), ENTER,
      DOWN, ENTER,
      ENTER,
      DOWN, ENTER,
      ENTER,
      ENTER
    ];
    const result = await runPty(fixture, harness, actions, {
      tracked: trackedFiles(fixture)
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /\[mandatory repair\]/);
    assert.match(result.output, /mandatory repair and cannot be excluded/);
    assert.equal(result.harness.applyCount, 1);
    assert.equal(result.harness.changes.agents, 1);
    assert.equal(result.harness.changes.receipt, 1);
    assert.match(await readFile(stalePath, "utf8"), /model_reasoning_effort = "low"/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("setup reports raw Ctrl+D from a real PTY as EOF with cleanup", async () => {
  const fixture = await setupFixture({ fixtureOnly: true });
  try {
    const result = await runPty(fixture, cli, ["\u0004"]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Aborted with Ctrl\+D/);
    assert.match(result.output, /\u001b\[\?25h\u001b\[\?1049l/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function repeat(value, count) {
  return Array.from({ length: count }, () => value);
}

function run(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function setupFixture({
  scope = "global",
  fixtureOnly = false,
  baselineMatrix,
  catalog = [
    { model: "gpt-5.6-sol", efforts: ["low", "medium", "high", "xhigh"] },
    { model: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh"] },
    { model: "gpt-5.6-terra", efforts: ["low", "medium", "high", "xhigh"] }
  ],
  catalogSequence = [catalog]
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "csx-pty-"));
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  if (scope === "global") await mkdir(home, { recursive: true });
  const agentsRoot = scope === "project" ? join(directory, ".codex", "agents") : join(home, "agents");
  const receiptPath = scope === "project"
    ? join(directory, ".codex", ".csx-install-receipt.json")
    : join(home, ".csx-install-receipt.json");
  if (fixtureOnly) {
    await cp(join(root, "payload", "agents"), agentsRoot, { recursive: true });
    const files = AGENT_NAMES.map((name) => join(agentsRoot, `${name}.toml`));
    await writeFile(receiptPath, `${JSON.stringify({
      root: scope === "project" ? directory : home,
      files
    })}\n`);
  } else {
    await install({
      scope,
      projectRoot: scope === "project" ? directory : undefined,
      env: { HOME: directory, CODEX_HOME: home }
    });
  }
  if (baselineMatrix) {
    await Promise.all(AGENT_NAMES.map(async (name) => {
      const path = join(agentsRoot, `${name}.toml`);
      const text = await readFile(path, "utf8");
      const pair = baselineMatrix[name];
      assert.ok(pair && typeof pair.model === "string" && typeof pair.reasoning === "string");
      const withModel = replaceFixtureAssignment(text, "model", pair.model);
      await writeFile(path, replaceFixtureAssignment(
        withModel,
        "model_reasoning_effort",
        pair.reasoning
      ));
    }));
  }
  const installedMatrix = Object.fromEntries(await Promise.all(AGENT_NAMES.map(async (name) => {
    const text = await readFile(join(agentsRoot, `${name}.toml`), "utf8");
    return [name, {
      model: /(?:^|\n)model\s*=\s*"([^"]+)"/.exec(text)[1],
      reasoning: /(?:^|\n)model_reasoning_effort\s*=\s*"([^"]+)"/.exec(text)[1]
    }];
  })));
  const server = join(bin, "codex.mjs");
  const catalogRequestPath = join(directory, "catalog-requests");
  await writeFile(catalogRequestPath, "0\n");
  await mkdir(bin);
  await writeFile(server, `import { readFileSync, writeFileSync } from "node:fs";\nimport readline from "node:readline";\nconst catalogs = ${JSON.stringify(catalogSequence)};\nconst requestPath = ${JSON.stringify(catalogRequestPath)};\nreadline.createInterface({ input: process.stdin }).on("line", (line) => { const request = JSON.parse(line); if (request.id && request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n"); if (request.id && request.method === "model/list") { const count = Number(readFileSync(requestPath, "utf8").trim()); const catalog = catalogs[Math.min(count, catalogs.length - 1)]; writeFileSync(requestPath, String(count + 1) + "\\n"); process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { data: catalog.map(({ model, efforts }) => ({ model, hidden: false, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })) })), nextCursor: null } }) + "\\n"); } });\n`);
  const command = process.platform === "win32" ? join(bin, "codex.cmd") : join(bin, "codex");
  await writeFile(command, process.platform === "win32"
    ? `@node "${server}"\r\n`
    : `#!/bin/sh\nexec node "${server}"\n`, { mode: 0o755 });
  return {
    root: directory,
    home,
    bin,
    agentsRoot,
    receiptPath,
    customPath: join(home, "csx-model-presets.json"),
    catalogRequestPath,
    installedMatrix
  };
}

function replaceFixtureAssignment(text, key, value) {
  let replacements = 0;
  const pattern = new RegExp(`(^|\\n)${key}\\s*=\\s*"[^"]+"`, "g");
  const updated = text.replace(pattern, (_assignment, prefix) => {
    replacements += 1;
    return `${prefix}${key} = ${JSON.stringify(value)}`;
  });
  assert.equal(replacements, 1, `fixture must contain exactly one ${key} assignment`);
  return updated;
}

function trackedFiles(fixture) {
  return {
    agents: AGENT_NAMES.map((name) => join(fixture.agentsRoot, `${name}.toml`)),
    receipt: [fixture.receiptPath],
    custom: [fixture.customPath]
  };
}

async function trackedHashes(groups) {
  return Object.fromEntries(await Promise.all(Object.entries(groups).map(async ([group, paths]) => [
    group,
    Object.fromEntries(await Promise.all(paths.map(async (path) => [
      path,
      await readFile(path).then(
        (value) => createHash("sha256").update(value).digest("hex"),
        (error) => error?.code === "ENOENT" ? null : Promise.reject(error)
      )
    ])))
  ])));
}

function capturedFrames(result) {
  const frames = new Map();
  for (const { capture, frame } of result.snapshots) {
    if (!capture) continue;
    assert.equal(frames.has(capture), false, `duplicate current-frame capture: ${capture}`);
    assert.notEqual(frame, "", `empty current-frame capture: ${capture}`);
    frames.set(capture, frame);
  }
  return frames;
}

function capturedFrame(frames, name) {
  assert.equal(frames.has(name), true, `missing current-frame capture: ${name}`);
  return frames.get(name);
}

function compactFrame(frame) {
  return frame.replace(/\n/g, "");
}

function expectedVisibleText(value) {
  let output = "";
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    if (character === "\\") output += "\\\\";
    else if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      output += `\\x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      output += `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    } else output += character;
  }
  return output;
}

function boundaryCharacterWidth(character) {
  const codePoint = character.codePointAt(0);
  return codePoint >= 0xac00 && codePoint <= 0xd7a3 ? 2 : 1;
}

function expectedChunks(text, columns) {
  const chunks = [];
  let chunk = "";
  let width = 0;
  for (const character of text) {
    const nextWidth = boundaryCharacterWidth(character);
    if (chunk && width + nextWidth > columns) {
      chunks.push(chunk);
      chunk = "";
      width = 0;
    }
    chunk += character;
    width += nextWidth;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}

function expectedPages(text, columns, rows) {
  const chunks = expectedChunks(text, columns);
  return chunkPages(chunks, rows);
}

function chunkPages(chunks, rows) {
  return Array.from({ length: Math.ceil(chunks.length / rows) }, (_, page) =>
    chunks.slice(page * rows, (page + 1) * rows).join("\n"));
}

function expectedPresetPages({ name, kind, active }, columns, rows) {
  const chunks = [
    ...expectedChunks(`> ${name}`, columns),
    ...(kind === "custom" ? ["[custom]"] : kind === "current" ? ["[current]"] : []),
    ...(active ? ["[active]"] : [])
  ];
  return chunkPages(chunks, rows);
}

function currentAlternateFrame(output) {
  const alternateStart = output.lastIndexOf("\u001b[?1049h");
  if (alternateStart < 0) return "";
  const alternate = output.slice(alternateStart);
  const synchronizedStartToken = "\u001b[?2026h";
  const synchronizedEndToken = "\u001b[?2026l";
  const synchronizedEnd = alternate.lastIndexOf(synchronizedEndToken);
  if (synchronizedEnd < 0) return "";
  const synchronizedStart = alternate.lastIndexOf(synchronizedStartToken, synchronizedEnd);
  if (synchronizedStart < 0) return "";
  let frame = alternate.slice(
    synchronizedStart + synchronizedStartToken.length,
    synchronizedEnd
  );
  const cursorHome = frame.lastIndexOf("\u001b[G");
  if (cursorHome >= 0) frame = frame.slice(cursorHome + "\u001b[G".length);
  return frame
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function runPty(fixture, program, actions, options = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = pty.spawn(process.execPath, program === cli ? [cli, "setup"] : [program], {
      cwd: fixture.root,
      cols: options.columns ?? 100,
      rows: options.rows ?? 30,
      env: {
        ...process.env,
        HOME: fixture.root,
        CODEX_HOME: fixture.home,
        PATH: `${fixture.bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        ...(program === harness ? { CSX_SETUP_TUI_HARNESS: "1" } : {}),
        ...(options.tracked ? { CSX_HARNESS_TRACKED: JSON.stringify(options.tracked) } : {}),
        ...(options.expectedRaw ? {
          CSX_HARNESS_EXPECT_RAW: JSON.stringify(options.expectedRaw)
        } : {})
      }
    });
    let output = "";
    let started = false;
    let exited = false;
    let drivePromise;
    let outputRevision = 0;
    const snapshots = [];
    const timer = setTimeout(() => {
      rejectResult(new Error(`PTY timed out before exit:\n${output}`));
      child.kill();
    }, options.timeout ?? 15_000);
    child.onData((data) => {
      output += data;
      outputRevision += 1;
      const tinyList = output.includes("Presets:") && output.includes("> Low");
      if (!started && (output.includes("Screen: list") || tinyList)) {
        started = true;
        drivePromise = drive();
        void drivePromise.catch(() => child.kill());
      }
    });
    child.onExit(({ exitCode }) => {
      exited = true;
      clearTimeout(timer);
      void Promise.resolve(drivePromise).then(() => {
        const match = /HARNESS_RESULT ([^\r\n]+)/.exec(output);
        resolveResult({
          code: exitCode,
          output,
          snapshots,
          harness: match ? JSON.parse(match[1]) : undefined
        });
      }, rejectResult);
    });

    async function drive() {
      await waitForCompleteFrame();
      snapshots.push({
        capture: options.initialCapture,
        frame: currentAlternateFrame(output)
      });
      for (const [index, action] of actions.entries()) {
        const deferRender = typeof action !== "string" && action.deferRender;
        const deferNoop = typeof action !== "string" && action.deferNoop;
        const nextAction = actions[index + 1];
        const followedByReadyKey =
          typeof nextAction !== "string" &&
          nextAction?.key !== undefined &&
          nextAction.resize === undefined &&
          typeof nextAction.ready === "function";
        if (deferRender && (
          !action.resize ||
          action.key !== undefined ||
          action.capture !== undefined ||
          action.ready !== undefined ||
          !followedByReadyKey
        )) {
          throw new Error(
            "deferRender requires an intermediate resize followed by a readiness-checked action"
          );
        }
        if (deferNoop && (
          action.key === undefined ||
          action.resize !== undefined ||
          action.capture !== undefined ||
          action.ready !== undefined ||
          !followedByReadyKey
        )) {
          throw new Error(
            "deferNoop requires an uncaptured key followed by a readiness-checked action"
          );
        }
        const previousRevision = outputRevision;
        const previousFrame = currentAlternateFrame(output);
        const key = typeof action === "string" ? action : action.key;
        if (key !== undefined) {
          child.write(key);
        } else if (action.resize) {
          child.resize(...action.resize);
        }
        if (deferRender || deferNoop) continue;
        const ready = typeof action === "string" ? undefined : action.ready;
        await waitForRenderedOutput(
          previousRevision,
          previousFrame,
          `${index}:${typeof action === "string" ? "" : action.capture ?? ""}:` +
            (key ?? `resize ${action.resize.join("x")}`),
          ready,
          index === actions.length - 1
        );
        snapshots.push({
          capture: typeof action === "string" ? undefined : action.capture,
          frame: currentAlternateFrame(output)
        });
      }
    }

    async function waitForCompleteFrame() {
      const deadline = Date.now() + 2_000;
      while (!exited && currentAlternateFrame(output) === "") {
        if (Date.now() >= deadline) {
          throw new Error(`PTY produced no complete synchronized frame:\n${output}`);
        }
        await delay(5);
      }
      if (exited) {
        throw new Error(`PTY exited before its initial synchronized frame:\n${output}`);
      }
    }

    async function waitForRenderedOutput(
      previousRevision,
      previousFrame,
      action,
      ready,
      finalAction
    ) {
      const deadline = Date.now() + 2_000;
      while (!exited) {
        const frame = currentAlternateFrame(output);
        if (
          outputRevision !== previousRevision &&
          frame !== previousFrame &&
          (!ready || ready(frame))
        ) {
          return;
        }
        if (Date.now() >= deadline) {
          throw new Error(`PTY action produced no rendered output (${JSON.stringify(action)}):\n${output}`);
        }
        await delay(5);
      }
      if (!finalAction) {
        throw new Error(`PTY exited before action rendered (${JSON.stringify(action)}):\n${output}`);
      }
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
