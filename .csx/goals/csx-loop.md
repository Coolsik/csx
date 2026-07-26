# Goal: csx-loop 단일 호출 워크플로

## Objective and Accepted Boundaries

승인된 [`/home/ubuntu/work/feat-loop-skill/.csx/plans/csx-loop-pro.md`](../plans/csx-loop-pro.md)의 `Decision: APPROVED`, `draft_version: 2`를 구현한다. 바인딩 스펙은 [`/home/ubuntu/work/feat-loop-skill/.csx/specs/csx-loop.md`](../specs/csx-loop.md)의 `READY_WITH_ASSUMPTIONS`이며, 세부 요구사항·가정·위험·Verification Matrix는 두 승인 산출물을 그대로 따른다.

- 한 번의 명시적 loop 호출은 하나의 bounded 작업 slug와 하나의 aggregate goal만 소유한다.
- 순서는 항상 `csx-spec -> (정확히 하나의 csx-plan | csx-plan-pro) -> csx-start-goal`이며 계획 단계를 생략하지 않는다.
- 직접 start-goal 추천은 `csx-plan`으로 매핑하고, 광범위·고위험·교차 모듈·아키텍처 민감 작업만 `csx-plan-pro`로 보낸다.
- 2~3개 선택지 중 명시적인 첫 `Recommended`가 안전 게이트와 충돌하지 않고 승인 범위 안에서 가역적일 때만 자동 선택한다.
- BLOCKED, 필수 역할 누락, 검토 한도 소진, 사용자 취소, 권한·안전 게이트, 다른 활성 goal, 추천 없는 plan-changing 결정은 downstream을 중단한다.
- persisted provenance는 live authority가 아니다. live authority는 현재 initial call, exact pending-decision 답변, exact resume prompt에만 결합되고 transition마다 한 번 소비되며 중단·질문·취소·무관한 턴·blocker에서 무효화된다.
- 별도 `.csx/loops`, runner, daemon, MCP, 새 플랫폼·서비스를 만들지 않는다.
- 배포, 외부 메시지, 삭제, 추가 권한 및 비가역적 동작을 자동 승인하지 않는다.
- `.agents`, 설치 영수증, 승인된 spec/plan은 구현 소유 경로가 아니다.
- 모든 원래 AC의 최신 증거, unchanged revision의 최종 검증과 누적 리뷰 승인, goal completion 전에는 성공을 보고하지 않는다.

## Current Revision

Current: R008
Latest cause: F003 incomplete-spec draft checkpoint repair
Changed paths: `payload/skills/csx-loop/SKILL.md`, `test/skill-contract.test.js`
Invalidated current evidence: R007 AC8/AC10/AC14 cumulative evidence and final review. Unaffected R007 installation, transaction, hook, and child-contract evidence remains current.

## Attempt Counters

- Goal implementation corrections:
  - G001: 0/1
  - G002: 0/1
  - G003: 0/1
  - G004: 0/1
- Final cumulative verification: 3/3
- Verification failure repairs: None; stable `Vnnn` 생성 시 각 0/2
- Environment reruns: None; stable `Vnnn` 생성 시 각 0/1
- Cumulative code review: 3/3
- Review finding repairs:
  - F001: 1/2
  - F002: 1/2
  - F003: 1/2

모든 counter는 dispatch 또는 실행 전에 증가시킨다.

## Success Criteria

- [x] **AC1:** `$csx-loop <request>`와 `csx loop <request>`는 hook에서 `csx-loop`로 라우팅되고, `please loop this` 같은 일반 자연어와 unknown/invalid 명령은 출력이 없다.
  - Evidence (R008 final PASS): `node --test test/hook.test.js`; 네 loop 형식은 `$csx-loop` skill context를 출력하고 negative 입력은 빈 출력이어야 한다. route 누락, false positive, 기존 route 회귀 또는 nonzero exit는 실패다.
- [x] **AC2:** 프로젝트 및 전역 설치가 `csx-loop/SKILL.md`와 `agents/openai.yaml`을 설치하고 영수증에 정확히 한 번 포함한다. 실제 pre-loop receipt/disk 상태의 upgrade는 current-minus-pre-loop의 exact absent `additions`만 선언해 성공하고, 중간 강제 종료 후 재진입은 additions/config/receipt를 preimage로 복구한 뒤 upgrade를 완료한다. present/extra/missing/duplicate additions, declaration 불일치, recovery authority 불일치, 임의 receipt path는 거부되며 pre-loop 및 upgraded uninstall은 각 current receipt-owned paths만 제거한다.
  - Evidence (R008 final PASS): transaction/install cumulative suite 73/73; exact candidate split, forced-death upgrade/direct-uninstall recovery, receipt-owned uninstall and closed-list install scenarios passed.
- [x] **AC3:** loop 계약은 `csx-spec`, 정확히 하나의 `csx-plan|csx-plan-pro`, `csx-start-goal` 순서를 고정한다. validated context의 `csx-spec`은 final path/status/recommendation/provenance만 부모에게 반환하며 자체 handoff 질문·downstream 호출을 하지 않고, 각 단계 성공 전 다음 호출은 금지된다.
  - Evidence (R008 final PASS): `node --test test/skill-contract.test.js`의 spec-return/order/branch scenarios; spec 자체 downstream, plan 생략·중복 또는 순서 역전은 실패다.
- [x] **AC4:** 낮은 위험 대표 경로에서 부모가 반환받은 spec recommendation이 직접 start-goal이어도 `csx-plan`으로 변환되며 plan 완료가 start-goal보다 앞선다.
  - Evidence (R008 final PASS): 동일 contract suite의 low-risk branch scenario; direct 실행 또는 plan보다 이른 start-goal은 실패다.
- [x] **AC5:** 광범위·고위험·교차 모듈·아키텍처 민감 대표 경로는 `csx-plan-pro`를 선택하며 `Decision: APPROVED` 전에는 start-goal을 호출하지 않는다.
  - Evidence (R008 final PASS): 동일 contract suite의 pro branch/approval scenario; 잘못된 branch 또는 승인 전 실행은 실패다.
- [x] **AC6:** 일반 계획 `Decision: READY` 또는 pro 계획 `Decision: APPROVED`, 완전히 검증된 loop context, 현재 transition에 결합된 live authority가 모두 있으면 계획 스킬은 최종 질문 없이 부모에게 반환하고 start-goal이 시작된다. persisted enum만 있거나 context/live authority가 불완전하면 실행하지 않으며 standalone은 기존 명시적 선택을 요구한다.
  - Evidence (R008 final PASS): 동일 contract suite의 authorization scenarios; accepted plan+matching context+현재 live authority만 질문 없이 진행해야 한다. enum-only, incomplete context 또는 standalone 자동 실행은 실패다.
- [x] **AC7:** 2~3개 선택지 중 첫 옵션이 명시적 Recommended이고 안전 게이트와 충돌하지 않으며 승인 범위 안에서 가역적일 때만 자동 선택하고, 선택·추천 근거·적용 단계를 진행 출력 또는 child artifact에 남긴다.
  - Evidence (R008 final PASS): 동일 contract suite의 recommendation scenarios; 비추천·비가역 선택 자동화 또는 선택 근거 누락은 실패다.
- [x] **AC8:** 추천이 없거나 open-ended인 plan-changing 질문은 자동 응답하지 않고 `BLOCKING_USER_DECISION`, 마지막 성공 단계, 통제되는 downstream 결정, stable pending-decision 식별자, “답변 후 계속” 효과, 정확한 resume 명령을 표시한다. 무관한 답변은 live authority를 만들지 않으며 동일 slug/stage/pending-decision에 대한 현재 답변만 `renewed-by-answer`를 생성한다.
  - Evidence (R008 final PASS): contract/hook cumulative suite 25/25; spec blocker의 draft-only checkpoint, stable pending-decision exact answer, unrelated/stale/mismatched answer 거부, final spec 승격 전 downstream 금지를 직접 고정한다.
- [x] **AC9:** spec/plan/pro plan의 BLOCKED, 필수 역할 누락, 검토 한도 소진, 사용자 취소, 권한·안전 게이트, 서로 다른 활성 goal 중 하나라도 발생하면 live authority를 무효화하고 이후 단계를 호출하지 않는다.
  - Evidence (R008 final PASS): 동일 contract suite의 hard-gate scenarios; blocker 뒤 downstream 또는 goal 생성, `Refine further` 자동 반복은 실패다.
- [x] **AC10:** 현재 prompt가 정확한 `$csx-loop resume <work-slug>` 또는 shorthand이고 artifact slug와 일치할 때만 `explicit-resume` live authority를 생성한다. 재개는 기존 유효 산출물·goal·명시적 시도 횟수를 재사용하고 첫 미완료 단계부터 계속하며 완료된 단계는 재생성하지 않는다.
  - Evidence (R008 final PASS): contract/hook cumulative suite 25/25; incomplete-spec draft는 exact slug resume에서 spec만 재개하고 unresolved decision을 답하지 않으며, final artifact로 오인하거나 completed stage를 재실행하지 않는다.
- [x] **AC11:** repository marker 불일치 시 영향받은 근거·단계만 재검증한다. slug·입력 경계·계획 분기·산출물 상태가 충돌하거나 경계를 바꿀 수 있으면 자동 덮어쓰지 않고 중단한다.
  - Evidence (R008 final PASS): 동일 contract suite의 staleness scenarios; stale evidence 재사용 또는 conflicting artifact overwrite는 실패다.
- [x] **AC12:** loop는 goal artifact에 모든 원래 AC의 최신 직접 증거, unchanged revision의 최종 검증·누적 리뷰, `Completion Decision`, `update_goal complete`가 확인된 뒤에만 전체 성공을 보고한다.
  - Evidence (R008 final PASS): 동일 contract suite의 completion scenario; 조기 성공, 누락 AC, stale revision, complete 호출 누락·중복은 실패다.
- [x] **AC13:** README는 직접 호출, shorthand, 고정 순서, plan 분기, 추천 자동 선택 경계, live continuation과 persisted provenance의 차이, 안전·권한 하드 게이트, 중단·재개 예시, standalone 스킬 호환성을 설명한다.
  - Evidence (R008 final PASS): 동일 contract suite의 README subtest와 문서 inspection; 필수 surface·권한 경계·예시 누락 또는 구현 계약 불일치는 실패다.
- [x] **AC14:** 신규 closed list, additions upgrade/recovery authority, 승인·반환·중단·재개 계약을 검증하는 affected tests 및 전체 `npm test`와 `npm run check`가 통과하고 기존 스킬·설치·transaction·hook 동작에 회귀가 없다.
  - Evidence (R008 final PASS): contract/hook 25/25, transaction/install 73/73, `npm run check` exit 0, `npm test` tests 174/pass 172/fail 0/skipped 2, `git diff --check` exit 0; implementation boundary remains exactly 15 paths, with no `.csx/loops`, generated `.agents`, or receipt source diff.

## Execution Goals

### G001: loop orchestration 및 명시적 routing surface

- Classification: accepted scope
- Dependencies: None
- Owner: `csx-executor`
- Files:
  - `payload/skills/csx-loop/SKILL.md`
  - `payload/skills/csx-loop/agents/openai.yaml`
  - `payload/hooks/csx-hook.mjs`
  - `test/hook.test.js`
- Criteria: AC1, AC3, AC4, AC5, AC7, AC8, AC9, AC10, AC11, AC12, AC14
- Required result: direct/shorthand와 두 resume 형식만 라우팅하고, 고정 child 순서·정확히 한 plan·direct-start→plan 매핑·bounded single-use live authority·안전한 Recommended 자동 선택·stable blocking/resume·hard gate·최종 completion gate·explicit-only metadata를 정의한다.
- Verification: `node --check payload/hooks/csx-hook.mjs && node --test test/hook.test.js`; 신규 SKILL과 metadata 계약 inspection.
- Expected result: 네 loop 형식과 ordered authority 계약이 존재하고 negative prompt는 빈 출력이다.
- Failure signal: route 누락/false positive/회귀/syntax/subprocess 실패, plan 생략·중복, enum-only 승인, hard-gate 우회.
- Stop conditions: persisted-only authority나 새 runtime/state가 필요함; 승인 기준으로 정확히 한 plan을 선택할 수 없음; 비가역·추가 권한 포함 필요; `BLOCKING_USER_DECISION`.
- Status: complete
- Current evidence: R008 F003 repair executor/deslop PASS — `node --test test/skill-contract.test.js` before/after tests 22/pass 22/fail 0; draft-only incomplete-spec checkpoint and exact answer/resume boundary added without changing the persisted field set. R002 hook evidence remains current.
- Deslop: passed/no-op for F003 at R008; trust-boundary repetition is intentional. Earlier R002 hook cleanup remains current.

### G002: loop-aware child contracts와 사용자 문서

- Classification: accepted scope
- Dependencies: G001 `ready_for_review`
- Owner: `csx-executor`
- Files:
  - `payload/skills/csx-spec/SKILL.md`
  - `payload/skills/csx-plan/SKILL.md`
  - `payload/skills/csx-plan-pro/SKILL.md`
  - `payload/skills/csx-start-goal/SKILL.md`
  - `test/skill-contract.test.js`
  - `README.md`
- Criteria: AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14
- Required result: G001의 context fields/lifecycle/plan mapping/block vocabulary를 바꾸지 않고 valid loop child-return과 invalid/standalone 보존, BLOCKED 반환, READY/동일-version CLEAR+APPROVED gate, immutable body, start-goal entry 검증·소비, `BLOCKED: invalid loop approval context`, 계약 테스트 및 사용자 문서를 완성한다.
- Verification: `node --test test/skill-contract.test.js`.
- Expected result: loop와 standalone 분기, authority/gate/completion 시나리오, README 계약이 모두 통과한다.
- Failure signal: spec 자체 downstream, plan mapping 누락, pro 조기 실행, enum/unrelated approval, standalone 자동 실행, immutable body 변경, 문서 누락.
- Stop conditions: G001 fields/lifecycle와 다른 계약이 필요함; standalone 약화; 기존 review/retry/immutable 규칙 변경; `BLOCKING_USER_DECISION`.
- Status: complete
- Current evidence: R008 F003 repair executor/deslop PASS — exact behavior lock `node --test test/skill-contract.test.js` before/after exit 0, tests 22/pass 22/fail 0; producer/consumer draft checkpoint relation and negative authority cases pass. R004 standalone child-return evidence remains current.
- Deslop: passed/no-op at R008; repeated schema/authority and draft trust-boundary prose is intentional.

### G003: exact absent additions transaction authority

- Classification: accepted scope
- Dependencies: None
- Owner: `csx-executor`
- Files:
  - `lib/installation-state.js`
  - `lib/transaction.js`
  - `test/transaction.test.js`
- Criteria: AC2, AC14
- Required result: `additions = []`의 exact receipt-owned 검증, root-local/resolved unique/non-overlap/absent/frozen additions, normalize/declaration/manifest/locked snapshot/bridge/recovery 보존, lock 후 absent 재검증, exact authority와 write subset, fail-closed mismatch, legacy `[]`, exact absent preimage 복구를 구현한다.
- Verification: `node --test test/transaction.test.js`.
- Expected result: exact absent additions와 legacy `[]`만 허용되고 exactness/recovery tests가 통과한다.
- Failure signal: invalid addition 수용, omission, authority 밖 snapshot/write, mismatch 수용, legacy의 새 path 권한 획득.
- Stop conditions: exact ownership 약화 필요; lock 후 검사 불가; recovery가 variant union을 요구함; 외부 migration 또는 지원 범위 확장 필요.
- Status: complete
- Current evidence: R006 F002 repair executor/deslop PASS — exact behavior lock `node --test test/transaction.test.js` before/after exit 0, tests 35/pass 35/fail 0; same-union/different-split rejection and exact-next-candidate recovery passed; `git diff --check` exit 0.
- Deslop: passed/no-op at R006; split validation remains intentionally repeated across trust boundaries.

### G004: installer closed list, pre-loop migration, crash recovery 및 uninstall

- Classification: accepted scope
- Dependencies: G001 + G003 `ready_for_review`
- Owner: `csx-executor`
- Files:
  - `lib/install.js`
  - `test/install.test.js`
- Criteria: AC2, AC14
- Required result: G001의 두 payload destination과 G003 additions/recovery interface를 변경 없이 소비해 `SKILLS`, project/global exact receipt, current/pre-loop/verifier candidates, candidate-specific additions, receipt-last·rollback·recovery·uninstall, 실제 migration과 crash/reentry 검증을 완성한다.
- Verification: `node --test test/install.test.js`.
- Expected result: project/global 설치, exact migration, crash recovery의 current receipt 수렴, pre-loop/upgraded uninstall이 통과한다.
- Failure signal: declaration 거부, loop file/receipt 누락·중복, partial addition, mixed config/receipt generation, recovery mismatch, 임의 제거, rollback/uninstall 회귀.
- Stop conditions: additions가 정확히 두 경로가 아님; 더 넓은 권한 필요; exact receipt rejection 약화 필요; generated artifact 편집 필요.
- Status: complete
- Current evidence: R007 F001/F002 repair executor/deslop PASS — exact behavior lock `node --test test/install.test.js` before/after exit 0, tests 38/pass 38/fail 0; same-union wrong-split rejection, exact next candidate, upgrade crash recovery, direct pre-loop uninstall SIGKILL re-entry, receipt-owned deletion and idempotence passed; `git diff --check` exit 0.
- Deslop: passed/no-op at R007; candidate separation and crash-timing assertions remain required direct evidence.

## Dependency and Ordered Handoffs

- G001과 G003은 독립적이며 파일이 겹치지 않아 병렬 실행할 수 있다.
- G002는 G001이 현재 executor/deslop 증거와 함께 `ready_for_review`가 된 뒤 G001 context fields, lifecycle, plan mapping, block vocabulary를 변경 없이 인계받는다.
- G004는 G001과 G003이 모두 `ready_for_review`가 된 뒤 G001의 두 payload destination과 G003 additions/recovery interface를 변경 없이 인계받는다.
- G002와 G004는 각 dependency가 충족된 뒤 서로 병렬 실행할 수 있다.
- 한 path에는 항상 한 owner만 둔다. downstream이 upstream path 변경을 필요로 하면 직접 수정하지 않고 upstream goal을 `rework`로 되돌린다.

## Boundary Review

Status: **CLEAR (reused)**

- Source: 승인된 pro plan `draft_version: 2`의 Architect `CLEAR`.
- Coverage: 동일한 child composition, live/provenance 권한 경계, exact additions migration/recovery, standalone 호환성 및 15개 구현 경로.
- Invalidation: 승인된 v2의 public interface, persisted-data, permission/security, migration, concurrency, cross-module dependency 또는 operational boundary를 벗어나거나 새 경계를 도입하면 재사용을 중단하고 새 boundary review가 필요하다.

## Final Verification

Status: **passed**; iteration 3/3 at unchanged R008.

모든 G001–G004가 current executor/deslop 증거와 함께 `ready_for_review`가 된 unchanged revision에서만 시작한다. 실행 전 cumulative counter를 증가시키고 다음을 중복 없이 수행한다.

1. `node --test test/skill-contract.test.js test/hook.test.js`
2. `node --test test/transaction.test.js test/install.test.js`
3. `npm run check`
4. `npm test`
5. `git diff --check`
6. `git status --short`와 cumulative diff로 15개 구현 경계 및 generated `.agents`/receipt 부재 확인
7. `find .csx -maxdepth 2 -type d -name loops -print`가 빈 출력인지 확인

Current result: PASS — contract/hook 25/25; transaction/install 73/73; `npm run check` exit 0; `npm test` tests 174/pass 172/fail 0/skipped 2; `git diff --check` exit 0; exact 15-path implementation boundary confirmed; no `.csx/loops`, generated `.agents`, or receipt source diff.

## Review

Status: **APPROVE** at R008; iteration 3/3 complete.

- Final cumulative verification이 동일 revision에서 성공한 뒤 `$csx-code-review`를 호출한다.
- Cumulative code-reviewer lane은 필수다.
- reused boundary를 벗어나는 새 architectural boundary가 final diff에 있을 때만 Architect lane을 추가한다.
- accepted-scope 또는 change-induced safety/regression finding만 blocking이며 stable `Fnnn`을 부여한다.
- F001 (`change-induced safety/regression`, G004): interrupted direct pre-loop uninstall has no exact `additions: []` recovery candidate; repair 1/2 reserved.
- F002 (`accepted-scope defect`, G003+G004): recovery authority loses the candidate-specific receipt-owned/additions split when path unions are equal; repair 1/2 reserved.
- F003 (`accepted-scope defect`, G001+G002): RESOLVED at R008 — incomplete-spec-only BLOCKED draft checkpoint, exact persisted-field validation before live-stage derivation, exact answer/resume re-entry, and mismatch/final-authority negative coverage.
- Current verdict: APPROVE — Code Reviewer APPROVE, Architect CLEAR. F001, F002, and F003 are resolved with direct current regression evidence.

## Completion Decision

Status: **complete at R008**

G001–G004 are complete. AC1–AC14 all have current R008 direct evidence, final cumulative verification iteration 3/3 passed at unchanged R008, cumulative review iteration 3/3 returned Code Reviewer `APPROVE` and Architect `CLEAR`, and no later product change invalidated either result. The aggregate goal is authorized for the single `update_goal complete` transition; its tool confirmation is recorded by the goal service.
