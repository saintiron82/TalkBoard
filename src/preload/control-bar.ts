import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("talkagent", {
  startOrchestration: (args: unknown) =>
    ipcRenderer.invoke("orchestrate:start", args),
  stop: () =>
    ipcRenderer.invoke("orchestrate:stop"),
  resume: (additionalRounds?: number) =>
    ipcRenderer.invoke("orchestrate:resume", additionalRounds),
  canResume: () =>
    ipcRenderer.invoke("orchestrate:canResume") as Promise<boolean>,
  reset: () =>
    ipcRenderer.invoke("orchestrate:reset"),
  configureSlots: (slots: unknown) =>
    ipcRenderer.invoke("slots:configure", slots),

  googleLogin: () =>
    ipcRenderer.invoke("google:login"),

  resetPanel: (slotId: string) =>
    ipcRenderer.invoke("panel:reset", slotId),
  goBackPanel: (slotId: string) =>
    ipcRenderer.invoke("panel:goBack", slotId),

  searchVault: (query: string) =>
    ipcRenderer.invoke("vault:search", query),
  listTopics: () =>
    ipcRenderer.invoke("vault:listTopics"),
  listSessions: (topicId: string) =>
    ipcRenderer.invoke("vault:listSessions", topicId),

  onStatusUpdate: (callback: (status: unknown) => void) => {
    ipcRenderer.on("orchestrator:statusUpdate", (_event, status) => callback(status));
  },
});
