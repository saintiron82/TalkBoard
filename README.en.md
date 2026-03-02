# TalkBoard

**Multi-AI Debate Orchestrator** -- Run ChatGPT, Gemini, and Claude side by side in a single window. Enter one prompt and let the AIs debate.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

---

## Features

- **Side-by-side AI panels** -- ChatGPT, Gemini, and Claude loaded as live web panels within a single Electron window. No API keys required; you use your own logged-in sessions.
- **Slot-based configuration** -- Freely add, remove, and reorder AI and user slots. Attach per-slot system instructions to shape each participant's role.
- **Three orchestration modes** -- Sequential (turn-by-turn), Parallel (all at once), and Reactive (respond to the previous answer) to fit different debate styles.
- **Structured debate history** -- Every round is captured and stored in `~/DebateVault/` organized by topic, session, and round for easy review and export.
- **Full-text search** -- Search across all past debates instantly from the control bar.
- **5-Layer capture stabilization** -- A robust pipeline (debounce, streaming check, readySignals, text stability, post-delay) ensures responses are captured only after generation is fully complete.
- **Zero runtime dependencies** -- Only dev dependencies (Electron, TypeScript, @types/node). The production bundle ships lean.

## Screenshots

<!-- Add screenshots here -->

## Quick Start

### Prerequisites

- **Node.js** 18 or later
- **npm**

### Install

```bash
git clone https://github.com/saintiron82/TalkBoard.git
cd TalkBoard
npm install
```

### Run

```bash
npm run dev
```

### First Run

On the first launch, each AI panel loads its respective web interface. Log into ChatGPT, Gemini, and Claude directly inside their panels. Your sessions persist across restarts. Google login cookies are shared, so a single Google sign-in applies to all panels that support it.

## Usage

### Slot Configuration

TalkBoard ships with three default slots: **GPT**, **Gemini**, and **Claude**. You can customize the lineup from the control bar:

- **Add** a new AI or user slot
- **Remove** any existing slot
- **Reorder** slots via drag-and-drop to control the speaking order
- **Per-slot instructions** -- attach custom system prompts to each slot to assign roles (e.g., "Argue for", "Argue against", "Moderate")

### Orchestration Modes

| Mode | Behavior |
|------|----------|
| **Sequential** | Each slot takes a turn in order. The next participant sees all prior responses. |
| **Parallel** | All slots receive the prompt simultaneously. Responses are collected independently. |
| **Reactive** | Each slot responds to the immediately preceding answer, forming a chain of reactions. |

### Search

Use the search bar in the control panel to perform full-text search across your entire debate history. Results link directly to the relevant session and round.

## Data Storage

All debate data is stored locally in your home directory under `~/DebateVault/`:

```
~/DebateVault/
  topics/
    <topic-id>/
      topic.json              # Topic metadata
      sessions/
        <session-id>/
          session.json         # Session metadata
          rounds/
            round-001.json     # Round data with all captures
            round-002.json
            ...
```

No cloud sync, no external databases. Your data stays on your machine.

## Architecture

```
+------------------------------------------------------------------+
|  Electron BaseWindow                                             |
|                                                                  |
|  [Control Bar]          <- Prompt input, mode selection,         |
|                            slot config, search                   |
|  +------------------+------------------+------------------+      |
|  | GPT Panel        | Gemini Panel     | Claude Panel     |      |
|  | WebContentsView  | WebContentsView  | WebContentsView  |      |
|  | chat.openai.com  | gemini.google.com| claude.ai        |      |
|  +--------+---------+--------+---------+--------+---------+      |
|           |                  |                  |                |
|           +------------------+------------------+                |
|                              |                                   |
|                    [Orchestrator]                                 |
|                    Prompt injection + response capture            |
|                    (webContents.executeJavaScript)                |
|                              |                                   |
|                    [Vault Store]                                  |
|                    ~/DebateVault/ direct FS I/O                  |
+------------------------------------------------------------------+
```

## Project Structure

```
electron/
  src/
    main/
      main.ts              # App entry point (BaseWindow creation)
      panel-manager.ts     # Multi-panel + control bar layout
      orchestrator.ts      # Debate orchestration engine
      context-builder.ts   # Role/rule framing + prompt builder
      ipc-handlers.ts      # IPC handlers
      types.ts             # Type definitions
    injection/
      base.ts              # Shared utilities (5-Layer capture pipeline)
      chatgpt.ts           # ChatGPT selectors + readySignals
      gemini.ts            # Gemini selectors + readySignals
      claude.ts            # Claude selectors + readySignals
    lib/
      vault-store.ts       # ~/DebateVault/ direct FS I/O
      claude-bridge.ts     # Claude CLI bridge (optional)
    preload/               # Context-isolated preload scripts
    renderer/              # Control bar UI
  package.json
  tsconfig.json
```

## Contributing

Contributions are welcome. If you find a bug or have an idea for improvement:

1. Open an [issue](https://github.com/saintiron82/TalkBoard/issues) describing the problem or proposal.
2. Fork the repository and create a feature branch.
3. Submit a pull request with a clear description of the changes.

Please make sure your code compiles cleanly with `npx tsc --noEmit` before submitting.

## License

This project is licensed under the [MIT License](LICENSE).

---

[한국어](README.md)
