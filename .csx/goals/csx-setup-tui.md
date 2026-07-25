# Goal: `csx setup` 전체 화면 TUI 전환

## Objective

승인된 계획 `/home/ubuntu/work/ccdx/.csx/plans/csx-setup-tui.md`의 Approved draft_version 2 전체를 구현한다. 모든 AC1~AC14에 현재 change revision의 직접 증거를 확보하고, required deslop과 scoped/integrated verification을 완료하며, 변경되지 않은 누적 diff가 최종 cumulative code review에서 승인되기 전에는 완료하지 않는다.

## Accepted Boundaries

- 전체 화면 목록·상세 패널 TUI와 방향키·Enter·Esc 조작을 구현한다.
- `ink@6.8.0`, `react@19.2.3`, `ink-testing-library@4.0.0` 가정을 수락한다.
- exact active는 진입 시 불변 baseline의 8개 `{model, reasoning}` 쌍을 비교하며 중복 built-in/custom 일치는 모두 표시한다.
- 모든 preset/Edit current에서 역할 편집, mandatory stale repair, diff, 조건부 custom 저장, Apply/Cancel을 보존한다.
- `applySetup`의 catalog 검증, drift 검증, receipt, transaction, rollback을 우회하지 않는다.
- preset/역할 정의, app-server protocol, setup argv·비대화형 지원, scope 판정, 저장 형식·receipt·rollback·drift 의미는 변경하지 않는다.
- 마우스는 필수 계약이 아니다.
- 가장 강한 위험은 Ink unmount/raw-mode와 외부 alternate-screen/signal cleanup 순서의 Node/OS 차이다.
- 계획의 stop condition 하나라도 충족되면 완료하지 않는다.

## Change Revision

Current: R042

| Revision | Cause | Changed Files | Invalidated Evidence |
| --- | --- | --- | --- |
| R000 | 구현 시작 전 기준선 | None | None |
| R001 | G001 dependency 및 check 구성 구현 | `package.json`, `package-lock.json` | G001 scoped evidence pending |
| R002 | G002 상태 머신·렌더러·수명주기 구현 | `lib/setup-tui.js`, `test/setup-tui.test.js` | G002 scoped/deslop evidence pending; integrated evidence not started |
| R003 | G002 deslop: 도달 불가능한 빈 preset 분기 제거 | `lib/setup-tui.js` | R002 G002 pre-deslop evidence; G002 final deslop/scoped evidence pending |
| R004 | G002 rework: 10×3 wrapped detail/edit 접근성 보장 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R003 G002 deslop/scoped evidence invalidated; G001 unaffected |
| R005 | G003 setup orchestration 및 CLI TUI 연결 | `lib/setup-command.js`, `bin/csx.js`, `test/setup-command.test.js` | G003 deslop/scoped evidence pending; integrated evidence not started; G001/G002 unaffected |
| R006 | G002 cross-goal rework: raw-mode Ctrl+D AbortError 처리 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R004 G002 evidence invalidated; G003 dependency scoped evidence invalidated; G001 unaffected |
| R007 | G004 transaction/rollback/drift/no-op 회귀 테스트 추가 | `test/setup.test.js` | G004 deslop/scoped evidence pending; G001–G003 unaffected |
| R008 | G004 deslop: receipt drift/no-op fixture 생성 중복 제거 | `test/setup.test.js` | R007 G004 pre-deslop evidence invalidated; G001–G003 unaffected |
| R009 | G004 실제 terminal control record cleanup 및 회귀 보강 | `lib/transaction.js`, `test/transaction.test.js`, `test/setup.test.js` | R008 G004 deslop/scoped evidence invalidated; G001–G003 unaffected |
| R010 | G004 deslop: 중복 terminal 게시·Proxy 계층·폐기된 만료 전제 제거 | `lib/transaction.js`, `test/transaction.test.js`, `test/setup.test.js` | R009 G004 implementation evidence superseded; G004 independent deslop/scoped evidence pending; G001–G003 unaffected |
| R011 | G005 실제 PTY 하니스·CLI 키 입력·CI lock-refusal 경로 구현 | `test/fixtures/setup-tui-harness.js`, `test/cli.test.js`, `.github/workflows/ci.yml` | G005 deslop/scoped evidence pending; G001–G004 unaffected |
| R012 | G005 deslop: timeout 명시 실패 및 tiny 시작 marker 강화 | `test/cli.test.js` | R011 G005 implementation evidence superseded; G005 independent deslop/scoped evidence pending; G001–G004 unaffected |
| R013 | G006 README setup TUI 사용자 계약 동기화 | `README.md` | G006 scoped evidence pending; G001–G005 unaffected |
| R014 | G005 integrated rework: harness 명시 실행 gate 및 실제 detail Cancel PTY 증거 | `test/fixtures/setup-tui-harness.js`, `test/cli.test.js` | R012 G005 deslop/scoped 및 R013 integrated evidence invalidated; G001–G004/G006 unaffected |
| R015 | Final review G002 rework: 10×3 compact pair/active pages 및 raw snapshot 복원 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R014 G002/G003 dependency/G005 tiny/G006 narrow-doc/integrated/final-review evidence invalidated; G001/G004 unaffected |
| R016 | G002 deslop: detail 기본 Edit focus를 역할 수 상수에 결합 | `lib/setup-tui.js` | R015 G002 implementation evidence superseded; independent deslop/scoped evidence pending; G001/G004 unaffected |
| R017 | G002 actual Ink lifecycle rework: effect cleanup 후 raw snapshot 복원 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R016 G002 deslop/scoped evidence invalidated; G003/G005/G006/integrated/final evidence pending; G001/G004 unaffected |
| R018 | G002 deslop: actual Ink raw assertion을 lifecycle 계약의 마지막 두 호출로 제한 | `test/setup-tui.test.js` | R017 G002 implementation evidence superseded; independent deslop/scoped evidence pending; G001/G004 unaffected |
| R019 | G005 rework: 실제 PTY current-frame snapshot 및 capability-independent CI coverage | `test/cli.test.js`, `.github/workflows/ci.yml` | R014 G005 evidence superseded; G006/integrated/final evidence pending; G001–G004 unaffected |
| R020 | G005 deslop: render-change/quiescence snapshot 및 capture 완전성 guard | `test/cli.test.js` | R019 G005 implementation evidence superseded; independent deslop/scoped evidence pending; G001–G004 unaffected |
| R021 | G006 compact-terminal documentation correction | `README.md` | R013/R020 G006 evidence superseded; integrated/final evidence pending; G001–G005 unaffected |
| R022 | G006 scoped correction: resize semantic-selection 보존 범위 명시 | `README.md` | R021 G006 scoped evidence invalidated; integrated/final evidence pending; G001–G005 unaffected |
| R023 | G005 integrated rework: completed synchronized-frame parsing 및 semantic resize readiness | `test/cli.test.js` | R020 G005 deslop/scoped, R022 integrated evidence invalidated; G001–G004/G006 unaffected |
| R024 | G005 deslop: arbitrary quiescence 제거 및 completed-frame/terminal-action 명시화 | `test/cli.test.js` | R023 G005 implementation evidence superseded; independent deslop/scoped evidence pending; G001–G004/G006 unaffected |
| R025 | Final review G002 rework: unbounded compact chunk paging 및 stable preset identity/disambiguation | `lib/setup-tui.js`, `test/setup-tui.test.js` | R024 G002/G003 dependency/G005/G006/integrated/final evidence invalidated; G001/G004 unaffected |
| R026 | G005 actual PTY long/CJK paging·collision boundary 및 CI always-run coverage | `test/cli.test.js`, `.github/workflows/ci.yml` | R024 G005 evidence superseded; G006/integrated/final evidence pending; G001–G004 unaffected |
| R027 | G005 deslop: independent width oracle, derived indices, fail-closed TOML fixture rewrite | `test/cli.test.js` | R026 G005 implementation evidence superseded; independent deslop/scoped evidence pending; G001–G004/G006 unaffected |
| R028 | G006 long compact subpage 및 custom/current marker documentation | `README.md` | R022/R027 G006 evidence superseded; integrated/final evidence pending; G001–G005 unaffected |
| R029 | Final review G002 rework: content-overflow focused paging 및 presentation-only terminal escaping | `lib/setup-tui.js`, `test/setup-tui.test.js` | R028 G002/G003 dependency/G005/G006/integrated/final evidence invalidated; G001/G004 unaffected |
| R030 | G002 deslop: escape range·detail action·adversarial assertion 중복 정리 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R029 implementation evidence superseded; independent deslop/scoped evidence pending; G001/G004 unaffected |
| R031 | G005 PTY rework: overflow-driven resize oracle, 10×4/80×24 및 adversarial control current-frame evidence | `test/fixtures/setup-tui-harness.js`, `test/cli.test.js`, `.github/workflows/ci.yml` | R030 G002 scoped/G005/G006/integrated/final evidence invalidated; G001/G003/G004 unaffected |
| R032 | G005 deslop: capture 중복·defer contract·지연 resize frame 상관·CI exact-name guard 강화 | `test/cli.test.js`, `.github/workflows/ci.yml` | R031 G005 implementation evidence superseded; independent deslop/scoped/G002 revalidation pending; G001/G003/G004 unaffected |
| R033 | G006 documentation: overflow-driven paging 및 reversible visible escape 사용자 계약 | `README.md` | R032 G006/integrated/final evidence invalidated; G001–G005 unaffected |
| R034 | Final review G002 rework: shared terminal escape, diff/confirm/aux paging 및 normal marker atomicity | `lib/terminal-text.js`, `lib/setup-tui.js`, `test/setup-tui.test.js` | R033 G002/G003 dependency/G005/G006/integrated/final evidence invalidated; G001 check inventory needs new source, G004 unaffected |
| R035 | G002 deslop: confirm action 상수 및 observable navigation test 정리 | `lib/setup-tui.js`, `test/setup-tui.test.js` | R034 G002 implementation evidence superseded; independent deslop/scoped evidence pending; G001 check inventory/G003/G005/G006 pending, G004 unaffected |
| R036 | Final review G003 rework: shared terminal escaping at CLI stderr/stdout dynamic boundaries | `bin/csx.js`, `lib/setup-command.js`, `test/setup-command.test.js` | R035 G003/G005/G006/integrated/final evidence invalidated; G001 check inventory pending, G002/G004 unaffected |
| R037 | G003 deslop: terminal boundary tests use independent literal oracle | `test/setup-command.test.js` | R036 G003 implementation evidence superseded; independent deslop/scoped pending; G001 check inventory/G005/G006/integrated/final pending, G002/G004 unaffected |
| R038 | G001 check inventory: add shared terminal presentation source | `package.json` | R037 G001 scoped/integrated/final evidence invalidated; G002–G006 unaffected |
| R039 | Final review G005 rework: actual long review paging and hostile fresh-catalog drift PTY evidence | `test/cli.test.js`, `.github/workflows/ci.yml` | R038 G005/G006/integrated/final evidence invalidated; G001–G004 unaffected |
| R040 | G005 deslop: capability skip, deferred follower 및 hostile transcript assertions 강화 | `test/cli.test.js` | R039 G005 implementation evidence superseded; independent deslop/scoped pending; G006/integrated/final pending, G001–G004 unaffected |
| R041 | G006 documentation: review/confirm/aux paging and shared CLI output escape contract | `README.md` | R040 G006/integrated/final evidence invalidated; G001–G005 unaffected |
| R042 | G006 scoped correction: supported terminal height is at least 3 rows | `README.md` | R041 G006 scoped/integrated/final evidence invalidated; G001–G005 unaffected |

## Success Outcomes

### O1: 현재 설정과 프리셋을 탐색하는 전체 화면 TUI

- [x] AC1: 유효한 TTY의 첫 화면에 현재 8개 역할의 Model/Reasoning이 모두 보인다.
  - Expected evidence: renderer 첫 frame 및 실제 PTY.
  - Failure signal: 행·필드 누락.
- [x] AC2: 목록에 Low, Medium, High와 모든 저장 custom preset이 보인다.
  - Expected evidence: built-ins와 복수 custom fixture.
  - Failure signal: preset 누락.
- [x] AC3: 위/아래로 선택하고 Enter로 해당 preset 상세에 진입한다.
  - Expected evidence: reducer와 실제 PTY의 Down→Enter.
  - Failure signal: 잘못된 선택 또는 무반응.
- [x] AC4: 상세에서 8개 행과 Edit, Apply, Cancel을 함께 접근할 수 있다.
  - Expected evidence: normal/tiny frame과 실제 PTY.
  - Failure signal: 행 또는 액션 접근 불가.
- [x] AC5: 상세 Esc는 목록으로, 최상위 Esc와 Cancel은 agent·receipt·custom 무기록 종료한다.
  - Expected evidence: command/PTY 전후 파일 hash와 Apply 0회.
  - Failure signal: 잘못된 화면 전이, 호출 또는 파일 변경.
- [x] AC6: 누락이나 한 쌍 차이 없이 8개 쌍이 모두 같을 때만 active다.
  - Expected evidence: exact/partial/missing unit scenarios.
  - Failure signal: 부분 일치 active.
- [x] AC7: 동일한 built-in/custom 항목은 모두 active다.
  - Expected evidence: 중복 fixture.
  - Failure signal: 하나만 active.

### O2: 안전한 적용·취소·복구 계약

- [x] AC8: Apply만 최종 행렬을 `applySetup`에 정확히 한 번 전달하며 invalid pair와 drift는 commit하지 않는다. unmanaged scope는 TUI·Apply·write 모두 0회인 preflight 오류다.
  - Expected evidence: orchestration call count, integration transaction log.
  - Failure signal: 검증 우회, 중복 Apply, 부분 commit.
- [x] AC9: agent 행렬과 receipt의 `setupAgentMatrix`가 같고 custom 저장 요청도 없을 때만 `changed:false`이며 agent 파일을 쓰지 않는다. receipt-only drift/custom 저장은 필요한 metadata를 기록하고 `changed:true`다.
  - Expected evidence: setup integration의 세 조건.
  - Failure signal: 잘못된 no-op 또는 불필요 agent write.
- [x] AC10: EOF, Esc, Cancel, 입력·렌더 예외, 종료 신호에서 raw mode·화면을 복구하고 Apply하지 않는다. EOF는 exit 1, 일반 예외는 cleanup 후 rethrow, signal은 cleanup 후 원 signal 종료 의미를 보존한다.
  - Expected evidence: fake TTY와 actual PTY cleanup/exit scenarios.
  - Failure signal: terminal 잔류, 오류 은폐, Apply 호출.
- [x] AC11: 좁은 화면과 resize에서도 8개 역할과 두 필드에 wrap/scroll로 접근할 수 있다.
  - Expected evidence: injected dimensions와 `node-pty.resize()`.
  - Failure signal: focus 유실, 숨은 행 접근 불가, crash.
- [x] AC12: 비TTY/argv, 각 preset/custom, project scope, cancel/no-write, EOF 및 stale catalog-invalid 행을 반드시 repair하는 기존 의미를 보존한다.
  - Expected evidence: 전체 회귀와 stale repair fixture.
  - Failure signal: 기존 테스트 실패 또는 repair 우회.
- [x] AC13: 실제 PTY에서 이동·상세·Esc·active·Apply 1회·Cancel write 0회를 증명한다.
  - Expected evidence: 별도 harness 프로세스의 결과와 filesystem hash.
  - Failure signal: mock-only 증거, 횟수 불일치, Cancel mutation.
- [x] AC14: invalid pair, `mandatory` repair 해제 거부와 최종 성공, write-failure rollback, baseline/custom drift, receipt-only drift, no-change를 unit/integration으로 증명한다.
  - Expected evidence: reducer/setup integration matrix.
  - Failure signal: invalid confirm, 복원 실패, drift commit.

## Execution Goals

### G001: 고정된 TUI 의존성과 검사 대상 구성

- Dependencies: none
- Owner: `csx-executor:setup-tui-dependencies`
- Ownership history: R000 assigned to `csx-executor:setup-tui-dependencies`
- Files: `package.json`, `package-lock.json`
- Criteria: 승인된 dependency와 check 경계
- Verification: `npm ci && npm ls ink react ink-testing-library`; Node 20/22 ESM import.
- Stop conditions: Node 20/22 설치/import 실패 또는 승인 버전 변경 필요.
- Status: ready_for_review
- Evidence: R038 adds `node --check lib/terminal-text.js` exactly once to the existing check inventory; dependencies, engines, other scripts, and lockfile remain unchanged. `npm ci`, check, exact npm ls, Node20/22 Ink/React/terminal-text/setup-tui imports and diff-check PASS. Independent scoped verification pending. SHA256 package `c1d277a6d553c4993677108878d3350bc063ca1f2f1c3fd0c597eb4a5838c96a`, lock `50fe8d1aaa07d9b1735b6099b2c27148859b3a7b74b1b8fa9d8485786e46026f`.
- Deslop: not required; configuration-only.

### G002: 완결된 TUI 상태 머신·렌더러·터미널 수명주기

- Dependencies: G001
- Owner: `csx-executor:implement-setup-tui`
- Ownership history: R001 assigned; R003 scoped FAIL/reworked; R004 ready; R005 G003 PTY verifier found cross-goal raw Ctrl+D defect, returned to same G002 owner
- Files: `lib/setup-tui.js`, `test/setup-tui.test.js`
- Criteria: AC1–AC7, AC8 final validation, AC10–AC12, AC14 mandatory/final-invalid
- Verification: `node --test test/setup-tui.test.js`; exact/duplicate active, all-start Edit→diff, mandatory lock, final validation, no-change skip, cleanup, tiny/resize.
- Stop conditions: non-idempotent cleanup or approved state model cannot preserve all Edit/tiny behavior.
- Status: ready_for_review
- Evidence: R034 implementation/root confirmation plus R035 same-owner deslop `passed/cleaned`: `escapeTerminalText` shared utility; diff/confirm semantic paging, custom-name/inline error pages, resize clamp, and normal marker atomicity; `CONFIRM_ACTIONS` removes renderer/reducer duplication and tests navigate to observable Apply instead of injecting private offsets. Raw values/results remain unchanged. G002+G003 39/39, tiny PTY 1/1, syntax/diff PASS. Independent deslop/scoped verification pending. SHA256 utility `0eee07c247b7678f737d73d2caa872728a0a91f537a8e0813bdac9d4acd331c0`, TUI `728f8b47bdfb0cfc5ec4559f1a820cad82a97dd01dce104e9bffd274a75966af`, unit `ae6b26ea1a021b77d6b1da49e6496fc0fae363a8b4a627c26bee76c09eaee06c`.
- Deslop: required

### G003: setup orchestration과 CLI 진입 연결

- Dependencies: G002
- Owner: `csx-executor:integrate-setup-command`
- Ownership history: R004 assigned; R005 implementation/deslop done; R005 scoped FAIL due G002 dependency EOF behavior, evidence-only revalidation required after G002 fix
- Files: `lib/setup-command.js`, `bin/csx.js`, `test/setup-command.test.js`
- Criteria: AC5, AC8–AC10, AC12, AC14
- Verification: `node --test test/setup-command.test.js`; `node --check lib/setup-command.js && node --check bin/csx.js`; preflight/order/call-count/exit scenarios.
- Stop conditions: `applySetup` transaction 우회 또는 argv/비TTY 계약 변경 필요.
- Status: ready_for_review
- Evidence: R036 implementation/root confirmation plus R037 same-owner deslop `passed/cleaned`: top-level error and dynamic stdout boundaries use shared escaping exactly once; static usage/guidance and raw error/Apply/transaction semantics remain unchanged; tests use independent literal visible-text expectations rather than the product helper. Command 11/11, related CLI 7/7, syntax/diff PASS. Independent deslop/scoped verification pending. SHA256 bin `2679f8b86ce61fd5ab279869031c561572febc15c172b33e7dc7de64f8d0d81d`, command `46e51b50a4b25baeb3b8c0110ed57c33e7a5f38f5d4dd1fe7600d7ca18b6b4dd`, test `fac043a8ac3645c56cd5d9b785c89f698493797f9a0cda8deea012d8e6274570`.
- Deslop: required

### G004: 실제 transaction rollback·terminal cleanup·no-op 회귀 보장

- Dependencies: G003
- Owner: `csx-executor:repair-setup-transaction-cleanup`
- Ownership history: R006 assigned test-only owner; R007 implementation/R008 deslop; R008 scoped FAIL exposed real product defect. Previous ownership ended; `test/setup.test.js` sequentially handed off with `lib/transaction.js`, `test/transaction.test.js` to new owner; R009 product fix implemented.
- Files: `lib/transaction.js`, `test/transaction.test.js`, `test/setup.test.js`
- Criteria: AC8, AC9, AC12, AC14
- Verification: `node --test test/transaction.test.js test/setup.test.js`; real cross-root middle failure restores bytes/modes and leaves no transaction-ID bridge/journal/terminal/cleanup records beyond allowed lock; custom-only metadata mode 0600/changed:true followed immediately by same-matrix no-custom changed:false/write0; crash recovery/authority/third-state regressions preserved.
- Stop conditions: `lib/setup.js` 또는 다른 owner 파일이 필요하거나, artifact cleanup이 interrupted recovery/explicit authority를 약화하거나, real transaction evidence를 mock으로만 대체해야 함.
- Status: ready_for_review
- Evidence: R010 deslop `passed/cleaned`, root read-only confirmation, independent deslop verifier `PASS`, and separate G004 scoped verifier `PASS`: AC8/AC9/AC12/AC14 direct evidence; 50 tests, 49 pass, 1 Windows-only skip; real rollback restores participant bytes/modes and removes transaction-ID bridge/journal/terminal/cleanup records, custom-only→immediate no-op converges, interrupted cleanup recovery/authority/security regressions pass. G001–G003 evidence retained.
- Deslop: required

### G005: 실제 PTY·CI 플랫폼 회귀 하니스

- Dependencies: G004
- Owner: `csx-executor:add-setup-tui-pty-ci`
- Ownership history: R010 assigned after G004 became ready_for_review
- Files: `test/fixtures/setup-tui-harness.js`, `test/cli.test.js`, `.github/workflows/ci.yml`
- Criteria: AC1–AC5, AC10–AC14
- Verification: `node --test test/cli.test.js`; actual node-pty call counts, stale repair, resize; Node20/22 × Ubuntu/macOS/Windows CI; lock-refusal no-write.
- Stop conditions: actual node-pty evidence unavailable or required OS/Node cell fails.
- Status: ready_for_review
- Evidence: R039 implementation plus R040 same-owner deslop `passed/cleaned`: actual PTY independently pages every diff/confirm chunk/action across 80→10×3→10×4→80 and proves preview Enter no-op, marker atomicity, Cancel Apply0/write0/hash. Real hostile fresh-catalog drift uses actual applySetup/transaction, count2, exit1, cleanup-before-error, exact visible stderr and full-transcript raw OSC/CSI/bidi absence, all hashes invariant. Only `TransactionLockError` permits platform skip; deferred/no-op followers must be readiness-checked keys. CLI 19/19; pure41; selected9 current/Node20/Node22; drift Node20/22 1/1; check/diff PASS. Independent deslop/scoped pending. SHA256 CLI `91510b3833b7deabfa0e58d6ee9efbc549410d6f22ceaeb4eca48e2e5c711033`, harness `68b5a56d4284a66c303741913c46705096ba448e7a5fec39dd0d2448460f5d75`, CI `8a585ced7c5e642acae4eac9b740b8a6879705ae1594c1f9e563b3091ae6f71d`.
- Deslop: required

### G006: 사용자 문서 동기화

- Dependencies: G005
- Owner: `csx-executor:document-setup-tui`
- Ownership history: R012 assigned after G005 became ready_for_review
- Files: `README.md`
- Criteria: AC1–AC12의 사용자 관찰 계약
- Verification: `rg -n "Low|Medium|High|Edit|Apply|Cancel|active|repair|custom|Esc|resize|scope" README.md`; 실제 PTY 용어 대조.
- Stop conditions: 문서와 실제 PTY 용어·동작 불일치.
- Status: ready_for_review
- Evidence: R041 README covers review/confirm/aux paging and shared output escaping. Its scoped verifier found only that “any terminal height” exceeded the implementation's minimum-three-row clamp. R042 narrows the claim to supported heights of at least 3 rows; long review/drift 2/2, keyword rg and diff-check PASS. Fresh scoped verification pending. SHA256 `aab680c4a139770ad0c902dacf397d74b33be5300c15ee1c95098d05012b758b`.
- Deslop: not required; documentation-only.

## Deslop and Verification

- G001: configuration-only, deslop not required; R038 scoped verifier `PASS`.
- G002: R035 same-owner `$csx-deslop` `passed/cleaned`; independent deslop verifier `PASS`; separate scoped verifier `PASS`. R033 diff/confirm/aux/marker findings closed with direct 10×3/10×4/overflow80, resize, Enter-safety, escape round-trip/raw payload and full CLI evidence.
- G003: R037 same-owner `$csx-deslop` `passed/cleaned`; independent deslop verifier `PASS`; separate scoped verifier `PASS`. Actual hostile Apply-time catalog drift exits 1 after cleanup, emits only reversible visible stderr, preserves raw payload and all agent/receipt/custom hashes, and keeps Apply exactly once/commit zero.
- G004: R009→R010 `$csx-deslop` `passed/cleaned`; 중복 terminal 게시·Proxy 계층·폐기된 만료 전제 제거, 49 PASS/1 Windows 전용 SKIP. R010 independent deslop verifier `PASS`, separate scoped verifier `PASS`.
- G005: R040 same-owner `$csx-deslop` `passed/cleaned`; independent deslop verifier `PASS`; separate scoped verifier `PASS`. R033 terminal-output, diff/confirm paging, and marker findings are directly closed by actual PTY; CLI19, pure41, selected9 current/Node20/Node22, hostile drift Node20/22 PASS.
- G006: documentation-only, deslop not required; R042 scoped verifier `PASS`.
- 모든 G001–G006이 `ready_for_review`가 된 뒤 unchanged revision에서 AC1–AC14 integrated verifier PASS 필요.

## Cumulative Gates

### Integrated Verification

- Owner: `csx-verifier`
- Start: G001–G006 ready_for_review, required deslop/scoped evidence valid.
- Commands: `npm ci`, `npm run check`, `npm test`, `npm pack --dry-run`, actual PTY and CI matrix evidence.
- Result: R042 fresh cumulative verifier `PASS`: AC1–AC14 all PASS; `npm test` 166 total/164 pass/0 fail/2 Windows-only skip; CLI 19/19, pure TUI/command 41/41, setup/transaction 49 pass/1 Windows-only skip; current Node 24.15.0, Node 20.20.2, and Node 22.23.1 each pass exact selected PTY 9/9 plus hostile Apply-time drift 1/1. Dependency/import/check/pack/diff gates and starting/ending source inventory, tracked diff, and status hashes all PASS/unchanged. R033 shared terminal-output escaping, diff/confirm/aux semantic paging, normal marker atomicity, and R041 minimum-height documentation findings are closed. Actual macOS/Windows runner execution remains a disclosed platform risk.

### Final Cumulative Review

- Mechanism: `$csx-code-review`
- Required lanes: `csx-code-reviewer: APPROVE`, `csx-architect: CLEAR`, final `Verdict: APPROVE`.
- R014 result: `csx-code-reviewer: REQUEST CHANGES`, `csx-architect: BLOCK`, composite `REQUEST CHANGES`; review artifact `.csx/reviews/csx-setup-tui-r014.md`.
- R024 result: `csx-code-reviewer: REQUEST CHANGES`, `csx-architect: BLOCK`, composite `REQUEST CHANGES`; review artifact `.csx/reviews/csx-setup-tui-r024.md`.
- R028 result: `csx-code-reviewer: REQUEST CHANGES`, `csx-architect: BLOCK`, composite `REQUEST CHANGES`; review artifact `.csx/reviews/csx-setup-tui-r028.md`.
- R033 result: `csx-code-reviewer: REQUEST CHANGES`, `csx-architect: BLOCK`, composite `REQUEST CHANGES`; review artifact `.csx/reviews/csx-setup-tui-r033.md`.
- R042 result: `csx-code-reviewer: APPROVE`, `csx-architect: CLEAR`, composite `APPROVE`; review artifact `.csx/reviews/csx-setup-tui-r042.md`.
- Any code change invalidates both cumulative gates.

## Review Iterations

### Iteration 1 — R013 integrated verification

- Verdict: `FAIL`
- Direct failure: `npm test` collected `test/fixtures/setup-tui-harness.js` as a standalone test file; non-TTY execution raised the Ink raw-mode error.
- Evidence gap: the prior “Cancel path” used detail Esc followed by top-level Esc rather than selecting the visible detail Cancel action.
- Counts: 144 tests, 141 pass, 1 fail, 2 skip.
- Preserved evidence: explicit `node --test test/cli.test.js` 12/12 PASS; transaction/setup 49 PASS/1 Windows-only SKIP; `npm ci`, dependency listing, check, pack dry-run, and diff check PASS.
- Action: return G005 to the same owner; make auto-collected harness inert while preserving direct node-pty execution, and add a real detail Cancel selection with Apply 0/write 0/hash-invariant proof.

### Iteration 2 — R014 integrated verification

- Verdict: `PASS`
- Counts: `npm test` 145 total, 143 pass, 0 fail, 2 Windows-only skip; explicit PTY 13/13; transaction/setup 49 pass/1 Windows-only skip.
- Additional gates: `npm ci`, exact dependency listing, `npm run check`, `npm pack --dry-run`, `git diff --check`, Node 20/22 ESM+core 27/27 each.
- AC1–AC14: all `PASS`; activated stop conditions none; R014 hashes unchanged.

### Iteration 3 — R014 final cumulative review

- Verdict: `REQUEST CHANGES`
- Blocking finding: explicit 10×3 support drops baseline/preset Model/Reasoning and offers no compact path to complete active markers.
- Additional watch items: restore initially-raw input state after Ink unmount; run mutation-independent TUI/command/PTY coverage even when native transaction mutation is unavailable.
- Action: return compact renderer/raw lifecycle to G002, frame-level PTY/CI coverage to G005, and then revalidate G003/G006 dependencies before new integrated verification and code review.

### Iteration 4 — R022 integrated verification

- Verdict: `FAIL`
- Counts: `npm test` 151 total/148 pass/1 fail/2 Windows-only skip; Node20 selected PTY 4/5; isolated Node24 CLI 14/14 and Node22 selected PTY 5/5.
- Direct failure: resize back to 10×3 sometimes captured the preceding normal-sized detail frame rather than the compact `>csx-explorer` frame.
- Preserved evidence: dependency pins, check, fixture 1/1, G002+G003 31/31, transaction/setup 49 pass/1 skip, pack dry-run, diff-check, AC1–AC10 and AC13–AC14.
- Action: return `test/cli.test.js` snapshot synchronization to the same G005 owner; do not bypass the product renderer or weaken the current-frame assertion. Require stable `npm test` and Node20/22 selected PTY 5/5 before integrated retry.

### Iteration 5 — R024 integrated verification

- Verdict: `PASS`
- Counts: `npm test` 151 total/149 pass/0 fail/2 Windows-only skip; fixture 1/1; CLI 14/14; pure TUI/command 31/31; setup/transaction 49 pass/1 skip.
- Former flake: exact `focus-tiny-after` assertion remains unchanged and passed in full suite, independent CLI, current Node selected PTY, Node20 selected PTY twice, and Node22 selected PTY.
- Additional gates: `npm ci`, exact dependency pins, `npm run check`, `npm pack --dry-run`, `git diff --check`, Node20/22 ESM imports and pure tests all PASS.
- AC1–AC14: all `PASS`; activated stop conditions none; source inventory/tracked diff/status hashes unchanged.

### Iteration 6 — R024 final cumulative review

- Verdict: `REQUEST CHANGES`
- Code reviewer: `REQUEST CHANGES`; valid long model/reasoning/custom values can be truncated in 10×3 with no continuation path, and name-keyed active state collides with a custom preset named `Edit current`.
- Architect: `BLOCK`; the external catalog/persisted custom input domain has no length bound, so short fixtures do not close the compact-accessibility boundary.
- Preserved clear areas: orchestration/apply-once, persistence/transaction/recovery authority, terminal raw ownership, capability-independent CI, and completed-frame PTY parser.
- Action: return compact state/rendering to G002. Add complete wrapped-chunk navigation and stable identity/kind-based active/disambiguation without invalidating persisted custom metadata; then extend G005 actual PTY current-frame coverage and repeat all gates.

### Iteration 7 — R028 integrated verification

- Verdict: `PASS`
- Counts: `npm test` 154 total/152 pass/0 fail/2 Windows-only skip; fixture 1/1; CLI 15/15; pure TUI/command 33/33; setup/transaction 49 pass/1 skip.
- Final-review blockers: long same-prefix ASCII/Hangul suffixes, long custom labels, atomic markers, custom/current collision IDs/labels/matrices, resize clamp/re-navigation all PASS in individual current frames; no persistence length/name restriction added.
- Additional gates: `npm ci`, exact dependency pins, check, pack dry-run, diff-check, Node20/22 ESM+pure+selected6 PASS.
- AC1–AC14: all `PASS`; activated stop conditions none; source inventory/tracked diff/status hashes unchanged.

### Iteration 8 — R028 final cumulative review

- Verdict: `REQUEST CHANGES`
- Code reviewer: `REQUEST CHANGES`; fixed `rows <= 3` paging leaves 10×4 and normal-height overflow values inaccessible.
- Architect: `BLOCK`; persisted/catalog control and bidi characters cross into Ink without presentation escaping, breaking page invariants and enabling terminal control injection.
- R024 closure retained: printable long-value paging and stable custom/current identity are correct in 10×3.
- Action: return overflow-mode selection and presentation escaping to G002 without changing raw schema/persistence. Extend G005 with 10×4/normal-overflow and adversarial control-character actual PTY evidence, then revalidate G003/G006 and repeat all gates.

### Iteration 9 — R030 G002 scoped verification

- Verdict: `FAIL`
- Direct product/API evidence: 10×4 and overflowing 80×24 list/detail/edit traversal, 3↔4 semantic index/page preservation, reversible visible escaping, raw identity/matrix/Apply payload, lifecycle, and 35/35 pure tests all PASS.
- Direct integration failure: full CLI is 14/15 because the pre-R030 10×3→80×24 PTY oracle requires normal `Edit current` rendering and a repaint. Under R030, overflowing 80×24 correctly remains in focused paging and an unchanged semantic frame may emit no new output.
- Action: return only G005 PTY oracle/harness/CI files to its existing owner. Preserve completed-frame/current-frame evidence, remove the fixed normal-height assumption, and add actual 10×4/3↔4/80×24 overflow plus adversarial control-character coverage before re-verifying G002/G005.

### Iteration 10 — R033 integrated verification

- Verdict: `PASS`
- Counts: `npm test` 158 total/156 pass/0 fail/2 Windows-only skip; fixture 1/1; CLI 17/17; pure TUI/command 35/35; setup/transaction 49 pass/1 skip.
- Final-review blockers: actual PTY 10×4, 3↔4, overflowing 80×24 list/detail/edit, complete suffix/marker, adversarial control/bidi visible escapes, raw payload invariance, and delayed resize-frame fail-closed correlation all PASS.
- Additional gates: `npm ci`, exact pins/imports, check, pack dry-run, diff-check, current/Node20/Node22 exact selected PTY 8/8, and source/diff/status unchanged hashes PASS.
- AC1–AC14: all `PASS`; activated stop conditions none. Actual macOS/Windows runner execution remains a disclosed residual risk.

### Iteration 11 — R033 final cumulative review

- Verdict: `REQUEST CHANGES`
- Code reviewer: HIGH post-TUI Apply-time catalog-drift errors can emit raw terminal controls; LOW normal-mode long preset markers can split.
- Architect: `BLOCK` for the same terminal output boundary and for incomplete long-value access in diff/confirm review screens.
- Preserved clear areas: list/detail/edit any-height paging, TUI-internal escaping, raw payload identity, active matching, Apply/transaction/recovery authority, lifecycle, and CI structure.
- Action: share reversible terminal presentation escaping with top-level CLI output, extend semantic paging/resize to diff/confirm and atomic normal preset markers, add actual PTY drift/review evidence, then repeat scoped/integrated/final gates.

### Iteration 12 — R041 G006 scoped verification

- Verdict: `FAIL`
- Single finding: README claimed “At any terminal height,” while product dimensions clamp to a supported minimum of 3 rows and actual PTY evidence covers 3, 4, and 24 rows.
- All behavioral/documentation checks otherwise PASS, including long review and hostile fresh-catalog drift actual PTY.
- Action: narrow the height claim to supported terminal heights of at least 3 rows and rerun G006 scoped verification.

### Iteration 13 — R042 integrated verification

- Verdict: `PASS`
- Counts: `npm test` 166 total/164 pass/0 fail/2 Windows-only skip; fixture 1/1; CLI 19/19; pure TUI/command 41/41; setup/transaction 49 pass/1 Windows-only skip.
- R033/R041 closure: shared reversible escaping covers TUI and CLI stdout/stderr; real post-TUI hostile fresh-catalog drift exits after cleanup with no raw OSC/CSI/bidi and no writes; diff/confirm/custom/error content is semantically paged at 10×3, 10×4, and overflowing 80×24 with resize preservation/clamp and action-only Enter; normal long markers remain atomic; README limits support to at least 3 rows.
- Cross-version gates: current Node 24.15.0, Node 20.20.2, and Node 22.23.1 each pass imports, pure 41/41, selected actual PTY 9/9, and hostile drift 1/1.
- Additional gates: `npm ci`, exact dependency pins, `npm run check`, `npm pack --dry-run`, `git diff --check`, six-cell CI static audit, and starting/ending source inventory, tracked diff, and status hashes PASS/unchanged.
- AC1–AC14: all `PASS`; activated stop conditions none. Actual macOS/Windows runner execution remains a disclosed residual risk.

### Iteration 14 — R042 final cumulative review

- Verdict: `APPROVE`
- Code reviewer: `csx-code-reviewer: APPROVE`; 차단 또는 비차단 구현 결함 없음.
- Architect: `csx-architect: CLEAR`; CLI/setup/TUI/persistence/transaction, terminal presentation/lifecycle, recovery authority, CI capability 경계에 차단 아키텍처 결함 없음.
- R033 findings: post-TUI shared output escape, actual hostile drift no-write failure, diff/confirm/aux semantic paging and resize, preview Enter no-op, marker atomicity 모두 `CLOSED`.
- Review artifact: `.csx/reviews/csx-setup-tui-r042.md`.
- Residual risk: 실제 macOS/Windows runner 미실행, 실제 process-signal PTY, complex grapheme/terminal-width 차이는 비차단으로 공개한다.

## Completion Decision

`COMPLETE` at R042. G001–G006, required deslop/scoped verification, AC1–AC14 integrated verification, and both cumulative review lanes passed at the unchanged product revision. Composite final verdict is `APPROVE`.
