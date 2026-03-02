# TalkBoard

**다중 AI 토론 오케스트레이터** -- ChatGPT, Gemini, Claude를 하나의 화면에서 동시에 운영하고, 자동으로 토론을 진행합니다.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Electron](https://img.shields.io/badge/Electron-34+-47848F.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6.svg)

---

## 목차

- [주요 기능](#주요-기능)
- [스크린샷](#스크린샷)
- [빠른 시작](#빠른-시작)
- [사용법](#사용법)
- [데이터 저장](#데이터-저장)
- [아키텍처](#아키텍처)
- [프로젝트 구조](#프로젝트-구조)
- [기여](#기여)
- [라이선스](#라이선스)

---

## 주요 기능

- **멀티 패널 동시 실행** -- ChatGPT, Gemini, Claude의 실제 웹 페이지를 나란히 열어 하나의 화면에서 비교하고 토론합니다. 별도의 API 키가 필요하지 않습니다.
- **자동 프롬프트 주입 및 응답 캡처** -- 프롬프트를 입력하면 각 AI에 자동으로 전달되고, 응답이 완료되면 캡처하여 다음 라운드에 맥락으로 전달합니다.
- **슬롯 기반 자유 구성** -- AI 슬롯과 사용자 슬롯을 자유롭게 추가, 제거, 재정렬할 수 있습니다. 같은 AI를 여러 개 배치하거나 사용자가 직접 토론에 참여하는 것도 가능합니다.
- **3가지 오케스트레이션 모드** -- Sequential(순차), Parallel(병렬), Reactive(반응형) 모드로 토론 흐름을 제어합니다.
- **구조적 토론 기록** -- 모든 토론 내역이 `~/DebateVault/`에 주제 > 세션 > 라운드 > 캡처 계층으로 저장되며, 전문 검색이 가능합니다.
- **캡처 안정화 5-Layer Pipeline** -- debounce, streaming 감지, readySignals 확인, 텍스트 안정성 검증, post-delay까지 5단계 파이프라인으로 응답 캡처의 정확도를 보장합니다.
- **런타임 의존성 0개** -- 프로덕션 의존성 없이 Electron, TypeScript, @types/node만으로 구동됩니다. 가볍고 투명한 구조입니다.

---

## 스크린샷

<!-- 스크린샷을 여기에 추가하세요 -->

---

## 빠른 시작

### Prerequisites

- **Node.js** 18 이상
- **npm** (Node.js에 포함)

### 설치

```bash
git clone https://github.com/saintiron82/TalkBoard.git
cd TalkBoard
npm install
```

### 실행

```bash
npm run dev
```

### 첫 실행 안내

앱이 열리면 ChatGPT, Gemini, Claude 패널이 각각 해당 서비스의 실제 웹 페이지를 로드합니다. **각 패널에서 직접 로그인**해야 합니다.

Google 계정 하나로 여러 서비스에 로그인하려면 컨트롤 바의 **G 버튼**을 눌러 Google 로그인을 진행하세요. 한 번 로그인하면 쿠키가 모든 패널에 공유되어 별도 로그인 없이 사용할 수 있습니다.

---

## 사용법

### 슬롯 구성

기본 구성은 **GPT + Gemini + Claude** 3개 슬롯입니다.

- **슬롯 추가**: `+` 버튼을 눌러 새 슬롯을 추가합니다.
- **슬롯 제거**: 각 슬롯의 `x` 버튼으로 제거합니다 (최소 1개는 유지).
- **타입 변경**: 드롭다운에서 GPT, Gemini, Claude, User 중 선택합니다.
- **순서 변경**: 슬롯을 드래그하여 순서를 바꿉니다. 패널 배치도 자동으로 업데이트됩니다.
- **개별 지침 설정**: 각 슬롯의 "지침" 입력란에 역할이나 규칙을 지정할 수 있습니다 (예: "반드시 반대 입장에서 논증하세요").

같은 타입의 슬롯을 여러 개 배치하면 자동으로 `GPT-1`, `GPT-2`와 같이 넘버링됩니다.

### 오케스트레이션 모드

| 모드 | 동작 | 적합한 상황 |
|------|------|-------------|
| **Sequential** | 슬롯 순서대로 하나씩 실행. 이전 슬롯의 응답을 다음 슬롯이 참조 | 체계적인 순차 토론 |
| **Parallel** | 같은 프로바이더 그룹은 순차, 다른 프로바이더는 동시 실행 | 빠른 병렬 비교 |
| **Reactive** | Sequential과 동일하되, 각 슬롯이 아직 보지 못한 응답만 맥락으로 전달 | 자연스러운 대화 흐름 |

### 라운드 조절

드롭다운에서 라운드 수(1~10)를 선택합니다. 토론 완료 후 "재개" 버튼으로 추가 라운드를 이어갈 수 있습니다.

### 검색

컨트롤 바의 검색창에 키워드를 입력하면 저장된 모든 토론 내역(주제, 프롬프트, 캡처)에서 실시간으로 검색합니다.

---

## 데이터 저장

모든 토론 기록은 `~/DebateVault/`에 다음 구조로 저장됩니다.

```
~/DebateVault/
  topics/
    topic_a1b2c3d4/
      topic.json                  ← 주제 메타데이터
      sessions/
        sess_e5f6g7h8/
          session.json            ← 세션 설정 (모드, 슬롯 구성 등)
          rounds/
            index.json            ← 라운드 목록 인덱스
            rnd_i9j0k1l2/
              round.json          ← 라운드 메타데이터 + 프롬프트
              gpt.md              ← GPT 응답 캡처
              gemini.md           ← Gemini 응답 캡처
              claude.md           ← Claude 응답 캡처
              user.md             ← 사용자 입력 (User 슬롯 사용 시)
```

파일 기반 저장이므로 별도의 데이터베이스가 필요 없으며, Git으로 버전 관리하거나 다른 도구로 직접 열어볼 수 있습니다. 모든 쓰기 작업은 임시 파일 + rename 방식의 원자적 쓰기로 수행되어 데이터 손실을 방지합니다.

---

## 아키텍처

```
+------------------------------------------------------------------+
|  Electron BaseWindow                                             |
|                                                                  |
|  [Control Bar]                                                   |
|   프롬프트 입력 | 모드 선택 | 라운드 설정 | 슬롯 구성 | 검색     |
|                                                                  |
|  +----------------+  +----------------+  +----------------+      |
|  | GPT Panel      |  | Gemini Panel   |  | Claude Panel   |      |
|  | WebContentsView|  | WebContentsView|  | WebContentsView|      |
|  | chat.openai.com|  | gemini.google  |  | claude.ai      |      |
|  +-------+--------+  +-------+--------+  +-------+--------+      |
|          |                    |                    |              |
|          +----------+---------+----------+--------+              |
|                     |                                            |
|             [Orchestrator]                                       |
|              프롬프트 주입 (executeJavaScript)                    |
|              응답 캡처 (5-Layer Pipeline)                         |
|              라운드 관리 + 맥락 전달                               |
|                     |                                            |
|             [Vault Store]                                        |
|              ~/DebateVault/ 직접 FS I/O                          |
+------------------------------------------------------------------+
```

핵심 설계 원칙:

- **API 서버 없음**: 모든 데이터 접근은 Electron 메인 프로세스에서 직접 파일시스템으로 수행
- **실제 웹 그대로 사용**: 각 AI 서비스의 웹 페이지를 WebContentsView로 로딩하여 별도의 커스텀 UI를 만들지 않음
- **DOM 주입 방식**: `webContents.executeJavaScript()`로 프롬프트를 입력하고 응답을 캡처
- **세션 격리**: 각 프로바이더는 독립적인 `persist:` 파티션을 사용하여 쿠키와 로그인 상태를 유지

---

## 프로젝트 구조

```
electron/
  src/
    main/                         ← Electron 메인 프로세스
      main.ts                       앱 진입점 (BaseWindow 생성)
      panel-manager.ts              패널 레이아웃 관리 (슬롯 기반 동적 생성/제거)
      orchestrator.ts               토론 오케스트레이션 엔진
      context-builder.ts            역할/규칙 프레이밍 + 프롬프트 빌더
      ipc-handlers.ts               IPC 핸들러 (시작/정지/검색/Google 로그인)
      types.ts                      타입 정의

    injection/                    ← 프로바이더별 DOM 주입 스크립트
      base.ts                       공통 유틸 (캡처 안정화 5-Layer Pipeline)
      chatgpt.ts                    ChatGPT 전용 셀렉터 + readySignals
      gemini.ts                     Gemini 전용 셀렉터 + readySignals
      claude.ts                     Claude 전용 셀렉터 + readySignals

    lib/                          ← 유틸리티
      vault-store.ts                ~/DebateVault/ 직접 FS I/O
      claude-bridge.ts              Claude CLI 브릿지 (선택 사항)
      debate-logger.ts              토론 로깅

    preload/                      ← 컨텍스트 격리 프리로드 스크립트
      control-bar.ts                컨트롤 바 IPC 노출
      user-panel.ts                 사용자 패널 IPC 노출

    renderer/                     ← UI
      control-bar.html / .css / .ts   컨트롤 바 UI
      user-panel.html / .css / .ts    사용자 입력 패널 UI

  package.json
  tsconfig.json
```

---

## 기여

기여를 환영합니다.

1. 이 저장소를 Fork합니다.
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/my-feature`).
3. 변경사항을 커밋합니다 (`git commit -m "feat: add my feature"`).
4. 브랜치에 Push합니다 (`git push origin feature/my-feature`).
5. Pull Request를 생성합니다.

버그 리포트, 기능 제안, 문서 개선 모두 [Issues](https://github.com/saintiron82/TalkBoard/issues)에서 받고 있습니다.

---

## 라이선스

이 프로젝트는 [MIT License](LICENSE)에 따라 배포됩니다.

---

[English](README.en.md)
