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
  "csx-loop",
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

test("csx-loop is a closed-list skill with explicit-only metadata", async () => {
  const metadata = await readFile(
    resolve(root, "payload/skills/csx-loop/agents/openai.yaml"),
    "utf8",
  );

  assert.deepEqual(skillNames.filter((name) => name === "csx-loop"), ["csx-loop"]);
  assert.match(metadata, /allow_implicit_invocation: false/);
});

test("loop composition consumes the exact bounded context and live authority contract", async () => {
  const childNames = ["csx-spec", "csx-plan", "csx-plan-pro", "csx-start-goal"];
  const contextFields = [
    "source",
    "original_invocation",
    "original_request",
    "work_slug",
    "spec_path",
    "spec_status",
    "spec_recommendation",
    "plan_kind",
    "plan_path",
    "plan_status",
    "accepted_reversible_assumptions",
    "last_completed_stage",
    "remaining_stages",
    "continuation_authority",
    "repository_marker",
    "affected_evidence",
    "pending_decision",
    "attempt_counters",
  ];

  for (const name of childNames) {
    const skill = await readSkill(name);
    assert.match(skill, /^## csx-loop (?:Composition|Entry) Contract$/m);
    for (const field of contextFields) {
      assert.match(skill, new RegExp(`^${field}$`, "m"), `${name} must consume ${field}`);
    }
    assert.match(skill, /current user turn with `consumed: false`/);
    assert.match(skill, /persisted enum|stored `continuation_authority/);
    assert.match(skill, /unrelated answer/);
    assert.match(skill, /question, blocker, cancellation, unrelated turn/);
    assert.match(skill, /deployment, an external message, deletion, additional permission/i);
  }

  const loop = await readSkill("csx-loop");
  assert.match(loop, /Bind each live authority instance to:[\s\S]*current_user_turn[\s\S]*consumed: false/);
  assert.match(loop, /consume that authority exactly once/);
  assert.match(loop, /derive authority for the single next transition/);
  assert.match(loop, /Never derive across a user question, stop, cancellation, unrelated turn, reported blocker/);
});

test("csx-loop fixes stage order, one plan branch, resume, and hard stops", async () => {
  const loop = await readSkill("csx-loop");

  assert.match(loop, /csx-spec -> exactly one of csx-plan \| csx-plan-pro -> csx-start-goal/);
  assert.match(loop, /Planning is never skipped/);
  assert.match(loop, /\| `csx-start-goal` \| `\$csx-plan` \|/);
  assert.match(loop, /Never call both planning skills and never create both plan artifacts/);
  assert.match(loop, /Accept `\$csx-plan` only with `Decision: READY`/);
  assert.match(loop, /Accept `\$csx-plan-pro` only with `Decision: APPROVED`/);
  assert.match(loop, /same-version Architect `CLEAR` and Critic `APPROVED`/);
  assert.match(loop, /stored `continuation_authority` value is audit provenance only/);
  assert.match(loop, /current input is the answer to the exact outstanding question/);
  assert.match(loop, /nearby, stale, or unrelated answer does not qualify/);
  assert.match(loop, /entire current prompt is exactly `\$csx-loop resume <work-slug>` or `csx loop resume <work-slug>`/);
  assert.match(loop, /The resume command does not answer the unresolved decision/);
  assert.match(loop, /BLOCKING_USER_DECISION/);
  assert.match(loop, /Answering this exact pending decision continues the remaining workflow and implementation/);
  assert.match(loop, /any child `BLOCKED` result/);
  assert.match(loop, /required CSX role is missing/);
  assert.match(loop, /review, revision, retry, verification, or repair limit is exhausted/);
  assert.match(loop, /distinct active aggregate goal/);
  assert.match(loop, /permission or safety gate/);
  assert.match(loop, /never auto-select or auto-loop `Refine further`/i);
});

test("spec-stage blockers use draft-only checkpoints and resume fail closed", async () => {
  const [loop, spec] = await Promise.all([
    readSkill("csx-loop"),
    readSkill("csx-spec"),
  ]);
  const checkpoint = loop.match(
    /^## Checkpoint and Resume$[\s\S]*?(?=^## Progress and Completion$)/m,
  )?.[0];

  assert.ok(checkpoint, "csx-loop must define a bounded checkpoint consumer");

  // Bind the existing csx-spec producer to the exact path consumed by csx-loop.
  const draftPath = /\.csx\/specs\/<work-slug>\.draft\.md/;
  assert.match(spec, /\.csx\/specs\/<slug>\.draft\.md/);
  assert.match(spec, /For a `BLOCKED` draft[\s\S]*`Status: BLOCKED`/);
  assert.match(spec, /Write `\.csx\/specs\/<slug>\.md` only for `READY` or `READY_WITH_ASSUMPTIONS`/);
  assert.match(spec, /The root may append workflow provenance and handoff metadata/);
  assert.match(checkpoint, draftPath);
  assert.match(checkpoint, /`\$csx-spec` is the producer/);
  assert.match(checkpoint, /only while the `csx-spec` stage is incomplete/);

  // A draft preserves the exact context needed to reject mismatched recovery.
  for (const field of [
    "source: csx-loop",
    "work_slug",
    "original_invocation",
    "original_request",
    "last_completed_stage",
    "remaining_stages",
    "pending_decision",
    "attempt_counters",
    "continuation_authority",
    "repository_marker",
    "affected_evidence",
  ]) {
    const fieldPattern = new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(checkpoint, fieldPattern);
    assert.match(spec, fieldPattern, `csx-spec producer must receive ${field}`);
  }
  assert.match(checkpoint, /`last_completed_stage` that does not claim `csx-spec` completion/);
  assert.match(checkpoint, /`remaining_stages` whose first item is `csx-spec`/);
  assert.match(checkpoint, /stable `pending_decision` whose embedded `work_slug` matches and whose `stage` is `csx-spec`/);
  assert.match(checkpoint, /exact outstanding question and controlled downstream decision/);
  assert.match(checkpoint, /Missing, stale, or conflicting draft context is not a checkpoint and creates no authority/);
  assert.match(checkpoint, /Only after the persisted checkpoint fields pass may live authority bind its `current_stage` to `csx-spec`/);
  assert.match(checkpoint, /do not persist `current_stage` as an alternate loop-context field/);
  assert.doesNotMatch(checkpoint, /`current_stage: csx-spec`/);

  // Exact answer/resume re-enters spec; only a new final result unlocks fixed order.
  assert.match(checkpoint, /exact pending-decision answer[\s\S]*validate `renewed-by-answer`[\s\S]*incomplete `\$csx-spec` stage/);
  assert.match(checkpoint, /exact `\$csx-loop resume <work-slug>` or `csx loop resume <work-slug>`[\s\S]*validate `explicit-resume`[\s\S]*re-enter the incomplete `\$csx-spec` stage/);
  assert.match(checkpoint, /Resume does not answer an unresolved question[\s\S]*same stable blocker until its exact answer arrives/);
  assert.match(checkpoint, /No initial call, unrelated answer, or stale, mismatched, or nearby answer or resume may reuse or alter the draft or create authority/);
  assert.match(checkpoint, /Only after resumed `\$csx-spec` returns `READY` or `READY_WITH_ASSUMPTIONS`[\s\S]*writes `\.csx\/specs\/<work-slug>\.md`[\s\S]*continue through exactly one planning stage and `\$csx-start-goal` in the fixed order/);
  assert.match(checkpoint, /Do not rerun any already completed final stage/);

  // Negative boundary: draft is neither READY nor a replacement final artifact.
  assert.match(checkpoint, /Never treat a draft as a final spec, `READY`, `READY_WITH_ASSUMPTIONS`, or authority to select a plan or enter `\$csx-start-goal`/);
  assert.match(checkpoint, /The draft never replaces `\.csx\/specs\/<work-slug>\.md`/);
  assert.match(checkpoint, /final artifacts remain the only completed-stage checkpoints/);
  assert.match(checkpoint, /Do not create `\.csx\/loops` or any other loop state artifact/);
});

test("loop-aware spec and plans return to their parent without weakening standalone handoffs", async () => {
  const [spec, plan, planPro] = await Promise.all([
    readSkill("csx-spec"),
    readSkill("csx-plan"),
    readSkill("csx-plan-pro"),
  ]);

  assert.match(spec, /Return only `spec_path`, `spec_status`, `spec_recommendation`/);
  assert.match(spec, /Do not ask either final handoff question and do not invoke a downstream workflow/);
  assert.match(spec, /For `BLOCKED`, return only the blocker and last valid checkpoint/);
  assert.match(spec, /Invalid or missing loop context uses the standalone behavior/);

  assert.match(plan, /only when the final artifact has `Decision: READY`/);
  assert.match(plan, /Return `plan_path`, `plan_kind: csx-plan`, `plan_status: READY`/);
  assert.match(plan, /do not call `request_user_input` and do not invoke `\$csx-start-goal`/);
  assert.match(plan, /immutable Planner Body and the maximum of 5 review cycles remain unchanged/);
  assert.match(plan, /If the loop context or live authority is absent or invalid, use the standalone handoff below unchanged/);

  assert.match(planPro, /Architect `CLEAR` and Critic `APPROVED` for the same accepted `draft_version`/);
  assert.match(planPro, /Return `plan_path`, `plan_kind: csx-plan-pro`, `plan_status: APPROVED`/);
  assert.match(planPro, /Architect `WATCH` or `BLOCK`, Critic `REVISE` or `BLOCKED`/);
  assert.match(planPro, /review exhaustion cannot pass this gate/);
  assert.match(planPro, /Never auto-select or auto-loop `Refine further`/);
  assert.match(planPro, /immutable Planner Body and every existing review, revision, and maximum of 5 review cycles remain unchanged/);
  assert.match(planPro, /If the loop context or live authority is absent or invalid, use the standalone handoff below unchanged/);

  assert.match(spec, /use two sequential `request_user_input` calls/);
  assert.match(plan, /After writing the artifact, call `request_user_input`/);
  assert.match(planPro, /After writing the artifact, call `request_user_input`/);
});

test("start-goal loop entry fails closed and retains the aggregate completion gate", async () => {
  const skill = await readSkill("csx-start-goal");

  assert.match(skill, /through exactly one of these parallel branches/);
  assert.match(skill, /matching final spec with `spec_status: READY \| READY_WITH_ASSUMPTIONS`/);
  assert.match(skill, /exactly one matching plan artifact/);
  assert.match(skill, /`plan_kind: csx-plan` with `plan_status: READY`/);
  assert.match(skill, /`plan_kind: csx-plan-pro` with `plan_status: APPROVED`/);
  assert.match(skill, /matching path, slug, original boundary, accepted `draft_version`, and artifact status/);
  assert.match(skill, /bounded revalidation of only the `affected_evidence`/);
  assert.match(skill, /a distinct active goal is a hard stop/);
  assert.match(skill, /Consume the entry authority exactly once only after every check/);
  assert.match(skill, /BLOCKED: invalid loop approval context/);
  assert.match(skill, /Never fall back from a malformed loop claim to standalone authorization/);
  assert.match(skill, /When there is no loop claim, preserve the standalone Entry Gate unchanged/);
  assert.match(skill, /record the validated loop provenance and accepted boundaries under `Objective and Accepted Boundaries`/);
  assert.match(skill, /checkpoint provenance only and does not remain or become live authority/);
  assert.match(skill, /For a csx plan, accept only `Decision: READY`/);
  assert.match(skill, /explicit `Start execution with \$csx-start-goal` selection/);
  assert.match(skill, /every original criterion have current direct evidence/);
  assert.match(skill, /latest cumulative verification succeeds at the unchanged revision/);
  assert.match(skill, /final code review returns `APPROVE`/);
  assert.match(skill, /call `update_goal` with `complete` exactly once/);
});

test("loop contract adds no loop state file or runtime engine", async () => {
  const loop = await readSkill("csx-loop");

  assert.match(loop, /Do not create `\.csx\/loops`/);
  assert.match(loop, /not a runner, daemon, background service, MCP server, or new state system/);
});

test("README documents direct, resumable, fail-closed loop use", async () => {
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  const compact = readme.replace(/\s+/g, " ");

  assert.match(compact, /\$csx-loop implement this bounded request end to end/);
  assert.match(compact, /`csx plan-pro`, `csx loop`, `csx start-goal`/);
  assert.match(compact, /\$csx-loop <request>` or `csx loop <request>/);
  assert.match(compact, /csx-spec -> exactly one of csx-plan \| csx-plan-pro -> csx-start-goal/);
  assert.match(compact, /low-risk spec recommendation to start directly is mapped to `csx-plan`/);
  assert.match(compact, /same-version Architect `CLEAR` and Critic `APPROVED`/);
  assert.match(compact, /first option explicitly labeled `Recommended` among 2-3 choices/);
  assert.match(compact, /BLOCKING_USER_DECISION/);
  assert.match(compact, /\$csx-loop resume <work-slug>/);
  assert.match(compact, /csx loop resume <work-slug>/);
  assert.match(compact, /current-turn, provenance-bound, single-use capability/);
  assert.match(compact, /stored in spec, plan, or goal metadata are audit provenance, not credentials/);
  assert.match(compact, /Deployment, external messages, deletion, additional permissions, and irreversible effects always require separate approval/);
  assert.match(compact, /`Completion Decision`, and `update_goal complete`/);
  assert.match(compact, /creates no `\.csx\/loops` state file, runner, daemon, or background service/);
  assert.match(compact, /Standalone `\$csx-spec`, `\$csx-plan`,.*keep their existing explicit/);
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
  assert.match(skill, /`REVISE`:[\s\S]*another versioned draft/);
  assert.match(skill, /increment `draft_version` by exactly one/);
  assert.match(skill, /Every revised draft MUST receive one fresh Critic review/);
  assert.match(skill, /maximum of 5 review cycles/);
  assert.match(skill, /Failure to reach approval after cycle 5 produces a `BLOCKED` artifact/);
  assert.match(skill, /\| Cycle \| Draft Version \| Critic \| Revision Reason \|/);
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
  assert.match(skill, /initial Executor assignment to implement, debug, and rerun its targeted verification/);
  assert.match(skill, /at most one orchestration-level correction round per goal/);
  assert.match(skill, /corrected result is still defective, even with a different defect/);
  assert.match(skill, /invoke `\$csx-deslop` once/);
  assert.match(skill, /stop this workflow without assigning another repair/);
  assert.match(skill, /There is no separate scoped evidence agent/);
  assert.doesNotMatch(skill, /csx-verifier/);
  assert.doesNotMatch(skill, /\bVerifier\b/);
  assert.match(skill, /at most three cumulative verification iterations/);
  assert.match(skill, /including the first run and any full rerun invalidated by later code-review rework/);
  assert.match(skill, /allow at most two repairs for the same failure/);
  assert.match(skill, /`product defect`, `test or verification defect`, `environment or transient failure`, or `unknown, scope, or user-decision blocker`/);
  assert.match(skill, /Rerun the exact failing command once on the unchanged revision/);
  assert.match(skill, /For an unknown failure[\s\S]*do not guess or edit code/);
  assert.match(skill, /new failure or revision never resets it/);
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
  assert.match(skill, /Goal implementation corrections:/);
  assert.match(skill, /Final cumulative verification: 0\/3/);
  assert.match(skill, /Verification failure repairs:/);
  assert.match(skill, /Environment reruns:/);
  assert.match(skill, /Cumulative code review: 0\/3/);
  assert.match(skill, /Review finding repairs:/);
  assert.match(skill, /Increment every applicable attempt counter before dispatching the work or running the command/);
  assert.match(skill, /record `legacy baseline`/);
  assert.match(skill, /current revision, current goal state, latest valid evidence, attempt counters, and open findings/);
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
