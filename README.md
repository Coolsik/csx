# csx

csx installs a small set of explicitly invoked Codex-native workflow skills,
custom agents, and lifecycle hooks. It does not route prompts and has no
background service, MCP server, or Codex plugin. Mutating commands require the
optional native `fs-ext-extra-prebuilt@2.2.9` package at runtime and fail closed
when that capability is unavailable.

## Requirements

- Node.js 20 or newer
- Codex on Linux, with a verified local filesystem

Transactional mutations are supported only on verified local Linux filesystems.
macOS and Windows installations fail closed because this runtime cannot establish
the required local-volume identity; they do not fall back to an unlocked or
best-effort install.


## Install

Install the public npm package, then choose where Codex should load csx:

```bash
npm install -g @coolsik/csx
csx install
```

The interactive command presents a numbered menu: `1` for `global` and `2` for
`project`. Automation can select the scope explicitly:

```bash
csx install --scope global
csx install --scope project
csx install --scope project --project-root /path/to/workspace
```

Global installation writes only below `${CODEX_HOME:-~/.codex}`, including its
root-local `.csx-transactions` recovery control state. If `CODEX_HOME` is
explicitly set, that directory must already exist.

Project installation writes skills to `.agents/skills`, agents and hooks to
`.codex`, and a managed block to `.codex/config.toml`. Without
`--project-root`, csx installs into the directory where the command is run.
Git is not required. Project installation never changes the global Codex home.
New installations use the `Balanced` role preset. This sets the selected
scope's top-level `model` and `model_reasoning_effort` for the Leader as well as
the seven agent files. Any previous Leader assignments are retained in the
installation receipt and restored by `csx uninstall`.

For the selected scope, installation also enables
`features.default_mode_request_user_input` so `csx-spec`, `csx-plan`, and
`csx-plan-pro` can present Codex's built-in choices and Tab notes in Default
mode. An existing `true` value remains user-owned. An existing `false` value is
temporarily overridden and restored by `csx uninstall`. Project config applies
only to trusted projects, and higher-precedence or managed requirements can
still disable the feature.

csx refuses to overwrite same-name files unless its installation receipt proves
they are managed by csx. Existing config outside the marked csx block is
preserved. Start a new Codex session after installation. Codex will ask you to
review and trust the UserPromptSubmit, SessionStart, and SubagentStop command
hooks on first use.
## Setup

```bash
csx setup
```

`csx setup` is an interactive-only model configuration flow. It selects the
receipt-backed project installation in the current directory when present;
otherwise it configures the global installation. Role and receipt changes stay
within the selected project or resolved global `CODEX_HOME` scope. Saved presets
are global: they can be used in either scope, but global preset metadata changes
only when you approve saving one. The command accepts no arguments and requires
interactive stdin and stdout. An unmanaged project Codex configuration is
refused before the TUI opens or any setup write is attempted.

The first screen lists every model reported as available by the Codex
app-server. Each row carries colored role badges (`LEADER`, `EXPLORE`,
`ANALYST`, `PLANNER`, `ARCH`, `CRITIC`, `EXEC`, and `REVIEW`) plus the current
effort for that role. Select a model, choose one role or `All roles`, then choose
one of that model's supported efforts. The assignment updates the in-memory
draft and returns to the model list; it does not write yet.

The model list ends with `Load preset`, the custom-preset save row,
`Review & apply`, and `Cancel`. `Load preset` contains `Efficient`, `Balanced`,
`Strong`, and every saved global custom preset. Focusing a preset shows its
complete eight-role preview; Enter loads the full matrix into the draft and
returns to the model list. A draft role whose model or effort disappeared from
the live catalog is shown as unavailable and must be reassigned before saving
or reviewing.

`Save custom preset` is enabled only when the complete draft differs from every
built-in and saved custom preset. Exact matches replace it with the disabled
`Already saved as ...` row. Selecting the enabled row asks for a non-empty,
case-insensitively unique, non-reserved name and stages it as `[pending]`.
Changing the draft afterward clears that pending name. The preset is not
written until final Apply, so Leader and agent configuration, receipt metadata,
and the global preset file remain one transaction. A unique custom-only save is
allowed even when no role pair changed.

`Final setup preview` is read-only and shows every baseline-to-draft role
change plus the pending custom preset. Apply persists the whole draft; use Esc
to return and revise an assignment. Cancel, top-level Esc, and Ctrl+D write
nothing. Ctrl+D reports `Aborted with Ctrl+D.` and exits with an error after
restoring the terminal. Other input or rendering errors and termination signals
also restore the terminal before preserving their error or signal outcome.
At supported terminal heights of at least 3 rows, any overflowing selected
model, role, effort, preset preview, error, or review item uses focused paging.
↑/↓ reaches every wrapped page before advancing to the next semantic item, and
resize clamps the current page without losing the selection. Mouse input and
model search are not part of this interface.

Backslashes and terminal control or bidirectional-formatting characters loaded
from saved custom presets or the model catalog keep their raw storage,
selection, and Apply values. Only their screen representation changes, using
reversible `\\`, `\xNN`, or `\uNNNN` visible escapes. The same
presentation-only escaping covers dynamic top-level CLI stdout and stderr,
without changing underlying values, errors, or payloads.

Before commit, setup validates the final pairs against a freshly discovered
Codex app-server catalog, rejects duplicate preset matrices, and rejects role
or custom-preset drift. Receipt
metadata drift is reconciled without rewriting unchanged role settings. Setup
writes only selected receipt-owned agent files and Leader config, the complete
effective-matrix receipt when needed, and approved global custom-preset
metadata in one transaction. Validation errors write nothing, and any
transactional failure rolls back the selected changes before the error is
reported. If the role matrix and receipt already match and no custom save was
requested, it reports `Setup already matches the selected matrix.` without
writing agent files.
Hostile text in Apply-time fresh-catalog drift is escaped only after terminal
cleanup, and the rejected operation commits nothing.

## Skills

Invoke a skill directly with its installed name:

```text
$csx-analyze explain this repository behavior
$csx-spec clarify this feature idea
$csx-plan create an implementation plan
$csx-plan-pro plan this architecture-sensitive migration
$csx-loop implement this bounded request end to end
$csx-start-goal execute the accepted plan
$csx-deslop clean this bounded change without changing behavior
$csx-code-review review the current changes
```

The UserPromptSubmit hook recognizes prompts beginning with `csx analyze`, `csx spec`,
`csx plan`, `csx plan-pro`, `csx loop`, `csx start-goal`, `csx deslop`, or
`csx code-review`. Ordinary natural-language prompts are not routed. Skills,
including `csx-deslop`, use explicit invocation rather than implicit routing.

Installed custom agents are namespaced `csx-*`: explorer, analyst, planner,
architect, critic, executor, and code-reviewer.

Agent prompts define general, workflow-independent roles. Skills construct each
subagent assignment with its objective, inputs, scope, required checks,
deliverable, verdict vocabulary, constraints, and stop conditions. Skills own
orchestration, user decisions, state, artifacts, and handoffs; agents own the
assigned investigation, analysis, planning, implementation, verification, or
review result.

Skills do not impose fixed token counts on subagents. They require the smallest
complete deliverable, preserve required evidence and verdict fields, and bound
work through scope, output shape, stop conditions, and existing workflow retry
limits. Missing evidence must be reported explicitly rather than hidden by
truncating required content.

Every direct subagent call uses the same activity-aware liveness policy: allow
an initial five-minute grace period, send one status check after a further three
minutes without observable activity, and allow two more minutes before
terminating the inactive agent. Confirm termination before starting at most one
replacement with the complete assignment. A tool or command known to still be
running is not inactivity, and child skills monitor only their own direct
subagents.

### End-to-end loop

Use `$csx-loop <request>` or `csx loop <request>` when one bounded request
should continue through the fixed
`csx-spec -> exactly one of csx-plan | csx-plan-pro -> csx-start-goal` flow.
Planning is never skipped: a low-risk spec recommendation to start directly is
mapped to `csx-plan`, while broad, high-risk, cross-module, or
architecture-sensitive work uses `csx-plan-pro`. The normal plan must reach
`READY`; the pro plan must have same-version Architect `CLEAR` and Critic
`APPROVED` before execution can start.

At a loop stage, only a first option explicitly labeled `Recommended` among
2-3 choices may be selected automatically, and only when it is safe,
reversible, and inside the accepted request and assumptions. A plan-changing
choice without that recommendation stops as `BLOCKING_USER_DECISION`. The
checkpoint reports a stable pending-decision identifier, the last completed
stage, what the answer controls, that answering the exact decision continues
the remaining workflow and implementation, and the exact resume command.

Loop continuation authority is a current-turn, provenance-bound, single-use
capability. The `initial-call`, `renewed-by-answer`, and `explicit-resume`
values stored in spec, plan, or goal metadata are audit provenance, not
credentials. Only the exact answer to the outstanding decision for the same
slug and stage can renew answer authority; an unrelated answer, copied enum,
old prompt, interruption, cancellation, or reported blocker cannot. Resume
with an entire prompt of exactly one of these forms:

```text
$csx-loop resume <work-slug>
csx loop resume <work-slug>
```

Resume validates the matching artifacts, accepted assumptions, repository
freshness, attempt counters, and active goal, then continues at the first
incomplete stage without regenerating valid completed stages. A resume command
does not answer an unresolved `BLOCKING_USER_DECISION`; the exact pending
answer is still required.

`BLOCKED` child results, unavailable required roles, exhausted review or retry
limits, a distinct active goal, stale or conflicting boundaries, and user
cancellation are hard stops. Deployment, external messages, deletion,
additional permissions, and irreversible effects always require separate
approval and are never auto-selected. A loop reports final success only after
the goal artifact has current evidence for every original acceptance criterion,
final verification and cumulative review on one unchanged revision, a complete
`Completion Decision`, and `update_goal complete`.

The loop uses the existing `.csx/specs`, `.csx/plans`, and `.csx/goals`
artifacts as checkpoints; it creates no `.csx/loops` state file, runner,
daemon, or background service. Standalone `$csx-spec`, `$csx-plan`,
`$csx-plan-pro`, and `$csx-start-goal` calls keep their existing explicit
handoff and execution-selection rules when a complete current loop context and
matching live authority are absent.

`csx-plan` and `csx-plan-pro` produce versioned planning artifacts under
`.csx/plans/`. A revised draft must be reviewed again, and `csx-plan-pro`
requires Architect `CLEAR` plus Critic `APPROVED` for the same draft version.
Both skills record verification evidence and finish with an explicit choice to
refine, stop, or authorize execution through `csx-start-goal`; BLOCKED plans
cannot enter execution.

`csx-start-goal` creates one aggregate Codex goal for the accepted plan and asks
the Planner to split it into bounded `G001...Gnnn` execution goals in
`.csx/goals/`. Executors own all implementation and rework. The root invokes
scoped `csx-deslop` cleanup after implementation rather than asking a leaf
Executor to start another workflow. Deslop proves behavior preservation by
running the same behavior lock before and after one bounded cleanup pass. Each
goal permits one orchestration-level implementation correction after its
Executor returns. When all execution goals are ready, the root runs at most
three cumulative verification iterations, with at most two repairs for the
same failure, and the unchanged complete diff must earn `APPROVE` within at most
three cumulative `csx-code-review` iterations. Retry counters persist in the
goal artifact. Findings outside accepted scope or concrete change-induced safety
and regression risks are recorded as optional hardening rather than silently
expanding the goal.

## Lifecycle state and authority

An installation adds three self-contained command hooks: UserPromptSubmit routes
explicit `csx ...` shorthand, SessionStart restores an eligible workflow, and
SubagentStop records eligible local diagnostics. Each hook command carries its
exact `project` or `global` scope and absolute installation root. Lifecycle
operations accept that authority only when the running file and installation
receipt prove exact receipt ownership. Missing, malformed, partially present,
symlinked, or otherwise unsafe lifecycle authority fails closed.

Only `csx-plan-pro` and `csx-start-goal` publish lifecycle state. Each linked
worktree owns `.csx/workflow-state-v1.json` at its own top level; the common Git
directory is never used. There is at most one active workflow, identified by an
opaque token. Checkpoint and finish are compare-and-swap operations, so a stale
token cannot alter the current workflow. SessionStart restores only an active,
schema-valid state whose recorded artifact is still a valid unchanged file
under the workflow's allowed `.csx/plans/` or `.csx/goals/` directory. The state
is project data, is not removed by `csx uninstall`, and therefore survives a
later reinstall.

Project authority takes precedence over global authority:

- A valid project installation wins, even when its workflow state is absent or
  invalid.
- A genuinely absent project installation permits global fallback.
- An unsafe project installation blocks both project restore and global
  fallback.
- After project uninstall removes that authority, global fallback is restored.

Linked worktrees remain isolated even when they share a Git common directory.

## Local diagnostics

```bash
csx diagnostics
csx diagnostics --json
```

The command reads the current linked worktree's `.csx/diagnostics-v1` directory
under the same project-over-global authority rule. `--json` emits one
`csx.diagnostics` version 1 envelope containing `scope` and an `events` array.
Human output uses the same validated events.

SubagentStop writes only when a valid active `csx-plan-pro` or
`csx-start-goal` state exists and the exact running hook receipt owns the
allowlisted `csx-*` agent role. Events contain bounded workflow, phase, role,
status, timestamp, and optional reason metadata. They exclude raw prompts,
responses, workflow tokens, agent/thread/session IDs, and cwd or filesystem
paths. `failure_detail` is accepted only with a valid `reason_code` and is
limited to 2,048 UTF-8 bytes. It remains caller-supplied free text, so complete
privacy sanitization is not promised; producers should keep sensitive content
out of it.

The writer is fail-open and performs 30-day cleanup on a best-effort basis.
The fixed namespace has an exact logical-content cap of
`2304 finals × 4096 + 64 temps × 4096 + 64 zero-byte reservations = 9,699,328 bytes`.
This is a logical byte limit, not an exact filesystem block-usage claim.
Diagnostics are local only: there is no remote upload, background process, or
write-ahead log.

## Historical installation migration

Install, uninstall, and setup recognize exactly these seven historical
receipt/config/payload signatures:

- H21 at `3abc221`
- H21 at `8933704`
- H21 at `64de366`, in its fresh and setup forms
- H23 at `a221623`, in its fresh and setup forms
- H22 at `9af4616`

Adoption and removal require the complete exact signature. Near matches,
receipt-less installations, and unowned files are not adopted or removed.
Unsupported or unsafe historical state stops before mutation. `csx setup` runs
this migration gate before model catalog discovery or the TUI.

Concurrent mutation by mixed current and old csx versions is unsupported, as is
concurrent mutation involving nested historical installation roots. No
mixed-version compatibility mechanism is provided.

## Transaction recovery

Transaction format v3 records all participants in one immutable,
multi-participant authority bundle. Participant ownership must not overlap.
Every bundle replica is durable before any bridge, journal, or target mutation,
and bundle replicas are removed only after all other transaction records.

Recovery writes no target when a preimage, final endpoint, authority bundle, or
bundle replica is ambiguous; it reports `recovery_required` instead. Recovery
is local and provides no remote write-ahead log, mixed-version compatibility
protocol, or non-Linux durability-parity promise.

## Uninstall

```bash
csx uninstall
```

The command first checks the current directory for a receipt-backed project
installation. A valid project installation wins; a genuinely absent project
installation permits global fallback, while unsafe project authority stops
without falling back. Removing the project installation restores global
fallback for later lifecycle sessions. Uninstall deletes only receipt-owned
files and the csx-managed config blocks, restoring any Leader assignments and
`default_mode_request_user_input` value that installation temporarily
overrode, while preserving other settings and non-empty directories.

The npm CLI remains installed. Remove it separately:

```bash
npm uninstall -g @coolsik/csx
```

Receipt-less or otherwise unowned `csx-local` Codex plugin installations are
not migrated automatically. Remove those separately with the Codex plugin
command before or after installing this package.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```
CI runs syntax checks and package dry-runs on Ubuntu, macOS, and Windows with
Node 20 and 22. Each lane then classifies the optional native lock and local
filesystem without writes. A lane that passes that classifier runs the full
test suite, including native transaction mutation. Every other lane instead
proves that lock acquisition fails with a classified
`lock_capability_unavailable` or `lock_filesystem_unsupported` refusal without
creating `.csx-transactions`. On a supported Linux runner, the full suite also
proves native-lock contention and recovery after a subprocess is forcibly
killed and a new process re-enters recovery; it does not prove recovery across
a VM or host reboot. The Ubuntu Node 20 lane also installs the packed package
with optional dependencies omitted, sets deterministic `HOME` and existing
`CODEX_HOME` directories, and requires a nonzero exit with the exact
`lock_capability_unavailable` CLI diagnostic before asserting that neither the
default home nor the selected `CODEX_HOME` contains installation or
transaction-control paths. CLI setup interaction is exercised through a real
PTY for completion, cancellation, and EOF handling on supported runners.

## License

MIT
