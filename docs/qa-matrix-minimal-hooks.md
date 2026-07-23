# QA Matrix: csx minimal hook reassessment

| Criterion | Scenario invocation | Observable | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| C001 source basis | `rg hooks/hooks.json ...` against local Codex/OMX docs and component tests | plugin-scoped hooks live at `hooks/hooks.json`; original UserPromptSubmit pattern identified | `C001-default-hook-source.txt`, `C001-original-hook-pattern.txt` | PASS |
| C001 subagent preservation | `rg subagent/Architect/Critic/evidence-review ccdx/plugins/csx/skills` | all six skills retain bounded independent review paths | `C001-subagent-review-preserved.txt` | PASS |
| C002 RED baseline | Node assertion before final hook files | missing `hooks/hooks.json` and script fails as expected | `C002-red-missing-default-hook.txt` | PASS |
| C002 hook contract | Node assertion over manifest, hook JSON, script path, timeout | no top-level manifest hook; exactly one UserPromptSubmit hook with 3s timeout | `C002-green-default-hook-contract.txt` | PASS |
| C002 hook behavior | `node ccdx/plugins/csx/scripts/csx-hook.mjs user-prompt-submit` with triggered, normal, mid-sentence, unknown-skill, invalid JSON payloads | triggered emits csx context; all non-trigger cases emit 0 bytes | `C002-hook-surface-final.txt` | PASS |
| C003 plugin validation | `python3 .../validate_plugin.py ccdx/plugins/csx` | plugin schema passes with manifest-free hook files | `C003-validate-plugin-final3.txt` | PASS |
| C003 skill validation | `python3 .../quick_validate.py` for each skill | all six SKILL.md files pass | `C003-validate-skills-final3.txt` | PASS |
| C003 install smoke | temp `CODEX_HOME`, `codex plugin marketplace add`, `codex plugin add`, `codex plugin list`, cached hook script execution | plugin installed/enabled, hook files copied into cache, cached script emits code-review routing context | `C003-install-smoke-final3.txt` | PASS |
| C003 diff hygiene | `git -C csx diff --check` | whitespace check passes | `C003-diff-check-final3.txt` | PASS |
| C003 heavy surface scan | manifest keys + hook events + rg scan | only allowed `Hooks`/`Workflow` and one UserPromptSubmit hook; heavy terms appear only in negative policy or normal prose | `C003-heavy-surface-scan-final.txt` | PASS |

Limit: the Codex CLI exposes plugin install/list but no `codex plugin validate`, `codex skill validate`, or dry-run plugin hook dispatch command. Validation therefore uses the bundled official skill/plugin validator scripts plus cached hook execution. `codex features list` reports `hooks stable true`.
