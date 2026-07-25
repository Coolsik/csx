# Code Review: `csx setup` full-screen TUI

## Evidence Revision

R024

## Findings

- Severity: HIGH
  Location: `lib/setup-tui.js:429-464`
  Issue: 10×3 compact rendering truncates wrapped model, reasoning, and preset values with `.slice(0, rows)` and exposes no continuation state. Long valid catalog identifiers or custom names can lose their suffix, and a long active preset can hide `[active]`.
  Recommendation: Add navigable wrapped-chunk subpages for complete compact values, keep active status independently visible, and cover long/CJK values in list/detail/edit and resize tests.

- Severity: MEDIUM
  Location: `lib/setup-tui.js:55,79,91,356,442`
  Issue: Active state is keyed only by display name. A valid custom preset named `Edit current` collides with the synthetic current-matrix action, making selection and active display ambiguous.
  Recommendation: Use stable entry identity/kind for active matching and safely disambiguate the custom entry from the synthetic action without invalidating persisted metadata; add a collision regression.

## Verification Reviewed

- Fresh R024 integrated verification: AC1–AC14 PASS.
- `npm test`: 151 total, 149 pass, 0 fail, 2 Windows-only skips.
- Node20 selected PTY 5/5 twice; Node22 5/5.
- `npm run check`, `npm pack --dry-run`, `git diff --check`: PASS.
- Prior R014 raw-mode and CI gate findings are closed.
- R022 current-frame flake is closed without weakening its exact assertion.

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

Actual macOS/Windows runner results and real-process signal PTY evidence remain unavailable locally, but neither was independently blocking. The blocking input-domain gaps above must be fixed and reverified at a new revision.
