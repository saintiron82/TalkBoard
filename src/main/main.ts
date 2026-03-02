import { app, BaseWindow } from "electron";
import { PanelManager } from "./panel-manager";
import { Orchestrator } from "./orchestrator";
import { registerIpcHandlers } from "./ipc-handlers";
import { readdirSync, unlinkSync } from "fs";
import path from "path";

// Ensure consistent userData path regardless of launch method
// (npx electron dist/main/main.js vs electron .)
app.name = "talkagent-electron";

// Prevent EPIPE crashes when stdout/stderr pipe is broken
// (e.g., launching from Finder, piped processes, or terminal closed)
process.stdout?.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
  throw err;
});
process.stderr?.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
  throw err;
});

let mainWindow: BaseWindow | null = null;
let panelManager: PanelManager | null = null;

/**
 * Clean up stale LevelDB LOCK files left by forced termination.
 * Without this, persist: partitions fail to open on next launch,
 * causing login sessions to be lost.
 */
function cleanStaleLocks(): void {
  const userDataPath = app.getPath("userData");
  const partitionsDir = path.join(userDataPath, "Partitions");

  try {
    const partitions = readdirSync(partitionsDir);
    for (const partition of partitions) {
      removeLockFiles(path.join(partitionsDir, partition));
    }
  } catch {
    // Partitions directory may not exist on first launch
  }

  // Also clean root session data
  removeLockFiles(userDataPath);
}

function removeLockFiles(dir: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeLockFiles(fullPath);
      } else if (entry.name === "LOCK") {
        try {
          unlinkSync(fullPath);
          console.log(`[TalkAgent] Removed stale lock: ${fullPath}`);
        } catch { /* in use = not stale */ }
      }
    }
  } catch { /* skip inaccessible dirs */ }
}

async function createWindow(): Promise<void> {
  mainWindow = new BaseWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: "TalkAgent — Multi-Panel Debate",
  });

  panelManager = new PanelManager(mainWindow);
  panelManager.createControlBar();

  const orchestrator = new Orchestrator(panelManager);
  registerIpcHandlers(orchestrator, panelManager);

  mainWindow.on("closed", () => {
    panelManager?.destroy();
    mainWindow = null;
    panelManager = null;
  });
}

app.whenReady().then(async () => {
  console.log("[TalkAgent] Cleaning stale locks...");
  cleanStaleLocks();
  console.log("[TalkAgent] Creating window...");
  await createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  }
});
