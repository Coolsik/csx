# csx agent-review improvements notepad

Skills surveyed:
- omo:ulw-loop: required by user; use durable evidence loop.
- skill-creator: updating existing skills; keep SKILL.md concise and validate frontmatter.
- plugin-creator: updating existing local plugin; validate plugin manifest after edits.
- omo:git-master: not used unless committing is explicitly requested; current request is edit/improve only.

Tier: HEAVY. Justification: user explicitly asked to reintroduce critic/architect review behavior and avoid single-agent execution across the skill design, which is workflow architecture and review-sensitive.

Shape: delivery.

Plan summary:
1. Keep csx skill-only and install-simple.
2. Add a shared lightweight subagent policy to the six skills, with bounded triggers and fallback behavior.
3. Reintroduce per-skill review/delegation patterns from original OMX: analyze parallel evidence lanes, spec ambiguity reviewer, plan critic review, plan-pro Architect then Critic, start-goal evidence reviewer, code-review two-lane review.
4. Validate plugin and skill files, scan for forbidden surfaces and OMX branding, and run a local marketplace install smoke test.

Source pattern notes:
- analyze: keep read-only and ranked evidence, add bounded parallel evidence lanes for complex questions.
- spec: keep minimal questioning, add optional independent ambiguity reviewer before final artifact when risk remains.
- plan: add optional critic review for broad/risky plans; direct small plans stay single-lane.
- plan-pro: restore ralplan-style Architect then Critic sequencing, but cap at one revision loop by default.
- start-goal: restore independent evidence/checkpoint reviewer at completion, but use Markdown artifacts only.
- code-review: restore two-lane code-reviewer + architect review; synthesize deterministic verdict.

Forbidden in csx text: OMX branding/dependency, hooks, custom runner, separate CLI, MCP/app surfaces, bundled native agents. Use generic Codex subagent wording and fallback rules only.
