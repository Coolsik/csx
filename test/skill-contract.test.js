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
  assert.match(planPro, /Architect `BLOCK`, Critic `REVISE` or `BLOCKED`/);
  assert.match(planPro, /review exhaustion cannot pass this gate/);
  assert.match(planPro, /Never auto-select or auto-loop `Refine further`/);
  assert.match(planPro, /immutable Planner Body and every existing review, revision, and maximum of 5 review cycles remain unchanged/);
  assert.match(planPro, /If the loop context or live authority is absent or invalid,\s+use the standalone handoff below unchanged/);

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
  assert.match(skill, /Record validated loop provenance as checkpoint provenance only, never renewed authority/);
  assert.match(skill, /For a csx plan, accept only `Decision: READY`/);
  assert.match(skill, /explicit `Start execution with \$csx-start-goal` selection/);
  assert.match(skill, /every accepted criterion and approved execution goal has current direct evidence/);
  assert.match(skill, /every focused, integration\/static, and required full-suite check passes on the final revision/);
  assert.match(skill, /cumulative code review returns `APPROVE`/);
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
    "Constraints / Tradeoffs",
    "Acceptance",
    "Decision Authority",
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
  assert.match(skill, /exactly the highest-priority material question per call/);
  assert.match(skill, /## Intent Topology/);
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

test("csx-spec locks topology, scores ambiguity, and closes every interview mode safely", async () => {
  const [skill, analyst] = await Promise.all([
    readSkill("csx-spec"),
    readAgent("csx-analyst"),
  ]);

  const topology = skill.indexOf("### 3. Lock Round 0 Intent Topology");
  const scoring = skill.indexOf("### 4. Score Active Components");
  assert.ok(topology >= 0 && scoring > topology, "topology confirmation must precede scoring");
  assert.match(skill, /add(?:ed)?,\s*removed,\s*merged,\s*split,\s*or explicitly deferred/);
  for (const prefix of [
    "outcome:",
    "artifact:",
    "surface:",
    "integration:",
    "constraint:",
    "non-goal:",
    "priority:",
  ]) {
    assert.match(skill, new RegExp(prefix.replace("-", "\\-")));
  }
  for (const authority of [
    "USER_EXPLICIT",
    "USER_CONFIRMED",
    "REPO_REQUIRED",
    "CODEX_ASSUMPTION",
  ]) {
    assert.match(skill, new RegExp(authority));
    assert.match(analyst, new RegExp(authority));
  }

  assert.match(skill, /dimension_score = min\(active_component_dimension_scores\)/);
  assert.match(skill, /clarity = Σ\(dimension_score × dimension_weight\)/);
  assert.match(skill, /ambiguity = 1 - clarity/);
  assert.match(skill, /never an average/);
  assert.match(analyst, /never average siblings/);
  assert.match(skill, /An answer\s+may increase ambiguity/);
  assert.match(skill, /`disputed`/);
  assert.match(skill, /`superseded_by`/);
  assert.match(skill, /question_priority =/);
  assert.match(skill, /implementation_impact/);
  assert.match(skill, /authority_factor/);

  for (const [mode, ambiguity, clarity] of [
    ["Quick", "0\\.20", "80%"],
    ["Standard", "0\\.10", "90%"],
    ["Strict", "0\\.05", "95%"],
  ]) {
    assert.match(
      skill,
      new RegExp(`\\| \`${mode}\` \\| \`${ambiguity}\` \\| \`${clarity}\` \\|`),
    );
  }
  assert.match(skill, /`Finalize at Quick`/);
  assert.match(skill, /`Continue to Standard \(Recommended\)`/);
  assert.match(skill, /`Continue to Strict`/);
  assert.match(skill, /`Finalize at Standard`/);
  assert.match(skill, /already selected Strict, do not repeat the Standard-boundary/);
  assert.match(skill, /Never offer normal mode finalization or return READY while this hard gate fails/);

  const closure = skill.indexOf("### 10. Run Closure Audit and Intent Restate");
  const finalWrite = skill.indexOf("Write `.csx/specs/<slug>.md` only");
  assert.ok(closure >= 0 && finalWrite > closure, "closure must precede final artifact writing");
  assert.match(skill, /100% traceability/);
  assert.match(skill, /From the first material answer/);
  assert.match(skill, /Do not repeat the full\s+transcript/);
  for (const reliability of ["durable", "best-effort", "advisory"]) {
    assert.match(skill, new RegExp(`\`${reliability}\``));
    assert.match(analyst, new RegExp(`\`${reliability}\``));
  }
  assert.match(skill, /normally at most 5 goals, or at most 10/);
  assert.match(skill, /Interview Mode Achieved: Quick \| Standard \| Strict/);
  assert.match(skill, /## Hard Gate and Closure Audit/);
  assert.match(analyst, /2 KiB soft limit/);
});

test("csx-plan persists exact planner drafts and reviews them by path before finalization", async () => {
  const skill = await readSkill("csx-plan");

  assert.match(skill, /`csx-planner` owns every plan draft/);
  assert.doesNotMatch(skill, /## Mode Selection/);
  assert.match(skill, /invoke `\$csx-spec` from the root and stop this planning pass/);
  assert.match(skill, /Do not fill the gap with root-authored requirements/);
  assert.match(skill, /reuse its packet/);
  assert.match(skill, /Always give the request or spec, evidence packet, and user decisions to `csx-planner`/);
  assert.match(skill, /Never skip Planner delegation while this skill is active/);
  assert.match(skill, /Never skip Critic review while this skill is active/);
  assert.doesNotMatch(skill, /SKIPPED_LOW_RISK/);
  assert.match(skill, /Immediately after each Planner result arrives, write the complete response verbatim to `\.csx\/plans\/<slug>\.draft\.md`/);
  assert.match(skill, /Persist it before parsing, summarizing, reviewing, or requesting another agent action/);
  assert.match(skill, /The temporary draft is the sole plan candidate for that version/);
  assert.match(skill, /give `csx-critic` the draft path, its `draft_version`, and the accepted spec path/);
  assert.match(skill, /Do not relay the Planner body in the Critic assignment/);
  assert.match(skill, /Critic must read the temporary file directly and compare its complete Planner body against the accepted spec/);
  assert.match(skill, /Only `APPROVED` for the same persisted `draft_version` authorizes finalization/);
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
  assert.match(skill, /exact approved Planner body inside the Artifact Format envelope without modification/);
  assert.match(skill, /write `\.csx\/plans\/<slug>\.md` from the exact approved Planner body/);
  assert.match(skill, /Delete `\.csx\/plans\/<slug>\.draft\.md` only after the final artifact has been written and verified/);
  assert.match(skill, /If final writing or verification fails, retain the temporary draft/);
  assert.match(skill, /\| Criterion \| Evidence \| Command or Scenario \| Expected Result \| Failure Signal \|/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx-plan-pro delegates all specialist judgments and binds consensus to one version", async () => {
  const skill = await readSkill("csx-plan-pro");

  assert.match(skill, /`csx-planner` owns every draft/);
  assert.match(skill, /`csx-architect` owns architectural review/);
  assert.match(skill, /`csx-critic` owns post-clearance\s+actionability review/);
  assert.match(skill, /If an accepted final csx spec is supplied/);
  assert.match(skill, /Reuse current evidence\s+instead of repeating discovery/);
  assert.match(skill, /Require `draft_version: 1`/);
  assert.match(skill, /assigns `csx-architect` the complete Accepted Constraint Envelope, bounded\s+scope authority, draft path/);
  assert.match(skill, /Only after Architect `CLEAR`, assign `csx-critic`/);
  assert.match(skill, /Consensus requires Architect `CLEAR` and Critic `APPROVED` for the same/);
  assert.match(skill, /increment `draft_version` by exactly one/);
  assert.match(skill, /Every new version\s+restarts at\s+Architect/);
  assert.match(skill, /maximum of 5 cycles/);
  assert.match(skill, /complete\s+BLOCKED artifact containing the best draft/);
  assert.match(skill, /final Critic result to confirm that the consensus\s+draft matches the original request/);
  assert.match(skill, /Architect-owned minimum\s+`Revision Brief`/);
  assert.match(skill, /Critic-owned minimum `Revision Brief`/);
  assert.match(skill, /Root must not act as Plan Leader/);
  assert.match(skill, /Any post-review change[\s\S]*invalidates both verdicts/);
  assert.match(skill, /Every Planner assignment must require/);
  assert.match(skill, /### Decision Drivers/);
  assert.match(skill, /### Options Considered/);
  assert.match(skill, /three concrete failure scenarios/);
  assert.match(skill, /unit, integration, e2e, and observability verification/);
  assert.match(skill, /## Planner Body Shape/);
  assert.match(skill, /Assemble the exact stored Planner and reviewer originals into the envelope without\s+modification/);
  assert.match(skill, /pre-draft BLOCKED artifact/);
  assert.match(skill, /Planner Body to `Not created — blocked before drafting`/);
  assert.match(skill, /The Architect assignment must review boundary, threat, compatibility, and rollback risk/);
  assert.match(skill, /The Critic assignment must return `REVISE` or `BLOCKED`/);
  assert.match(skill, /Never invoke execution from a BLOCKED plan/);
});

test("csx-plan-pro uses a single-writer sequential artifact gate with bounded blockers", async () => {
  const [skill, leader, planner, architect, critic] = await Promise.all([
    readSkill("csx-plan-pro"),
    readAgent("csx-plan-leader"),
    readAgent("csx-planner"),
    readAgent("csx-architect"),
    readAgent("csx-critic"),
  ]);

  assert.match(skill, /Root spawns one `csx-plan-leader` with `fork_turns: "none"`/);
  assert.match(leader, /sandbox_mode = "workspace-write"/);
  assert.match(leader, /^model = "gpt-5\.6-luna"$/m);
  assert.match(leader, /^model_reasoning_effort = "xhigh"$/m);
  assert.match(leader, /Root is selected\s+independently/);
  for (const specialist of [planner, architect, critic]) {
    assert.match(specialist, /sandbox_mode = "read-only"/);
  }

  const architectGate = skill.indexOf("assigns `csx-architect`");
  const skipCritic = skill.indexOf("SKIPPED_ARCHITECT_NOT_CLEAR");
  const criticGate = skill.indexOf("Only after Architect `CLEAR`");
  assert.ok(architectGate >= 0 && skipCritic > architectGate && criticGate > skipCritic);
  assert.match(skill, /`WATCH` is not a\s+verdict/);
  assert.match(skill, /Watch Items/);
  assert.doesNotMatch(skill, /accepted material improvement requires revision/);

  for (const classification of [
    "accepted-scope-defect",
    "change-induced-risk",
    "optional-hardening",
  ]) {
    assert.match(skill, new RegExp(classification));
  }
  for (const field of [
    "finding_id",
    "classification",
    "scope_authority",
    "affected_boundary",
    "reachable_scenario",
    "evidence",
    "plan_time_decision",
    "minimal_fix",
    "scope_delta",
  ]) {
    assert.match(skill, new RegExp(field));
    assert.match(architect, new RegExp(field));
    assert.match(critic, new RegExp(field));
  }
  assert.match(skill, /A blocker must satisfy all four conditions/);
  const blockerContract = skill.slice(
    skill.indexOf("A blocker must satisfy all four conditions"),
    skill.indexOf("Maintain stable blocker IDs"),
  );
  assert.equal((blockerContract.match(/^\d+\./gm) ?? []).length, 4);
  for (const condition of [
    "Scope-authorized defect or risk",
    "Concrete evidence and reachable scenario",
    "Plan-time necessity",
    "Minimality",
  ]) {
    assert.match(blockerContract, new RegExp(condition));
  }
  assert.match(skill, /non-null stable `scope_authority`/);
  assert.match(skill, /stable blocker IDs/);
  assert.match(skill, /draft delta or newly applicable scope evidence/);
  assert.match(skill, /`INFEASIBLE_UNDER_CURRENT_SPEC`/);
  assert.match(architect, /`INFEASIBLE_UNDER_CURRENT_SPEC`/);
  assert.match(critic, /`INFEASIBLE_UNDER_CURRENT_SPEC`/);

  for (const field of [
    "accepted_spec_path",
    "accepted_spec_sha256",
    "reliability_class",
    "complexity_budget",
  ]) {
    assert.match(skill, new RegExp(field));
    assert.match(leader, new RegExp(field));
    assert.match(planner, new RegExp(field));
    assert.match(architect, new RegExp(field));
    assert.match(critic, new RegExp(field));
  }
  assert.match(skill, /Planner preserves it in the draft/);
  assert.match(skill, /Architect and\s+Critic echo it in their result/);

  assert.match(skill, /\.csx\/handoffs\/<run-id>\//);
  assert.match(skill, /manifest\.json/);
  assert.match(skill, /draft-v001\.md/);
  assert.match(skill, /SHA-256/);
  assert.match(skill, /Every version file is immutable/);
  assert.match(skill, /Do not\s+relay originals over 8 KiB/);
  assert.match(skill, /`BLOCKED_ARTIFACT_MISSING`/);
  assert.match(skill, /`BLOCKED_ARTIFACT_MISMATCH`/);
  assert.match(skill, /`BLOCKED_UNAUTHORIZED_WRITE_SCOPE`/);
  assert.match(skill, /`BLOCKED_UNAUTHORIZED_WRITE`/);

  assert.match(skill, /Required from draft_version 2 onward/);
  assert.match(skill, /Default to 5 or fewer goals, or 10 or fewer/);
  assert.match(skill, /vertical slice/);
  assert.match(planner, /at most 5 goals, or at most 10/);
  assert.match(planner, /Scope Delta/);

  assert.match(skill, /Below 35% continue/);
  assert.match(skill, /At 35% through below 50%/);
  assert.match(skill, /At 50% or after any context compaction/);
  assert.match(skill, /never estimate a ratio/);
  assert.match(skill, /Never overlap writers/);
  assert.match(skill, /Leader rotation alone never creates a new user-visible top-level thread/);
  assert.match(skill, /## Root Replacement Protocol/);
  assert.match(skill, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(skill, /Only Root may present this recommendation to the user/);
  assert.match(leader, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(leader, /only Root may recommend it to the user/);
  assert.match(skill, /## Enforcement Boundary/);
  assert.match(skill, /does not create a new JS\s+orchestrator/);
  assert.match(leader, /do\s+not create a new runtime orchestrator/);
});

test("canonical workflows persist artifacts before fail-open token-CAS state milestones", async () => {
  const [plan, goal, otherSkills] = await Promise.all([
    readSkill("csx-plan-pro"),
    readSkill("csx-start-goal"),
    Promise.all(skillNames
      .filter((name) => name !== "csx-plan-pro" && name !== "csx-start-goal")
      .map(readSkill))
  ]);

  for (const [skill, workflow, artifactDirectory] of [
    [plan, "csx-plan-pro", ".csx/plans/"],
    [goal, "csx-start-goal", ".csx/goals/"]
  ]) {
    assert.match(skill, /## Canonical Workflow State/);
    assert.match(skill, new RegExp(`"workflow":"${workflow}"`));
    assert.match(skill, new RegExp(artifactDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(skill, /`csx workflow begin`/);
    assert.match(skill, /`csx workflow checkpoint`/);
    assert.match(skill, /`csx workflow finish`/);
    assert.match(skill, /bounded JSON request on stdin/);
    assert.match(skill, /Retain and propagate its opaque `token` only when `ok` is `true`/);
    assert.match(skill, /never (?:place|write) the token/i);
    assert.match(skill, /artifact-first\/state-second order/);
    assert.match(skill, /stale-token or (?:other|any other) .*fail-open/i);
    assert.match(skill, /Do not create canonical workflow state for any other skill/);
  }
  assert.match(plan, /outcome `approved` or `blocked`/);
  assert.match(goal, /outcome `complete`/);
  assert.match(goal, /genuine terminal blocked or stopped decision rather than a resumable pause/);
  for (const skill of otherSkills) assert.doesNotMatch(skill, /csx workflow begin/);
});

test("csx-start-goal executes approved goals through one test-first lifecycle leader", async () => {
  const [skill, leader, executor] = await Promise.all([
    readSkill("csx-start-goal"),
    readAgent("csx-start-goal-leader"),
    readAgent("csx-executor"),
  ]);

  assert.match(skill, /Use exactly one aggregate Codex goal for the entire accepted plan/);
  assert.match(skill, /Spawn exactly one `csx-start-goal-leader` with `fork_turns: "none"`/);
  assert.match(skill, /Do not nest a\s+separate Execution Leader or Review Leader/);
  assert.match(leader, /sandbox_mode = "workspace-write"/);
  assert.match(leader, /^model = "gpt-5\.6-luna"$/m);
  assert.match(leader, /^model_reasoning_effort = "xhigh"$/m);
  assert.match(leader, /Root is selected independently/);
  assert.match(skill, /only direct writer of `\.csx\/goals\/<slug>\.md`/);
  assert.match(skill, /`BLOCKED_UNAUTHORIZED_WRITE_SCOPE`/);
  assert.match(skill, /`BLOCKED_UNAUTHORIZED_WRITE`/);

  for (const classification of [
    "accepted-scope-defect",
    "change-induced-risk",
    "optional-hardening",
  ]) {
    assert.match(skill, new RegExp(classification));
  }
  for (const field of [
    "accepted_spec_path",
    "accepted_spec_sha256",
    "reliability_class",
    "complexity_budget",
  ]) {
    assert.match(skill, new RegExp(field));
    assert.match(leader, new RegExp(field));
  }
  assert.match(skill, /Preserve accepted reliability\s+classes/);
  assert.match(skill, /import that decomposition unchanged/);
  assert.match(skill, /Start-Goal Leader must not merge, split, reorder, or redesign it/);
  assert.match(skill, /Default planning budgets are 5 goals for normal work and 10 for large or high-risk work/);
  assert.match(skill, /vertical slice/);

  for (const fence of [
    "exact allowed files and ownership",
    "responsible acceptance criteria",
    "invariants that must remain true",
    "allowed dependency paths",
    "explicit forbidden files",
  ]) {
    assert.match(skill, new RegExp(fence));
  }
  assert.match(skill, /SCOPE_EXPANSION_REQUIRED/);
  assert.match(skill, /Do not automatically add that work to the current or a new goal/);
  assert.match(executor, /SCOPE_EXPANSION_REQUIRED/);
  assert.match(executor, /4 KiB soft limit/);

  const focused = skill.indexOf("After all focused tests pass");
  const integration = skill.indexOf("run the accepted integration and static checks", focused);
  const firstFull = skill.indexOf("run the first full suite", focused);
  const review = skill.indexOf("invoke cumulative code", focused);
  const rework = skill.indexOf("group all `accepted-scope-defect`", focused);
  const finalFull = skill.indexOf("run one final full suite", focused);
  assert.ok(
    focused >= 0 &&
      integration > focused &&
      firstFull > integration &&
      review > firstFull &&
      rework > review &&
      finalFull > rework,
    "focused, integration/static, full suite, review, rework, and final suite must be ordered",
  );
  assert.match(skill, /Code review must not begin while focused, integration\/static, or first full-suite evidence is\s+failing/);
  assert.match(skill, /full suite runs exactly once/);
  assert.match(skill, /at most two total full-suite runs/);
  assert.match(skill, /A new revision never\s+resets the 2-run ceiling/);
  assert.match(skill, /Reviewers do not rerun the full suite/);
  assert.match(skill, /only 1-3 focused reproductions/);

  assert.match(skill, /## Goal-Scoped Deslop/);
  assert.match(skill, /boundary of every approved goal/);
  assert.match(skill, /`DESLOP_NOT_APPLICABLE`/);
  assert.match(skill, /`DESLOP_SKIPPED_CONCISE_GOAL`/);
  assert.match(skill, /`DESLOP_COMPLETED`/);
  for (const status of [
    "DESLOP_NOT_APPLICABLE",
    "DESLOP_SKIPPED_CONCISE_GOAL",
    "DESLOP_COMPLETED",
  ]) {
    assert.match(leader, new RegExp(status));
  }
  assert.match(skill, /purpose fits one clear sentence/);
  assert.match(skill, /goal-owned changed\s+paths/);
  assert.match(skill, /Never relay prior-goal transcripts or the integrated repository diff/);
  assert.match(skill, /A goal may never run deslop more\s+than once/);
  assert.match(leader, /at most once for that goal/);
  assert.match(leader, /not another aggregate deslop pass/);
  assert.match(skill, /do not run a final integrated\s+deslop/);

  assert.match(skill, /Do not repeatedly short-poll agents/);
  assert.match(skill, /At timeout, send one status check/);
  assert.match(skill, /retry once/);
  assert.match(skill, /second same-cause failure\s+becomes a structured blocker/);
  assert.match(skill, /Below 35% continue/);
  assert.match(skill, /at 35% through below 50% checkpoint/);
  assert.match(skill, /at 50% or after any compaction/);
  assert.match(skill, /If metrics are unavailable, never estimate them/);
  assert.match(skill, /Never overlap\s+writers/);
  assert.match(skill, /never create a user-visible top-level thread merely because Leader context grew/);
  assert.match(skill, /## Root Replacement Protocol/);
  assert.match(skill, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(skill, /Only Root may present the recommendation to the user/);
  assert.match(leader, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(leader, /only Root may recommend it to the user/);
  assert.match(skill, /## Enforcement Boundary/);
  assert.match(leader, /do\s+not create a new runtime orchestrator/);

  assert.match(skill, /Full suite: 0\/2/);
  assert.match(skill, /Goal deslop passes: <sum; each production-code goal 0\/1>/);
  assert.match(skill, /recorded as `legacy baseline`/);
  assert.match(skill, /call `update_goal` with `complete` exactly once/);
  assert.doesNotMatch(skill, /csx-verifier/);
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
  assert.match(skill, /classification of every finding as exactly `accepted-scope-defect`/);
  assert.match(skill, /Spawn `csx-architect` only when the final diff introduces, changes, or departs from/);
  assert.match(skill, /Diff size, file count, or ordinary cross-module call flow alone do not require the lane/);
  assert.match(skill, /Only `accepted-scope-defect` and `change-induced-risk` findings may produce/);
  assert.match(skill, /`optional-hardening` and unrelated refactoring are non-blocking follow-up material/);
  assert.match(skill, /Classification: accepted-scope-defect \/ change-induced-risk \/ optional-hardening/);
  for (const field of [
    "finding_id",
    "classification",
    "scope_authority",
    "affected_boundary",
    "reachable_scenario",
    "evidence",
    "plan_time_decision",
    "minimal_fix",
    "scope_delta",
  ]) {
    assert.match(skill, new RegExp(field));
  }
  assert.match(skill, /`APPROVE`: Code Reviewer returns `APPROVE`; Architect is `CLEAR` or was validly skipped/);
  assert.match(skill, /must not perform either specialist review itself/);
});

test("csx-code-review completes blocking findings by invariant family after green tests", async () => {
  const [skill, reviewer] = await Promise.all([
    readSkill("csx-code-review"),
    readAgent("csx-code-reviewer"),
  ]);

  const entryGate = skill.indexOf("## Test-First Entry Gate");
  const reviewerLanes = skill.indexOf("## Independent Review Lanes");
  assert.ok(entryGate >= 0 && reviewerLanes > entryGate, "green test gate must precede review");
  assert.match(skill, /green focused tests/);
  assert.match(skill, /required integration\/static checks/);
  assert.match(skill, /first full-suite run/);
  assert.match(skill, /`TESTS_NOT_GREEN`/);
  assert.match(skill, /Reviewers never\s+rerun the full suite/);
  assert.match(skill, /only 1-3 focused reproductions in total/);

  for (const field of [
    "invariant",
    "affected_producers",
    "affected_consumers",
    "required_sweep",
    "inspected_paths",
    "uninspected_boundaries",
  ]) {
    assert.match(skill, new RegExp(`\\\`${field}\\\``));
    assert.match(reviewer, new RegExp(`\\\`${field}\\\``));
  }
  assert.match(skill, /normal, resume, recovery or historical, adapter, and migration paths/);
  assert.match(skill, /draft or code delta since the earlier review/);
  assert.match(skill, /concrete reason the\s+path was not observable/);
  assert.match(skill, /do not create a new blocker ID/);
  assert.match(skill, /one bounded rework\s+packet per invariant family/);
  assert.match(skill, /`WATCH` is not a verdict/);
  assert.match(skill, /`optional-hardening` and unrelated refactoring are non-blocking/);
  assert.match(skill, /4 KiB soft limit/);
  assert.match(skill, /never grant a read-only reviewer general\s+workspace write access/);

  assert.match(reviewer, /Never rerun the full suite/);
  assert.match(reviewer, /only 1-3 focused reproductions in total/);
  assert.match(reviewer, /Retain the stable ID\s+through rework/);
  assert.match(reviewer, /new blocker for the same\s+invariant requires a draft or code delta/);
  assert.match(reviewer, /`optional-hardening` and unrelated refactoring are non-blocking/);
  for (const field of [
    "finding_id",
    "classification",
    "scope_authority",
    "affected_boundary",
    "reachable_scenario",
    "evidence",
    "plan_time_decision",
    "minimal_fix",
    "scope_delta",
  ]) {
    assert.match(reviewer, new RegExp(field));
  }
  assert.match(reviewer, /4 KiB soft limit/);
  assert.match(reviewer, /Remain read-only/);
  assert.match(reviewer, /active Leader remains\s+the single artifact writer/);
  assert.match(reviewer, /Never request general workspace write access/);
});

test("README documents clarity gates, workflow leaders, and bounded execution review", async () => {
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  const compact = readme.replace(/\s+/g, " ");

  assert.match(compact, /Round 0 Intent Topology/);
  assert.match(compact, /seven weighted clarity dimensions/);
  assert.match(compact, /least-clear active sibling rather than an average/);
  assert.match(compact, /Quick \(at least 80% clarity\), Standard \(90%\), and Strict \(95%\)/);
  assert.match(compact, /No mode bypasses the common hard gate/);
  assert.match(compact, /`durable`, `best-effort`, or `advisory`/);

  assert.match(compact, /one Plan Leader as the only handoff and final-plan writer/);
  assert.match(compact, /Only Architect `CLEAR` allows Critic/);
  assert.match(compact, /`WATCH` is not a verdict/);
  assert.match(compact, /four explicit conditions/);
  assert.match(compact, /non-null stable `scope_authority`/);
  assert.match(compact, /accepted-spec path and digest, reliability class, and complexity budget/);
  assert.match(compact, /Plan Leader and Start-Goal Leader checkpoint/);
  assert.match(compact, /context use reaches 35%/);
  assert.match(compact, /at 50% or after compaction/);
  assert.match(compact, /one logical `LEADER` role and writes the selected pair to both/);
  assert.match(compact, /Root is configured independently and is not a setup-matrix role/);
  assert.match(compact, /seven configurable specialists/);
  assert.match(compact, /also registers `csx-plan-leader` and `csx-start-goal-leader`/);
  assert.match(compact, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(compact, /Root alone may present the recommendation/);

  assert.match(compact, /Planner-owned execution goals without merging, splitting, reordering, or redesigning/);
  assert.match(compact, /normal complexity budget is five goals/);
  assert.match(compact, /Every Executor assignment declares exact files and ownership/);
  assert.match(compact, /`SCOPE_EXPANSION_REQUIRED`/);
  assert.match(compact, /focused tests, integration\/static checks, the first full suite/);
  assert.match(compact, /full suite therefore runs once[\s\S]*at most twice/);
  assert.match(compact, /goal-scoped Deslop gate/);
  assert.match(compact, /Deslop runs at most once for that goal/);
  assert.match(compact, /purpose fits one clear sentence/);
  assert.match(compact, /`DESLOP_NOT_APPLICABLE`/);
  assert.match(compact, /rather than a final integrated Deslop pass/);

  assert.match(compact, /treats each blocking defect as an invariant family/);
  assert.match(compact, /affected producers and consumers/);
  assert.match(compact, /one bounded rework packet/);
  assert.match(compact, /never rerun the full suite/);
  assert.match(compact, /one to three focused reproductions/);
  assert.match(compact, /one corrected retry/);
  assert.match(compact, /one status check and at most one non-overlapping replacement/);
  assert.match(compact, /2 KiB soft limit/);
  assert.match(compact, /use 4 KiB/);
  assert.match(compact, /prompt contracts that rely on Codex host controls/);
  assert.match(compact, /Passing static contract tests alone is not a claim/);
});

test("host-level scenario runbook covers behavior that static contracts cannot prove", async () => {
  const runbook = await readFile(resolve(root, "docs", "host-e2e-scenarios.md"), "utf8");

  for (const scenario of [
    "H01 — Architect BLOCK skips Critic",
    "H02 — Accepted Constraint Envelope blocks unsupported complexity",
    "H03 — Missing scope authority cannot block",
    "H04 — Repeated infeasible blocker converges",
    "H05 — Concise production-code goal skips Deslop",
    "H06 — Non-concise production-code goal runs Deslop once",
    "H07 — Cross-goal cleanup stays bounded",
    "H08 — Leader rotation does not replace Root",
    "H09 — Root fidelity loss recommends Root replacement",
    "H10 — Artifact failure and host enforcement remain explicit",
  ]) {
    assert.match(runbook, new RegExp(scenario));
  }

  assert.match(runbook, /A passing contract test\s+does not mark a scenario passed/);
  assert.match(runbook, /Do not record a scenario as passed without the listed direct evidence/);
  assert.match(runbook, /`ROOT_REPLACEMENT_RECOMMENDED`/);
  assert.match(runbook, /`DESLOP_SKIPPED_CONCISE_GOAL`/);
  assert.match(runbook, /`DESLOP_COMPLETED`/);
  assert.match(runbook, /`INFEASIBLE_UNDER_CURRENT_SPEC`/);
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
  assert.match(planPro, /[Nn]o blocking verdict may be based only on `optional-hardening` or duplicated verification/);
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
