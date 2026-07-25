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
otherwise it configures the global installation. Agent and receipt changes stay
within the selected project or resolved global `CODEX_HOME` scope. Saved presets
are global: they can be used in either scope, but global preset metadata changes
only when you approve saving one. The command accepts no arguments and requires
interactive stdin and stdout. An unmanaged project Codex configuration is
refused before the TUI opens or any setup write is attempted.

On a normal-sized terminal, the first screen is `Current 8-role matrix:`, with a
`Model` and `Reasoning` pair for each role, followed by `Presets:` containing
Low, Medium, High, every saved global custom preset, and Edit current. Low and
Medium use the explicit csx role mapping; High reflects the bundled agent
definitions. Saved entries carry `[custom]`, while the synthesized Edit current
entry carries `[current]`; therefore a custom preset named Edit current remains
valid and visually distinct. `[active]` appears only when all eight pairs
exactly match a preset. If built-in and custom presets have the same complete
matrix, every match is marked active.

Use ↑/↓ and Enter to open a preset `detail:` screen. Its eight rows are followed
by Edit, Apply, and Cancel. Edit is available from Low, Medium, High, every
custom preset, and Edit current; use ↑/↓ to focus each role's `Model:` or
`Reasoning:`, ←/→ to change it, and `Continue to diff` to review changes. In
`Review selected changes:`, Enter includes or excludes an ordinary changed role
before `Continue`. Detail Apply skips editing and also proceeds to this review;
it does not write. A stale catalog-invalid pair must first be changed to an
available pair; its `[mandatory repair]` diff cannot be excluded. Esc returns
from detail, edit, or review screens, while Esc on the top-level preset list and
Cancel exit without applying. Mouse input is not part of this interface.

After diff selection, `Save this full matrix as a global custom preset?` appears
only if the final matrix differs from the current matrix. Custom names must be
non-empty, unique ignoring case, and not reserved. `Final setup preview:` shows
the selected result and offers Apply or Cancel. Apply is the only action that
persists anything; Cancel, top-level Esc, and Ctrl+D write nothing. Ctrl+D
reports `Aborted with Ctrl+D.` and exits with an error after restoring the
terminal. Other input or rendering errors and termination signals also restore
the terminal before preserving their error or signal outcome. At supported
terminal heights of at least 3 rows, list, detail, edit,
`Review selected changes:`, `Final setup preview:`, and custom-name or
inline-error content switch to focused paging when wrapped content exceeds the
viewport. ↑/↓ reaches every wrapped suffix and each
`Continue`, Apply, or Cancel action. `[custom]`, `[current]`, and `[active]`
remain whole markers even when long preset names page at normal height. Enter
on a final-preview value page does nothing; only Enter on a focused Apply or
Cancel action triggers that action. During resize, the semantic item and page
are retained where possible, with the page clamped when the resized viewport
has fewer pages; every page remains reachable without a crash.

Backslashes and terminal control or bidirectional-formatting characters loaded
from saved custom presets or the model catalog keep their raw storage,
selection, and Apply values. Only their screen representation changes, using
reversible `\\`, `\xNN`, or `\uNNNN` visible escapes. The same
presentation-only escaping covers dynamic top-level CLI stdout and stderr,
without changing underlying values, errors, or payloads.

Before commit, setup validates the final pairs against a freshly discovered
Codex app-server catalog and rejects agent or custom-preset drift. Receipt
metadata drift is reconciled without rewriting unchanged agent files. Setup
writes only selected receipt-owned agent files, the complete effective-matrix
receipt when needed, and approved global custom-preset metadata in one
transaction. Validation errors write nothing, and any transactional failure
rolls back the selected changes before the error is reported. If the agent
matrix and receipt already match and no custom save was requested, it reports
`Setup already matches the selected matrix.` without writing agent files.
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
architect, critic, executor, verifier, and code-reviewer.

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
Executor to start another workflow. `csx-verifier` independently gates scoped
goal evidence and the integrated cumulative acceptance claim. When all
execution goals are ready, the unchanged complete diff must also pass
`csx-code-review`; failed evidence or findings return affected goals to rework,
and any later code change invalidates the earlier verification and approval.

## Uninstall

```bash
csx uninstall
```

The command first checks the current directory for a receipt-backed project
installation. If the current directory has no receipt, it removes the global
installation. It deletes only receipt-owned files and the csx-managed config
blocks, restoring any `default_mode_request_user_input` value that installation
temporarily overrode and preserving other settings and non-empty directories.

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
