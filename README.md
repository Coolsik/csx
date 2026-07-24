# csx

csx installs a small set of Codex-native workflow skills, custom agents, and an
explicit prompt-routing hook. It has no runtime dependencies, background
service, MCP server, or Codex plugin.

## Requirements

- Node.js 20 or newer
- Codex on macOS, Linux, or Windows

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

Global installation writes only below `${CODEX_HOME:-~/.codex}`. If
`CODEX_HOME` is explicitly set, that directory must already exist.

Project installation writes skills to `.agents/skills`, agents and hooks to
`.codex`, and a managed block to `.codex/config.toml`. Without
`--project-root`, csx installs into the directory where the command is run.
Git is not required. Project installation never changes the global Codex home.

csx refuses to overwrite same-name files unless its installation receipt proves
they are managed by csx. Existing config outside the marked csx block is
preserved. Start a new Codex session after installation. Codex will ask you to
review and trust the command hook on first use.

## Skills

Invoke a skill directly with its installed name:

```text
$csx-analyze explain this repository behavior
$csx-spec clarify this feature idea
$csx-plan create an implementation plan
$csx-plan-pro plan this architecture-sensitive migration
$csx-start-goal execute the accepted plan
$csx-code-review review the current changes
```

The hook also recognizes prompts beginning with `csx analyze`, `csx spec`,
`csx plan`, `csx plan-pro`, `csx start-goal`, or `csx code-review`. Ordinary
natural-language prompts are not routed.

Installed custom agents are namespaced `csx-*`: explorer, analyst, planner,
architect, critic, executor, verifier, and code-reviewer.

## Uninstall

```bash
csx uninstall
```

The command first checks the current directory for a receipt-backed project
installation. If the current directory has no receipt, it removes the global
installation. It deletes only receipt-owned files and the csx-managed config
block, preserving other settings and non-empty directories.

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

## License

MIT
