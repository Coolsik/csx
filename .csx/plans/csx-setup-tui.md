# Plan: `csx setup` 전체 화면 TUI 전환

## Decision

READY

## Review

APPROVED
Approved draft_version: 2

## Planner Body

# Plan: `csx setup` 전체 화면 TUI 전환

draft_version: 2

## Goal and Boundaries

기존 질문형 `csx setup`을 전체 화면 목록·상세 패널 TUI로 교체한다. 진입 즉시 현재 8개 역할의 Model/Reasoning을 표시하고 Low/Medium/High/저장 custom/Edit current 탐색, exact-match active 표시, 모든 시작 행렬의 역할별 편집, stale catalog-invalid 설정의 강제 repair, diff 선택, 조건부 custom 저장, Apply/Cancel을 제공한다. Apply만 기존 `applySetup` transaction을 호출한다.

preset·역할 정의, app-server protocol, setup argv·비대화형 지원, scope 판정, 저장 형식·receipt·rollback·drift 의미를 바꾸지 않고 마우스를 필수 계약으로 추가하지 않는다.

## Decisions and Assumptions

### User-confirmed Decisions

- 전체 화면 목록·상세 패널 TUI를 사용한다.
- 방향키·Enter·Esc 조작을 제공한다.
- 검증된 production TUI 의존성 도입을 허용한다.

### Confirmed Repository Constraints

- `AGENT_NAMES`의 정확히 8개 역할과 각 `{model, reasoning}` 구조를 유지하며, active는 8개 쌍의 exact match일 때만 성립한다 (`lib/presets.js:1-57`).
- 적용은 catalog pair 검증, baseline/custom drift 재검증, receipt, transaction, rollback을 보존하는 `applySetup`을 우회할 수 없다 (`lib/setup.js:105-223`).
- project receipt가 우선이고 unmanaged project config는 catalog/TUI 전에 거부한다 (`lib/setup.js:58-75`).
- argv·비TTY 거부와 EOF `AbortError`의 `Aborted with Ctrl+D.`/exit 1 의미를 유지한다 (`bin/csx.js:62-67,172-183`).
- 모든 Low/Medium/High/saved custom/Edit current 시작점에서 역할별 편집 후 diff로 진행할 수 있고, `finalChanged.length === 0`이면 custom-save choice/name을 건너뛴다 (`bin/csx.js:129-166`).
- `mandatory`는 baseline에서 catalog-invalid이면서 draft에서 변경된 행이다. 해당 repair는 diff에서 선택 해제하거나 baseline으로 복원할 수 없고, 최종 행렬은 confirm 전에 다시 catalog 검증해야 한다 (`bin/csx.js:223-259`, `README.md:71-74`).

### Reversible Assumptions

- `ink@6.8.0`, `react@19.2.3`을 production dependencies로 정확히 고정하고 `ink-testing-library@4.0.0`을 devDependency로 사용한다. 빌드 없이 ESM `.js`와 `React.createElement`를 쓴다.
- 중복 built-in/custom exact match는 우선순위 없이 모두 `[active]`로 표시한다.
- active는 편집 draft가 아니라 진입 시 clone한 불변 `baselineMatrix`에서 계산한다.
- 렌더러에 `{columns, rows}`를 주입하고 EventEmitter fake TTY와 실제 `node-pty.resize()`를 병행한다.
- ANSI alternate-screen·cursor·signal 수명주기는 Ink 외부의 멱등 cleanup 래퍼가 소유한다.

### Open Decisions

None.

## Acceptance Criteria

- C1: 유효한 TTY의 첫 화면에 현재 8개 역할의 Model/Reasoning이 모두 보인다.
- C2: 목록에 Low, Medium, High와 모든 저장 custom preset이 보인다.
- C3: 위/아래로 선택하고 Enter로 해당 preset 상세에 진입한다.
- C4: 상세에서 8개 행과 Edit, Apply, Cancel을 함께 접근할 수 있다.
- C5: 상세 Esc는 목록으로, 최상위 Esc와 Cancel은 agent·receipt·custom 무기록 종료한다.
- C6: 누락이나 한 쌍 차이 없이 8개 쌍이 모두 같을 때만 active다.
- C7: 동일한 built-in/custom 항목은 모두 active다.
- C8: Apply만 최종 행렬을 `applySetup`에 정확히 한 번 전달하며 invalid pair와 drift는 commit하지 않는다. unmanaged scope는 TUI·Apply·write 모두 0회인 preflight 오류다.
- C9: agent 행렬과 receipt의 `setupAgentMatrix`가 같고 custom 저장 요청도 없을 때만 `changed:false`이며 agent 파일을 쓰지 않는다. receipt-only drift/custom 저장은 필요한 metadata를 기록하고 `changed:true`다.
- C10: EOF, Esc, Cancel, 입력·렌더 예외, 종료 신호에서 raw mode·화면을 복구하고 Apply하지 않는다. EOF는 exit 1, 일반 예외는 cleanup 후 rethrow, signal은 cleanup 후 원 signal 종료 의미를 보존한다.
- C11: 좁은 화면과 resize에서도 8개 역할과 두 필드에 wrap/scroll로 접근할 수 있다.
- C12: 비TTY/argv, 각 preset/custom, project scope, cancel/no-write, EOF 및 stale catalog-invalid 행을 반드시 repair하는 기존 의미를 보존한다.
- C13: 실제 PTY에서 이동·상세·Esc·active·Apply 1회·Cancel write 0회를 증명한다.
- C14: invalid pair, `mandatory` repair 해제 거부와 최종 성공, write-failure rollback, baseline/custom drift, receipt-only drift, no-change를 unit/integration으로 증명한다.

## Steps

1. `package.json`, `package-lock.json` 소유: Ink 6.8.0/React 19.2.3/ink-testing-library 4.0.0을 고정하고 새 모듈을 `check`에 포함한다. Node 20/22에서 설치, peer 해석, ESM import를 확인한다.
2. 새 `lib/setup-tui.js`의 `matrixMatches`, `matchingPresetNames`, 상태 생성/reducer 소유: 불변 baseline과 별도 draft를 두고 `list → detail → edit → diff → save-custom-choice → custom-name → confirm → applying/done`을 구현한다. 모든 Low/Medium/High/saved custom/Edit current 상세는 `Edit`으로 clone된 해당 시작 행렬을 역할별 model/reasoning 편집한 뒤 diff로 보낸다. 상세 Apply도 diff로 간다. diff 진입 시 `mandatory = invalidRows(baseline,catalog) ∩ changedRows(baseline,draft)`를 계산해 별도 불변 집합으로 보존한다.
3. 같은 상태 머신의 diff·검증·입력 소유: 일반 제외 행만 baseline으로 복원하며 `mandatory` 행은 repair-required로 표시하고 토글·선택 해제·baseline 복원을 거부한다. 선택 반영 후 final matrix를 catalog로 다시 검증하고 invalid pair가 남으면 inline 오류와 함께 diff/edit에 머물러 confirm 진입을 막는다. `finalChanged.length > 0`일 때만 custom-save choice/name을 거치고, 0이면 no-change preview와 confirm Apply/Cancel로 직행한다. no-change custom 저장은 노출하지 않는다. 이름의 공백·예약어·대소문자 무시 중복을 막고 상세 Esc→목록, 편집 Esc→상세, 최상위 Esc→cancel을 정의한다.
4. `lib/setup-tui.js`의 `SetupTui`, `runSetupTui` 소유: 현재 패널, active 목록, 상세·편집·diff·confirm과 `mandatory` repair 표식을 렌더링하고 주입 dimensions 기반 wrap/focus-following viewport를 제공한다. alternate screen, cursor, raw mode, EOF, SIGINT/SIGTERM/SIGHUP, input/render 예외를 멱등 `finally`로 정리하며 EOF·예외·signal 종료 의미를 분리한다.
5. 새 `lib/setup-command.js`의 `runSetupCommand(options,deps)`와 `bin/csx.js` setup 호출부 소유: `selectSetupScope → catalog → baseline → built-ins/custom → TUI` 순서를 두고 `runSetupTuiFn`, `applySetupFn`, catalog loader를 주입한다. TUI `apply` 결과에만 clone된 최종·재검증 완료 행렬, baseline, 재조회 loader, custom 이름, selectedAgents를 한 번 전달한다. argv/TTY gate와 `renderError`는 유지한다.
6. `test/setup-tui.test.js`, `test/setup-command.test.js`, `test/setup.test.js`, `test/cli.test.js` 소유: exact match, 상태 전이, dimensions/resize, cleanup, no-change custom 화면 생략을 추가한다. Low/Medium/High/saved custom/Edit current 각각 `Edit → 역할 변경 → diff` 회귀를 둔다. stale-invalid baseline 행을 유효 pair로 고친 fixture에서 reducer가 이를 `mandatory`로 표시하고 해제 시도를 무시하며 final validation 후 confirm에 진입하는지 검증한다. 다른 invalid pair가 남은 final matrix는 confirm을 막는다. unmanaged preflight는 TUI 0/apply 0/write 0으로 분리하고 transaction 전 invalid 거부, 중간 write 실패 시 agent·receipt·custom 원본 복원, drift/receipt/no-change를 검증한다.
7. `test/fixtures/setup-tui-harness.js`, `.github/workflows/ci.yml`, `README.md` 소유: 주입 seam을 사용하는 별도 harness 프로세스를 실제 `node-pty` 내부에서 실행해 Apply 호출 횟수를 프로세스 결과로 1회, Cancel을 0회로 증명한다. PTY integration에 stale-invalid 행 repair, 해제 시도 후 `mandatory` 유지, 유효 final Apply 성공 시나리오와 `node-pty.resize()`를 포함한다. CI embedded PTY를 방향키/Enter Apply 경로로 교체해 lock-refusal 무기록 검증을 보존한다. README에 화면 전이, Edit/diff, mandatory repair, active, 조건부 custom 저장, Apply/Cancel, scope·오류·좁은 화면을 기록한다.

## Verification Matrix

| Criterion | Evidence | Command or Scenario | Expected Result | Failure Signal |
|---|---|---|---|---|
| C1 | renderer+PTY | `node --test test/setup-tui.test.js test/cli.test.js` 첫 frame | 현재 8행/두 필드 표시 | 행·필드 누락 |
| C2 | renderer | built-ins+복수 custom fixture | 모든 항목 표시 | preset 누락 |
| C3 | reducer+PTY | Down→Enter | 선택 상세 진입 | 잘못된 선택/무반응 |
| C4 | frame test | 상세 tiny/normal frame | 8행과 Edit/Apply/Cancel 접근 | 행·액션 숨김 |
| C5 | command+PTY | 상세/최상위 Esc, Cancel 전후 파일 hash | 복귀/종료, Apply 0·byte-identical | 호출·파일 변경 |
| C6 | unit | 동일/누락/한 pair 차이 | 완전 일치만 active | 부분 일치 active |
| C7 | unit | built-in/custom 동일 fixture | 둘 모두 active | 하나만 active |
| C8 | command+integration | invalid/drift Apply; unmanaged preflight | 전자는 commit 0, 후자는 TUI/apply/write 0 | 검증 우회·부분 commit |
| C9 | setup integration | 완전 일치; receipt drift; custom 저장 | false/agent write 0; 뒤 둘 true/metadata 기록 | 잘못된 no-op/불필요 write |
| C10 | fake TTY+PTY | Ctrl+D, throw, 지원 signal | cleanup; EOF 1; rethrow; signal 보존; Apply 0 | 터미널 잔류/오류 은폐 |
| C11 | dimensions+resize | tiny 시작 후 `node-pty.resize()` | 전 역할/필드 순회 | focus 유실/crash |
| C12 | 전체 회귀+stale fixture | `npm test`; stale repair 해제 시도 | 기존 계약 통과, mandatory 유지·repair 성공 | baseline 복원/repair 우회 |
| C13 | 실제 node-pty harness | 이동→상세→Esc→Apply; 별도 Cancel | Apply count 1, Cancel 0/write 0 | mock만 존재/횟수 불일치 |
| C14 | reducer+setup integration | stale repair 토글, final invalid, rollback/drift/no-change | 해제 거부·표시·유효 Apply; invalid confirm 차단; 나머지 통과 | invalid confirm/복원 실패 |

## Risks and Stop Conditions

- 가장 강한 미해결 위험은 Ink unmount/raw-mode와 사용자 정의 alternate-screen/signal cleanup 순서의 Node 20/22 및 Ubuntu/macOS/Windows 차이다. 정상·EOF·예외·지원 signal과 resize를 실제 PTY로 검증한다.
- Windows에서 POSIX signal 재현이 불가하면 해당 signal은 지원 OS에서, Windows는 실제 지원 종료 경로와 raw/screen 복구를 별도로 증명한다.
- custom 목록을 첫 화면에 표시하므로 custom 파일 손상 오류가 기존보다 일찍 나타날 수 있으나 schema·transaction 의미는 바꾸지 않는다.
- 의존성 설치/import 실패, cleanup·종료 의미 변화, tiny terminal 접근 불가, 어느 시작 preset에서든 Edit→diff 회귀, no-change custom 화면 노출, `mandatory` 계산·표시·해제 거부 실패, final invalid의 confirm 진입, stale repair PTY Apply 실패, unmanaged 시 TUI/apply/write 발생, actual `node-pty` Apply count 부재, rollback/CI lock-refusal 회귀, 또는 C1~C14 실패 시 완료하지 않는다.

## Critic Review

reviewed draft_version: 2

verdict: APPROVED

## Findings

- 이전 v1의 세 가지 필수 수정이 모두 실행 가능한 수준으로 반영됐습니다.

  - `mandatory = invalidRows(baseline, catalog) ∩ changedRows(baseline, draft)`가 기존 구현 (`bin/csx.js:248-259`)과 일치합니다.
  - mandatory 행의 토글·선택 해제·baseline 복원을 명시적으로 거부합니다.
  - 제외 반영 후 최종 matrix를 다시 catalog 검증하고 invalid 상태의 confirm 진입을 차단합니다.

- reducer, 실제 PTY, verification matrix, stop condition 모두 mandatory 표시·해제 거부·유효 repair Apply 성공을 관찰합니다. 단순 unit 검증에 머물지 않습니다.

- prior BLOCKED artifact의 네 가지 필수 수정도 유지됐습니다. 모든 시작 행렬의 Edit 경로, no-change custom 화면 생략과 최종 confirm, unmanaged preflight 0-call/0-write, repository constraint 분리가 일관됩니다.

- 상세의 Edit/Apply 병존, no-change Apply 의미, 실제 `node-pty` harness의 Apply 1회/Cancel 0회 증거 경로가 명확합니다.

- C1~C14 각각에 실행 명령·관찰 결과·실패 신호가 있고, 코드 소유권과 orchestration seam도 구현자가 별도 제품 결정을 만들지 않고 착수할 만큼 구체적입니다.

## Required changes

없음.

## Residual risks

Ink unmount와 외부 alternate-screen/raw-mode/signal cleanup 순서의 플랫폼 차이는 남아 있습니다. 다만 실제 PTY, fake TTY, resize, Node 20/22 및 지원 OS별 signal 검증과 명시적 stop condition으로 적절히 통제됐습니다. 중간 상태에서 Esc의 세부 복귀 위치는 구현 표현 범위이며 승인 차단 사유가 아닙니다.

## Review Summary

첫 planning pass의 draft_version 2는 기존 preset 편집 및 no-change custom 저장 의미 누락 등으로 승인되지 않아 BLOCKED로 보존됐다. 사용자가 Refine further를 선택해 새 pass를 시작했고, 새 draft_version 1은 이전 네 가지 지적을 해소했으나 stale catalog-invalid baseline의 mandatory repair 규칙 누락으로 `REVISE` 판정을 받았다. 동일 Planner가 이를 반영한 draft_version 2는 mandatory 계산·잠금·최종 재검증과 reducer/실제 PTY 회귀를 포함했으며, 독립 Critic이 `APPROVED`했다.

## Handoff

계획은 실행 준비가 완료됐다. 구현은 사용자가 `$csx-start-goal` 실행을 명시적으로 선택한 뒤에만 시작하며, 선택 시 이 계획의 Reversible Assumptions와 Verification Matrix, Risks and Stop Conditions를 함께 인계한다.
