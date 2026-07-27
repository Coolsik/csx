# Plan: CSX 전 단계 범위 통제, 단계별 Leader와 Plan-Pro 순차 리뷰 게이트

## 목표

CSX의 spec, 고강도 계획, 실행, 누적 코드 리뷰를 하나의 범위 통제 계약으로 연결하고,
`csx-plan-pro`의 리뷰를 다음과 같이 구성한다.

1. `csx-spec`이 구현 세부사항보다 먼저 사용자의 outcome, 구성요소, 비범위와
   tradeoff priority를 확인하고 안정적인 ID로 잠근다.
2. 구성요소별 의도 명확도를 정량 평가하고 `Quick`, `Standard`, `Strict`의 세
   인터뷰 모드로 단계적으로 질문한다.
3. `csx-spec`에서 기능별 신뢰성 등급, 명시적 비범위, 복잡도 예산을 고정한다.
4. Architect가 계획의 구조적 충분성과 범위 준수를 검토한다.
5. Architect가 승인한 동일 draft만 Critic이 실행 가능성과 검증 가능성을 검토한다.
6. 두 reviewer 모두 accepted scope 밖의 개선을 blocker로 승격하지 않는다.
7. 모든 draft가 이전 버전 대비 범위 변화를 명시하고 근거 없는 확장을 거부한다.
8. `csx-start-goal`의 Executor는 승인된 파일·criterion 경계 안에서만 구현한다.
9. `csx-code-review`는 한 결함을 발견하면 동일 invariant family를 한 번에 조사한다.
10. blocker는 구현 전에 반드시 결정해야 하는 문제로 제한한다.
11. 최대 5 cycle 동안 같은 판정 원칙을 일관되게 적용한다.
12. 대형 계획·리뷰 원문은 read-only agent 사이에서 메시지 청크로 중계하지 않고,
    단계별 Leader가 단일 writer로 관리하는 versioned handoff artifact를 통해
    전달한다.
13. 사용자 입력이 집중되는 spec은 Root가 직접 수행하고, 계획과 실행은 각각 별도의
    Plan Leader와 Start-Goal Leader가 맡는다.
14. Planner가 실행 goal을 분할하고, 일반 작업은 5개 이하, 대형·고위험 작업은
    10개 이하를 기본 complexity budget으로 사용하며 강하게 결합된 변경은 vertical
    slice로 묶는다.
15. Start-Goal Leader는 승인된 goal을 인수해 구현, 테스트, 코드·architecture
    review, goal-scoped deslop을 포함한 제한된 rework, 최종 검증과 완료 판정까지
    하나의 논리적 lifecycle을 소유한다.
16. 테스트가 통과한 변경만 비싼 code review로 보내고, 전체 테스트는 기본 1회,
    review 수정으로 코드가 바뀐 경우 최종 1회를 추가해 최대 2회로 제한한다.
17. 짧은 polling과 동일 원인의 무제한 재시도를 금지하고, timeout 이후 상태 확인
    1회와 artifact 기반 agent 교체를 사용한다.
18. 역할별 agent message에는 soft output budget을 적용하되 Planner, Architect,
    Critic과 Code Reviewer의 read-only 권한은 유지하고 Leader가 원문 artifact의
    단일 writer가 된다.
19. runtime token 지표가 있으면 model context window 대비 사용률로 Leader session을
    선제 교체하고, context compaction이 발생하면 즉시 교체한다.
20. Leader 교체는 artifact 기반의 새 내부 session으로 수행하며, Root 자체의
    사용자-visible thread 교체는 사용자 결정 이력이 손상된 예외 상황으로 제한한다.

이 변경은 리뷰 강도를 낮추는 것이 아니라, 리뷰 호출과 blocker의 자격을 더 엄격하게
통제하고 spec에서 잠근 범위가 계획·구현·리뷰 중 다시 넓어지지 않게 하는 것이
목적이다.

## 설계 원칙

### 0. Spec Interview가 사용자 의도와 범위 형태를 먼저 잠근다

`csx-spec`은 질문을 최소화하는 대신 사용자의 의도, 비범위와 완료 기준이 정량
기준을 만족할 때까지 질문한다. 단, 긴 인터뷰 자체를 목표로 삼지 않으며 매 질문은
구현 방향이나 accepted boundary를 실제로 바꿀 수 있는 gap과 연결해야 한다.

#### Round 0: Intent Topology Lock

저장소 사실을 먼저 조사한 뒤 Analyst는 구현 작업 목록이 아니라 독립적으로 성공하거나
실패할 수 있는 상위 구성요소와 사용자가 잠가야 할 intent를 제안한다.

```markdown
## Intent Topology

### Outcomes
- outcome:<id>

### Artifacts
- artifact:<id>

### Surfaces
- surface:<id>

### Integrations
- integration:<id>

### Constraints
- constraint:<id>

### Non-goals
- non-goal:<id>

### Tradeoff Priorities
- priority:<id>
```

Root는 Round 1 scoring 전에 이 topology를 사용자에게 보여 주고 추가, 제거, 병합,
분리 또는 명시적 보류가 필요한지 한 번 확인한다. 사용자가 확인한 항목에는 안정적인
category-prefixed ID를 부여한다. 이후 spec, plan, Scope Delta와 review finding은 이
ID를 그대로 사용한다.

각 항목은 다음 authority 중 하나를 가진다.

- `USER_EXPLICIT`: 사용자가 직접 진술했다.
- `USER_CONFIRMED`: Analyst의 구조화된 해석을 사용자가 확인했다.
- `REPO_REQUIRED`: 저장소의 기존 호환성 또는 불변식이 요구한다.
- `CODEX_ASSUMPTION`: 국소적이고 가역적인 내부 기본값이다.

Agent가 제안한 material component 추가·제거, support environment 확대, 새
integration, 보존·호환성 보장 강화 또는 non-goal의 범위 편입은 사용자 확인 없이
accepted topology에 반영할 수 없다. 사용자가 직접 추가한 항목은
`USER_EXPLICIT`으로 기록한다. `CODEX_ASSUMPTION`은 public behavior, support
boundary, persisted data, compatibility, security 또는 complexity budget을 결정할
수 없다.

#### 구성요소별 명확도와 ambiguity

Analyst는 각 active component에 대해 다음 7개 차원을 `0.0`부터 `1.0`까지 평가한다.

| 차원 | 가중치 | 의미 |
|---|---:|---|
| Intent | 0.15 | 왜 이 변화가 필요한지 |
| Outcome | 0.15 | 사용자가 관찰할 결과가 무엇인지 |
| Scope | 0.20 | 포함 범위와 support boundary가 닫혀 있는지 |
| Non-goals | 0.15 | 인접하지만 제외할 범위가 명시됐는지 |
| Constraints / Tradeoffs | 0.10 | 호환성, 안전성과 충돌 시 우선순위가 정해졌는지 |
| Acceptance | 0.15 | 완료 여부를 관찰하고 검증할 수 있는지 |
| Decision Authority | 0.10 | 사용자 결정과 Codex 재량이 구분됐는지 |

전체 dimension score는 active component 점수의 평균이 아니라 최솟값으로 계산한다.
설명이 잘 된 한 구성요소가 불명확한 sibling component를 가리지 않게 하기 위해서다.

```text
dimension_score = min(active_component_dimension_scores)
clarity = Σ(dimension_score × dimension_weight)
ambiguity = 1 - clarity
```

답변은 ambiguity를 항상 낮추지 않는다. 기존 결정과의 충돌, 동시에 성립할 수 없는
요구, 새 component·surface·integration·support environment 추가, non-goal의 범위
편입 또는 targeted gap을 해소하지 못한 답변은 관련 점수를 낮추고 ambiguity를 다시
높인다. 충돌한 이전 결정은 삭제하지 않고 `disputed`로 보존하며, 새 결정이 확정되면
`superseded_by`로 연결한다.

#### 세 가지 점진적 인터뷰 모드

| 모드 | 최대 ambiguity | 최소 clarity | 용도 |
|---|---:|---:|---|
| `Quick` | `0.20` | `80%` | 작고 가역적이며 경계가 단순한 변경 |
| `Standard` | `0.10` | `90%` | 일반 기능, 리팩터링과 기본 권장 수준 |
| `Strict` | `0.05` | `95%` | 데이터, 보안, 호환성 또는 광범위한 변경 |

인터뷰는 최소 모드인 `Quick` 기준부터 진행한다. `Quick` 기준과 공통 hard gate를
처음 충족하면 자동으로 spec을 확정하지 않고 사용자에게 정확히 다음 선택을 묻는다.

1. `Quick에서 확정`: 현재 명확도로 closure와 최종 intent 확인을 진행한다.
2. `Standard까지 계속 (권장)`: ambiguity `0.10` 이하까지 질문한다.
3. `Strict까지 계속`: ambiguity `0.05` 이하까지 질문한다.

사용자가 `Standard`를 선택한 뒤 그 기준을 충족하면 `Standard에서 확정` 또는
`Strict까지 계속`을 다시 묻는다. 사용자가 이미 `Strict까지 계속`을 선택했다면
Standard 경계에서 반복 확인하지 않는다. `Strict` 기준을 충족하면 closure로
진행한다. 사용자는 어느 단계에서도 명시적으로 더 질문하거나 중단할 수 있다.

최종 spec metadata에는 `interview_mode_achieved`, `clarity`, `ambiguity`,
`selected_threshold`, `mode_decision`과 사용자 확인 근거를 기록한다.

모드 임계값은 질문 깊이를 선택하기 위한 기준이며 다음 공통 hard gate를 완화하지
않는다.

- plan을 바꿀 user-owned decision이 남아 있지 않다.
- 고위험 support boundary와 material non-goal이 모두 결정됐다.
- 모든 material requirement가 intent, boundary, 사용자 결정 또는 repo invariant와
  연결된다.
- 핵심 acceptance criterion이 관찰·검증 가능하다.
- public behavior, persisted data, compatibility 또는 security에 영향을 주는
  `CODEX_ASSUMPTION`이 없다.
- 미해결된 요구 충돌이나 `disputed` 결정이 없다.

Hard gate가 실패한 상태에서는 모드 확정 선택을 정상 READY로 제시하지 않는다.
사용자가 명시적으로 조기 종료하면 남은 gap과 위험을 포함한 `BLOCKED` checkpoint를
보존한다.

#### 질문 선택과 재평가

한 라운드에는 원칙적으로 하나의 material decision만 질문한다. Analyst는 각 gap의
우선순위를 다음과 같이 계산하고 가장 높은 항목을 다음 질문으로 추천한다.

```text
question_priority =
  (1 - clarity_score)
  × dimension_weight
  × implementation_impact
  × authority_factor
```

`implementation_impact`는 `1..3`이고, `authority_factor`는 Codex 내부 기본값 `1`,
사용자 선호 `1.5`, 범위·호환성·데이터·보안 결정 `2`를 사용한다. 질문에는 target
component, dimension, 현재 score, 남은 gap과 이 답이 구현을 어떻게 바꾸는지
포함한다.

사용자의 자유서술 답변이 material scope, non-goal, constraint, tradeoff 또는
authority를 바꾸면 Analyst는 이를 `Decision`, `Reasoning`, `Constraints`,
`Out of scope`, `Verified codebase context`로 구조화하고 사용자에게 손실 여부를
확인받은 뒤 scoring에 사용한다. 짧은 선택 답변이나 단순 사실 확인에는 이 재확인을
반복하지 않는다.

각 답변 뒤에는 영향받은 component뿐 아니라 전체 7개 차원을 다시 평가하고, 이전
score, 새 score, trigger, remaining gap과 다음 질문 target을 반환한다. 두 라운드
연속 새 material decision이나 scope change가 없고 ambiguity 감소가 라운드당
`0.02` 미만이면 같은 질문을 표현만 바꾸지 않고 핵심 ontology, 상충하는 결정 또는
비범위 자체를 다시 묻는다.

#### Closure와 Intent Restate

선택한 모드 기준을 충족하고 사용자가 그 수준에서 확정을 선택해도 수학적 점수만으로
spec을 승인하지 않는다. Root는 다음 closure audit을 수행한다.

- 모든 active topology ID가 최종 spec에 보존됐다.
- 모든 material requirement와 acceptance criterion의 authority가 추적 가능하다.
- 미해결 contradiction, disputed decision, user-owned blocker가 없다.
- 낮은 점수의 sibling component가 평균에 가려지지 않았다.
- non-goal, support boundary와 acceptance criterion이 서로 충돌하지 않는다.

Closure가 실패하면 가장 영향이 큰 질문 하나와 함께 인터뷰로 돌아간다. Closure가
통과하면 전체 목적, 지원 범위, 비범위와 tradeoff priority를 한 문장으로 다시
진술하고 사용자에게 확인받는다. 사용자가 범위 누락이나 잘못된 표현을 수정하면
scoring과 closure를 다시 수행한다.

#### Compact checkpoint

전체 transcript를 매 라운드의 prompt에 다시 넣지 않는다. 첫 material 답변부터
`.csx/specs/<slug>.draft.md`에 confirmed topology, decisions, disputed/superseded
decisions, dimension scores, remaining gaps와 next target을 갱신한다. 다음 Analyst
호출에는 원문 전체 대신 이 compact state, 사용자의 최신 답변과 필요한 repository
evidence만 전달한다. 새 runtime orchestrator나 별도 영속 상태 schema는 도입하지
않는다.

### 0.1. Spec이 신뢰성 등급과 복잡도 상한을 잠근다

`csx-spec`은 각 기능을 다음 신뢰성 등급 중 하나로 분류한다.

- `durable`: 손상이나 중단이 사용자 작업, 권한, 데이터 무결성에 직접 영향을 주므로
  명시된 atomicity, authority, recovery 불변식을 보장한다.
- `best-effort`: 진단·관찰 목적이며 유실, 중복, 부분 손상을 허용한다. 실패가 본
  workflow를 중단하거나 audit-grade 정확성을 암시해서는 안 된다.
- `advisory`: 정보 제공만 수행하며 state mutation이나 완료 판정의 authority가 될 수
  없다.

각 기능에는 다음 항목을 함께 기록한다.

- 신뢰성 등급과 그 이유
- 지원 환경과 명시적 비범위
- 허용되는 데이터 손실·중복·지연
- 금지되는 구현 메커니즘 또는 복잡도 상한
- 해당 등급을 변경하려면 필요한 사용자 결정

예를 들어 workflow diagnostics가 `best-effort`라면 정확한 event pairing, 전역 순번,
WAL, 다중 파일 transaction, audit-grade count는 accepted spec이 별도로 요구하지 않는
한 계획이나 reviewer finding을 통해 추가할 수 없다. 상태 복원이 `durable`이라면
잘못된 active 상태를 복원하지 않는 authority와 old-or-new commit은 계획에서 잠그되,
국소 helper 구조와 동등한 atomic-write 구현 선택은 실행 단계에 맡길 수 있다.

### 1. Accepted scope가 유일한 범위 기준이다

다음 항목만 scope authority로 인정한다.

- 사용자의 요청과 확인된 결정
- accepted spec의 goal, requirement, constraint, acceptance criterion
- 명시된 support boundary와 non-goal
- 계획된 변경 때문에 직접 생기는 구체적인 안전 또는 회귀 위험

Reviewer는 새로운 제품 기능, 지원 약속, 운영 환경, 위협 모델 또는 미래 확장 요구를
만들 수 없다. 정의되지 않은 범위를 가장 넓은 의미로 해석해서도 안 된다.

### 2. 계획은 구현을 가능하게 할 만큼만 결정한다

계획 단계에서 반드시 잠가야 하는 것은 다음과 같다.

- 외부에서 관찰 가능한 동작과 인터페이스
- 데이터·권한·보안 경계와 책임 주체
- 실패 시 보존해야 할 불변식
- 되돌리기 어려운 변경과 그 복구·철회 조건
- 여러 모듈 또는 단계 사이의 소유권과 순서
- 완료 여부를 판정할 수 있는 acceptance criteria

다음 항목은 accepted criteria를 해치지 않고 국소적이며 가역적으로 선택할 수 있다면
실행 단계에 위임한다.

- 내부 코드 구조와 보조 함수 구성
- 구체적인 파일 배치와 이름
- 동등한 구현 기법 중 하나를 고르는 결정
- 국소적인 재시도·직렬화·fixture 구성 세부사항
- 구현 중 테스트로 안전하게 확정할 수 있는 선택

Reviewer는 계획을 완전한 구현 명세로 확장하지 않는다. Executor가 공개 동작, 안전
경계 또는 비가역적 결정을 임의로 발명해야 할 때만 계획의 불충분으로 본다.

### 3. 가장 작은 준수 설계를 우선한다

Finding을 해결하는 제안이 새로운 상태, 저장 계층, 장기 실행 구성요소, 호환 계층,
권한 주체 또는 복구 절차를 추가한다면 reviewer는 먼저 다음을 확인한다.

1. accepted criteria를 만족하는 더 단순한 대안이 있는가
2. 그 대안이 국소적이고 가역적인가
3. 복잡한 대안이 필요한 이유를 구체적인 실패 경로로 설명할 수 있는가

더 단순한 대안이 기준을 만족하면 그것을 채택한다. 장래의 가능성이나 일반적인
완성도만으로 복잡성을 추가하지 않는다.

### 4. 같은 판정 규칙을 모든 cycle에 적용한다

Cycle 번호에 따라 reviewer의 엄격도나 지원 범위를 바꾸지 않는다. 1차부터 5차까지
동일한 scope authority, blocker 기준, 순차 게이트를 사용한다.

최대 5 cycle은 무조건 다섯 번 수정하라는 목표가 아니라 수렴 실패를 제한하는 최종
안전장치다.

두 번째 cycle이나 특정 token 임계값에서 자동으로 사용자 재결정을 강제하지 않는다.
이 규칙은 accepted spec 이후의 Plan-Pro review cycle에만 적용하며, 앞서 정의한
Spec Interview의 `Quick`·`Standard` 모드 전환 확인에는 적용하지 않는다. 1차부터
5차까지 같은 scope authority와 수렴 규칙을 적용하며, 사용자 결정은 공개 동작, 지원
범위, acceptance criterion 또는 비가역적 선택을 실제로 변경해야만 해결되는 경우에만
요청한다. Context 사용률에 따른 Leader session 교체는 사용자 재결정이나 review
cycle 종료로 간주하지 않는다.

### 5. 모든 draft는 Scope Delta를 증명한다

Planner는 `draft_version: 2`부터 이전 버전 대비 모든 material change를 다음 표로
기록한다.

| 변경 사항 | 출처 | Scope/AC 근거 | 범위 영향 | 처리 |
|---|---|---|---|---|
| 기존 blocker의 최소 수정 | Revision Brief | `ACnn` 또는 경계 ID | 범위 유지 | 포함 |
| 수정으로 새로 생긴 회귀 방지 | 구체적 실패 경로 | `REGRESSION:<invariant>` | 범위 유지 | 포함 |
| reviewer가 제안한 추가 hardening | reviewer 제안 | 없음 | 범위 확대 | 제외/Watch Item |

새 기능, 지원 환경, 저장 계층, 상태, 권한 주체, migration 경로 또는 검증 의무를
추가하려면 사용자 결정, accepted spec 항목, acceptance criterion 또는 구체적인
`change-induced-risk`의 `REGRESSION:<invariant>` 중 하나와 연결해야 한다. 근거 없는
항목은 draft 본문에 포함하지 않는다.

Architect는 Scope Delta의 구조·경계 영향을 검토하고 Critic은 각 항목이 원래 intent,
acceptance criteria 및 Revision Brief에 실제로 연결되는지 검증한다.

### 6. 실행은 승인된 파일·criterion 경계를 넘지 않는다

`csx-start-goal`의 각 실행 goal에는 다음 scope fence를 둔다.

- 허용 파일과 소유 경로
- 담당 acceptance criteria
- 보존해야 할 invariant
- 허용되는 의존 경로
- 명시적 금지 범위
- 범위 확장이 필요할 때의 중단 결과

Executor가 승인되지 않은 파일, public behavior, schema, 지원 환경 또는 권한 경계를
변경해야 한다고 판단하면 구현하지 않고 `SCOPE_EXPANSION_REQUIRED`를 반환한다. 이
결과에는 이유, 영향받는 criterion, 필요한 파일, 사용자 결정 필요 여부를 포함한다.
Root 또는 Start-Goal Leader는 이를 새 goal로 자동 편입하지 않는다.

### 7. 코드 리뷰는 invariant family 단위로 완결한다

`csx-code-review`가 blocking defect를 찾으면 한 줄이나 한 호출자만 반환하지 않고 먼저
위반된 invariant를 정의한다. 이후 같은 invariant를 공유하는 producer, consumer,
normal path, resume/recovery path, adapter 및 migration path를 bounded sweep으로 함께
검사한다.

Finding에는 `invariant`, `affected_producers`, `affected_consumers`,
`required_sweep`, `inspected_paths`를 기록한다. 후속 review에서 같은 invariant의 다른
발현을 새 blocker로 등록하려면 이전 review 때 관찰할 수 없었던 draft delta 또는
구체적인 누락 사유를 설명해야 한다.

이 규칙은 review 강도를 낮추지 않는다. 같은 권한·복구 결함을 revision마다 하나씩
발견하는 대신, 최초 finding에서 동일 결함군을 가능한 범위 안에서 한 번에 반환하도록
한다.

### 8. Read-only reviewer handoff는 단일 writer artifact로 수행한다

Planner, Architect와 Critic의 read-only 역할은 독립 검토를 위해 유지한다. 이들에게
일반 파일 쓰기 권한을 추가하지 않는다. 별도의 Plan Leader가 `csx-plan-pro` run을
소유하고, 해당 run의 유일한 handoff writer가 되어 specialist 결과를 수정 없이
저장한다. Plan Leader의 쓰기 권한은 현재 run의 `.csx/handoffs/<run-id>/`와 최종
`.csx/plans/<slug>-pro.md` 조립에만 사용하며, 제품 소스 수정 권한으로 해석하지
않는다. Root는 spec과 사용자 결정의 authority이지만 plan handoff courier나 writer가
아니다.

```text
.csx/handoffs/<run-id>/
├── manifest.json
├── draft-v001.md
├── architect-v001.md
├── critic-v001.md
├── revision-brief-v001.md
└── current.md
```

`manifest.json`은 최소한 다음 필드를 가진다.

```json
{
  "schema_version": 1,
  "run_id": "hook-lifecycle",
  "stage": "plan_review",
  "draft_version": 1,
  "draft_sha256": "<sha256>",
  "status": "awaiting_critic"
}
```

Handoff artifact는 계획 provenance이며 runtime workflow state, hook 입력 또는 완료
판정 authority가 아니다. 기존 `.csx/plans/<slug>-pro.md` 최종 artifact 계약도
대체하지 않는다. 최종 artifact는 승인 또는 차단된 handoff 원문을 기존 envelope로
조립하되 Planner body와 review 원문을 변경하지 않는다.

전달 순서는 다음과 같다.

1. Planner가 draft 원문을 Plan Leader에 정확히 한 번 반환한다.
2. Plan Leader는 이를 수정하지 않고 `draft-vNNN.md`에 저장하고 SHA-256을 기록한다.
3. Architect에는 draft path, `draft_version`, digest와 bounded assignment만 전달한다.
4. Architect는 digest를 확인하고 파일을 직접 읽어 한 번의 review 결과를 반환한다.
5. Plan Leader는 Architect 결과를 `architect-vNNN.md`에 수정 없이 저장한다.
6. Critic에는 draft와 Architect review의 path, version, digest만 전달한다.
7. Revision이 필요하면 Plan Leader가 reviewer-owned Revision Brief를 별도 파일로
   저장하고 Planner에는 이전 draft와 brief의 path만 전달한다.
8. Root에 사용자 결정이 필요한 경우에만 bounded Decision Packet을 반환한다. 일반
   진행 보고에는 verdict, 최대 세 개 blocker, artifact path, version과 digest만
   포함한다.

8 KiB를 초과하는 계획, review, evidence 또는 Revision Brief는 agent message로
재전송하거나 `CHUNK n/m`, `END`, `START` 표식으로 relay하지 않는다. Agent가 artifact를
찾을 수 없거나 digest가 다르면 chunk relay로 복구하지 않고
`BLOCKED_ARTIFACT_MISSING` 또는 `BLOCKED_ARTIFACT_MISMATCH`를 반환한다.

각 version 파일은 immutable하다. 수정이 필요하면 기존 파일을 덮어쓰지 않고 다음
`draft_version` 파일을 생성한다. Plan Leader의 verbatim persistence와 final envelope
조립은 specialist 판단의 재작성으로 간주하지 않지만, 요약·문구 수정·누락 보완을
원문 안에 적용하는 것은 금지한다.

Plan Leader는 handoff 저장 전후의 workspace 상태를 확인하고 현재 run의
`.csx/handoffs/<run-id>/`와 기존 최종 plan artifact 밖에 새 변경이 생기면
`BLOCKED_UNAUTHORIZED_WRITE`로 중단한다. 하나의 run에는 하나의 handoff writer만
존재하며 Leader session을 교체할 때는 기존 writer session을 종료한 뒤 새 session이
시작된다. 이 순서는 orchestration에서 보장하고 handoff에는 이전 session
종료와 successor를 provenance로만 기록한다. Planner, Architect와 Critic은 계속
read-only다.

현재 agent sandbox에는 path별 write allowlist가 없으므로 두 Leader에는 일반 write
권한을 부여하고 prompt 계약으로 쓰기 범위를 제한한다. Plan Leader prompt는
`.csx/handoffs/<run-id>/`와 최종 `.csx/plans/<slug>-pro.md`만 직접 쓸 수 있고,
Start-Goal Leader prompt는 현재 `.csx/goals/<slug>.md` control artifact만 직접 쓸 수
있다고 명시한다. Start-Goal의 제품 소스 변경은 반드시 Executor assignment가
수행한다. Leader가 허용 경로 밖 직접 쓰기가 필요하다고 판단하면 쓰지 않고
`BLOCKED_UNAUTHORIZED_WRITE_SCOPE`를 반환한다. 쓰기 전후 workspace 상태를 비교해
허용되지 않은 Leader 직접 변경이 관찰되면 성공 판정을 금지한다.

### 9. Root, Plan Leader와 Start-Goal Leader의 책임을 분리한다

단계별 ownership은 다음과 같다.

```text
Root
├── Spec Interview, accepted spec, 사용자 결정 ledger
├── Plan Leader
│   └── Planner(goal decomposition 포함) → Architect → Critic → bounded revision
└── Start-Goal Leader
    └── approved goal intake → implementation → targeted verification
        → goal-scoped deslop/checkpoint → integrated/full test
        → code/architecture review → bounded rework
        → final verification → completion
```

- Root는 사용자와 직접 spec을 잠그고 public behavior, scope, non-goal, support
  boundary, 비가역적 선택에 대한 최종 authority를 유지한다. Spec Leader를 별도로
  두지 않는다.
- Plan Leader는 accepted spec을 입력으로 plan run 전체를 조율한다. Root가 Plan
  Leader 역할을 겸하지 않는다.
- Start-Goal Leader는 `csx-start-goal` 이후의 구현·검증·리뷰 lifecycle을 하나의
  논리적 owner로 관리한다. 각 pass마다 별도 상위 Leader를 추가하지 않는다.
- Logical Leader와 Leader session을 구분한다. session이 교체돼도 run ID, accepted
  scope, ledger, 현재 phase와 완료 authority는 같은 Logical Leader lifecycle에
  남는다.
- Plan Leader와 Start-Goal Leader는 user-owned decision을 대신 결정하지 않는다.
  결정이 필요하면 선택지, scope/acceptance 영향, 추천안, 미결정 시 중단 지점을
  포함한 bounded Decision Packet을 Root에 반환한다.
- Root는 Decision Packet을 사용자에게 묻고 확정 결과만 accepted spec 또는 decision
  ledger에 기록해 Leader에게 artifact path와 digest로 돌려준다. 세부 specialist
  transcript를 Root context로 중계하지 않는다.
- Plan Leader와 Start-Goal Leader는 별도 model role을 만들지 않고 `csx setup`의
  기존 top-level `LEADER` model과 reasoning effort를 상속한다. 두 Leader agent
  TOML에는 `model`과 `model_reasoning_effort`를 고정하지 않는다.
- `csx setup`의 role matrix, preset 형식과 TUI에는 기존 8개 역할만 유지한다.
  `LEADER`를 변경하면 Root, Plan Leader와 Start-Goal Leader의 effective model
  설정이 함께 바뀐다.

### 10. Context 사용률에 따라 Leader session을 선제 교체한다

Context compaction은 Leader 교체의 선행조건이 아니다. 발생했다면 교체가 늦었다는
신호이므로 다음 작업 단위를 시작하기 전에 반드시 새 Leader session으로 교체한다.

Runtime이 모델별 context window와 직전 호출 token usage를 제공하면 다음 값을
사용한다.

```text
context_usage_ratio =
  last_token_usage.input_tokens / model_context_window
```

Cached input도 실제 context window를 차지하므로 분자에서 빼지 않는다. 이 값은 보통
한 model call이 끝난 뒤 알 수 있으므로, 생성 도중이 아니라 다음 Planner, Executor,
review 또는 rework 단위를 시작하기 전에 판정한다.

| 사용률 | 동작 |
|---:|---|
| `< 35%` | 현재 Leader session을 계속 사용한다. |
| `35% 이상, 50% 미만` | 최신 checkpoint, ledger, artifact digest와 다음 action을 handoff에 확정한다. |
| `50% 이상` | 현재 단위를 닫고 `fork_turns: "none"`인 새 Leader session으로 교체한다. |
| compaction 발생 | 사용률과 무관하게 handoff를 검증한 뒤 즉시 교체한다. |

Runtime이 두 지표 중 하나라도 제공하지 않으면 비율을 추정해 꾸미지 않고 다음 fallback
trigger를 사용한다.

- Plan review가 2 cycle을 완료했다.
- Start-Goal revision/rework pass가 10회에 도달했다.
- 같은 Leader session의 실행 시간이 90분에 도달했다.
- context compaction이 관찰됐다.
- 다음 agent message에 8 KiB 초과 원문을 다시 포함해야만 진행할 수 있다.

새 session은 transcript를 fork하지 않고 다음 최소 artifact를 직접 읽는다.

- accepted spec path와 digest
- 현재 plan 또는 goal state path와 digest
- stable blocker/finding ledger
- 완료된 acceptance criteria와 남은 criteria
- scope fence와 명시적 non-goal
- 현재 phase, 다음 단일 action, 미해결 Decision Packet
- 이전 Leader session 종료와 successor provenance

Leader 교체만으로 새 사용자-visible top-level thread를 만들지 않는다. 새 thread는
다음 중 하나일 때만 Root가 사용자에게 제안한다.

- Root 자체가 compaction 이후 사용자 결정·비범위의 원문 충실도를 복구할 수 없다.
- accepted spec이 기존 goal의 revision이 아니라 사실상 새 프로젝트가 될 만큼
  변경됐다.
- Root context에 세부 구현·specialist 원문이 누적되어 bounded Decision Packet만으로
  분리할 수 없다.
- 서로 다른 goal의 상태가 섞여 잘못된 authority를 적용할 위험이 있다.
- runtime 제약으로 transcript를 상속하지 않는 새 내부 Leader session을 만들 수 없다.

이 절차는 일반 Leader rotation이 아니라 현재 Root를 새 Root session으로 교체하는
`Root Replacement Protocol`이다. Leader는 사용자에게 직접 새 thread를 제안하거나
생성하지 않고 다음 bounded packet을 Root에 반환한다.

```yaml
status: ROOT_REPLACEMENT_RECOMMENDED
reason: ROOT_DECISION_FIDELITY_LOST | PROJECT_IDENTITY_CHANGED |
  UNBOUNDED_TRANSCRIPT_ACCUMULATION | MIXED_GOAL_AUTHORITY |
  INTERNAL_SUCCESSOR_UNAVAILABLE
resume:
  accepted_spec_path: <path>
  accepted_spec_sha256: <digest>
  current_artifact_path: <path>
  current_artifact_sha256: <digest>
  current_phase: <phase>
  next_action: <one bounded action>
  open_findings: []
  unresolved_user_decisions: []
```

현재 Root만 이 교체를 사용자에게 제안하며 사용자 또는 제품이 새 top-level thread를
생성한다. 새 Root는 전체 transcript가 아니라 검증된 artifact에서 authority를
복구한다.

Plan Leader 또는 Start-Goal Leader의 context 증가만으로는 새 top-level thread를
요구하지 않는다.

### 11. Planner가 goal을 분할하고 Start-Goal Leader가 집행한다

Goal 구조를 새로 설계하는 책임은 Planner에게 둔다. Planner는 accepted plan의
acceptance criteria, 파일 ownership, 상태·migration 경계와 rollback 단위를 기준으로
실행 goal을 분할한다. Start-Goal Leader는 승인된 goal 구조를 다시 설계하지 않고
각 goal을 scope fence가 있는 Executor assignment로 구체화해 실행한다.

Goal 수는 강제 상한이 아니라 다음 complexity budget으로 관리한다.

| 작업 유형 | 기본 goal budget |
|---|---:|
| 일반 작업 | 5개 이하 |
| 대형 또는 고위험 작업 | 10개 이하 |

예산을 초과해도 자동 실패시키지 않지만, Planner는 각 추가 goal이 독립적인 ownership,
검증 또는 rollback 경계를 가져야 하는 이유를 계획에 기록한다. 같은 파일, 같은 상태
머신 또는 같은 migration 경계를 순차적으로 반복 수정하는 항목은 가능한 한 하나의
vertical slice로 묶는다. 반대로 독립 안전 경계를 억지로 합쳐 ownership이나 rollback
가능성을 약화시키지 않는다.

### 12. 테스트 통과 뒤에 code review를 시작한다

Code review가 테스트보다 비싼 실행 특성을 반영해 다음 순서를 기본으로 한다.

```text
Executor focused test
    → 통합·정적 검사
    → full suite
    → code/architecture review
    → finding 일괄 수정
    → 영향 범위 focused test
    → 코드가 바뀐 경우 최종 full suite
```

- 테스트가 실패한 변경은 원칙적으로 Code Reviewer에게 보내지 않는다.
- 최초 full suite 통과 뒤 review 수정이 없으면 전체 테스트는 1회로 끝낸다.
- Review finding 수정으로 코드가 바뀌면 이전 결과가 최종 상태를 증명하지 못하므로
  영향 범위 테스트 뒤 full suite를 한 번 더 실행한다.
- 전체 테스트는 정상 경로에서 1회, review 수정이 발생한 경우 최대 2회다.
- Finding은 하나씩 수정하지 않고 invariant family별로 모아 한 rework 단위에서
  처리한다.
- 문서·설정 변경처럼 full suite가 acceptance evidence에 필요하지 않으면 Planner가
  지정한 영향 범위 검사로 대체할 수 있다.
- Code Reviewer는 full suite를 다시 실행하지 않는다. 구체적인 finding을 확인하기
  위한 1~3개의 focused reproduction만 허용한다.

### 13. Deslop은 production-code goal마다 최대 한 번 실행한다

`csx-start-goal`은 통합 변경 전체를 한 번에 Deslop에 전달하지 않는다. 각 approved
goal이 focused test를 통과한 뒤 goal checkpoint를 닫기 전에 다음 gate를 적용한다.

1. Production code가 바뀌지 않았으면 `DESLOP_NOT_APPLICABLE`을 기록한다.
2. 변경 코드가 이미 간결하고, 목적을 한 문장으로 명확히 설명할 수 있으며, 중복,
   dead code, 불필요한 abstraction 또는 cleanup finding이 없으면
   `DESLOP_SKIPPED_CONCISE_GOAL`과 생략 근거를 기록한다.
3. 그 외 production-code goal은 `$csx-deslop`을 정확히 한 번 실행하고
   `DESLOP_COMPLETED`를 기록한 뒤 영향 범위 focused regression test를 실행한다.

Deslop assignment에는 현재 `goal_id`, 한 문장 outcome, goal-owned changed path, 직접
영향받는 helper/interface, focused test와 non-goal만 전달한다. 이전 goal transcript나
통합 전체 diff를 전달하지 않는다. Deslop은 공개 동작, schema, 권한, reliability
또는 지원 범위를 바꿀 수 없다.

최종 cumulative review가 cross-goal 중복이나 정리 위험을 발견하면 해당 path만 포함한
invariant-family rework로 처리한다. 최종 통합 Deslop이나 이미 처리한 goal의 두 번째
Deslop은 실행하지 않는다. Goal-scoped Deslop은 최초 full suite 전에 완료되므로
review 이후 최종 full-suite allowance를 소비하지 않는다.

### 14. 대기, timeout과 재시도에는 반복 상한을 둔다

Leader는 완료 여부를 확인하기 위한 짧은 polling을 반복하지 않는다. Assignment마다
작업 성격에 맞는 예상 시간과 hard timeout을 정하고, 가능한 한 하나의 충분한 wait를
사용한다.

- Timeout까지 진행 신호가 없으면 상태 확인은 한 번만 한다.
- 계속 진전이 없으면 해당 agent를 종료하고 새 agent로 교체한다.
- 교체 agent에는 transcript가 아니라 현재 artifact path와 digest, 완료된 작업,
  미해결 finding 및 다음 단일 action만 전달한다.
- 같은 원인의 도구 호출 실패는 원인을 반영해 인수를 수정한 뒤 한 번만 재시도한다.
- 두 번째 동일 실패부터는 원인을 해결하기 전 반복하지 않고 구조화된 blocker로
  반환한다.

Timeout은 모든 작업에 같은 값으로 고정하지 않는다. 장기 build나 test처럼 정상적으로
오래 걸리는 작업은 assignment에 더 긴 근거 있는 timeout을 지정한다.

### 15. 역할별 message budget과 read-only 권한을 분리한다

Message budget은 context 점유량을 제한하는 soft limit이며 파일 쓰기 권한이 아니다.
Planner, Architect, Critic과 Code Reviewer는 계속 read-only로 유지하고, Plan Leader
또는 Start-Goal Leader가 허용된 artifact의 단일 writer가 된다.

| 역할·응답 | 기본 soft limit |
|---|---:|
| Explorer·Analyst | 2 KiB |
| Planner 상태 보고 | 2 KiB |
| Architect·Critic·Code Reviewer | 4 KiB |
| Executor 완료 보고 | 4 KiB |

전체 계획 draft, accepted spec, evidence와 테스트 원문은 이 표의 크기 제한 대상이
아니며 versioned artifact에 저장한다. Read-only specialist는 결론, finding ID,
근거 위치, 수정 조건과 다음 행동을 message에 반환하고 Plan Leader는 필요한 원문을
정확히 한 번 verbatim 저장한다. Material finding을 누락해야만 limit을 지킬 수
있다면 limit 초과를 허용하고 이유를 표시한다.

Soft limit을 이유로 specialist에게 일반 workspace 쓰기 권한을 부여하지 않는다.
Runtime이 특정 handoff 경로에 create-only 권한을 제공하지 않는 현재 구조에서는
Leader의 단일 writer 계약을 유지한다. 대형 파일, diff와 테스트 로그는 message에
붙이지 않고 기존 파일 경로 또는 Leader가 저장한 artifact path로 참조한다.

## 리뷰 흐름

```text
Planner draft N
    |
    v
Plan Leader persists draft-vNNN.md + digest
    |
    v
Architect review N
    |-- BLOCK --> Architect Revision Brief --> Planner draft N+1
    |
    `-- CLEAR (+ optional Watch Items)
           |
           v
       Critic review N
           |-- REVISE/BLOCKED --> Critic Revision Brief --> Planner draft N+1
           |
           `-- APPROVED --> consensus
```

- 모든 새 draft는 Architect부터 검토한다.
- Architect가 `BLOCK`이면 해당 cycle의 Critic은 호출하지 않는다.
- Architect가 `CLEAR`한 동일 `draft_version`에 대해서만 Critic을 호출한다.
- `WATCH`는 blocking verdict로 사용하지 않는다. 비차단 관찰 사항은 `CLEAR`의
  `Watch Items`에 포함한다.
- Architect 미승인 cycle은 Review Ledger에
  `Critic: SKIPPED_ARCHITECT_NOT_CLEAR`로 기록한다.
- Architect와 Critic은 각자 발견한 blocker에 대한 Revision Brief를 직접 작성한다.
  Plan Leader는 specialist 판단을 대신 합성하지 않는다.
- Architect와 Critic은 원문 청크가 아니라 versioned artifact path와 digest를 읽는다.
- Plan Leader는 specialist 원문을 정확히 한 번 저장하고 Root에는 bounded summary나
  Decision Packet만 반환한다.
- 수정된 draft는 이전 승인을 상속하지 않으며 Architect부터 다시 시작한다.
- 다섯 번째 cycle도 같은 흐름을 적용하고 합의하지 못하면 최선의 draft, 미해결
  blocker, Review Ledger를 포함한 `BLOCKED` artifact를 반환한다.

## Finding 분류

모든 material finding은 정확히 다음 세 종류 중 하나여야 한다.

각 finding은 다음 필드를 반드시 포함한다.

```yaml
finding_id: F001
classification: accepted-scope-defect | change-induced-risk | optional-hardening
scope_authority: AC7 | CONSTRAINT:C3 | NON_GOAL:N2 | REGRESSION:<invariant> | null
affected_boundary: <module, data, permission, migration, or execution boundary>
reachable_scenario: <구체적인 실행 또는 실패 경로>
evidence: <파일, 심볼, 테스트 또는 artifact>
plan_time_decision: <구현 전에 반드시 잠가야 하는 결정>
minimal_fix: <가장 작은 범위 보존 수정>
scope_delta: none | requires-user-decision
```

`accepted-scope-defect`는 accepted spec의 안정적인 authority ID와 연결해야 한다.
`change-induced-risk`는 변경 전 보존되던 baseline invariant와 이 draft가 그 invariant를
깨는 구체적인 인과관계를 `REGRESSION:<invariant>`로 기록해야 한다. 둘 다 제공할 수
없으면 `optional-hardening` 또는 implementation note로 낮춘다.

### `accepted-scope-defect`

Accepted requirement, constraint, non-goal, support boundary, acceptance criterion 또는
user-confirmed decision과 충돌한다.

- blocker 후보가 될 수 있다.
- 어떤 scope 항목과 충돌하는지 직접 연결해야 한다.

### `change-induced-risk`

계획된 변경이 직접 만드는 보안, 권한, 데이터 무결성, 복구, 호환성 또는 회귀
위험이다.

- blocker 후보가 될 수 있다.
- 영향받는 경계와 재현 가능한 실패 경로를 설명해야 한다.
- 변경과 인과관계가 없는 일반적인 위험은 포함하지 않는다.

### `optional-hardening`

Accepted scope를 충족하는 데 필수적이지 않은 새 기능, 미래 확장성, 더 넓은 지원,
가상의 환경·위협 또는 일반적인 품질 향상이다.

- blocker가 될 수 없다.
- 필요하면 non-blocking follow-up으로만 기록한다.
- `optional-hardening`만 존재하면 승인 verdict를 반환해야 한다.

## Blocker 성립 기준

Architect와 Critic의 blocking finding은 다음 네 조건을 모두 충족해야 한다.

1. **범위 권위가 있는 defect 또는 risk**
   `accepted-scope-defect` 또는 `change-induced-risk`로 분류되며, accepted spec의 AC,
   constraint, non-goal, support boundary 또는 변경 전 baseline invariant 중 하나를
   가리키는 non-null `scope_authority`에 안정적으로 연결된다.
2. **구체적인 근거와 도달 가능한 시나리오**
   evidence, 영향받는 경계, 도달 가능한 실패 조건과 결과를 구체적으로 설명할 수
   있다.
3. **계획 시점 필요성**
   구현 전에 결정하지 않으면 Executor가 공개 동작, 안전 경계, 책임 주체 또는
   비가역적 선택을 임의로 발명해야 한다.
4. **최소성**
   더 단순하고 범위 보존적이며 가역적인 대안으로 해결할 수 없다.

하나라도 충족하지 못하면 다음 중 하나로 낮춘다.

- `CLEAR`의 Watch Item
- 실행 단계의 implementation note
- optional follow-up

Revision Brief에는 다음 정보만 포함한다.

- 안정적인 blocker ID
- finding 분류
- scope authority ID 또는 baseline invariant
- change-induced failure path
- 왜 구현 전에 결정해야 하는지
- 가장 작은 수정 조건
- 제외한 더 복잡한 대안

## 수렴 규칙

### Blocker Ledger

각 blocker에는 최초 발견 cycle부터 유지되는 안정적인 ID를 부여한다. 다음 cycle의
review는 전체 설계를 처음부터 확장 검토하지 않고 아래에 집중한다.

- 기존 blocker의 해소 여부
- 수정으로 새로 생긴 회귀
- accepted scope 또는 결정 경계의 실제 변경

새 blocker를 추가하려면 다음을 함께 기록한다.

- 어떤 draft 변경으로 새 문제가 적용 가능해졌는지
- 기존 cycle에서 적용되지 않았거나 관찰할 수 없었던 이유
- 지금 계획 단계에서 차단해야 하는 이유

Draft 변경과 관계없는 새로운 관점이나 더 좋은 설계 아이디어는 blocker 추가 사유가
아니다.

### 반복 blocker 처리

같은 개념의 blocker가 수정 후에도 반복되면 새 메커니즘을 계속 추가하지 않는다.
Reviewer는 다음 순서로 수렴을 시도한다.

1. 요구사항을 만족하는 가장 단순한 설계로 축소한다.
2. 계획에 불필요한 구현 세부사항을 실행 단계로 이동한다.
3. blocker의 최소 수정 조건을 다시 명확히 한다.
4. 현재 accepted spec 안에서 해결할 수 없으면
   `INFEASIBLE_UNDER_CURRENT_SPEC`으로 기록한다.

사용자 결정은 공개 동작, 지원 범위, acceptance criterion 또는 비가역적 선택을
바꿔야만 해결되는 경우에만 요청한다.

## 역할 경계

### Spec과 Analyst

- `csx-spec`은 Round 0에서 outcome, artifact, surface, integration, constraint,
  non-goal과 tradeoff priority를 포함한 Intent Topology를 사용자에게 확인받는다.
- Root가 사용자 질문, 답변 확인과 spec 확정을 직접 수행하며 별도 Spec Leader를
  두지 않는다.
- Analyst는 active component별 7개 dimension score, 전체 ambiguity, hard gate,
  remaining gap과 가장 높은 우선순위의 다음 질문을 반환한다.
- Root는 `Quick` 기준을 처음 통과하면 `Quick에서 확정`, `Standard까지 계속`,
  `Strict까지 계속`을 묻고, `Standard` 도달 시 필요한 경우 `Standard에서 확정`과
  `Strict까지 계속`을 묻는다.
- 모드 임계값을 통과해도 material user-owned decision, 미결정 고위험 boundary,
  미해결 contradiction 또는 추적 불가능한 requirement가 있으면 readiness를
  승인하지 않는다.
- Material 자유서술 답변은 구조화된 decision과 비범위로 사용자에게 재확인한 뒤
  scoring과 accepted artifact에 반영한다.
- 선택한 모드의 기준을 통과한 뒤 closure audit과 한 문장 Intent Restate 확인을
  완료해야 최종 spec을 작성한다.
- `csx-spec`은 goal과 requirement뿐 아니라 기능별 신뢰성 등급, support boundary,
  non-goal, complexity budget을 accepted artifact에 고정한다.
- Analyst는 material 기능에 신뢰성 등급이나 지원 경계가 없으면 readiness를 승인하지
  않는다.
- Analyst는 저장소에서 발견한 가능한 환경을 모두 지원 범위로 승격하지 않는다.
- 신뢰성 등급을 높이거나 비범위를 지원 범위로 이동해야 하면 사용자 소유 결정으로
  반환한다.

### Architect

Architect는 다음을 검토한다.

- 책임과 소유권 경계
- 인터페이스와 데이터 흐름
- 결합과 순서 의존성
- 보안·권한·복구·호환성 불변식
- 비가역적 결정과 구조적 실행 가능성
- 계획의 복잡성이 accepted scope에 비례하는지

Architect는 구현 기법을 완성하거나 가능한 모든 실패를 사전에 설계하지 않는다.
`BLOCK`은 Blocker 성립 기준을 모두 만족할 때만 반환한다. 그 외 finding은
`CLEAR`의 Watch Item으로 남긴다.

### Critic

Critic은 Architect가 `CLEAR`한 계획을 대상으로 다음을 검토한다.

- acceptance criteria의 판정 가능성
- 단계 순서의 안전성과 실행 가능성
- 미해결된 사용자 소유 결정
- 실행 단계가 발명해야 하는 material decision
- 검증의 누락, 중복 또는 약한 증거
- accepted scope 대비 불필요한 복잡성

Critic은 Architect 역할을 반복하거나 새로운 architecture scope를 탐색하지 않는다.
구조적 결함이 실제 blocker 기준을 충족하면 `REVISE`하고, 다음 draft가 Architect부터
다시 검토되도록 한다.

### Planner, Plan Leader와 Root

- Planner는 Revision Brief의 최소 수정 조건만 반영하고 주변 범위를 함께 확장하지
  않는다.
- Planner는 각 material 기능의 신뢰성 등급과 complexity budget을 plan step,
  acceptance criteria 및 Verification Matrix에 보존한다.
- Planner는 실행 goal을 분할하고 일반 작업 5개, 대형·고위험 작업 10개의 기본
  complexity budget을 적용한다. 예산 초과에는 독립 ownership, 검증 또는 rollback
  경계의 근거를 기록하고 강하게 결합된 변경은 vertical slice로 묶는다.
- Planner는 draft 2부터 Scope Delta 표를 갱신하고 근거 없는 추가 항목을 plan body에
  넣지 않는다.
- Plan Leader는 verdict와 finding을 전달하고 plan ledger를 관리하지만 reviewer
  판단을 새로 만들거나 합성하지 않는다.
- Plan Leader는 run별 단일 handoff writer로서 Planner와 reviewer 원문을 versioned
  artifact에 verbatim 저장한다.
- Plan Leader는 8 KiB를 넘는 specialist 원문을 agent 간 메시지로 relay하지 않고
  path, version과 digest만 전달한다.
- Verbatim persistence와 final envelope 조립은 허용하지만 specialist 원문의
  의미·표현·판정을 수정하지 않는다.
- Specialist가 non-blocking으로 분류한 항목을 Plan Leader가 blocker로 승격하지
  않는다.
- Root는 Spec Interview, accepted spec과 user decision ledger를 직접 소유하며 Plan
  Leader의 세부 진행 context를 보유하지 않는다.
- Root는 `SCOPE_EXPANSION_REQUIRED`를 자동 승인하거나 새 실행 goal로 편입하지 않는다.

#### Accepted Constraint Envelope

Planner, Architect와 Critic assignment에는 다음 필드를 직접 포함한다.

```yaml
accepted_spec_path: .csx/specs/<slug>.md
accepted_spec_sha256: <digest>
reliability_class: durable | best-effort | advisory
complexity_budget:
  default_goal_budget: 5
  large_or_high_risk_goal_budget: 10
  additional_constraints:
    - <accepted limits>
```

기능별 reliability class가 다르면 안정적인 feature-to-class mapping을 그대로
전달한다. Plan Leader는 accepted authority에서 이 envelope를 복사하고, Planner는
draft에 보존하며, Architect와 Critic은 review 결과에 echo한 뒤 accepted spec과
비교한다. 필드 누락, spec digest 불일치, 근거 없는 더 강한 reliability mechanism
또는 complexity budget 초과는 기본값으로 추정하지 않고 구조화된 blocker로 처리한다.

### Start-Goal Leader와 Executor

- Start-Goal Leader는 Planner가 분할한 approved goal을 인수하고, 구조를 다시
  설계하지 않은 채 파일 소유권, 담당 criterion, invariant, 허용 의존성 및 금지
  범위를 각 Executor assignment에 구체화한다.
- Start-Goal Leader는 승인된 goal의 구현, targeted verification, goal-scoped
  Deslop, 통합·정적 검사, full suite, code/architecture review, bounded finding
  rework, 최종 검증과 완료 판정을 하나의 lifecycle로 소유한다.
- Start-Goal Leader는 focused test와 최초 full suite가 통과한 뒤에만 Code Reviewer를
  호출한다. Review 수정이 없으면 full suite 1회로 끝내고 코드가 바뀌면 영향 범위
  테스트 뒤 최종 full suite를 한 번 추가한다.
- Start-Goal Leader는 production code를 변경한 goal마다 focused test 이후
  goal-scoped Deslop gate를 적용한다. 간결하고 목적을 한 문장으로 설명할 수 있는
  goal만 근거와 함께 생략하며, 그 외 goal은 각각 최대 한 번 실행한다.
- Goal별 Deslop assignment에는 해당 goal의 changed path와 직접 영향 경계만 전달하며,
  최종 cumulative review의 cross-goal cleanup은 별도 bounded rework로 처리한다.
- Start-Goal Leader는 agent 대기와 동일 원인 재시도 상한을 적용하고 교체가 필요하면
  transcript 대신 검증된 artifact로 후속 agent를 시작한다.
- Executor는 assignment의 파일·criterion 경계 안에서만 구현한다.
- Executor는 자신의 변경 범위에 대한 focused test를 실행하고 결과를 완료 보고에
  포함한다.
- 구현 중 발견한 범위 확장은 `SCOPE_EXPANSION_REQUIRED`로 반환하며 인접 기능까지
  함께 구현하지 않는다.
- 국소적이고 가역적인 구현 선택은 Executor가 결정할 수 있지만, public behavior,
  persisted schema, 권한 주체, 지원 환경 또는 비가역적 선택은 발명할 수 없다.

### Code Reviewer와 Start-Goal Leader

- Code Reviewer는 finding마다 위반된 invariant와 동일 invariant를 공유하는 관련
  producer·consumer를 식별한다.
- Start-Goal Leader는 별도 Review Leader를 만들지 않고 중복 없는 bounded sweep
  범위를 구성해 Code Reviewer와 필요한 Architect lane에 같은 invariant family를
  전달한다.
- Code Reviewer는 `inspected_paths`와 미검사 경계를 명시하고, 같은 invariant의
  후속 finding에는 이전에 발견할 수 없었던 이유를 기록한다.
- Code Reviewer는 green test baseline 이후에만 시작하며 full suite를 반복하지
  않는다. 필요한 경우 finding 확인을 위한 1~3개의 focused reproduction만 수행한다.
- Architect는 코드 리뷰에서 권한, 데이터, migration, recovery 경계를 확인하되
  이미 승인된 plan의 새로운 architecture 대안을 탐색하지 않는다.
- 선택적 리팩터링, 새로운 환경 지원, 일반적인 hardening은 non-blocking follow-up으로
  남긴다.

## 수정 대상

### `payload/skills/csx-spec/SKILL.md`

- Round 0 Intent Topology Lock과 stable category-prefixed ID를 추가한다.
- active component별 7차원 clarity scoring, ambiguity 계산과 비단조 재평가 규칙을
  추가한다.
- `Quick(0.20)`, `Standard(0.10)`, `Strict(0.05)` 모드와 단계별 사용자 선택을
  추가한다.
- 모드와 무관한 hard gate, closure audit 및 한 문장 Intent Restate를 추가한다.
- 질문을 가장 높은 `question_priority`의 material decision 하나로 제한하고 답변 후
  전체 score를 갱신한다.
- 첫 material 답변부터 compact draft checkpoint를 갱신하고 전체 transcript를
  반복 전달하지 않는다.
- 기능별 `durable`, `best-effort`, `advisory` 신뢰성 등급을 spec 필수 항목으로
  추가한다.
- support boundary, non-goal, 허용 손실·중복 및 complexity budget을 안정적인 ID와
  함께 기록한다.
- 신뢰성 등급을 변경하거나 비범위를 지원 범위로 옮기는 결정을 사용자 소유로
  분류한다.

### `payload/skills/csx-plan-pro/SKILL.md`

- Architect `CLEAR` 뒤에만 Critic을 호출하는 순차 게이트를 명시한다.
- `WATCH` blocking verdict를 제거하고 `CLEAR`의 `Watch Items`로 대체한다.
- Architect-owned 및 Critic-owned Revision Brief 경로를 분리한다.
- scope authority, plan sufficiency boundary, blocker 성립 기준을 추가한다.
- 모든 material finding에 공통 스키마와
  `accepted-scope-defect | change-induced-risk | optional-hardening` enum을 강제한다.
- `scope_authority`를 첫 blocker 조건에 명시적으로 결합하고 반복 blocker의 종료
  토큰을 `INFEASIBLE_UNDER_CURRENT_SPEC`으로 고정한다.
- stable Blocker Ledger, 새 blocker 등록 조건, 반복 blocker 수렴 규칙을 추가한다.
- accepted spec의 신뢰성 등급과 complexity budget을 Planner·Architect·Critic
  assignment에 그대로 전달한다.
- Accepted Constraint Envelope의 path, digest, reliability와 complexity 값을
  Architect와 Critic이 결과에 echo하고 spec과 비교한다.
- draft 2부터 Scope Delta 표를 의무화하고 근거 없는 범위 확장을 거부한다.
- 최대 5 cycle을 유지하며 2회차 자동 사용자 escalation 또는 cycle 축소를 도입하지
  않는다.
- Root와 분리된 Plan Leader를 run owner이자 단일 handoff writer로 명시한다.
- `.csx/handoffs/<run-id>/`의 immutable draft, Architect review, Critic review,
  Revision Brief와 bounded manifest 계약을 추가한다.
- 8 KiB를 초과하는 원문 relay와 `CHUNK`/`END`/`START` 중계를 금지하고 path,
  `draft_version`, SHA-256만 reviewer assignment에 전달한다.
- Artifact 누락 또는 digest 불일치는 chunk 재전송 없이 구조화된 blocker로
  종료한다.
- Verbatim persistence를 Plan Leader의 금지된 specialist rewrite와 구분하고, 최종
  `.csx/plans/<slug>-pro.md` envelope는 저장된 immutable 원문으로 조립한다.
- 다음과 같이 범위를 열 수 있는 모호한 revision 조건을 제거한다.

```text
an accepted material improvement requires revision
```

- cycle 5, loop handoff, finalization, material-change invalidation에도 동일한 조건부
  Critic 계약을 적용한다.
- model context window 대비 사용률과 fallback trigger를 다음 작업 단위 전에
  평가하고, 50% 이상 또는 compaction 발생 시 artifact 기반 새 Plan Leader
  session으로 교체한다.

### `payload/agents/csx-plan-leader.toml`

- Root와 분리된 plan run orchestration 역할을 추가한다.
- Planner·Architect·Critic과 달리 handoff 저장을 위해
  `sandbox_mode = "workspace-write"`인 역할로 두되, writer 범위를 현재 run
  artifact와 최종 plan envelope로 제한한다.
- `model`과 `model_reasoning_effort`를 지정하지 않아 top-level `LEADER` 설정을
  상속한다.
- Planner, Architect와 Critic을 순차 게이트로 호출하고 verdict, blocker와 Review
  Ledger를 관리한다.
- 현재 run의 `.csx/handoffs/<run-id>/`와 최종 plan envelope에만 writer 책임을
  사용하며 제품 소스를 수정하지 않는다.
- 허용 경로 밖 직접 쓰기가 필요하면 수정하지 않고
  `BLOCKED_UNAUTHORIZED_WRITE_SCOPE`를 반환하도록 prompt에 강제한다.
- Leader session 교체 시 checkpoint를 확정하고 이전 writer session을 종료한 뒤
  successor를 시작한다.
- user-owned decision은 해결하지 않고 bounded Decision Packet으로 Root에 반환한다.

### `payload/agents/csx-architect.toml`

- verdict를 `CLEAR`와 `BLOCK`으로 단순화한다.
- 비차단 finding은 `CLEAR`의 `Watch Items`로 반환한다.
- 공통 Finding 스키마, exact classification enum과 4조건 Blocker 기준을 적용한다.
- Accepted Constraint Envelope를 verify·echo하고 reliability/complexity 위반을
  직접 검토한다.
- Plan Sufficiency Boundary와 simplification-first 검사를 추가한다.
- `BLOCK`에는 최소 Architect Revision Brief와 blocker ID를 요구한다.
- Assignment의 draft path, version과 digest를 검증한 뒤 원문을 직접 읽으며,
  handoff 파일을 수정하거나 별도 relay를 시작하지 않는다.
- Review message는 4 KiB soft limit을 사용하고 verdict, finding ID, 근거 위치와
  최소 수정 조건에 집중하되 material blocker 누락이 필요하면 상한 초과를 허용한다.
- 일반 workspace write 권한을 추가하지 않고 Plan Leader가 review 원문을 verbatim
  저장하게 한다.
- 기존 architecture 검토 책임은 유지한다.

### `payload/agents/csx-critic.toml`

- 공통 Finding 스키마, exact classification enum과 4조건 Blocker 기준을 적용한다.
- Accepted Constraint Envelope를 verify·echo하고 reliability/complexity 위반을
  직접 검토한다.
- Architect 승인 뒤 actionability와 verification을 검토하는 역할 경계를 명시한다.
- `optional-hardening`은 non-blocking으로 제한한다.
- 새 architecture scope 탐색과 Architect 검토 반복을 금지한다.
- Draft와 Architect review의 path, version과 digest를 확인해 직접 읽고, 원문 누락을
  메시지 청크 요청으로 복구하지 않는다.
- Review message는 4 KiB soft limit을 사용하고 verdict, finding ID, 근거 위치와
  최소 수정 조건에 집중하되 material blocker 누락이 필요하면 상한 초과를 허용한다.
- 일반 workspace write 권한을 추가하지 않고 Plan Leader가 review 원문을 verbatim
  저장하게 한다.
- 기존 adversarial 검토 강도는 유지한다.

### `payload/agents/csx-analyst.toml`

- Round 0 Intent Topology 후보와 누락 위험을 반환한다.
- 각 active component의 7개 dimension score, 가중 ambiguity, hard gate 상태,
  trigger, remaining gap과 다음 question priority를 반환한다.
- contradiction, scope expansion과 unresolved dispute가 있으면 관련 score를 낮추고
  이전 결정을 삭제하지 않는다.
- material 자유서술 답변을 정해진 decision 구조로 정제하고 사용자 확인이 필요한
  부분을 표시한다.
- threshold를 통과해도 closure gap이 있으면 READY를 반환하지 않는다.
- material 기능에 신뢰성 등급, support boundary, non-goal 또는 complexity budget이
  누락되면 readiness gap으로 반환한다.
- 저장소에서 발견한 가능성을 accepted support로 자동 확대하지 않는다.
- Analyst message는 2 KiB soft limit을 사용하고 scoring, remaining gap, 근거 위치와
  다음 질문에 집중한다. 전체 transcript나 대형 소스 원문을 반복하지 않는다.

### `payload/agents/csx-explorer.toml`

- 탐색 결과 message는 2 KiB soft limit을 사용하고 결론, 관련 경로와 근거 위치에
  집중한다.
- 파일 원문, 대형 diff 또는 테스트 로그를 message에 붙이지 않고 workspace 경로로
  참조한다.
- Soft limit 때문에 일반 workspace write 권한을 추가하지 않는다.

### `payload/agents/csx-planner.toml`

- accepted spec의 신뢰성 등급과 complexity budget을 보존한다.
- Accepted Constraint Envelope를 verify·echo하고 누락 값을 추정하지 않는다.
- 실행 goal 분할 책임을 명시하고 일반 작업 5개, 대형·고위험 작업 10개를 기본
  complexity budget으로 적용한다.
- 예산 초과 goal에는 독립 ownership, 검증 또는 rollback 근거를 요구하고 같은 파일,
  상태 머신 또는 migration 경계의 강하게 결합된 변경은 vertical slice로 묶는다.
- draft 2부터 Scope Delta 표를 작성하고 각 추가 항목을 scope authority와 연결한다.
- Revision Brief의 최소 수정 밖으로 주변 설계를 확장하지 않는다.
- 이전 draft와 Revision Brief가 artifact로 제공되면 path와 digest를 확인해 직접
  읽고, 전체 원문을 다른 specialist에게 전달하는 courier 역할을 맡지 않는다.
- 상태 보고는 2 KiB soft limit을 사용하되 전체 plan draft에는 적용하지 않는다.

### `payload/skills/csx-start-goal/SKILL.md`

- Planner가 분할한 approved goal을 인수하고, Executor assignment에 파일 소유권,
  담당 criterion, invariant, 허용 의존성 및 금지 범위를 포함한다.
- Start-Goal Leader가 goal 구조를 다시 설계하지 않고 승인된 분할을 집행하도록 한다.
- `SCOPE_EXPANSION_REQUIRED` 결과 계약을 추가하고 자동 goal 편입을 금지한다.
- accepted reliability class보다 강한 구현 메커니즘을 임의로 추가하지 않는다.
- 하나의 Start-Goal Leader가 approved goal intake부터 구현, targeted verification,
  goal-scoped Deslop, 통합·정적 검사, full suite, code/architecture review를 포함한
  bounded rework, 최종 검증과 완료 판정까지 소유하게 한다.
- Focused test와 최초 full suite가 통과한 뒤 code review를 시작하고, review 수정이
  없으면 full suite 1회, 코드가 바뀌면 최종 1회를 추가해 최대 2회로 제한한다.
- Production code를 변경한 각 goal에서 focused test 뒤 Deslop gate를 적용하고,
  간결하며 목적을 한 문장으로 설명할 수 있는 변경만 근거와 함께 생략한다.
- Goal당 Deslop을 최대 한 번으로 제한하고 현재 goal path와 직접 영향 경계만 전달한다.
  Cross-goal cleanup은 최종 review의 bounded finding rework로 처리한다.
- 짧은 polling을 반복하지 않고 assignment별 timeout을 사용하며, 무응답 상태 확인
  1회 뒤에는 artifact 기반 교체를 수행한다.
- 같은 원인의 도구 호출은 원인을 반영한 1회 재시도 뒤 구조화된 blocker로 전환한다.
- 역할별 message soft limit을 적용하되 read-only specialist 권한은 변경하지 않는다.
- model context window 대비 사용률과 fallback trigger를 작업 단위 경계에서
  평가하고, 50% 이상 또는 compaction 발생 시 transcript 없이 artifact를 읽는 새
  Start-Goal Leader session으로 교체한다.

### `payload/agents/csx-start-goal-leader.toml`

- 실행 lifecycle의 단일 논리적 owner 역할과 phase transition 계약을 추가한다.
- 실행 checkpoint와 기존 goal handoff를 갱신할 수 있도록
  `sandbox_mode = "workspace-write"`인 역할로 두되, 제품 소스 구현은 Executor
  assignment를 통해 수행한다.
- `model`과 `model_reasoning_effort`를 지정하지 않아 top-level `LEADER` 설정을
  상속한다.
- accepted spec, plan, goal state, acceptance progress, finding ledger와 scope fence를
  artifact path와 digest로 복구한다.
- Planner가 승인한 goal 분할을 집행하고 임의로 goal 구조를 다시 설계하지 않는다.
- Executor, Code Reviewer와 필요한 Architect lane을 조율하되 별도 Execution
  Leader나 Review Leader를 중첩하지 않는다.
- 테스트 통과를 review 진입 조건으로 확인하고, review 수정 여부에 따라 전체 테스트
  1회 또는 최대 2회 계약을 집행한다.
- Goal-scoped Deslop gate, assignment timeout, 상태 확인 1회, 동일 원인 재시도
  1회와 artifact 기반 agent 교체를 조율한다.
- 현재 `.csx/goals/<slug>.md` 밖의 artifact나 제품 소스를 직접 수정하지 않고, 제품
  변경은 소유권이 명시된 Executor에게 맡기도록 prompt에 강제한다.
- scope나 public behavior 결정이 필요하면 구현하지 않고 Decision Packet을 Root에
  반환한다.

### Setup·install 역할 등록

- `lib/presets.js`의 setup matrix는 top-level `leader`와 기존 7개 configurable
  specialist만 유지한다. 새 Leader agent를 독립 setup role이나 preset 필드로
  추가하지 않는다.
- 설치·config 등록에 사용하는 agent 목록과 setup에서 모델을 덮어쓰는 configurable
  agent 목록을 분리한다.
- `csx install`은 `csx-plan-leader.toml`과 `csx-start-goal-leader.toml`을 receipt-owned
  payload로 설치하고 `[agents.csx-plan-leader]`,
  `[agents.csx-start-goal-leader]` config table을 등록한다.
- `csx setup`은 두 Leader TOML을 rewrite하지 않고 top-level `LEADER` 설정만
  변경한다. model/effort override가 없는 두 agent는 그 설정을 상속한다.
- 기존 preset과 receipt의 role matrix version은 유지한다. 설치 receipt의 managed
  file 목록과 설치 migration만 새 agent 파일 두 개를 포함하도록 갱신한다.

### `payload/agents/csx-executor.toml`

- 승인된 파일·criterion 경계 안에서만 구현한다.
- 변경 영역의 focused test를 실행하고 결과, 실패 원인과 남은 검증 의무를 4 KiB
  soft limit의 완료 보고에 포함한다.
- public behavior, persisted schema, 지원 환경 또는 권한 경계 확대가 필요하면
  수정하지 않고 `SCOPE_EXPANSION_REQUIRED`를 반환한다.

### `payload/skills/csx-code-review/SKILL.md`

- blocking finding마다 invariant family sweep을 요구한다.
- 모든 material finding에 공통 Finding 스키마와 exact classification enum을
  요구한다.
- stable finding ID, 관련 producer·consumer, 검사 경로와 미검사 경계를 유지한다.
- 같은 invariant의 후속 finding에는 draft delta 또는 이전 관찰 불가 사유를
  요구한다.
- 최초 full suite가 통과한 뒤 review를 시작하고 reviewer의 full suite 재실행을
  금지한다.
- Finding 확인에는 1~3개의 focused reproduction만 허용하고, related finding을 모아
  한 번의 bounded rework로 전달한다.

### `payload/agents/csx-code-reviewer.toml`

- 개별 증상만 보고하지 않고 동일 invariant의 관련 코드 경로를 bounded하게
  조사한다.
- 모든 material finding에 공통 Finding 스키마와 exact classification enum을
  적용한다.
- finding 결과에 `invariant`, `affected_producers`, `affected_consumers`,
  `inspected_paths`, `required_sweep`을 포함한다.
- 결과 message는 4 KiB soft limit을 사용하며 결론, finding ID, 근거 위치, 수정
  조건과 다음 행동에 집중한다. Material finding 누락이 필요한 경우에는 상한 초과를
  허용한다.
- 일반 workspace write 권한을 추가하지 않고 Plan Leader 또는 Start-Goal Leader의
  단일 artifact writer 계약을 사용한다.
- `optional-hardening`과 관련 없는 리팩터링은 merge blocker로 사용하지 않는다.

### 문서와 계약 테스트

- `README.md`에 Spec Interview 모드, ambiguity와 hard gate, 신뢰성 등급, 순차
  게이트, verdict 의미, blocker 자격, 단계별 Leader, context 기반 session rotation,
  두 Leader의 top-level `LEADER` 설정 상속, 실행 scope fence와 invariant-family
  review, Planner-owned goal decomposition, test-first review gate, goal-scoped Deslop,
  wait·retry 상한과 message soft limit을 설명한다.
- `test/skill-contract.test.js`에 다음 계약을 추가한다.
  - Round 0에서 Intent Topology와 사용자 confirmation이 scoring보다 먼저 발생한다.
  - active component별 7개 score와 가중 ambiguity 계산이 존재한다.
  - 상세한 component 하나가 불명확한 sibling의 점수를 가리지 않는다.
  - `Quick` 기준 통과 시 확정 또는 `Standard`·`Strict` 계속 선택을 묻는다.
  - `Standard`를 선택한 사용자는 기준 통과 뒤 확정 또는 `Strict` 계속을 선택할 수
    있다.
  - 사용자가 이미 `Strict`를 선택하면 Standard 경계에서 같은 질문을 반복하지 않는다.
  - 어느 모드에서도 공통 hard gate를 우회해 READY가 될 수 없다.
  - contradiction과 scope expansion은 관련 ambiguity를 높이고 disputed decision을
    보존한다.
  - closure와 Intent Restate 확인 전에는 최종 spec을 쓰지 않는다.
  - material requirement와 acceptance criterion의 intent traceability가 100%다.
  - compact draft가 전체 transcript 대신 confirmed decision과 remaining gap을
    보존한다.
  - accepted spec이 기능별 reliability class와 complexity budget을 포함한다.
  - Architect `CLEAR`일 때만 Critic을 호출한다.
  - Architect `BLOCK`이면 Critic 상태가
    `SKIPPED_ARCHITECT_NOT_CLEAR`로 기록된다.
  - `WATCH`는 verdict가 아니라 `CLEAR`의 비차단 항목이다.
  - 각 blocking finding은 네 가지 blocker 조건, stable ID와 non-null
    `scope_authority`를 포함한다.
  - 모든 material finding은 공통 스키마와 exact classification enum을 사용한다.
  - `optional-hardening`은 revision blocker가 아니다.
  - 새 blocker는 draft delta와 신규 적용 사유를 포함한다.
  - 반복 blocker는 단순화 또는 정확한 `INFEASIBLE_UNDER_CURRENT_SPEC` 판정으로
    수렴한다.
  - Architect 및 Critic Revision Brief의 소유권이 분리된다.
  - 최대 5 cycle과 same-version consensus가 유지된다.
  - draft 2부터 Scope Delta와 scope authority 연결이 존재한다.
  - Executor가 범위 확대를 구현하지 않고 `SCOPE_EXPANSION_REQUIRED`를 반환한다.
  - code review finding이 invariant family와 inspected path를 포함한다.
  - 같은 invariant의 후속 finding이 신규 적용 사유를 포함한다.
  - 모호한 material-improvement revision 문구가 존재하지 않는다.
  - Planner, Architect와 Critic은 read-only를 유지하고 active Plan Leader만 run별
    handoff artifact를 쓴다.
  - 8 KiB 초과 원문은 agent message로 relay되지 않고 artifact path와 digest로
    전달된다.
  - immutable handoff version, digest mismatch, missing artifact와 unauthorized
    write 결과가 계약대로 처리된다.
  - Root가 Spec Interview와 user decision authority를 직접 소유하고 Plan Leader를
    겸하지 않는다.
  - Planner가 일반 작업 5개, 대형·고위험 작업 10개의 기본 budget으로 goal을
    분할하고 초과분에는 독립 경계 근거를 남긴다.
  - 같은 파일·상태 머신·migration 경계의 강결합 변경은 vertical slice로 묶인다.
  - Start-Goal Leader 하나가 approved goal intake부터 검증·리뷰·bounded rework까지
    소유하며 goal을 다시 설계하거나 별도 Execution/Review Leader를 중첩하지 않는다.
  - Focused test, 통합·정적 검사와 최초 full suite 통과 전에는 Code Reviewer를
    호출하지 않는다.
  - Review 수정이 없으면 full suite 1회, 코드가 바뀌면 최종 1회를 추가해 최대
    2회다.
  - Production-code goal마다 goal-scoped Deslop gate를 적용하고 세 구조화 상태 중
    하나를 기록한다.
  - Goal당 Deslop은 최대 한 번이며 현재 goal path와 직접 영향 경계만 전달한다.
  - Root replacement 추천과 일반 Leader rotation이 구분되며 Leader가 새 thread를
    직접 생성하거나 사용자에게 제안하지 않는다.
  - Timeout 뒤 상태 확인과 동일 원인의 도구 재시도는 각각 한 번으로 제한하고,
    교체 agent는 transcript 대신 artifact를 읽는다.
  - 역할별 soft output budget을 적용하되 material finding을 누락하지 않고
    specialist read-only 계약을 유지한다.
  - 두 Leader TOML에 model/effort override가 없고 top-level `LEADER` 설정을
    상속한다.
  - 두 Leader TOML은 `sandbox_mode = "workspace-write"`이며 specialist의
    `read-only` 계약은 바뀌지 않는다.
  - `csx setup`의 role matrix, preset과 TUI는 기존 8개 역할을 유지하며 `LEADER`
    변경이 Root와 두 Leader agent에 함께 적용된다.
  - `csx install`이 두 Leader agent 파일과 config table을 설치·등록하고 receipt가
    두 파일을 소유한다.
  - `csx setup`이 specialist role 변경 시 두 Leader TOML을 rewrite하지 않고,
    `LEADER` 변경 시 top-level config만 갱신한다.
  - 두 Leader prompt가 각자의 허용 artifact 밖 직접 쓰기를 금지하고 위반 필요 시
    `BLOCKED_UNAUTHORIZED_WRITE_SCOPE`를 반환한다.
  - context 사용률 35%에서 handoff를 준비하고 50%에서 session을 교체한다.
  - compaction이 교체 선행조건이 아니며, 발생한 경우 즉시 교체 trigger가 된다.
  - runtime token 지표가 없으면 cycle/pass/time/message-size fallback을 사용한다.
  - Leader session 교체는 `fork_turns: "none"`과 artifact 복구를 사용하며 이전
    writer가 종료되기 전에 successor writer가 시작되지 않는다.
  - Leader context 증가만으로 사용자-visible 새 top-level thread를 만들지 않는다.
- package와 설치 payload가 변경된 계약을 동일하게 포함하는지 확인한다.

## 비범위

- `deep-interview`의 전체 workflow 또는 100-round 계약을 그대로 이식하는 것
- Spec Interview에서 milestone별 lateral reviewer panel을 추가하는 것
- 모든 작업에 ontology convergence, auto-answer 또는 암호학적 intent manifest를
  요구하는 것
- 전체 인터뷰 transcript를 매 Analyst 호출이나 최종 spec에 반복 포함하는 것
- `csx-plan`의 일반 Critic-only 흐름
- Critic 역할의 삭제 또는 단순 pass/fail checker화
- 최대 review cycle 축소
- 두 번째 cycle 이후 자동 사용자 escalation
- accepted requirement의 `optional-hardening` 재분류
- 단계별 Leader를 별도 daemon, service 또는 새로운 runtime 영속 상태 스키마로
  구현하는 것
- Root와 사용자 사이에 별도 Spec Leader를 추가하는 것
- phase 또는 Leader session 교체마다 사용자-visible 새 top-level thread를 만드는 것
- Handoff artifact를 runtime state, hook 입력, workflow 완료 authority 또는 별도
  서비스로 사용하는 것
- Planner, Architect, Critic에게 일반 workspace 쓰기 권한을 부여하는 것
- Message soft limit을 지키기 위해 read-only specialist에게 쓰기 권한을 부여하는 것
- 원문 전달을 위해 새 agent-to-agent chunk protocol을 만드는 것
- `csx-deslop` 자체의 일반 계약을 확대하거나 모든 작업에 강제하는 것
- 특정 기술 스택이나 저장·복구 구현 방식의 표준화
- `csx-code-review`의 독립 reviewer 삭제 또는 reviewer 수 확대
- 모든 finding에 무제한 전수 조사를 요구하는 것
- accepted plan 밖의 파일·criterion을 자동으로 실행 goal에 편입하는 것

## 검증

### 정적·패키지 검사

1. `node --test test/skill-contract.test.js`
2. `npm test`
3. `npm run check`
4. `npm pack --dry-run`

### 행동 시나리오

- Round 0에서 여러 상위 component가 발견되면 사용자가 topology를 확인하기 전에는
  scoring이나 일반 질문을 시작하지 않는다.
- 한 component가 상세하고 sibling component가 모호하면 최솟값 집계로 sibling의
  gap이 전체 ambiguity에 반영된다.
- `Quick` 기준과 hard gate를 충족하면 자동 확정하지 않고 `Quick에서 확정`,
  `Standard까지 계속`, `Strict까지 계속`을 묻는다.
- 사용자가 `Standard`를 선택해 기준에 도달하면 `Standard에서 확정` 또는
  `Strict까지 계속`을 묻는다.
- 사용자가 `Strict`를 미리 선택했다면 Standard 경계에서 불필요한 확인을 반복하지
  않고 Strict 기준까지 계속한다.
- Quick ambiguity를 통과해도 고위험 support boundary가 미결정이면 확정 선택을
  제시하지 않고 해당 boundary 질문을 계속한다.
- 사용자 답변이 새 integration이나 support environment를 추가하면 Scope score와
  ambiguity를 다시 계산하고 topology delta를 사용자 authority와 연결한다.
- 사용자가 기존 결정과 충돌하는 답변을 하면 이전 결정을 삭제하지 않고
  `disputed`와 `superseded_by` 이력을 남긴다.
- threshold 통과 후 closure에서 locked topology ID 또는 acceptance criterion 누락을
  발견하면 최종 spec을 쓰지 않고 가장 영향이 큰 질문으로 돌아간다.
- 한 문장 Intent Restate를 사용자가 수정하면 scoring과 closure를 다시 수행한다.
- `best-effort` diagnostics에 reviewer가 WAL 또는 정확한 pairing을 요구하면 accepted
  AC가 없는 한 `optional-hardening`으로 분류된다.
- `durable` state restoration의 authority 또는 old-or-new invariant가 빠지면
  `accepted-scope-defect` blocker로 유지된다.
- draft 2에 추가된 모든 material 항목이 Scope Delta에서 사용자 결정, spec authority,
  AC 또는 `change-induced-risk`의 `REGRESSION:<invariant>`와 연결된다.
- 근거 없는 새 환경·상태·migration 경로는 draft에서 제외되고 Watch Item으로
  이동한다.
- Architect blocker가 존재하면 Critic 호출 없이 Planner revision으로 이동한다.
- 비차단 finding만 존재하면 Architect는 `CLEAR`와 Watch Items를 반환한다.
- Architect 승인 뒤 Critic이 실행 가능성 blocker를 발견하면 다음 draft는
  Architect부터 다시 시작한다.
- 두 reviewer가 동일 version을 승인하면 consensus로 완료한다.
- `optional-hardening`만 존재하면 어느 reviewer도 revision을 요구하지 않는다.
- 기존 blocker를 수정한 다음 review는 closure, regression, boundary delta에
  집중한다.
- 새 blocker는 draft delta와 신규 적용 사유가 없으면 등록되지 않는다.
- 같은 blocker가 반복되면 설계 단순화, 세부사항 위임 또는 infeasibility 판정으로
  수렴한다.
- cycle 5에서도 같은 규칙을 사용하고 미합의 시 완전한 BLOCKED artifact를 남긴다.
- 8 KiB를 넘는 Planner draft를 Architect와 Critic이 메시지 청크 없이 handoff
  artifact에서 직접 읽고 같은 digest를 검토한다.
- Architect 결과가 저장된 뒤 Critic은 draft와 Architect review path만 전달받으며,
  Root에는 bounded verdict summary나 Decision Packet만 반환된다.
- Handoff 파일이 없거나 digest가 다르면 reviewer는 원문 재전송을 요구하지 않고
  정해진 artifact blocker를 반환한다.
- Reviewer가 handoff 또는 소스 파일 쓰기를 시도하거나 Plan Leader가 허용 경로 밖
  변경을 발견하면 `BLOCKED_UNAUTHORIZED_WRITE`로 중단한다.
- Executor가 허용되지 않은 파일이나 criterion 변경 필요성을 발견하면 파일을
  수정하지 않고 `SCOPE_EXPANSION_REQUIRED`를 반환한다.
- Planner가 일반 작업을 5개 이하의 goal로 분할하고 대형·고위험 작업이 10개를
  초과하면 각 초과 goal의 독립 ownership, 검증 또는 rollback 근거를 기록한다.
- 같은 상태 머신을 순차 수정하는 여러 계획 step은 별도 goal로 증식하지 않고
  vertical slice로 묶이며 Start-Goal Leader는 승인된 분할을 다시 설계하지 않는다.
- Executor focused test, 통합·정적 검사 또는 최초 full suite가 실패하면 Code
  Reviewer를 호출하지 않고 테스트 실패를 먼저 해결한다.
- 최초 full suite 뒤 review 수정이 없으면 전체 테스트는 1회로 끝나고, 코드 수정이
  있으면 영향 범위 테스트와 최종 full suite를 추가해 전체 2회를 넘지 않는다.
- Production code를 변경한 각 goal에서 focused test 뒤 Deslop gate를 적용하고,
  생략 조건을 모두 충족하지 않으면 해당 goal 범위에서 정확히 한 번 수행한 뒤
  focused regression test를 실행한다.
- Agent가 timeout까지 진행 신호를 내지 않으면 상태 확인 1회 뒤 종료·교체하고,
  successor에는 transcript가 아니라 artifact와 미해결 finding만 전달한다.
- 같은 원인의 도구 호출이 수정된 인수로도 두 번째 실패하면 추가 반복 없이
  구조화된 blocker를 반환한다.
- Code Reviewer가 recovery authority 결함을 발견하면 normal, resume, historical,
  adapter 및 관련 consumer 중 동일 invariant가 적용되는 경로를 bounded sweep하고
  검사 범위를 기록한다.
- 같은 invariant의 다른 발현이 후속 review에서 발견되면 이전 review 이후의 draft
  delta 또는 당시 관찰 불가 사유가 없을 경우 새 blocker ID를 만들지 않는다.
- Read-only specialist가 soft output budget 안에서 구조화된 결과를 반환하고 Leader가
  이를 한 번 저장한다. Material finding이 더 길면 누락 대신 상한 초과를 표시하며
  specialist에게 일반 workspace write 권한을 부여하지 않는다.
- Plan Leader의 context 사용률이 35%에 도달하면 current artifact, ledger와 다음
  action을 checkpoint하고 50%에 도달하면 다음 review 단위 전에 새 session으로
  교체한다.
- Start-Goal Leader가 50% 미만이어도 compaction을 경험하면 현재 작업 단위를 닫고
  handoff digest를 검증한 뒤 즉시 새 session으로 교체한다.
- Runtime이 context window 또는 input token을 제공하지 않으면 비율을 임의 추정하지
  않고 정의된 fallback trigger로 교체한다.
- 새 Leader session은 transcript를 상속하지 않고 artifact에서 scope와 진행 상태를
  복구한다.
- Leader session 교체 후에도 Root의 spec authority, run ID, logical owner와 active
  writer 하나라는 invariant가 유지된다.
- Leader context 증가만으로 사용자-visible 새 thread를 만들지 않으며, Root의 사용자
  결정 충실도를 복구할 수 없는 경우에만 새 thread를 제안한다.

## 수용 기준

- 최종 spec은 사용자 확인을 받은 Intent Topology의 모든 active ID와 명시적 deferral을
  보존한다.
- 모든 active component에 7개 dimension score가 존재하며 상세한 sibling이 다른
  component의 불명확성을 가리지 않는다.
- ambiguity가 `Quick`, `Standard`, `Strict`의 선택된 기준을 충족하고 mode achieved가
  artifact에 기록된다.
- Quick 기준을 처음 통과하면 사용자가 현재 수준 확정 또는 더 높은 모드를 선택한다.
- Standard를 선택한 사용자는 Standard 기준 통과 뒤 확정 또는 Strict 계속을 선택할
  수 있고, 이미 Strict를 선택한 경우 중간 확인을 반복하지 않는다.
- 어느 모드에서도 공통 hard gate, closure audit 또는 Intent Restate를 생략할 수
  없다.
- 모든 material requirement와 acceptance criterion이 user intent, boundary,
  confirmed decision 또는 repository invariant에 추적된다.
- contradiction, scope expansion 또는 non-goal 변경은 ambiguity를 필요하면 다시
  높일 수 있고 기존 decision history를 삭제하지 않는다.
- 각 질문은 target component, dimension, current gap과 구현 영향을 가지며 가장 높은
  question priority와 연결된다.
- compact checkpoint는 전체 transcript 없이도 confirmed topology, decision,
  dispute, score, remaining gap과 next target을 복구할 수 있다.
- material 기능마다 reliability class, support boundary, non-goal 및 complexity budget이
  accepted spec에 기록된다.
- Architect `BLOCK` cycle에서는 Critic이 호출되지 않는다.
- Critic은 Architect `CLEAR`와 동일한 `draft_version`만 검토한다.
- `WATCH`는 승인 차단 상태로 사용되지 않는다.
- 모든 blocker는 non-null stable `scope_authority`, 구체적 evidence와 reachable
  scenario, 계획 시점 필요성 및 최소성을 증명한다.
- `optional-hardening`만으로 revision을 요구할 수 없다.
- Reviewer가 계획을 구현 명세로 확장하지 않는다.
- draft 2 이후 모든 material change가 Scope Delta와 안정적인 scope authority를 가진다.
- accepted reliability class보다 강한 메커니즘은 별도 scope 근거 없이 계획에
  추가되지 않는다.
- 새 blocker는 draft 변화 또는 scope 변화와 연결된다.
- 반복 blocker는 무제한 설계 확장이 아니라 명시된 수렴 절차를 따른다.
- `accepted-scope-defect`와 직접적인 `change-induced-risk`의 차단 능력은 유지된다.
- same-version consensus와 최대 5 cycle 계약이 유지된다.
- 두 번째 cycle 이후 자동 중단이나 강제 사용자 escalation을 추가하지 않는다.
- Planner가 goal 분할을 소유하고 일반 작업 5개, 대형·고위험 작업 10개의 기본
  complexity budget과 초과 근거를 계획에 기록한다.
- 강하게 결합된 파일·상태·migration 변경은 vertical slice로 묶이고 독립 안전·검증
  경계를 억지로 합치지 않는다.
- 각 Executor assignment가 파일, criterion, invariant, 허용 의존성 및 금지 범위를
  포함한다.
- Executor는 scope expansion을 구현하지 않고 구조화된
  `SCOPE_EXPANSION_REQUIRED`로 반환한다.
- blocking code-review finding이 invariant family, 관련 producer·consumer,
  inspected path 및 미검사 경계를 포함한다.
- 동일 invariant의 후속 blocker가 draft delta 또는 이전 관찰 불가 사유를 증명한다.
- 테스트 실패 상태에서는 Code Reviewer를 호출하지 않으며 full suite는 review 수정이
  없으면 1회, 코드가 바뀌면 최대 2회다.
- Production code를 변경한 각 goal은 정확히 하나의 Deslop 상태를 기록하고,
  간결하며 목적을 한 문장으로 설명할 수 있는 goal만 근거와 함께 생략된다.
- Deslop은 goal당 최대 한 번이며 현재 goal path와 직접 영향 경계만 입력으로 받고,
  최종 통합 단계에서 자동 재실행되지 않는다.
- Timeout 이후 상태 확인과 동일 원인의 도구 재시도가 각각 한 번으로 제한되며,
  agent 교체는 transcript가 아닌 검증된 artifact를 사용한다.
- Planner, Architect, Critic과 Code Reviewer의 read-only 계약이 유지된다.
- 역할별 message soft limit은 material finding을 누락시키거나 specialist의 일반
  workspace write 권한을 확대하지 않는다.
- Active Plan Leader만 현재 run의 plan handoff artifact를 쓰며 version 파일을
  덮어쓰지 않는다.
- Start-Goal Leader는 현재 goal control artifact만 직접 쓰고 제품 소스 변경은
  Executor에게 맡긴다.
- 8 KiB 초과 원문은 메시지 relay 없이 path, version과 digest로 전달된다.
- Artifact 누락, digest mismatch와 허용 경로 밖 write가 구조화된 blocker로
  관찰된다.
- 저장된 Planner와 reviewer 원문이 최종 plan envelope에 byte-for-byte 보존된다.
- Root가 spec과 사용자 결정 authority를 직접 유지하고 Plan Leader를 겸하지 않는다.
- 하나의 Start-Goal Leader lifecycle이 Planner가 분할한 approved goal의 인수부터
  완료 판정까지 소유하며 goal 구조를 다시 설계하지 않는다.
- 두 Leader agent가 별도 setup role 없이 top-level `LEADER` model과 reasoning
  effort를 상속한다.
- 설치 config와 receipt에는 두 Leader agent가 포함되지만 setup preset과 role
  matrix는 기존 8개 역할을 유지한다.
- context 지표가 있으면 35%에서 handoff 준비, 50%에서 Leader session 교체가
  수행된다.
- context compaction은 교체의 선행조건이 아니라 즉시 교체 trigger로 처리된다.
- context 지표가 없으면 명시된 fallback trigger를 사용하며 비율을 추정하지 않는다.
- Leader 교체 후 새 session은 transcript 대신 검증된 artifact로 복구하고 이전
  writer가 종료되기 전에 활성화되지 않는다.
- Leader context 증가만으로 사용자-visible top-level thread를 생성하지 않는다.
- Root 교체가 필요한 예외에서만 Leader가 구조화된
  `ROOT_REPLACEMENT_RECOMMENDED`를 Root에 반환하며, 현재 Root만 사용자에게 새
  top-level thread를 제안한다.
- 기존 standalone/loop handoff와 비범위 skill 흐름이 깨지지 않는다.
- 전체 테스트와 package 검사가 통과한다.

## 기존 세션에 대한 반사실 영향

분석 대상 세션:

`019f9952-8745-7033-980f-c0fe4f32dc4a`

### 관측 기준

분석 대상 네 개의 Pro planning run에는 총 18 cycle이 있었다.

| 항목 | 관측값 |
|---|---:|
| Architect review | 18 |
| Critic review | 14 |
| Architect/Critic review 합계 | 32 |
| Architect `CLEAR` cycle | 3 |
| Architect `BLOCK` cycle | 15 |
| `BLOCK` cycle의 blocking finding | 약 41 |

최종 Architect verdict에는 `WATCH`가 없었다. 대기 중 표시된 `WATCH` 메시지는 최종
review verdict가 아니므로 `WATCH` 제거 자체는 이 세션의 결과를 바꾸지 않는다.

### Blocker 기준 재적용

과거 blocking finding을 새 네 가지 기준에 다시 대입하면 다음과 같이 분류된다.

| 재분류 | Cycle 수 | 예상 영향 |
|---|---:|---|
| accepted scope·구체적 실패 경로·계획 시점 필요성을 계속 충족 | 14 | 기존 `BLOCK` 유지 |
| 국소적·가역적인 구현 세부사항으로 낮출 여지가 있음 | 1 | `CLEAR + Watch Item` 가능 |
| `optional-hardening`만으로 구성 | 0 | 해당 없음 |

대부분의 finding은 외부 동작, persisted authority, 권한·개인정보, migration,
cross-process interface, durability 또는 recovery invariant와 연결되어 있었다. 따라서
새 scope authority만으로 삭제되는 blocker는 거의 없다.

한 cycle의 단일 blocker는 accepted invariant 자체보다 그 invariant를 만족시키는
구체적인 국소 복구 절차에 가까웠다. 새 Plan Sufficiency Boundary에서는 이를
implementation note로 낮추고 Architect가 `CLEAR`할 가능성이 있다. 다만 그 뒤
Critic이 해당 draft를 실제로 검토한 기록은 없으므로 승인 여부는 확정할 수 없다.

후반 cycle에 처음 등장한 finding은 새 Blocker Ledger에 따라 draft delta와 신규 적용
사유를 증명해야 한다. 과거 기록만으로 그 인과관계를 모두 복원할 수 없으므로 이를
확정 절감량에 포함하지 않는다.

### 확정 가능한 순차 게이트 효과

과거 Architect verdict를 그대로 유지한다는 보수적인 가정에서 순차 게이트만 적용하면
다음과 같다.

| 지표 | 기존 | 변경 후 | 감소 |
|---|---:|---:|---:|
| Pro Architect/Critic review 호출 | 32 | 21 | 11 (`34.4%`) |
| Pro Critic 호출 | 14 | 3 | 11 (`78.6%`) |
| 전체 실제 subagent 시작 | 91 | 80 | 11 (`12.1%`) |

생략 대상 Critic 기록을 기준으로 전체 subagent 총 토큰의 약 `14.2%`, 출력 토큰의
약 `17.0%`, Pro Architect/Critic 리뷰 토큰의 약 `33.5%`가 감소한다.

관측된 review token 합계는 `165,543,363`이고, Architect 미승인 뒤 실행된 Critic
11개의 합계는 `55,378,114` token이다. 이 값은 기존 기록으로 직접 합산할 수 있는
확정 절감량이다.

### 전체 규칙을 적용한 예상 범위

국소 구현 세부사항으로 판단 가능한 한 cycle에서 Architect가 `CLEAR`한다고 가정하면
새 Critic review가 하나 생긴다. 결과는 다음 두 경우로 갈린다.

| 시나리오 | 총 cycle | 총 review 호출 | 전체 subagent 시작 | 설명 |
|---|---:|---:|---:|---|
| 보수적: 기존 verdict 유지 | 18 | 21 | 80 | 순차 게이트만 확정 적용 |
| 해당 Critic이 승인 | 17 | 21 | 80 | Architect 1회와 후속 draft 1개 제거, Critic 1회 추가 |
| 해당 Critic이 revision 요구 | 18 | 22 | 81 | 후속 cycle 유지, Critic 1회 추가 |

따라서 합리적인 예상 범위는 다음과 같다.

- Pro review 호출: `32 → 21~22`, 10~11회 감소 (`31.3~34.4%`)
- 전체 subagent 시작: `91 → 80~81`, 10~11회 감소 (`11.0~12.1%`)
- planning cycle: `18 → 17~18`, 0~1회 감소 (`0~5.6%`)
- 기존 Critic 호출: 11회 생략
- 새 순차 게이트 Critic 호출: 0~1회 추가

새 Critic 호출의 실제 token 기록은 존재하지 않는다. 같은 run에서 관측된 Critic과
Architect 비용을 하한·상한으로 사용하면 전체 규칙 적용 후 예상 절감은 다음 범위다.

- Pro Architect/Critic review token: 약 `32.5~33.9%` 감소
- 전체 세션 subagent token: 약 `13.8~14.4%` 감소

이 범위는 비용 예측용 휴리스틱이며 확정 측정값이 아니다. Reviewer prompt가 바뀌면
draft 길이, relay 횟수, verdict와 후속 Planner 출력도 함께 바뀌기 때문이다.

### 해석

따라서 과거 세션에서 확정할 수 있는 효과는 불필요한 Critic 호출 제거이며, cycle 수
감소는 제한적이다. 긴 루프의 주된 원인이 `optional-hardening`보다는 accepted scope에
포함된 강한 durability·recovery·privacy·migration 요구와 실제 경계 결함이었기
때문이다.

위 수치는 Plan-Pro 순차 게이트만 과거 기록에 반사실 적용한 결과다. 이번 통합으로
추가된 reliability class, Scope Delta, Executor scope fence, invariant-family review는
과거 실행을 동일 조건으로 재생한 자료가 없으므로 확정 절감량에 포함하지 않는다.
특히 invariant-family review는 review 횟수를 기계적으로 줄이는 규칙이 아니라 같은
결함군을 한 pass에서 더 완전하게 반환하도록 하는 규칙이므로, 효과는 후속 실행에서
동일 finding 재발률과 신규 blocker 등록 사유로 측정한다.

새 blocker 규칙의 주요 가치는 과거 cycle을 대폭 삭제하는 것보다 다음에 있다.

- 계획을 구현 프로토콜 수준까지 불필요하게 확장하는 것을 억제한다.
- 비차단 항목이 다음 draft의 필수 범위로 유입되는 것을 막는다.
- 후반 cycle의 새 blocker가 draft 변화와 연결되는지 감사 가능하게 만든다.
- 같은 blocker에 메커니즘을 계속 덧붙이는 대신 단순화 또는 infeasibility로
  수렴시킨다.

Cycle 감소 효과는 변경 후 동일 난이도의 plan-pro 실행에서 다음 지표를 별도로
관측해야 한다.

- Spec Interview의 mode별 선택 비율과 최종 `interview_mode_achieved`
- mode별 질문 round 수, 최초 ambiguity와 최종 ambiguity
- 질문별 ambiguity delta와 `question_priority`
- Round 0 이후 추가·제거·보류된 topology component 수
- contradiction, scope-expansion trigger와 closure override 발생률
- Intent Restate에서 사용자가 범위 또는 목적을 수정한 비율
- Analyst round별 비캐시 입력·출력 token과 compact checkpoint 크기
- Plan Leader와 Start-Goal Leader의 call별 context 사용률
- 35% handoff 준비와 50% session 교체가 발생한 횟수
- compaction 전 선제 교체율과 compaction 후 즉시 교체 준수율
- Leader session별 wall-clock duration, pass 수와 handoff artifact 크기
- Leader 교체 뒤 stale scope, duplicate writer 또는 state 복구 실패율
- 사용자-visible 새 top-level thread 제안 횟수와 사유
- draft별 blocker 신규 등록률
- 기존 blocker 재발률
- Watch Item에서 blocker로 승격된 비율
- Architect `CLEAR`까지의 cycle 수
- Critic 이후 architecture 재개방률
- draft 및 review별 비캐시 입력·출력 token
- reliability class보다 강한 메커니즘이 제안된 횟수와 거부율
- Scope Delta에서 근거 없이 제외된 항목 수
- `SCOPE_EXPANSION_REQUIRED` 발생 및 사용자 승인 비율
- 동일 invariant family의 후속 blocker 재발률

## 위험과 중단 조건

- 정량 score가 모델의 주관적 숫자에 그칠 수 있다. 점수만으로 READY를 허용하지 않고
  stable topology ID, requirement traceability, unresolved decision과 closure hard
  gate를 계약 테스트로 함께 검증한다.
- `Quick`이 불완전한 spec을 정상화할 수 있다. Quick도 모든 공통 hard gate를
  통과해야 하며, 낮은 위험의 가역적 작업에만 추천한다.
- 모드 전환 질문이 반복되어 사용자 피로를 키울 수 있다. 사용자가 Strict를
  선택하면 Standard 경계 확인을 생략하고, 이미 확정한 결정을 다시 묻지 않는다.
- 한 질문씩 묻는 방식이 라운드와 context를 늘릴 수 있다. 각 질문을 정량화된
  material gap에 연결하고 compact checkpoint만 다음 Analyst 호출에 전달한다.
- Scope expansion마다 topology 전체를 다시 여는 문제가 생길 수 있다. 변경된
  component와 영향받는 dimension만 재평가하되 전체 hard gate와 sibling 최솟값은
  유지한다.
- 자유서술 답변 재확인이 모든 답변에 적용되면 인터뷰가 두 배로 길어진다. Material
  scope, non-goal, constraint, tradeoff 또는 authority가 변할 때만 구조화 확인을
  요구한다.
- Reliability class가 단순 라벨로만 남고 plan과 review에서 무시될 수 있다. 각
  Planner/Reviewer assignment와 Scope Delta에 class 및 complexity budget 전달을
  계약 테스트로 강제한다.
- `best-effort`를 이유로 실제 데이터·권한 회귀까지 비차단 처리할 수 있다.
  change-induced baseline invariant가 있으면 reliability class와 무관하게 blocker가
  될 수 있음을 유지한다.
- Architect가 actionability 검토까지 흡수하면 역할 중복이 재발한다. Architect
  Revision Brief는 구조적 finding으로 제한한다.
- Critic이 새로운 architecture 선택지를 탐색하면 범위가 다시 열린다. Critic은
  승인된 구조의 실행 가능성과 검증 가능성만 판단한다.
- 분류 라벨만 추가되고 blocker 증명이 생략될 수 있다. 계약 테스트에서 blocker별
  근거 필드를 강제한다.
- 너무 많은 내부 세부사항을 실행 단계로 넘겨 material decision이 누락될 수 있다.
  외부 동작, 안전 경계, 책임 주체, 비가역적 선택은 반드시 계획에서 고정한다.
- 반복 blocker를 억지로 단순화해 accepted criteria를 약화할 수 있다. 단순화는
  criteria를 그대로 만족할 때만 허용한다.
- Scope Delta가 지나치게 세분화되어 계획 자체가 커질 수 있다. public behavior,
  state, schema, support, ownership, verification obligation을 바꾸는 material
  change만 기록한다.
- Executor scope fence가 필요한 인접 수정까지 막을 수 있다. accepted criterion을
  만족하기 위해 필수인 범위 확장은 구현하지 않은 상태로 구조화해 반환하고 Root가
  사용자 또는 Planner에게 정확한 ownership 재결정을 요청한다.
- Invariant-family sweep가 무제한 탐색으로 변질될 수 있다. 동일 invariant를 직접
  생산·소비하는 변경 경로와 accepted boundary까지만 검사하고 인접 hardening은
  follow-up으로 남긴다.
- Goal budget 때문에 독립 안전 경계를 억지로 합치면 ownership과 rollback이
  약해질 수 있다. 5개·10개는 hard cap이 아니라 기본 budget으로 사용하고, 독립
  ownership·검증·rollback 근거가 있으면 초과를 허용한다.
- Test-first review gate는 review 수정이 발생한 실행에서 full suite를 두 번 수행할
  수 있다. 실패 상태의 변경에 더 비싼 review를 소비하지 않는 이점을 우선하되,
  review 수정이 없으면 1회로 끝내고 어떤 경우에도 정상 계약상 2회를 넘지 않는다.
- Goal-scoped Deslop 생략 판정이 실제 유지보수 결함을 놓칠 수 있다. 단순 LOC
  임계값 대신 한 문장 목적, 간결성, 중복·dead code·불필요한 abstraction 부재,
  cleanup finding 부재를 모두 기록하고 생략이 accepted criterion을 약화시키지
  않게 한다.
- 획일적인 timeout은 정상적인 장기 build나 test agent를 조기에 종료할 수 있다.
  작업 유형별 근거 있는 timeout을 사용하고 종료 전에 상태 확인을 한 번 허용한다.
- Message soft limit이 blocker나 검증 근거를 누락시키는 hard cap으로 오용될 수 있다.
  Material finding을 보존해야 하면 limit 초과를 허용하고 대형 원문만 artifact
  path로 분리한다.
- Read-only specialist의 원문을 Leader가 저장하는 과정에서 판단이 바뀔 수 있다.
  Leader는 결과를 정확히 한 번 verbatim 저장하고 요약은 별도 bounded message로만
  작성하며 specialist에게 일반 write 권한을 부여하지 않는다.
- 계약 테스트는 모델 행동을 완전히 보장하지 않는다. 변경 후 대표적인
  `csx-plan-pro` 실행에서 호출 순서, blocker 품질, ledger 수렴을 직접 검증한다.
- 현재 agent TOML에는 `read-only`와 일반 write의 구분은 있지만 특정 handoff
  디렉터리만 허용하는 path allowlist가 없다. 따라서 Plan Leader의 제한된 writer
  범위와 Start-Goal Leader의 control-artifact-only 직접 쓰기는 권한 계층에서
  예방되지 않고 prompt 계약에 의존한다. 허용 경로, 제품 소스 직접 수정 금지,
  범위 밖 write 필요 시 구조화된 중단을 agent prompt에 반복 없이 명시하고, 쓰기
  전후 workspace 상태에서 unexpected Leader 직접 변경이 보이면 성공 artifact를
  만들지 않는다. 별도 runtime path 권한 기능은 추가하지 않는다.
- Handoff artifact가 runtime state처럼 성장하면 별도 recovery·locking 설계로 범위가
  다시 확대될 수 있다. 단일 writer, immutable version과 digest 확인만 사용하고
  runtime hook이나 workflow authority가 이를 소비하지 못하게 한다.
- 모든 intermediate 원문을 영구 보존하면 `.csx`가 계속 커질 수 있다. 본 계획에서는
  보존 정책을 새로 설계하지 않고 기존 plan artifact lifecycle을 따르며, 자동
  cleanup이나 retention 서비스는 추가하지 않는다.
- Runtime token usage가 실제 다음 호출의 context 점유량과 정확히 일치하지 않을 수
  있다. 지표는 강제 정밀값이 아니라 선제 회전 신호로 사용하고 cached input을
  차감하지 않는다.
- Runtime이 `model_context_window`나 call별 input token을 노출하지 않을 수 있다.
  이 경우 퍼센트를 추정하지 않고 cycle, pass, 시간, compaction과 message-size
  fallback만 사용한다.
- 50% 회전이 짧은 작업에도 과도한 session churn을 만들 수 있다. 생성 도중 교체하지
  않고 현재 작업 단위를 닫은 뒤 교체하며, 측정 결과에 따라 threshold 변경은 별도
  spec decision으로 다룬다.
- Leader 교체 시 stale artifact나 중복 writer가 생길 수 있다. digest와 run ID를
  검증하고 이전 writer session을 종료한 뒤에만 새 session을 시작하며, artifact에는
  이 전환을 workflow authority가 아닌 provenance로 기록한다.
- 새 session이 transcript를 다시 요구하면 context 절감이 사라진다. 복구에 필요한
  정보가 checkpoint에 없으면 전체 transcript relay 대신
  `BLOCKED_HANDOFF_INCOMPLETE`로 중단하고 artifact를 보완한다.
- Root가 세부 진행을 계속 받아 단계 분리 효과가 사라질 수 있다. 정상 경로에서는
  bounded summary만, user-owned decision이 있을 때만 Decision Packet을 반환한다.
- Root thread 교체를 너무 자주 사용하면 사용자 결정 연속성이 오히려 약해진다.
  내부 Leader session 교체를 기본으로 하고 명시된 Root 충실도 실패 조건에서만 새
  top-level thread를 제안한다.
- 변경이 일반 `csx-plan`의 Critic-only 흐름, runtime orchestrator 또는 새 영속
  schema로 퍼지면 중단한다. 실행과 code-review에는 이 계획에서 명시한 scope fence와
  invariant-family 계약만 적용한다.
