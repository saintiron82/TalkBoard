import { Menu, MenuItemConstructorOptions, BrowserWindow } from "electron";
import type { Orchestrator } from "./orchestrator";
import type { PanelManager } from "./panel-manager";

export function buildAppMenu(
  orchestrator: Orchestrator,
  panelManager: PanelManager
): Menu {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: "TalkBoard",
            submenu: [
              { role: "about" as const, label: "TalkBoard 정보" },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const, label: "TalkBoard 종료" },
            ],
          },
        ]
      : []),

    // File
    {
      label: "파일",
      submenu: [
        {
          label: "새 토론",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            orchestrator.reset();
            panelManager.reloadAllLLMPanels();
          },
        },
        { type: "separator" },
        isMac
          ? { role: "close", label: "닫기" }
          : { role: "quit", label: "종료" },
      ],
    },

    // Edit
    {
      label: "편집",
      submenu: [
        { role: "undo", label: "실행 취소" },
        { role: "redo", label: "다시 실행" },
        { type: "separator" },
        { role: "cut", label: "잘라내기" },
        { role: "copy", label: "복사" },
        { role: "paste", label: "붙여넣기" },
        { role: "selectAll", label: "전체 선택" },
      ],
    },

    // View
    {
      label: "보기",
      submenu: [
        {
          label: "전체 패널 리셋",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            panelManager.reloadAllLLMPanels();
          },
        },
        { type: "separator" },
        {
          label: "개발자 도구",
          accelerator: isMac ? "Cmd+Option+I" : "Ctrl+Shift+I",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.toggleDevTools();
            }
          },
        },
        { type: "separator" },
        { role: "resetZoom", label: "원래 크기" },
        { role: "zoomIn", label: "확대" },
        { role: "zoomOut", label: "축소" },
      ],
    },

    // Window
    {
      label: "윈도우",
      submenu: [
        { role: "minimize", label: "최소화" },
        { role: "togglefullscreen", label: "전체 화면" },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
