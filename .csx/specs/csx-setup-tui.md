# Spec: `csx setup` 전체 화면 TUI 전환

Status: READY_WITH_ASSUMPTIONS  
Context: brownfield  
Input Summary: 기존 질문형 setup wizard를 방향키·Enter·Esc로 조작하는 전체 화면 TUI로 전환한다. 현재 역할별 모델/리즈닝, 프리셋 목록과 상세 패널, Apply/Cancel, 현재 설정과 일치하는 프리셋 상태를 제공한다. 검증된 TUI 라이브러리 도입을 허용한다.

## Intent

사용자가 설정을 변경하기 전에 현재 8개 역할의 모델과 리즈닝을 한눈에 확인하고, 키보드로 프리셋을 탐색하여 전체 구성을 검토한 뒤 명시적으로 적용하거나 취소하게 한다.

## Outcome

- 전체 화면 목록·상세 패널 TUI를 제공한다.
- 진입 즉시 현재 역할별 model/reasoning 행렬을 표시한다.
- 프리셋 선택 시 해당 8개 역할 구성을 표시한다.
- 현재 행렬과 정확히 일치하는 프리셋을 active로 표시한다.
- Apply 외의 탐색·취소는 설정을 변경하지 않는다.
- 기존 검증, transaction, rollback, drift 방지 의미를 유지한다.

## Scope Ledger

### Artifacts

- `csx setup` 전체 화면 TUI
- 현재 행렬과 preset의 exact-match 판별
- 검증된 TUI 라이브러리 production 의존성
- CLI PTY·setup unit 테스트 갱신 및 추가
- README setup UX와 키보드 조작 설명

### Surfaces

- 현재 설정 패널과 프리셋 목록
- 역할별 model/reasoning 상세 패널
- Apply/Cancel 액션
- 성공·무변경·검증 실패·취소 결과
- 기존 Edit current 및 saved custom 진입점

### Integrations

- runtime app-server catalog
- project/global scope와 unmanaged-layout 판별
- `.codex/agents` 또는 `$CODEX_HOME/agents`
- TOML agent 설정, receipt, custom preset
- 기존 `applySetup` transaction 경로

### Constraints

- setup argv 거부와 TTY 필수 동작을 유지한다.
- 8개 역할 및 `{model, reasoning}` 행렬 구조를 유지한다.
- catalog pair 검증과 기존 저장 transaction을 우회하지 않는다.
- TUI 라이브러리는 키보드 입력, raw-mode 정리 및 테스트 가능한 렌더링을 지원해야 한다.
- project/global layout과 unmanaged 거부 의미를 유지한다.

## Non-goals

- preset 행렬 또는 8개 역할 정의 변경
- catalog/app-server 프로토콜 변경
- 비대화형 setup이나 setup argv 지원 추가
- 저장 형식 및 rollback 의미 변경
- 마우스 조작을 필수 계약으로 추가

## Constraints

- setup argv 거부와 TTY 필수를 유지한다 (`bin/csx.js:62-70`).
- 8개 역할 및 `{model, reasoning}` 문자열 행렬을 유지한다 (`lib/presets.js:1-7,39-49`).
- catalog에 없는 model/reasoning 조합은 적용하지 않는다 (`lib/presets.js:51-57`).
- project/global layout과 unmanaged 거부를 유지한다 (`lib/setup.js:15-36,53-70`).
- Apply는 기존 검증·receipt·rollback·commit·drift 방지를 우회하지 않는다 (`lib/setup.js:105-225`).
- TUI 라이브러리는 방향키, Enter, Esc, raw-mode 정리 및 테스트 가능한 입력·렌더링을 지원해야 한다.
- 내부 `reasoning`과 TOML `model_reasoning_effort`는 UI에서 일관된 “Reasoning”으로 표현한다.

## Acceptance Criteria

1. 유효한 TTY에서 `csx setup`을 실행하면 전체 화면 TUI가 열리고 8개 역할의 현재 model과 reasoning이 표시된다.
2. 프리셋 목록에 Low, Medium, High와 저장된 custom preset이 나타난다 (`bin/csx.js:129-136`).
3. 위/아래 방향키는 선택을 이동하고 Enter는 선택한 프리셋의 상세 패널을 연다.
4. 상세 패널에는 8개 역할별 model/reasoning과 Apply/Cancel이 함께 표시된다.
5. Esc는 상세에서 목록으로 돌아가며 최상위에서는 무기록 종료한다. Cancel도 agent 설정, receipt, custom preset을 변경하지 않는다.
6. 현재 행렬의 8개 쌍이 모두 동일할 때만 프리셋을 active로 표시한다. 누락 또는 한 쌍의 차이도 불일치다.
7. 중복된 built-in/custom preset이 정확히 일치하면 일치하는 모든 항목을 active로 표시한다.
8. Apply만 표시 중인 행렬을 기존 `applySetup`에 전달한다. Invalid pair, drift, unmanaged scope 오류는 표시되고 쓰기는 commit되지 않는다.
9. 동일 행렬 Apply는 `changed:false`로 종료하고 불필요한 agent 파일 변경을 만들지 않는다 (`lib/setup.js:200-205`).
10. EOF, Esc 종료, Cancel, 입력·렌더링 예외 및 종료 신호에서 raw mode와 화면을 복구하고 `applySetup`을 호출하지 않는다.
11. 좁은 터미널이나 resize에서도 역할·model·reasoning을 줄바꿈 또는 스크롤로 접근할 수 있다.
12. 기존 비TTY/argv 거부, preset/custom, project scope, cancel/no-write, EOF 테스트 의미를 보존한다 (`test/cli.test.js:27-145`).
13. PTY 테스트는 방향키 이동, Enter 상세 진입, Esc 복귀·종료, active 표시, Apply 1회, Cancel 0회 쓰기를 검증한다.
14. Invalid pair, rollback, drift 및 no-change 동작을 unit/integration 테스트로 검증한다 (`test/setup.test.js:24-120`).

## Codex Decision Boundaries

사용자는 전체 화면 TUI, 키보드 계약 및 라이브러리 도입을 확정했다. Codex는 요구 기능을 충족하는 구체 라이브러리, 패널 배치, 색상·아이콘, 좁은 화면 렌더링 방식을 선택할 수 있다. 저장 의미나 프리셋 우선순위는 임의로 변경할 수 없다.

## Decision Ledger

| Decision | Owner | Source | Status |
|---|---|---|---|
| 전체 화면 목록·상세 패널 TUI | User | 사용자 선택: 전체 화면 TUI | Confirmed |
| 방향키·Enter·Esc 조작 | User | 사용자 선택의 명시적 의미 | Confirmed |
| 검증된 TUI 라이브러리 도입 허용 | User | 사용자 선택의 명시적 의미 | Confirmed |
| 8개 역할 전체 exact match | Repository | `lib/presets.js:1-7,39-49` | Confirmed |
| Apply는 기존 `applySetup` 사용 | Repository | `lib/setup.js:105-225` | Confirmed |
| Cancel/EOF는 무기록 종료 | Repository | `bin/csx.js:166-168`; `test/cli.test.js:115-145` | Confirmed |
| 중복 exact match는 모두 active 표시 | Codex | 보수적 비우선순위 처리 | Assumed |
| 구체 라이브러리와 시각 표현 | Codex | 구현 세부 결정 경계 | Assumed |

## Assumptions

- active는 저장된 별도 상태가 아니라 현재 행렬의 실시간 exact-match 결과다.
- 기존 Edit current와 custom preset 기능은 TUI 안에 유지한다.
- preset 상세 진입이나 선택 이동은 쓰기를 발생시키지 않는다.
- 색상 없이도 active, focus, 오류를 텍스트로 구분할 수 있다.
- 구체 라이브러리와 레이아웃은 외부 저장 계약에 영향 없이 교체 가능하다.

## Evidence Inspected

- CLI 진입·기존 wizard: `bin/csx.js:62-70,123-177,220-269`
- preset·행렬·pair 검증: `lib/presets.js:1-57`
- scope·현재 행렬·transaction: `lib/setup.js:15-36,53-76,105-232`
- 현재 UX 문서: `README.md:62-83`
- 회귀 테스트: `test/cli.test.js:27-145`, `test/setup.test.js:24-120`

## Open Questions

### Blocking

None.

### Non-blocking

- 구체적인 TUI 라이브러리
- active 표시 문구·아이콘·색상
- 패널 배치와 최소 권장 터미널 크기

## Pressure Check

현재 설정이 built-in과 saved custom 양쪽에 동시에 일치하는 경우를 검증한다. 단일 우선순위를 만들지 않고 모든 exact match를 active로 표시해야 한다.

## Recommended Handoff

라이브러리 후보의 Node 호환성, raw-mode 복구 및 PTY 테스트 가능성을 확인한 뒤, 렌더링·상태 전이를 `applySetup` 저장 경로에서 분리하는 구현 계획으로 넘긴다.
