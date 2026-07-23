# csx

csx is a small Codex-native delegated workflow plugin. It bundles workflow skills and namespaced custom subagents for evidence gathering, planning, implementation, verification, and review.

## Install

Use this repository as a local Codex marketplace. From the repository root:

```bash
codex plugin marketplace add .
codex plugin add csx@csx-local
```

Then install the bundled agents into the current trusted project:

```text
$csx:setup
```

The setup skill copies the bundled TOML files to `.codex/agents/` and maintains their `[agents.csx-*]` registrations in `.codex/config.toml`. Start a new Codex thread afterward so the role roster reloads. No background service, MCP server, app, or external runtime is required.

## Skills

| Skill | Use for | Output |
| --- | --- | --- |
| `setup` | Install and register the `csx-*` custom agents | `.codex/agents/*.toml`, `.codex/config.toml` |
| `analyze` | Read-only repository explanation | Evidence-ranked answer |
| `spec` | Turn vague intent into an actionable specification | `.csx/specs/<slug>.md` |
| `plan` | Create a direct implementation plan | `.csx/plans/<slug>.md` |
| `plan-pro` | Create a higher-rigor plan with a critic pass | `.csx/plans/<slug>-pro.md` |
| `start-goal` | Track a multi-step task with criteria and evidence | `.csx/goals/<slug>.md` |
| `code-review` | Review changes with findings first | `.csx/reviews/<slug>.md` |

## Subagents

| Role | Ownership |
| --- | --- |
| `csx-explorer` | Repository evidence and call-path mapping |
| `csx-analyst` | Requirements and acceptance criteria |
| `csx-planner` | Implementation sequencing and verification plan |
| `csx-architect` | Boundaries, coupling, and design challenge |
| `csx-critic` | Adversarial spec and plan review |
| `csx-executor` | One bounded implementation slice |
| `csx-verifier` | Independent completion evidence |
| `csx-code-reviewer` | Correctness, security, tests, and maintainability |

Read-only roles set `sandbox_mode = "read-only"`. The executor inherits the parent thread's sandbox and permissions. All csx roles are leaf agents and return evidence to the main coordinator instead of spawning grandchildren.

## Design Contract

- Use Codex plugin and skill behavior, native custom-agent TOML files, and ordinary workspace files.
- Hooks are allowed only when they preserve install-and-use simplicity.
- csx ships one plugin-scoped `UserPromptSubmit` hook at `hooks/hooks.json`. It only routes prompts that start with `$csx:<skill>` or `csx <skill>` to the matching skill context.
- Do not add Stop, PostToolUse, MCP, app, background-service, or runner behavior unless a future workflow proves it is necessary.
- Keep workflows short enough for repeated everyday use.
- Preserve the highest-value gates: evidence, acceptance criteria, explicit uncertainty, review findings, and completion checks.
- Install namespaced role files only through the bundled `setup` workflow; preserve existing files unless the user explicitly requests replacement.
- Keep the main Codex thread as coordinator and artifact owner. Delegate bounded specialist work, wait for results, and independently verify returned evidence.
- Do not require extra binaries, services, MCP servers, or background automation.
- Keep optional cleanup and QA checks inside `start-goal` and `code-review` instead of adding extra skills.

## First Use

Ask Codex with the skill name:

```text
$csx:setup
$spec clarify this feature idea
$plan create an implementation plan for the spec
$start-goal execute this plan with evidence
$code-review review the current changes
$csx:spec clarify this feature idea
```

The `csx:` prefix is optional. It uses the bundled prompt hook when Codex hooks are enabled and trusted; direct skill invocation remains the baseline path. After setup, start a new thread before invoking delegated skills.

Each stateful skill writes a small Markdown artifact under `.csx/` in the target workspace. If `.csx/` does not exist, Codex should create only the needed subfolder.
