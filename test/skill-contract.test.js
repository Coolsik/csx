import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentNames = [
  "csx-analyst",
  "csx-architect",
  "csx-code-reviewer",
  "csx-critic",
  "csx-executor",
  "csx-explorer",
  "csx-planner",
];
const skillNames = [
  "csx-analyze",
  "csx-code-review",
  "csx-deslop",
  "csx-plan",
  "csx-plan-pro",
  "csx-spec",
  "csx-start-goal",
];

async function readAgent(name) {
  return readFile(resolve(root, "payload", "agents", `${name}.toml`), "utf8");
}

async function readSkill(name) {
  return readFile(resolve(root, "payload", "skills", name, "SKILL.md"), "utf8");
}

test("agent prompts define complete general role contracts", async () => {
  for (const name of agentNames) {
    const agent = await readAgent(name);
    for (const section of [
      "Identity",
      "Responsibilities",
      "Working Method",
      "Evidence Standard",
      "Boundaries",
      "Output and Stop Conditions",
    ]) {
      assert.match(agent, new RegExp(`^${section}$`, "m"), `${name} must define ${section}`);
    }
    assert.match(agent, /You are a leaf subagent\. Do not spawn or delegate to child agents\./);
  }
});

test("agent prompts stay independent from workflow-specific contracts", async () => {
  const forbidden = [
    /csx-plan-pro/,
    /csx-start-goal/,
    /\$csx-deslop/,
    /draft_version/,
    /READY_WITH_ASSUMPTIONS/,
    /SKIPPED_LOW_RISK/,
    /PASS, PARTIAL, or FAIL/,
  ];

  for (const name of agentNames) {
    const agent = await readAgent(name);
    for (const pattern of forbidden) {
      assert.doesNotMatch(agent, pattern, `${name} must not contain workflow contract ${pattern}`);
    }
  }
});

test("every skill constructs complete subagent assignments", async () => {
  for (const name of skillNames) {
    const skill = await readSkill(name);
    for (const field of [
      "Objective:",
      "Inputs:",
      "Scope:",
      "Required work/checks:",
      "Expected deliverable:",
      "Constraints:",
      "Stop conditions:",
    ]) {
      assert.match(skill, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} must assign ${field}`);
    }
  }
});

test("every skill uses complete output discipline without fixed token caps", async () => {
  const forbidden = [
    /\b\d[\d,]*\s+tokens?\b/i,
    /^## Token Budget$/m,
    /\btoken budgets?\b/i,
    /\blane cap\b/i,
    /\bcombined cap\b/i,
    /\bfinal synthesis cap\b/i,
  ];

  for (const name of skillNames) {
    const skill = await readSkill(name);
    assert.match(skill, /^## Subagent Output and Liveness Policy$/m);
    assert.match(skill, /Do not set or request a fixed token count/);
    assert.match(skill, /smallest complete deliverable/);
    assert.match(skill, /preserves every required field, cited fact, evidence boundary, verdict, blocker, and stop condition/);
    assert.match(skill, /return the skill's missing-evidence or blocked vocabulary/);
    assert.match(skill, /instead of dropping required content, inventing facts, or broadening scope/);
    for (const pattern of forbidden) {
      assert.doesNotMatch(skill, pattern, `${name} must not contain fixed token-cap guidance ${pattern}`);
    }
  }
});

test("every skill applies the common activity-aware subagent liveness policy", async () => {
  for (const name of skillNames) {
    const skill = await readSkill(name);
    assert.match(skill, /Apply this policy to every direct subagent spawn or resume in this skill/);
    assert.match(skill, /allow at least five minutes before inactivity handling/);
    assert.match(skill, /three consecutive minutes pass without new observable activity/);
    assert.match(skill, /measured from the later of the grace-period end or the last activity/);
    assert.match(skill, /send exactly one status check/);
    assert.match(skill, /allow two additional minutes for activity/);
    assert.match(skill, /terminate the inactive agent and confirm termination before creating a replacement/);
    assert.match(skill, /Create at most one availability replacement for that direct assignment/);
    assert.match(skill, /Never run the replacement concurrently with the agent it replaces/);
    assert.match(skill, /If the replacement also becomes inactive under this policy/);
    assert.match(skill, /A tool or command known to still be running is not agent inactivity/);
    assert.match(skill, /This skill monitors only its direct subagent calls/);
    assert.match(skill, /A child skill monitors the agents it calls/);
    assert.match(skill, /Use the environment's existing agent controls/);
    assert.match(skill, /Do not implement a custom runner, background service, or hard-kill timer/);
  }
});

test("csx-analyze delegates investigation and final synthesis to Explorer", async () => {
  const skill = await readSkill("csx-analyze");

  assert.match(skill, /`csx-explorer` owns repository investigation and the evidence-backed answer/);
  assert.match(skill, /stop with `BLOCKED: csx-explorer unavailable`/);
  assert.match(skill, /Do not replace repository investigation with root-authored analysis/);
  assert.match(skill, /spawn 2-3 bounded `csx-explorer` agents in parallel/);
  assert.match(skill, /Assign one final `csx-explorer` the original question plus every successful evidence packet/);
  assert.match(skill, /resend its complete bounded assignment once/);
  assert.match(skill, /final Explorer must inspect that missing scope itself/);
  assert.match(skill, /pass the final Explorer evidence packet and original question to `\$csx-spec`/);
  assert.match(skill, /rank competing explanations by support/);
  assert.match(skill, /`Evidence`, `Inference`, or `Unknown`/);
  assert.match(skill, /`High`, `Medium`, or `Low` confidence/);
  assert.match(skill, /must not replace a required Explorer result with self-authored repository analysis/);
  assert.match(skill, /Simple lookup: 1-3 files/);
  assert.match(skill, /Cross-file behavior: 4-8 files/);
  assert.match(skill, /stop after two search waves unless new evidence changes the ranking/);
  assert.match(skill, /Keep the final synthesis proportional to the question/);
});

test("csx-spec delegates requirements judgment and spec content to Analyst", async () => {
  const skill = await readSkill("csx-spec");

  for (const dimension of [
    "Intent",
    "Outcome",
    "Scope",
    "Non-goals",
    "Constraints",
    "Acceptance",
    "Decisions",
  ]) {
    assert.match(skill, new RegExp(`\\| ${dimension} \\|`));
  }
  for (const status of ["READY", "READY_WITH_ASSUMPTIONS", "BLOCKED"]) {
    assert.match(skill, new RegExp(`\\b${status}\\b`));
  }

  assert.match(skill, /`csx-analyst` owns the ambiguity assessment/);
  assert.match(skill, /After repository evidence is available for brownfield work, assign `csx-analyst`/);
  assert.match(skill, /Reuse a current upstream `csx-analyze` evidence packet/);
  assert.match(skill, /Do not inspect and interpret those repository facts in the root/);
  assert.match(skill, /complete specification body in the Artifact Shape below/);
  assert.match(skill, /does not rescore them/);
  assert.match(skill, /Do not update the ambiguity, scope, or decision ledgers in the root independently/);
  assert.match(skill, /Persist the accepted Analyst specification body without independently rewriting its requirements/);
  assert.match(skill, /up to three questions in one call only when they are independent/);
  assert.match(skill, /lightweight scope ledger when/);
  assert.match(skill, /prompt-safe summary/);
  assert.match(skill, /\.csx\/specs\/<slug>\.draft\.md/);
  assert.match(skill, /Write `\.csx\/specs\/<slug>\.md` only for `READY` or `READY_WITH_ASSUMPTIONS`/);
  assert.match(skill, /Do not replace the missing role with root-authored repository or requirements analysis/);
  assert.match(skill, /use two sequential `request_user_input` calls/);
  assert.match(skill, /honor an already explicit downstream request before asking again/);
  assert.match(skill, /counts even when it does not use a literal `\$csx-\*` name/);
  assert.match(skill, /`Choose downstream workflow \(Recommended\)`/);
  assert.match(skill, /Recommend `\$csx-start-goal` when the spec is execution-ready/);
  assert.match(skill, /Recommend `\$csx-plan` when requirements are ready/);
  assert.match(skill, /Recommend `\$csx-plan-pro` for broad, risky, cross-module, or architecture-sensitive work/);
  assert.match(skill, /selecting it explicitly authorizes implementation/);
  assert.match(skill, /Invoke only the workflow the user explicitly selects/);
});

test("csx-plan always delegates draft authorship and preserves versioned review", async () => {
  const skill = await readSkill("csx-plan");

  assert.match(skill, /`csx-planner` owns every plan draft/);
  assert.doesNotMatch(skill, /## Mode Selection/);
  assert.match(skill, /invoke `\$csx-spec` from the root and stop this planning pass/);
  assert.match(skill, /Do not fill the gap with root-authored requirements/);
  assert.match(skill, /reuse its packet/);
  assert.match(skill, /Always give the request or spec, evidence packet, and user decisions to `csx-planner`/);
  assert.match(skill, /Never skip Planner delegation while this skill is active/);
  assert.match(skill, /A low-risk plan touching one obvious area may skip only independent Critic review/);
  assert.match(skill, /give `csx-critic` the original request or accepted spec, every user decision and assumption, the current repository evidence packet/);
  assert.match(skill, /Require the Critic to cross-check the draft against all of those inputs/);
  assert.match(skill, /draft_version: 1/);
  assert.match(skill, /`REVISE`:[\s\S]*`draft_version: 2`/);
  assert.match(skill, /A revised draft MUST receive one fresh Critic review/);
  assert.match(skill, /do not revise a third version in `csx-plan`/);
  assert.match(skill, /Any material change after approval invalidates that verdict/);
  assert.match(skill, /for every completed plan whether the final Decision is `READY` or `BLOCKED`/);
  assert.match(skill, /The root must not rewrite the draft/);
  assert.match(skill, /## Planner Body Shape/);
  assert.match(skill, /Place the exact final Planner body inside the Artifact Format envelope without modification/);
  assert.match(skill, /\| Criterion \| Evidence \| Command or Scenario \| Expected Result \| Failure Signal \|/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx-plan-pro delegates all specialist judgments and binds consensus to one version", async () => {
  const skill = await readSkill("csx-plan-pro");

  assert.match(skill, /`csx-planner` owns every draft/);
  assert.match(skill, /`csx-architect` owns architectural review/);
  assert.match(skill, /`csx-critic` owns actionability review/);
  assert.match(skill, /If an accepted final csx spec is supplied/);
  assert.match(skill, /Reuse current evidence instead of repeating discovery/);
  assert.match(skill, /The Planner assignment must require `draft_version: 1`/);
  assert.match(skill, /Spawn `csx-architect` with the complete exact draft and version/);
  assert.match(skill, /After the Architect result returns, spawn `csx-critic`/);
  assert.match(skill, /Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same `draft_version`/);
  assert.match(skill, /increment `draft_version` by exactly one/);
  assert.match(skill, /Run a fresh Architect review followed by a fresh Critic review for the new version/);
  assert.match(skill, /maximum of 5 review cycles/);
  assert.match(skill, /BLOCKED artifact containing the best draft and unresolved blockers/);
  assert.match(skill, /final Critic result to confirm that the consensus draft matches the original request/);
  assert.match(skill, /require one `Revision Brief` that reconciles both reviews/);
  assert.match(skill, /Critic-owned `Revision Brief`/);
  assert.match(skill, /root must not synthesize or reinterpret specialist feedback/);
  assert.match(skill, /Any post-review change[\s\S]*invalidates both verdicts/);
  assert.match(skill, /The Planner assignment must require/);
  assert.match(skill, /### Decision Drivers/);
  assert.match(skill, /### Options Considered/);
  assert.match(skill, /three concrete failure scenarios/);
  assert.match(skill, /unit, integration, e2e, and observability verification/);
  assert.match(skill, /## Planner Body Shape/);
  assert.match(skill, /Place the exact Planner body reviewed in the consensus cycle inside the artifact envelope without modification/);
  assert.match(skill, /pre-draft BLOCKED artifact/);
  assert.match(skill, /Planner Body to `Not created — blocked before drafting`/);
  assert.match(skill, /The Architect assignment must review boundary, threat, compatibility, and rollback risk/);
  assert.match(skill, /The Critic assignment must return `REVISE` or `BLOCKED`/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx-start-goal uses proportional executor, deslop, final-command, and review gates", async () => {
  const skill = await readSkill("csx-start-goal");

  assert.match(skill, /Use exactly one aggregate Codex goal for the entire accepted plan/);
  assert.match(skill, /Classify every proposed requirement, check, and review finding as exactly one/);
  assert.match(skill, /accepted scope/);
  assert.match(skill, /change-induced safety or regression/);
  assert.match(skill, /optional hardening/);
  assert.match(skill, /Only the first two classes may block completion/);
  assert.match(skill, /smallest evidence set that directly proves each criterion/);
  assert.match(skill, /full suite once in the primary environment/);
  assert.match(skill, /bounded smoke coverage in other supported environments/);
  assert.match(skill, /Preserve every acceptance criterion and stable identifier/);
  assert.match(skill, /Assign `csx-planner` the accepted input/);
  assert.match(skill, /complete `G001\.\.\.Gnnn` breakdown/);
  assert.match(skill, /Always assign implementation and code-changing rework to `csx-executor`/);
  assert.match(skill, /invoke `\$csx-deslop` once/);
  assert.match(skill, /There is no separate scoped evidence agent/);
  assert.doesNotMatch(skill, /csx-verifier/);
  assert.doesNotMatch(skill, /\bVerifier\b/);
  assert.match(skill, /execute the accepted cumulative verification once/);
  assert.match(skill, /root records commands, environment, exit status, and concise raw summaries/);
  assert.match(skill, /Do not create a separate integrated evidence agent/);
  assert.match(skill, /A test-only change invalidates results that use that test, not unrelated product evidence/);
  assert.match(skill, /A documentation-only change invalidates documentation evidence, not product behavior evidence/);
  assert.match(skill, /Run only independent, non-overlapping goals in parallel/);
  assert.match(skill, /maintain one active owner per path/i);
  assert.match(skill, /Initialize `change_revision` as `R000`/);
  assert.match(skill, /Architecture Boundary Review/);
  assert.match(skill, /Reuse a current Architect `CLEAR` from an approved `csx-plan-pro`/);
  assert.match(skill, /Diff size and file count alone do not require it/);
  assert.match(skill, /at most two bounded repairs for the same blocking finding/);
  assert.match(skill, /at most three cumulative review iterations/);
  assert.match(skill, /current revision, current goal state, latest valid evidence, and open findings/);
  assert.match(skill, /call `update_goal` with `complete` exactly once/);
});

test("csx-deslop delegates one cleanup and identical before-after proof to Executor", async () => {
  const [skill, executor, metadata] = await Promise.all([
    readSkill("csx-deslop"),
    readAgent("csx-executor"),
    readFile(resolve(root, "payload/skills/csx-deslop/agents/openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /`csx-executor` owns baseline execution, smell analysis, safe cleanup/);
  assert.match(skill, /run the assigned behavior lock before editing/);
  assert.match(skill, /apply one safe smell category at a time/);
  assert.match(skill, /run the exact same behavior lock after the final state/);
  assert.match(skill, /for `cleaned`, increment the standalone revision/i);
  assert.match(skill, /Result: passed\/cleaned \| passed\/no-op \| blocked/);
  assert.match(skill, /Never report `passed` unless the exact same behavior lock succeeded before and after/);
  assert.match(skill, /Do not introduce new edge cases, platforms, threat models/);
  assert.doesNotMatch(skill, /csx-verifier/);
  assert.doesNotMatch(executor, /\$csx-deslop/);
  assert.match(executor, /Do not[\s\S]*invoke another workflow/);
  assert.match(metadata, /allow_implicit_invocation: false/);
});

test("csx-code-review always delegates code review and conditionally delegates architecture", async () => {
  const skill = await readSkill("csx-code-review");

  assert.match(skill, /Always spawn `csx-code-reviewer`/);
  assert.match(skill, /include it in every required reviewer assignment and require each result plus the composite result to echo it/);
  assert.match(skill, /missing or mismatched revision is stale review evidence/);
  assert.match(skill, /classification of every finding as `accepted-scope defect`/);
  assert.match(skill, /Spawn `csx-architect` only when the final diff introduces, changes, or departs from/);
  assert.match(skill, /Diff size, file count, or ordinary cross-module call flow alone do not require the lane/);
  assert.match(skill, /Only `accepted-scope defect` and `change-induced safety\/regression` findings may produce/);
  assert.match(skill, /`optional hardening` is non-blocking follow-up material/);
  assert.match(skill, /Classification: accepted-scope defect \/ change-induced safety\/regression \/ optional hardening/);
  assert.match(skill, /`APPROVE`: Code Reviewer returns `APPROVE`; Architect is `CLEAR` or was validly skipped/);
  assert.match(skill, /must not perform either specialist review itself/);
});

test("spec and planning workflows keep support and verification proportional", async () => {
  const [spec, plan, planPro] = await Promise.all([
    readSkill("csx-spec"),
    readSkill("csx-plan"),
    readSkill("csx-plan-pro"),
  ]);

  assert.match(spec, /Do not translate vague quality words[\s\S]*into unbounded inputs/);
  assert.match(spec, /Optional hardening is a non-goal or follow-up/);
  assert.match(spec, /minimum or maximum support boundary[\s\S]*user-owned decision/);
  assert.match(plan, /smallest evidence set that directly proves the accepted criteria/);
  assert.match(plan, /one full suite in the primary environment plus bounded smoke coverage/);
  assert.match(plan, /reject duplicated verification rows and scope-expanding hardening/);
  assert.match(planPro, /Architect and Critic may block only the first two classes/);
  assert.match(planPro, /no blocking verdict based only on optional hardening or duplicated verification/);
  assert.match(planPro, /Critic must use the same three concern classes/);
  assert.match(planPro, /Default to one primary-environment full suite plus affected-environment smoke checks/);
});

test("start-goal and installer retain explicit execution contracts without verifier", async () => {
  const [skill, installer, readme] = await Promise.all([
    readSkill("csx-start-goal"),
    readFile(resolve(root, "lib/install.js"), "utf8"),
    readFile(resolve(root, "README.md"), "utf8"),
  ]);

  assert.match(skill, /For a csx plan, accept only `Decision: READY`/);
  assert.match(skill, /For a csx pro plan, accept only `Decision: APPROVED`/);
  assert.match(skill, /Reject every `BLOCKED` plan/);
  assert.match(skill, /explicit `Start execution with \$csx-start-goal` selection/);
  assert.doesNotMatch(installer, /"csx-verifier"/);
  assert.match(readme, /Agent prompts define general, workflow-independent roles/);
  assert.doesNotMatch(readme, /`csx-verifier` remains installed/);
});
