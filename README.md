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
otherwise it configures the global installation. A project setup reads and
writes only that receipt-backed project scope while using Low, Medium, or High.
Saved global custom presets are read only after selecting that initial menu
choice, and global preset storage is read only after the final effective matrix
has changes you approve for saving. Model discovery still runs the active Codex
app-server with its resolved `CODEX_HOME`. It obtains the available model and
reasoning-effort pairs from that app-server, so a stale agent setting must be
repaired before it can be applied.

Choose Low, Medium, High, a saved global custom preset, or Edit current matrix;
then select any agent row to change its model and effort before reviewing the
exact per-field diff and selected scope root. Low and Medium use the explicit
csx role mapping. High reflects the currently bundled agent definitions. A
confirmed effective matrix with selected changes can be saved as a global
preset; preset names must be unique. Setup writes only selected receipt-owned
agent files, plus the complete effective-agent-matrix receipt and approved
global-preset metadata, in one transaction; it rolls back all selected changes
on failure.

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

`csx-plan` and `csx-plan-pro` produce versioned planning artifacts under
`.csx/plans/`. A revised draft must be reviewed again, and `csx-plan-pro`
requires Architect `CLEAR` plus Critic `APPROVED` for the same draft version.
Both skills record verification evidence and finish with an explicit choice to
refine, stop, or authorize execution through `csx-start-goal`; BLOCKED plans
cannot enter execution.

`csx-start-goal` creates one aggregate Codex goal for the accepted plan and
tracks bounded `G001...Gnnn` execution goals in `.csx/goals/`. Non-trivial
implementation is followed by scoped `csx-deslop` cleanup and the same
verification. When all execution goals are ready, the complete cumulative diff
must pass `csx-code-review`; failed findings return affected goals to rework and
any later code change invalidates the earlier approval. The standalone
`csx-verifier` agent remains installed for independent use, but it is not a
completion dependency of `csx-start-goal`.

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
