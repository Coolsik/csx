import process from "node:process";
import { discoverCodexModels } from "./codex-models.js";
import { cloneMatrix, validateMatrix } from "./presets.js";
import {
  applySetup,
  builtInPresets,
  codexModelContext,
  readSetupMatrix,
  readCustomPresets,
  selectSetupScope
} from "./setup.js";
import { runSetupTui } from "./setup-tui.js";
import { escapeTerminalText } from "./terminal-text.js";

function cloneCatalog(catalog) {
  return catalog.map(({ model, efforts }) => ({ model, efforts: [...efforts] }));
}

function presetEntries(builtIns, custom) {
  const builtInNames = new Set(Object.keys(builtIns).map((name) => name.toLowerCase()));
  return [
    ...Object.entries(builtIns).map(([name, matrix]) => ({ name, matrix: cloneMatrix(matrix) })),
    ...Object.entries(custom.presets).map(([name, matrix]) => ({
      name: builtInNames.has(name.toLowerCase()) ? `${name} (custom)` : name,
      storageName: name,
      kind: "custom",
      matrix: cloneMatrix(matrix)
    }))
  ];
}

function defaultResultOutput(result, { layout, output }) {
  output.write(result.changed
    ? `Updated ${escapeTerminalText(layout.scope)} csx setup.\n`
    : "Setup already matches the selected matrix.\n");
}

export async function runSetupCommand(options = {}, deps = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr
  } = options;
  const {
    selectSetupScopeFn = selectSetupScope,
    codexModelContextFn = codexModelContext,
    catalogLoader = discoverCodexModels,
    readSetupMatrixFn = readSetupMatrix,
    builtInPresetsFn = builtInPresets,
    readCustomPresetsFn = readCustomPresets,
    runSetupTuiFn = runSetupTui,
    applySetupFn = applySetup,
    resultOutputFn = defaultResultOutput
  } = deps;

  const layout = selectSetupScopeFn({ cwd, env });
  const modelContext = codexModelContextFn(layout, { env });
  const catalog = cloneCatalog(await catalogLoader(modelContext));
  const baselineMatrix = cloneMatrix(await readSetupMatrixFn(layout));
  const builtIns = await builtInPresetsFn();
  const custom = await readCustomPresetsFn({ env });
  const presets = presetEntries(builtIns, custom);

  const tuiResult = await runSetupTuiFn({
    input,
    output,
    errorOutput,
    baselineMatrix: cloneMatrix(baselineMatrix),
    presets,
    catalog: cloneCatalog(catalog),
    customPresetNames: Object.keys(custom.presets)
  });
  if (tuiResult?.outcome === "cancel") {
    output.write("Setup cancelled.\n");
    return { cancelled: true };
  }
  if (tuiResult?.outcome !== "apply") {
    throw new Error("setup TUI returned an invalid outcome.");
  }

  const matrix = cloneMatrix(tuiResult.matrix);
  validateMatrix(matrix, catalog);
  const result = await applySetupFn({
    layout,
    cwd,
    env,
    matrix,
    baselineMatrix: cloneMatrix(baselineMatrix),
    catalog: cloneCatalog(catalog),
    catalogLoader: () => catalogLoader(codexModelContextFn(layout, { env })),
    selectedAgents: [...tuiResult.selectedAgents],
    customPresetName: tuiResult.customPresetName
  });
  await resultOutputFn(result, { layout, output });
  return result;
}
