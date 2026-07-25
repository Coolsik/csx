import process from "node:process";
import React, { useEffect, useRef, useState } from "react";
import { render, Text, useInput, useStdout } from "ink";
import { AGENT_NAMES, cloneMatrix } from "./presets.js";
import { escapeTerminalText } from "./terminal-text.js";

const h = React.createElement;
const RESERVED_NAMES = new Set(["low", "medium", "high", "custom"]);
const MATRIX_COMPACT_ITEMS = AGENT_NAMES.length * 3;
const DETAIL_ACTIONS = ["Edit", "Apply", "Cancel"];
const CONFIRM_ACTIONS = ["Apply", "Cancel"];
const FOCUSED_PAGING_SCREENS = new Set(["list", "detail", "edit", "diff", "confirm", "custom-name"]);

function samePair(left, right) {
  return left?.model === right?.model && left?.reasoning === right?.reasoning;
}

export function matrixMatches(left, right) {
  try {
    const a = cloneMatrix(left);
    const b = cloneMatrix(right);
    return AGENT_NAMES.every((name) => samePair(a[name], b[name]));
  } catch {
    return false;
  }
}

function presetEntries(presets) {
  if (Array.isArray(presets)) {
    return presets.map(({ name, matrix, kind = "preset" }, index) => ({
      id: `preset:${index}`,
      name,
      kind,
      label: kind === "custom" ? `${name} [custom]` : kind === "current" ? `${name} [current]` : name,
      matrix: cloneMatrix(matrix)
    }));
  }
  return Object.entries(presets ?? {}).map(([name, matrix], index) => ({
    id: `preset:${index}`,
    name,
    kind: "preset",
    label: name,
    matrix: cloneMatrix(matrix)
  }));
}

export function matchingPresetNames(baselineMatrix, presets) {
  return presetEntries(presets)
    .filter(({ matrix }) => matrixMatches(baselineMatrix, matrix))
    .map(({ name }) => name);
}

export function invalidRows(matrix, catalog) {
  const available = new Map((catalog ?? []).map(({ model, efforts }) => [model, new Set(efforts)]));
  return AGENT_NAMES.filter((name) => !available.get(matrix[name]?.model)?.has(matrix[name]?.reasoning));
}

export function changedRows(baselineMatrix, matrix) {
  return AGENT_NAMES.filter((name) => !samePair(baselineMatrix[name], matrix[name]));
}

export function validateCustomPresetName(value, existingNames = []) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return "Custom preset name is required.";
  const normalized = name.toLowerCase();
  if (RESERVED_NAMES.has(normalized)) return `"${name}" is a reserved preset name.`;
  if (existingNames.some((entry) => entry.trim().toLowerCase() === normalized)) {
    return `A custom preset named "${name}" already exists.`;
  }
  return null;
}

function dimensions(value = {}) {
  return {
    columns: Math.max(10, Number(value.columns) || 80),
    rows: Math.max(3, Number(value.rows) || 24)
  };
}

function withEditCurrent(entries, baselineMatrix) {
  if (entries.some(({ kind }) => kind === "current")) return entries;
  return [...entries, {
    id: "current",
    name: "Edit current",
    label: "Edit current [current]",
    kind: "current",
    matrix: cloneMatrix(baselineMatrix)
  }];
}

export function createSetupState({ baselineMatrix, presets, catalog, customPresetNames, columns, rows } = {}) {
  const baseline = cloneMatrix(baselineMatrix);
  const entries = withEditCurrent(presetEntries(presets), baseline);
  return {
    screen: "list",
    baselineMatrix: baseline,
    presets: entries,
    catalog: (catalog ?? []).map(({ model, efforts }) => ({ model, efforts: [...efforts] })),
    customPresetNames: [...(customPresetNames ?? entries.filter(({ kind }) => kind === "custom").map(({ name }) => name))],
    activeEntryIds: entries.filter(({ kind, matrix }) => kind !== "current" && matrixMatches(baseline, matrix)).map(({ id }) => id),
    listIndex: 0,
    listCompactIndex: MATRIX_COMPACT_ITEMS,
    listCompactPage: 0,
    detailIndex: AGENT_NAMES.length,
    detailCompactIndex: MATRIX_COMPACT_ITEMS,
    detailCompactPage: 0,
    editIndex: 0,
    editCompactPage: 0,
    diffIndex: 0,
    diffCompactPage: 0,
    choiceIndex: 1,
    confirmIndex: 0,
    confirmCompactIndex: 0,
    confirmCompactPage: 0,
    auxCompactPage: 0,
    selectedPreset: null,
    startMatrix: null,
    draftMatrix: null,
    selectedRows: [],
    mandatoryRows: [],
    customPresetName: undefined,
    customNameInput: "",
    error: null,
    dimensions: dimensions({ columns, rows }),
    result: null
  };
}

function selectPreset(state) {
  const selected = state.presets[state.listIndex];
  return {
    ...state,
    screen: "detail",
    selectedPreset: selected.name,
    selectedPresetId: selected.id,
    selectedPresetLabel: selected.label,
    selectedPresetKind: selected.kind,
    startMatrix: cloneMatrix(selected.matrix),
    draftMatrix: cloneMatrix(selected.matrix),
    detailIndex: AGENT_NAMES.length,
    detailCompactIndex: MATRIX_COMPACT_ITEMS,
    detailCompactPage: 0,
    error: null
  };
}

function enterDiff(state) {
  const invalid = invalidRows(state.draftMatrix, state.catalog);
  if (invalid.length) {
    return { ...state, error: `Repair unavailable Model/Reasoning pairs: ${invalid.join(", ")}` };
  }
  const changed = changedRows(state.baselineMatrix, state.draftMatrix);
  const baselineInvalid = new Set(invalidRows(state.baselineMatrix, state.catalog));
  const mandatory = changed.filter((name) => baselineInvalid.has(name));
  return {
    ...state,
    screen: "diff",
    selectedRows: changed,
    mandatoryRows: mandatory,
    diffIndex: 0,
    diffCompactPage: 0,
    error: null
  };
}

function finalMatrix(state) {
  const selected = new Set(state.selectedRows);
  const matrix = cloneMatrix(state.draftMatrix);
  for (const name of changedRows(state.baselineMatrix, matrix)) {
    if (!selected.has(name)) matrix[name] = { ...state.baselineMatrix[name] };
  }
  return matrix;
}

function continueFromDiff(state) {
  const matrix = finalMatrix(state);
  const invalid = invalidRows(matrix, state.catalog);
  if (invalid.length) {
    return { ...state, error: `Final matrix has unavailable Model/Reasoning pairs: ${invalid.join(", ")}` };
  }
  const finalChanged = changedRows(state.baselineMatrix, matrix);
  return {
    ...state,
    draftMatrix: matrix,
    selectedRows: finalChanged,
    screen: finalChanged.length ? "save-custom-choice" : "confirm",
    choiceIndex: 1,
    confirmIndex: 0,
    confirmCompactIndex: 0,
    confirmCompactPage: 0,
    error: null
  };
}

function move(index, delta, count) {
  return (index + delta + count) % count;
}

function editCount() {
  return AGENT_NAMES.length * 2 + 1;
}

function matrixCompactText(matrix, index) {
  const agent = AGENT_NAMES[Math.floor(index / 3)];
  const value = matrix[agent];
  return index % 3 === 0
    ? agent
    : index % 3 === 1
      ? `Model:${escapeTerminalText(value.model)}`
      : `Reasoning:${escapeTerminalText(value.reasoning)}`;
}

function errorChunks(state, columns) {
  return state.error ? wrapLine(`ERROR:${escapeTerminalText(state.error)}`, columns) : [];
}

function withErrorChunks(state, chunks, columns) {
  return [...chunks, ...errorChunks(state, columns)];
}

function chunkPageCount(chunks, rows) {
  return Math.max(1, Math.ceil(chunks.length / rows));
}

function compactPageCount(state, text, rows) {
  return chunkPageCount(
    withErrorChunks(state, wrapLine(`>${text}`, state.dimensions.columns), state.dimensions.columns),
    rows
  );
}

function presetCompactChunks(preset, active, columns) {
  return [
    ...wrapLine(`> ${escapeTerminalText(preset.name)}`, columns),
    ...(preset.kind === "custom" ? ["[custom]"] : preset.kind === "current" ? ["[current]"] : []),
    ...(active ? ["[active]"] : [])
  ];
}

function listCompactPageCount(state, index) {
  if (index < MATRIX_COMPACT_ITEMS) {
    return compactPageCount(state, matrixCompactText(state.baselineMatrix, index), state.dimensions.rows);
  }
  const preset = state.presets[index - MATRIX_COMPACT_ITEMS];
  if (!preset) return 1;
  const chunks = withErrorChunks(
    state,
    presetCompactChunks(preset, state.activeEntryIds.includes(preset.id), state.dimensions.columns),
    state.dimensions.columns
  );
  return chunkPageCount(chunks, state.dimensions.rows - 1);
}

function detailCompactPageCount(state, index) {
  if (index < MATRIX_COMPACT_ITEMS) {
    return compactPageCount(state, matrixCompactText(state.startMatrix, index), state.dimensions.rows);
  }
  if (index === MATRIX_COMPACT_ITEMS) {
    return chunkPageCount(
      withErrorChunks(state, detailEditChunks(state, state.dimensions.columns), state.dimensions.columns),
      state.dimensions.rows
    );
  }
  return chunkPageCount(
    withErrorChunks(
      state,
      [`> ${DETAIL_ACTIONS[index - MATRIX_COMPACT_ITEMS]}`],
      state.dimensions.columns
    ),
    state.dimensions.rows
  );
}

function detailEditChunks(state, columns) {
  return [
    "> Edit",
    ...wrapLine(`Preset:${escapeTerminalText(state.selectedPreset)}`, columns),
    ...(state.selectedPresetKind === "custom" ? ["[custom]"] : state.selectedPresetKind === "current" ? ["[current]"] : [])
  ];
}

function editCompactText(state, index) {
  const agent = AGENT_NAMES[Math.floor(index / 2)];
  const value = state.draftMatrix[agent];
  return index % 2 === 0
    ? `Model:${escapeTerminalText(value.model)}`
    : `Reasoning:${escapeTerminalText(value.reasoning)}`;
}

function editCompactPageCount(state, index) {
  if (index === editCount() - 1) return compactPageCount(state, " Continue to diff", state.dimensions.rows);
  return compactPageCount(state, editCompactText(state, index), state.dimensions.rows);
}

function moveCompact(index, page, delta, count, pageCount) {
  if (delta > 0 && page + 1 < pageCount(index)) return { index, page: page + 1 };
  if (delta < 0 && page > 0) return { index, page: page - 1 };
  const nextIndex = move(index, delta, count);
  return { index: nextIndex, page: delta < 0 ? pageCount(nextIndex) - 1 : 0 };
}

function diffCompactChunks(state, index) {
  const changes = changedRows(state.baselineMatrix, state.draftMatrix);
  let chunks;
  if (index < changes.length) {
    const name = changes[index];
    const selected = state.selectedRows.includes(name) ? "[x]" : "[ ]";
    const mandatory = state.mandatoryRows.includes(name) ? " [mandatory repair]" : "";
    chunks = [
      ...wrapLine(`> ${selected} ${name}${mandatory}`, state.dimensions.columns),
      ...wrapLine(
        `${escapeTerminalText(state.baselineMatrix[name].model)}/${escapeTerminalText(state.baselineMatrix[name].reasoning)} -> ${escapeTerminalText(state.draftMatrix[name].model)}/${escapeTerminalText(state.draftMatrix[name].reasoning)}`,
        state.dimensions.columns
      )
    ];
  } else {
    chunks = ["> Continue"];
  }
  return withErrorChunks(state, chunks, state.dimensions.columns);
}

function diffCompactPageCount(state, index) {
  return chunkPageCount(diffCompactChunks(state, index), state.dimensions.rows);
}

function confirmChanges(state) {
  return changedRows(state.baselineMatrix, state.draftMatrix);
}

function confirmActionOffset(state) {
  return confirmChanges(state).length + (state.customPresetName ? 1 : 0);
}

function confirmCompactChunks(state, index) {
  const changes = confirmChanges(state);
  let chunks;
  if (index < changes.length) {
    const name = changes[index];
    chunks = wrapLine(`> ${row(name, state.draftMatrix[name])}`, state.dimensions.columns);
  } else if (state.customPresetName && index === changes.length) {
    chunks = wrapLine(`> Save custom preset: ${escapeTerminalText(state.customPresetName)}`, state.dimensions.columns);
  } else {
    const action = CONFIRM_ACTIONS[index - confirmActionOffset(state)];
    chunks = action ? [`> ${action}`] : [];
  }
  return withErrorChunks(state, chunks, state.dimensions.columns);
}

function confirmCompactPageCount(state, index) {
  return chunkPageCount(confirmCompactChunks(state, index), state.dimensions.rows);
}

function auxCompactChunks(state) {
  const { lines } = screenLines(state);
  return lines.flatMap((line) => wrapLine(line, state.dimensions.columns));
}

function auxCompactPageCount(state) {
  return chunkPageCount(auxCompactChunks(state), state.dimensions.rows);
}

function updateEditValue(state, delta) {
  if (state.editIndex >= AGENT_NAMES.length * 2) return state;
  const agent = AGENT_NAMES[Math.floor(state.editIndex / 2)];
  const field = state.editIndex % 2 === 0 ? "model" : "reasoning";
  const current = state.draftMatrix[agent];
  let values;
  if (field === "model") values = state.catalog.map(({ model }) => model);
  else values = state.catalog.find(({ model }) => model === current.model)?.efforts ?? [];
  if (!values.length) return { ...state, error: `No available ${field} values for ${agent}.` };
  const currentIndex = values.indexOf(current[field]);
  const value = values[move(currentIndex < 0 ? 0 : currentIndex, delta, values.length)];
  const nextPair = field === "model"
    ? { model: value, reasoning: state.catalog.find(({ model }) => model === value).efforts[0] }
    : { ...current, reasoning: value };
  return {
    ...state,
    draftMatrix: { ...state.draftMatrix, [agent]: nextPair },
    editCompactPage: 0,
    error: null
  };
}

function cancelResult(state) {
  return { ...state, screen: "done", result: { outcome: "cancel" }, error: null };
}

export function reduceSetupState(state, action) {
  if (action.type === "RESIZE") {
    const nextDimensions = dimensions(action);
    const resized = { ...state, dimensions: nextDimensions };
    const wasFocused = usesFocusedPaging(state);
    const isFocused = usesFocusedPaging(resized);
    if (wasFocused && isFocused) {
      return {
        ...resized,
        ...(state.screen === "list" ? {
          listCompactPage: Math.min(state.listCompactPage, listCompactPageCount(resized, state.listCompactIndex) - 1)
        } : {}),
        ...(state.screen === "detail" ? {
          detailCompactPage: Math.min(state.detailCompactPage, detailCompactPageCount(resized, state.detailCompactIndex) - 1)
        } : {}),
        ...(state.screen === "edit" ? {
          editCompactPage: Math.min(state.editCompactPage, editCompactPageCount(resized, state.editIndex) - 1)
        } : {}),
        ...(state.screen === "diff" ? {
          diffCompactPage: Math.min(state.diffCompactPage, diffCompactPageCount(resized, state.diffIndex) - 1)
        } : {}),
        ...(state.screen === "confirm" ? {
          confirmCompactPage: Math.min(
            state.confirmCompactPage,
            confirmCompactPageCount(resized, state.confirmCompactIndex) - 1
          )
        } : {}),
        ...(state.screen === "custom-name" ? {
          auxCompactPage: Math.min(state.auxCompactPage, auxCompactPageCount(resized) - 1)
        } : {})
      };
    }
    if (wasFocused || !isFocused) return resized;
    return {
      ...resized,
      listCompactIndex: MATRIX_COMPACT_ITEMS + state.listIndex,
      listCompactPage: 0,
      detailCompactIndex: state.detailIndex < AGENT_NAMES.length
        ? state.detailIndex * 3
        : MATRIX_COMPACT_ITEMS + state.detailIndex - AGENT_NAMES.length,
      detailCompactPage: 0,
      editCompactPage: 0,
      diffCompactPage: 0,
      confirmCompactIndex: state.screen === "confirm"
        ? confirmActionOffset(state) + state.confirmIndex
        : state.confirmCompactIndex,
      confirmCompactPage: 0,
      auxCompactPage: 0
    };
  }
  if (action.type === "SET_CUSTOM_NAME") {
    return { ...state, customNameInput: action.value, auxCompactPage: 0, error: null };
  }
  if (action.type !== "KEY" || state.screen === "done" || state.screen === "applying") return state;
  const { key = {}, input = "" } = action;
  const up = key.upArrow;
  const down = key.downArrow;
  const left = key.leftArrow;
  const right = key.rightArrow;
  const enter = key.return;
  const escape = key.escape;

  if (state.screen === "list") {
    if (escape) return cancelResult(state);
    if (usesFocusedPaging(state) && (up || down)) {
      const next = moveCompact(
        state.listCompactIndex,
        state.listCompactPage,
        up ? -1 : 1,
        MATRIX_COMPACT_ITEMS + state.presets.length,
        (index) => listCompactPageCount(state, index)
      );
      return {
        ...state,
        listCompactIndex: next.index,
        listCompactPage: next.page,
        listIndex: next.index >= MATRIX_COMPACT_ITEMS ? next.index - MATRIX_COMPACT_ITEMS : state.listIndex
      };
    }
    if (usesFocusedPaging(state) && enter) {
      if (state.listCompactIndex < MATRIX_COMPACT_ITEMS) return state;
      return selectPreset({ ...state, listIndex: state.listCompactIndex - MATRIX_COMPACT_ITEMS });
    }
    if (up) return { ...state, listIndex: move(state.listIndex, -1, state.presets.length) };
    if (down) return { ...state, listIndex: move(state.listIndex, 1, state.presets.length) };
    if (enter) return selectPreset(state);
  } else if (state.screen === "detail") {
    if (escape) return { ...state, screen: "list", error: null };
    if (usesFocusedPaging(state) && (up || down)) {
      const next = moveCompact(
        state.detailCompactIndex,
        state.detailCompactPage,
        up ? -1 : 1,
        MATRIX_COMPACT_ITEMS + DETAIL_ACTIONS.length,
        (index) => detailCompactPageCount(state, index)
      );
      return {
        ...state,
        detailCompactIndex: next.index,
        detailCompactPage: next.page,
        detailIndex: next.index < MATRIX_COMPACT_ITEMS
          ? Math.floor(next.index / 3)
          : AGENT_NAMES.length + next.index - MATRIX_COMPACT_ITEMS
      };
    }
    if (usesFocusedPaging(state) && enter) {
      if (state.detailCompactIndex < MATRIX_COMPACT_ITEMS) return state;
      const actionIndex = state.detailCompactIndex - MATRIX_COMPACT_ITEMS;
      if (actionIndex === 0) {
        return { ...state, screen: "edit", draftMatrix: cloneMatrix(state.startMatrix), editIndex: 0, editCompactPage: 0, error: null };
      }
      if (actionIndex === 1) return enterDiff(state);
      if (actionIndex === 2) return cancelResult(state);
      return state;
    }
    if (up) return { ...state, detailIndex: move(state.detailIndex, -1, AGENT_NAMES.length + 3) };
    if (down) return { ...state, detailIndex: move(state.detailIndex, 1, AGENT_NAMES.length + 3) };
    if (enter && state.detailIndex === AGENT_NAMES.length) {
      return { ...state, screen: "edit", draftMatrix: cloneMatrix(state.startMatrix), editIndex: 0, editCompactPage: 0, error: null };
    }
    if (enter && state.detailIndex === AGENT_NAMES.length + 1) return enterDiff(state);
    if (enter && state.detailIndex === AGENT_NAMES.length + 2) return cancelResult(state);
  } else if (state.screen === "edit") {
    if (escape) return { ...state, screen: "detail", draftMatrix: cloneMatrix(state.startMatrix), error: null };
    if (usesFocusedPaging(state) && (up || down)) {
      const next = moveCompact(
        state.editIndex,
        state.editCompactPage,
        up ? -1 : 1,
        editCount(),
        (index) => editCompactPageCount(state, index)
      );
      return { ...state, editIndex: next.index, editCompactPage: next.page };
    }
    if (up) return { ...state, editIndex: move(state.editIndex, -1, editCount()), editCompactPage: 0 };
    if (down) return { ...state, editIndex: move(state.editIndex, 1, editCount()), editCompactPage: 0 };
    if (left) return updateEditValue(state, -1);
    if (right) return updateEditValue(state, 1);
    if (enter && state.editIndex === editCount() - 1) return enterDiff(state);
  } else if (state.screen === "diff") {
    const changes = changedRows(state.baselineMatrix, state.draftMatrix);
    if (escape) return { ...state, screen: "edit", editIndex: 0, editCompactPage: 0, error: null };
    if (usesFocusedPaging(state) && (up || down)) {
      const next = moveCompact(
        state.diffIndex,
        state.diffCompactPage,
        up ? -1 : 1,
        changes.length + 1,
        (index) => diffCompactPageCount(state, index)
      );
      return { ...state, diffIndex: next.index, diffCompactPage: next.page };
    }
    if (up) return { ...state, diffIndex: move(state.diffIndex, -1, changes.length + 1) };
    if (down) return { ...state, diffIndex: move(state.diffIndex, 1, changes.length + 1) };
    if (enter && state.diffIndex < changes.length) {
      const name = changes[state.diffIndex];
      if (state.mandatoryRows.includes(name)) {
        return { ...state, error: `${name} is a mandatory repair and cannot be excluded.` };
      }
      const selected = new Set(state.selectedRows);
      if (selected.has(name)) selected.delete(name);
      else selected.add(name);
      return { ...state, selectedRows: [...selected], error: null };
    }
    if (enter && state.diffIndex === changes.length) return continueFromDiff(state);
  } else if (state.screen === "save-custom-choice") {
    if (escape) return { ...state, screen: "diff", error: null };
    if (up || down || left || right) return { ...state, choiceIndex: state.choiceIndex ? 0 : 1 };
    if (enter && state.choiceIndex === 0) {
      return { ...state, screen: "custom-name", customNameInput: "", auxCompactPage: 0, error: null };
    }
    if (enter && state.choiceIndex === 1) {
      return {
        ...state,
        screen: "confirm",
        customPresetName: undefined,
        confirmIndex: 0,
        confirmCompactIndex: changedRows(state.baselineMatrix, state.draftMatrix).length,
        confirmCompactPage: 0,
        error: null
      };
    }
  } else if (state.screen === "custom-name") {
    if (escape) return { ...state, screen: "save-custom-choice", error: null };
    if (usesFocusedPaging(state) && (up || down)) {
      return {
        ...state,
        auxCompactPage: move(
          state.auxCompactPage,
          up ? -1 : 1,
          auxCompactPageCount(state)
        )
      };
    }
    if (key.backspace || key.delete) {
      return { ...state, customNameInput: state.customNameInput.slice(0, -1), auxCompactPage: 0, error: null };
    }
    if (enter) {
      const error = validateCustomPresetName(state.customNameInput, state.customPresetNames);
      if (error) return { ...state, auxCompactPage: 0, error };
      const next = {
        ...state,
        screen: "confirm",
        customPresetName: state.customNameInput.trim(),
        confirmIndex: 0,
        confirmCompactPage: 0,
        error: null
      };
      return { ...next, confirmCompactIndex: confirmActionOffset(next) };
    }
    if (input && !key.ctrl && !key.meta) {
      return { ...state, customNameInput: state.customNameInput + input, auxCompactPage: 0, error: null };
    }
  } else if (state.screen === "confirm") {
    if (escape) return changedRows(state.baselineMatrix, state.draftMatrix).length
      ? { ...state, screen: "save-custom-choice", error: null }
      : { ...state, screen: "diff", error: null };
    const focused = usesFocusedPaging(state);
    const actionOffset = confirmActionOffset(state);
    if (focused && (up || down)) {
      const next = moveCompact(
        state.confirmCompactIndex,
        state.confirmCompactPage,
        up ? -1 : 1,
        actionOffset + CONFIRM_ACTIONS.length,
        (index) => confirmCompactPageCount(state, index)
      );
      return {
        ...state,
        confirmCompactIndex: next.index,
        confirmCompactPage: next.page,
        confirmIndex: next.index >= actionOffset ? next.index - actionOffset : state.confirmIndex
      };
    }
    if (focused && (left || right)) {
      const confirmIndex = state.confirmIndex ? 0 : 1;
      return {
        ...state,
        confirmIndex,
        confirmCompactIndex: actionOffset + confirmIndex,
        confirmCompactPage: 0
      };
    }
    if (!focused && (up || down || left || right)) {
      return { ...state, confirmIndex: state.confirmIndex ? 0 : 1 };
    }
    const actionIndex = focused ? state.confirmCompactIndex - actionOffset : state.confirmIndex;
    if (enter && actionIndex === 1) return cancelResult(state);
    if (enter && actionIndex === 0) {
      const matrix = finalMatrix(state);
      const invalid = invalidRows(matrix, state.catalog);
      if (invalid.length) {
        return {
          ...state,
          confirmCompactPage: 0,
          error: `Final matrix has unavailable Model/Reasoning pairs: ${invalid.join(", ")}`
        };
      }
      return {
        ...state,
        screen: "applying",
        result: {
          outcome: "apply",
          matrix,
          selectedAgents: changedRows(state.baselineMatrix, matrix),
          customPresetName: state.customPresetName
        },
        error: null
      };
    }
  }
  return state;
}

function row(name, value) {
  return `${name}: Model ${escapeTerminalText(value.model)} | Reasoning ${escapeTerminalText(value.reasoning)}`;
}

function screenLines(state) {
  const lines = ["csx setup", `Screen: ${state.screen}`, ""];
  let focus = 0;
  if (state.screen === "list") {
    lines.push("Current 8-role matrix:");
    for (const name of AGENT_NAMES) lines.push(`  ${row(name, state.baselineMatrix[name])}`);
    lines.push("", "Presets:");
    const start = lines.length;
    state.presets.forEach(({ id, label }, index) => {
      const active = state.activeEntryIds.includes(id) ? " [active]" : "";
      lines.push(`${index === state.listIndex ? ">" : " "} ${escapeTerminalText(label)}${active}`);
    });
    focus = start + state.listIndex;
    lines.push("", "↑/↓ Select  Enter Detail  Esc Cancel");
  } else if (state.screen === "detail") {
    lines.push(`${escapeTerminalText(state.selectedPresetLabel ?? state.selectedPreset)} detail:`);
    const rowStart = lines.length;
    AGENT_NAMES.forEach((name, index) => lines.push(`${state.detailIndex === index ? ">" : " "} ${row(name, state.startMatrix[name])}`));
    lines.push("");
    const start = lines.length;
    DETAIL_ACTIONS.forEach((label, index) => {
      lines.push(`${AGENT_NAMES.length + index === state.detailIndex ? ">" : " "} ${label}`);
    });
    focus = state.detailIndex < AGENT_NAMES.length ? rowStart + state.detailIndex : start + state.detailIndex - AGENT_NAMES.length;
    lines.push("Esc Back");
  } else if (state.screen === "edit") {
    lines.push(`${escapeTerminalText(state.selectedPresetLabel ?? state.selectedPreset)} edit (←/→ changes focused field):`);
    const start = lines.length;
    AGENT_NAMES.forEach((name, index) => {
      const value = state.draftMatrix[name];
      lines.push(`${state.editIndex === index * 2 ? ">" : " "} ${name} Model: ${escapeTerminalText(value.model)}`);
      lines.push(`${state.editIndex === index * 2 + 1 ? ">" : " "} ${name} Reasoning: ${escapeTerminalText(value.reasoning)}`);
    });
    lines.push(`${state.editIndex === editCount() - 1 ? ">" : " "} Continue to diff`);
    focus = start + state.editIndex;
    lines.push("Esc Detail");
  } else if (state.screen === "diff") {
    lines.push("Review selected changes:");
    const changes = changedRows(state.baselineMatrix, state.draftMatrix);
    const start = lines.length;
    changes.forEach((name, index) => {
      const selected = state.selectedRows.includes(name) ? "[x]" : "[ ]";
      const mandatory = state.mandatoryRows.includes(name) ? " [mandatory repair]" : "";
      lines.push(`${state.diffIndex === index ? ">" : " "} ${selected} ${name}${mandatory}`);
      lines.push(`    ${escapeTerminalText(state.baselineMatrix[name].model)}/${escapeTerminalText(state.baselineMatrix[name].reasoning)} -> ${escapeTerminalText(state.draftMatrix[name].model)}/${escapeTerminalText(state.draftMatrix[name].reasoning)}`);
    });
    if (!changes.length) lines.push("  No agent model changes.");
    lines.push(`${state.diffIndex === changes.length ? ">" : " "} Continue`);
    focus = start + state.diffIndex * (changes.length ? 2 : 1);
    lines.push("Enter toggles/continues  Esc Edit");
  } else if (state.screen === "save-custom-choice") {
    lines.push("Save this full matrix as a global custom preset?");
    lines.push(`${state.choiceIndex === 0 ? ">" : " "} Yes`, `${state.choiceIndex === 1 ? ">" : " "} No`);
    focus = 4 + state.choiceIndex;
  } else if (state.screen === "custom-name") {
    lines.push("Custom preset name:", `> ${escapeTerminalText(state.customNameInput)}_`, "Enter Continue  Esc Back");
    focus = 4;
  } else if (state.screen === "confirm" || state.screen === "applying") {
    lines.push("Final setup preview:");
    const changes = changedRows(state.baselineMatrix, state.draftMatrix);
    if (!changes.length) lines.push("  No agent model changes.");
    for (const name of changes) lines.push(`  ${row(name, state.draftMatrix[name])}`);
    if (state.customPresetName) lines.push(`  Save custom preset: ${escapeTerminalText(state.customPresetName)}`);
    if (state.screen === "confirm") {
      const start = lines.length;
      lines.push(...CONFIRM_ACTIONS.map(
        (label, index) => `${state.confirmIndex === index ? ">" : " "} ${label}`
      ));
      focus = start + state.confirmIndex;
    } else lines.push("Applying…");
  } else {
    lines.push(state.result?.outcome === "cancel" ? "Setup cancelled." : "Done.");
  }
  if (state.error) lines.push("", `ERROR: ${escapeTerminalText(state.error)}`);
  return { lines, focus };
}

function wrapLine(line, columns) {
  const result = [];
  let chunk = "";
  let width = 0;
  for (const character of line) {
    const nextWidth = characterWidth(character);
    if (chunk && width + nextWidth > columns) {
      result.push(chunk);
      chunk = "";
      width = 0;
    }
    chunk += character;
    width += nextWidth;
  }
  if (chunk || !result.length) result.push(chunk);
  return result;
}

function characterWidth(character) {
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

function compactFrame(text, columns, rows, page, prefix = ">", tail = []) {
  const chunks = [...wrapLine(`${prefix}${text}`, columns), ...tail];
  return chunks.slice(page * rows, (page + 1) * rows).join("\n");
}

function usesFocusedPaging(state) {
  if (!FOCUSED_PAGING_SCREENS.has(state.screen)) return false;
  if (
    state.screen === "list" &&
    state.presets.some(({ id, kind, label }) => {
      if (kind === "preset" && !state.activeEntryIds.includes(id)) return false;
      const active = state.activeEntryIds.includes(id) ? " [active]" : "";
      return wrapLine(`  ${escapeTerminalText(label)}${active}`, state.dimensions.columns).length > 1;
    })
  ) {
    return true;
  }
  const { lines } = screenLines(state);
  const wrappedLineCount = lines.reduce(
    (total, line) => total + wrapLine(line, state.dimensions.columns).length,
    0
  );
  return wrappedLineCount > Math.max(1, state.dimensions.rows - 1);
}

function focusedFrame(state) {
  if (!usesFocusedPaging(state)) return null;
  const { columns, rows } = state.dimensions;
  if (state.screen === "list") {
    const index = state.listCompactIndex;
    if (index < MATRIX_COMPACT_ITEMS) {
      return compactFrame(
        matrixCompactText(state.baselineMatrix, index),
        columns,
        rows,
        state.listCompactPage,
        ">",
        errorChunks(state, columns)
      );
    }
    const preset = state.presets[index - MATRIX_COMPACT_ITEMS];
    if (!preset) return null;
    const chunks = withErrorChunks(
      state,
      presetCompactChunks(preset, state.activeEntryIds.includes(preset.id), columns),
      columns
    );
    const pageRows = rows - 1;
    return [
      "Presets:",
      chunks.slice(state.listCompactPage * pageRows, (state.listCompactPage + 1) * pageRows).join("\n")
    ].join("\n");
  }
  if (state.screen === "detail") {
    const index = state.detailCompactIndex;
    if (index < MATRIX_COMPACT_ITEMS) {
      return compactFrame(
        matrixCompactText(state.startMatrix, index),
        columns,
        rows,
        state.detailCompactPage,
        ">",
        errorChunks(state, columns)
      );
    }
    const action = DETAIL_ACTIONS[index - MATRIX_COMPACT_ITEMS];
    if (!action) return null;
    if (index === MATRIX_COMPACT_ITEMS) {
      const chunks = withErrorChunks(state, detailEditChunks(state, columns), columns);
      return chunks.slice(state.detailCompactPage * rows, (state.detailCompactPage + 1) * rows).join("\n");
    }
    const chunks = withErrorChunks(state, [`> ${action}`], columns);
    return chunks.slice(state.detailCompactPage * rows, (state.detailCompactPage + 1) * rows).join("\n");
  }
  if (state.screen === "edit") {
    if (state.editIndex === editCount() - 1) {
      return compactFrame(
        " Continue to diff",
        columns,
        rows,
        state.editCompactPage,
        ">",
        errorChunks(state, columns)
      );
    }
    const agentIndex = Math.floor(state.editIndex / 2);
    const agent = AGENT_NAMES[agentIndex];
    if (!agent) return null;
    return compactFrame(
      editCompactText(state, state.editIndex),
      columns,
      rows,
      state.editCompactPage,
      ">",
      errorChunks(state, columns)
    );
  }
  if (state.screen === "diff") {
    const chunks = diffCompactChunks(state, state.diffIndex);
    return chunks.slice(state.diffCompactPage * rows, (state.diffCompactPage + 1) * rows).join("\n");
  }
  if (state.screen === "confirm") {
    const chunks = confirmCompactChunks(state, state.confirmCompactIndex);
    return chunks.slice(state.confirmCompactPage * rows, (state.confirmCompactPage + 1) * rows).join("\n");
  }
  if (state.screen === "custom-name") {
    const chunks = auxCompactChunks(state);
    return chunks.slice(state.auxCompactPage * rows, (state.auxCompactPage + 1) * rows).join("\n");
  }
  return null;
}

export function renderSetupState(state) {
  const focused = focusedFrame(state);
  if (focused !== null) return focused;
  const { lines, focus } = screenLines(state);
  const columns = state.dimensions.columns;
  const wrapped = lines.map((line) => wrapLine(line, columns));
  const offsets = [];
  let total = 0;
  for (const item of wrapped) {
    offsets.push(total);
    total += item.length;
  }
  const flat = wrapped.flat();
  const height = Math.max(1, state.dimensions.rows - 1);
  const focusLine = offsets[Math.min(focus, offsets.length - 1)] ?? 0;
  const start = Math.max(0, Math.min(focusLine - Math.floor(height / 2), flat.length - height));
  return flat.slice(start, start + height).join("\n");
}

export function SetupTui({ initialState, onResult, onAbort, columns, rows }) {
  const { stdout } = useStdout();
  const [state, setState] = useState(() => ({
    ...initialState,
    dimensions: dimensions({
      columns: columns ?? initialState.dimensions?.columns ?? stdout?.columns,
      rows: rows ?? initialState.dimensions?.rows ?? stdout?.rows
    })
  }));
  const delivered = useRef(false);
  useInput((input, key) => {
    if (input.includes("\u0004") || (key.ctrl && input.toLowerCase() === "d")) {
      onAbort?.();
      return;
    }
    setState((current) => reduceSetupState(current, { type: "KEY", input, key }));
  });
  useEffect(() => {
    if (columns !== undefined || rows !== undefined || !stdout?.on) return undefined;
    const resize = () => setState((current) => reduceSetupState(current, {
      type: "RESIZE",
      columns: stdout.columns,
      rows: stdout.rows
    }));
    stdout.on("resize", resize);
    return () => stdout.off?.("resize", resize);
  }, [stdout, columns, rows]);
  useEffect(() => {
    if (state.result && !delivered.current) {
      delivered.current = true;
      onResult(state.result);
    }
  }, [state.result, onResult]);
  return h(Text, null, renderSetupState(state));
}

function abortError() {
  const error = new Error("The setup input stream ended.");
  error.name = "AbortError";
  return error;
}

export async function runSetupTui(options = {}) {
  const {
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
    signalTarget = process,
    kill = process.kill.bind(process),
    pid = process.pid,
    renderImpl = render,
    signals = ["SIGINT", "SIGTERM", "SIGHUP"],
    columns,
    rows,
    ...stateOptions
  } = options;
  const initialState = options.initialState ?? createSetupState({ ...stateOptions, columns: columns ?? output.columns, rows: rows ?? output.rows });
  let app;
  let settled = false;
  let cleaned = false;
  const wasRaw = Boolean(input.isRaw);
  const canRaw = typeof input.setRawMode === "function";
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const handlers = new Map();
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const [signal, handler] of handlers) signalTarget.off?.(signal, handler);
    input.off?.("end", onEnd);
    try { app?.unmount?.(); } catch {}
    if (canRaw) try { input.setRawMode(wasRaw); } catch {}
    try { output.write("\u001B[?25h\u001B[?1049l"); } catch {}
  };
  const finish = (result) => {
    if (settled) return;
    settled = true;
    queueMicrotask(() => {
      cleanup();
      resolveResult(result);
    });
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult(error);
  };
  const onEnd = () => fail(abortError());
  try {
    output.write("\u001B[?1049h\u001B[?25l");
    if (canRaw && !wasRaw) input.setRawMode(true);
    input.on?.("end", onEnd);
    for (const signal of signals) {
      const handler = () => {
        if (settled) return;
        settled = true;
        cleanup();
        kill(pid, signal);
      };
      handlers.set(signal, handler);
      signalTarget.on?.(signal, handler);
    }
    app = renderImpl(h(SetupTui, { initialState, onResult: finish, onAbort: onEnd, columns, rows }), {
      stdin: input,
      stdout: output,
      stderr: errorOutput,
      exitOnCtrlC: false,
      patchConsole: false
    });
    if (cleaned) app?.unmount?.();
    app.waitUntilExit?.().catch(fail);
    return await resultPromise;
  } catch (error) {
    fail(error);
    return await resultPromise;
  } finally {
    cleanup();
  }
}
