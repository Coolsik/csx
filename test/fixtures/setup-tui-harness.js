import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { applySetup } from "../../lib/setup.js";
import { runSetupCommand } from "../../lib/setup-command.js";
import { runSetupTui } from "../../lib/setup-tui.js";

if (process.env.CSX_SETUP_TUI_HARNESS === "1") await runHarness();

async function runHarness() {
  const tracked = JSON.parse(process.env.CSX_HARNESS_TRACKED ?? "{}");
  const expectedRaw = process.env.CSX_HARNESS_EXPECT_RAW
    ? JSON.parse(process.env.CSX_HARNESS_EXPECT_RAW)
    : null;
  const before = await snapshot(tracked);
  let applyCount = 0;
  let rawInputsMatch = expectedRaw ? false : undefined;

  try {
    const result = await runSetupCommand({}, {
      ...(expectedRaw ? {
        runSetupTuiFn: async (options) => {
          const custom = options.presets.find(({ name, kind }) =>
            kind === "custom" && name === expectedRaw.custom.name);
          const catalog = options.catalog.find(({ model }) =>
            model === expectedRaw.catalog.model);
          rawInputsMatch =
            isDeepStrictEqual(options.baselineMatrix, expectedRaw.baselineMatrix) &&
            isDeepStrictEqual(custom?.matrix, expectedRaw.custom.matrix) &&
            isDeepStrictEqual(catalog, expectedRaw.catalog);
          return runSetupTui(options);
        }
      } : {}),
      applySetupFn: async (options) => {
        applyCount += 1;
        return applySetup(options);
      }
    });
    const after = await snapshot(tracked);
    process.stdout.write(`HARNESS_RESULT ${JSON.stringify({
      ok: true,
      result,
      applyCount,
      changes: changedCounts(before, after),
      hashesUnchanged: sameSnapshot(before, after),
      ...(expectedRaw ? { rawInputsMatch } : {})
    })}\n`);
  } catch (error) {
    const after = await snapshot(tracked);
    process.stdout.write(`HARNESS_RESULT ${JSON.stringify({
      ok: false,
      error: { name: error?.name, message: error?.message, code: error?.code },
      applyCount,
      changes: changedCounts(before, after),
      hashesUnchanged: sameSnapshot(before, after),
      ...(expectedRaw ? { rawInputsMatch } : {})
    })}\n`);
    process.exitCode = 1;
  }
}

async function snapshot(groups) {
  return Object.fromEntries(await Promise.all(Object.entries(groups).map(async ([name, paths]) => [
    name,
    Object.fromEntries(await Promise.all(paths.map(async (path) => [
      path,
      await readFile(path).then(
        (value) => createHash("sha256").update(value).digest("hex"),
        (error) => error?.code === "ENOENT" ? null : Promise.reject(error)
      )
    ])))
  ])));
}

function changedCounts(before, after) {
  return Object.fromEntries(Object.keys(before).map((name) => [
    name,
    Object.keys(before[name]).filter((path) => before[name][path] !== after[name][path]).length
  ]));
}

function sameSnapshot(before, after) {
  return Object.keys(before).every((name) =>
    Object.keys(before[name]).every((path) => before[name][path] === after[name][path]));
}
