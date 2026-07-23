# csx minimal hooks reassessment

Brief: Reassess whether csx should use minimal hooks, referencing original OMX but keeping csx easy to install/use and not coupled to OMX.

Skills: ulw-loop for evidence workflow; skill-creator for skill updates; plugin-creator for plugin structure/validation; git-master STATUS only for history/status because no commit requested.

Tier: HEAVY - plugin surface decision plus user explicitly requested re-check/improve.

Criteria:
- C001: original OMX hook/skill pattern and current csx gap documented from source evidence.
- C002: csx updated with minimal hook policy and, if justified, hook files/manifest-compatible structure.
- C003: validation/install smoke and independent review pass.
Notepad update
2026-06-26T03:16:57Z

Decision: add one manifest-free plugin-scoped UserPromptSubmit hook at hooks/hooks.json. Do not add top-level plugin.json hooks because validator rejects it. Do not add Stop/PostToolUse/MCP/app/runner/background service.

Evidence: C002-red-missing-default-hook RED, C002-green-default-hook-contract GREEN, C002-hook-surface-final hook behavior, C003-validate-plugin-final2, C003-validate-skills-final2, C003-install-smoke-final2.
