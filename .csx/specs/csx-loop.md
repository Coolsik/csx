# Spec: csx-loop

Status: READY_WITH_ASSUMPTIONS
Context: brownfield
Input Summary: recorded

## Intent

사용자가 `$csx-loop`를 한 번 명시적으로 호출하면 요구사항 정리, 구현 계획 수립, 목표 기반 구현과 최종 검증까지 동일한 작업 경계 안에서 연속 수행되게 한다. 일반적인 중간 워크플로 선택은 각 CSX 단계가 제시한 추천안을 사용하며, 자동화할 수 없는 사용자 소유 결정과 기존 하드 게이트만 사용자 개입 지점으로 남긴다.

## Outcome

- 정상 경로는 반드시 `csx-spec -> (csx-plan | csx-plan-pro) -> csx-start-goal` 순서로 진행한다.
- 범위가 작고 구현 경로가 명확해도 계획 단계를 생략하지 않는다.
- 각 단계가 유효한 산출물과 통과 상태를 반환하면 별도 핸드오프 질문 없이 다음 단계로 진행한다.
- 최종 성공은 `csx-start-goal`이 모든 수락 기준의 최신 증거, 최종 검증, 정리, 누적 코드 리뷰를 통과하고 목표를 완료한 상태다.
- 하드 게이트 또는 안전하게 추천할 수 없는 사용자 소유 결정이 발생하면 마지막 유효 체크포인트를 보존하고 멈춘다.

## Scope Ledger

### Artifacts

- 최종 요구사항 산출물 `.csx/specs/csx-loop.md`.
- 새 소스 스킬 `payload/skills/csx-loop/SKILL.md`와 `payload/skills/csx-loop/agents/openai.yaml`.
- 검증된 loop 승인 컨텍스트를 인식하도록 필요한 범위에서 조정된 `csx-plan`, `csx-plan-pro`, `csx-start-goal` 핸드오프 계약.
- `lib/install.js`의 설치 대상 목록과 설치 영수증 기대값.
- `payload/hooks/csx-hook.mjs`의 직접 명령 및 shorthand 라우팅.
- README의 직접 호출, shorthand, 중단·재개 의미 문서.
- 스킬 계약, 설치·제거, 라우팅을 검증하는 자동화 테스트.
- 실행 시 생성되는 `.csx/specs/<work-slug>.md`, 정확히 하나의 일반 또는 pro 계획 산출물, `.csx/goals/<work-slug>.md`.
- 별도의 loop 상태 파일은 만들지 않고 기존 draft/spec/plan/goal 산출물을 체크포인트로 사용한다.

### Surfaces

- 직접 호출: `$csx-loop <feature request>`.
- shorthand: `csx loop <feature request>`.
- 재개: `$csx-loop resume <work-slug>` 및 동일한 shorthand 형식.
- 사용자에게 보이는 단계 진행 상태, 중단 이유, 마지막 완료 단계, 재개 방법, 최종 완료 결과.
- 프로젝트 및 전역 범위의 기존 CSX 설치·업그레이드·제거 동작.

### Integrations

- `csx-spec`: 요구사항과 결정 경계를 확정하고 최종 spec을 생성한다.
- `csx-plan` / `csx-plan-pro`: 기존 추천 기준으로 정확히 하나를 선택해 계획 산출물을 만든다.
- `csx-start-goal`: 승인된 계획만 받아 구현, 검증, 정리, 리뷰, 목표 완료를 수행한다.
- hook 라우터: `$csx-loop`와 `csx loop`만 명시적으로 라우팅하고 일반 자연어는 라우팅하지 않는다.
- installer: 새 스킬을 payload 원본에서 설치 대상에 포함하고 기존 영수증 소유권과 트랜잭션 규칙을 유지한다.
- 내부 역할은 각 자식 스킬이 소유한다. `csx-loop`가 별도 runner, daemon 또는 MCP 서비스를 만들지 않는다.

## Non-goals

- `csx-spec`, 계획 단계 또는 `csx-start-goal`의 검토·재시도·검증 정책을 대체하거나 약화하지 않는다.
- 계획 단계를 생략하는 직접 `spec -> start-goal` 경로를 지원하지 않는다.
- BLOCKED 산출물, 누락된 필수 역할, 충돌하는 활성 목표, 권한·안전 게이트를 자동 우회하지 않는다.
- 명시적 추천이 없는 제품 선호, 공개 동작, 데이터 처리, 지원 범위 또는 비가역적 선택을 Codex가 임의 결정하지 않는다.
- 여러 독립 기능을 하나의 호출로 묶는 배치 실행, 백그라운드 실행, 무기한 재시도는 지원하지 않는다.
- 기존 CSX 산출물 형식과 단계별 최대 검토·수정 횟수를 새 형식으로 교체하지 않는다.
- 승인된 구현 범위 밖의 배포, 외부 메시지 전송, 데이터 삭제 또는 선택적 hardening을 자동 승인하지 않는다.

## Constraints

- 단계 순서는 고정이며 각 단계의 성공 상태가 확인되기 전 다음 단계로 넘어갈 수 없다.
- 계획 선택은 `csx-spec`의 기존 downstream 추천 기준을 따른다. 일반적인 구현 순서·위험·검증 계획이면 `csx-plan`, 광범위·고위험·교차 모듈·아키텍처 민감 작업이면 `csx-plan-pro`를 사용한다.
- `csx-spec`이 낮은 위험 때문에 `csx-start-goal` 직접 진행을 추천하더라도 loop에서는 이를 `csx-plan`으로 매핑한다. 계획 단계는 항상 존재해야 한다.
- `$csx-loop`의 명시적 호출은 고정된 전체 워크플로, 명시적으로 표시된 추천 옵션, 나열된 가역적 가정에 대한 사전 승인을 뜻한다.
- 이 사전 승인은 유효한 계획을 요구하는 entry gate를 대체하지 않는다. 일반 계획은 `Decision: READY`, pro 계획은 `Decision: APPROVED`여야 하며 모든 BLOCKED 상태는 중단시킨다.
- loop 승인 컨텍스트에는 원래 호출, 작업 slug, 선택된 계획 경로와 상태, 수락한 가역적 가정, 남은 단계가 포함돼야 한다. 자식 계획 스킬은 이 컨텍스트를 명시적 `Start execution with $csx-start-goal` 선택과 동등하게 처리할 수 있어야 한다.
- 사용자 답변 때문에 새 턴에서 계속되는 경우 질문은 “답변하면 남은 워크플로와 구현이 계속된다”는 효과를 명시해야 한다. 그 문맥에서의 답변 또는 명시적 resume 호출이 현재 턴의 계속 실행 승인을 갱신한다.
- 2~3개 선택지 중 하나가 명시적으로 추천되고, 기존 안전·권한 게이트와 충돌하지 않으며, 결과가 승인 범위 안에서 가역적이면 첫 추천 옵션을 자동 선택한다.
- 추천이 없거나 질문이 open-ended이고 그 답이 공개 동작, 데이터 처리, 범위, 수락 기준 또는 구현 경로를 바꾸면 `BLOCKING_USER_DECISION`으로 중단한다.
- BLOCKED 상태에서 제공되는 `Refine further (Recommended)`는 자동 반복하지 않는다. 차단 원인과 필요한 사용자 입력을 보고하고 멈춘다.
- 재개는 기존 산출물의 slug, 상태, 입력 경계와 저장소 최신성을 재검증한 뒤 첫 미완료 단계부터 계속한다. 완료된 유효 단계를 중복 실행하거나 기존 재시도 카운터를 초기화하지 않는다.
- 동일하지 않은 활성 goal이 있으면 새 goal을 만들지 않고 중단한다.
- `.agents`는 생성 결과이며 직접 수정하지 않는다. `payload`가 설치 원본이다.
- 작업 범위는 기존 npm 패키지가 지원하는 설치 범위와 실행 환경으로 한정하며 새 플랫폼·서비스 지원을 추가하지 않는다.

## Acceptance Criteria

1. `$csx-loop <request>`와 `csx loop <request>`가 모두 `csx-loop`로 라우팅되고, 일반 자연어 프롬프트는 라우팅되지 않는 hook 테스트가 통과한다.
2. 프로젝트 및 전역 설치에서 `csx-loop/SKILL.md`와 `agents/openai.yaml`이 설치 대상과 영수증에 포함되고, 기존 업그레이드·제거·롤백 테스트가 계속 통과한다.
3. 스킬 계약 테스트는 정상 경로가 `csx-spec`, 정확히 하나의 계획 스킬, `csx-start-goal` 순서임을 검증한다.
4. 낮은 위험의 대표 요청에서 `csx-spec`의 직접 실행 추천이 있더라도 실제 단계 기록에는 `csx-plan`이 포함되고 `csx-start-goal`보다 먼저 완료된다.
5. 광범위하거나 아키텍처 민감한 대표 요청에서는 `csx-plan-pro`가 선택되고, `Decision: APPROVED` 이전에는 `csx-start-goal`이 호출되지 않는다.
6. 일반 계획의 `Decision: READY` 또는 pro 계획의 `Decision: APPROVED`와 유효한 loop 승인 컨텍스트가 있으면 별도의 최종 핸드오프 질문 없이 `csx-start-goal`이 시작된다.
7. 추천 옵션이 있는 가역적 선택은 자동으로 첫 추천 옵션을 선택하고, 선택 결과와 적용 근거를 해당 산출물이나 진행 기록에 남긴다.
8. 안전한 추천이 없는 plan-changing 질문은 자동 응답하지 않고 `BLOCKING_USER_DECISION`, 마지막 성공 단계, 질문이 통제하는 downstream 결정, 재개 방법을 표시한다.
9. spec, plan 또는 pro plan이 BLOCKED이거나 필수 역할이 누락되거나 다른 활성 goal이 있으면 이후 단계를 호출하지 않는다.
10. 중단 후 `resume <work-slug>`를 호출하면 기존 유효 산출물과 시도 횟수를 재사용하고 첫 미완료 단계부터 진행한다. 유효한 완료 산출물은 다시 생성하지 않는다.
11. 저장소 변경으로 기존 근거 또는 산출물이 오래됐으면 영향받은 단계만 재검증하고, 경계를 바꿀 수 있는 불일치는 자동으로 덮어쓰지 않는다.
12. `csx-loop`는 `csx-start-goal`의 goal artifact가 모든 원래 수락 기준에 대한 최신 증거와 최종 `complete` 결정을 기록한 뒤에만 전체 성공을 보고한다.
13. README는 직접 호출, shorthand, 고정 단계 순서, 추천 자동 선택 범위, 하드 게이트, 중단·재개 예시를 포함한다.
14. `test/skill-contract.test.js`, `test/install.test.js`, `test/hook.test.js` 또는 동등한 테스트가 새 closed-list 항목과 승인·중단 계약을 검증하며 전체 기존 테스트가 회귀 없이 통과한다.

## Codex Decision Boundaries

- 사용자가 이미 결정한 사항: 한 명령으로 전체 워크플로 수행, 고정 단계 순서, 계획 단계 필수, 추천 옵션 자동 선택, 최종 구현 완료까지 진행.
- Codex가 결정할 수 있는 사항: 기존 추천 기준에 따른 일반/pro 계획 선택, 직접 실행 추천을 일반 계획으로 변환, 유효 산출물 재사용, 영향받은 근거만 재검증, 승인 범위 안의 가역적 추천 선택.
- 사용자에게 남겨야 하는 사항: 안전한 추천이 없는 공개 동작, 데이터 처리, 호환성·지원 경계, 범위 포함·제외, 수락 기준, 비가역적 외부 부작용.
- `recommend`는 자식 워크플로가 명시적으로 추천으로 표시한 안전하고 가역적인 선택을 뜻한다. 단순히 첫 번째에 놓인 임의 선택이나 하드 게이트 우회는 뜻하지 않는다.
- `끝까지 구현`은 파일 변경만을 뜻하지 않고 `csx-start-goal`의 완료 게이트를 모두 통과한 상태를 뜻한다.
- 체크포인트는 새 loop 전용 상태 파일이 아니라 기존 draft/spec/plan/goal 산출물과 그 상태를 뜻한다.
- 현재 기존 계약은 계획 단계의 최종 사용자 선택과 start-goal의 현재 턴 실행 선택을 요구한다. 이를 해결하기 위해 검증된 loop 승인 컨텍스트를 동등한 명시적 선택으로 인정하는 bounded composition 계약이 필요하다.
- 같은 slug의 오래된·BLOCKED·부분 산출물, 계획 분기 재분류, 검토 횟수 소진, 사용자 취소, 서로 다른 활성 goal은 모두 명시적 중단 또는 재검증 경로를 가져야 한다.

## Decision Ledger

| Decision | Owner | Source | Status |
| --- | --- | --- | --- |
| `spec -> plan 또는 plan-pro -> start-goal` 고정 순서 | User | controlling request | Confirmed |
| 계획 단계를 절대 생략하지 않음 | User | controlling request | Confirmed |
| loop 호출을 전체 고정 워크플로의 사전 실행 승인으로 해석 | User | “한번 명령”, “끝까지 구현” | Confirmed |
| 명시된 추천 옵션을 자동 선택 | User | controlling request | Confirmed |
| 일반/pro 분기는 기존 csx-spec 추천 기준으로 선택 | Repository | `csx-spec` downstream recommendation rules | Confirmed |
| 직접 start-goal 추천은 loop에서 일반 계획으로 매핑 | Codex | 사용자 고정 순서와 저장소 정책의 충돌 해소 | Assumed |
| BLOCKED 및 entry gate는 자동 승인보다 우선 | Repository | child workflow contracts | Confirmed |
| 안전한 추천이 없는 plan-changing 결정은 사용자에게 반환 | Repository | spec/plan decision ownership rules | Confirmed |
| 기존 단계 산출물을 loop 체크포인트로 사용 | Codex | 최소 영속 상태 원칙 | Assumed |
| 검증된 loop 승인 컨텍스트를 자식 실행 선택과 동등하게 인정 | Codex | one-command 결과와 기존 현재 턴 게이트의 조정 | Assumed |
| 별도 runner, daemon, MCP 서비스를 만들지 않음 | Repository | 기존 skill orchestration policy | Confirmed |

## Assumptions

- 한 번의 loop 호출은 하나의 bounded 작업 slug와 하나의 aggregate goal만 다룬다.
- 기존 산출물에서 단계와 상태를 신뢰성 있게 복원할 수 있으므로 별도 `.csx/loops` 상태 파일은 필요하지 않다.
- 승인 컨텍스트의 내부 표현은 사용자에게 공개되는 새 토큰일 필요가 없으며 스킬 간 전달 메타데이터로 구현할 수 있다.
- 같은 작업이 사용자 질문으로 중단됐을 때, 질문이 계속 실행 효과를 명시하면 사용자의 답변은 남은 단계 실행 승인을 갱신한다.
- loop 계약을 인식시키기 위한 기존 자식 스킬 변경은 loop 호출에만 적용되며 독립 `$csx-plan`, `$csx-plan-pro`, `$csx-start-goal` 호출의 기존 사용자 선택 동작은 보존한다.
- 오래된 산출물의 재검증 범위는 저장소 변경으로 직접 영향받은 근거와 경계로 한정한다.

## Evidence Inspected

- 패키지는 `@coolsik/csx`이고 스킬 원본은 `payload/skills`, 생성된 `.agents`는 ignored 대상이며 installer가 스킬을 명시적으로 열거한다: `package.json:2,9`, `README.md:3`, `.gitignore:5`, `lib/install.js:33,198,216,248`.
- 스킬은 `SKILL.md`와 `agents/openai.yaml` 계약을 가지며 테스트가 이를 열거한다: `payload/skills/csx-spec/agents/openai.yaml:1`, `test/skill-contract.test.js:17,71,88`.
- 설치와 hook 라우팅은 closed list로 검증된다: `test/install.test.js:62,188`, `test/hook.test.js:10,23`, `payload/hooks/csx-hook.mjs:3,31`.
- README는 직접 `$csx-*` 호출과 `csx ...` shorthand를 각각 열거한다: `README.md:135,149`.
- `csx-spec`은 내부 구현을 금지하고, 준비된 spec만 확정하며, 낮은 위험 작업에는 계획을 생략한 직접 start-goal 추천을 허용한다: `payload/skills/csx-spec/SKILL.md:43,156,165,169-183`.
- `csx-plan`은 user-owned plan-changing 결정을 차단하고 READY 계획을 만들며, 별도 명시적 실행 선택을 요구한다: `payload/skills/csx-plan/SKILL.md:45,58,67-69,158,173`.
- `csx-plan-pro`는 동일 draft에 대한 Architect와 Critic 합의를 요구하고, 좁은 작업은 일반 plan으로 보내며, 명시적 실행 선택을 요구한다: `payload/skills/csx-plan-pro/SKILL.md:45,65,72,118,129,203,218`.
- `csx-start-goal`은 BLOCKED 입력을 거부하고 현재 턴의 명시적 실행 권한과 승인된 계획을 요구하며, 최종 검증과 리뷰 이후에만 완료한다: `payload/skills/csx-start-goal/SKILL.md:43-50,65,128,158,195`.
- 필요한 역할은 현재 설치 영수증에 존재한다: `.codex/.csx-install-receipt.json:2,21`.
- 기존 loop 승인 위임 형식, 자식 final prompt 억제 계약, loop 전용 checkpoint/resume 어휘는 존재하지 않는다: `MISSING_EVIDENCE`. 이 사양이 그 신규 계약을 한정한다.

## Open Questions

### Blocking

None. 현재 첫 구현 계획을 바꾸는 `BLOCKING_USER_DECISION`은 없다. 다만 실제 loop 실행 중 안전한 추천이 없는 plan-changing 결정이 발견되면 해당 실행은 이 상태로 중단돼야 한다.

### Non-blocking

None. 승인 컨텍스트의 구체적인 내부 필드 표현은 위 행동 계약을 만족하는 범위에서 구현 단계가 선택할 수 있다.

## Pressure Check

추천 옵션이 있더라도 배포, 외부 메시지 전송, 데이터 삭제처럼 별도 권한 또는 비가역적 부작용을 자동 승인해야 하는가? 채택 경계는 “아니오”다. loop 사전 승인은 승인된 계획 안의 구현과 가역적 추천 선택만 포함하며 기존 안전·권한 게이트는 그대로 유지한다.

## Recommended Handoff

`$csx-plan-pro`를 추천한다. 새 스킬 추가 외에도 installer·hook·문서·테스트의 closed list와 세 자식 워크플로의 실행 승인 계약을 함께 조정해야 하므로, 구현 전에 경계·호환성·실패·재개 동작을 Architect와 Critic이 동일 계획 초안 기준으로 검토하는 편이 적합하다.
