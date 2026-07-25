# Codex Plan 모드의 선택지와 Tab 노트 입력

## 결론

개인 플러그인의 Skill에서 Plan 모드의 root 모델에게 `request_user_input`을 호출하도록 지시하면 Codex 기본 TUI의 선택지와 Tab 노트 입력 UI를 그대로 사용할 수 있다.

다만 플러그인이 이 UI 컴포넌트나 내부 API를 직접 호출하는 구조는 아니다. Skill의 지침에 따라 root 모델이 Codex 내장 도구인 `request_user_input`을 호출하는 방식이다.

## 구현 흐름

### 1. 모델의 도구 호출

모델이 `request_user_input` 도구를 호출한다.

이 도구는 설정이 활성화된 경우 등록되며, `DirectModelOnly`로 root 모델에만 노출된다.

- [`codex-rs/core/src/tools/spec_plan.rs`](codex-rs/core/src/tools/spec_plan.rs)
- [`codex-rs/core/src/tools/handlers/request_user_input.rs`](codex-rs/core/src/tools/handlers/request_user_input.rs)

### 2. Core 이벤트 생성

Core는 `RequestUserInputEvent`를 발생시킨다. 질문 하나는 다음 정보를 가진다.

- `id`
- `header`
- `question`
- `options`
- `isOther`
- `isSecret`

응답은 질문 ID별 `Vec<String>` 구조다.

- [`codex-rs/protocol/src/request_user_input.rs`](codex-rs/protocol/src/request_user_input.rs)

### 3. TUI overlay 표시

TUI가 이벤트를 받아 `RequestUserInputOverlay`를 연다.

Plan 모드에서는 `PlanModePrompt` 알림을 표시한 뒤 bottom pane에 overlay를 넣는다.

- [`codex-rs/tui/src/chatwidget/tool_requests.rs`](codex-rs/tui/src/chatwidget/tool_requests.rs)
- [`codex-rs/tui/src/bottom_pane/mod.rs`](codex-rs/tui/src/bottom_pane/mod.rs)

### 4. 질문별 상태 관리

Overlay는 질문별로 다음 상태를 보관한다.

- 현재 선택된 option
- notes draft
- 답변 확정 여부
- notes 표시 여부
- `Options` 또는 `Notes` 포커스

텍스트 입력은 기존 `ChatComposer`를 plain-text 모드로 재사용한다.

- [`codex-rs/tui/src/bottom_pane/request_user_input/mod.rs`](codex-rs/tui/src/bottom_pane/request_user_input/mod.rs)

## Tab 동작

Options에 포커스가 있고 선택된 항목이 있는 상태에서 Tab을 누르면 포커스가 다음과 같이 전환된다.

```text
Focus::Options → Focus::Notes
```

그다음 노트를 입력하고 Enter를 누르면 선택값과 노트가 함께 제출된다.

Notes 상태에서 다시 Tab 또는 Esc를 누르면 현재 notes를 비우고 Options로 돌아간다. 따라서 노트를 전달하려면 다음 순서로 조작해야 한다.

```text
Tab → 노트 입력 → Enter
```

`isOther: true`인 질문에는 TUI가 다음 항목도 자동으로 추가한다.

```text
None of the above
Optionally, add details in notes (tab).
```

## 모델로 반환되는 형태

예를 들어 `PostgreSQL`을 선택하고 `버전은 16으로 해주세요`라고 입력하면 내부 응답은 대략 다음 형태다.

```json
{
  "answers": {
    "database": {
      "answers": [
        "PostgreSQL",
        "user_note: 버전은 16으로 해주세요"
      ]
    }
  }
}
```

노트는 별도 필드가 아니라 `user_note: ` 접두사가 붙은 추가 답변으로 저장된다.

- [`codex-rs/tui/src/bottom_pane/request_user_input/mod.rs`](codex-rs/tui/src/bottom_pane/request_user_input/mod.rs)
- [`codex-rs/tui/src/app_event_sender.rs`](codex-rs/tui/src/app_event_sender.rs)

## 개인 플러그인에서 사용하는 방법

개인 플러그인의 `SKILL.md`에 다음과 같은 지침을 추가할 수 있다.

```markdown
## 사용자 선택이 필요한 경우

구현 방향을 결정하기 전에 root thread에서 `request_user_input`을 호출한다.

- 질문은 1~3개로 제한한다.
- 각 질문에는 2~3개의 상호 배타적인 선택지를 제공한다.
- 권장 선택지를 첫 번째에 둔다.
- 사용자가 추가 조건을 전달할 수 있도록 일반 질문 형태를 사용한다.
- sub-agent에게 호출을 위임하지 않는다.
```

도구 호출 형태는 다음과 같다.

```json
{
  "questions": [
    {
      "header": "저장 방식",
      "id": "storage",
      "question": "어떤 저장 방식을 사용할까요?",
      "options": [
        {
          "label": "SQLite (Recommended)",
          "description": "설정이 간단하고 로컬 프로젝트에 적합합니다."
        },
        {
          "label": "PostgreSQL",
          "description": "동시 사용자와 서버 배포에 적합합니다."
        }
      ]
    }
  ]
}
```

## 제한 사항

- Plan 모드에서는 기본적으로 허용된다.
- Default 모드는 `DefaultModeRequestUserInput` feature가 켜진 경우에만 허용된다.
- sub-agent에서는 명시적으로 거부된다.
- Code mode의 nested executor에서도 사용할 수 없다.
- 플러그인 manifest에는 이 기능을 선언하거나 권한으로 요청하는 필드가 없다.
- MCP 서버가 Codex 내부 `request_user_input`을 직접 호출할 수도 없다. MCP elicitation은 별도 메커니즘이다.

모드 제한 관련 구현:

- [`codex-rs/tools/src/tool_config.rs`](codex-rs/tools/src/tool_config.rs)
- [`codex-rs/protocol/src/config_types.rs`](codex-rs/protocol/src/config_types.rs)

따라서 권장 구성은 개인 플러그인에 Skill을 넣고, 그 Skill이 Plan 모드의 root 모델에게 `request_user_input` 사용을 지시하는 방식이다. 이 방식은 TUI 코드를 복제하지 않고 현재 Codex UI를 그대로 활용한다.
