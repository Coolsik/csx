---
name: setup
description: Install or refresh the csx custom subagent TOML files in a trusted project's .codex/agents directory or the user's CODEX_HOME agents directory. Use after installing or updating csx, when csx-* agent types are missing, or when the user asks to configure csx delegation.
---

# setup

Install the bundled csx custom agents before using delegated workflows.

## Workflow

1. Prefer project scope so the agent roster travels with one trusted repository.
2. Resolve this skill's plugin root, then run:

   ```bash
   node <plugin-root>/scripts/install-agents.mjs --project <project-root>
   ```

3. Use `--user` only when the user explicitly wants csx agents in every project.
4. The installer copies `agents/*.toml` and maintains one marked `[agents.csx-*]` registration block in the matching `config.toml`.
5. Existing same-name TOML files are preserved. Show the skipped paths and ask before rerunning with `--force`.
6. If an unmanaged `[agents.csx-*]` table already exists, stop and ask the user to resolve the naming collision; do not overwrite it.
7. Run `--dry-run` when the target or scope is uncertain.
8. After installation, tell the user to start a new Codex thread so the custom agent roster is reloaded.

## Installed Roles

- `csx-explorer`: repository facts
- `csx-analyst`: requirements
- `csx-planner`: implementation plan
- `csx-architect`: architecture challenge
- `csx-critic`: adversarial artifact review
- `csx-executor`: bounded implementation
- `csx-verifier`: completion evidence
- `csx-code-reviewer`: change review

Do not add agent entries to `plugin.json`: Codex loads csx roles from the registered TOML paths under `~/.codex/agents/` or a trusted project's `.codex/agents/`.
