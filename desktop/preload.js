"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  loadDb: () => ipcRenderer.invoke("db:load"),
  saveDb: json => ipcRenderer.invoke("db:save", json),
  chooseDb: mode => ipcRenderer.invoke("db:choose", mode),
  saveFile: opts => ipcRenderer.invoke("file:save", opts),
  openFile: opts => ipcRenderer.invoke("file:open", opts),
  showData: () => ipcRenderer.invoke("shell:show-data"),
  info: () => ipcRenderer.invoke("app:info"),
  previewReport: opts => ipcRenderer.invoke("report:preview", opts),
  pdfReport: opts => ipcRenderer.invoke("report:pdf", opts),
  printSelf: () => ipcRenderer.invoke("report:print-self"),
  pdfSelf: () => ipcRenderer.invoke("report:pdf-self"),
  onMenu: fn => ipcRenderer.on("menu", (_e, ch) => fn(ch)),
  onBeforeClose: fn => ipcRenderer.on("app:before-close", async () => { try { await fn(); } finally { ipcRenderer.send("app:close-ready"); } })
});
