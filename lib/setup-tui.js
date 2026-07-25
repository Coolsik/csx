import process from "node:process";
import React, { useEffect, useRef, useState } from "react";
import { Box, render, Text, useInput, useStdout } from "ink";
import { AGENT_NAMES, cloneMatrix } from "./presets.js";
import { escapeTerminalText } from "./terminal-text.js";

const h = React.createElement;
const RESERVED_NAMES = new Set(["low", "medium", "high", "custom"]);
const REVIEW_ACTIONS = ["Apply", "Cancel"];
const ALL_ROLES = "all";

const ROLE_PRESENTATION = Object.freeze({
  "csx-explorer": { tag: "EXPLORE", label: "Explorer", color: "cyan" },
  "csx-analyst": { tag: "ANALYST", label: "Analyst", color: "blue" },
  "csx-planner": { tag: "PLANNER", label: "Planner", color: "yellow" },
  "csx-architect": { tag: "ARCH", label: "Architect", color: "magenta" },
  "csx-critic": { tag: "CRITIC", label: "Critic", color: "red" },
  "csx-executor": { tag: "EXEC", label: "Executor", color: "green" },
  "csx-verifier": { tag: "VERIFY", label: "Verifier", color: "white" },
  "csx-code-reviewer": { tag: "REVIEW", label: "Code reviewer", color: "gray" }
});

const TAG_COLORS = new Map(
  Object.values(ROLE_PRESENTATION).map(({ tag, color }) => [tag, color])
);
const TAG_PATTERN = new RegExp(`(\\[(?:${[...TAG_COLORS.keys()].join("|")})\\])`, "g");

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
      matrix: cloneMatrix(matrix)
    }));
  }
  return Object.entries(presets ?? {}).map(([name, matrix], index) => ({
    id: `preset:${index}`,
    name,
    kind: "preset",
    matrix: cloneMatrix(matrix)
  }));
}

export function matchingPresetNames(matrix, presets) {
  return presetEntries(presets)
    .filter(({ matrix: candidate }) => matrixMatches(matrix, candidate))
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

function cloneCatalog(catalog) {
  return (catalog ?? []).map(({ model, efforts }) => ({ model, efforts: [...efforts] }));
}

export function createSetupState({
  baselineMatrix,
  presets,
  catalog,
  customPresetNames,
  columns,
  rows
} = {}) {
  const baseline = cloneMatrix(baselineMatrix);
  const entries = presetEntries(presets);
  return {
    screen: "models",
    baselineMatrix: baseline,
    draftMatrix: cloneMatrix(baseline),
    presets: entries,
    catalog: cloneCatalog(catalog),
    customPresetNames: [
      ...(customPresetNames ?? entries.filter(({ kind }) => kind === "custom").map(({ name }) => name))
    ],
    modelIndex: 0,
    roleIndex: 0,
    effortIndex: 0,
    presetIndex: 0,
    reviewIndex: 0,
    page: 0,
    selectedModel: null,
    pendingTarget: null,
    customPresetName: undefined,
    customNameInput: "",
    error: null,
    dimensions: dimensions({ columns, rows }),
    result: null
  };
}

function duplicatePresetNames(state) {
  return matchingPresetNames(state.draftMatrix, state.presets);
}

function modelItems(state) {
  const items = state.catalog.map(({ model }) => ({ kind: "model", id: `model:${model}`, model }));
  for (const agent of invalidRows(state.draftMatrix, state.catalog)) {
    items.push({ kind: "invalid", id: `invalid:${agent}`, agent });
  }
  items.push({ kind: "load-preset", id: "load-preset" });
  items.push({ kind: "save", id: "save" });
  items.push({ kind: "review", id: "review" });
  items.push({ kind: "cancel", id: "cancel" });
  return items;
}

function reviewItems(state) {
  const items = changedRows(state.baselineMatrix, state.draftMatrix)
    .map((agent) => ({ kind: "change", id: `change:${agent}`, agent }));
  if (!items.length) items.push({ kind: "no-changes", id: "no-changes" });
  if (state.customPresetName) items.push({ kind: "pending-save", id: "pending-save" });
  items.push({ kind: "apply", id: "apply" }, { kind: "cancel", id: "cancel" });
  return items;
}

function itemsForScreen(state) {
  if (state.screen === "models") return modelItems(state);
  if (state.screen === "assign-role") {
    return [
      ...AGENT_NAMES.map((agent) => ({ kind: "role", id: agent, agent })),
      { kind: "role", id: ALL_ROLES, agent: ALL_ROLES }
    ];
  }
  if (state.screen === "assign-effort") {
    const efforts = state.catalog.find(({ model }) => model === state.selectedModel)?.efforts ?? [];
    return efforts.map((effort) => ({ kind: "effort", id: effort, effort }));
  }
  if (state.screen === "presets") return state.presets;
  if (state.screen === "custom-name") return [{ kind: "custom-name", id: "custom-name" }];
  if (state.screen === "review") return reviewItems(state);
  return [];
}

function indexKey(state) {
  if (state.screen === "models") return "modelIndex";
  if (state.screen === "assign-role") return "roleIndex";
  if (state.screen === "assign-effort") return "effortIndex";
  if (state.screen === "presets") return "presetIndex";
  if (state.screen === "review") return "reviewIndex";
  return null;
}

function selectedIndex(state) {
  const key = indexKey(state);
  return key ? state[key] : 0;
}

function selectedItem(state) {
  return itemsForScreen(state)[selectedIndex(state)];
}

function findModelItemIndex(state, kind) {
  return Math.max(0, modelItems(state).findIndex((item) => item.kind === kind));
}

function roleLabel(agent) {
  return ROLE_PRESENTATION[agent]?.label ?? agent;
}

function roleTag(agent) {
  return ROLE_PRESENTATION[agent]?.tag ?? agent;
}

function escapedPair(value) {
  return `${escapeTerminalText(value.model)}/${escapeTerminalText(value.reasoning)}`;
}

function badgesForModel(state, model) {
  return AGENT_NAMES
    .filter((agent) => state.draftMatrix[agent].model === model)
    .map((agent) => `[${roleTag(agent)}] (${escapeTerminalText(state.draftMatrix[agent].reasoning)})`)
    .join(" ");
}

function saveLabel(state) {
  const invalid = invalidRows(state.draftMatrix, state.catalog);
  if (invalid.length) return "Save custom preset — repair unavailable assignments first [disabled]";
  if (state.customPresetName) {
    return `Save custom preset: ${escapeTerminalText(state.customPresetName)} [pending]`;
  }
  const matches = duplicatePresetNames(state);
  if (matches.length) {
    return `Already saved as ${matches.map(escapeTerminalText).join(", ")} [disabled]`;
  }
  return "Save custom preset";
}

function itemLines(state, item, selected) {
  const prefix = selected ? "> " : "  ";
  let lines;
  if (state.screen === "models") {
    if (item.kind === "model") {
      const badges = badgesForModel(state, item.model);
      lines = [`${prefix}${escapeTerminalText(item.model)}${badges ? `  ${badges}` : ""}`];
    } else if (item.kind === "invalid") {
      lines = [
        `${prefix}! ${roleTag(item.agent)}: ${escapedPair(state.draftMatrix[item.agent])} is unavailable`
      ];
    } else if (item.kind === "load-preset") {
      lines = [`${prefix}Load preset`];
    } else if (item.kind === "save") {
      lines = [`${prefix}${saveLabel(state)}`];
    } else if (item.kind === "review") {
      const count = changedRows(state.baselineMatrix, state.draftMatrix).length;
      lines = [`${prefix}Review & apply${count ? ` (${count} changed)` : ""}`];
    } else {
      lines = [`${prefix}Cancel`];
    }
  } else if (state.screen === "assign-role") {
    if (item.agent === ALL_ROLES) {
      lines = [`${prefix}All roles`];
    } else {
      lines = [
        `${prefix}[${roleTag(item.agent)}] ${roleLabel(item.agent)}  ${escapedPair(state.draftMatrix[item.agent])}`
      ];
    }
  } else if (state.screen === "assign-effort") {
    lines = [`${prefix}${escapeTerminalText(item.effort)}`];
  } else if (state.screen === "presets") {
    const active = matrixMatches(state.draftMatrix, item.matrix) ? " [active]" : "";
    const custom = item.kind === "custom" ? " [custom]" : "";
    lines = [`${prefix}${escapeTerminalText(item.name)}${custom}${active}`];
    if (selected) {
      lines.push(...AGENT_NAMES.map((agent) =>
        `    [${roleTag(agent)}] ${escapedPair(item.matrix[agent])}`
      ));
    }
  } else if (state.screen === "custom-name") {
    lines = [
      "Custom preset name:",
      `${prefix}${escapeTerminalText(state.customNameInput)}_`,
      "Enter Save pending name  Esc Back"
    ];
  } else if (state.screen === "review") {
    if (item.kind === "change") {
      lines = [
        `${prefix}[${roleTag(item.agent)}] ${roleLabel(item.agent)}`,
        `    ${escapedPair(state.baselineMatrix[item.agent])} -> ${escapedPair(state.draftMatrix[item.agent])}`
      ];
    } else if (item.kind === "no-changes") {
      lines = [`${prefix}No agent model changes.`];
    } else if (item.kind === "pending-save") {
      lines = [`${prefix}Save custom preset: ${escapeTerminalText(state.customPresetName)}`];
    } else {
      const label = item.kind === "apply" ? REVIEW_ACTIONS[0] : REVIEW_ACTIONS[1];
      lines = [`${prefix}${label}`];
    }
  } else {
    lines = [];
  }
  if (selected && state.error) lines.push("", `ERROR: ${escapeTerminalText(state.error)}`);
  return lines;
}

function screenHeading(state) {
  if (state.screen === "models") return ["csx setup", "Models", ""];
  if (state.screen === "assign-role") {
    return ["csx setup", `Assign ${escapeTerminalText(state.selectedModel)} to`, ""];
  }
  if (state.screen === "assign-effort") {
    const target = state.pendingTarget === ALL_ROLES
      ? "All roles"
      : roleLabel(state.pendingTarget);
    return ["csx setup", `Effort for ${target}: ${escapeTerminalText(state.selectedModel)}`, ""];
  }
  if (state.screen === "presets") return ["csx setup", "Load preset", ""];
  if (state.screen === "custom-name") return ["csx setup", "Save custom preset", ""];
  if (state.screen === "review" || state.screen === "applying") {
    return ["csx setup", "Final setup preview", ""];
  }
  return ["csx setup", state.result?.outcome === "cancel" ? "Setup cancelled." : "Done."];
}

function screenHelp(state) {
  if (state.screen === "models") return ["", "↑/↓ Select  Enter Open  Esc Cancel"];
  if (state.screen === "assign-role") return ["", "↑/↓ Select  Enter Continue  Esc Models"];
  if (state.screen === "assign-effort") return ["", "↑/↓ Select  Enter Assign  Esc Roles"];
  if (state.screen === "presets") return ["", "↑/↓ Select  Enter Load  Esc Models"];
  if (state.screen === "review") return ["", "↑/↓ Select  Enter Action  Esc Models"];
  return [];
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

function wrapLine(line, columns) {
  const result = [];
  let chunk = "";
  let width = 0;
  const flush = () => {
    if (!chunk) return;
    result.push(chunk);
    chunk = "";
    width = 0;
  };
  for (const token of line.split(TAG_PATTERN)) {
    const match = /^\[([A-Z]+)\]$/.exec(token);
    const tag = match && TAG_COLORS.has(match[1]);
    if (tag) {
      const tokenWidth = [...token].reduce((total, character) => total + characterWidth(character), 0);
      if (chunk && width + tokenWidth > columns) flush();
      chunk += token;
      width += tokenWidth;
      continue;
    }
    for (const character of token) {
      const nextWidth = characterWidth(character);
      if (chunk && width + nextWidth > columns) flush();
      chunk += character;
      width += nextWidth;
    }
  }
  if (chunk || !result.length) {
    if (chunk) {
      result.push(chunk);
    } else {
      result.push("");
    }
  }
  return result;
}

function wrapLines(lines, columns) {
  return lines.flatMap((line) => wrapLine(line, columns));
}

function screenFrame(state) {
  if (state.screen === "done") return screenHeading(state);
  if (state.screen === "applying") return [...screenHeading(state), "Applying…"];
  const items = itemsForScreen(state);
  const index = Math.min(selectedIndex(state), Math.max(0, items.length - 1));
  const renderedItems = items.map((item, itemIndex) => itemLines(state, item, itemIndex === index));
  const columns = state.dimensions.columns;
  const rows = state.dimensions.rows;
  const heading = wrapLines(screenHeading(state), columns);
  const wrappedItems = renderedItems.map((lines) => wrapLines(lines, columns));
  const help = wrapLines(screenHelp(state), columns);
  const wrapped = [...heading, ...wrappedItems.flat(), ...help];
  if (wrapped.length <= rows) return wrapped;
  const focused = wrappedItems[index] ?? [""];
  if (focused.length > rows) {
    const pageCount = Math.max(1, Math.ceil(focused.length / rows));
    const page = Math.min(state.page, pageCount - 1);
    return focused.slice(page * rows, (page + 1) * rows);
  }
  const focusStart = heading.length + wrappedItems
    .slice(0, index)
    .reduce((total, lines) => total + lines.length, 0);
  const centered = focusStart - Math.floor((rows - focused.length) / 2);
  const start = Math.max(0, Math.min(centered, wrapped.length - rows));
  return wrapped.slice(start, start + rows);
}

export function renderSetupState(state) {
  return screenFrame(state).join("\n");
}

function focusedPageCount(state, index = selectedIndex(state)) {
  const items = itemsForScreen(state);
  if (!items.length) return 1;
  const focused = wrapLines(
    itemLines(state, items[index], true),
    state.dimensions.columns
  );
  return Math.max(1, Math.ceil(focused.length / state.dimensions.rows));
}

function move(index, delta, count) {
  return count ? (index + delta + count) % count : 0;
}

function navigate(state, delta) {
  const key = indexKey(state);
  if (!key) {
    if (state.screen !== "custom-name") return state;
    const pageCount = focusedPageCount(state);
    return {
      ...state,
      page: move(state.page, delta, pageCount)
    };
  }
  const count = itemsForScreen(state).length;
  if (!count) return state;
  const pageCount = focusedPageCount(state);
  if (delta > 0 && state.page + 1 < pageCount) return { ...state, page: state.page + 1, error: null };
  if (delta < 0 && state.page > 0) return { ...state, page: state.page - 1, error: null };
  const nextIndex = move(state[key], delta, count);
  const next = { ...state, [key]: nextIndex, page: 0, error: null };
  if (delta < 0) next.page = focusedPageCount(next, nextIndex) - 1;
  return next;
}

function roleDefaultEffort(state, target) {
  const efforts = state.catalog.find(({ model }) => model === state.selectedModel)?.efforts ?? [];
  if (!efforts.length) return 0;
  if (target === ALL_ROLES) {
    const first = state.draftMatrix[AGENT_NAMES[0]];
    if (
      AGENT_NAMES.every((agent) => samePair(state.draftMatrix[agent], first)) &&
      first.model === state.selectedModel
    ) {
      const index = efforts.indexOf(first.reasoning);
      if (index >= 0) return index;
    }
    return 0;
  }
  const current = state.draftMatrix[target];
  if (current?.model !== state.selectedModel) return 0;
  const index = efforts.indexOf(current.reasoning);
  return index < 0 ? 0 : index;
}

function openEffort(state, target) {
  return {
    ...state,
    screen: "assign-effort",
    pendingTarget: target,
    effortIndex: roleDefaultEffort(state, target),
    page: 0,
    error: null
  };
}

function applyEffort(state) {
  const item = selectedItem(state);
  if (!item?.effort) return { ...state, error: "No effort is available for this model." };
  const agents = state.pendingTarget === ALL_ROLES ? AGENT_NAMES : [state.pendingTarget];
  const draft = cloneMatrix(state.draftMatrix);
  for (const agent of agents) {
    draft[agent] = { model: state.selectedModel, reasoning: item.effort };
  }
  const changed = !matrixMatches(draft, state.draftMatrix);
  const next = {
    ...state,
    screen: "models",
    draftMatrix: draft,
    customPresetName: changed ? undefined : state.customPresetName,
    pendingTarget: null,
    error: null,
    page: 0
  };
  next.modelIndex = Math.max(
    0,
    modelItems(next).findIndex((candidate) =>
      candidate.kind === "model" && candidate.model === state.selectedModel
    )
  );
  return next;
}

function loadPreset(state, preset) {
  const changed = !matrixMatches(state.draftMatrix, preset.matrix);
  const next = {
    ...state,
    screen: "models",
    draftMatrix: cloneMatrix(preset.matrix),
    customPresetName: changed ? undefined : state.customPresetName,
    error: null,
    page: 0
  };
  next.modelIndex = findModelItemIndex(next, "load-preset");
  return next;
}

function cancelResult(state) {
  return { ...state, screen: "done", result: { outcome: "cancel" }, error: null };
}

export function reduceSetupState(state, action) {
  if (action.type === "RESIZE") {
    const resized = { ...state, dimensions: dimensions(action) };
    return { ...resized, page: Math.min(state.page, focusedPageCount(resized) - 1) };
  }
  if (action.type === "SET_CUSTOM_NAME") {
    return { ...state, customNameInput: action.value, page: 0, error: null };
  }
  if (action.type !== "KEY" || state.screen === "done" || state.screen === "applying") return state;
  const { key = {}, input = "" } = action;
  const up = key.upArrow;
  const down = key.downArrow;
  const enter = key.return;
  const escape = key.escape;

  if (up || down) return navigate(state, up ? -1 : 1);

  if (state.screen === "models") {
    if (escape) return cancelResult(state);
    if (!enter) return state;
    const item = selectedItem(state);
    if (item?.kind === "model") {
      return {
        ...state,
        screen: "assign-role",
        selectedModel: item.model,
        roleIndex: 0,
        page: 0,
        error: null
      };
    }
    if (item?.kind === "invalid") {
      return { ...state, error: `Repair ${item.agent} by assigning an available model and effort.` };
    }
    if (item?.kind === "load-preset") {
      return { ...state, screen: "presets", presetIndex: 0, page: 0, error: null };
    }
    if (item?.kind === "save") {
      const invalid = invalidRows(state.draftMatrix, state.catalog);
      if (invalid.length) {
        return { ...state, error: `Repair unavailable Model/Reasoning pairs: ${invalid.join(", ")}` };
      }
      const matches = duplicatePresetNames(state);
      if (!state.customPresetName && matches.length) {
        return { ...state, error: `This matrix is already saved as ${matches.join(", ")}.` };
      }
      return {
        ...state,
        screen: "custom-name",
        customNameInput: state.customPresetName ?? "",
        page: 0,
        error: null
      };
    }
    if (item?.kind === "review") {
      const invalid = invalidRows(state.draftMatrix, state.catalog);
      if (invalid.length) {
        return { ...state, error: `Repair unavailable Model/Reasoning pairs: ${invalid.join(", ")}` };
      }
      const next = { ...state, screen: "review", page: 0, error: null, reviewIndex: 0 };
      next.reviewIndex = Math.max(
        0,
        reviewItems(next).findIndex((candidate) => candidate.kind === "apply")
      );
      return next;
    }
    if (item?.kind === "cancel") return cancelResult(state);
  } else if (state.screen === "assign-role") {
    if (escape) return { ...state, screen: "models", page: 0, error: null };
    if (enter) return openEffort(state, selectedItem(state)?.agent);
  } else if (state.screen === "assign-effort") {
    if (escape) return { ...state, screen: "assign-role", page: 0, error: null };
    if (enter) return applyEffort(state);
  } else if (state.screen === "presets") {
    if (escape) return {
      ...state,
      screen: "models",
      modelIndex: findModelItemIndex(state, "load-preset"),
      page: 0,
      error: null
    };
    if (enter) return loadPreset(state, selectedItem(state));
  } else if (state.screen === "custom-name") {
    if (escape) {
      const next = { ...state, screen: "models", page: 0, error: null };
      next.modelIndex = findModelItemIndex(next, "save");
      return next;
    }
    if (key.backspace || key.delete) {
      return {
        ...state,
        customNameInput: state.customNameInput.slice(0, -1),
        page: 0,
        error: null
      };
    }
    if (enter) {
      const error = validateCustomPresetName(state.customNameInput, state.customPresetNames);
      if (error) return { ...state, page: 0, error };
      const next = {
        ...state,
        screen: "models",
        customPresetName: state.customNameInput.trim(),
        page: 0,
        error: null
      };
      next.modelIndex = findModelItemIndex(next, "save");
      return next;
    }
    if (input && !key.ctrl && !key.meta) {
      return {
        ...state,
        customNameInput: state.customNameInput + input,
        page: 0,
        error: null
      };
    }
  } else if (state.screen === "review") {
    if (escape) {
      const next = { ...state, screen: "models", page: 0, error: null };
      next.modelIndex = findModelItemIndex(next, "review");
      return next;
    }
    if (!enter) return state;
    const item = selectedItem(state);
    if (item?.kind === "cancel") return cancelResult(state);
    if (item?.kind === "apply") {
      const invalid = invalidRows(state.draftMatrix, state.catalog);
      if (invalid.length) {
        return { ...state, page: 0, error: `Final matrix has unavailable pairs: ${invalid.join(", ")}` };
      }
      return {
        ...state,
        screen: "applying",
        result: {
          outcome: "apply",
          matrix: cloneMatrix(state.draftMatrix),
          selectedAgents: changedRows(state.baselineMatrix, state.draftMatrix),
          customPresetName: state.customPresetName
        },
        error: null
      };
    }
  }
  return state;
}

function StyledLine({ line, lineIndex }) {
  const parts = line.split(TAG_PATTERN);
  const selected = line.startsWith(">");
  const error = line.startsWith("ERROR:");
  const warning = line.includes("unavailable") || line.startsWith("!");
  const disabled = line.includes("[disabled]");
  const heading = lineIndex < 2 && !selected;
  return h(
    Text,
    {
      color: error ? "red" : warning ? "yellow" : selected ? "cyan" : disabled ? "gray" : undefined,
      bold: heading || selected,
      dimColor: disabled
    },
    ...parts.map((part, index) => {
      const match = /^\[([A-Z]+)\]$/.exec(part);
      if (!match || !TAG_COLORS.has(match[1])) return part;
      return h(
        Text,
        {
          key: `${lineIndex}:${index}`,
          color: "black",
          backgroundColor: TAG_COLORS.get(match[1]),
          bold: true
        },
        part
      );
    })
  );
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
  return h(
    Box,
    { flexDirection: "column" },
    ...screenFrame(state).map((line, index) =>
      h(StyledLine, { key: index, line, lineIndex: index })
    )
  );
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
  const initialState = options.initialState ?? createSetupState({
    ...stateOptions,
    columns: columns ?? output.columns,
    rows: rows ?? output.rows
  });
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
    app = renderImpl(h(SetupTui, {
      initialState,
      onResult: finish,
      onAbort: onEnd,
      columns,
      rows
    }), {
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
