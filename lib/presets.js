export const LEADER_NAME = "leader";
export const LEGACY_VERIFIER_NAME = "csx-verifier";
export const AGENT_NAMES = Object.freeze([
  "csx-explorer", "csx-analyst", "csx-planner", "csx-architect",
  "csx-critic", "csx-executor", "csx-code-reviewer"
]);
export const WORKFLOW_LEADER_NAMES = Object.freeze([
  "csx-plan-leader", "csx-start-goal-leader"
]);
export const INSTALLED_AGENT_NAMES = Object.freeze([
  ...AGENT_NAMES, ...WORKFLOW_LEADER_NAMES
]);
export const ROLE_NAMES = Object.freeze([LEADER_NAME, ...AGENT_NAMES]);

const EFFICIENT = Object.freeze({
  leader: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-explorer": { model: "gpt-5.6-luna", reasoning: "high" },
  "csx-analyst": { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-planner": { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-architect": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-critic": { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-executor": { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "medium" }
});

const BALANCED = Object.freeze({
  leader: { model: "gpt-5.6-luna", reasoning: "max" },
  "csx-explorer": { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "csx-analyst": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-planner": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-architect": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-critic": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-executor": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "high" }
});

const STRONG = Object.freeze({
  leader: { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-explorer": { model: "gpt-5.6-sol", reasoning: "medium" },
  "csx-analyst": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-planner": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-architect": { model: "gpt-5.6-sol", reasoning: "xhigh" },
  "csx-critic": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-executor": { model: "gpt-5.6-sol", reasoning: "high" },
  "csx-code-reviewer": { model: "gpt-5.6-sol", reasoning: "xhigh" }
});

const PRESETS = Object.freeze({
  efficient: EFFICIENT,
  balanced: BALANCED,
  strong: STRONG
});

const LEGACY_ALIASES = Object.freeze({
  low: "efficient",
  medium: "balanced",
  high: "strong"
});

export const RESERVED_PRESET_NAMES = Object.freeze([
  ...Object.keys(PRESETS),
  ...Object.keys(LEGACY_ALIASES),
  "custom"
]);

export function presetMatrix(name) {
  if (typeof name !== "string") throw new Error(`unknown preset: ${name}`);
  const requested = name.trim().toLowerCase();
  const normalized = LEGACY_ALIASES[requested] ?? requested;
  const matrix = PRESETS[normalized];
  if (!matrix) throw new Error(`unknown preset: ${name}`);
  return cloneMatrix(matrix);
}

export function cloneMatrix(matrix) {
  return cloneExactMatrix(matrix, ROLE_NAMES, "preset must define exactly leader and the seven csx agents.");
}

export function upgradeLegacyMatrix(matrix) {
  const legacyNames = [...AGENT_NAMES, LEGACY_VERIFIER_NAME];
  const legacy = cloneExactMatrix(matrix, legacyNames, "legacy matrix must define exactly the eight csx agents.");
  const upgraded = { leader: { ...BALANCED.leader } };
  for (const agent of AGENT_NAMES) upgraded[agent] = legacy[agent];
  return upgraded;
}

export function validateMatrix(matrix, catalog) {
  const models = new Map(catalog.map(({ model, efforts }) => [model, new Set(efforts)]));
  for (const [role, value] of Object.entries(cloneMatrix(matrix))) {
    if (!models.get(value.model)?.has(value.reasoning)) {
      throw new Error(`${role} uses unavailable model/effort pair ${value.model}/${value.reasoning}.`);
    }
  }
}

function cloneExactMatrix(matrix, names, message) {
  const keys = matrix && typeof matrix === "object" && !Array.isArray(matrix)
    ? Object.keys(matrix)
    : [];
  if (keys.length !== names.length || keys.some((name) => !names.includes(name))) {
    throw new Error(message);
  }
  const output = {};
  for (const name of names) {
    const value = matrix[name];
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      typeof value.model !== "string" ||
      !value.model ||
      typeof value.reasoning !== "string" ||
      !value.reasoning
    ) {
      throw new Error(`preset is missing ${name}.`);
    }
    output[name] = { model: value.model, reasoning: value.reasoning };
  }
  return output;
}
