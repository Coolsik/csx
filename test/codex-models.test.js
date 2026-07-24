import assert from "node:assert/strict";
import test from "node:test";
import { discoverCodexModels, normalizeCatalog } from "../lib/codex-models.js";

test("model catalog uses the strict paginated model/list protocol", async () => {
  const calls = [];
  const catalog = await discoverCodexModels({ request: async (method, params) => {
    calls.push({ method, params });
    return params.cursor
      ? { data: [{ model: "second", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: null }
      : { data: [{ model: "first", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "low" }] }], nextCursor: "next" };
  } });

  assert.deepEqual(calls, [
    { method: "model/list", params: { includeHidden: false } },
    { method: "model/list", params: { cursor: "next", includeHidden: false } }
  ]);
  assert.deepEqual(catalog, [
    { model: "first", efforts: ["medium", "low"] },
    { model: "second", efforts: ["high"] }
  ]);
});

test("model catalog rejects omitted page cursors, hidden entries, and duplicate advertised values", async () => {
  await assert.rejects(
    discoverCodexModels({ request: async () => ({ data: [] }) }),
    /invalid model catalog page/
  );
  assert.throws(
    () => normalizeCatalog({ data: [
      { model: "same", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
      { model: "same", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "high" }] }
    ] }),
    /duplicate model/
  );
  assert.throws(
    () => normalizeCatalog({ data: [{
      model: "same",
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "low" }]
    }] }),
    /duplicate or empty reasoning efforts/
  );
  for (const entry of [
    { model: "missing", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
    { model: "hidden", hidden: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }] }
  ]) {
    assert.throws(
      () => normalizeCatalog({ data: [entry] }),
      /invalid model catalog entry/
    );
  }
});
