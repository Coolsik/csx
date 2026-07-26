export const WORKFLOW_STATE_SCHEMA_CASES = Object.freeze([
  Object.freeze({
    name: "active exact keys",
    valid: true,
    restore: true,
    makeState: activeWorkflowState,
  }),
  Object.freeze({
    name: "active extra key",
    valid: false,
    restore: false,
    makeState: (fields) => ({ ...activeWorkflowState(fields), unexpected: true }),
  }),
  Object.freeze({
    name: "active missing key",
    valid: false,
    restore: false,
    makeState: (fields) => withoutKey(activeWorkflowState(fields), "updatedAt"),
  }),
  Object.freeze({
    name: "terminal exact keys",
    valid: true,
    restore: false,
    makeState: terminalWorkflowState,
  }),
  Object.freeze({
    name: "terminal extra key",
    valid: false,
    restore: false,
    makeState: (fields) => ({ ...terminalWorkflowState(fields), unexpected: true }),
  }),
  Object.freeze({
    name: "terminal missing key",
    valid: false,
    restore: false,
    makeState: (fields) => withoutKey(terminalWorkflowState(fields), "finishedAt"),
  }),
]);

export function activeWorkflowState({
  artifact = ".csx/goals/work.md",
  artifactSha256 = "0".repeat(64),
} = {}) {
  return {
    schema: "csx.workflow-state",
    version: 1,
    status: "active",
    instanceToken: "A".repeat(43),
    workflow: "csx-start-goal",
    phase: "implementation",
    artifact,
    artifactSha256,
    startedAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:01:00.000Z",
  };
}

export function terminalWorkflowState(fields = {}) {
  return {
    ...activeWorkflowState(fields),
    status: "terminal",
    finishedAt: "2026-07-26T00:02:00.000Z",
    terminalOutcome: "complete",
  };
}

function withoutKey(value, key) {
  const result = { ...value };
  delete result[key];
  return result;
}
