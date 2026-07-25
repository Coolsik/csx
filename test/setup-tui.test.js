import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import React from "react";
import { cleanup as cleanupInk, render as renderInk } from "ink-testing-library";
import { AGENT_NAMES } from "../lib/presets.js";
import { escapeTerminalText } from "../lib/terminal-text.js";
import {
  SetupTui,
  changedRows,
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
const catalog = [
  { model: "luna", efforts: ["low", "high"] },
  { model: "terra", efforts: ["low", "high", "xhigh"] },
  { model: "sol", efforts: ["low", "high", "xhigh"] }
];

function matrix(model = "luna", reasoning = "low") {
  return Object.fromEntries(AGENT_NAMES.map((name) => [name, { model, reasoning }]));
}

function presets() {
  return [
    { name: "Low", matrix: matrix("luna", "low") },
    { name: "Medium", matrix: matrix("terra", "high") },
    { name: "Saved", kind: "custom", matrix: matrix("sol", "xhigh") }
  ];
}

function baseState(options = {}) {
  return createSetupState({
    baselineMatrix: options.baselineMatrix ?? matrix(),
    presets: options.presets ?? presets(),
    catalog: options.catalog ?? catalog,
    customPresetNames: options.customPresetNames,
    columns: options.columns ?? 100,
    rows: options.rows ?? 30
  });
}

function key(state, value, input = "") {
  return reduceSetupState(state, { type: "KEY", key: value, input });
}

function enter(state) {
  return key(state, { return: true });
}

function down(state, count = 1) {
  for (let index = 0; index < count; index += 1) state = key(state, { downArrow: true });
  return state;
}

function type(state, value) {
  for (const character of value) state = key(state, {}, character);
  return state;
}

test("matrix helpers use exact complete eight-role pairs", () => {
  const exact = matrix();
  assert.equal(matrixMatches(exact, structuredClone(exact)), true);
  const mismatch = structuredClone(exact);
  mismatch[AGENT_NAMES[0]].reasoning = "high";
  assert.equal(matrixMatches(exact, mismatch), false);
  const missing = structuredClone(exact);
  delete missing[AGENT_NAMES[0]];
  assert.equal(matrixMatches(exact, missing), false);
  assert.deepEqual(matchingPresetNames(exact, [
    { name: "Low", matrix: exact },
    { name: "Twin", kind: "custom", matrix: structuredClone(exact) },
    { name: "Other", matrix: mismatch }
  ]), ["Low", "Twin"]);
  assert.deepEqual(changedRows(exact, mismatch), [AGENT_NAMES[0]]);
});

test("model-first landing renders available models, role tags, and duplicate save state", () => {
  const state = baseState();
  const frame = renderSetupState(state);
  assert.match(frame, /Models/);
  assert.match(frame, /> luna/);
  for (const tag of ["EXPLORE", "ANALYST", "PLANNER", "ARCH", "CRITIC", "EXEC", "VERIFY", "REVIEW"]) {
    assert.match(frame, new RegExp(`\\[${tag}\\] \\(low\\)`));
  }
  assert.match(frame, /Load preset/);
  assert.match(frame, /Already saved as Low \[disabled\]/);
  assert.match(frame, /Review & apply/);
});

test("single-role assignment follows model → role → effort and returns to models", () => {
  let state = baseState();
  state = enter(state);
  assert.equal(state.screen, "assign-role");
  assert.equal(state.selectedModel, "luna");
  state = enter(state);
  assert.equal(state.screen, "assign-effort");
  assert.equal(state.effortIndex, 0);
  state = down(state);
  state = enter(state);
  assert.equal(state.screen, "models");
  assert.deepEqual(state.draftMatrix[AGENT_NAMES[0]], { model: "luna", reasoning: "high" });
  assert.deepEqual(changedRows(state.baselineMatrix, state.draftMatrix), [AGENT_NAMES[0]]);
  assert.match(renderSetupState(state), /\[EXPLORE\] \(high\)/);
  assert.match(renderSetupState(state), /Save custom preset/);
  assert.doesNotMatch(renderSetupState(state), /Already saved/);
});

test("All roles assigns one selected model and effort to all eight roles", () => {
  let state = baseState();
  state = down(state, 2);
  state = enter(state);
  state = down(state, AGENT_NAMES.length);
  assert.match(renderSetupState(state), /> All roles/);
  state = enter(state);
  state = down(state, 2);
  state = enter(state);
  assert.equal(state.screen, "models");
  assert.deepEqual(state.draftMatrix, matrix("sol", "xhigh"));
  assert.match(renderSetupState(state), /Already saved as Saved \[disabled\]/);
});

test("effort defaults to the current role value only when the model matches", () => {
  const baseline = matrix();
  baseline[AGENT_NAMES[0]] = { model: "terra", reasoning: "xhigh" };
  let state = baseState({ baselineMatrix: baseline });
  state = down(state);
  state = enter(state);
  state = enter(state);
  assert.equal(state.effortIndex, 2);
  state = key(state, { escape: true });
  state = key(state, { escape: true });
  state = { ...state, modelIndex: 2 };
  state = enter(state);
  state = enter(state);
  assert.equal(state.effortIndex, 0);
});

test("preset menu previews all roles, loads the full matrix, and clears stale pending names", () => {
  let state = baseState();
  state = { ...state, customPresetName: "Pending", modelIndex: 3 };
  state = enter(state);
  assert.equal(state.screen, "presets");
  assert.match(renderSetupState(state), /\[EXPLORE\] luna\/low/);
  state = down(state);
  assert.match(renderSetupState(state), /> Medium/);
  assert.match(renderSetupState(state), /\[ARCH\] terra\/high/);
  state = enter(state);
  assert.equal(state.screen, "models");
  assert.deepEqual(state.draftMatrix, matrix("terra", "high"));
  assert.equal(state.customPresetName, undefined);
  assert.match(renderSetupState(state), /Already saved as Medium \[disabled\]/);
});

test("custom preset name is staged, editable, and invalidated by a later matrix change", () => {
  let state = baseState();
  state = enter(state);
  state = enter(state);
  state = down(state);
  state = enter(state);
  state = { ...state, modelIndex: 4 };
  state = enter(state);
  assert.equal(state.screen, "custom-name");
  state = type(state, "Team");
  state = enter(state);
  assert.equal(state.screen, "models");
  assert.equal(state.customPresetName, "Team");
  assert.match(renderSetupState(state), /Save custom preset: Team \[pending\]/);

  state = { ...state, modelIndex: 1 };
  state = enter(state);
  state = down(state);
  state = enter(state);
  state = enter(state);
  assert.equal(state.customPresetName, undefined);
});

test("custom name validation remains trimmed, reserved, and case-insensitive", () => {
  assert.match(validateCustomPresetName("   "), /required/);
  assert.match(validateCustomPresetName(" HIGH "), /reserved/);
  assert.match(validateCustomPresetName(" team ", ["Team"]), /already exists/);
  assert.equal(validateCustomPresetName(" Fresh ", ["Team"]), null);

  let state = baseState({ customPresetNames: ["Team"] });
  state = {
    ...state,
    draftMatrix: { ...state.draftMatrix, [AGENT_NAMES[0]]: { model: "luna", reasoning: "high" } },
    modelIndex: 4
  };
  state = enter(state);
  state = type(state, "team");
  state = enter(state);
  assert.equal(state.screen, "custom-name");
  assert.match(renderSetupState(state), /already exists/);
});

test("invalid assignments are visible and block save/review until repaired", () => {
  const baseline = matrix("removed", "max");
  let state = baseState({ baselineMatrix: baseline });
  assert.deepEqual(invalidRows(state.draftMatrix, catalog), AGENT_NAMES);
  assert.match(renderSetupState(state), /EXPLORE: removed\/max is unavailable/);
  state = { ...state, modelIndex: catalog.length + AGENT_NAMES.length + 1 };
  state = enter(state);
  assert.equal(state.screen, "models");
  assert.match(state.error, /Repair unavailable/);

  state = { ...state, modelIndex: 0 };
  state = enter(state);
  state = down(state, AGENT_NAMES.length);
  state = enter(state);
  state = enter(state);
  assert.deepEqual(invalidRows(state.draftMatrix, catalog), []);
});

test("review is read-only and Apply returns every changed role plus pending preset name", () => {
  let state = baseState();
  state = enter(state);
  state = down(state, AGENT_NAMES.length);
  state = enter(state);
  state = down(state);
  state = enter(state);
  state = { ...state, customPresetName: "Team" };
  state.modelIndex = 5;
  state = enter(state);
  assert.equal(state.screen, "review");
  assert.match(renderSetupState(state), /Final setup preview/);
  assert.match(renderSetupState(state), /Save custom preset: Team/);
  assert.match(renderSetupState(state), /> Apply/);
  state = enter(state);
  assert.equal(state.result.outcome, "apply");
  assert.deepEqual(state.result.selectedAgents, AGENT_NAMES);
  assert.equal(state.result.customPresetName, "Team");
});

test("review supports custom-only Apply with zero changed agents", () => {
  let state = baseState({ presets: [{ name: "Other", matrix: matrix("terra", "high") }] });
  state = { ...state, customPresetName: "Snapshot", modelIndex: 5 };
  state = enter(state);
  assert.equal(state.screen, "review");
  state = enter(state);
  assert.deepEqual(state.result.selectedAgents, []);
  assert.equal(state.result.customPresetName, "Snapshot");
});

test("Esc boundaries return through submenus and cancel only from the landing screen", () => {
  let state = baseState();
  state = enter(state);
  state = enter(state);
  state = key(state, { escape: true });
  assert.equal(state.screen, "assign-role");
  state = key(state, { escape: true });
  assert.equal(state.screen, "models");
  state = key(state, { escape: true });
  assert.deepEqual(state.result, { outcome: "cancel" });
});

test("tiny viewport pages every long selected model chunk before moving focus", () => {
  const longModel = `모델-${"가나다라마바사".repeat(8)}-END`;
  let state = baseState({
    baselineMatrix: matrix(longModel, "아주긴추론"),
    catalog: [{ model: longModel, efforts: ["아주긴추론"] }, ...catalog],
    presets: [],
    columns: 10,
    rows: 3
  });
  const pages = [];
  while (state.modelIndex === 0) {
    pages.push(renderSetupState(state));
    state = down(state);
    assert.ok(pages.length < 100);
  }
  assert.ok(pages.length > 2);
  assert.ok(pages.some((frame) => frame.includes("END")));
  assert.equal(state.modelIndex, 1);
});

test("tiny custom-name input pages without losing the raw pending text", () => {
  let state = baseState({ columns: 10, rows: 3 });
  state = {
    ...state,
    draftMatrix: {
      ...state.draftMatrix,
      [AGENT_NAMES[0]]: { model: "luna", reasoning: "high" }
    },
    modelIndex: 4
  };
  state = enter(state);
  const rawName = `팀-${"가나다라마바사".repeat(8)}-END`;
  state = type(state, rawName);
  const first = renderSetupState(state);
  state = down(state);
  const second = renderSetupState(state);
  assert.notEqual(second, first);
  assert.equal(state.customNameInput, rawName);
  let sawLastPage = renderSetupState(state).includes("ack");
  for (let index = 0; index < 100 && !sawLastPage; index += 1) {
    state = down(state);
    sawLastPage = renderSetupState(state).includes("ack");
  }
  assert.equal(sawLastPage, true);
  assert.equal(state.customNameInput, rawName);
});

test("external terminal controls are visibly escaped without mutating Apply data", () => {
  const rawModel = "model\\path\n\u001b]0;owned\u0007\u202e-END";
  const rawReasoning = "high\t\u001b[31m";
  const baseline = matrix(rawModel, rawReasoning);
  const state = baseState({
    baselineMatrix: baseline,
    catalog: [{ model: rawModel, efforts: [rawReasoning] }],
    presets: [{ name: "unsafe\u001b[31m", kind: "custom", matrix: baseline }],
    columns: 200,
    rows: 30
  });
  const frame = renderSetupState(state);
  assert.match(frame, new RegExp(escapeTerminalText(rawModel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(frame.replaceAll("\n", ""), /[\u0000-\u001f\u007f-\u009f\u202e]/u);
  assert.equal(state.draftMatrix[AGENT_NAMES[0]].model, rawModel);
});

test("Ink renderer exposes model tags and accepts model-first input", async (t) => {
  t.after(cleanupInk);
  const instance = renderInk(h(SetupTui, {
    initialState: baseState(),
    onResult() {},
    columns: 100,
    rows: 30
  }));
  assert.match(instance.lastFrame(), /EXPLORE/);
  instance.stdin.write("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(instance.lastFrame(), /Assign luna to/);
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
  return {
    input: new FakeInput(isRaw),
    output: new FakeOutput(),
    errorOutput: new FakeOutput(),
    signalTarget: new EventEmitter()
  };
}

async function writeInkKeys(input, keys) {
  for (const value of keys) {
    input.write(value);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("runSetupTui result and EOF restore alternate screen, cursor, and raw mode exactly once", async () => {
  const tty = fakeTty();
  let unmounts = 0;
  const expected = { outcome: "apply", matrix: matrix(), selectedAgents: [] };
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

  const eofTty = fakeTty();
  const pending = runSetupTui({
    ...eofTty,
    initialState: baseState(),
    renderImpl: () => ({ unmount() {}, waitUntilExit: () => new Promise(() => {}) })
  });
  eofTty.input.emit("end");
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(eofTty.input.rawCalls, [true, false]);
  assert.equal(eofTty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);
});

test("actual Ink Apply and Cancel restore both initial raw states", async () => {
  for (const initialRaw of [false, true]) {
    const applyTty = fakeTty(initialRaw);
    const apply = runSetupTui({ ...applyTty, initialState: baseState() });
    await new Promise((resolve) => setImmediate(resolve));
    await writeInkKeys(applyTty.input, [
      "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B",
      "\r", "\r"
    ]);
    assert.equal((await apply).outcome, "apply");
    assert.equal(applyTty.input.isRaw, initialRaw);
    assert.equal(applyTty.input.rawCalls.at(-1), initialRaw);

    const cancelTty = fakeTty(initialRaw);
    const cancel = runSetupTui({ ...cancelTty, initialState: baseState() });
    await new Promise((resolve) => setImmediate(resolve));
    await writeInkKeys(cancelTty.input, [
      "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B",
      "\r"
    ]);
    assert.equal((await cancel).outcome, "cancel");
    assert.equal(cancelTty.input.isRaw, initialRaw);
    assert.equal(cancelTty.input.rawCalls.at(-1), initialRaw);
  }
});

test("raw Ctrl+D and supported signals clean before aborting or forwarding", async () => {
  const ctrlDTty = fakeTty();
  const pending = runSetupTui({ ...ctrlDTty, initialState: baseState() });
  await new Promise((resolve) => setImmediate(resolve));
  ctrlDTty.input.write("\u0004");
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(ctrlDTty.input.rawCalls.at(-1), false);
  assert.equal(ctrlDTty.output.writes.filter((value) => value.includes("\u001B[?1049l")).length, 1);

  const signalTty = fakeTty(true);
  const events = [];
  void runSetupTui({
    ...signalTty,
    initialState: baseState(),
    pid: 4321,
    kill(pid, signal) {
      events.push({ pid, signal, raw: signalTty.input.isRaw, tail: signalTty.output.writes.at(-1) });
    },
    renderImpl: () => ({
      unmount() { events.push("unmount"); },
      waitUntilExit: () => new Promise(() => {})
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  signalTty.signalTarget.emit("SIGTERM");
  assert.equal(events[0], "unmount");
  assert.deepEqual(events[1], {
    pid: 4321,
    signal: "SIGTERM",
    raw: true,
    tail: "\u001B[?25h\u001B[?1049l"
  });
});
