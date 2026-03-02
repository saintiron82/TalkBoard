# TalkBoard 아키텍처 문서

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [메인 프로세스 컴포넌트](#2-메인-프로세스-컴포넌트)
3. [인젝션 파이프라인](#3-인젝션-파이프라인)
4. [캡처 안정화 5-Layer Pipeline](#4-캡처-안정화-5-layer-pipeline)
5. [Vault Store 데이터 구조](#5-vault-store-데이터-구조)
6. [IPC 통신 흐름](#6-ipc-통신-흐름)

---

## 1. 시스템 개요

TalkBoard는 Electron 기반의 다중 AI 토론 오케스트레이션 시스템이다. 각 AI 서비스의 실제 웹 페이지를 WebContentsView로 로딩하여, 별도의 API 없이 브라우저 자동화 방식으로 프롬프트 주입과 응답 캡처를 수행한다. 모든 데이터는 로컬 파일시스템(`~/DebateVault/`)에 직접 저장된다.

```
+============================================================================+
|                         Electron BaseWindow                                |
|                                                                            |
| +------------------------------------------------------------------------+ |
| |                     Control Bar (WebContentsView)                       | |
| |  [주제 입력] [모드 선택] [라운드] [시작/중지] [검색] [슬롯 구성]       | |
| +------------------------------------------------------------------------+ |
|                                                                            |
| +-------------------+ +-------------------+ +-------------------+          |
| |   AI Panel #1     | |   AI Panel #2     | |   AI Panel #3     |   ...    |
| |  (WebContentsView)| |  (WebContentsView)| |  (WebContentsView)|          |
| |                   | |                   | |                   |          |
| |  chat.openai.com  | | gemini.google.com | |    claude.ai      |          |
| |                   | |                   | |                   |          |
| |                   | |                   | |                   |          |
| +-------------------+ +-------------------+ +-------------------+          |
|                                                                            |
| +-------------------+                                                      |
| |   User Panel      |  <-- 슬롯에 user 타입이 있을 때만 표시              |
| |  (WebContentsView)|                                                      |
| |  [사용자 입력 UI] |                                                      |
| +-------------------+                                                      |
|                                                                            |
+============================================================================+
        |                           |
        v                           v
+----------------+          +------------------+
|  Orchestrator  |          |   IPC Handlers   |
|  (main process)|  <-----> |  (main process)  |
+----------------+          +------------------+
        |
        v
+----------------+          +------------------+
|  Vault Store   |  ------> | ~/DebateVault/   |
|  (직접 FS I/O) |          | (로컬 파일시스템)|
+----------------+          +------------------+
        |
        v
+------------------+
| Claude CLI Bridge|  (선택적)
| spawn("claude")  |
+------------------+
```

**핵심 설계 원칙:**

- API 서버 없음 -- 모든 데이터 I/O는 Electron 메인 프로세스에서 파일시스템 직접 접근
- AI 서비스 웹 페이지를 그대로 로딩 -- 커스텀 채팅 UI를 만들지 않음
- `webContents.executeJavaScript()`를 통한 DOM 조작으로 프롬프트 주입 및 응답 캡처

---

## 2. 메인 프로세스 컴포넌트

### main.ts -- 앱 진입점

앱의 시작점으로서 다음을 담당한다:

- `BaseWindow` 생성 (프레임리스 또는 커스텀 타이틀바)
- `PanelManager` 초기화 및 레이아웃 배치
- IPC 핸들러 등록 (`ipc-handlers.ts` 위임)
- 앱 생명주기 이벤트 관리 (ready, window-all-closed 등)

```
app.whenReady()
    |
    +---> BaseWindow 생성
    +---> PanelManager 초기화
    +---> IPC 핸들러 등록
    +---> Control Bar WebContentsView 로딩
    +---> AI 패널 WebContentsView 로딩
```

### panel-manager.ts -- 패널 레이아웃 관리

다수의 WebContentsView를 동적으로 생성/삭제하고 레이아웃을 관리한다.

| 메서드 | 설명 |
|---|---|
| `configurePanels()` | 슬롯 설정 배열을 받아 패널을 동적으로 생성/삭제. 기존 패널과 차이를 계산하여 최소한의 변경만 수행 |
| `executeOnSlot()` | 특정 슬롯 ID의 WebContentsView에서 JavaScript를 실행. 인젝션 스크립트의 진입점 |
| `setSlotHighlight()` | 현재 활성 슬롯에 시각적 하이라이트를 표시하여 어떤 AI가 응답 중인지 사용자에게 표시 |
| `reloadAllLLMPanels()` | 모든 AI 패널을 새 대화 URL로 리로드. 토론 시작 시 깨끗한 상태 보장 |

**패널 레이아웃 계산:**

```
+------------------------------------------+
|             Control Bar (고정 높이)        |
+----------+----------+----------+---------+
|  Slot 0  |  Slot 1  |  Slot 2  | Slot N  |
|  (균등   |  (균등   |  (균등   | (균등   |
|   분할)  |   분할)  |   분할)  |  분할)  |
+----------+----------+----------+---------+
|          User Panel (조건부 표시)          |
+------------------------------------------+
```

### orchestrator.ts -- 토론 오케스트레이션 엔진

토론의 전체 생명주기를 관리하는 핵심 컴포넌트이다.

| 메서드 | 설명 |
|---|---|
| `start()` | 토론 시작. Vault에 토픽/세션을 생성하고, 패널을 리로드한 뒤 라운드 루프 진입 |
| `runLoop()` | 라운드 반복 실행 (1 ~ maxRounds). 각 라운드마다 runSequential 또는 runParallel 호출 |
| `runSequential()` | 슬롯 순서대로 하나씩 실행. 이전 슬롯의 응답이 다음 슬롯의 컨텍스트에 포함됨 |
| `runParallel()` | 프로바이더 그룹별 병렬 실행. 같은 프로바이더 내 슬롯은 순차, 다른 프로바이더는 동시 |
| `injectWithRetry()` | 실패 시 재시도 로직. 타임아웃 에러는 재시도 없이 건너뜀, 비타임아웃 에러는 1회 재시도 |
| `injectAndCapture()` | 인젝션 스크립트를 실행하고 응답 완료를 대기. inactivity timeout(30초) + hard cap(5분) 적용 |
| `waitForUserInput()` | 사용자 슬롯 차례에서 입력을 기다림. User Panel을 활성화하고 IPC로 입력 수신 |

**토론 실행 흐름:**

```
start()
  |
  +---> createTopic() / createSession()  (Vault Store)
  +---> reloadAllLLMPanels()
  +---> runLoop()
          |
          +---> [Round 1]
          |       +---> runSequential() 또는 runParallel()
          |               +---> buildPrompt()  (context-builder)
          |               +---> injectWithRetry()
          |               |       +---> injectAndCapture()
          |               |       +---> saveCapture()  (Vault Store)
          |               +---> (다음 슬롯 반복)
          |
          +---> [Round 2]
          |       +---> (동일 과정, 이전 라운드 응답이 컨텍스트에 포함)
          |
          +---> ... [Round N]
          |
          +---> 완료 / 중지
```

### context-builder.ts -- 프롬프트 빌더

각 슬롯에 주입할 프롬프트를 조립한다. 핵심은 "아직 보지 못한 응답"만 선별적으로 포함하는 것이다.

| 메서드 | 설명 |
|---|---|
| `getUnseenResponses()` | 해당 슬롯이 아직 보지 못한 응답을 추출. 인덱스 기반으로 자신의 이전 응답은 제외하고, 현재 라운드에서 자신보다 앞서 실행된 슬롯의 응답을 포함 |
| `buildPrompt()` | instruction(역할/관점) + unseen responses + base prompt(토론 주제)를 하나의 프롬프트로 조합 |

**프롬프트 구성 예시:**

```
[역할 지침]
당신은 보수적 관점에서 토론에 참여합니다.

[이전 응답 - 아직 보지 못한 것들]
--- GPT의 응답 (Round 1) ---
(GPT의 응답 내용)

--- Gemini의 응답 (Round 1) ---
(Gemini의 응답 내용)

[토론 주제]
AI가 인간의 창의성을 대체할 수 있는가?
```

### ipc-handlers.ts -- IPC 핸들러

Renderer(Control Bar)와 Main Process 간의 통신을 담당한다.

| 채널 | 방향 | 설명 |
|---|---|---|
| `orchestrate:start` | Renderer -> Main | 토론 시작 (주제, 모드, 라운드 수, 슬롯 구성) |
| `orchestrate:stop` | Renderer -> Main | 토론 일시정지 |
| `orchestrate:resume` | Renderer -> Main | 토론 재개 |
| `orchestrate:reset` | Renderer -> Main | 토론 초기화 (새 주제 준비) |
| `slots:configure` | Renderer -> Main | 슬롯 구성 변경 (추가/삭제/순서변경/타입변경) |
| `user:submitInput` | Renderer -> Main | 사용자 슬롯 입력 제출 |
| `vault:search` | Renderer -> Main | 키워드로 Vault 전체 검색 |
| `vault:listTopics` | Renderer -> Main | 토픽 목록 조회 |
| `vault:listSessions` | Renderer -> Main | 특정 토픽의 세션 목록 조회 |
| `google:login` | Renderer -> Main | Google 로그인 팝업 실행 및 쿠키 전파 |

---

## 3. 인젝션 파이프라인

`injection/` 디렉토리에는 각 AI 프로바이더별 DOM 조작 스크립트가 문자열로 정의되어 있다. 이 스크립트들은 `webContents.executeJavaScript()`를 통해 각 패널의 웹 페이지 컨텍스트에서 실행된다.

### base.ts -- 공통 유틸리티

모든 프로바이더가 공유하는 핵심 함수들을 제공한다.

| 함수 | 설명 |
|---|---|
| `resolveSelector()` | 다중 셀렉터를 순차적으로 시도하여 첫 번째로 매칭되는 요소 반환. AI 서비스의 DOM 구조 변경에 대한 방어 |
| `waitForElement()` | MutationObserver 기반으로 특정 셀렉터의 요소가 DOM에 나타날 때까지 대기 |
| `injectText()` | textarea 또는 contentEditable 요소에 텍스트를 주입. 3단계 전략 적용 |
| `observeResponse()` | 5-Layer 캡처 파이프라인을 실행하여 AI 응답 완료를 감지하고 텍스트를 추출 |
| `verifyTextStability()` | 일정 간격으로 텍스트를 반복 비교하여 스트리밍이 완전히 종료되었는지 검증 |

**텍스트 주입 3단계 전략:**

```
1단계: document.execCommand("insertText")
       |
       +---> 성공 시 완료
       +---> 실패 시 2단계로

2단계: ClipboardEvent (paste 이벤트 디스패치)
       |
       +---> 성공 시 완료
       +---> 실패 시 3단계로

3단계: 직접 textContent/value 설정 + Input 이벤트 디스패치
```

각 단계 후에 React/프레임워크의 상태 동기화를 위해 `input`, `change` 이벤트를 디스패치한다.

### chatgpt.ts, gemini.ts, claude.ts -- 프로바이더별 설정

각 AI 서비스의 DOM 구조에 맞는 셀렉터와 동작을 정의한다.

| 구성 항목 | 설명 | 예시 |
|---|---|---|
| 입력 셀렉터 | 프롬프트를 입력할 textarea/contentEditable | `#prompt-textarea`, `div[contenteditable]` |
| 전송 버튼 셀렉터 | 메시지 전송 버튼 | `button[data-testid="send-button"]` |
| 응답 셀렉터 | AI 응답 메시지 컨테이너 | `.message-content`, `.model-response` |
| 스트리밍 인디케이터 | 응답 생성 중임을 나타내는 요소 | stop 버튼, loading 스피너 |
| readySignals | 응답 완료 판단 조건 | present: 복사 버튼 출현 / absent: stop 버튼 소멸 |
| excludeSelectors | 캡처에서 제외할 요소 | thinking 블록, 코드 실행 UI 등 |

**셀렉터 해결 순서:**

```
chatgpt.ts의 입력 셀렉터 예시:
  [1] "#prompt-textarea"          (최신 버전)
  [2] "textarea[placeholder]"     (이전 버전 폴백)
  [3] "div[contenteditable]"      (대체 폴백)

resolveSelector()가 순서대로 시도 → 첫 매칭 반환
```

---

## 4. 캡처 안정화 5-Layer Pipeline

AI 서비스의 스트리밍 응답이 완전히 완료되었는지를 신뢰성 있게 판단하기 위한 다중 계층 검증 파이프라인이다.

```
+-------------------------------------------------------------------+
|                    observeResponse() 시작                          |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
| Layer 1: Streaming Check                                          |
|   스트리밍 인디케이터(stop 버튼, loading 등)가                     |
|   2회 연속 부재(absent)인지 확인                                   |
|   -> 아직 존재하면 대기 반복                                       |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
| Layer 2: Message Count                                            |
|   새 메시지가 기존 메시지 수보다 증가했는지 확인                    |
|   -> 증가하지 않았으면 아직 응답이 시작되지 않은 것                 |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
| Layer 3: Ready Signals                                            |
|   present 셀렉터 존재 확인 (예: 복사 버튼, 피드백 버튼)           |
|   absent 셀렉터 부재 확인 (예: stop 버튼, 로딩 스피너)            |
|   -> 두 조건 모두 충족해야 통과                                    |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
| Layer 4: Text Stability                                           |
|   3회 x 1500ms 간격으로 응답 텍스트를 비교                        |
|   -> 3회 모두 동일해야 통과 (스트리밍 완전 종료 확인)              |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
| Layer 5: Post-Capture Delay                                       |
|   500ms 대기 (React re-render 버퍼)                               |
|   -> 최종 DOM 상태가 안정화된 후 텍스트 추출                       |
+-------------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------------+
|                      캡처 완료 -> 텍스트 반환                      |
+-------------------------------------------------------------------+
```

### 보조 메커니즘

파이프라인 외에 다음 보조 메커니즘들이 병렬로 동작한다:

| 메커니즘 | 설명 |
|---|---|
| **MutationObserver** | DOM 변경을 실시간 감지. 변경이 감지되면 debounce 타이머를 리셋하고, 타이머 만료 시 verifyAndCapture(5-Layer) 트리거 |
| **Active Polling** | 2초 간격으로 스트리밍 인디케이터를 독립적으로 확인. MutationObserver가 놓칠 수 있는 상태 변화를 보완 |
| **Inactivity Timeout** | 30초간 DOM 변경이 없으면 타임아웃으로 판단. 응답이 생성되지 않거나 캡처 실패 상황 방지 |
| **Hard Cap** | 절대 최대 대기 시간 5분. 단, 스트리밍이 진행 중이면 30초 연장 허용 |
| **Heartbeat** | DOM 변경 시 메인 프로세스에 heartbeat를 전송. 메인 프로세스가 인젝션 스크립트의 생존 여부를 확인 가능 |

---

## 5. Vault Store 데이터 구조

모든 데이터는 `~/DebateVault/`에 파일시스템으로 직접 저장된다. API 서버를 경유하지 않으며, `vault-store.ts` 모듈이 모든 읽기/쓰기를 담당한다.

```
~/DebateVault/
|
+-- logs/                              <-- 원시 디버그 로그
|   +-- 2026-03-03.log
|   +-- ...
|
+-- topics/
    +-- topic_a1b2c3d4/
    |   +-- topic.json                 <-- 토픽 메타데이터
    |   +-- sessions/
    |       +-- sess_e5f6g7h8/
    |       |   +-- session.json       <-- 세션 메타데이터
    |       |   +-- rounds/
    |       |       +-- index.json     <-- 라운드 인덱스 (목록)
    |       |       +-- rnd_i9j0k1l2/
    |       |       |   +-- round.json <-- 라운드 메타데이터
    |       |       |   +-- gpt.md     <-- GPT 응답 원문
    |       |       |   +-- gemini.md  <-- Gemini 응답 원문
    |       |       |   +-- claude.md  <-- Claude 응답 원문
    |       |       |   +-- user.md    <-- 사용자 입력 (있는 경우)
    |       |       +-- rnd_m3n4o5p6/
    |       |           +-- ...
    |       +-- sess_q7r8s9t0/
    |           +-- ...
    +-- topic_u1v2w3x4/
        +-- ...
```

### 주요 JSON 스키마

**topic.json:**

```json
{
  "topic_id": "topic_a1b2c3d4",
  "title": "AI가 인간의 창의성을 대체할 수 있는가?",
  "description": "",
  "created_at": "2026-03-03T10:00:00Z",
  "session_count": 2
}
```

**session.json:**

```json
{
  "session_id": "sess_e5f6g7h8",
  "title": "Session 1",
  "round_count": 3,
  "status": "completed",
  "config": {
    "mode": "sequential",
    "max_rounds": 3,
    "slots": [
      { "id": "slot-0", "type": "chatgpt", "instruction": "" },
      { "id": "slot-1", "type": "gemini", "instruction": "보수적 관점에서 반박하세요" },
      { "id": "slot-2", "type": "claude", "instruction": "" }
    ]
  }
}
```

**rounds/index.json:**

```json
[
  {
    "round_id": "rnd_i9j0k1l2",
    "round_number": 1,
    "prompt_preview": "AI가 인간의 창의성을...",
    "capture_count": 3
  },
  {
    "round_id": "rnd_m3n4o5p6",
    "round_number": 2,
    "prompt_preview": "[이전 응답 참조] AI가...",
    "capture_count": 3
  }
]
```

**round.json:**

```json
{
  "round_id": "rnd_i9j0k1l2",
  "prompt": "AI가 인간의 창의성을 대체할 수 있는가?",
  "status": "completed"
}
```

---

## 6. IPC 통신 흐름

Renderer(Control Bar)에서 시작된 토론 요청이 각 AI 패널을 거쳐 다시 메인 프로세스로 돌아오는 전체 흐름이다.

```
[Renderer (Control Bar)]
    |
    |  ipcRenderer.invoke("orchestrate:start", {
    |    topic, mode, maxRounds, slots
    |  })
    |
    v
[Main Process (ipc-handlers.ts)]
    |
    |  orchestrator.start(args)
    |
    v
[Orchestrator]
    |
    |  (1) vault-store: createTopic(), createSession()
    |  (2) panelManager.reloadAllLLMPanels()
    |  (3) runLoop() 시작
    |
    |  --- 각 슬롯 실행 ---
    |
    |  panelManager.executeOnSlot(slotId, injectionScript)
    |
    v
[WebContentsView (AI Panel)]
    |
    |  executeJavaScript() -> injection script 실행
    |  -> injectText() -> 전송 버튼 클릭
    |  -> observeResponse() -> 5-Layer Pipeline
    |
    |  응답 캡처 완료
    |
    |  window.__talkagentIPC.sendToMain("response:captured", {
    |    slotId, text, timestamp
    |  })
    |
    v
[Preload (panel.ts)]
    |
    |  ipcRenderer.send("response:captured", data)
    |
    v
[Main Process (orchestrator IPC listener)]
    |
    |  resolve pending promise
    |  -> vault-store: saveCapture()
    |
    v
[Orchestrator -> 다음 슬롯 또는 다음 라운드]
```

### 양방향 통신 패턴

```
Renderer -> Main:  ipcRenderer.invoke()   (요청-응답, Promise)
Main -> Renderer:  webContents.send()     (단방향 이벤트)
Panel -> Main:     ipcRenderer.send()     (단방향 이벤트, 캡처 결과)
Main -> Panel:     executeJavaScript()    (코드 주입)
```

### 상태 업데이트 흐름

토론 진행 중 Control Bar에 실시간 상태를 표시하기 위한 흐름:

```
[Orchestrator]
    |
    |  상태 변경 발생 (라운드 시작, 슬롯 활성화, 캡처 완료 등)
    |
    v
[Main Process]
    |
    |  controlBarView.webContents.send("orchestrator:status", {
    |    state, currentRound, activeSlot, ...
    |  })
    |
    v
[Renderer (Control Bar)]
    |
    |  ipcRenderer.on("orchestrator:status", handler)
    |  -> UI 업데이트 (진행 표시, 슬롯 하이라이트 등)
```
