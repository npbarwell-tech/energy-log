/* PAT Manager — Electron main process.
 * Owns the data file (a single JSON database), rolling backups, file dialogs,
 * and report windows (print preview, print, save as PDF). */
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const CONFIG_FILE = () => path.join(app.getPath("userData"), "config.json");
const DEFAULT_DATA_FILE = () => path.join(app.getPath("documents"), "PAT Manager", "pat-manager-data.json");

let mainWin = null;
let config = { dataFile: null, lastBackupDay: null };

function readConfig() {
  try { config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"))); } catch (_) { /* first run */ }
  if (!config.dataFile) config.dataFile = DEFAULT_DATA_FILE();
}
function writeConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2));
}

/** Write via a temp file + rename so a crash or power cut never leaves a half-written database. */
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** One automatic backup per day into a Backups folder beside the data file; keeps the newest 30. */
function dailyBackup() {
  const file = config.dataFile;
  if (!fs.existsSync(file)) return;
  const day = new Date().toISOString().slice(0, 10);
  if (config.lastBackupDay === day) return;
  const dir = path.join(path.dirname(file), "Backups");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, `pat-manager-${day}.json`));
  const old = fs.readdirSync(dir).filter(f => /^pat-manager-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(30);
  old.forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ } });
  config.lastBackupDay = day;
  writeConfig();
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1400, height: 880, minWidth: 1024, minHeight: 640,
    title: "PAT Manager",
    icon: path.join(__dirname, "src", "icon.png"),
    backgroundColor: "#eef1f4",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWin.once("ready-to-show", () => { mainWin.maximize(); mainWin.show(); });
  mainWin.loadFile(path.join(__dirname, "src", "index.html"));
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  mainWin.on("close", e => {
    if (mainWin.__forceClose) return;
    e.preventDefault();
    mainWin.webContents.send("app:before-close");
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) { mainWin.__forceClose = true; mainWin.close(); } }, 1500);
  });
}

function buildMenu() {
  const send = ch => () => mainWin && mainWin.webContents.send("menu", ch);
  const tpl = [
    { label: "&File", submenu: [
      { label: "New Test…", accelerator: "CmdOrCtrl+T", click: send("new-test") },
      { label: "New Asset…", accelerator: "CmdOrCtrl+N", click: send("new-asset") },
      { type: "separator" },
      { label: "Import…", click: send("import") },
      { label: "Export Assets to CSV…", click: send("export-csv") },
      { type: "separator" },
      { label: "Back Up Now…", accelerator: "CmdOrCtrl+B", click: send("backup") },
      { label: "Restore from Backup…", click: send("restore") },
      { label: "Show Data Folder", click: () => shell.showItemInFolder(config.dataFile) },
      { type: "separator" },
      { role: "quit", label: "E&xit" }
    ] },
    { label: "&Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "&View", submenu: [
      { label: "Dashboard", accelerator: "CmdOrCtrl+1", click: send("go:dashboard") },
      { label: "Asset Register", accelerator: "CmdOrCtrl+2", click: send("go:assets") },
      { label: "Retest Planner", accelerator: "CmdOrCtrl+3", click: send("go:due") },
      { label: "Failures & Repairs", accelerator: "CmdOrCtrl+4", click: send("go:failures") },
      { label: "Reports", accelerator: "CmdOrCtrl+5", click: send("go:reports") },
      { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
      { role: "togglefullscreen" }, { role: "reload" }, { role: "toggleDevTools" }
    ] },
    { label: "&Help", submenu: [{ label: "About PAT Manager", click: send("about") }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------------- Reports: preview / print / PDF ---------------- */
function writeTempReport(html) {
  const f = path.join(os.tmpdir(), `pat-report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
  fs.writeFileSync(f, html);
  return f;
}

const DEFAULT_MARGINS = { top: 0.4, bottom: 0.5, left: 0.4, right: 0.4 }; // inches

async function savePdfFrom(webContents, rep, parent) {
  const r = await dialog.showSaveDialog(parent, { title: "Save PDF", defaultPath: path.join(app.getPath("documents"), rep.fileName || "report.pdf"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const buf = await webContents.printToPDF({
    pageSize: "A4", landscape: !!rep.landscape, printBackground: true, margins: rep.margins || DEFAULT_MARGINS,
    displayHeaderFooter: !!rep.footer, headerTemplate: "<span></span>", footerTemplate: rep.footer || "<span></span>"
  });
  fs.writeFileSync(r.filePath, buf);
  shell.openPath(r.filePath);
  return { ok: true, path: r.filePath };
}

ipcMain.handle("report:preview", (_e, { html, title, landscape, fileName, margins, footer }) => {
  const file = writeTempReport(html);
  const w = new BrowserWindow({
    width: landscape ? 1300 : 1000, height: 900, parent: mainWin, title: title || "Report preview",
    icon: path.join(__dirname, "src", "icon.png"), autoHideMenuBar: true, backgroundColor: "#525659",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  w.__report = { landscape: !!landscape, fileName: fileName || "report.pdf", margins, footer };
  w.loadFile(file);
  w.on("closed", () => { try { fs.unlinkSync(file); } catch (_) { /* ignore */ } });
  return true;
});
ipcMain.handle("report:print-self", e => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const rep = w.__report || {};
  const m = rep.margins || DEFAULT_MARGINS, px = v => Math.round(v * 96); // print() takes margins in pixels
  return new Promise(res => e.sender.print({ printBackground: true, landscape: !!rep.landscape, pageSize: "A4",
    margins: { marginType: "custom", top: px(m.top), bottom: px(m.bottom), left: px(m.left), right: px(m.right) } }, ok => res(ok)));
});
ipcMain.handle("report:pdf-self", e => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return savePdfFrom(e.sender, w.__report || {}, w);
});
ipcMain.handle("report:pdf", async (_e, rep) => {
  const file = writeTempReport(rep.html);
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try { await w.loadFile(file); return await savePdfFrom(w.webContents, rep, mainWin); }
  finally { w.destroy(); try { fs.unlinkSync(file); } catch (_) { /* ignore */ } }
});

/* ---------------- Database ---------------- */
ipcMain.handle("db:load", () => {
  const file = config.dataFile;
  let data = null, error = null;
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (err) { error = "Could not read the data file: " + err.message; }
  }
  return { path: file, data, error };
});
ipcMain.handle("db:save", (_e, json) => {
  try { dailyBackup(); } catch (_) { /* backups are best-effort */ }
  atomicWrite(config.dataFile, json);
  return { ok: true, savedAt: Date.now() };
});
ipcMain.handle("db:choose", async (_e, mode) => {
  if (mode === "open") {
    const r = await dialog.showOpenDialog(mainWin, { title: "Open PAT Manager data file", properties: ["openFile"], filters: [{ name: "PAT Manager data", extensions: ["json"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    config.dataFile = r.filePaths[0];
  } else {
    const r = await dialog.showSaveDialog(mainWin, { title: "Create new data file", defaultPath: DEFAULT_DATA_FILE(), filters: [{ name: "PAT Manager data", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return null;
    config.dataFile = r.filePath;
  }
  config.lastBackupDay = null;
  writeConfig();
  return config.dataFile;
});

/* ---------------- Generic files ---------------- */
ipcMain.handle("file:save", async (_e, { defaultName, content, filters, open }) => {
  const r = await dialog.showSaveDialog(mainWin, { defaultPath: path.join(app.getPath("documents"), defaultName), filters: filters || [] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, content, "utf8");
  if (open) shell.openPath(r.filePath);
  return { ok: true, path: r.filePath };
});
ipcMain.handle("file:open", async (_e, { filters, asDataUrl }) => {
  const r = await dialog.showOpenDialog(mainWin, { properties: ["openFile"], filters: filters || [] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  if (asDataUrl) {
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp" }[ext] || "application/octet-stream";
    return { name: path.basename(p), content: `data:${mime};base64,` + fs.readFileSync(p).toString("base64") };
  }
  return { name: path.basename(p), content: fs.readFileSync(p, "utf8") };
});
ipcMain.handle("shell:show-data", () => shell.showItemInFolder(config.dataFile));
ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataFile: config.dataFile, userData: app.getPath("userData") }));
ipcMain.on("app:close-ready", () => { if (mainWin && !mainWin.isDestroyed()) { mainWin.__forceClose = true; mainWin.close(); } });

/* ---------------- Lifecycle ---------------- */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("uk.patmanager.desktop");
    readConfig();
    buildMenu();
    createMainWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
