import { ipcMain, BrowserWindow, session } from "electron";
import type { PanelManager } from "./panel-manager";
import type { Orchestrator } from "./orchestrator";
import { PROVIDER_META, type Provider } from "./types";
import { listTopics, listSessions, searchVault } from "../lib/vault-store";

export function registerIpcHandlers(
  orchestrator: Orchestrator,
  panelManager: PanelManager
): void {
  ipcMain.handle("orchestrate:start", async (_event, args) => {
    return orchestrator.start(args);
  });

  ipcMain.handle("orchestrate:stop", async () => {
    orchestrator.stop();
    return { ok: true };
  });

  ipcMain.handle("orchestrate:resume", async (_event, additionalRounds?: number) => {
    return orchestrator.resume(additionalRounds);
  });

  ipcMain.handle("orchestrate:canResume", () => {
    return orchestrator.canResume();
  });

  ipcMain.handle("orchestrate:reset", () => {
    orchestrator.reset();
    return { ok: true };
  });

  ipcMain.handle("slots:configure", async (_event, slots) => {
    panelManager.configurePanels(slots);
    return { ok: true };
  });

  ipcMain.handle("user:submitInput", async (_event, content: string) => {
    return orchestrator.submitUserInput(content);
  });

  // Vault search / browsing
  ipcMain.handle("vault:search", async (_event, query: string) => {
    return searchVault(query);
  });

  ipcMain.handle("vault:listTopics", async () => {
    return listTopics();
  });

  ipcMain.handle("vault:listSessions", async (_event, topicId: string) => {
    return listSessions(topicId);
  });

  // Google login → inject cookies to all LLM partitions
  ipcMain.handle("google:login", async () => {
    return googleLoginAndInject(panelManager);
  });
}

/**
 * Open a Google sign-in window, wait for login completion,
 * then inject Google cookies into all LLM partitions and reload panels.
 */
async function googleLoginAndInject(panelManager: PanelManager): Promise<{ ok: boolean; error?: string }> {
  const AUTH_PARTITION = "persist:google-auth";

  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 500,
      height: 700,
      title: "Google 로그인",
      webPreferences: {
        partition: AUTH_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    authWin.loadURL("https://accounts.google.com/");

    // Track if login was successful by detecting navigation to myaccount/mail/etc.
    let loginDetected = false;

    authWin.webContents.on("did-navigate", (_event, url) => {
      // After Google login, user is redirected to myaccount.google.com or other Google pages
      if (
        url.includes("myaccount.google.com") ||
        url.includes("google.com/search") ||
        url.includes("mail.google.com") ||
        url.includes("google.com/?") ||
        (url.includes("google.com") && !url.includes("accounts.google.com/signin") && !url.includes("accounts.google.com/v3"))
      ) {
        loginDetected = true;
      }
    });

    authWin.on("closed", async () => {
      try {
        // Get all cookies from Google auth session
        const authSession = session.fromPartition(AUTH_PARTITION);
        const cookies = await authSession.cookies.get({ domain: ".google.com" });

        if (cookies.length === 0) {
          resolve({ ok: false, error: "No Google cookies found. Login may not have completed." });
          return;
        }

        console.log(`[GoogleLogin] Captured ${cookies.length} Google cookies`);

        // Inject cookies into all LLM partitions
        const providers: Provider[] = ["gpt", "gemini", "claude"];
        for (const provider of providers) {
          const targetPartition = PROVIDER_META[provider].partition;
          const targetSession = session.fromPartition(targetPartition);

          let injected = 0;
          for (const cookie of cookies) {
            try {
              const cookieDetails: Electron.CookiesSetDetails = {
                url: `https://${cookie.domain?.replace(/^\./, "") || "google.com"}${cookie.path || "/"}`,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain || undefined,
                path: cookie.path || undefined,
                secure: cookie.secure || undefined,
                httpOnly: cookie.httpOnly || undefined,
                sameSite: cookie.sameSite as "unspecified" | "no_restriction" | "lax" | "strict" | undefined,
              };
              if (cookie.expirationDate) {
                cookieDetails.expirationDate = cookie.expirationDate;
              }
              await targetSession.cookies.set(cookieDetails);
              injected++;
            } catch {
              // Some cookies may fail (e.g., __Host- prefixed) — skip silently
            }
          }
          console.log(`[GoogleLogin] Injected ${injected}/${cookies.length} cookies into ${targetPartition}`);
        }

        // Reload all LLM panels to pick up new cookies
        panelManager.reloadAllLLMPanels();

        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: (err as Error).message });
      }
    });
  });
}
