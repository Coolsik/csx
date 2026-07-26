# Pro Plan: csx-loop 단일 호출 워크플로

## Decision

APPROVED

## Approved Version

draft_version: 2

## Planner Body

# Plan: csx-loop 단일 호출 워크플로

draft_version: 2

## Decisions and Assumptions

### User-confirmed Decisions

- 한 번의 명시적 `$csx-loop <request>` 또는 `csx loop <request>` 호출은 동일한 bounded 작업을 요구사항 확정부터 최종 구현 완료까지 계속 수행하라는 사전 승인이다.
- 순서는 항상 `csx-spec -> (csx-plan | csx-plan-pro) -> csx-start-goal`이며 계획 단계는 생략하지 않는다.
- `csx-spec`이 직접 실행을 추천한 낮은 위험 작업도 loop에서는 `csx-plan`으로 매핑한다.
- 자식 워크플로가 명시적으로 추천한 안전하고 가역적인 첫 옵션은 자동 선택한다.
- BLOCKED 상태, 권한·안전 게이트, 추천이 없는 plan-changing 결정은 자동 승인하지 않는다.
- 현재 산출물은 사용자가 선택한 `$csx-plan-pro`에 따른 계획이며, 이 선택 자체는 구현을 승인하지 않는다.
- 배포, 외부 메시지 전송, 데이터 삭제, 추가 권한, 비가역적 부작용은 loop 사전 승인 범위 밖이다.

### Reversible Assumptions

- 한 loop 호출은 하나의 `work-slug`와 하나의 aggregate goal만 소유한다.
- 별도 `.csx/loops` 상태 파일 없이 기존 spec, plan, goal 산출물과 그 상태를 체크포인트로 사용한다.
- loop 승인 컨텍스트는 공개 토큰이나 새 서비스가 아니라 자식 스킬에 전달되는 구조화된 Markdown 메타데이터와 기존 산출물의 provenance로 표현한다.
- 저장된 `continuation_authority` enum은 과거 승인 근거를 설명하는 provenance일 뿐 현재 실행 권한이 아니다. live authority는 현재 prompt와 중단 없는 orchestration에서만 생성·검증한다.
- 사용자 질문으로 턴이 끊기면 질문에 “답변하면 남은 워크플로와 구현이 계속된다”는 효과를 표시하고, 동일 slug/stage/pending-decision에 대한 현재 답변만 live authority를 갱신한다.
- 저장소 최신성 검사는 체크포인트에 기록된 repository marker와 현재 상태의 차이 중 해당 단계의 근거·경계에 영향을 주는 부분만 재검증한다.
- 기존 자식 스킬의 loop 인식 분기는 검증된 loop context와 현재 live authority가 모두 있을 때만 적용하며, 독립 `$csx-spec`, `$csx-plan`, `$csx-plan-pro`, `$csx-start-goal` 호출의 기존 명시적 선택 계약은 유지한다.
- loop가 재개할 수 없는 오래된·충돌하는 산출물은 자동 덮어쓰거나 재시도 횟수를 초기화하지 않고 중단한다.
- 기존 transaction manifest에 `additions`가 없으면 legacy 호환을 위해 정확히 `additions: []`로 해석한다. 이 기본값은 새 경로에 대한 권한을 부여하지 않는다.

### Open Decisions

None.

## Goal and Boundaries

`payload` 원본에 `csx-loop` 스킬과 메타데이터를 추가하고, 기존 CSX 스킬을 순차 합성해 정상 경로에서는 추가 핸드오프 질문 없이 최종 goal 완료까지 진행하게 한다. 직접 호출과 shorthand, 프로젝트·전역 설치 및 기존 설치 업그레이드·제거, 중단·재개, 사용자에게 보이는 진행·선택 근거·차단 이유를 함께 제공한다.

변경 경계는 다음과 같다.

- 포함: `payload/skills/csx-loop/SKILL.md`, `payload/skills/csx-loop/agents/openai.yaml`, `payload/skills/csx-spec/SKILL.md`, `payload/skills/csx-plan/SKILL.md`, `payload/skills/csx-plan-pro/SKILL.md`, `payload/skills/csx-start-goal/SKILL.md`, `payload/hooks/csx-hook.mjs`, `lib/install.js`, `lib/installation-state.js`, `lib/transaction.js`, `README.md`, `test/skill-contract.test.js`, `test/install.test.js`, `test/transaction.test.js`, `test/hook.test.js`.
- `csx-spec`은 validated loop context에서만 final spec의 path, status, downstream recommendation, loop provenance를 부모 loop에 반환하고 자체 final handoff 질문이나 downstream 호출을 생략한다. standalone 또는 invalid loop context에서는 현재 handoff 동작을 그대로 유지한다.
- 실행 체크포인트는 `.csx/specs/<work-slug>.md`, 정확히 하나의 `.csx/plans/<work-slug>.md` 또는 `.csx/plans/<work-slug>-pro.md`, `.csx/goals/<work-slug>.md`에만 기록한다. immutable spec/planner body는 변경하지 않고 허용된 provenance, handoff, accepted-boundary 영역에 loop 메타데이터를 둔다.
- `.agents`와 `.codex/.csx-install-receipt.json`은 설치 결과물이므로 직접 수정하지 않는다. 설치·테스트를 통해 생성 및 검증한다.
- 새 runner, daemon, MCP, 백그라운드 실행, 배치 기능, 무기한 재시도, 새 플랫폼 지원, 자식 스킬의 기존 검토·수정 한도 변경은 제외한다.
- loop 승인은 구현 범위 안의 가역적 추천에만 적용한다. 기존 권한 확인이나 비가역 작업 승인을 대체하지 않는다.
- installer upgrade를 위한 absent-path 권한은 current payload와 검증된 pre-loop receipt의 정확한 차집합인 `additions`로만 부여한다. uninstall은 이 upgrade 권한을 사용하지 않는다.

## Decision Record

### Decision Drivers

1. 현재 spec, 계획 및 실행 스킬은 자체 downstream 선택을 요구하므로, one-command 의도를 유지하면서 독립 호출 권한을 넓히지 않는 bounded authorization composition이 필요하다.
2. 저장된 provenance를 복사하거나 수정하는 것만으로 현재 실행 권한을 만들 수 없어야 한다.
3. 중단·재개 시 완료 단계를 재실행하거나 검토·수정 횟수를 초기화하지 않아야 한다.
4. 기존 산출물·installer·hook 구조를 활용하고 새 실행 서비스나 loop 전용 상태 파일을 만들지 않아야 한다.
5. 컨텍스트 위조·누락, stale artifact, 서로 다른 활성 goal이 실행 권한으로 오인되지 않아야 한다.
6. 설치 closed list 확대 시 기존 receipt가 아직 소유하지 않은 loop 파일을 transaction이 생성·복구할 수 있어야 하지만, 그 권한이 임의 absent 경로로 확장되면 안 된다.

### Options Considered

| Option | Benefits | Costs and Risks | Disposition |
| --- | --- | --- | --- |
| A. 구조화된 loop context를 자식 입력으로 전달하고 기존 spec/plan/goal 산출물에 checkpoint provenance를 기록하되, live authority는 현재 prompt에 별도로 결합 | slug·단계·가정·재시도 상태를 복원하면서 persisted enum과 현재 권한을 분리할 수 있다. 새 런타임이나 별도 상태 파일이 없고 standalone 권한 분기를 보존한다. | 네 자식 스킬에 loop 전용 검증·return 분기가 필요하다. 프롬프트 계약이므로 암호학적 인증이 아니라 현재 prompt와 저장소·산출물 교차 검증에 의존한다. | 채택 |
| B. 현재 턴의 `$csx-loop` 호출 사실만 전달하고 재개 때 산출물에서 암묵적으로 상태를 추론 | 변경 문구가 가장 적고 별도 메타데이터가 거의 없다. 정상 단일 턴 경로에는 충분하다. | 사용자 질문 뒤 새 턴, stale artifact, 계획 분기 충돌에서 원래 승인 범위와 수락 가정을 신뢰성 있게 구분하기 어렵다. persisted 문자열이나 임의의 “loop 호출” 주장이 실행 권한으로 오인될 수 있다. | 실행 가능한 대안이지만 승인 및 재개 무결성이 약해 기각 |
| C. `.csx/loops/<slug>.md`와 전용 runner로 상태·승인을 관리 | 상태 머신과 재개 구현이 명시적이다. | 승인된 non-goal을 위반하고 새 영속 형식·서비스·복구 표면을 만든다. 기존 산출물 체크포인트 요구와 충돌한다. | 비실행 가능: 명시적 제약으로 무효 |

### Decision

Option A를 채택한다. `csx-loop`가 다음 provenance 필드를 생성·갱신한다.

- `source: csx-loop`
- `original_invocation`과 `original_request`
- `work_slug`
- `spec_path`, `spec_status`, `spec_recommendation`
- `plan_kind`, `plan_path`, `plan_status`
- `accepted_reversible_assumptions`
- `last_completed_stage`, `remaining_stages`
- `continuation_authority: initial-call | renewed-by-answer | explicit-resume`
- checkpoint 시점의 repository marker와 영향받은 근거
- 사용자 질문이 중단 원인일 때 stable `pending_decision` 식별자와 그 decision이 결합된 slug/stage

persisted `continuation_authority` 값은 audit provenance이며 단독으로 권한을 부여하지 않는다. live authority는 다음 세 경우에만 현재 prompt에서 생성한다.

- `initial-call`: 원래 명시적 loop 호출에서 시작된 중단 없는 orchestration 동안만 유효하다.
- `renewed-by-answer`: 현재 사용자 입력이 artifact에 기록된 동일 slug, stage, `pending_decision`에 대한 답변일 때만 유효하다.
- `explicit-resume`: 현재 prompt가 정확한 `$csx-loop resume <slug>` 또는 `csx loop resume <slug>`이고 artifact slug와 일치할 때만 유효하다.

live authority는 `(work_slug, current_stage, next_transition, pending_decision 또는 none, current user turn)`에 결합된 일회성 권한이다. 각 child transition 또는 start-goal entry에서 현재 근거와 binding을 검증한 뒤 소비한다. 동일한 중단 없는 orchestration이 계속되는 경우에만 원래 현재-turn 근거에서 다음 transition용 live authority를 새로 파생한다. 중단, 취소, 무관한 사용자 턴, blocker를 보고하고 workflow를 종료한 시점에는 즉시 무효화한다. artifact의 enum을 복사·수정하거나 이전 prompt를 참조하는 것만으로는 live authority가 생성되지 않는다.

`csx-spec`은 validated loop context와 자신에게 결합된 live transition을 확인한 경우 final artifact를 작성하고 path/status/recommendation/provenance를 부모에게 반환한 뒤 멈춘다. 계획 스킬도 matching plan kind와 live transition을 검증한 경우에만 최종 handoff 질문을 생략하고 부모에게 반환한다. `csx-start-goal`은 승인된 plan 상태, 정확히 하나의 계획 산출물, 가정·slug·최신성 일치와 현재 start-goal entry용 live authority를 검증해야 기존 명시적 시작 선택과 동등하게 인정한다.

installer upgrade에서는 `lib/install.js`가 검증 대상으로 선택한 pre-loop receipt-owned payload set과 current payload set의 정확한 차집합을 `additions`로 산출한다. `additions`는 기존 receipt 소유권이 아니라 해당 upgrade transaction에서 absent로 증명된 신규 경로에 대한 한정 권한이다. installation-state와 transaction은 기존 receipt paths, config, receipt, exact additions의 합집합만 snapshot/write/recovery authority로 인정한다.

### Consequences

- 기존 독립 스킬은 validated context 또는 현재 live authority가 없으면 현재 handoff 질문과 entry gate를 그대로 사용한다.
- 사용자의 첫 loop 호출만으로 정상적인 추천 경로는 끝까지 이어지지만, 질문·중단·blocker가 발생하면 초기 live authority는 끝난다.
- 사용자 답변은 동일 pending decision에 결합됐을 때만, resume는 현재 prompt와 exact slug가 일치할 때만 새 live authority를 만든다.
- stale 또는 충돌 상태는 추정 복구하지 않는다. 마지막 유효 checkpoint와 필요한 사용자 입력 또는 재개 조건을 출력한다.
- 실제 workflow 상태 머신을 실행하는 repository runtime은 추가되지 않는다. `SKILL.md`가 orchestration 계약이고 기존 Codex host가 이를 수행한다.
- 기존 receipt upgrade는 absent additions를 명시적으로 선언해야 하며, locked snapshot에서 present로 바뀌거나 declaration과 recovery authority가 다르면 fail closed한다.
- uninstall은 additions를 참조하지 않는다. 미업그레이드 pre-loop 설치는 그 receipt-owned paths만 제거하고, upgrade 완료 설치는 새 current receipt-owned paths를 제거한다.

### Follow-ups

- None. 서명된 승인 토큰, 원격 telemetry, cross-process lock, loop 전용 runner는 `Optional hardening` 또는 명시적 non-goal이며 이번 변경에 포함하지 않는다.

## Acceptance Criteria

- **AC1:** `$csx-loop <request>`와 `csx loop <request>`는 hook에서 `csx-loop`로 라우팅되고, `please loop this` 같은 일반 자연어와 unknown/invalid 명령은 출력이 없다.
- **AC2:** 프로젝트 및 전역 설치가 `csx-loop/SKILL.md`와 `agents/openai.yaml`을 설치하고 영수증에 정확히 한 번 포함한다. 실제 pre-loop receipt/disk 상태의 upgrade는 current-minus-pre-loop의 exact absent `additions`만 선언해 성공하고, 중간 강제 종료 후 재진입은 additions/config/receipt를 preimage로 복구한 뒤 upgrade를 완료한다. present/extra/missing/duplicate additions, declaration 불일치, recovery authority 불일치, 임의 receipt path는 거부되며 pre-loop 및 upgraded uninstall은 각 current receipt-owned paths만 제거한다.
- **AC3:** loop 계약은 `csx-spec`, 정확히 하나의 `csx-plan|csx-plan-pro`, `csx-start-goal` 순서를 고정한다. validated context의 `csx-spec`은 final path/status/recommendation/provenance만 부모에게 반환하며 자체 handoff 질문·downstream 호출을 하지 않고, 각 단계 성공 전 다음 호출은 금지된다.
- **AC4:** 낮은 위험 대표 경로에서 부모가 반환받은 spec recommendation이 직접 start-goal이어도 `csx-plan`으로 변환되며 plan 완료가 start-goal보다 앞선다.
- **AC5:** 광범위·고위험·교차 모듈·아키텍처 민감 대표 경로는 `csx-plan-pro`를 선택하며 `Decision: APPROVED` 전에는 start-goal을 호출하지 않는다.
- **AC6:** 일반 계획 `Decision: READY` 또는 pro 계획 `Decision: APPROVED`, 완전히 검증된 loop context, 현재 transition에 결합된 live authority가 모두 있으면 계획 스킬은 최종 질문 없이 부모에게 반환하고 start-goal이 시작된다. persisted enum만 있거나 context/live authority가 불완전하면 실행하지 않으며 standalone은 기존 명시적 선택을 요구한다.
- **AC7:** 2~3개 선택지 중 첫 옵션이 명시적 Recommended이고 안전 게이트와 충돌하지 않으며 승인 범위 안에서 가역적일 때만 자동 선택하고, 선택·추천 근거·적용 단계를 진행 출력 또는 child artifact에 남긴다.
- **AC8:** 추천이 없거나 open-ended인 plan-changing 질문은 자동 응답하지 않고 `BLOCKING_USER_DECISION`, 마지막 성공 단계, 통제되는 downstream 결정, stable pending-decision 식별자, “답변 후 계속” 효과, 정확한 resume 명령을 표시한다. 무관한 답변은 live authority를 만들지 않으며 동일 slug/stage/pending-decision에 대한 현재 답변만 `renewed-by-answer`를 생성한다.
- **AC9:** spec/plan/pro plan의 BLOCKED, 필수 역할 누락, 검토 한도 소진, 사용자 취소, 권한·안전 게이트, 서로 다른 활성 goal 중 하나라도 발생하면 live authority를 무효화하고 이후 단계를 호출하지 않는다.
- **AC10:** 현재 prompt가 정확한 `$csx-loop resume <work-slug>` 또는 shorthand이고 artifact slug와 일치할 때만 `explicit-resume` live authority를 생성한다. 재개는 기존 유효 산출물·goal·명시적 시도 횟수를 재사용하고 첫 미완료 단계부터 계속하며 완료된 단계는 재생성하지 않는다.
- **AC11:** repository marker 불일치 시 영향받은 근거·단계만 재검증한다. slug·입력 경계·계획 분기·산출물 상태가 충돌하거나 경계를 바꿀 수 있으면 자동 덮어쓰지 않고 중단한다.
- **AC12:** loop는 goal artifact에 모든 원래 AC의 최신 직접 증거, unchanged revision의 최종 검증·누적 리뷰, `Completion Decision`, `update_goal complete`가 확인된 뒤에만 전체 성공을 보고한다.
- **AC13:** README는 직접 호출, shorthand, 고정 순서, plan 분기, 추천 자동 선택 경계, live continuation과 persisted provenance의 차이, 안전·권한 하드 게이트, 중단·재개 예시, standalone 스킬 호환성을 설명한다.
- **AC14:** 신규 closed list, additions upgrade/recovery authority, 승인·반환·중단·재개 계약을 검증하는 affected tests 및 전체 `npm test`와 `npm run check`가 통과하고 기존 스킬·설치·transaction·hook 동작에 회귀가 없다.

## Plan

1. **Accepted scope 및 Change-induced safety/regression risk — `csx-loop` 소스 계약, live authority, 메타데이터**
   - `payload/skills/csx-loop/SKILL.md`를 생성해 frontmatter, orchestration boundary, 완전한 subagent assignment shape, 공통 liveness policy, bounded context schema, 고정 단계 상태 머신, plan 선택, 추천 자동 선택, BLOCKED 처리, checkpoint/resume, 진행 출력, 최종 완료 확인을 정의한다.
   - 초기 호출에서 stable slug를 정하고 matching spec/plan/goal만 검사한다. `resume`에서는 original invocation provenance, slug, child status, repository marker, active goal, attempt counters를 먼저 검증한다.
   - persisted `continuation_authority` enum을 live credential이 아닌 provenance로 정의한다. 현재 prompt로부터만 다음 transition에 결합된 일회성 live authority를 생성하고 child transition/start-goal entry에서 검증·소비한다.
   - `initial-call`은 최초 loop prompt에서 시작된 중단 없는 orchestration 동안만 다음 transition용 권한을 파생할 수 있다. `renewed-by-answer`는 현재 답변과 artifact의 exact slug/stage/pending-decision이 일치할 때, `explicit-resume`은 현재 prompt의 exact resume 명령과 artifact slug가 일치할 때만 생성한다.
   - child transition 성공 후 같은 uninterrupted orchestration이면 다음 transition용 live authority를 새로 파생한다. 질문으로 턴을 넘기거나 중단·취소·무관한 사용자 턴·blocker 종료가 발생하면 live authority를 폐기한다.
   - artifact의 enum 또는 provenance를 복사·수정하는 행위, 과거 loop prompt, unrelated answer는 현재 권한이 아니라는 fail-closed 문구를 둔다.
   - `csx-spec` 결과가 `READY|READY_WITH_ASSUMPTIONS`일 때만 plan 분기로 간다. 반환된 recommendation이 start-goal이면 plan으로, plan이면 plan으로, plan-pro이면 plan-pro로 매핑하며 정확히 하나만 실행한다.
   - 추천 자동 선택은 “Recommended 표시 + 2~3개 옵션 + 가역성 + 기존 권한·안전 게이트 비충돌”을 모두 만족해야 한다. 그렇지 않으면 pending decision을 기록하고 중단한다.
   - 각 단계 전후에 현재 단계, 선택 recommendation과 근거, last completed stage, next stage 또는 blocker를 표시하고 허용된 provenance 영역을 갱신한다.
   - `payload/skills/csx-loop/agents/openai.yaml`에 명시적 호출 전용 metadata(`allow_implicit_invocation: false`)를 추가한다.
   - 이 단계의 파일 소유자는 두 신규 파일만 수정하며 자식 계약 파일과 겹치지 않는다.

2. **Accepted scope — `csx-spec`의 loop-return 계약과 planning handoff**
   - `payload/skills/csx-spec/SKILL.md`의 finalization/handoff에 standalone과 loop-return 분기를 추가한다.
   - loop-return은 incoming validated context의 source, original invocation, slug, 현재 spec transition용 live authority를 검증한다. final status가 `READY|READY_WITH_ASSUMPTIONS`이면 immutable spec body를 작성한 뒤 `spec_path`, `spec_status`, `recommended_handoff`, accepted assumptions, repository marker, loop provenance를 부모에게 반환하고 자체 `request_user_input`이나 downstream workflow 호출을 하지 않는다.
   - spec가 BLOCKED이면 blocker와 마지막 checkpoint를 부모에게 반환하고 downstream을 호출하지 않는다. invalid context는 loop-return으로 fallback하지 않고 기존 standalone Final Handoff를 실행한다.
   - `payload/skills/csx-plan/SKILL.md`의 Contract/Final Handoff에는 validated loop context의 `plan_kind: csx-plan`, matching accepted spec/slug, 현재 plan transition live authority가 있을 때만 `Decision: READY` artifact를 부모에게 반환하고 최종 `request_user_input`을 생략하는 분기를 추가한다.
   - `payload/skills/csx-plan-pro/SKILL.md`에도 같은 검증을 적용하되 Architect `CLEAR`와 Critic `APPROVED`가 동일 draft version에 합의한 `Decision: APPROVED`만 반환한다. WATCH/BLOCK/REVISE/BLOCKED와 5회 review exhaustion은 부모 loop에 BLOCKED를 반환하며 `Refine further`를 자동 반복하지 않는다.
   - 두 planning skill은 immutable Planner Body를 변경하지 않고 artifact envelope의 Handoff/provenance에 loop checkpoint와 selected assumptions를 기록한다.
   - loop context 또는 live authority가 없거나 하나라도 불일치하면 세 기존 스킬 모두 현재 standalone handoff와 명시적 선택 요구를 유지한다.
   - 이 단계는 세 child contract 파일을 한 소유자가 순차 수정해 context 필드와 return 의미가 드리프트하지 않게 한다.

3. **Change-induced safety/regression risk — start-goal entry gate와 live authority 소비**
   - `payload/skills/csx-start-goal/SKILL.md`의 Entry Gate에 기존 explicit selection과 병렬인 loop-authority 분기를 추가한다.
   - loop 분기는 bounded context 필드, accepted spec 상태, 정확히 하나인 plan artifact, matching plan kind/path/status/draft, 수락 가정, repository freshness, 현재 `(slug, start-goal, entry, current turn)`에 결합된 live authority를 검증한다.
   - start-goal entry가 성공하면 해당 live authority를 소비한다. persisted enum이나 과거 답변만 남아 있으면 entry를 거부한다.
   - `get_goal` 결과가 다른 active goal이면 goal 생성 전에 live authority를 무효화하고 중단한다. 동일 goal만 기존 artifact와 counters를 검증해 재개한다.
   - 검증 실패를 일반 실행 요청으로 느슨하게 fallback하지 않는다. standalone 호출이면 기존 질문/거부 규칙을 사용하고, loop라고 주장했으나 불완전하면 `BLOCKED: invalid loop approval context`로 반환한다.
   - `.csx/goals/<slug>.md`의 `Objective and Accepted Boundaries`에 loop provenance를 기록하되 기존 revision/evidence/attempt-counter 규칙과 하나의 aggregate goal을 유지한다.
   - 전체 성공은 기존 Complete 조건, 모든 원래 criterion의 current evidence, final verification, cumulative review `APPROVE`, unchanged revision, `update_goal complete` 이후로 한정한다.
   - 배포·외부 메시지·삭제·추가 권한·비가역 동작은 Recommended 여부와 무관하게 별도 권한 전 중단한다.

4. **Change-induced safety/regression risk — exact absent `additions` 설치·transaction·recovery 권한**
   - `lib/install.js`의 `SKILLS`에 `csx-loop`를 추가하고 current, pre-loop, 각각의 verifier legacy receipt path variant를 명시적으로 산출한다.
   - install은 각 candidate variant를 넓은 합집합으로 권한화하지 않는다. exact candidate를 검증하는 시도마다 current payload paths에서 그 candidate의 receipt-owned payload paths를 뺀 정확한 차집합을 `additions`로 계산한다. current receipt이면 `[]`, pre-loop receipt이면 정확히 두 loop payload destination이며 legacy verifier는 removal 대상이지 addition이 아니다.
   - `existingInstallationTargetForUpgrade`, `recoverInstallationVariants`, uninstall 후보 검증을 candidate별 `(expected receipt paths, additions)` 계약으로 변경한다. recovery도 candidate variant별 exact authority를 사용하며 여러 variant의 additions를 한 authority로 합치지 않는다.
   - `lib/installation-state.js`의 `existingInstallationTarget` 입력에 `additions = []`를 추가한다. 기존 receipt-owned paths를 현재처럼 exact 검증하면서 additions가 배열, resolve 후 유일, installation root 내부, receipt/config/기존 owned paths와 비중복이며 검사 시점에 absent임을 증명한다. 반환되는 existing participant는 기존 `paths`와 별도 `additions`를 동결해 포함한다.
   - `lib/transaction.js`의 `normalizeParticipant`, declaration/manifest validation, manifest snapshot 생성, recovery-authority 검증에 existing participant의 `additions`를 포함한다. 누락된 legacy field는 `[]`로 normalize한다.
   - transaction lock을 획득한 뒤 manifest snapshot을 만들 때 모든 additions가 여전히 absent인지 다시 확인한다. installation-state 검사와 locked snapshot 사이에 생성된 경로는 declaration 시작을 실패시킨다.
   - existing upgrade의 허용 snapshot/write/recovery 경계는 `receipt-owned paths + config + receipt + exact additions`뿐이다. `snapshotSet`은 이 exact authority와 일치하고 `writeSet`은 그 부분집합인 실제 current payload/config/receipt writes와 legacy verifier removal만 포함한다. addition 누락·extra path·duplicate·present addition과 recovery authority 불일치는 모두 fail closed한다.
   - transaction manifest와 recovery bridge가 additions를 보존하고, recovery는 각 addition의 locked absent preimage를 복원한다. 기존 manifest에 field가 없으면 `additions: []`로만 해석해 새 권한을 만들지 않는다.
   - upgrade 완료 receipt는 current payload paths를 소유한다. uninstall은 `additions`를 upgrade 권한으로 사용하지 않으며, 미업그레이드 pre-loop uninstall은 해당 receipt files와 config/receipt만 제거하고 upgraded uninstall은 새 current receipt files를 기준으로 제거한다.
   - 기존 receipt-last commit, verifier removal, transaction preimage, extra receipt path 거부를 유지한다.

5. **Accepted scope — 계약·라우팅·설치·transaction 테스트 확장**
   - `test/skill-contract.test.js`의 `skillNames`에 `csx-loop`를 추가해 metadata, assignment discipline, liveness policy를 기존 공통 검사에 포함한다.
   - loop-aware `csx-spec`이 path/status/recommendation/provenance를 부모에게 반환하고 자체 handoff/downstream을 생략하는 조건과 invalid/standalone context의 기존 handoff 보존을 검증한다.
   - ordered stage, 저위험 start-goal recommendation의 plan 변환, pro approval gate, 정확히 하나의 plan branch, BLOCKED/missing role/distinct goal/review exhaustion, final completion을 scenario-oriented subtests로 검증한다.
   - authority scenarios는 persisted enum-only 거부, unrelated answer 거부, exact slug/stage/pending-decision 답변의 `renewed-by-answer` 허용, exact direct/shorthand resume의 `explicit-resume` 허용, mismatch resume 거부, transition별 소비·재파생, interruption/cancel/blocker invalidation을 포함한다.
   - `test/hook.test.js`의 direct/shorthand 표본에 `$csx-loop ...`, `csx loop ...`, 두 resume 형식을 추가하고 일반 자연어·unknown·invalid prompt의 무출력을 유지한다.
   - `test/transaction.test.js`에 existing participant의 exact absent additions가 declaration과 locked snapshot을 통과하는 사례를 추가한다. present, extra, missing, duplicate additions, snapshot/write authority 불일치, recovery authority mismatch는 각각 거부한다.
   - 같은 transaction test에서 additions가 없는 legacy participant/manifest를 `[]`로 복구할 수 있고 그 authority가 새 absent path로 확장되지 않음을 직접 검증한다.
   - `test/install.test.js`는 실제 install 결과에서 loop payload files와 receipt entries를 제거해 pre-loop receipt/disk 상태를 구성하고, repeat install의 migration declaration이 exact two additions로 통과해 current receipt로 바뀌는지 검사한다.
   - 기존 prospective-install 강제 종료 테스트와 별도로, pre-loop upgrade child process를 transaction 중간에 강제 종료한다. 재진입이 additions/config/receipt의 preimage를 복구하고 upgrade를 완료한 뒤, current receipt-owned loop files를 포함해 uninstall이 정확히 제거하는지 검증한다.
   - ordinary rollback, legacy verifier, extra receipt path 거부, repeat install, project-first uninstall 테스트를 유지하되 동등한 rollback case를 중복 추가하지 않는다.

6. **Accepted scope — 사용자 문서와 artifact 처리 명시**
   - `README.md`의 Skills 직접 호출 목록과 shorthand 목록에 loop를 추가한다.
   - `spec -> plan|plan-pro -> start-goal` 고정 순서, loop-aware spec return, 낮은 위험 직접 실행 추천의 plan 매핑, 계획 분기 기준, 안전한 Recommended 자동 선택을 설명한다.
   - persisted continuation provenance와 현재 prompt에 결합된 live authority의 차이, 중단·무관한 턴·blocker 뒤 authority 무효화, exact 답변/resume 갱신을 문서화한다.
   - 사용자 소유 결정·BLOCKED·missing role·다른 active goal의 hard gate와 배포·메시지·삭제·추가 권한의 별도 승인을 설명한다.
   - 초기 호출, `BLOCKING_USER_DECISION` 중단, `$csx-loop resume <work-slug>` 및 shorthand 재개, 최종 완료 출력 예시를 추가한다.
   - standalone 스킬의 기존 명시적 handoff와 `.csx/loops` 비생성을 명시한다.
   - 생성된 `.agents`, 설치 영수증, runtime spec/plan/goal artifact를 source commit 대상으로 수동 편집하지 않는 ownership 원칙을 유지한다.

7. **Accepted scope — 통합 검증 및 handoff**
   - `node --test test/skill-contract.test.js test/hook.test.js`로 orchestration·authorization·routing 계약을 먼저 검증한다.
   - `node --test test/transaction.test.js test/install.test.js`로 additions authority, migration, crash recovery, uninstall 경계를 검증한다.
   - `npm run check`로 JavaScript syntax를 확인하고 `npm test`를 primary Node 환경의 유일한 전체 회귀 실행으로 사용한다.
   - 최종 diff에서 `.csx/loops`, 생성된 `.agents`, 수동 편집된 receipt, 새 서비스·runner 파일이 없는지 검사한다.
   - 테스트나 현재 저장소가 본 계획의 파일·symbol 근거와 달라 plan-changing 판단이 필요하면 `MISSING_EVIDENCE`로 중단하고 재계획한다. 검증이 모두 통과해야 실행 결과를 다음 review 단계에 넘긴다.

## Verification Matrix

| Criterion | Evidence | Command or Scenario | Expected Result | Failure Signal |
| --- | --- | --- | --- | --- |
| AC1 | `payload/hooks/csx-hook.mjs`, `test/hook.test.js`의 direct/shorthand/resume 및 negative cases | `node --test test/hook.test.js` | 네 loop 형식은 `$csx-loop skill` context를 출력하고 일반 자연어·unknown·invalid 입력은 빈 출력이다. | route 누락, 일반 자연어 오탐, 기존 skill route 회귀, subprocess nonzero |
| AC2 | `lib/install.js`, `lib/installation-state.js`, `lib/transaction.js`; transaction/install additions·migration·crash-recovery·uninstall tests | `node --test test/transaction.test.js test/install.test.js` | exact absent additions만 declaration과 locked snapshot을 통과한다. 실제 pre-loop upgrade와 중간 강제 종료 재진입이 additions/config/receipt를 복구해 current receipt로 완료되고 uninstall이 정확한 receipt-owned files만 제거한다. | declaration rejection, present/extra/missing/duplicate addition 수용, addition 잔존, pre-loop/current receipt 혼합 상태, recovery authority mismatch, 임의 path 제거 |
| AC3, AC4, AC5 | `payload/skills/csx-loop/SKILL.md`, loop-aware `payload/skills/csx-spec/SKILL.md`, ordered branch contract subtests | `node --test test/skill-contract.test.js`의 spec-return/order/branch scenarios | spec는 validated loop에서 부모에게만 반환한다. 부모는 direct start recommendation을 plan으로 변환하고 정확히 하나의 plan을 승인 상태까지 완료한 뒤 start-goal로 간다. | spec 자체 handoff/downstream 실행, plan 생략, 두 plan 호출, pro 승인 전 실행, 단계 순서 역전 |
| AC6, AC7 | loop context schema, child return 분기, start-goal entry gate, recommendation scenarios | 동일 contract suite의 authorization/recommendation scenarios | accepted plan, matching context, 현재 transition live authority가 모두 있을 때만 질문 없이 진행한다. 안전·가역적인 명시적 Recommended만 자동 선택·기록되고 standalone은 기존 질문을 유지한다. | persisted enum-only 승인, 불완전 context 승인, standalone 자동 실행, 비추천·비가역 선택 자동화, 선택 근거 누락 |
| AC8, AC9 | pending-decision binding, authority invalidation, child BLOCKED/missing role/distinct goal/review exhaustion assertions | 동일 contract suite의 answer/blocking scenarios | unrelated answer는 거부되고 exact pending decision 답변만 authority를 갱신한다. 모든 hard gate는 authority를 무효화하고 downstream을 멈춘다. | 무관한 답변 승인, blocker 뒤 goal 생성, `Refine further` 자동 반복, pending-decision·resume 정보 누락 |
| AC10, AC11 | exact resume binding, checkpoint/artifact/repository validation assertions | 동일 contract suite의 resume/staleness scenarios | 현재 exact resume prompt와 artifact slug가 일치할 때만 첫 미완료 단계부터 진행하며 counters와 유효 완료 단계를 재사용한다. 영향받은 근거만 재검증하고 충돌은 overwrite 없이 중단한다. | persisted resume enum만으로 진행, slug mismatch 수용, 완료 단계 재생성, counter reset, stale evidence 재사용, conflicting artifact overwrite |
| AC12 | loop final gate와 `csx-start-goal` Complete 계약 assertions | 동일 contract suite의 completion scenario | goal artifact의 모든 AC 최신 증거, final verification, review approval, unchanged revision, goal complete 전에는 loop 성공을 보고하지 않는다. | 조기 성공, 누락 AC, stale revision, complete 호출 누락·중복 |
| AC13 | `README.md` content assertions | 동일 contract suite의 README subtest 및 문서 예시 inspection | 직접 호출, shorthand, 순서, spec return, 추천 경계, live/provenance 구분, hard gate, 중단·재개, standalone 의미가 모두 존재한다. | 필수 명령·권한 경계·예시 중 하나 누락 또는 구현 계약과 불일치 |
| AC14 | 전체 affected tests와 기존 Node suite | `npm run check && npm test` | syntax check와 전체 suite가 exit 0이며 기존 skill/install/transaction/hook 테스트가 통과한다. | nonzero exit, 기존 transaction 또는 standalone 계약 회귀 |
| AC1–AC14 artifact integrity | 최종 diff와 생성 경계 | `git diff --check`; `git status --short`; `find .csx -maxdepth 2 -type d -name loops -print` | whitespace 오류가 없고 변경이 계획된 source/test/docs에 한정되며 `.csx/loops`가 생성되지 않는다. | 계획 밖 파일, generated `.agents`/receipt 수동 변경, `.csx/loops`, runner/daemon/MCP 추가 |

## Risks and Stop Conditions

- **Accepted scope:** child 결과가 BLOCKED이거나 필수 역할이 누락되거나 review/rework 한도가 소진되면 마지막 유효 checkpoint, child verdict, 필요한 사용자 조치를 기록하고 live authority를 무효화한 뒤 downstream 호출을 멈춘다.
- **Accepted scope:** 안전한 추천이 없는 공개 동작, 데이터 처리, 지원·호환성 경계, 범위, 수락 기준, 구현 경로, 비가역 선택은 `BLOCKING_USER_DECISION`이다. 질문은 stable pending-decision과 답변 후 남은 구현이 계속된다는 효과, resume 명령을 명시해야 한다.
- **Accepted scope:** `get_goal`이 다른 slug의 active goal을 반환하면 새 goal을 만들지 않는다. 동일 goal만 기존 artifact와 counters를 검증해 재개한다.
- **Accepted scope:** 배포, 외부 메시지, 데이터 삭제, 추가 권한, 비가역 side effect는 Recommended 여부와 무관하게 별도 승인 전 중단한다.
- **Change-induced safety/regression risk:** persisted `continuation_authority` enum, 수정된 artifact, 과거 prompt만으로 실행하면 권한 회귀다. 현재 prompt와 exact transition binding이 없으면 실행을 거부한다.
- **Change-induced safety/regression risk:** 중단·취소·무관한 턴·blocker 종료 뒤 live authority가 남거나 한 transition에서 소비된 권한이 재사용되면 즉시 구현을 중단한다.
- **Change-induced safety/regression risk:** stale spec/plan/goal, 동일 slug의 복수 plan, plan branch 재분류, 원래 입력 경계 불일치, repository 변경으로 인한 acceptance 변경은 자동 덮어쓰지 않는다.
- **Change-induced safety/regression risk:** loop 분기 추가 후 standalone `$csx-spec`, `$csx-plan`, `$csx-plan-pro`, `$csx-start-goal`이 기존 사용자 선택 없이 진행하면 호환성 회귀다.
- **Change-induced safety/regression risk:** receipt variant 또는 additions 일반화가 임의 extra/missing path를 허용하거나 locked snapshot의 present addition을 수용하거나 recovery 뒤 addition/config/receipt를 혼합 상태로 남기면 설치 변경을 승인하지 않는다.
- **Change-induced safety/regression risk:** recovery authority가 exact candidate의 receipt paths와 additions가 아닌 여러 variant의 합집합을 허용하면 중단한다.
- **Change-induced safety/regression risk:** retry/review counters의 근거가 불명확한 legacy artifact는 기존 start-goal 규칙대로 `legacy baseline`을 기록한다. 명시적 기존 횟수는 절대 초기화하지 않는다.
- **Optional hardening:** cryptographic context signing, cross-process lock, 원격 telemetry, 전용 workflow engine은 현재 위협·지원 경계에 필요하지 않으며 blocking work로 승격하지 않는다.
- 실행 중 저장소 사실이 계획과 달라 exact 변경 지점을 뒷받침할 수 없으면 `MISSING_EVIDENCE`로 멈춘다.
- recovery 완료는 matching artifact/status, repository freshness, unchanged explicit counters, 동일 active goal 또는 goal 부재, 현재 prompt에서 생성된 유효 live authority를 다시 확인한 뒤에만 선언한다.
- transaction recovery 완료는 additions가 locked absent preimage로 복구됐고 config/receipt가 동일 preimage generation에 속하며 다음 upgrade가 current receipt를 원자적으로 기록한 뒤에만 선언한다.
- 테스트 실패가 environment transient인지 product/contract defect인지 구분되지 않거나 같은 failure에 새 증거가 생기지 않으면 자동 반복하지 않고 중단한다.

## Deliberate Review

### 실패 시나리오 1: persisted provenance나 무관한 사용자 턴이 live 실행 권한으로 오인됨

- **분류:** Change-induced safety/regression risk.
- **예방:** persisted `continuation_authority` enum은 audit provenance로만 사용한다. live authority는 현재 initial loop prompt, exact pending-decision answer, exact resume prompt 중 하나에서 생성해 slug/stage/next transition/current turn에 결합하고 transition마다 소비한다. 중단·취소·무관한 턴·blocker 종료 시 폐기한다.
- **탐지:** contract unit tests에서 enum-only context, 수정된 artifact, 과거 prompt, unrelated answer, slug/stage/pending mismatch, consumed authority 재사용을 거부하고 exact answer/resume와 uninterrupted next-transition derivation만 허용하는지 검사한다.
- **격리/롤백:** goal 생성 또는 다음 child 호출 전에 `BLOCKED: invalid loop approval context`로 중단하고 기존 artifact를 수정하지 않는다. standalone 요청은 기존 handoff를 사용한다.
- **복구 확인:** 현재 prompt가 exact answer 또는 resume 조건을 충족하고 matching artifact, pending decision, repository freshness, active goal 상태를 다시 검증한 뒤 새로운 일회성 live authority를 생성한다.

### 실패 시나리오 2: stale·충돌 산출물로 잘못된 단계가 재실행되거나 시도 횟수가 초기화됨

- **분류:** Accepted scope 및 Change-induced safety/regression risk.
- **예방:** 각 기존 artifact의 slug, status, plan kind, input boundary, repository marker, explicit attempt counters를 검사해 첫 미완료 단계만 선택한다. 정확히 하나의 plan artifact만 허용하고 영향받은 근거 외의 완료 단계는 재생성하지 않는다.
- **탐지:** resume scenario tests에서 valid completed spec, partial plan, active same goal, distinct active goal, duplicate plan, changed repository marker, persisted retry counters를 조합해 기대 stage/stop을 검증한다. 진행 출력에는 last completed stage와 재검증 이유를 포함한다.
- **격리/롤백:** 충돌 artifact를 삭제·덮어쓰기 하지 않고 마지막 유효 checkpoint에서 정지한다. plan branch나 acceptance를 바꿀 수 있는 불일치는 사용자 또는 재계획으로 반환하고 counters는 그대로 둔다.
- **복구 확인:** 영향받은 단계의 새 evidence/status만 갱신되고 이전 완료 artifact 및 counters가 변하지 않았으며 현재 resume authority가 exact slug에 결합됐음을 확인한 뒤 재개한다.

### 실패 시나리오 3: pre-loop upgrade의 absent additions 권한이 과도하거나 crash recovery가 혼합 설치를 남김

- **분류:** Change-induced safety/regression risk.
- **예방:** install이 exact matched receipt별 current-minus-pre-loop additions를 계산하고, installation-state가 root-local·unique·non-overlapping·absent임을 검사하며, transaction locked snapshot이 absent 상태를 다시 확인한다. snapshot/write/recovery authority는 receipt paths, config, receipt, exact additions로 한정하고 variant 권한을 합치지 않는다.
- **탐지:** transaction tests가 absent 허용과 present/extra/missing/duplicate/recovery mismatch 거부 및 legacy `[]`를 직접 검증한다. install child-process test는 실제 pre-loop disk에서 additions 일부와 config/receipt write 사이에 강제 종료한 뒤 재진입 상태를 검사한다.
- **격리/롤백:** recovery는 manifest의 exact authority로 additions를 absent preimage에, config/receipt를 동일 transaction preimage에 복구한다. authority mismatch나 unsafe addition이 있으면 복구·새 write를 진행하지 않고 fail closed한다.
- **복구 확인:** 재진입 후 partial additions와 혼합 receipt가 없고 upgrade가 current receipt를 완료하며, receipt-owned loop files가 각각 한 번 존재하고 이후 uninstall 및 전체 suite가 통과해야 한다.

검증 계층은 다음과 같이 적용한다.

- **Unit:** `test/skill-contract.test.js`가 단계 순서, child return, live authority 생성·결합·소비·무효화, 추천 조건, stop/recovery, standalone 호환성, 권한 경계를 문서 계약 단위로 검증한다. `test/transaction.test.js`는 additions participant·manifest·recovery authority validation을 직접 검증한다.
- **Integration:** `test/hook.test.js`는 실제 hook subprocess 입출력을, `test/install.test.js`는 임시 project/global roots와 실제 child process 강제 종료·재진입을 사용해 라우팅·설치·업그레이드·제거·crash recovery를 검증한다.
- **E2E:** repository에는 스킬을 실행하는 독립 runtime이 없고 새 runner/daemon은 명시적 non-goal이므로 자율 LLM workflow E2E 자동화는 적용하지 않는다. 대신 host가 실행할 상태 머신 전체 경로를 scenario-oriented contract test로 고정하고, 실제 Codex 실행 단계에서는 신규 설치 후 대표 low-risk/pro/block/answer/resume 흐름의 artifact·진행 출력을 본 계획의 동일 AC에 대조한다.
- **Observability:** loop 계약은 단계 시작·완료, spec return, plan 선택과 추천 근거, auto-selection, live authority의 현재 근거, blocker, pending decision, 마지막 유효 단계, resume 명령, 최종 goal 완료를 사용자 출력 및 기존 artifact provenance에 남긴다. persisted provenance가 live credential로 표시되지 않도록 contract tests와 artifact inspection으로 검증한다.
- **Compatibility:** standalone spec/planning/execution handoff, 기존 hook routes, project/global install, pre-loop receipt upgrade/direct uninstall, legacy transaction manifest, 기존 전체 suite를 검사한다.
- **Permissions/authorization boundary:** enum-only context, unrelated answer, consumed authority, BLOCKED, 다른 active goal, missing role, non-recommended plan-changing 결정, 배포·외부 메시지·삭제·추가 권한을 실행 전 stop 조건으로 검증한다.
- **Data/artifact integrity:** immutable child body 보존, 정확히 하나의 plan, retry counter 비초기화, stale artifact 비덮어쓰기, exact additions와 receipt ownership, crash recovery preimage, `.csx/loops` 비생성을 확인한다.

## Architect Review

## Draft Version

`draft_version: 2`

## Draft Integrity

`MATCH` — SHA-256 `644ec1f7732c2039ba561ba4d1ff4aff757d3a03279b156e1f5baa8c478efd41`

## Verdict

`CLEAR`

## Revision Brief 준수

- `RESOLVED` — loop-aware `csx-spec` 반환: 변경 경계에 producer 계약을 추가하고, validated context에서 path/status/recommendation/provenance만 부모에 반환하며 standalone 동작을 보존한다([v2](/tmp/csx-loop-pro-plan-v2.md:39), [v2](/tmp/csx-loop-pro-plan-v2.md:139)). 현재 `csx-spec`이 handoff 질문·downstream 호출을 직접 소유하는 경계와 정확히 대응한다([csx-spec](/home/ubuntu/work/feat-loop-skill/payload/skills/csx-spec/SKILL.md:165)).
- `RESOLVED` — exact absent additions 권한: current/pre-loop/verifier 변형을 분리하고, `additions`의 root-local·unique·absent 검증, lock 후 재검증, exact snapshot/write/recovery authority, legacy `[]`, crash 재진입, uninstall 분리를 모두 명시한다([v2](/tmp/csx-loop-pro-plan-v2.md:159), [v2](/tmp/csx-loop-pro-plan-v2.md:177)). 이는 현재 receipt-owned exact set 경계([installation-state](/home/ubuntu/work/feat-loop-skill/lib/installation-state.js:59))와 receipt-derived recovery authority([transaction](/home/ubuntu/work/feat-loop-skill/lib/transaction.js:736))를 안전하게 확장한다.
- `RESOLVED` — live continuation authority: 생성 근거 세 가지, slug/stage/transition/pending-decision/current-turn 결합, 일회 소비·연속 파생·중단 시 무효화, persisted enum-only 거부가 Decision·Plan 1/3·negative tests에 일관되게 반영됐다([v2](/tmp/csx-loop-pro-plan-v2.md:81), [v2](/tmp/csx-loop-pro-plan-v2.md:126), [v2](/tmp/csx-loop-pro-plan-v2.md:149), [v2](/tmp/csx-loop-pro-plan-v2.md:175)).

Revision Brief 밖의 사용자 결정, 고정 순서, plan 분기, hard gate, aggregate goal, retry/review 한도, immutable body, non-goal은 바뀌지 않았다.

## 가장 강한 반론과 경계 분석

Option A의 가장 강한 반론은 “일회성 live authority”가 런타임 capability가 아니라 네 자식 스킬에 복제되는 prose 계약이라는 점이다. 별도 상태 엔진을 피하는 대신 schema drift와 host 준수에 의존하며, Markdown provenance 자체는 출처를 증명하지 못한다. 중단마다 명시적 resume만 요구하는 얇은 합성이 더 단순할 수 있다.

그럼에도 승인 스펙은 답변 기반 연속 재개와 기존 artifact checkpoint를 요구한다([spec](/home/ubuntu/work/feat-loop-skill/.csx/specs/csx-loop.md:68), [spec](/home/ubuntu/work/feat-loop-skill/.csx/specs/csx-loop.md:72)). v2는 persisted provenance와 현재 권한을 분리하고 invalid context를 fail closed하므로, 해당 신뢰 경계 안에서 Option A는 비례적이다.

숨은 결합은 `csx-loop` schema producer와 `csx-spec`/plan/pro/start-goal의 네 validator, 그리고 installer candidate와 transaction recovery validator 사이에 있다. v2는 단일 child-contract 소유, exact field 검증, standalone negative tests, candidate별 recovery mismatch tests로 이를 관리한다. 계획 수정이 필요한 미해결 결합은 없다.

트레이드오프 긴장은 다음과 같다.

- 별도 상태 파일이 없는 단순성 대 분산 checkpoint의 비원자성.
- exact receipt 권한의 최소성 대 신규 payload upgrade·복구 복잡성.
- 자식의 standalone handoff 소유권 대 부모 loop의 연속 합성.
- runner 비도입 대 실제 LLM 상태 머신의 자동 E2E 검증 가능성.

## 분류된 우려

- `Accepted scope`: 고정 단계, 안전한 Recommended 선택, BLOCKED·다른 goal·비가역 작업 중단, 최종 goal 완료 게이트가 모두 계획과 AC에 연결됐다. 미해결 사항 없음.
- `Change-induced safety/regression risk`: enum-only 권한 상승, standalone 회귀, stale/duplicate artifact, excessive additions/recovery authority, 혼합 receipt 상태가 명시적 stop condition과 직접 테스트를 가진다([v2](/tmp/csx-loop-pro-plan-v2.md:214)).
- `Optional hardening`: 서명, telemetry, cross-process lock, 전용 engine은 현 지원·위협 경계 밖으로 유지됐다([v2](/tmp/csx-loop-pro-plan-v2.md:103)).

## Deliberate-profile 검토

- 경계·권한: loop 분기는 validated context와 live authority를 모두 요구하고, 배포·메시지·삭제·추가 권한을 사전 승인에서 제외한다.
- 호환성: standalone 네 스킬의 기존 선택 계약, pre-loop/current receipt, verifier legacy, additions 없는 manifest가 보존된다.
- 산출물 무결성: immutable child body, 정확히 하나의 plan, stale 비덮어쓰기, counter 비초기화가 명시됐다.
- transaction·복구·제거: additions는 locked absent preimage로 복구되고 config/receipt와 같은 generation으로 수렴해야 한다. pre-loop 강제 종료 재진입과 양쪽 uninstall이 기존 prospective recovery 테스트와 별도로 검증된다([v2](/tmp/csx-loop-pro-plan-v2.md:251)).
- 롤백: 일반 rollback 회귀를 유지하면서 신규 additions 경로의 recovery authority를 직접 검증하므로 중복 없이 충분하다.

## 승인 스펙 대조 및 잔여 관찰

AC1–AC14는 hook, 설치/transaction, child-return/order/authority, resume/staleness, completion, README, 전체 회귀 행에 빠짐없이 매핑됐다([v2](/tmp/csx-loop-pro-plan-v2.md:199)). 신규 transaction 작업은 기존 설치 경계를 깨지 않기 위한 필수 안전 수정이며 scope inflation이 아니다. runner·daemon·MCP·새 플랫폼·추가 retry 정책도 도입하지 않는다.

잔여 관찰점은 prose 기반 authority의 host 준수와 분산 schema drift다. 구현 시 계획에 이미 지정된 enum-only/unrelated-answer/consumed-authority 및 recovery-authority mismatch 검증이 그대로 유지되면 비차단 잔여 위험이다.

## Critic Review

## Draft Version

`draft_version: 2`

## Input Integrity

- Planner Body: `MATCH` — SHA-256 `644ec1f7732c2039ba561ba4d1ff4aff757d3a03279b156e1f5baa8c478efd41`
- Architect Review: `MATCH` — SHA-256 `1398117cf45f81bfbb652f0925874df1d6539684935746701200539a03428925`
- Architect verdict: `CLEAR` — 동일 `draft_version: 2`

## Verdict

`APPROVED`

## 저장소 검증 및 착수 가능성

계획의 주요 앵커를 실제 저장소와 대조했으며 모두 존재한다.

- `csx-spec`의 현재 final handoff 소유권과 loop-return 삽입 지점: [csx-spec/SKILL.md](/home/ubuntu/work/feat-loop-skill/payload/skills/csx-spec/SKILL.md:156)
- 일반/pro 계획의 승인 상태, immutable Planner Body, 최종 실행 질문 및 검토 한도: [csx-plan/SKILL.md](/home/ubuntu/work/feat-loop-skill/payload/skills/csx-plan/SKILL.md:56), [csx-plan-pro/SKILL.md](/home/ubuntu/work/feat-loop-skill/payload/skills/csx-plan-pro/SKILL.md:55)
- start-goal의 현재 턴 권한, 계획 상태, active-goal 및 완료 게이트: [csx-start-goal/SKILL.md](/home/ubuntu/work/feat-loop-skill/payload/skills/csx-start-goal/SKILL.md:43)
- installer의 `SKILLS`, current/legacy receipt 검증, recovery variant 및 uninstall 경로: [install.js](/home/ubuntu/work/feat-loop-skill/lib/install.js:33)
- receipt-owned exact-set participant: [installation-state.js](/home/ubuntu/work/feat-loop-skill/lib/installation-state.js:59)
- transaction 선언·manifest·participant normalization·receipt-derived recovery authority: [transaction.js](/home/ubuntu/work/feat-loop-skill/lib/transaction.js:55)
- hook closed list와 대응 테스트, 설치·transaction·계약 테스트 확장점도 실제 존재한다.

필요 역할은 현재 설치 영수증에 있으며, 계획은 current/pre-loop와 각각의 verifier legacy receipt variant, 별도 `additions`, lock 후 absent 재검증까지 구체화했다. 구현자가 정책이나 권한 경계를 새로 결정할 필요가 없다.

## 구현 경로 시뮬레이션

1. 초기 loop 및 자식 워크플로:

   `$csx-loop`/shorthand 라우팅 → stable slug와 initial-call live authority 생성 → `csx-spec`이 context와 transition을 검증하고 final path/status/recommendation/provenance만 부모에 반환 → direct start 추천은 `csx-plan`, 광범위 작업은 `csx-plan-pro`로 매핑 → READY/동일-version APPROVED 결과를 부모가 수신 → 다음 transition authority를 새로 파생·소비 → start-goal이 정확히 하나의 plan, 상태·가정·최신성·active goal을 검증한 뒤 실행한다. standalone/invalid child context는 기존 명시적 handoff를 유지하고, 불완전한 loop 주장으로 start-goal에 진입하면 fail-closed한다. BLOCKED, 권한 게이트, 다른 active goal 또는 추천 없는 plan-changing 질문은 authority를 폐기하고 downstream을 중단한다. 모든 단계가 v2에서 직접 착수 가능하다.

2. pre-loop 설치 업그레이드:

   실제 pre-loop receipt/disk 후보 선택 → current payload와 receipt-owned set의 정확한 차집합인 loop 파일 2개를 `additions`로 선언 → root-local·unique·non-overlap·absent 검사 → transaction lock → additions absent 상태 재검증과 exact snapshot/write/recovery authority 생성 → payload/config/receipt 쓰기 중 강제 종료 → candidate별 권한으로 manifest를 복구하여 additions를 absent preimage로, config/receipt를 같은 generation의 preimage로 복원 → 재진입 업그레이드가 current receipt를 마지막에 기록 → upgraded uninstall은 current receipt-owned 파일만 제거한다. 미업그레이드 uninstall과 verifier legacy 제거도 분리돼 있다. 넓은 variant 합집합이나 임의 absent 경로를 발명할 여지가 없다.

## 스펙·의도 및 v1 수정사항 대조

원 요청의 one-command 실행, `spec -> plan|plan-pro -> start-goal` 고정 순서, Recommended 자동 선택, 최종 구현 완료가 모두 보존됐다. 승인된 범위·non-goals·constraints·AC1–AC14, `READY_WITH_ASSUMPTIONS`, planning-only인 `$csx-plan-pro` 선택, 하나의 aggregate goal, 재시도·검토 한도, immutable body, pressure-check의 비가역 작업 별도 승인 경계와 충돌이 없다.

v1 Revision Brief의 세 필수 수정도 모두 유지됐다.

- loop-aware `csx-spec` 반환과 standalone 보존
- persisted provenance와 현재-turn live authority 분리
- exact absent `additions`의 선언·복구·uninstall 및 직접 테스트

새 inconsistency는 발견되지 않았다.

## 분류된 잔여 우려

- `Accepted scope`: 미해결 사항 없음. 고정 순서, hard gate, checkpoint/resume, 완료 조건이 AC와 검증 행에 연결돼 있다.
- `Change-induced safety/regression risk`: authority 재사용, standalone 회귀, stale/duplicate artifact, 과도한 additions 및 혼합 receipt 위험이 명시적 negative test와 stop condition으로 통제된다.
- `Optional hardening`: 암호학적 서명, telemetry, cross-process lock, 전용 workflow engine은 승인 범위 밖이며 차단 사유가 아니다.

Architect의 `CLEAR`와 본 Critic의 `APPROVED`가 동일 `draft_version: 2`에 대해 합의하므로 same-version consensus가 성립한다.

`BLOCKING_USER_DECISION: None`

최종 의도 일치: `CONFIRMED`

## Review Ledger

| Draft Version | Review Round | Architect | Critic | Notes |
| --- | --- | --- | --- | --- |
| 1 | 1 | BLOCK | REVISE | csx-spec loop-return 누락; exact additions transaction authority 누락; live continuation authority 수명·소비·무효화 누락 |
| 2 | 2 | CLEAR | APPROVED | None — same-version consensus |

## Unresolved Blockers

None.

## Handoff

Implementation has not started. Only explicit `Start execution with $csx-start-goal` selection authorizes implementation and accepts v2 reversible assumptions. Pass plan path, approved v2, boundaries, ACs, Verification Matrix, risks, and stop conditions.
