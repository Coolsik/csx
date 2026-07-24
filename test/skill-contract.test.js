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
  "csx-verifier",
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

test("csx-start-goal delegates decomposition, implementation, verification, and review", async () => {
  const skill = await readSkill("csx-start-goal");

  assert.match(skill, /Use exactly one aggregate Codex goal for the entire accepted plan/);
  assert.match(skill, /Never create one Codex goal per execution goal/);
  assert.match(skill, /Do not impose a count limit on acceptance criteria/);
  assert.match(skill, /Every acceptance criterion from the accepted input is a required criterion/);
  assert.match(skill, /do not replace, merge, weaken, or summarize away original criteria or failure signals/);
  assert.match(skill, /Before implementation, assign each criterion concrete expected evidence/);
  assert.match(skill, /Assign `csx-planner` the accepted spec or plan/);
  assert.match(skill, /complete `G001\.\.\.Gnnn` execution breakdown/);
  assert.match(skill, /do not repair the decomposition in the root/);
  assert.match(skill, /Always assign every implementation and code-changing rework goal to `csx-executor`/);
  assert.match(skill, /Evidence-only revalidation is not an implementation assignment and remains owned by `csx-verifier`/);
  assert.match(skill, /rather than by a root fast path/);
  assert.match(skill, /The Executor must not invoke another skill or subagent/);
  assert.match(skill, /invoke `\$csx-deslop` from the root/);
  assert.match(skill, /Authorize the Deslop orchestration to increment and record one new parent revision/);
  assert.match(skill, /Run independent goals in parallel only when the Planner breakdown gives them no dependency and no overlapping file ownership/);
  assert.match(skill, /A dependency is satisfied for execution when every prerequisite is `ready_for_review`/);
  assert.match(skill, /Maintain one active owner per path/);
  assert.match(skill, /explicit ordered ownership handoff/);
  assert.match(skill, /Initialize `change_revision` as `R000`/);
  assert.match(skill, /Require every Verifier and code-review result to echo its assigned `change_revision`/);
  assert.match(skill, /invalidate scoped Verifier and deslop evidence for every goal whose owned files changed/);
  assert.match(skill, /return the exact defect to the same Executor when possible for one bounded retry/);
  assert.match(skill, /assign `csx-verifier` the current `change_revision`, goal's mapped criteria/);
  assert.match(skill, /Assign `csx-verifier` the current `change_revision`, entire accepted input/);
  assert.match(skill, /Continue only on integrated `PASS`/);
  assert.match(skill, /Begin final review only when every execution goal is `ready_for_review`/);
  assert.match(skill, /Invoke `\$csx-code-review`/);
  assert.match(skill, /Move affected goals to `rework`[\s\S]*assign every code-changing rework fix to `csx-executor`/);
  assert.match(skill, /send the finding, current artifact, and ownership history to `csx-planner`/);
  assert.match(skill, /Validate the replacement against the same criterion coverage, dependency, one-active-owner, handoff, verification, and stop-condition rules/);
  assert.match(skill, /Do not hand the file back merely to refresh evidence/);
  assert.match(skill, /union of invariants for the current owner and every evidence-only affected goal/);
  assert.match(skill, /replacement for invalidated prior deslop evidence/);
  assert.match(skill, /only `PASS` may return it from `rework` to `ready_for_review`/);
  assert.match(skill, /up to 5 cumulative review iterations/);
  assert.match(skill, /same blocking finding survives two bounded repair attempts/);
  assert.match(skill, /never reuse invalidated scoped, integrated, deslop, or review evidence/);
  assert.match(skill, /call `update_goal` with `complete` exactly once/);
});

test("csx-deslop delegates cleanup to Executor and proof to Verifier", async () => {
  const [skill, executor, verifier, metadata] = await Promise.all([
    readSkill("csx-deslop"),
    readAgent("csx-executor"),
    readAgent("csx-verifier"),
    readFile(resolve(root, "payload/skills/csx-deslop/agents/openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /`csx-executor` owns baseline execution, smell analysis, safe code cleanup/);
  assert.match(skill, /`csx-verifier` independently proves the final behavior-preservation claim/);
  assert.match(skill, /Assign `csx-executor` the input evidence revision, bounded goal/);
  assert.match(skill, /lock existing behavior by running the assigned verification unchanged before editing/);
  assert.match(skill, /apply one safe smell category at a time/);
  assert.match(skill, /require the invoking root to increment and record the parent `change_revision`/);
  assert.match(skill, /Assign `csx-verifier` the final evidence revision/);
  assert.match(skill, /Require the Verifier to echo the final evidence revision/);
  assert.match(skill, /Final evidence revision: <revision echoed by Verifier>/);
  assert.match(skill, /return `PASS`, `PARTIAL`, or `FAIL` with an evidence matrix/);
  assert.match(skill, /Never report `passed` unless[\s\S]*`csx-verifier` returned `PASS`/);
  assert.doesNotMatch(executor, /\$csx-deslop/);
  assert.match(executor, /Do not[\s\S]*invoke another workflow/);
  assert.doesNotMatch(verifier, /sandbox_mode = "read-only"/);
  assert.match(metadata, /allow_implicit_invocation: false/);
});

test("csx-code-review always delegates code review and conditionally delegates architecture", async () => {
  const skill = await readSkill("csx-code-review");

  assert.match(skill, /Always spawn `csx-code-reviewer`/);
  assert.match(skill, /include it in every required reviewer assignment and require each result plus the composite result to echo it/);
  assert.match(skill, /missing or mismatched revision is stale review evidence/);
  assert.match(skill, /also spawn `csx-architect` in parallel/);
  assert.match(skill, /Record `csx-architect: skipped-trivial` only when every condition holds/);
  assert.match(skill, /Uncertainty makes the Architect lane required/);
  assert.match(skill, /`REQUEST CHANGES`: Code Reviewer returns `REQUEST CHANGES`, Architect returns `BLOCK`/);
  assert.match(skill, /`APPROVE`: Code Reviewer returns `APPROVE`; Architect is `CLEAR` or was validly skipped/);
  assert.match(skill, /must not perform either specialist review itself/);
});

test("start-goal and installer retain explicit execution and installed-role contracts", async () => {
  const [skill, installer, readme] = await Promise.all([
    readSkill("csx-start-goal"),
    readFile(resolve(root, "lib/install.js"), "utf8"),
    readFile(resolve(root, "README.md"), "utf8"),
  ]);

  assert.match(skill, /For a csx plan, accept only `Decision: READY`/);
  assert.match(skill, /For a csx pro plan, accept only `Decision: APPROVED`/);
  assert.match(skill, /Reject every `BLOCKED` plan/);
  assert.match(skill, /explicit `Start execution with \$csx-start-goal` selection/);
  assert.match(installer, /"csx-verifier"/);
  assert.match(readme, /Agent prompts define general, workflow-independent roles/);
  assert.match(readme, /`csx-verifier` independently gates scoped\s+goal evidence/);
});
