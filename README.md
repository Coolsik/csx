# csx

csx installs a small set of Codex-native workflow skills, custom agents, and an
explicit prompt-routing hook. It has no background service, MCP server, or
Codex plugin. Mutating commands require the optional native
`fs-ext-extra-prebuilt@2.2.9` package at runtime and fail closed when that
capability is unavailable.

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
review and trust the command hook on first use.
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
$csx-start-goal execute the accepted plan
$csx-deslop clean this bounded change without changing behavior
$csx-code-review review the current changes
```

The hook also recognizes prompts beginning with `csx analyze`, `csx spec`,
`csx plan`, `csx plan-pro`, `csx start-goal`, `csx deslop`, or
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
running the same behavior lock before and after one bounded cleanup pass. When
all execution goals are ready, the
root runs the accepted cumulative verification once and the unchanged complete
diff must pass `csx-code-review`. Findings outside accepted scope or concrete
change-induced safety and regression risks are recorded as optional hardening
rather than silently expanding the goal.

## Uninstall

```bash
csx uninstall
```

The command first checks the current directory for a receipt-backed project
installation. If the current directory has no receipt, it removes the global
installation. It deletes only receipt-owned files and the csx-managed config
blocks, restoring any Leader assignments and
`default_mode_request_user_input` value that installation temporarily
overrode, while preserving other settings and non-empty directories.

The npm CLI remains installed. Remove it separately:

```bash
npm uninstall -g @coolsik/csx
```

Older `csx-local` Codex plugin installations are not migrated automatically.
Remove those separately with the Codex plugin command before or after installing
this package.

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
