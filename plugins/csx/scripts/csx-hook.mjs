#!/usr/bin/env node

const SKILL_HINTS = {
  setup: "install the bundled csx custom subagent roles",
  analyze: "read-only repository analysis with file-backed evidence and confidence labels",
  spec: "requirements clarification with acceptance criteria, scope, non-goals, and assumptions",
  plan: "concise implementation plan with verification and risk checks",
  "plan-pro": "higher-rigor plan with bounded architect and critic review",
  "start-goal": "durable task execution with success criteria and evidence",
  "code-review": "severity-first diff review with independent reviewer lanes for substantial changes",
};

if (process.argv[2] === "user-prompt-submit") {
  runUserPromptSubmitHook(process.stdin, process.stdout);
}

function runUserPromptSubmitHook(stdin, stdout) {
  readAll(stdin)
    .then((raw) => {
      const payload = parsePayload(raw);
      if (!payload || payload.hook_event_name !== "UserPromptSubmit") return;

      const skill = detectCsxSkill(payload.prompt);
      if (!skill) return;

      stdout.write(formatContext(skill));
    })
    .catch(() => {});
}

function detectCsxSkill(prompt) {
  if (typeof prompt !== "string") return null;

  const match = prompt.match(/^\s*\$?csx(?::|\s+)(setup|analyze|spec|plan-pro|plan|start-goal|code-review)\b/i);
  if (!match) return null;

  const skill = match[1].toLowerCase();
  return Object.hasOwn(SKILL_HINTS, skill) ? skill : null;
}

function formatContext(skill) {
  const additionalContext = [
    "<csx-routing>",
    `Use the csx:${skill} skill for this request: ${SKILL_HINTS[skill]}.`,
    "Keep the workflow lightweight. Use bounded Codex subagent review only where that skill says it adds signal; otherwise stay in the main context.",
    "Do not require a custom runner, background service, MCP server, or separate CLI for csx work.",
    "</csx-routing>",
  ].join("\n");

  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  })}\n`;
}

function parsePayload(raw) {
  if (raw.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(data));
  });
}
