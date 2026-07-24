export const AGENT_NAMES = Object.freeze([
  "csx-explorer", "csx-analyst", "csx-planner", "csx-architect",
  "csx-critic", "csx-executor", "csx-verifier", "csx-code-reviewer"
]);

const LOW = Object.freeze({
  "csx-analyst": { model: "gpt-5.6-luna", reasoning: "high" },
  "csx-architect": { model: "gpt-5.6-terra", reasoning: "high" },
  "csx-code-reviewer": { model: "gpt-5.6-terra", reasoning: "xhigh" },
  "csx-critic": { model: "gpt-5.6-terra", reasoning: "xhigh" },
  "csx-executor": { model: "gpt-5.6-luna", reasoning: "low" },
  "csx-explorer": { model: "gpt-5.6-terra", reasoning: "low" },
  "csx-planner": { model: "gpt-5.6-luna", reasoning: "high" },
  "csx-verifier": { model: "gpt-5.6-terra", reasoning: "xhigh" }
});
const MEDIUM = Object.freeze({
  "csx-analyst": { model: "gpt-5.6-terra", reasoning: "high" },
  "csx-architect": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "xhigh" },
  "csx-critic": { model: "gpt-5.6-sol", reasoning: "xhigh" },
  "csx-executor": { model: "gpt-5.6-terra", reasoning: "low" },
  "csx-explorer": { model: "gpt-5.6-sol", reasoning: "low" },
  "csx-planner": { model: "gpt-5.6-terra", reasoning: "high" },
  "csx-verifier": { model: "gpt-5.6-sol", reasoning: "xhigh" }
});

export function presetMatrix(name, payloadMatrix) {
  if (typeof name !== "string") throw new Error(`unknown preset: ${name}`);
  const normalized = name.trim().toLowerCase();
  if (normalized === "low") return cloneMatrix(LOW);
  if (normalized === "medium") return cloneMatrix(MEDIUM);
  if (normalized === "high") {
    if (!payloadMatrix) throw new Error("High preset requires the installed payload agent definitions.");
    return cloneMatrix(payloadMatrix);
  }
  throw new Error(`unknown preset: ${name}`);
}

export function cloneMatrix(matrix) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix) || Object.keys(matrix).length !== AGENT_NAMES.length || Object.keys(matrix).some((name) => !AGENT_NAMES.includes(name))) {
    throw new Error("preset must define exactly the eight csx agents.");
  }
  const output = {};
  for (const agent of AGENT_NAMES) {
    const value = matrix[agent];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.model !== "string" || !value.model || typeof value.reasoning !== "string" || !value.reasoning) throw new Error(`preset is missing ${agent}.`);
    output[agent] = { model: value.model, reasoning: value.reasoning };
  }
  return output;
}

export function validateMatrix(matrix, catalog) {
  const models = new Map(catalog.map(({ model, efforts }) => [model, new Set(efforts)]));
  for (const [agent, value] of Object.entries(cloneMatrix(matrix))) {
    if (!models.get(value.model)?.has(value.reasoning)) {
      throw new Error(`${agent} uses unavailable model/effort pair ${value.model}/${value.reasoning}.`);
    }
  }
}
