# Code Review: `csx setup` full-screen TUI

## Evidence Revision

R028

## Findings

- Severity: HIGH
  Location: `lib/setup-tui.js:77,329,631`
  Issue: Focused wrapped-subpage navigation is enabled only for `rows <= 3`. At 10×4, and at larger heights where unbounded values still overflow the viewport, the normal renderer makes matrix and wrapped suffixes unreachable.
  Recommendation: Select focused paging from actual screen-content overflow rather than a fixed height threshold; preserve atomic markers and add 10×4, 3↔4, and normal-height overflow current-frame PTY tests.

- Severity: HIGH
  Location: `lib/setup.js:91-101`, `lib/codex-models.js:18-25`, `lib/setup-tui.js:207-248,464-624`
  Issue: Persisted custom names and catalog model/reasoning strings may contain newline, C0/C1, ESC/OSC, DEL, or bidi controls, which are passed unescaped into Ink. Page-height/marker invariants can break and terminal control injection is possible.
  Recommendation: Apply one reversible presentation-only escape before wrapping/rendering, while retaining raw identity/matrix/name values for selection and persistence. Add adversarial unit and actual PTY coverage.

## Verification Reviewed

- Fresh R028 integrated verification: AC1–AC14 PASS under printable ASCII/Hangul fixtures.
- `npm test`: 154 total, 152 pass, 0 fail, 2 Windows-only skips.
- Node20/22 pure 33/33 and selected PTY 6/6.
- R024 long-value and stable-identity blockers are closed in 10×3.
- Transaction, raw lifecycle, Apply-once, and capability-independent CI boundaries remain clear.

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

macOS/Windows runners and real-process signal PTY remain locally unexecuted but were not independently blocking. The overflow-mode and presentation-safety findings above require a new revision and fresh gates.
