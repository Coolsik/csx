# 통합 수정 계획

목표는 `plan1.md`, Skill, Agent TOML, 테스트, README가 모두 같은 계약을 사용하도록 맞추는 것이다. 새 runtime orchestrator는 만들지 않고 현재 prompt 기반 구조를 유지한다.

## 최종 결정 사항

1. Blocker는 **4조건**을 유지하되 `scope_authority`를 첫 조건에 명시적으로 포함한다.
2. 모든 reviewer가 동일한 finding 스키마·분류값·종료 토큰을 사용한다.
3. Deslop은 통합 전체가 아니라 **production code를 변경한 goal마다 최대 1회** 수행한다.
4. 간결하고 목적을 한 문장으로 설명할 수 있는 goal만 Deslop을 생략한다.
5. 새 user-visible thread는 일반 Leader 교체가 아니라 **Root 교체**가 필요할 때만 제안한다.
6. Reliability class와 complexity budget을 Planner·Architect·Critic assignment에 직접 전달한다.
7. 새 ACL·writer runtime·context metric 코드는 만들지 않는 최소 수정안을 적용한다.
8. 정적 계약 테스트와 실제 host 행동 검증을 분리한다.
9. README에서 specialist와 workflow leader를 구분한다.

---

## Goal 1. Blocker와 Finding 계약 통일

### 변경할 계약

Blocker는 다음 4조건을 모두 만족해야 한다.

```text
1. Scope-authorized defect or risk

   classification이 accepted-scope-defect 또는 change-induced-risk이고,
   scope_authority가 안정적인 accepted-spec ID 또는
   REGRESSION:<invariant>에 연결돼야 한다.

2. Concrete evidence and reachable scenario

   구체적인 evidence, affected boundary, 실패 조건과 결과가 있어야 한다.

3. Plan-time necessity

   구현 전에 정하지 않으면 Executor가 공개 동작, 책임, 안전 경계 또는
   비가역적 선택을 임의로 결정하게 되는 문제여야 한다.

4. Minimality

   요청한 수정이 accepted scope를 만족하는 가장 작고 단순한 변경이어야 한다.
```

기존 5조건에서 `scope authority`와 finding 분류를 첫 번째 조건으로 합친다. 의미는 유지하면서 Skill·테스트가 사용 중인 4조건 구조와 맞춘다.

### 공통 Finding 스키마

```yaml
finding_id: F001
classification: accepted-scope-defect | change-induced-risk | optional-hardening
scope_authority: AC7 | CONSTRAINT:C3 | NON_GOAL:N2 | REGRESSION:<invariant> | null
affected_boundary: <module, data, permission, migration, or execution boundary>
reachable_scenario: <concrete execution or failure path>
evidence: <file, symbol, test, or artifact>
plan_time_decision: <decision that must be fixed before implementation>
minimal_fix: <smallest scope-preserving correction>
scope_delta: none | requires-user-decision
```

추가 규칙:

- `accepted-scope-defect`는 accepted-spec ID가 필요하다.
- `change-induced-risk`는 `REGRESSION:<invariant>`가 필요하다.
- 두 분류 모두 `scope_authority: null`이면 blocker가 될 수 없다.
- `optional-hardening`은 항상 비차단 항목이다.
- 현재 spec 안에서 해결 불가능하면 정확히 다음 토큰을 반환한다.

```text
INFEASIBLE_UNDER_CURRENT_SPEC
```

### 수정 대상

- `plan1.md`
- `payload/skills/csx-plan-pro/SKILL.md`
- `payload/skills/csx-code-review/SKILL.md`
- `payload/agents/csx-architect.toml`
- `payload/agents/csx-critic.toml`
- `payload/agents/csx-code-reviewer.toml`

### 완료 기준

- 모든 normative 문구가 4조건을 사용한다.
- 모든 reviewer가 동일한 필드와 enum을 사용한다.
- 기존 `change-induced safety/regression` 등의 다른 표현을 제거한다.
- `scope_authority` 없는 finding은 blocker로 승격할 수 없다.
- 반복 blocker가 정확한 infeasibility 토큰으로 수렴한다.

---

## Goal 2. Reliability와 Complexity 전달 보장

Planner·Architect·Critic assignment에 다음 필드를 필수로 추가한다.

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

### 역할별 책임

Planner:

- reliability 요구보다 약한 계획을 만들지 않는다.
- 필요 이상으로 강한 persistence/retry/recovery 메커니즘을 추가하지 않는다.
- complexity budget을 넘으면 각 초과 goal의 독립 ownership·검증·rollback 근거를 기록한다.

Architect와 Critic:

- assignment에서 전달받은 값을 review 결과에 다시 기록한다.
- draft가 reliability class와 complexity budget을 지키는지 검증한다.
- draft에 적힌 값과 accepted spec의 digest가 불일치하면 review를 진행하지 않는다.
- 더 강한 메커니즘이 필요하면 `scope_authority` 또는 `scope_delta`를 요구한다.

### 수정 대상

- `payload/skills/csx-plan-pro/SKILL.md`
- `payload/agents/csx-plan-leader.toml`
- `payload/agents/csx-planner.toml`
- `payload/agents/csx-architect.toml`
- `payload/agents/csx-critic.toml`

### 완료 기준

- 세 역할 assignment에 네 필드가 모두 존재한다.
- Architect/Critic 결과에서 받은 제한을 확인할 수 있다.
- accepted spec보다 강한 메커니즘을 근거 없이 승인하지 않는다.

---

## Goal 3. Goal 단위 Deslop 적용

### 실행 시점

```text
Goal 구현
→ focused test
→ Deslop 생략 조건 판단
→ 필요하면 goal 범위 Deslop 1회
→ 영향 범위 focused regression
→ goal checkpoint
```

모든 goal이 완료된 뒤에는 다음 순서로 진행한다.

```text
통합·정적 검사
→ full suite
→ code/architecture review
→ finding rework
→ 코드가 바뀌었으면 최종 full suite
```

최종 통합 단계에서는 Deslop을 자동으로 다시 실행하지 않는다.

### 적용 범위

Production code를 변경한 goal은 원칙적으로 Deslop 대상이다.

Deslop에는 다음 정보만 전달한다.

```yaml
goal_id: G3
one_line_outcome: "토큰 갱신 실패를 재로그인 흐름으로 연결한다."
owned_changed_paths:
  - lib/auth/refresh.js
  - lib/auth/session.js
directly_affected_boundaries:
  - lib/auth/index.js
focused_tests:
  - test/auth-refresh.test.js
non_goals:
  - 로그인 API 변경
  - 세션 스키마 변경
```

허용 범위:

- 현재 goal이 변경한 production 파일
- 직접 영향을 받은 공통 helper/interface
- 관련 focused test
- 현재 goal의 finding

이전 goal transcript나 전체 저장소 변경은 전달하지 않는다.

### 생략 조건

다음 조건을 모두 충족할 때만 생략한다.

- 변경된 코드가 이미 간결하다.
- 변경 목적을 한 문장으로 명확히 설명할 수 있다.
- 중복·dead code·불필요한 abstraction이 없다.
- cleanup finding이 없다.

생략 증거:

```yaml
deslop_status: DESLOP_SKIPPED_CONCISE_GOAL
one_line_purpose: "중복된 null 검사를 기존 guard 호출로 통합한다."
changed_paths:
  - lib/parser.js
cleanup_findings: none
```

Production code가 없는 goal:

```text
DESLOP_NOT_APPLICABLE
```

실행한 경우:

```text
DESLOP_COMPLETED
```

### 추가 규칙

- goal당 최대 1회
- goal마다 full suite를 실행하지 않음
- Deslop은 공개 동작, schema, authority, support 범위를 변경할 수 없음
- 후속 전체 review에서 발견된 cross-goal 중복은 전체 Deslop이 아니라 bounded finding rework로 처리
- review 이후 같은 goal에 Deslop을 다시 실행하지 않음

### 수정 대상

- `plan1.md`
- `payload/skills/csx-start-goal/SKILL.md`
- `payload/agents/csx-start-goal-leader.toml`

---

## Goal 4. Root Replacement Protocol 추가

새 user-visible top-level thread는 내부 Leader rotation 용도가 아니라 현재 Root를 새 Root로 교체할 때만 사용한다.

### 일반 Leader rotation

- 동일한 사용자 thread와 Root를 유지한다.
- Plan Leader 또는 Start-Goal Leader만 교체한다.
- successor는 `fork_turns: "none"`을 사용한다.
- artifact path와 digest로 상태를 복구한다.
- Leader context 증가만으로 새 top-level thread를 제안하지 않는다.

### Root 교체 조건

다음 중 하나일 때 현재 Root가 사용자에게 새 thread를 제안한다.

- compaction 후 사용자 결정·non-goal 원문 충실도를 복구할 수 없음
- accepted spec이 사실상 다른 프로젝트로 변경됨
- Root context에 세부 구현 원문이 누적되어 bounded packet으로 분리할 수 없음
- 서로 다른 goal의 authority가 섞일 위험이 있음
- runtime 제약으로 transcript 없는 내부 successor를 만들 수 없음

### 구조화된 추천

```yaml
status: ROOT_REPLACEMENT_RECOMMENDED
reason: ROOT_DECISION_FIDELITY_LOST
resume:
  accepted_spec_path: ...
  accepted_spec_sha256: ...
  current_artifact_path: ...
  current_artifact_sha256: ...
  current_phase: ...
  next_action: ...
  open_findings: [...]
  unresolved_user_decisions: [...]
```

규칙:

- Leader는 새 user-visible thread를 직접 만들지 않는다.
- Leader는 Root에 위험만 보고한다.
- 현재 Root만 사용자에게 교체를 제안한다.
- 사용자 또는 제품이 새 thread를 생성한다.
- 새 Root는 전체 transcript가 아닌 검증된 artifact에서 복구한다.
- 새 runtime state schema는 추가하지 않는다.

### 수정 대상

- `plan1.md`
- `payload/skills/csx-plan-pro/SKILL.md`
- `payload/skills/csx-start-goal/SKILL.md`
- 두 workflow Leader TOML

---

## Goal 5. 최소 런타임 변경과 검증 강화

### 유지할 비범위

다음 production runtime은 새로 만들지 않는다.

- 새로운 JS workflow orchestrator
- `.csx/handoffs` 전용 ACL 시스템
- 별도 writer lease/lock runtime
- 자체 context-token 계측기
- 새로운 persistent workflow-state schema
- 새로운 Agent 또는 setup role

기존 `workflow-state.js`는 canonical plan/goal state에만 계속 사용한다.

### 계약 명확화

Skill과 README에서 다음을 구분한다.

- Host가 실제로 강제하는 제한
- Prompt 계약에 의존하는 제한
- Runtime metric이 없을 때 사용하는 fallback rotation
- Canonical plan/goal state와 Leader handoff artifact의 차이

Runtime이 context metric을 제공하지 않으면 비율을 추정하지 않고 기존 fallback 조건을 사용한다.

---

## 검증 계획

### 정적 계약 테스트

`test/skill-contract.test.js`에서 다음을 검증한다.

- Blocker 4조건
- 첫 조건의 필수 `scope_authority`
- 공통 finding 필드
- 정확한 classification enum
- 정확한 `INFEASIBLE_UNDER_CURRENT_SPEC`
- assignment의 reliability/complexity 필드
- goal별 Deslop 최대 1회
- 세 가지 Deslop 상태
- Root rotation과 Root replacement 구분
- Leader가 top-level thread를 직접 만들 수 없다는 규칙

### Host-level 행동 시나리오

1. `scope_authority` 없는 finding이 Watch Item으로 내려가는지 확인한다.
2. Architect `BLOCK` 시 Critic이 호출되지 않는지 확인한다.
3. accepted complexity를 초과한 draft가 차단되는지 확인한다.
4. 간결한 goal은 Deslop을 생략하는지 확인한다.
5. 복잡한 production goal은 Deslop을 정확히 한 번 실행하는지 확인한다.
6. 서로 다른 goal의 변경을 Deslop에 한꺼번에 전달하지 않는지 확인한다.
7. Leader rotation이 Root와 사용자 thread를 유지하는지 확인한다.
8. Root fidelity 손실 시에만 Root replacement가 추천되는지 확인한다.
9. digest mismatch와 artifact 누락 시 구조화된 blocker로 종료하는지 확인한다.

실제 agent 호출 검증은 일반 `npm test`와 분리하여 host E2E evidence로 기록한다. 가짜 production orchestrator는 만들지 않는다.

### 회귀 검증

```text
node --test test/skill-contract.test.js
node --test test/package.test.js
npm run check
npm test
npm pack --dry-run
```

확인 사항:

- 전체 테스트 실패 0
- setup의 기존 8-role matrix 유지
- 두 workflow Leader의 LEADER 설정 상속 유지
- Leader TOML에 model/effort override가 생기지 않음
- 설치 receipt와 package payload에 두 Leader가 계속 포함됨

---

## README 정리

설치 agent를 다음처럼 구분한다.

```text
Configurable specialists shown in setup:
- explorer
- analyst
- planner
- architect
- critic
- executor
- code-reviewer

Workflow leaders installed automatically:
- csx-plan-leader
- csx-start-goal-leader
```

추가 설명:

- workflow Leader는 top-level LEADER 설정을 상속한다.
- workflow Leader는 setup matrix의 별도 role이 아니다.
- Leader rotation은 내부 session 교체다.
- 새 top-level thread는 Root replacement다.
- Prompt 계약은 runtime 권한 강제와 동일하지 않다.
- Deslop은 integrated 전체가 아니라 production-code goal별 최대 1회다.

## 구현 순서

```text
Goal 1: Blocker/Finding 계약 통일
    ↓
Goal 2: Reliability/Complexity assignment
    ↓
Goal 3: Goal-scoped Deslop
    ↓
Goal 4: Root replacement protocol
    ↓
Goal 5: 테스트·README·전체 회귀 검증
```

완료 상태는 계획, Skill, TOML, 테스트, README가 모두 위 계약을 동일하게 표현하고 전체 테스트가 실패 없이 통과한 상태다.
