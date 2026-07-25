# Code Review: `csx setup` TUI

## Evidence Revision

R014

## Findings

- Severity: HIGH
  Location: `lib/setup-tui.js:375`
  Issue: 3-row detail rendering drops the selected preset's Model/Reasoning, while the 3-row list viewport has no focus/page path to the current 8-role matrix or complete active markers. The explicit 10×3 support contract is therefore not met.
  Recommendation: add compact focus/page states that expose baseline rows, complete active entries, and selected preset Model/Reasoning; prove each current frame rather than cumulative PTY output.

- Severity: MEDIUM
  Location: `lib/setup-tui.js:482`
  Issue: cleanup snapshots `wasRaw` but only calls `setRawMode(false)` when the stream started non-raw. Ink unmount disables raw mode, so an initially raw injected stream may not be restored to its original state.
  Recommendation: after unmount, explicitly restore `input.setRawMode(wasRaw)` and lock both initial states in tests.

- Severity: MEDIUM
  Location: `.github/workflows/ci.yml:27`
  Issue: when native transaction mutation is unsupported, the workflow skips the complete suite and runs only the lock-refusal smoke, so pure TUI/detail Cancel/resize/signal regressions are not exercised in those OS/Node cells.
  Recommendation: always run mutation-independent TUI/command/PTY tests and gate only mutation-dependent tests.

## Verification Reviewed

- R014 cumulative verifier: AC1–AC14 PASS before adversarial frame-level review.
- `npm test`: 145 total, 143 pass, 0 fail, 2 platform skips.
- Actual PTY: 13/13; Apply 1, detail Cancel/top-level Esc Apply 0 and hash invariant.
- Node 20/22 core: 27/27 each.
- Setup/transaction: 49 pass, 1 Windows-only skip.
- `npm ci`, dependency pins, check, pack dry-run, and diff check PASS.
- Reviewers reproduced the 10×3 current-frame information loss that the cumulative-output tests missed.

## Independent Review

- csx-code-reviewer: REQUEST CHANGES
- csx-architect: BLOCK

## Verdict

REQUEST CHANGES

## Residual Risk

The actual macOS/Windows CI cells were not executed locally. Signal behavior has injected/fake-target proof but no real PTY signal process proof. These remain explicit platform boundaries after the blocking viewport issue is fixed.
