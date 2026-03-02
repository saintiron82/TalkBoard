import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__userPanelIPC", {
  onActivate: (callback: (data: unknown) => void) => {
    ipcRenderer.on("user-panel:activate", (_event, data) => callback(data));
  },
  onDeactivate: (callback: () => void) => {
    ipcRenderer.on("user-panel:deactivate", () => callback());
  },
  submitInput: (content: string) =>
    ipcRenderer.invoke("user:submitInput", content),
});
