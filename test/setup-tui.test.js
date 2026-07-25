import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import React from "react";
import { render as renderInk, cleanup as cleanupInk } from "ink-testing-library";
import { AGENT_NAMES } from "../lib/presets.js";
import { escapeTerminalText } from "../lib/terminal-text.js";
import {
  SetupTui,
  createSetupState,
  invalidRows,
  matchingPresetNames,
  matrixMatches,
  reduceSetupState,
  renderSetupState,
  runSetupTui,
  validateCustomPresetName
} from "../lib/setup-tui.js";

const h = React.createElement;
const MATRIX_COMPACT_TEST_ITEMS = AGENT_NAMES.length * 3;
const UNSAFE_PRESENTATION = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const catalog = [
  { model: "luna", efforts: ["low", "high"] },
  { model: "terra", efforts: ["low", "high", "xhigh"] },
  { model: "sol", efforts: ["low", "high", "xhigh"] }
];

function matrix(model = "luna", reasoning = "low") {
  return Object.fromEntries(AGENT_NAMES.map((name) => [name, { model, reasoning }]));
}

function clone(value) {
  return structuredClone(value);
}

function key(state, value) {
  return reduceSetupState(state, { type: "KEY", key: value });
}

function enter(state) {
  return key(state, { return: true });
}

function frameText(state) {
  return renderSetupState(state).replaceAll("\n", "");
}

function collectCompactFrames(initialState, indexKey, pageKey) {
  const frames = [];
  let state = initialState;
  const start = `${state[indexKey]}:${state[pageKey]}`;
  do {
    frames.push({
      index: state[indexKey],
      page: state[pageKey],
      frame: renderSetupState(state)
    });
    state = key(state, { downArrow: true });
    assert.ok(frames.length < 1000, "compact traversal must wrap");
  } while (`${state[indexKey]}:${state[pageKey]}` !== start);
  return frames;
}

function collectPageFrames(initialState, pageKey) {
  const frames = [];
  let state = initialState;
  const start = state[pageKey];
  do {
    frames.push({ page: state[pageKey], frame: renderSetupState(state) });
    state = key(state, { downArrow: true });
    assert.ok(frames.length < 1000, "page traversal must wrap");
  } while (state[pageKey] !== start);
  return frames;
}

function decodeTerminalText(value) {
  let result = "";
  for (let index = 0; index < value.length;) {
    if (value[index] !== "\\") {
      result += value[index];
      index += 1;
    } else if (value[index + 1] === "\\") {
      result += "\\";
      index += 2;
    } else if (value[index + 1] === "x") {
      result += String.fromCodePoint(Number.parseInt(value.slice(index + 2, index + 4), 16));
      index += 4;
    } else {
      result += String.fromCodePoint(Number.parseInt(value.slice(index + 2, index + 6), 16));
      index += 6;
    }
  }
  return result;
}

function expectedCharacterWidth(character) {
  if (/\p{Mark}/u.test(character)) return 0;
  const codePoint = character.codePointAt(0);
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) ? 2 : 1;
}

function expectedChunks(text, columns) {
  const chunks = [];
  let chunk = "";
  let width = 0;
  for (const character of text) {
    const nextWidth = expectedCharacterWidth(character);
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
  return Array.from({ length: Math.ceil(chunks.length / rows) }, (_, page) =>
    chunks.slice(page * rows, (page + 1) * rows).join("\n"));
}

function expectedPresetPages(preset, active, columns, rows) {
  const chunks = [
    ...expectedChunks(`> ${preset.name}`, columns),
    ...(preset.kind === "custom" ? ["[custom]"] : preset.kind === "current" ? ["[current]"] : []),
    ...(active ? ["[active]"] : [])
  ];
  return Array.from({ length: Math.ceil(chunks.length / rows) }, (_, page) =>
    chunks.slice(page * rows, (page + 1) * rows).join("\n"));
}

function assertCurrentPages(frames, index, expected, prefix = "") {
  const actual = frames.filter((frame) => frame.index === index).sort((left, right) => left.page - right.page);
  assert.equal(actual.length, expected.length);
  expected.forEach((page, indexWithinItem) => {
    assert.equal(actual[indexWithinItem].frame, `${prefix}${page}`, `current frame page ${indexWithinItem}`);
  });
}

function assertNoInjectedControls(frame) {
  assert.doesNotMatch(frame.replaceAll("\n", ""), UNSAFE_PRESENTATION);
}

function baseState(options = {}) {
  const baselineMatrix = options.baselineMatrix ?? matrix();
  return createSetupState({
    baselineMatrix,
    catalog,
    presets: options.presets ?? [
      { name: "Low", matrix: matrix("luna", "low") },
      { name: "Medium", matrix: matrix("terra", "high") },
      { name: "High", matrix: matrix("sol", "xhigh") },
      { name: "Saved", kind: "custom", matrix: matrix("terra", "low") }
    ],
    columns: options.columns ?? 100,
    rows: options.rows ?? 40
  });
}

test("exact eight-role matching rejects partial, missing, extra, and one-pair mismatch", () => {
  const exact = matrix();
  assert.equal(matrixMatches(exact, clone(exact)), true);
  const mismatch = clone(exact);
  mismatch[AGENT_NAMES[0]].reasoning = "high";
  assert.equal(matrixMatches(exact, mismatch), false);
  const missing = clone(exact);
  delete missing[AGENT_NAMES[0]];
  assert.equal(matrixMatches(exact, missing), false);
  const extra = { ...clone(exact), ninth: { model: "luna", reasoning: "low" } };
  assert.equal(matrixMatches(exact, extra), false);
  assert.equal(matrixMatches(exact, { [AGENT_NAMES[0]]: exact[AGENT_NAMES[0]] }), false);
});

test("all duplicate exact preset matches are active and derive only from immutable baseline", () => {
  const baseline = matrix();
  const presets = [
    { name: "Low", matrix: clone(baseline) },
    { name: "Twin", kind: "custom", matrix: clone(baseline) },
    { name: "Other", matrix: matrix("terra", "low") }
  ];
  assert.deepEqual(matchingPresetNames(baseline, presets), ["Low", "Twin"]);
  let state = createSetupState({ baselineMatrix: baseline, presets, catalog });
  assert.deepEqual(state.activeEntryIds, ["preset:0", "preset:1"]);
  state = enter(state);
  state = enter(state);
  state = key(state, { rightArrow: true });
  assert.deepEqual(state.activeEntryIds, ["preset:0", "preset:1"]);
  assert.equal(state.baselineMatrix[AGENT_NAMES[0]].model, "luna");
});

test("Low, Medium, High, saved custom, and Edit current all support Edit → role change → diff", () => {
  for (let index = 0; index < 5; index += 1) {
    let state = baseState();
    state = { ...state, listIndex: index };
    state = enter(state);
    assert.equal(state.screen, "detail");
    state = enter(state);
    assert.equal(state.screen, "edit");
    state = key(state, index === 2 ? { leftArrow: true } : { rightArrow: true });
    for (let step = 0; step < AGENT_NAMES.length * 2; step += 1) state = key(state, { downArrow: true });
    state = enter(state);
    assert.equal(state.screen, "diff", `entry ${index}`);
    assert.ok(state.selectedRows.includes(AGENT_NAMES[0]), `entry ${index}`);
  }
});

test("detail Apply works without edits and no-change skips custom screens", () => {
  let state = baseState();
  state = enter(state);
  state = key(state, { downArrow: true });
  state = enter(state);
  assert.equal(state.screen, "diff");
  assert.deepEqual(state.selectedRows, []);
  state = enter(state);
  assert.equal(state.screen, "confirm");
  assert.match(renderSetupState(state), /No agent model changes/);
  state = enter(state);
  assert.equal(state.screen, "applying");
  assert.deepEqual(state.result.selectedAgents, []);
});

test("mandatory repairs are calculated, marked, and cannot be toggled or restored", () => {
  const baseline = matrix();
  baseline[AGENT_NAMES[0]] = { model: "retired", reasoning: "gone" };
  let state = baseState({ baselineMatrix: baseline });
  state = { ...state, listIndex: state.presets.length - 1 };
  state = enter(state);
  state = enter(state);
  state = key(state, { rightArrow: true });
  for (let step = 0; step < AGENT_NAMES.length * 2; step += 1) state = key(state, { downArrow: true });
  state = enter(state);
  assert.equal(state.screen, "diff");
  assert.deepEqual(state.mandatoryRows, [AGENT_NAMES[0]]);
  assert.match(renderSetupState(state), /\[mandatory repair\]/);
  const before = state.selectedRows;
  state = enter(state);
  assert.deepEqual(state.selectedRows, before);
  assert.match(state.error, /cannot be excluded/);
  state = { ...state, diffIndex: 1 };
  state = enter(state);
  assert.notEqual(state.screen, "confirm");
  assert.notEqual(state.draftMatrix[AGENT_NAMES[0]].model, "retired");
});

test("invalid draft is blocked before diff and final catalog revalidation blocks confirm", () => {
  let state = baseState();
  state = enter(state);
  state = enter(state);
  state = {
    ...state,
    draftMatrix: {
      ...state.draftMatrix,
      [AGENT_NAMES[0]]: { model: "missing", reasoning: "none" }
    },
    editIndex: AGENT_NAMES.length * 2
  };
  state = enter(state);
  assert.equal(state.screen, "edit");
  assert.match(state.error, /Repair unavailable/);

  state = baseState();
  state = enter(state);
  state = enter(state);
  state = key(state, { rightArrow: true });
  for (let step = 0; step < AGENT_NAMES.length * 2; step += 1) state = key(state, { downArrow: true });
  state = enter(state);
  state = {
    ...state,
    draftMatrix: {
      ...state.draftMatrix,
      [AGENT_NAMES[0]]: { model: "missing", reasoning: "none" }
    },
    diffIndex: 1
  };
  state = enter(state);
  assert.equal(state.screen, "diff");
  assert.match(state.error, /Final matrix has unavailable/);
  assert.deepEqual(invalidRows(state.draftMatrix, catalog), [AGENT_NAMES[0]]);
});

test("custom name validation rejects blank, reserved, and case-insensitive duplicates", () => {
  assert.match(validateCustomPresetName("  "), /required/);
  for (const name of ["low", "Medium", " HIGH ", "custom"]) assert.match(validateCustomPresetName(name), /reserved/);
  assert.match(validateCustomPresetName(" saved ", ["Saved"]), /already exists/);
  assert.equal(validateCustomPresetName("Team profile", ["Saved"]), null);
});

test("changed flow conditionally accepts a validated custom name before confirm", () => {
  let state = baseState();
  state = enter(state);
  state = enter(state);
  state = key(state, { rightArrow: true });
  for (let step = 0; step < AGENT_NAMES.length * 2; step += 1) state = key(state, { downArrow: true });
  state = enter(state);
  state = { ...state, diffIndex: 1 };
  state = enter(state);
  assert.equal(state.screen, "save-custom-choice");
  state = { ...state, choiceIndex: 0 };
  state = enter(state);
  assert.equal(state.screen, "custom-name");
  for (const letter of "Saved") state = reduceSetupState(state, { type: "KEY", input: letter, key: {} });
  state = enter(state);
  assert.equal(state.screen, "custom-name");
  assert.match(state.error, /already exists/);
  state = reduceSetupState(state, { type: "SET_CUSTOM_NAME", value: "Team profile" });
  state = enter(state);
  assert.equal(state.screen, "confirm");
  assert.equal(state.customPresetName, "Team profile");
});

test("key and Esc transitions honor list/detail/edit/diff boundaries and cancel", () => {
  let state = baseState();
  state = key(state, { downArrow: true });
  assert.equal(state.listIndex, 1);
  state = enter(state);
  assert.equal(state.screen, "detail");
  state = key(state, { escape: true });
  assert.equal(state.screen, "list");
  state = enter(state);
  state = enter(state);
  assert.equal(state.screen, "edit");
  state = key(state, { escape: true });
  assert.equal(state.screen, "detail");
  state = key(state, { escape: true });
  state = key(state, { escape: true });
  assert.deepEqual(state.result, { outcome: "cancel" });
});

test("normal renderer shows all roles/fields and tiny viewport follows focused rows after resize", () => {
  let state = baseState({ rows: 40 });
  let frame = renderSetupState(state);
  for (const name of AGENT_NAMES) assert.match(frame, new RegExp(name));
  assert.match(frame, /Model/);
  assert.match(frame, /Reasoning/);

  state = enter(state);
  state = enter(state);
  state = reduceSetupState(state, { type: "RESIZE", columns: 18, rows: 5 });
  for (let step = 0; step < AGENT_NAMES.length * 2; step += 1) state = key(state, { downArrow: true });
  frame = renderSetupState(state);
  assert.match(frame, /Continue to diff/);
  state = key(state, { upArrow: true });
  frame = renderSetupState(state);
  assert.match(frame, /Reasoning/);
});

test("10×3 list traversal exposes each baseline field and complete preset active marker in its current frame", () => {
  let state = baseState({
    columns: 10,
    rows: 3,
    presets: [
      { name: "Low", matrix: matrix() },
      { name: "Twin profile", kind: "custom", matrix: matrix() },
      { name: "Other", matrix: matrix("terra", "high") }
    ]
  });
  const frames = collectCompactFrames(state, "listCompactIndex", "listCompactPage");
  AGENT_NAMES.forEach((name, index) => {
    const currentFrame = (itemIndex) => frames.find(({ index: savedIndex, page }) => savedIndex === itemIndex && page === 0).frame.replaceAll("\n", "");
    assert.match(currentFrame(index * 3), new RegExp(name), `${name} role frame`);
    assert.match(currentFrame(index * 3 + 1), /Model:luna/, `${name} Model frame`);
    assert.match(currentFrame(index * 3 + 2), /Reasoning:low/, `${name} Reasoning frame`);
  });
  state.presets.forEach(({ id, name }, index) => {
    const itemFrames = frames.filter(({ index: itemIndex }) => itemIndex === AGENT_NAMES.length * 3 + index);
    assert.ok(itemFrames.some(({ frame }) => frame.replaceAll("\n", "").includes(name)), `${name} preset frame`);
    if (state.activeEntryIds.includes(id)) assert.ok(itemFrames.some(({ frame }) => frame.includes("[active]")), `${name} active frame`);
  });
  state = baseState({ columns: 10, rows: 3 });
  state = key(state, { downArrow: true });
  state = enter(state);
  assert.equal(state.selectedPreset, "Medium");
  assert.equal(state.screen, "detail");
});

test("10×3 detail traversal exposes each selected preset field and action in its current frame", () => {
  let state = baseState({ columns: 10, rows: 3 });
  state = key(state, { downArrow: true });
  state = enter(state);
  const frames = collectCompactFrames(state, "detailCompactIndex", "detailCompactPage");
  AGENT_NAMES.forEach((name, index) => {
    const currentFrame = (itemIndex) => frames.find(({ index: savedIndex, page }) => savedIndex === itemIndex && page === 0).frame.replaceAll("\n", "");
    assert.match(currentFrame(index * 3), new RegExp(name), `${name} role frame`);
    assert.match(currentFrame(index * 3 + 1), /Model:terra/, `${name} Model frame`);
    assert.match(currentFrame(index * 3 + 2), /Reasoning:high/, `${name} Reasoning frame`);
  });
  ["Edit", "Apply", "Cancel"].forEach((action, index) => {
    const frame = frames.find(({ index: itemIndex }) => itemIndex === AGENT_NAMES.length * 3 + index);
    assert.match(frame.frame, new RegExp(action), `${action} frame`);
  });
  state = baseState({ columns: 10, rows: 3 });
  state = enter(state);
  state = enter(state);
  assert.equal(state.screen, "edit");
});

test("80×24 → 10×3 edit traversal exposes each complete role, Model, and Reasoning content", () => {
  let state = baseState({ columns: 80, rows: 24 });
  state = enter(state);
  state = enter(state);
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  for (let index = 0; index < AGENT_NAMES.length; index += 1) {
    assert.match(frameText({ ...state, editIndex: index * 2 }), /Model:luna/, `${AGENT_NAMES[index]} Model frame`);
    assert.match(frameText({ ...state, editIndex: index * 2 + 1 }), /Reasoning:low/, `${AGENT_NAMES[index]} Reasoning frame`);
  }
  assert.match(frameText({ ...state, editIndex: AGENT_NAMES.length * 2 }), /Continue to diff/);
});

test("compact focus preserves semantic preset/action selection across resize and supports tiny start", () => {
  let state = baseState({ columns: 10, rows: 3 });
  assert.match(frameText(state), /Low.*\[active\]/);
  state = key(state, { upArrow: true });
  assert.match(frameText(state), /Reasoning:low/);

  state = baseState({ columns: 80, rows: 24 });
  state = key(key(state, { downArrow: true }), { downArrow: true });
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  assert.match(frameText(state), /High/);
  state = reduceSetupState(state, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(state.listIndex, 2);

  state = enter(state);
  assert.equal(state.detailIndex, AGENT_NAMES.length);
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  assert.match(frameText(state), /Edit/);
  state = reduceSetupState(state, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(state.detailIndex, AGENT_NAMES.length);
});

test("10×3 wrapped subpages expose every long ASCII/CJK chunk in list, detail, and edit current frames", () => {
  const longModelA = `shared-model-${"a".repeat(32)}-TAIL-A`;
  const longModelB = `shared-model-${"a".repeat(32)}-TAIL-B`;
  const longReasoningA = `공통추론-${"가나다라마바사".repeat(5)}-꼬리A`;
  const longReasoningB = `공통추론-${"가나다라마바사".repeat(5)}-꼬리B`;
  const baseline = matrix(longModelA, longReasoningA);
  baseline[AGENT_NAMES[1]] = { model: longModelB, reasoning: longReasoningB };
  const asciiName = `shared-custom-${"x".repeat(36)}-NAME-A`;
  const cjkName = `공통사용자설정-${"한글이름".repeat(8)}-이름B`;
  let state = createSetupState({
    baselineMatrix: baseline,
    catalog,
    presets: [
      { name: asciiName, kind: "custom", matrix: baseline },
      { name: cjkName, kind: "custom", matrix: baseline }
    ],
    columns: 10,
    rows: 3
  });

  const listFrames = collectCompactFrames(state, "listCompactIndex", "listCompactPage");
  assertCurrentPages(listFrames, 1, expectedPages(`>Model:${longModelA}`, 10, 3));
  assertCurrentPages(listFrames, 2, expectedPages(`>Reasoning:${longReasoningA}`, 10, 3));
  assertCurrentPages(listFrames, 4, expectedPages(`>Model:${longModelB}`, 10, 3));
  assertCurrentPages(listFrames, 5, expectedPages(`>Reasoning:${longReasoningB}`, 10, 3));
  state.presets.slice(0, 2).forEach((preset, presetIndex) => {
    const expected = expectedPresetPages(preset, true, 10, 2);
    assertCurrentPages(listFrames, AGENT_NAMES.length * 3 + presetIndex, expected, "Presets:\n");
    assert.ok(expected.some((page) => page.includes(presetIndex === 0 ? "NAME-A" : "이름B")));
    assert.ok(expected.some((page) => page.includes("[active]")), `${preset.name} active suffix page`);
  });

  state = enter(state);
  const detailFrames = collectCompactFrames(state, "detailCompactIndex", "detailCompactPage");
  assertCurrentPages(detailFrames, 1, expectedPages(`>Model:${longModelA}`, 10, 3));
  assertCurrentPages(detailFrames, 2, expectedPages(`>Reasoning:${longReasoningA}`, 10, 3));
  state = enter(state);
  const editFrames = collectCompactFrames(state, "editIndex", "editCompactPage");
  assertCurrentPages(editFrames, 0, expectedPages(`>Model:${longModelA}`, 10, 3));
  assertCurrentPages(editFrames, 1, expectedPages(`>Reasoning:${longReasoningA}`, 10, 3));

  state = reduceSetupState(state, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(state.editIndex, 0);
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  const revisited = collectCompactFrames(state, "editIndex", "editCompactPage");
  assertCurrentPages(revisited, 0, expectedPages(`>Model:${longModelA}`, 10, 3));
  state = { ...state, editCompactPage: expectedPages(`>Model:${longModelA}`, 10, 3).length - 1 };
  state = reduceSetupState(state, { type: "RESIZE", columns: 20, rows: 3 });
  assert.notEqual(renderSetupState(state), "");
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  assertCurrentPages(
    collectCompactFrames(state, "editIndex", "editCompactPage"),
    0,
    expectedPages(`>Model:${longModelA}`, 10, 3)
  );
});

test("focused paging follows overflow at 10×4, across 3↔4 resize, and at 80×24", () => {
  const longModel = `model-${"A".repeat(240)}-MODEL-SUFFIX`;
  const longReasoning = `추론-${"가".repeat(160)}-이유-끝`;
  const longName = `profile-${"N".repeat(240)}-NAME-SUFFIX`;
  const longMatrix = matrix(longModel, longReasoning);
  let state = baseState({
    baselineMatrix: longMatrix,
    presets: [{ name: longName, kind: "custom", matrix: longMatrix }],
    columns: 10,
    rows: 4
  });

  let frames = collectCompactFrames(state, "listCompactIndex", "listCompactPage");
  assertCurrentPages(frames, 1, expectedPages(`>Model:${longModel}`, 10, 4));
  assertCurrentPages(frames, 2, expectedPages(`>Reasoning:${longReasoning}`, 10, 4));
  const presetPages = expectedPresetPages(state.presets[0], true, 10, 3);
  assertCurrentPages(frames, MATRIX_COMPACT_TEST_ITEMS, presetPages, "Presets:\n");
  assert.ok(frames.some(({ frame }) => frame.includes("SUFFIX")));
  assert.ok(frames.some(({ frame }) => frame.includes("끝")));
  assert.ok(frames.some(({ frame }) => frame.includes("IX")));
  assert.ok(frames.some(({ frame }) => frame.includes("[custom]")));
  assert.ok(frames.some(({ frame }) => frame.includes("[active]")));

  state = { ...state, listCompactIndex: 2, listCompactPage: 1 };
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 3 });
  assert.equal(state.listCompactIndex, 2);
  assert.equal(state.listCompactPage, 1);
  state = reduceSetupState(state, { type: "RESIZE", columns: 10, rows: 4 });
  assert.equal(state.listCompactIndex, 2);
  assert.equal(state.listCompactPage, 1);
  state = key(state, { upArrow: true });
  assert.equal(state.listCompactIndex, 2);
  assert.equal(state.listCompactPage, 0);
  state = key(state, { upArrow: true });
  assert.equal(state.listCompactIndex, 1);
  assert.ok(state.listCompactPage > 0);

  state = { ...state, listCompactIndex: MATRIX_COMPACT_TEST_ITEMS, listCompactPage: 0, listIndex: 0 };
  state = enter(state);
  frames = collectCompactFrames(state, "detailCompactIndex", "detailCompactPage");
  assertCurrentPages(frames, 1, expectedPages(`>Model:${longModel}`, 10, 4));
  assertCurrentPages(frames, 2, expectedPages(`>Reasoning:${longReasoning}`, 10, 4));
  assert.ok(frames.some(({ frame }) => frame.includes("[custom]")));
  state = enter(state);
  frames = collectCompactFrames(state, "editIndex", "editCompactPage");
  assertCurrentPages(frames, 0, expectedPages(`>Model:${longModel}`, 10, 4));
  assertCurrentPages(frames, 1, expectedPages(`>Reasoning:${longReasoning}`, 10, 4));

  state = baseState({
    baselineMatrix: longMatrix,
    presets: [{ name: longName, kind: "custom", matrix: longMatrix }],
    columns: 80,
    rows: 24
  });
  frames = collectCompactFrames(state, "listCompactIndex", "listCompactPage");
  assertCurrentPages(frames, 1, expectedPages(`>Model:${longModel}`, 80, 24));
  assertCurrentPages(frames, 2, expectedPages(`>Reasoning:${longReasoning}`, 80, 24));
  assertCurrentPages(
    frames,
    MATRIX_COMPACT_TEST_ITEMS,
    expectedPresetPages(state.presets[0], true, 80, 23),
    "Presets:\n"
  );
  assert.ok(frames.some(({ frame }) => frame.includes("MODEL-SUFFIX")));
  assert.ok(frames.some(({ frame }) => frame.includes("이유-끝")));
  assert.ok(frames.some(({ frame }) => frame.includes("NAME-SUFFIX")));
  assert.ok(frames.some(({ frame }) => frame.includes("[custom]")));
  assert.ok(frames.some(({ frame }) => frame.includes("[active]")));
  state = { ...state, listCompactIndex: MATRIX_COMPACT_TEST_ITEMS, listCompactPage: 0, listIndex: 0 };
  state = enter(state);
  frames = collectCompactFrames(state, "detailCompactIndex", "detailCompactPage");
  assert.ok(frames.some(({ frame }) => frame.includes("MODEL-SUFFIX")));
  assert.ok(frames.some(({ frame }) => frame.includes("이유-끝")));
  assert.ok(frames.some(({ frame }) => frame.includes("[custom]")));
  state = enter(state);
  frames = collectCompactFrames(state, "editIndex", "editCompactPage");
  assert.ok(frames.some(({ frame }) => frame.includes("MODEL-SUFFIX")));
  assert.ok(frames.some(({ frame }) => frame.includes("이유-끝")));

  state = baseState({ columns: 80, rows: 24 });
  const normalFrame = renderSetupState(state);
  assert.match(normalFrame, /^csx setup\nScreen: list/);
  assert.match(normalFrame, /Current 8-role matrix:/);
  assert.match(normalFrame, /Presets:/);
  state = key(state, { downArrow: true });
  assert.equal(state.listIndex, 1);
  assert.equal(state.listCompactIndex, MATRIX_COMPACT_TEST_ITEMS);
});

test("custom Edit current collision has distinct stable identity, labels, active state, and selection", () => {
  const baseline = matrix();
  const customMatrix = matrix("terra", "high");
  let state = createSetupState({
    baselineMatrix: customMatrix,
    catalog,
    presets: [
      { name: "Low", matrix: baseline },
      { name: "eDiT CuRrEnT", kind: "custom", matrix: customMatrix }
    ],
    columns: 10,
    rows: 3
  });
  const custom = state.presets[1];
  const current = state.presets[2];
  assert.notEqual(custom.id, current.id);
  assert.equal(custom.label, "eDiT CuRrEnT [custom]");
  assert.equal(current.label, "Edit current [current]");
  assert.equal(state.activeEntryIds.includes(custom.id), true);
  assert.equal(state.activeEntryIds.includes(current.id), false);

  const frames = collectCompactFrames(state, "listCompactIndex", "listCompactPage");
  const customFrames = frames.filter(({ index }) => index === MATRIX_COMPACT_TEST_ITEMS + 1);
  const currentFrames = frames.filter(({ index }) => index === MATRIX_COMPACT_TEST_ITEMS + 2);
  assert.ok(customFrames.some(({ frame }) => frame.includes("[custom]")));
  assert.ok(customFrames.some(({ frame }) => frame.includes("[active]")));
  assert.ok(currentFrames.some(({ frame }) => frame.includes("[current]")));
  assert.equal(currentFrames.some(({ frame }) => frame.includes("[active]")), false);

  state = { ...state, listCompactIndex: MATRIX_COMPACT_TEST_ITEMS + 1, listCompactPage: 0, listIndex: 1 };
  let selected = enter(state);
  assert.equal(selected.selectedPresetId, custom.id);
  assert.equal(selected.selectedPresetLabel, custom.label);
  assert.equal(matrixMatches(selected.startMatrix, customMatrix), true);
  assert.ok(collectCompactFrames(selected, "detailCompactIndex", "detailCompactPage")
    .some(({ frame }) => frame.includes("[custom]")));
  selected = reduceSetupState(selected, { type: "RESIZE", columns: 80, rows: 24 });
  assert.ok(renderSetupState(selected).includes("eDiT CuRrEnT [custom] detail:"));
  let editing = enter(selected);
  assert.equal(editing.screen, "edit");
  assert.ok(renderSetupState(editing).includes("eDiT CuRrEnT [custom] edit"));

  state = { ...state, listCompactIndex: MATRIX_COMPACT_TEST_ITEMS + 2, listCompactPage: 0, listIndex: 2 };
  selected = enter(state);
  assert.equal(selected.selectedPresetId, current.id);
  assert.equal(selected.selectedPresetLabel, current.label);
  assert.equal(matrixMatches(selected.startMatrix, customMatrix), true);
  assert.ok(collectCompactFrames(selected, "detailCompactIndex", "detailCompactPage")
    .some(({ frame }) => frame.includes("[current]")));
  selected = reduceSetupState(selected, { type: "RESIZE", columns: 80, rows: 24 });
  assert.ok(renderSetupState(selected).includes("Edit current [current] detail:"));
  editing = enter(selected);
  assert.equal(editing.screen, "edit");
  assert.ok(renderSetupState(editing).includes("Edit current [current] edit"));
});

test("external text is visibly escaped without changing raw selection or Apply payload", (t) => {
  t.after(cleanupInk);
  const rawName = "bad\\name\n\r\t\0\x7f\x9b\u061c\u200e\u200f\u2028\u2029\u202a\u202e\u2066\u2069";
  const rawModel = "model\\literal\x1b]0;title\x07tail";
  const rawReasoning = "reason\t\x9b31mred\x1b[0m";
  const shownName = String.raw`bad\\name\x0A\x0D\x09\x00\x7F\x9B\u061C\u200E\u200F\u2028\u2029\u202A\u202E\u2066\u2069`;
  const shownModel = String.raw`model\\literal\x1B]0;title\x07tail`;
  const shownReasoning = String.raw`reason\x09\x9B31mred\x1B[0m`;
  const rawMatrix = matrix(rawModel, rawReasoning);
  let state = createSetupState({
    baselineMatrix: rawMatrix,
    catalog: [{ model: rawModel, efforts: [rawReasoning] }],
    presets: [{ name: rawName, kind: "custom", matrix: rawMatrix }],
    columns: 1000,
    rows: 100
  });

  assert.equal(state.presets[0].name, rawName);
  assert.equal(state.presets[0].label, `${rawName} [custom]`);
  assert.deepEqual(state.baselineMatrix, rawMatrix);
  let frame = renderSetupState(state);
  assert.ok(frame.includes(`${shownName} [custom] [active]`));
  assert.ok(frame.includes(`Model ${shownModel} | Reasoning ${shownReasoning}`));
  assert.equal(frame.split("\n").length, 18);
  assertNoInjectedControls(frame);

  state = enter(state);
  assert.equal(state.selectedPreset, rawName);
  assert.equal(state.selectedPresetLabel, `${rawName} [custom]`);
  assert.deepEqual(state.startMatrix, rawMatrix);
  frame = renderSetupState(state);
  assert.ok(frame.includes(`${shownName} [custom] detail:`));
  assert.ok(frame.includes(`Model ${shownModel} | Reasoning ${shownReasoning}`));
  state = enter(state);
  frame = renderSetupState(state);
  assert.ok(frame.includes(`${shownName} [custom] edit`));
  assert.ok(frame.includes(`Model: ${shownModel}`));
  assert.ok(frame.includes(`Reasoning: ${shownReasoning}`));

  state = { ...state, editIndex: AGENT_NAMES.length * 2 };
  state = enter(state);
  state = enter(state);
  state = enter(state);
  assert.equal(state.result.outcome, "apply");
  assert.deepEqual(state.result.matrix, rawMatrix);
  assert.equal(state.result.matrix[AGENT_NAMES[0]].model, rawModel);
  assert.equal(state.result.matrix[AGENT_NAMES[0]].reasoning, rawReasoning);

  state = createSetupState({
    baselineMatrix: rawMatrix,
    catalog: [{ model: rawModel, efforts: [rawReasoning] }],
    presets: [{ name: rawName, kind: "custom", matrix: rawMatrix }],
    columns: 1000,
    rows: 100
  });
  state = {
    ...state,
    screen: "custom-name",
    customNameInput: rawName,
    customPresetNames: [rawName]
  };
  state = enter(state);
  assert.ok(state.error.includes(rawName));
  frame = renderSetupState(state);
  assert.ok(frame.includes(`> ${shownName}_`));
  assert.ok(frame.includes(`ERROR: A custom preset named "${shownName}" already exists.`));
  assertNoInjectedControls(frame);

  frame = renderSetupState({
    ...state,
    screen: "confirm",
    customPresetName: rawName,
    draftMatrix: rawMatrix,
    error: null
  });
  assert.ok(frame.includes(`Save custom preset: ${shownName}`));

  const safeMatrix = matrix("safe-model", "safe-reasoning");
  const diffState = {
    ...createSetupState({
      baselineMatrix: safeMatrix,
      catalog: [{ model: rawModel, efforts: [rawReasoning] }],
      presets: [{ name: rawName, kind: "custom", matrix: rawMatrix }],
      columns: 1000,
      rows: 100
    }),
    screen: "diff",
    draftMatrix: rawMatrix,
    selectedRows: [...AGENT_NAMES],
    mandatoryRows: [],
    diffIndex: 0
  };
  frame = renderSetupState(diffState);
  assert.ok(frame.includes(`safe-model/safe-reasoning -> ${shownModel}/${shownReasoning}`));
  assertNoInjectedControls(frame);

  const inkState = createSetupState({
    baselineMatrix: rawMatrix,
    catalog: [{ model: rawModel, efforts: [rawReasoning] }],
    presets: [{ name: rawName, kind: "custom", matrix: rawMatrix }],
    columns: 1000,
    rows: 100
  });
  const instance = renderInk(h(SetupTui, {
    initialState: inkState,
    onResult() {},
    columns: 1000,
    rows: 100
  }));
  const inkFrame = instance.lastFrame();
  const inkFlat = inkFrame.replaceAll("\n", "");
  assert.ok(inkFlat.includes(`${shownName} [custom][active]`));
  assert.ok(inkFlat.includes(`Model ${shownModel} | Reasoning ${shownReasoning}`));
  assert.equal(inkFrame.split("\n").length, 20);
  assertNoInjectedControls(inkFrame);
});

test("escapeTerminalText is exact and reversible without mutating raw values", () => {
  const raw = "\\\0\n\r\t\x1b\x7f\x80\x9f\u061c\u200e\u200f\u2028\u2029\u202a\u202e\u2066\u2069한글";
  const escaped = String.raw`\\\x00\x0A\x0D\x09\x1B\x7F\x80\x9F\u061C\u200E\u200F\u2028\u2029\u202A\u202E\u2066\u2069한글`;
  assert.equal(escapeTerminalText(raw), escaped);
  assert.equal(decodeTerminalText(escaped), raw);
  assert.equal(raw.includes("\n"), true);
});

test("diff and confirm focused paging exposes long values and actions without key misfires", () => {
  const longModel = `model-${"M".repeat(1800)}-MODEL-TAIL-Z`;
  const longReasoning = `추론-${"나".repeat(700)}-이유-끝`;
  const customName = `custom\\name\n${"C".repeat(800)}-CUSTOM-TAIL-Q`;
  const baseline = matrix("safe-model", "low");
  const draft = clone(baseline);
  draft[AGENT_NAMES[0]] = { model: longModel, reasoning: longReasoning };

  for (const [columns, rows] of [[10, 3], [10, 4], [80, 24]]) {
    let state = {
      ...createSetupState({
        baselineMatrix: baseline,
        catalog: [
          { model: "safe-model", efforts: ["low"] },
          { model: longModel, efforts: [longReasoning] }
        ],
        presets: [{ name: "Long", matrix: draft }],
        columns,
        rows
      }),
      screen: "diff",
      draftMatrix: draft,
      selectedRows: [AGENT_NAMES[0]],
      mandatoryRows: [],
      diffIndex: 0,
      diffCompactPage: 0
    };
    let frames = collectCompactFrames(state, "diffIndex", "diffCompactPage");
    assert.ok(frames.some(({ frame }) => frame.includes("Z")), `${columns}×${rows} diff model suffix`);
    assert.ok(frames.some(({ frame }) => frame.includes("끝")), `${columns}×${rows} diff reasoning suffix`);
    assert.ok(frames.some(({ frame }) => frame === "> Continue"), `${columns}×${rows} diff Continue`);
    const moved = key(state, { downArrow: true });
    assert.equal(moved.diffIndex, 0);
    assert.equal(moved.diffCompactPage, 1);
    assert.deepEqual(moved.selectedRows, [AGENT_NAMES[0]]);
    assert.equal(moved.result, null);
    const toggled = enter(moved);
    assert.deepEqual(toggled.selectedRows, []);

    state = {
      ...state,
      screen: "confirm",
      customPresetName: customName,
      confirmIndex: 0,
      confirmCompactIndex: 0,
      confirmCompactPage: 0,
      selectedRows: [AGENT_NAMES[0]]
    };
    frames = collectCompactFrames(state, "confirmCompactIndex", "confirmCompactPage");
    assert.ok(frames.some(({ frame }) => frame.includes("Z")), `${columns}×${rows} confirm model suffix`);
    assert.ok(frames.some(({ frame }) => frame.includes("끝")), `${columns}×${rows} confirm reasoning suffix`);
    assert.ok(frames.some(({ frame }) => frame.includes("Q")), `${columns}×${rows} custom suffix`);
    assert.ok(frames.some(({ frame }) => frame === "> Apply"), `${columns}×${rows} Apply`);
    assert.ok(frames.some(({ frame }) => frame === "> Cancel"), `${columns}×${rows} Cancel`);
    const previewPage = key(state, { downArrow: true });
    assert.equal(previewPage.confirmCompactIndex, 0);
    assert.equal(previewPage.confirmCompactPage, 1);
    assert.equal(previewPage.result, null);
    assert.equal(enter(previewPage).result, null);
    let applyState = state;
    let steps = 0;
    while (renderSetupState(applyState) !== "> Apply") {
      applyState = key(applyState, { downArrow: true });
      steps += 1;
      assert.ok(steps < 1000, "Apply must be reachable through observable key navigation");
    }
    const applied = enter(applyState);
    assert.equal(applied.result.outcome, "apply");
    assert.equal(applied.result.matrix[AGENT_NAMES[0]].model, longModel);
    assert.equal(applied.result.customPresetName, customName);
  }

  let resized = {
    ...createSetupState({
      baselineMatrix: baseline,
      catalog: [
        { model: "safe-model", efforts: ["low"] },
        { model: longModel, efforts: [longReasoning] }
      ],
      presets: [{ name: "Long", matrix: draft }],
      columns: 10,
      rows: 3
    }),
    screen: "diff",
    draftMatrix: draft,
    selectedRows: [AGENT_NAMES[0]],
    mandatoryRows: [],
    diffIndex: 0,
    diffCompactPage: 5
  };
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 4 });
  assert.equal(resized.diffIndex, 0);
  assert.ok(resized.diffCompactPage <= 5);
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(resized.diffIndex, 0);
  assert.notEqual(renderSetupState(resized), "");
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 3 });
  assert.equal(resized.diffIndex, 0);

  resized = {
    ...resized,
    screen: "confirm",
    customPresetName: customName,
    confirmCompactIndex: 0,
    confirmCompactPage: 5
  };
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 4 });
  assert.equal(resized.confirmCompactIndex, 0);
  assert.ok(resized.confirmCompactPage <= 5);
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(resized.confirmCompactIndex, 0);
  assert.notEqual(renderSetupState(resized), "");
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 3 });
  assert.equal(resized.confirmCompactIndex, 0);

  const mandatory = {
    ...resized,
    screen: "diff",
    diffIndex: 0,
    diffCompactPage: 0,
    mandatoryRows: [AGENT_NAMES[0]]
  };
  const blocked = enter(mandatory);
  assert.equal(blocked.result, null);
  assert.ok(collectCompactFrames(blocked, "diffIndex", "diffCompactPage")
    .some(({ frame }) => frame.includes("ERROR:")));
});

test("custom-name pages expose escaped input and inline errors at every overflow size", () => {
  const rawName = `bad\\name\n${"가".repeat(900)}-NAME-TAIL-Q`;
  const shownSuffix = "Q";
  for (const [columns, rows] of [[10, 3], [10, 4], [80, 24]]) {
    let state = {
      ...baseState({ columns, rows }),
      screen: "custom-name",
      customNameInput: rawName,
      customPresetNames: [rawName],
      auxCompactPage: 0
    };
    let frames = collectPageFrames(state, "auxCompactPage");
    assert.ok(frames.some(({ frame }) => frame.includes(String.raw`\\`)), `${columns}×${rows} backslash escape`);
    assert.ok(frames.some(({ frame }) => frame.includes(String.raw`\x0A`)), `${columns}×${rows} newline escape`);
    assert.ok(frames.some(({ frame }) => frame.includes(shownSuffix)), `${columns}×${rows} name suffix`);
    const moved = key(state, { downArrow: true });
    assert.equal(moved.customNameInput, rawName);
    assert.equal(moved.result, null);

    state = enter(state);
    assert.ok(state.error.includes(rawName));
    frames = collectPageFrames(state, "auxCompactPage");
    assert.ok(frames.some(({ frame }) => frame.includes("ERROR:")), `${columns}×${rows} error`);
    assert.ok(frames.some(({ frame }) => frame.includes(shownSuffix)), `${columns}×${rows} error suffix`);
    assert.equal(state.result, null);
  }

  let resized = {
    ...baseState({ columns: 10, rows: 3 }),
    screen: "custom-name",
    customNameInput: rawName,
    customPresetNames: [rawName],
    auxCompactPage: 5
  };
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 4 });
  assert.equal(resized.customNameInput, rawName);
  assert.ok(resized.auxCompactPage <= 5);
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 80, rows: 24 });
  assert.equal(resized.customNameInput, rawName);
  assert.notEqual(renderSetupState(resized), "");
  resized = reduceSetupState(resized, { type: "RESIZE", columns: 10, rows: 3 });
  assert.equal(resized.customNameInput, rawName);
});

test("overflowing normal-height preset labels keep internal markers atomic", () => {
  const name = `${"P".repeat(90)}-LABEL-END`;
  const state = createSetupState({
    baselineMatrix: matrix(),
    catalog,
    presets: [{ name, kind: "custom", matrix: matrix() }],
    columns: 80,
    rows: 24
  });
  const frames = collectCompactFrames(state, "listCompactIndex", "listCompactPage")
    .filter(({ index }) => index === MATRIX_COMPACT_TEST_ITEMS);
  assert.ok(frames.some(({ frame }) => frame.includes("LABEL-END")));
  assert.ok(frames.some(({ frame }) => frame.split("\n").includes("[custom]")));
  assert.ok(frames.some(({ frame }) => frame.split("\n").includes("[active]")));
  assert.equal(frames.some(({ frame }) => frame.includes("[cus\ntom]")), false);
});

test("Ink renderer accepts input and exposes text markers without color", async (t) => {
  t.after(cleanupInk);
  const instance = renderInk(h(SetupTui, { initialState: baseState(), onResult() {}, columns: 100, rows: 40 }));
  assert.match(instance.lastFrame(), /\[active\]/);
  instance.stdin.write("\u001B[B");
  await new Promise((resolve) => setImmediate(resolve));
  instance.stdin.write("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(instance.lastFrame(), /Medium detail/);
});

class FakeInput extends EventEmitter {
  constructor(isRaw = false) {
    super();
    this.isTTY = true;
    this.isRaw = isRaw;
    this.rawCalls = [];
    this.data = null;
  }
  write(value) {
    this.data = value;
    this.emit("readable");
    this.emit("data", value);
  }
  read() {
    const value = this.data;
    this.data = null;
    return value;
  }
  setRawMode(value) {
    this.isRaw = value;
    this.rawCalls.push(value);
  }
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

class FakeOutput extends EventEmitter {
  constructor() {
    super();
    this.columns = 80;
    this.rows = 24;
    this.writes = [];
  }
  write(value) {
    this.writes.push(value);
    return true;
  }
}

function fakeTty(isRaw = false) {
  return { input: new FakeInput(isRaw), output: new FakeOutput(), errorOutput: new FakeOutput(), signalTarget: new EventEmitter() };
}

async function writeInkKeys(input, keys) {
  for (const value of keys) {
    input.write(value);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("runSetupTui normal Apply result cleans alternate screen, cursor, and raw mode exactly once", async () => {
  const tty = fakeTty();
  let unmounts = 0;
  const expected = { outcome: "apply", matrix: matrix(), selectedAgents: [], customPresetName: undefined };
  const result = await runSetupTui({
    ...tty,
    initialState: baseState(),
    renderImpl(element) {
      queueMicrotask(() => element.props.onResult(expected));
      return { unmount() { unmounts += 1; }, waitUntilExit: () => new Promise(() => {}) };
    }
  });
  assert.deepEqual(result, expected);
  assert.deepEqual(tty.input.rawCalls, [true, false]);
  assert.equal(unmounts, 1);
  assert.equal(tty.output.writes.join(""), "\u001B[?1049h\u001B[?25l\u001B[?25h\u001B[?1049l");
});

test("runSetupTui EOF is AbortError and render/input exceptions rethrow after idempotent cleanup", async () => {
  const eofTty = fakeTty();
  const pending = runSetupTui({
    ...eofTty,
    initialState: baseState(),
    renderImpl: () => ({ unmount() {}, waitUntilExit: () => new Promise(() => {}) })
  });
  eofTty.input.emit("end");
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(eofTty.input.rawCalls, [true, false]);
  assert.match(eofTty.output.writes.at(-1), /\?1049l/);

  const throwTty = fakeTty();
  const failure = new Error("render failed");
  await assert.rejects(runSetupTui({
    ...throwTty,
    initialState: baseState(),
    renderImpl() { throw failure; }
  }), failure);
  assert.deepEqual(throwTty.input.rawCalls, [true, false]);
  assert.match(throwTty.output.writes.at(-1), /\?1049l/);

  const inputTty = fakeTty();
  const inputFailure = new Error("raw mode failed");
  inputTty.input.setRawMode = function setRawMode(value) {
    this.rawCalls.push(value);
    if (value) throw inputFailure;
    this.isRaw = false;
  };
  await assert.rejects(runSetupTui({
    ...inputTty,
    initialState: baseState(),
    renderImpl() { throw new Error("must not render"); }
  }), inputFailure);
  assert.deepEqual(inputTty.input.rawCalls, [true, false]);
  assert.match(inputTty.output.writes.at(-1), /\?1049l/);
});

test("runSetupTui treats raw Ctrl+D through Ink input as EOF and cleans without Apply", async () => {
  const tty = fakeTty();
  const pending = runSetupTui({ ...tty, initialState: baseState() });
  await new Promise((resolve) => setImmediate(resolve));
  tty.input.write("\u0004");
  const observed = await Promise.race([
    pending.then(
      (result) => ({ type: "result", result }),
      (error) => ({ type: "error", error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: "timeout" }), 50))
  ]);
  if (observed.type === "timeout") {
    tty.input.emit("end");
    await pending.catch(() => {});
  }
  assert.equal(observed.type, "error");
  assert.equal(observed.error.name, "AbortError");
  assert.equal(tty.input.rawCalls.includes(true), true);
  assert.equal(tty.input.rawCalls.at(-1), false);
  assert.equal(tty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);
  assert.match(tty.output.writes.at(-1), /\?25h\u001B\[\?1049l/);
});

test("actual Ink Apply and Cancel restore initial false/true raw snapshots after effect cleanup", async () => {
  for (const initialRaw of [false, true]) {
    for (const outcome of ["apply", "cancel"]) {
      const tty = fakeTty(initialRaw);
      const pending = runSetupTui({ ...tty, initialState: baseState() });
      await new Promise((resolve) => setImmediate(resolve));
      const keys = outcome === "apply"
        ? ["\r", "\u001B[B", "\r", "\r", "\r"]
        : ["\r", "\u001B[B", "\u001B[B", "\r"];
      await writeInkKeys(tty.input, keys);
      const result = await pending;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(result.outcome, outcome);
      assert.equal(tty.input.isRaw, initialRaw);
      assert.equal(tty.input.rawCalls.at(-1), initialRaw);
      assert.deepEqual(tty.input.rawCalls.slice(-2), [false, initialRaw]);
      assert.equal(tty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);
    }
  }
});

test("actual Ink EOF and supported signals restore initial false/true raw snapshots", async () => {
  for (const initialRaw of [false, true]) {
    const eofTty = fakeTty(initialRaw);
    const eof = runSetupTui({ ...eofTty, initialState: baseState() });
    await new Promise((resolve) => setImmediate(resolve));
    eofTty.input.emit("end");
    await assert.rejects(eof, { name: "AbortError" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(eofTty.input.isRaw, initialRaw);
    assert.equal(eofTty.input.rawCalls.at(-1), initialRaw);
    assert.equal(eofTty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const tty = fakeTty(initialRaw);
      const kills = [];
      void runSetupTui({
        ...tty,
        initialState: baseState(),
        pid: 2468,
        kill(pid, received) {
          kills.push({ pid, signal: received, raw: tty.input.isRaw });
        }
      });
      await new Promise((resolve) => setImmediate(resolve));
      tty.signalTarget.emit(signal);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(kills, [{ pid: 2468, signal, raw: initialRaw }]);
      assert.equal(tty.input.isRaw, initialRaw);
      assert.equal(tty.input.rawCalls.at(-1), initialRaw);
      assert.equal(tty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);
    }
  }
});

test("cleanup restores both initial raw states after every result, failure, EOF, and supported signal", async () => {
  function assertRestored(tty, initialRaw, unmounts = 1) {
    assert.equal(tty.input.isRaw, initialRaw);
    assert.equal(tty.input.rawCalls.at(-1), initialRaw);
    assert.equal(tty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);
    assert.equal(tty.unmounts, unmounts);
  }

  for (const initialRaw of [false, true]) {
    for (const outcome of ["apply", "cancel"]) {
      const tty = fakeTty(initialRaw);
      tty.unmounts = 0;
      const expected = outcome === "apply"
        ? { outcome, matrix: matrix(), selectedAgents: [] }
        : { outcome };
      const result = await runSetupTui({
        ...tty,
        initialState: baseState(),
        renderImpl(element) {
          queueMicrotask(() => element.props.onResult(expected));
          return {
            unmount() {
              tty.unmounts += 1;
              tty.input.setRawMode(false);
            },
            waitUntilExit: () => new Promise(() => {})
          };
        }
      });
      assert.deepEqual(result, expected);
      assertRestored(tty, initialRaw);
    }

    const eofTty = fakeTty(initialRaw);
    eofTty.unmounts = 0;
    const eof = runSetupTui({
      ...eofTty,
      initialState: baseState(),
      renderImpl: () => ({
        unmount() {
          eofTty.unmounts += 1;
          eofTty.input.setRawMode(false);
        },
        waitUntilExit: () => new Promise(() => {})
      })
    });
    eofTty.input.emit("end");
    await assert.rejects(eof, { name: "AbortError" });
    assertRestored(eofTty, initialRaw);

    const inputTty = fakeTty(initialRaw);
    inputTty.unmounts = 0;
    const inputFailure = new Error("input failed");
    await assert.rejects(runSetupTui({
      ...inputTty,
      initialState: baseState(),
      renderImpl: () => ({
        unmount() {
          inputTty.unmounts += 1;
          inputTty.input.setRawMode(false);
        },
        waitUntilExit: () => Promise.reject(inputFailure)
      })
    }), inputFailure);
    assertRestored(inputTty, initialRaw);

    const renderTty = fakeTty(initialRaw);
    renderTty.unmounts = 0;
    const renderFailure = new Error("render failed");
    await assert.rejects(runSetupTui({
      ...renderTty,
      initialState: baseState(),
      renderImpl() {
        throw renderFailure;
      }
    }), renderFailure);
    assertRestored(renderTty, initialRaw, 0);

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const signalTty = fakeTty(initialRaw);
      signalTty.unmounts = 0;
      const kills = [];
      void runSetupTui({
        ...signalTty,
        initialState: baseState(),
        pid: 9876,
        kill(pid, received) {
          kills.push({ pid, signal: received, raw: signalTty.input.isRaw });
        },
        renderImpl: () => ({
          unmount() {
            signalTty.unmounts += 1;
            signalTty.input.setRawMode(false);
          },
          waitUntilExit: () => new Promise(() => {})
        })
      });
      await new Promise((resolve) => setImmediate(resolve));
      signalTty.signalTarget.emit(signal);
      assert.deepEqual(kills, [{ pid: 9876, signal, raw: initialRaw }]);
      assertRestored(signalTty, initialRaw);
    }
  }
});

test("supported signal cleans first, preserves original signal via kill, and never produces Apply", async () => {
  const tty = fakeTty();
  const events = [];
  runSetupTui({
    ...tty,
    initialState: baseState(),
    pid: 4321,
    kill(pid, signal) {
      events.push({ pid, signal, raw: tty.input.isRaw, tail: tty.output.writes.at(-1) });
    },
    renderImpl: () => ({ unmount() { events.push("unmount"); }, waitUntilExit: () => new Promise(() => {}) })
  });
  await new Promise((resolve) => setImmediate(resolve));
  tty.signalTarget.emit("SIGTERM");
  assert.equal(events[0], "unmount");
  assert.deepEqual(events[1], {
    pid: 4321,
    signal: "SIGTERM",
    raw: false,
    tail: "\u001B[?25h\u001B[?1049l"
  });
});
