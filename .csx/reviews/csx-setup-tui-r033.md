# Final Cumulative Review — `csx-setup-tui` R033

## Verdict

`REQUEST CHANGES`

- `csx-code-reviewer`: `REQUEST CHANGES`
- `csx-architect`: `BLOCK`
- Composite: `REQUEST CHANGES`

## Controlling Request

> `$csx-spec csx setup을 tui구조로 바꾸고싶어.`
>
> `일단 진입하면 현재 역할 별 모델/리즈닝을 같이 보여주고,`
>
> `preset을 고르면 해당 프리셋의 모델/리즈닝 리스트를 보여준 후 적용/cancel 을 보여주고`
>
> `현재 선택된 모델과 리즈닝을 바탕으로 어떤 프리셋과 일치하면 해당 프리셋이 선택되어 있다는것도 알수있게하고싶어`

## Blocking Findings

1. **HIGH — post-TUI catalog-drift error terminal injection**
   - `lib/presets.js` embeds raw external model/reasoning values in validation error messages.
   - `bin/csx.js` writes the raw message to stderr after alternate-screen cleanup.
   - An initially valid OSC/C1/bidi pair removed by the fresh Apply-time catalog can therefore execute terminal control sequences.
   - Required: retain raw error/payload semantics but apply one shared reversible presentation escape at terminal output boundaries; add actual PTY drift evidence with commit 0 and no raw control bytes.

2. **HIGH — overflow paging excludes diff/confirm review boundaries**
   - Focused paging covers only list/detail/edit.
   - At 10×3 with long valid values, diff/confirm cannot expose all wrapped chunks even by visiting every selectable item/action.
   - Required: extend semantic item/page navigation and resize preservation/clamp to diff and confirm; cover all escaped chunks/actions at 10×3, 10×4, and overflowing 80×24 in unit and actual PTY evidence.

## Non-blocking Finding

- **LOW — normal-mode preset markers can split across lines**
  - A long custom label can wrap `[active]` into separate fragments while the screen still fits its viewport.
  - Required in the rework: render normal preset markers as atomic chunks or enter focused paging when atomicity cannot be preserved.

## Confirmed Clear Areas

- R028 list/detail/edit any-height overflow paging is closed.
- TUI-internal control/bidi escaping and raw identity/matrix/Apply payload preservation are correct.
- Stable custom/current identities and duplicate exact active matching are correct.
- Apply-once, Cancel/no-write, lifecycle cleanup, transaction rollback/drift/no-op, recovery authority, and capability-independent CI remain clear.
- R033 integrated verification passed before this review; its tests did not cover the two blocking paths above.

## Residual Risk

- Actual macOS/Windows runner execution was not available locally.
- Actual process-level signal PTY evidence and complex grapheme width remain disclosed non-blocking risks.
