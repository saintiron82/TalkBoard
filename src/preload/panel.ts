import { contextBridge, ipcRenderer } from "electron";

const ALLOWED_CHANNELS = [
  "provider:ready",
  "provider:notLoggedIn",
  "response:captured",
  "provider:error",
  "provider:heartbeat",
];

contextBridge.exposeInMainWorld("__talkagentIPC", {
  sendToMain: (channel: string, data: unknown) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});
