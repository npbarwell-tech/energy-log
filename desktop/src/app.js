/* PAT Manager — renderer. All data is one JSON document held in memory and saved
 * (debounced) to the data file by the main process. */
"use strict";
const S = window.PATStd;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const keyOf = no => String(no || "").trim().toUpperCase();
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return d ? `${d}/${m}/${y}` : iso; };
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + Number(n), 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const daysUntil = iso => Math.round((Date.parse(iso) - Date.parse(todayISO())) / 864e5);
const show = v => (v === null || v === undefined || v === "") ? "—" : String(v);
const RES = { pass: "Pass", fail: "Fail", na: "N/A" };
const icon = id => `<svg class="i"><use href="#i-${id}"/></svg>`;
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
const cmpNat = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/* ======================= Constants ======================= */
const VISUAL_ITEMS = [
  ["suitable", "Suitable for the environment and how it is used"],
  ["flex", "Flex/cable free from cuts, abrasion, crushing and taped joints"],
  ["cordgrip", "Cord grip secure at plug and equipment, no inner cores visible"],
  ["plug", "Plug undamaged — no cracks, burning or bent pins"],
  ["fuse", "Correct BS 1362 fuse of suitable rating fitted"],
  ["wiring", "Plug wiring correct and terminals tight (where plug can be opened)"],
  ["casing", "Casing/enclosure undamaged, covers and screws in place"],
  ["heat", "No signs of overheating, burning or discolouration"],
  ["controls", "Switches and controls work and are undamaged"],
  ["vent", "Vents clear, no contamination or liquid/dust ingress"],
  ["markings", "Rating plate, markings and warning labels legible"]
];
const visualLabel = k => (VISUAL_ITEMS.find(v => v[0] === k) || [k, k])[1];
const TYPES = ["Portable", "Hand-held", "Movable", "Stationary", "Fixed", "IT equipment", "Extension lead", "IEC lead", "Other"];
const CLASSES = [["I", "Class I"], ["II", "Class II"], ["III", "Class III"]];
const CSAS = ["", "0.5", "0.75", "1.0", "1.25", "1.5", "2.5", "4.0"];
const REPAIR_ACTIONS = [
  ["repaired", "Repaired — awaiting retest"],
  ["replaced-part", "Plug/fuse/lead replaced — awaiting retest"],
  ["removed", "Removed from service"],
  ["scrapped", "Scrapped / disposed of"],
  ["returned", "Returned to owner/supplier"],
  ["other", "Other"]
];
const RESULT_NAMES = { visual: "Visual", earth: "Earth continuity", ir: "Insulation", leak: "Leakage", polarity: "Polarity", functional: "Functional", rcd1: "RCD ×1", rcd5: "RCD ×5" };

function defaultSettings() {
  return {
    company: { name: "", address: "", phone: "", email: "", website: "", regNo: "", logo: "" },
    standard: "iet", interval: 12, dueWarnDays: 30,
    limits: JSON.parse(JSON.stringify(S.DEFAULT_LIMITS)),
    defaultEngineerId: "", defaultInstrumentId: "",
    labelLayout: "3x8", certNotes: "Equipment was inspected and tested in accordance with the standard shown. Items that failed have been labelled and the person responsible informed."
  };
}
const EMPTY_DB = () => ({ app: "pat-manager", version: 1, settings: defaultSettings(), clients: [], sites: [], locations: [], assets: [], tests: [], repairs: [], instruments: [], engineers: [] });

/* ======================= Persistence ======================= */
let db = EMPTY_DB();
let dataPath = "";
let saveTimer = null, saving = Promise.resolve(), dirty = false;

const store = {
  async load() {
    if (window.api) return window.api.loadDb();
    const raw = localStorage.getItem("pat-manager-db");
    return { path: "Browser storage (development mode)", data: raw ? JSON.parse(raw) : null };
  },
  async save(json) {
    if (window.api) return window.api.saveDb(json);
    localStorage.setItem("pat-manager-db", json); return { ok: true };
  }
};

function normalise(d) {
  const base = EMPTY_DB();
  const out = Object.assign(base, d || {});
  for (const k of ["clients", "sites", "locations", "assets", "tests", "repairs", "instruments", "engineers"]) if (!Array.isArray(out[k])) out[k] = [];
  const s = defaultSettings();
  out.settings = Object.assign(s, out.settings || {});
  out.settings.company = Object.assign(defaultSettings().company, out.settings.company || {});
  out.settings.limits = { iet: Object.assign({}, S.DEFAULT_LIMITS.iet, (out.settings.limits || {}).iet), en50699: Object.assign({}, S.DEFAULT_LIMITS.en50699, (out.settings.limits || {}).en50699) };
  return out;
}

function changed() {
  _idx = null;
  dirty = true;
  $("#sbSaved").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
  refreshChrome();
}
function flush() {
  clearTimeout(saveTimer);
  if (!dirty) return saving;
  dirty = false;
  const json = JSON.stringify(db);
  saving = saving.then(() => store.save(json)).then(() => {
    $("#sbSaved").textContent = "All changes saved " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }).catch(err => {
    dirty = true;
    $("#sbSaved").textContent = "⚠ Save failed";
    alert("Could not save the data file:\n" + (err && err.message || err));
  });
  return saving;
}

/* ======================= Indexes & derived state ======================= */
let _idx = null;
function idx() {
  if (_idx) return _idx;
  const m = arr => new Map(arr.map(x => [x.id, x]));
  const testsBy = new Map();
  for (const t of db.tests) { if (!testsBy.has(t.assetId)) testsBy.set(t.assetId, []); testsBy.get(t.assetId).push(t); }
  for (const l of testsBy.values()) l.sort(byDateDesc);
  const repairsBy = new Map();
  for (const r of db.repairs) { if (!repairsBy.has(r.assetId)) repairsBy.set(r.assetId, []); repairsBy.get(r.assetId).push(r); }
  for (const l of repairsBy.values()) l.sort((a, b) => cmpNat(b.date, a.date) || (b.created || 0) - (a.created || 0));
  _idx = { client: m(db.clients), site: m(db.sites), loc: m(db.locations), asset: m(db.assets), eng: m(db.engineers), inst: m(db.instruments), testsBy, repairsBy, byNo: new Map(db.assets.map(a => [keyOf(a.assetNo) + "|" + (a.clientId || ""), a])) };
  return _idx;
}
function byDateDesc(a, b) { return cmpNat(b.date, a.date) || (b.created || 0) - (a.created || 0); }
const testsFor = id => idx().testsBy.get(id) || [];
const latestFor = id => testsFor(id)[0];
const repairsFor = id => idx().repairsBy.get(id) || [];
const clientName = id => (idx().client.get(id) || {}).name || "";
const siteName = id => (idx().site.get(id) || {}).name || "";
const locName = id => (idx().loc.get(id) || {}).name || "";
const engName = id => (idx().eng.get(id) || {}).name || "";
const instName = id => { const i = idx().inst.get(id); return i ? [i.make, i.model, i.serial && `s/n ${i.serial}`].filter(Boolean).join(" ") : ""; };
const limitsFor = std => Object.assign({}, S.DEFAULT_LIMITS[std], (db.settings.limits || {})[std]);

/** Find assets by number (case-insensitive). The same number may exist under different clients. */
function findAssetsByNo(no) { const k = keyOf(no); return k ? db.assets.filter(a => keyOf(a.assetNo) === k) : []; }

function assetStatus(a) {
  if (a.retired) return { key: "retired", cls: "", txt: "Retired" };
  const last = latestFor(a.id);
  if (!last) return { key: "untested", cls: "info", txt: "Not tested" };
  if (last.overall === "fail") {
    const r = repairsFor(a.id).find(r => (r.created || 0) > (last.created || 0) || r.testId === last.id);
    return { key: "failed", cls: "fail", txt: r ? "Failed · " + (REPAIR_ACTIONS.find(x => x[0] === r.action) || ["", "Action logged"])[1].split(" —")[0] : "Failed", last, repair: r };
  }
  const d = last.nextDue ? daysUntil(last.nextDue) : null;
  if (d !== null && d < 0) return { key: "overdue", cls: "fail", txt: `Overdue ${-d}d`, last, days: d };
  if (d !== null && d <= Number(db.settings.dueWarnDays || 30)) return { key: "due", cls: "warn", txt: d === 0 ? "Due today" : `Due in ${d}d`, last, days: d };
  return { key: "pass", cls: "pass", txt: "Pass", last, days: d };
}

/* ======================= Scope (tree selection) ======================= */
let scope = { type: "all", id: "" };
const expanded = new Set();
function inScope(a, sc = scope) {
  if (sc.type === "all") return true;
  if (sc.type === "client") return a.clientId === sc.id;
  if (sc.type === "site") return a.siteId === sc.id;
  if (sc.type === "location") return a.locationId === sc.id;
  return true;
}
const scopedAssets = (incRetired = false) => db.assets.filter(a => inScope(a) && (incRetired || !a.retired));
function scopeLabel(sc = scope) {
  if (sc.type === "client") return clientName(sc.id);
  if (sc.type === "site") { const s = idx().site.get(sc.id); return s ? `${clientName(s.clientId)} › ${s.name}` : ""; }
  if (sc.type === "location") { const l = idx().loc.get(sc.id); const s = l && idx().site.get(l.siteId); return l ? `${clientName(s && s.clientId)} › ${s ? s.name : ""} › ${l.name}` : ""; }
  return "All clients";
}
function setScope(sc) { scope = sc; renderTree(); refreshChrome(); if (["dashboard", "assets", "due", "failures", "history"].includes(view)) render(); }

/* ======================= Find-or-create hierarchy ======================= */
function ensureClient(name) {
  name = String(name || "").trim(); if (!name) return "";
  let c = db.clients.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!c) { c = { id: uid(), name, created: Date.now() }; db.clients.push(c); _idx = null; }
  return c.id;
}
function ensureSite(clientId, name) {
  name = String(name || "").trim(); if (!name || !clientId) return "";
  let s = db.sites.find(x => x.clientId === clientId && x.name.toLowerCase() === name.toLowerCase());
  if (!s) { s = { id: uid(), clientId, name, created: Date.now() }; db.sites.push(s); _idx = null; }
  return s.id;
}
function ensureLocation(siteId, name) {
  name = String(name || "").trim(); if (!name || !siteId) return "";
  let l = db.locations.find(x => x.siteId === siteId && x.name.toLowerCase() === name.toLowerCase());
  if (!l) { l = { id: uid(), siteId, name, created: Date.now() }; db.locations.push(l); _idx = null; }
  return l.id;
}

/* ======================= Dialog helper ======================= */
/** Opens a modal. opts: { title, body (html), width, ok, okClass, cancel, extra: [{label, value, cls}], onOpen(dlg), onSubmit(dlg, value) -> false to keep open } */
function modal(opts) {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.style.width = (opts.width || 520) + "px";
    const extra = (opts.extra || []).map(b => `<button type="submit" class="btn ${b.cls || ""}" value="${b.value}">${b.label}</button>`).join("");
    d.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h3>${opts.title}</h3><span class="spacer"></span>${opts.headExtra || ""}<button type="button" class="x" data-close aria-label="Close">×</button></div>
      <div class="dlg-body">${opts.body || ""}</div>
      <div class="dlg-foot">${opts.footLeft || ""}<span class="spacer"></span>${extra}
        ${opts.cancel === false ? "" : `<button type="button" class="btn" data-close>${opts.cancel || "Cancel"}</button>`}
        ${opts.ok === false ? "" : `<button type="submit" class="btn ${opts.okClass || "primary"}" value="ok">${opts.ok || "OK"}</button>`}</div></form>`;
    document.body.appendChild(d);
    let result = null;
    const form = d.querySelector("form");
    $$("[data-close]", d).forEach(b => b.addEventListener("click", () => d.close()));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const value = (e.submitter && e.submitter.value) || "ok";
      const r = opts.onSubmit ? opts.onSubmit(d, value) : true;
      if (r === false) return;
      result = r === true || r === undefined ? value : r;
      d.close();
    });
    d.addEventListener("close", () => { d.remove(); resolve(result); if (opts.onClose) opts.onClose(result); });
    d.addEventListener("cancel", e => { if (opts.confirmClose && !confirm(opts.confirmClose)) e.preventDefault(); });
    d.showModal();
    if (opts.onOpen) opts.onOpen(d);
    const first = d.querySelector("[autofocus]") || d.querySelector(".dlg-body input:not([type=hidden]):not([disabled]), .dlg-body select, .dlg-body textarea");
    if (first) first.focus();
  });
}
const confirmBox = (title, msg, ok = "OK", okClass = "primary") => modal({ title, body: `<p style="margin:0;line-height:1.5">${msg}</p>`, ok, okClass, width: 440 }).then(r => r === "ok");
const fieldVal = (d, n) => { const el = d.querySelector(`[name="${n}"]`); if (!el) return ""; return el.type === "checkbox" ? el.checked : el.value.trim(); };
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel ?? "") === String(v) ? " selected" : ""}>${esc(label)}</option>`;
const dlist = (id, vals) => `<datalist id="${id}">${[...new Set(vals.filter(Boolean))].sort(cmpNat).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;

/* ======================= Views ======================= */
let view = "dashboard";
const VIEWS = {};
function go(v) {
  view = v;
  $$("#nav a").forEach(a => a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  render();
  $("#main").scrollTop = 0;
}
function render() { (VIEWS[view] || VIEWS.dashboard)(); }

function refreshChrome() {
  const all = db.assets.filter(a => !a.retired);
  let overdue = 0, failed = 0;
  for (const a of all) { const s = assetStatus(a); if (s.key === "overdue") overdue++; if (s.key === "failed" && !s.repair) failed++; }
  const calDue = db.instruments.filter(i => !i.retired && i.calDue && daysUntil(i.calDue) <= 30).length;
  const set = (id, n) => { const b = $(id); b.hidden = !n; b.textContent = n; };
  set("#badgeDue", overdue); set("#badgeFail", failed); set("#badgeCal", calDue);
  $("#sbScope").textContent = scopeLabel();
  $("#sbCounts").textContent = `${db.clients.length} clients · ${all.length} assets · ${db.tests.length} tests`;
  $("#sbFile").textContent = dataPath;
  $("#sbFile").title = dataPath;
}

/* ---------------- Tree ---------------- */
function renderTree() {
  const counts = { client: new Map(), site: new Map(), loc: new Map() }, worst = new Map();
  const rank = { overdue: 3, failed: 3, due: 2, untested: 1, pass: 0 };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const a of db.assets) {
    if (a.retired) continue;
    bump(counts.client, a.clientId); bump(counts.site, a.siteId); bump(counts.loc, a.locationId);
    const r = rank[assetStatus(a).key] || 0;
    for (const k of [a.clientId, a.siteId, a.locationId]) if (k && (worst.get(k) || 0) < r) worst.set(k, r);
  }
  const dot = id => { const w = worst.get(id) || 0; return `<span class="dot" style="background:${w === 3 ? "#ef4444" : w === 2 ? "#f59e0b" : w === 1 ? "#60a5fa" : "#34d399"}"></span>`; };
  const node = (type, id, label, cnt, hasKids, ic) => {
    const sel = scope.type === type && scope.id === id;
    return `<div class="node${sel ? " sel" : ""}" data-type="${type}" data-id="${id}" title="${esc(label)}">
      <span class="twist" data-twist>${hasKids ? (expanded.has(id) ? "▾" : "▸") : ""}</span>${icon(ic)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(label)}</span>${cnt ? `<span class="cnt">${cnt}</span>` : ""}${cnt ? dot(id) : ""}</div>`;
  };
  let h = `<ul><li>${node("all", "", "All clients", db.assets.filter(a => !a.retired).length, false, "dash")}</li>`;
  for (const c of [...db.clients].sort(byName)) {
    const sites = db.sites.filter(s => s.clientId === c.id).sort(byName);
    h += `<li>${node("client", c.id, c.name, counts.client.get(c.id), sites.length, "building")}`;
    if (expanded.has(c.id) && sites.length) {
      h += "<ul>";
      for (const s of sites) {
        const locs = db.locations.filter(l => l.siteId === s.id).sort(byName);
        h += `<li>${node("site", s.id, s.name, counts.site.get(s.id), locs.length, "pin")}`;
        if (expanded.has(s.id) && locs.length) h += "<ul>" + locs.map(l => `<li>${node("location", l.id, l.name, counts.loc.get(l.id), false, "room")}</li>`).join("") + "</ul>";
        h += "</li>";
      }
      h += "</ul>";
    }
    h += "</li>";
  }
  $("#tree").innerHTML = h + "</ul>";
}

/* ---------------- Dashboard ---------------- */
VIEWS.dashboard = () => {
  const list = scopedAssets();
  const st = list.map(a => ({ a, s: assetStatus(a) }));
  const cnt = k => st.filter(x => x.s.key === k).length;
  const ids = new Set(list.map(a => a.id));
  const year = todayISO().slice(0, 4);
  const testsYr = db.tests.filter(t => ids.has(t.assetId) && (t.date || "").startsWith(year));
  const passRate = testsYr.length ? Math.round(testsYr.filter(t => t.overall === "pass").length / testsYr.length * 100) : null;

  // Next 12 months of due tests (latest test per asset)
  const months = [];
  const now = todayISO().slice(0, 7);
  for (let i = 0; i < 12; i++) months.push(addMonths(now + "-01", i).slice(0, 7));
  const dueBy = new Map(months.map(m => [m, 0])); let over = 0;
  for (const { s } of st) {
    if (!s.last || s.last.overall !== "pass" || !s.last.nextDue) continue;
    const m = s.last.nextDue.slice(0, 7);
    if (m < now) over++; else if (dueBy.has(m)) dueBy.set(m, dueBy.get(m) + 1);
  }
  const maxBar = Math.max(1, over, ...dueBy.values());
  const bar = (label, v, cls = "") => `<div class="b" title="${v} due"><em>${v || ""}</em><div class="col ${cls}" style="height:${v / maxBar * 100}%"></div><span>${label}</span></div>`;
  const monthLbl = m => new Date(m + "-01T00:00").toLocaleDateString("en-GB", { month: "short" });

  const recent = db.tests.filter(t => ids.has(t.assetId)).sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 10);
  const cal = db.instruments.filter(i => !i.retired).map(i => ({ i, d: i.calDue ? daysUntil(i.calDue) : null })).filter(x => x.d !== null && x.d <= 60);

  $("#main").innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><span class="crumbs">${esc(scopeLabel())}</span><span class="spacer"></span>
      <button class="btn primary" data-cmd="new-test">${icon("test")} New test</button></div>
    <div class="kpis">
      <div class="kpi" data-goto="assets:"><div class="v">${list.length}</div><div class="l">Assets in service</div></div>
      <div class="kpi pass" data-goto="assets:pass"><div class="v">${cnt("pass")}</div><div class="l">In date &amp; passed</div></div>
      <div class="kpi warn" data-goto="due:"><div class="v">${cnt("due")}</div><div class="l">Due within ${db.settings.dueWarnDays} days</div></div>
      <div class="kpi fail" data-goto="due:overdue"><div class="v">${cnt("overdue")}</div><div class="l">Overdue</div></div>
      <div class="kpi fail" data-goto="failures:"><div class="v">${cnt("failed")}</div><div class="l">Failed</div></div>
      <div class="kpi info" data-goto="assets:untested"><div class="v">${cnt("untested")}</div><div class="l">Never tested</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Retests due — next 12 months</h2><div class="card-body"><div class="bars">${bar("Over", over, "over")}${months.map(m => bar(monthLbl(m), dueBy.get(m))).join("")}</div></div></div>
      <div class="card"><h2>${year} at a glance</h2><div class="card-body"><dl class="kv">
        <dt>Tests this year</dt><dd><b>${testsYr.length}</b></dd>
        <dt>Pass rate</dt><dd><b>${passRate === null ? "—" : passRate + "%"}</b></dd>
        <dt>Failures this year</dt><dd><b>${testsYr.filter(t => t.overall === "fail").length}</b></dd>
        <dt>Clients / sites</dt><dd>${db.clients.length} / ${db.sites.length}</dd>
        <dt>Standard</dt><dd>${esc(S.STANDARDS[db.settings.standard].name)}</dd>
        <dt>Instruments</dt><dd>${cal.length ? cal.map(x => `<span class="chip ${x.d < 0 ? "fail" : "warn"}">${esc(instName(x.i.id))}: ${x.d < 0 ? "calibration expired" : "cal due " + fmtDate(x.i.calDue)}</span>`).join(" ") : `<span class="chip pass">All in calibration</span>`}</dd>
      </dl></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Recent tests</h2>
      ${recent.length ? `<table class="grid"><thead><tr><th>Date</th><th>Asset</th><th>Description</th><th>Client / Site</th><th>Engineer</th><th>Result</th></tr></thead><tbody>
      ${recent.map(t => { const a = idx().asset.get(t.assetId) || {}; return `<tr data-asset="${a.id}"><td>${fmtDate(t.date)}</td><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc(clientName(a.clientId))} › ${esc(siteName(a.siteId))}</td><td>${esc(t.tester || engName(t.engineerId))}</td><td><span class="chip ${t.overall}">${RES[t.overall]}</span></td></tr>`; }).join("")}
      </tbody></table>` : `<div class="empty">No tests yet. Click <b>New Test</b> to test your first appliance, or <b>Import</b> to bring in existing records.</div>`}
    </div>`;
  $$("[data-goto]", $("#main")).forEach(k => k.addEventListener("click", () => { const [v, f] = k.dataset.goto.split(":"); if (v === "assets") assetFilter.status = f; if (v === "due") dueFilter.range = f || "warn"; go(v); }));
  $$("tr[data-asset]", $("#main")).forEach(tr => tr.addEventListener("dblclick", () => openAsset(tr.dataset.asset)));
};

/* ---------------- Asset register ---------------- */
const assetFilter = { q: "", status: "", cls: "", type: "", sort: "assetNo", dir: 1, retired: false };
const selected = new Set();
const ASSET_COLS = [
  ["assetNo", "Asset no."], ["description", "Description"], ["client", "Client"], ["site", "Site"], ["location", "Location"],
  ["cls", "Class"], ["type", "Type"], ["make", "Make / model"], ["lastDate", "Last test"], ["result", "Result"], ["nextDue", "Next due"], ["status", "Status"]
];
function assetRow(a) {
  const s = assetStatus(a);
  return { a, s, assetNo: a.assetNo, description: a.description, client: clientName(a.clientId), site: siteName(a.siteId), location: locName(a.locationId),
    cls: a.cls, type: a.type, make: [a.make, a.model].filter(Boolean).join(" "), lastDate: s.last ? s.last.date : "", result: s.last ? s.last.overall : "",
    nextDue: s.last && s.last.overall === "pass" ? s.last.nextDue : "", status: s.txt };
}
function filteredAssetRows() {
  const q = assetFilter.q.toLowerCase();
  let rows = db.assets.filter(a => inScope(a) && (assetFilter.retired ? a.retired : !a.retired)).map(assetRow);
  rows = rows.filter(r => {
    if (assetFilter.status && r.s.key !== assetFilter.status) return false;
    if (assetFilter.cls && r.a.cls !== assetFilter.cls) return false;
    if (assetFilter.type && r.a.type !== assetFilter.type) return false;
    if (q && ![r.assetNo, r.description, r.client, r.site, r.location, r.make, r.a.serial, r.a.notes].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const k = assetFilter.sort, dir = assetFilter.dir;
  rows.sort((x, y) => dir * (cmpNat(x[k], y[k]) || cmpNat(x.assetNo, y.assetNo)));
  return rows;
}
VIEWS.assets = () => {
  const rows = filteredAssetRows();
  const visible = new Set(rows.map(r => r.a.id));
  for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
  const statusOpts = [["", "All statuses"], ["pass", "Pass, in date"], ["due", "Due soon"], ["overdue", "Overdue"], ["failed", "Failed"], ["untested", "Never tested"]];
  const arrow = k => assetFilter.sort === k ? `<span class="arr">${assetFilter.dir > 0 ? "▲" : "▼"}</span>` : "";
  $("#main").innerHTML = `
    <div class="page-head"><h1>Asset Register</h1><span class="crumbs">${esc(scopeLabel())}</span><span class="spacer"></span>
      <button class="btn" data-act="export">${icon("import")} Export CSV</button>
      <button class="btn" data-cmd="new-asset">${icon("plus")} New asset</button>
      <button class="btn primary" data-cmd="new-test">${icon("test")} New test</button></div>
    <div class="filters">
      <input type="search" id="af-q" placeholder="Search asset no., description, serial…" value="${esc(assetFilter.q)}">
      <select id="af-status">${statusOpts.map(o => opt(o[0], o[1], assetFilter.status)).join("")}</select>
      <select id="af-cls">${opt("", "All classes")}${CLASSES.map(c => opt(c[0], c[1], assetFilter.cls)).join("")}</select>
      <select id="af-type">${opt("", "All types")}${TYPES.map(t => opt(t, t, assetFilter.type)).join("")}</select>
      <label class="chk"><input type="checkbox" id="af-retired"${assetFilter.retired ? " checked" : ""}> Show retired only</label>
    </div>
    <div class="filters" id="bulkBar"${selected.size ? "" : " hidden"}>
      <b id="selCount">${selected.size} selected</b>
      <button class="btn sm" data-act="bulk-test">${icon("test")} Test selected</button>
      <button class="btn sm" data-act="bulk-move">${icon("move")} Move…</button>
      <button class="btn sm" data-act="bulk-interval">${icon("cal")} Set retest interval…</button>
      <button class="btn sm" data-act="bulk-labels">${icon("tag")} Print labels</button>
      <button class="btn sm" data-act="bulk-retire">${assetFilter.retired ? "Reinstate" : "Retire"}</button>
      <button class="btn sm danger" data-act="bulk-delete">${icon("trash")} Delete</button>
      <button class="btn sm" data-act="bulk-clear">Clear selection</button>
    </div>
    <div class="table-wrap" style="max-height:calc(100vh - 250px)">
      ${rows.length ? `<table class="grid" id="assetTable"><thead><tr><th class="c"><input type="checkbox" id="selAll"${rows.length && rows.every(r => selected.has(r.a.id)) ? " checked" : ""}></th>
        ${ASSET_COLS.map(([k, l]) => `<th data-sort="${k}">${l} ${arrow(k)}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(r => `<tr data-id="${r.a.id}"${selected.has(r.a.id) ? ' class="sel"' : ""}>
          <td class="c"><input type="checkbox" data-sel${selected.has(r.a.id) ? " checked" : ""}></td>
          <td><b>${esc(r.assetNo)}</b></td><td>${esc(r.description)}</td><td>${esc(r.client)}</td><td>${esc(r.site)}</td><td>${esc(r.location)}</td>
          <td>${esc(r.cls)}</td><td>${esc(r.type)}</td><td>${esc(r.make)}</td><td>${fmtDate(r.lastDate)}</td>
          <td>${r.result ? `<span class="chip ${r.result}">${RES[r.result]}</span>` : ""}</td><td>${fmtDate(r.nextDue)}</td>
          <td><span class="chip ${r.s.cls}">${esc(r.s.txt)}</span></td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">${db.assets.length ? "No assets match these filters." : "No assets yet. Click <b>New Test</b> or <b>New Asset</b>, or use <b>Import</b>."}</div>`}
    </div>
    <div class="table-foot"><span>${rows.length} asset${rows.length === 1 ? "" : "s"}</span><span class="spacer"></span><span>Double-click to open · right-click for more · Ctrl/Shift-click to select</span></div>`;

  const rerender = debounce(() => { VIEWS.assets(); const q = $("#af-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 180);
  $("#af-q").addEventListener("input", e => { assetFilter.q = e.target.value; rerender(); });
  $("#af-status").addEventListener("change", e => { assetFilter.status = e.target.value; render(); });
  $("#af-cls").addEventListener("change", e => { assetFilter.cls = e.target.value; render(); });
  $("#af-type").addEventListener("change", e => { assetFilter.type = e.target.value; render(); });
  $("#af-retired").addEventListener("change", e => { assetFilter.retired = e.target.checked; selected.clear(); render(); });
  $$("th[data-sort]").forEach(th => th.addEventListener("click", () => { const k = th.dataset.sort; if (assetFilter.sort === k) assetFilter.dir *= -1; else { assetFilter.sort = k; assetFilter.dir = 1; } render(); }));
  const table = $("#assetTable");
  if (table) {
    let anchor = null;
    const ordered = rows.map(r => r.a.id);
    const syncSel = () => { $$("tbody tr", table).forEach(tr => { const on = selected.has(tr.dataset.id); tr.classList.toggle("sel", on); tr.querySelector("[data-sel]").checked = on; }); $("#bulkBar").hidden = !selected.size; $("#selCount").textContent = `${selected.size} selected`; $("#selAll").checked = ordered.length > 0 && ordered.every(i => selected.has(i)); };
    $("#selAll").addEventListener("change", e => { ordered.forEach(i => e.target.checked ? selected.add(i) : selected.delete(i)); syncSel(); });
    table.addEventListener("click", e => {
      const tr = e.target.closest("tbody tr"); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.matches("[data-sel]")) { e.target.checked ? selected.add(id) : selected.delete(id); anchor = id; syncSel(); return; }
      if (e.shiftKey && anchor) { const [i, j] = [ordered.indexOf(anchor), ordered.indexOf(id)].sort((x, y) => x - y); ordered.slice(i, j + 1).forEach(x => selected.add(x)); }
      else if (e.ctrlKey || e.metaKey) { selected.has(id) ? selected.delete(id) : selected.add(id); anchor = id; }
      else { selected.clear(); selected.add(id); anchor = id; }
      syncSel();
    });
    table.addEventListener("dblclick", e => { const tr = e.target.closest("tbody tr"); if (tr && !e.target.matches("[data-sel]")) openAsset(tr.dataset.id); });
    table.addEventListener("contextmenu", e => {
      const tr = e.target.closest("tbody tr"); if (!tr) return;
      e.preventDefault();
      if (!selected.has(tr.dataset.id)) { selected.clear(); selected.add(tr.dataset.id); syncSel(); }
      assetContextMenu(e.clientX, e.clientY, [...selected]);
    });
  }
  $("#main").onclick = e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const ids = [...selected];
    const act = b.dataset.act;
    if (act === "export") exportAssetsCSV(rows.map(r => r.a));
    else if (act === "bulk-clear") { selected.clear(); render(); }
    else bulkAction(act.replace("bulk-", ""), ids);
  };
};

function assetContextMenu(x, y, ids) {
  closeCtx();
  const one = ids.length === 1 ? idx().asset.get(ids[0]) : null;
  const m = document.createElement("div");
  m.className = "ctx";
  const items = one ? [
    ["test", "test", "Test now"], ["open", "edit", "Open / edit asset…"], ["history", "hist", "Test record (PDF)…"], ["label", "tag", "Print label"],
    ["clone", "plus", "Duplicate asset…"], ["repair", "wrench", "Record repair / action…"], "-", ["move", "move", "Move…"], ["retire", "box", one.retired ? "Reinstate" : "Retire"], ["delete", "trash", "Delete…"]
  ] : [["test", "test", `Test ${ids.length} assets…`], ["labels", "tag", "Print labels"], ["move", "move", "Move…"], ["interval", "cal", "Set retest interval…"], "-", ["retire", "box", "Retire / reinstate"], ["delete", "trash", "Delete…"]];
  m.innerHTML = items.map(i => i === "-" ? "<hr>" : `<button data-a="${i[0]}">${icon(i[1])}${i[2]}</button>`).join("");
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  m.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    closeCtx();
    const a = b.dataset.a;
    if (one && a === "test") openTest({ assetId: one.id });
    else if (a === "open") openAsset(one.id);
    else if (a === "history") Reports.run("asset", { assetIds: [one.id] });
    else if (a === "label" || a === "labels") Reports.run("labels", { assetIds: ids });
    else if (a === "clone") editAsset(null, Object.assign({}, one, { id: null, assetNo: nextAssetNo(one.assetNo) }));
    else if (a === "repair") recordRepair(one.id);
    else bulkAction(a, ids);
  });
  setTimeout(() => document.addEventListener("mousedown", ctxOutside, { once: true }));
}
function ctxOutside(e) { if (!e.target.closest(".ctx")) closeCtx(); else document.addEventListener("mousedown", ctxOutside, { once: true }); }
function closeCtx() { $$(".ctx").forEach(c => c.remove()); }

function nextAssetNo(no) {
  const m = String(no || "").match(/^(.*?)(\d+)$/);
  if (!m) return "";
  let n = Number(m[2]);
  let cand;
  do { n++; cand = m[1] + String(n).padStart(m[2].length, "0"); } while (findAssetsByNo(cand).length);
  return cand;
}

async function bulkAction(act, ids) {
  if (!ids.length) return;
  const list = ids.map(i => idx().asset.get(i)).filter(Boolean);
  if (act === "test") { testQueue = ids.slice(1); openTest({ assetId: ids[0] }); return; }
  if (act === "labels") { Reports.run("labels", { assetIds: ids }); return; }
  if (act === "delete") {
    const nt = db.tests.filter(t => ids.includes(t.assetId)).length;
    if (!await confirmBox("Delete assets", `Permanently delete <b>${list.length}</b> asset${list.length > 1 ? "s" : ""} and <b>${nt}</b> test record${nt === 1 ? "" : "s"}? This can’t be undone. To keep the history, use <b>Retire</b> instead.`, "Delete", "danger")) return;
    const set = new Set(ids);
    db.assets = db.assets.filter(a => !set.has(a.id)); db.tests = db.tests.filter(t => !set.has(t.assetId)); db.repairs = db.repairs.filter(r => !set.has(r.assetId));
    selected.clear(); changed(); renderTree(); render(); toast(`${list.length} asset(s) deleted`); return;
  }
  if (act === "retire") {
    const to = !list.every(a => a.retired);
    list.forEach(a => { a.retired = to; a.updated = Date.now(); });
    selected.clear(); changed(); renderTree(); render(); toast(`${list.length} asset(s) ${to ? "retired" : "reinstated"}`); return;
  }
  if (act === "interval") {
    const r = await modal({ title: "Set retest interval", width: 380, body: `<div class="field"><label>Retest every (months)</label><input type="number" name="iv" min="1" max="120" value="${db.settings.interval}"></div><p class="hint">Applies to ${list.length} asset(s). Next-due dates on existing passed tests are recalculated.</p>`,
      onSubmit: d => Number(fieldVal(d, "iv")) || false });
    if (!r) return;
    list.forEach(a => { a.interval = r; const t = latestFor(a.id); if (t && t.overall === "pass") { t.interval = r; t.nextDue = addMonths(t.date, r); } });
    changed(); render(); toast("Retest interval updated"); return;
  }
  if (act === "move") {
    const r = await modal({ title: `Move ${list.length} asset(s)`, width: 460, body: hierarchyFields({}) + `<p class="hint">New clients, sites and locations are created as needed.</p>`,
      onSubmit: d => { const c = fieldVal(d, "client"); if (!c) { toast("Choose a client"); return false; } return { c, s: fieldVal(d, "site"), l: fieldVal(d, "location") }; },
      onOpen: wireHierarchy });
    if (!r) return;
    const cid = ensureClient(r.c), sid = ensureSite(cid, r.s), lid = ensureLocation(sid, r.l);
    list.forEach(a => { a.clientId = cid; a.siteId = sid; a.locationId = lid; a.updated = Date.now(); });
    changed(); renderTree(); render(); toast(`${list.length} asset(s) moved`);
  }
}

/** Client / site / location name inputs with cascading autocomplete. */
function hierarchyFields(v) {
  return `<div class="frow c3">
    <div class="field"><label>Client *</label><input type="text" name="client" list="dl-h-client" value="${esc(v.client || "")}"></div>
    <div class="field"><label>Site</label><input type="text" name="site" list="dl-h-site" value="${esc(v.site || "")}"></div>
    <div class="field"><label>Location</label><input type="text" name="location" list="dl-h-loc" value="${esc(v.location || "")}"></div></div>
    ${dlist("dl-h-client", db.clients.map(c => c.name))}<datalist id="dl-h-site"></datalist><datalist id="dl-h-loc"></datalist>`;
}
function wireHierarchy(d) {
  const upd = () => {
    const c = db.clients.find(x => x.name.toLowerCase() === fieldVal(d, "client").toLowerCase());
    const sites = c ? db.sites.filter(s => s.clientId === c.id) : [];
    $("#dl-h-site", d).innerHTML = sites.sort(byName).map(s => `<option value="${esc(s.name)}">`).join("");
    const s = sites.find(x => x.name.toLowerCase() === fieldVal(d, "site").toLowerCase());
    $("#dl-h-loc", d).innerHTML = (s ? db.locations.filter(l => l.siteId === s.id) : []).sort(byName).map(l => `<option value="${esc(l.name)}">`).join("");
  };
  ["client", "site"].forEach(n => d.querySelector(`[name=${n}]`).addEventListener("input", upd));
  upd();
}
function scopeNames() {
  const out = { client: "", site: "", location: "" };
  if (scope.type === "client") out.client = clientName(scope.id);
  if (scope.type === "site") { const s = idx().site.get(scope.id); out.client = clientName(s.clientId); out.site = s.name; }
  if (scope.type === "location") { const l = idx().loc.get(scope.id); const s = idx().site.get(l.siteId); out.client = clientName(s.clientId); out.site = s.name; out.location = l.name; }
  return out;
}

/* ---------------- Asset edit ---------------- */
function assetFieldsHtml(a, names) {
  return `${hierarchyFields(names)}
    <div class="frow c3">
      <div class="field"><label>Asset no. *</label><input type="text" name="assetNo" value="${esc(a.assetNo || "")}" style="text-transform:uppercase;font-weight:600"></div>
      <div class="field" style="grid-column:span 2"><label>Description *</label><input type="text" name="description" list="dl-desc" value="${esc(a.description || "")}"></div></div>
    ${dlist("dl-desc", db.assets.map(x => x.description))}
    <div class="frow c3">
      <div class="field"><label>Make</label><input type="text" name="make" list="dl-make" value="${esc(a.make || "")}"></div>
      <div class="field"><label>Model</label><input type="text" name="model" value="${esc(a.model || "")}"></div>
      <div class="field"><label>Serial no.</label><input type="text" name="serial" value="${esc(a.serial || "")}"></div></div>
    ${dlist("dl-make", db.assets.map(x => x.make))}
    <div class="frow c4">
      <div class="field"><label>Class</label><select name="cls">${CLASSES.map(c => opt(c[0], c[1], a.cls || "I")).join("")}</select></div>
      <div class="field"><label>Equipment type</label><select name="type">${TYPES.map(t => opt(t, t, a.type || "Portable")).join("")}</select></div>
      <div class="field"><label>Fuse (A)</label><select name="fuse">${["", "1", "2", "3", "5", "7", "10", "13"].map(f => opt(f, f || "—", a.fuse)).join("")}</select></div>
      <div class="field"><label>Retest (months)</label><input type="number" name="interval" min="1" max="120" value="${esc(a.interval || db.settings.interval)}"></div></div>
    <div class="frow c4">
      <div class="field"><label>Cord size (mm²)</label><select name="csa">${CSAS.map(c => opt(c, c || "—", a.csa)).join("")}</select></div>
      <div class="field"><label>Cord length (m)</label><input type="number" step="0.1" min="0" name="length" value="${esc(a.length || "")}"></div>
      <div class="field"><label>Power (kW)</label><input type="number" step="0.01" min="0" name="powerKw" value="${esc(a.powerKw || "")}"></div>
      <div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="heating"${a.heating ? " checked" : ""}> Heating element</label></div></div>
    <div class="field"><label>Notes</label><input type="text" name="notes" value="${esc(a.notes || "")}"></div>`;
}
function readAssetFields(d) {
  const o = {};
  ["assetNo", "description", "make", "model", "serial", "cls", "type", "fuse", "csa", "length", "powerKw", "notes"].forEach(k => o[k] = fieldVal(d, k));
  o.assetNo = keyOf(o.assetNo);
  o.heating = fieldVal(d, "heating");
  o.interval = Number(fieldVal(d, "interval")) || Number(db.settings.interval);
  return o;
}
/** Returns an error string if the number clashes with another asset under the same client. */
function assetNoClash(no, clientId, selfId) {
  const clash = findAssetsByNo(no).find(x => x.id !== selfId && x.clientId === clientId);
  return clash ? `Asset ${no} already exists for ${clientName(clientId)}` : "";
}

async function editAsset(id, preset) {
  const a = id ? idx().asset.get(id) : (preset || {});
  const names = id || (preset && preset.clientId) ? { client: clientName(a.clientId), site: siteName(a.siteId), location: locName(a.locationId) } : scopeNames();
  const r = await modal({
    title: id ? `Edit asset ${esc(a.assetNo)}` : "New asset", width: 720, ok: id ? "Save" : "Add asset",
    body: assetFieldsHtml(a, names), onOpen: wireHierarchy,
    extra: id ? [] : [{ label: "Add &amp; test now", value: "test" }],
    onSubmit: (d, value) => {
      const o = readAssetFields(d);
      if (!o.assetNo || !o.description || !fieldVal(d, "client")) { toast("Asset no., description and client are required"); return false; }
      const cid = ensureClient(fieldVal(d, "client"));
      const err = assetNoClash(o.assetNo, cid, id); if (err) { toast(err); return false; }
      const sid = ensureSite(cid, fieldVal(d, "site")), lid = ensureLocation(sid, fieldVal(d, "location"));
      if (id) Object.assign(a, o, { clientId: cid, siteId: sid, locationId: lid, updated: Date.now() });
      else { const n = Object.assign({ id: uid(), created: Date.now() }, o, { clientId: cid, siteId: sid, locationId: lid }); db.assets.push(n); return { id: n.id, test: value === "test" }; }
      return { id };
    }
  });
  if (!r) return null;
  changed(); renderTree(); render();
  toast(id ? "Asset saved" : "Asset added");
  if (r.test) openTest({ assetId: r.id });
  return r.id;
}

/* ---------------- Asset detail ---------------- */
async function openAsset(id) {
  const a = idx().asset.get(id); if (!a) return;
  const s = assetStatus(a);
  const ts = testsFor(id), reps = repairsFor(id);
  const trend = (key, unit, limKey, kind) => {
    const pts = ts.slice().reverse().map(t => ({ d: t.date, v: S.parseReading(t[key]), lim: Number(t[limKey]) })).filter(p => p.v && !p.v.over);
    if (pts.length < 2) return "";
    const W = 300, H = 70, vals = pts.map(p => p.v.value).concat(pts.map(p => p.lim).filter(isFinite));
    const max = Math.max(...vals) * 1.1 || 1, x = i => 8 + i * (W - 16) / (pts.length - 1), y = v => H - 8 - v / max * (H - 16);
    const lim = pts[pts.length - 1].lim;
    return `<div><div class="hint">${key === "earth" ? "Earth continuity" : key === "ir" ? "Insulation" : "Leakage"} (${unit}) ${kind === "min" ? "≥" : "≤"} ${isFinite(lim) ? lim : "—"}</div>
      <svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${isFinite(lim) ? `<line x1="0" x2="${W}" y1="${y(lim)}" y2="${y(lim)}" stroke="#ef4444" stroke-dasharray="4 3"/>` : ""}
      <polyline fill="none" stroke="#0b6e4f" stroke-width="2" points="${pts.map((p, i) => `${x(i)},${y(p.v.value)}`).join(" ")}"/>
      ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v.value)}" r="3" fill="#0b6e4f"><title>${fmtDate(p.d)}: ${p.v.value} ${unit}</title></circle>`).join("")}</svg></div>`;
  };
  const r = await modal({
    title: `Asset ${esc(a.assetNo)} — ${esc(a.description || "")}`, width: 980, ok: false, cancel: "Close",
    headExtra: `<span class="chip ${s.cls}">${esc(s.txt)}</span>`,
    footLeft: `<button type="submit" class="btn" value="edit">${icon("edit")} Edit</button>
      <button type="submit" class="btn" value="repair">${icon("wrench")} Record repair / action</button>
      <button type="submit" class="btn" value="label">${icon("tag")} Label</button>
      <button type="submit" class="btn" value="pdf">${icon("print")} Test record</button>`,
    extra: [{ label: `${icon("test")} Test now`, value: "test", cls: "primary" }],
    body: `<div class="grid2">
      <dl class="kv">
        <dt>Client</dt><dd>${esc(clientName(a.clientId))}</dd><dt>Site</dt><dd>${esc(siteName(a.siteId)) || "—"}</dd><dt>Location</dt><dd>${esc(locName(a.locationId)) || "—"}</dd>
        <dt>Make / model</dt><dd>${esc([a.make, a.model].filter(Boolean).join(" ")) || "—"}</dd><dt>Serial no.</dt><dd>${esc(a.serial) || "—"}</dd>
        <dt>Class / type</dt><dd>Class ${esc(a.cls)} · ${esc(a.type)}</dd>
        <dt>Cord</dt><dd>${a.csa ? esc(a.csa) + " mm²" : "—"}${a.length ? " × " + esc(a.length) + " m" : ""}${a.fuse ? ` · ${esc(a.fuse)} A fuse` : ""}</dd>
        <dt>Power</dt><dd>${a.powerKw ? esc(a.powerKw) + " kW" : "—"}${a.heating ? " · heating" : ""}</dd>
        <dt>Retest interval</dt><dd>${esc(a.interval || db.settings.interval)} months</dd>
        <dt>Next due</dt><dd>${s.last && s.last.overall === "pass" ? fmtDate(s.last.nextDue) : "—"}</dd>
        ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ""}
      </dl>
      <div class="stack" style="gap:8px">${trend("earth", "Ω", "earthLimit", "max")}${trend("ir", "MΩ", "irLimit", "min")}${trend("leak", "mA", "leakLimit", "max")}${ts.length < 2 ? `<div class="hint">Trend charts appear after two or more tests.</div>` : ""}</div>
    </div>
    <h4 style="margin:18px 0 8px">Test history (${ts.length})</h4>
    ${ts.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Date</th><th>Engineer</th><th>Visual</th><th class="n">Earth Ω</th><th class="n">IR MΩ</th><th class="n">Leak mA</th><th>Polarity</th><th>Result</th><th>Next due</th><th>Notes</th><th></th></tr></thead><tbody>
      ${ts.map(t => `<tr data-test="${t.id}"><td>${fmtDate(t.date)}</td><td>${esc(t.tester || engName(t.engineerId))}</td><td>${t.results && t.results.visual ? RES[t.results.visual] : "—"}</td>
        <td class="n">${esc(show(t.earth))}</td><td class="n">${esc(show(t.ir))}</td><td class="n">${esc(show(t.leak))}</td><td>${t.polarity ? RES[t.polarity] : "—"}</td>
        <td><span class="chip ${t.overall}">${RES[t.overall]}</span></td><td>${fmtDate(t.nextDue)}</td><td title="${esc(t.notes)}">${esc(t.notes)}</td>
        <td class="act"><button type="button" class="btn sm" data-view-test="${t.id}">View</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="hint">Not tested yet.</div>`}
    ${reps.length ? `<h4 style="margin:18px 0 8px">Repairs &amp; actions (${reps.length})</h4><div class="table-wrap"><table class="grid"><thead><tr><th>Date</th><th>Action</th><th>Fault</th><th>Work done</th><th>By</th></tr></thead><tbody>
      ${reps.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc((REPAIR_ACTIONS.find(r => r[0] === x.action) || ["", x.action])[1])}</td><td>${esc(x.fault)}</td><td>${esc(x.work)}</td><td>${esc(x.by)}</td></tr>`).join("")}</tbody></table></div>` : ""}`,
    onOpen: d => d.addEventListener("click", e => { const b = e.target.closest("[data-view-test]"); if (b) showTest(b.dataset.viewTest); })
  });
  if (r === "edit") { await editAsset(id); }
  else if (r === "test") openTest({ assetId: id });
  else if (r === "repair") recordRepair(id);
  else if (r === "label") Reports.run("labels", { assetIds: [id] });
  else if (r === "pdf") Reports.run("asset", { assetIds: [id] });
}

async function showTest(testId) {
  const t = db.tests.find(x => x.id === testId); if (!t) return;
  const a = idx().asset.get(t.assetId) || {};
  const row = (k, val, lim, unit, sign) => `<tr><td>${k}</td><td class="n">${esc(show(val))} ${val ? unit : ""}</td><td class="n">${lim ? `${sign} ${esc(lim)} ${unit}` : "—"}</td><td>${t.results && t.results[{ "Earth continuity": "earth", "Insulation resistance": "ir" }[k] || (k.includes("current") ? "leak" : "")] ? `<span class="chip ${t.results[{ "Earth continuity": "earth", "Insulation resistance": "ir" }[k] || "leak"]}">${RES[t.results[{ "Earth continuity": "earth", "Insulation resistance": "ir" }[k] || "leak"]]}</span>` : "—"}</td></tr>`;
  const r = await modal({
    title: `Test ${fmtDate(t.date)} — ${esc(a.assetNo)}`, width: 760, ok: false, cancel: "Close",
    headExtra: `<span class="chip ${t.overall}">${RES[t.overall]}</span>`,
    footLeft: `<button type="submit" class="btn danger" value="delete">${icon("trash")} Delete test</button>`,
    body: `<div class="grid2"><dl class="kv"><dt>Engineer</dt><dd>${esc(t.tester || engName(t.engineerId)) || "—"}</dd><dt>Instrument</dt><dd>${esc(t.instrument || instName(t.instrumentId)) || "—"}</dd>
      <dt>Standard</dt><dd>${esc((S.STANDARDS[t.standard] || {}).name || t.standard)}</dd><dt>Next due</dt><dd>${fmtDate(t.nextDue) || "—"}</dd></dl>
      <dl class="kv"><dt>Polarity</dt><dd>${t.polarity ? RES[t.polarity] : "—"}</dd><dt>Functional</dt><dd>${t.functional ? RES[t.functional] : "—"}</dd>
      <dt>RCD ×1 / ×5</dt><dd>${esc(show(t.rcd1))} / ${esc(show(t.rcd5))} ms</dd><dt>Notes</dt><dd>${esc(t.notes) || "—"}</dd></dl></div>
      <table class="grid" style="margin-top:12px"><thead><tr><th>Test</th><th class="n">Reading</th><th class="n">Limit</th><th>Result</th></tr></thead><tbody>
      ${row("Earth continuity", t.earth, t.earthLimit, "Ω", "≤")}${row("Insulation resistance", t.ir, t.irLimit, "MΩ", "≥")}${row(t.leakMethod === "Touch current" ? "Touch current" : "Leakage current", t.leak, t.leakLimit, "mA", "≤")}</tbody></table>
      <h4 style="margin:14px 0 6px">Visual inspection</h4>
      <table class="grid"><tbody>${VISUAL_ITEMS.map(([k, l]) => `<tr><td>${esc(l)}</td><td>${t.visual && t.visual[k] ? `<span class="chip ${t.visual[k]}">${RES[t.visual[k]]}</span>` : "—"}</td></tr>`).join("")}</tbody></table>`
  });
  if (r === "delete" && await confirmBox("Delete test", `Delete the ${fmtDate(t.date)} test for ${esc(a.assetNo)}?`, "Delete", "danger")) {
    db.tests = db.tests.filter(x => x.id !== testId); changed(); renderTree(); render(); toast("Test deleted");
  }
}

/* ---------------- Test entry ---------------- */
let testQueue = [];
async function openTest(o = {}) {
  const pre = o.assetId ? idx().asset.get(o.assetId) : null;
  const names = pre ? { client: clientName(pre.clientId), site: siteName(pre.siteId), location: locName(pre.locationId) } : (o.names || scopeNames());
  const a = pre || {};
  const st = db.settings;
  const engOpts = db.engineers.filter(e => !e.retired).sort(byName);
  const instOpts = db.instruments.filter(i => !i.retired);
  const draft = { visual: {}, polarity: "", functional: "", assetId: pre ? pre.id : null };
  const seg = (name) => `<span class="seg" data-seg="${name}">${["pass", "fail", "na"].map(v => `<button type="button" data-v="${v}" aria-pressed="false">${RES[v]}</button>`).join("")}</span>`;
  const queueTxt = testQueue.length ? ` <span class="chip info">${testQueue.length} more queued</span>` : "";

  const body = `<div class="test-grid">
    <div class="col">
      <div class="sect"><h4>Asset<span class="spacer"></span><span class="chip" id="t-state">New asset</span></h4><div class="in">
        <div class="field"><label>Asset no. *</label><div class="lookup"><input type="text" name="assetNo" value="${esc(a.assetNo || "")}" autofocus placeholder="Scan or type"></div></div>
        <div class="asset-state hint" id="t-prev"></div>
        <div style="margin-top:8px">${hierarchyFields(names).replace('class="frow c3"', 'class="frow"')}</div>
        <div class="field" style="margin-bottom:10px"><label>Description *</label><input type="text" name="description" list="dl-desc" value="${esc(a.description || "")}"></div>
        ${dlist("dl-desc", db.assets.map(x => x.description))}
        <div class="frow c2">
          <div class="field"><label>Make</label><input type="text" name="make" value="${esc(a.make || "")}"></div>
          <div class="field"><label>Model</label><input type="text" name="model" value="${esc(a.model || "")}"></div></div>
        <div class="frow c2">
          <div class="field"><label>Serial no.</label><input type="text" name="serial" value="${esc(a.serial || "")}"></div>
          <div class="field"><label>Fuse (A)</label><select name="fuse">${["", "1", "2", "3", "5", "7", "10", "13"].map(f => opt(f, f || "—", a.fuse)).join("")}</select></div></div>
        <div class="frow c2">
          <div class="field"><label>Class</label><select name="cls">${CLASSES.map(c => opt(c[0], c[1], a.cls || "I")).join("")}</select></div>
          <div class="field"><label>Type</label><select name="type">${TYPES.map(t => opt(t, t, a.type || "Portable")).join("")}</select></div></div>
        <div class="frow c3">
          <div class="field"><label>Cord mm²</label><select name="csa">${CSAS.map(c => opt(c, c || "—", a.csa)).join("")}</select></div>
          <div class="field"><label>Length m</label><input type="number" step="0.1" min="0" name="length" value="${esc(a.length || "")}"></div>
          <div class="field"><label>Power kW</label><input type="number" step="0.01" min="0" name="powerKw" value="${esc(a.powerKw || "")}"></div></div>
        <label class="chk"><input type="checkbox" name="heating"${a.heating ? " checked" : ""}> Heating element</label>
        <input type="hidden" name="notes" value="${esc(a.notes || "")}">
      </div></div>
    </div>
    <div class="col">
      <div class="sect"><h4>Visual inspection<span class="spacer"></span><span class="chip" id="t-visState">Not started</span><button type="button" class="btn sm" id="visAll">All pass</button></h4><div class="in vis">
        ${VISUAL_ITEMS.map(([k, l]) => `<div class="vis-row" data-k="${k}"><span class="t">${esc(l)}</span>${seg("v:" + k)}</div>`).join("")}
      </div></div>
    </div>
    <div class="col">
      <div class="sect"><h4>Electrical tests<span class="spacer"></span><select name="standard" style="font-size:12px;padding:2px 6px">${Object.values(S.STANDARDS).map(s => opt(s.id, s.short, st.standard)).join("")}</select></h4><div class="in">
        <table class="readings"><thead><tr><th>Test</th><th>Reading</th><th>Limit</th><th></th><th>Result</th></tr></thead><tbody>
          <tr id="r-earth"><td>Earth continuity</td><td><input type="text" name="earth" inputmode="decimal"></td><td><input type="text" name="earthLimit" data-auto></td><td class="u">Ω</td><td data-res="earth"></td></tr>
          <tr><td colspan="5" class="hint" id="earthWorking" style="padding-top:0"></td></tr>
          <tr id="r-ir"><td>Insulation <select name="irV" style="font-size:11px;padding:1px 2px"><option>500</option><option>250</option></select> V</td><td><input type="text" name="ir" inputmode="decimal" placeholder="e.g. >299"></td><td><input type="text" name="irLimit" data-auto></td><td class="u">MΩ</td><td data-res="ir"></td></tr>
          <tr id="r-leak"><td><span id="leakTitle">Leakage current</span><br><select name="leakMethod" style="font-size:11px;padding:1px 2px;margin-top:2px"><option>Substitute</option><option>Differential</option><option>Touch current</option></select></td><td><input type="text" name="leak" inputmode="decimal"></td><td><input type="text" name="leakLimit" data-auto></td><td class="u">mA</td><td data-res="leak"></td></tr>
          <tr><td>Polarity</td><td colspan="4">${seg("polarity")}</td></tr>
          <tr><td>Functional check</td><td colspan="4">${seg("functional")}</td></tr>
          <tr><td>RCD trip ×1 / ×5</td><td><input type="text" name="rcd1" placeholder="ms (opt.)"></td><td><input type="text" name="rcd5" placeholder="ms (opt.)"></td><td class="u">ms</td><td data-res="rcd"></td></tr>
        </tbody></table>
        <div class="hint" id="t-cmp" style="margin-top:6px"></div>
      </div></div>
      <div class="sect"><h4>Test details</h4><div class="in">
        <div class="frow c3">
          <div class="field"><label>Test date</label><input type="date" name="date" value="${todayISO()}" max="${todayISO()}"></div>
          <div class="field"><label>Retest (months)</label><input type="number" name="interval" min="1" max="120" value="${esc(a.interval || st.interval)}"></div>
          <div class="field"><label>Next due</label><input type="text" id="t-next" readonly tabindex="-1" style="background:var(--panel-2)"></div></div>
        <div class="frow c2">
          <div class="field"><label>Engineer</label><select name="engineerId">${opt("", "—")}${engOpts.map(e => opt(e.id, e.name, st.defaultEngineerId || (engOpts.length === 1 ? e.id : ""))).join("")}</select></div>
          <div class="field"><label>Instrument</label><select name="instrumentId">${opt("", "—")}${instOpts.map(i => opt(i.id, instName(i.id), st.defaultInstrumentId || (instOpts.length === 1 ? i.id : ""))).join("")}</select></div></div>
        <div class="field"><label>Notes / fault description</label><input type="text" name="tnotes" placeholder="e.g. Cable damaged at cord grip"></div>
      </div></div>
      <div class="overall" id="t-overall"><span class="big" id="t-verdict">INCOMPLETE</span><span class="why" id="t-why"></span></div>
    </div>
  </div>`;

  const r = await modal({
    title: "Test appliance" + queueTxt, width: 1340, ok: "Save", body,
    extra: [{ label: "Save &amp; next", value: "next" }],
    confirmClose: "Discard this test?",
    onOpen: d => wireTestForm(d, draft),
    onSubmit: (d, value) => saveTestFromForm(d, draft, value)
  });
  if (r && r.next) {
    if (testQueue.length) { const nx = testQueue.shift(); openTest({ assetId: nx }); }
    else openTest({ names: r.names });
  } else testQueue = [];
}

function wireTestForm(d, draft) {
  const F = n => d.querySelector(`[name="${n}"]`);
  const autoLimit = (el, v) => { if (el.dataset.manual) return; el.value = v === null || v === undefined ? "" : String(v); };
  d.addEventListener("input", e => { if (e.target.matches("[data-auto]")) e.target.dataset.manual = e.target.value.trim() ? "1" : ""; });
  wireHierarchy(d);
  const setSeg = (name, v) => { const s = d.querySelector(`[data-seg="${name}"]`); $$("button", s).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))); };
  d.addEventListener("click", e => {
    const b = e.target.closest(".seg button"); if (!b) return;
    const name = b.closest(".seg").dataset.seg, v = b.dataset.v;
    if (name.startsWith("v:")) { const k = name.slice(2); draft.visual[k] = draft.visual[k] === v ? undefined : v; if (!draft.visual[k]) delete draft.visual[k]; setSeg(name, draft.visual[k]); }
    else { draft[name] = draft[name] === v ? "" : v; setSeg(name, draft[name]); }
    update();
  });
  $("#visAll", d).addEventListener("click", () => { VISUAL_ITEMS.forEach(([k]) => { if (draft.visual[k] !== "fail") { draft.visual[k] = "pass"; setSeg("v:" + k, "pass"); } }); update(); });

  const assetFromForm = () => ({ cls: F("cls").value, csa: F("csa").value, length: F("length").value, powerKw: F("powerKw").value, heating: F("heating").checked });

  const loadAsset = a => {
    draft.assetId = a.id;
    F("client").value = clientName(a.clientId); F("site").value = siteName(a.siteId); F("location").value = locName(a.locationId);
    ["description", "make", "model", "serial", "fuse", "cls", "type", "csa", "length", "powerKw", "notes"].forEach(k => { if (F(k)) F(k).value = a[k] || (k === "cls" ? "I" : k === "type" ? "Portable" : ""); });
    F("heating").checked = !!a.heating;
    F("interval").value = a.interval || db.settings.interval;
    $$("[data-auto]", d).forEach(i => i.dataset.manual = "");
  };
  const lookup = () => {
    const no = F("assetNo").value;
    const matches = findAssetsByNo(no);
    const cur = draft.assetId && idx().asset.get(draft.assetId);
    if (cur && keyOf(cur.assetNo) === keyOf(no)) return update();
    if (matches.length === 1) loadAsset(matches[0]);
    else if (matches.length > 1) {
      const cn = F("client").value.toLowerCase();
      const m = matches.find(x => clientName(x.clientId).toLowerCase() === cn);
      if (m) loadAsset(m); else { draft.assetId = null; toast(`${matches.length} assets share number ${keyOf(no)} — pick the client`); }
    } else draft.assetId = null;
    update();
  };
  F("assetNo").addEventListener("change", lookup);
  F("assetNo").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); lookup(); F("description").value ? d.querySelector("[data-seg='v:suitable'] button").focus() : F("description").focus(); } });
  F("client").addEventListener("change", () => { if (!draft.assetId) lookup(); });
  d.addEventListener("input", update);
  d.addEventListener("change", update);

  function update() {
    const std = F("standard").value, L = limitsFor(std), as = assetFromForm();
    const cur = draft.assetId && idx().asset.get(draft.assetId);
    const last = cur ? latestFor(cur.id) : null;
    const state = $("#t-state", d);
    state.textContent = cur ? `Existing · ${testsFor(cur.id).length} test(s)` : F("assetNo").value.trim() ? "New asset" : "—";
    state.className = "chip " + (cur ? "info" : "");
    $("#t-prev", d).innerHTML = last ? `Last tested <b>${fmtDate(last.date)}</b> <span class="chip ${last.overall}">${RES[last.overall]}</span> · Earth ${esc(show(last.earth))} Ω · IR ${esc(show(last.ir))} MΩ · Leak ${esc(show(last.leak))} mA` : "";

    const earthOn = S.needsEarth(as);
    $("#r-earth", d).classList.toggle("off", !earthOn);
    F("earth").disabled = F("earthLimit").disabled = !earthOn;
    const el = S.earthLimit(std, as.csa, as.length, L);
    autoLimit(F("earthLimit"), earthOn ? el.limit : null);
    $("#earthWorking", d).textContent = !earthOn ? "Class II/III — no earth continuity test" : el.limit === null ? el.reason + " to calculate the limit, or type one" : el.working;

    const il = S.irLimit(std, as, L);
    autoLimit(F("irLimit"), il.limit);
    if (!F("irV").dataset.manual) F("irV").value = String(il.voltage);

    const ll = S.leakLimit(std, as, L);
    $("#leakTitle", d).textContent = ll.kind || "Leakage current";
    $("#r-leak", d).classList.toggle("off", ll.limit === null);
    F("leak").disabled = F("leakLimit").disabled = ll.limit === null;
    autoLimit(F("leakLimit"), ll.limit);
    if (!F("leakMethod").dataset.manual) F("leakMethod").value = as.cls === "II" ? "Touch current" : "Substitute";

    const ev = evaluateForm(d, draft);
    for (const k of ["earth", "ir", "leak"]) { const v = ev.results[k]; $(`[data-res="${k}"]`, d).innerHTML = v ? `<span class="chip ${v}">${RES[v]}</span>` : ""; }
    const rc = ev.results.rcd1 === "fail" || ev.results.rcd5 === "fail" ? "fail" : ev.results.rcd1 || ev.results.rcd5;
    $(`[data-res="rcd"]`, d).innerHTML = rc ? `<span class="chip ${rc}">${RES[rc]}</span>` : "";
    const vs = ev.results.visual, answered = Object.keys(draft.visual).length;
    const vEl = $("#t-visState", d);
    vEl.textContent = vs ? (vs === "pass" ? "Pass" : `Fail · ${ev.visualFails.length}`) : `${answered}/${VISUAL_ITEMS.length}`;
    vEl.className = "chip " + (vs || "");
    $$(".vis-row", d).forEach(row => row.style.background = draft.visual[row.dataset.k] === "fail" ? "var(--fail-bg)" : "");

    // Comparison with previous readings
    const cmp = [];
    if (last) for (const [k, u, lbl] of [["earth", "Ω", "Earth"], ["ir", "MΩ", "IR"], ["leak", "mA", "Leakage"]]) {
      const p = S.parseReading(last[k]), n = S.parseReading(F(k).value);
      if (!p || !n || p.over || n.over || !(p.value > 0)) continue;
      const ch = (n.value - p.value) / p.value * 100;
      const worse = (k === "earth" && ch >= 50 && n.value - p.value >= 0.05) || (k === "leak" && ch >= 50 && n.value - p.value >= 0.1) || (k === "ir" && ch <= -50);
      cmp.push(`<span${worse ? ' style="color:var(--warn);font-weight:600"' : ""}>${lbl} ${p.value}→${n.value} ${u} (${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%)${worse ? " ⚠ significant change" : ""}</span>`);
    }
    $("#t-cmp", d).innerHTML = cmp.join(" · ");

    const date = F("date").value || todayISO();
    const iv = Number(F("interval").value) || db.settings.interval;
    $("#t-next", d).value = ev.overall === "fail" ? "— (failed)" : fmtDate(addMonths(date, iv));
    const ov = $("#t-overall", d);
    ov.className = "overall " + (ev.overall || "");
    $("#t-verdict", d).textContent = ev.overall ? ev.overall.toUpperCase() : "INCOMPLETE";
    $("#t-why", d).textContent = ev.overall === "fail" ? "Failed: " + ev.failWhy.join(", ") : ev.missing.length ? "Still needed: " + ev.missing.join(", ") : `Next test due ${fmtDate(addMonths(date, iv))}`;
  }
  F("irV").addEventListener("change", () => F("irV").dataset.manual = "1");
  F("leakMethod").addEventListener("change", () => F("leakMethod").dataset.manual = "1");
  if (draft.assetId) loadAsset(idx().asset.get(draft.assetId));
  update();
  if (draft.assetId) setTimeout(() => d.querySelector("[data-seg='v:suitable'] button").focus(), 0);
}

function evaluateForm(d, draft) {
  const F = n => d.querySelector(`[name="${n}"]`);
  const L = limitsFor(F("standard").value);
  const results = {};
  const visualFails = Object.entries(draft.visual).filter(([, v]) => v === "fail").map(([k]) => k);
  results.visual = visualFails.length ? "fail" : Object.keys(draft.visual).length === VISUAL_ITEMS.length ? "pass" : null;
  const earthOn = !F("earth").disabled;
  results.earth = earthOn ? S.judge(F("earth").value, F("earthLimit").value, "max") : null;
  results.ir = S.judge(F("ir").value, F("irLimit").value, "min");
  results.leak = F("leak").disabled ? null : S.judge(F("leak").value, F("leakLimit").value, "max");
  results.polarity = draft.polarity === "na" ? null : draft.polarity || null;
  results.functional = draft.functional === "na" ? null : draft.functional || null;
  results.rcd1 = S.judge(F("rcd1").value, L.rcdX1, "max");
  results.rcd5 = S.judge(F("rcd5").value, L.rcdX5, "max");
  const failWhy = Object.entries(results).filter(([, v]) => v === "fail").map(([k]) => RESULT_NAMES[k]);
  const missing = [];
  if (!F("assetNo").value.trim()) missing.push("asset no.");
  if (!results.visual) missing.push("visual inspection");
  if (earthOn && !results.earth) missing.push(F("earth").value ? "earth limit" : "earth reading");
  if (!results.ir && !results.leak) missing.push("insulation or leakage reading");
  if (F("ir").value && !results.ir) missing.push("IR limit");
  let overall = null;
  if (failWhy.length) overall = "fail"; else if (!missing.length) overall = "pass";
  return { results, overall, failWhy, missing, visualFails };
}

function saveTestFromForm(d, draft, value) {
  const F = n => d.querySelector(`[name="${n}"]`);
  const ev = evaluateForm(d, draft);
  if (!ev.overall) { toast("Incomplete — " + ev.missing.join(", ")); return false; }
  if (ev.missing.includes("asset no.")) { toast("Enter an asset number"); return false; }
  const o = readAssetFields(d);
  o.notes = F("notes").value;
  if (!o.description) { toast("Enter a description"); F("description").focus(); return false; }
  const cn = fieldVal(d, "client");
  if (!cn) { toast("Enter the client"); F("client").focus(); return false; }
  const cid = ensureClient(cn), sid = ensureSite(cid, fieldVal(d, "site")), lid = ensureLocation(sid, fieldVal(d, "location"));
  let asset = draft.assetId && idx().asset.get(draft.assetId);
  if (asset && keyOf(asset.assetNo) !== o.assetNo) asset = null;
  if (!asset) { asset = findAssetsByNo(o.assetNo).find(x => x.clientId === cid) || null; }
  if (asset) {
    const err = assetNoClash(o.assetNo, cid, asset.id); if (err) { toast(err); return false; }
    Object.assign(asset, o, { clientId: cid, siteId: sid, locationId: lid, updated: Date.now(), retired: false });
  } else {
    asset = Object.assign({ id: uid(), created: Date.now() }, o, { clientId: cid, siteId: sid, locationId: lid });
    db.assets.push(asset);
  }
  const date = F("date").value || todayISO();
  const iv = Number(F("interval").value) || Number(db.settings.interval);
  const engineerId = F("engineerId").value, instrumentId = F("instrumentId").value;
  _idx = null;
  const t = {
    id: uid(), assetId: asset.id, created: Date.now(), date, standard: F("standard").value,
    engineerId, tester: engName(engineerId), instrumentId, instrument: instName(instrumentId),
    interval: iv, nextDue: ev.overall === "pass" ? addMonths(date, iv) : "",
    visual: Object.assign({}, draft.visual), visualFails: ev.visualFails,
    earth: F("earth").disabled ? "" : F("earth").value.trim(), earthLimit: F("earth").disabled ? "" : F("earthLimit").value.trim(),
    ir: F("ir").value.trim(), irLimit: F("irLimit").value.trim(), irV: F("irV").value,
    leak: F("leak").disabled ? "" : F("leak").value.trim(), leakLimit: F("leak").disabled ? "" : F("leakLimit").value.trim(), leakMethod: F("leakMethod").value,
    polarity: draft.polarity, functional: draft.functional, rcd1: F("rcd1").value.trim(), rcd5: F("rcd5").value.trim(),
    results: ev.results, overall: ev.overall, notes: F("tnotes").value.trim(),
    snap: { description: asset.description, client: cn, site: fieldVal(d, "site"), location: fieldVal(d, "location"), cls: asset.cls, type: asset.type, csa: asset.csa, length: asset.length, fuse: asset.fuse, make: asset.make, model: asset.model, serial: asset.serial }
  };
  db.tests.push(t);
  if (engineerId) db.settings.defaultEngineerId = engineerId;
  if (instrumentId) db.settings.defaultInstrumentId = instrumentId;
  changed(); renderTree(); render();
  toast(`${asset.assetNo} saved — ${ev.overall.toUpperCase()}`);
  return value === "next" ? { next: true, names: { client: cn, site: fieldVal(d, "site"), location: fieldVal(d, "location") } } : { next: false };
}

/* ---------------- Retest planner ---------------- */
const dueFilter = { range: "warn", from: "", to: "" };
function dueRows(range = dueFilter.range, sc = scope) {
  const today = todayISO();
  const warn = addDays(today, Number(db.settings.dueWarnDays || 30));
  let from = "0000", to = "9999";
  if (range === "overdue") to = addDays(today, -1);
  else if (range === "warn") to = warn;
  else if (/^\d+$/.test(range)) to = addDays(today, Number(range));
  else if (range === "custom") { from = dueFilter.from || "0000"; to = dueFilter.to || "9999"; }
  const rows = [];
  for (const a of db.assets.filter(x => !x.retired && inScope(x, sc))) {
    const s = assetStatus(a);
    if (s.key === "untested" || s.key === "failed") { if (range === "untested") rows.push({ a, s, due: "" }); continue; }
    if (range === "untested") continue;
    const due = s.last.nextDue; if (!due) continue;
    if (due >= from && due <= to) rows.push({ a, s, due });
  }
  rows.sort((x, y) => cmpNat(x.due, y.due) || cmpNat(clientName(x.a.clientId), clientName(y.a.clientId)) || cmpNat(siteName(x.a.siteId), siteName(y.a.siteId)) || cmpNat(x.a.assetNo, y.a.assetNo));
  return rows;
}
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
VIEWS.due = () => {
  const rows = dueRows();
  const ranges = [["overdue", "Overdue"], ["warn", `Overdue + next ${db.settings.dueWarnDays} days`], ["60", "Next 60 days"], ["90", "Next 90 days"], ["365", "Next 12 months"], ["untested", "Never tested"], ["custom", "Date range…"]];
  // Group by client › site
  const groups = new Map();
  for (const r of rows) { const k = `${clientName(r.a.clientId)} › ${siteName(r.a.siteId) || "(no site)"}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  $("#main").innerHTML = `
    <div class="page-head"><h1>Retest Planner</h1><span class="crumbs">${esc(scopeLabel())}</span><span class="spacer"></span>
      <button class="btn" id="dueCsv">${icon("import")} Export CSV</button>
      <button class="btn" id="duePrint">${icon("print")} Print retest list</button>
      <button class="btn primary" id="dueTest"${rows.length ? "" : " disabled"}>${icon("test")} Test these ${rows.length}</button></div>
    <div class="filters">
      <select id="dueRange">${ranges.map(r => opt(r[0], r[1], dueFilter.range)).join("")}</select>
      <span id="dueCustom"${dueFilter.range === "custom" ? "" : " hidden"}>From <input type="date" id="dueFrom" value="${dueFilter.from}"> to <input type="date" id="dueTo" value="${dueFilter.to}"></span>
      <span class="hint">${rows.length} asset${rows.length === 1 ? "" : "s"} across ${groups.size} site${groups.size === 1 ? "" : "s"}</span>
    </div>
    ${rows.length ? [...groups].map(([g, rs]) => `<div class="card" style="margin-bottom:12px"><div class="card-head">${icon("pin")} ${esc(g)} <span class="chip">${rs.length}</span></div>
      <table class="grid"><thead><tr><th>Asset no.</th><th>Description</th><th>Location</th><th>Class</th><th>Last test</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${rs.map(r => `<tr data-id="${r.a.id}"><td><b>${esc(r.a.assetNo)}</b></td><td>${esc(r.a.description)}</td><td>${esc(locName(r.a.locationId))}</td><td>${esc(r.a.cls)}</td>
        <td>${r.s.last ? fmtDate(r.s.last.date) : "—"}</td><td>${fmtDate(r.due)}</td><td><span class="chip ${r.s.cls}">${esc(r.s.txt)}</span></td>
        <td class="act"><button class="btn sm" data-test="${r.a.id}">${icon("test")} Test</button></td></tr>`).join("")}</tbody></table></div>`).join("")
    : `<div class="card"><div class="empty">Nothing due in this period. 🎉</div></div>`}`;
  $("#dueRange").addEventListener("change", e => { dueFilter.range = e.target.value; render(); });
  if ($("#dueFrom")) { $("#dueFrom").addEventListener("change", e => { dueFilter.from = e.target.value; render(); }); $("#dueTo").addEventListener("change", e => { dueFilter.to = e.target.value; render(); }); }
  $("#dueCsv").addEventListener("click", () => exportAssetsCSV(rows.map(r => r.a), "Retests_due"));
  $("#duePrint").addEventListener("click", () => Reports.run("due", { range: dueFilter.range }));
  $("#dueTest").addEventListener("click", () => { const ids = rows.map(r => r.a.id); testQueue = ids.slice(1); openTest({ assetId: ids[0] }); });
  $("#main").onclick = e => { const b = e.target.closest("[data-test]"); if (b) openTest({ assetId: b.dataset.test }); };
  $$("tr[data-id]", $("#main")).forEach(tr => tr.addEventListener("dblclick", () => openAsset(tr.dataset.id)));
};

/* ---------------- Failures & repairs ---------------- */
let failTab = "open";
VIEWS.failures = () => {
  const failed = scopedAssets().map(a => ({ a, s: assetStatus(a) })).filter(x => x.s.key === "failed");
  const open = failed.filter(x => !x.s.repair), actioned = failed.filter(x => x.s.repair);
  const ids = new Set(db.assets.filter(a => inScope(a)).map(a => a.id));
  const log = db.repairs.filter(r => ids.has(r.assetId)).sort((a, b) => cmpNat(b.date, a.date));
  const tbl = list => list.length ? `<table class="grid"><thead><tr><th>Asset no.</th><th>Description</th><th>Client › Site › Location</th><th>Failed on</th><th>Reason</th><th>Notes</th><th>Action</th><th></th></tr></thead><tbody>
    ${list.map(({ a, s }) => `<tr data-id="${a.id}"><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc([clientName(a.clientId), siteName(a.siteId), locName(a.locationId)].filter(Boolean).join(" › "))}</td>
      <td>${fmtDate(s.last.date)}</td><td>${esc(Object.entries(s.last.results || {}).filter(([, v]) => v === "fail").map(([k]) => RESULT_NAMES[k]).join(", "))}</td><td title="${esc(s.last.notes)}">${esc(s.last.notes)}</td>
      <td>${s.repair ? `<span class="chip warn">${esc((REPAIR_ACTIONS.find(r => r[0] === s.repair.action) || ["", s.repair.action])[1])}</span>` : `<span class="chip fail">No action yet</span>`}</td>
      <td class="act"><button class="btn sm" data-repair="${a.id}">${icon("wrench")} Action</button> <button class="btn sm" data-test="${a.id}">${icon("test")} Retest</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">None.</div>`;
  $("#main").innerHTML = `
    <div class="page-head"><h1>Failures &amp; Repairs</h1><span class="crumbs">${esc(scopeLabel())}</span><span class="spacer"></span>
      <button class="btn" id="failPrint">${icon("print")} Print failure report</button></div>
    <div class="tabs-inline">
      <button data-tab="open" aria-selected="${failTab === "open"}">Awaiting action (${open.length})</button>
      <button data-tab="actioned" aria-selected="${failTab === "actioned"}">Actioned, not yet retested (${actioned.length})</button>
      <button data-tab="log" aria-selected="${failTab === "log"}">Repair log (${log.length})</button></div>
    <div class="table-wrap">${failTab === "open" ? tbl(open) : failTab === "actioned" ? tbl(actioned) : log.length ? `<table class="grid"><thead><tr><th>Date</th><th>Asset no.</th><th>Description</th><th>Action</th><th>Fault</th><th>Work done</th><th>By</th><th class="n">Cost</th><th></th></tr></thead><tbody>
      ${log.map(r => { const a = idx().asset.get(r.assetId) || {}; return `<tr data-id="${a.id}"><td>${fmtDate(r.date)}</td><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc((REPAIR_ACTIONS.find(x => x[0] === r.action) || ["", r.action])[1])}</td><td>${esc(r.fault)}</td><td>${esc(r.work)}</td><td>${esc(r.by)}</td><td class="n">${r.cost ? "£" + Number(r.cost).toFixed(2) : ""}</td><td class="act"><button class="btn sm danger" data-delrep="${r.id}">${icon("trash")}</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No repairs logged.</div>`}</div>
    <p class="hint">A failed asset stays on this list until it passes a retest. Scrapping or removing it from service retires it automatically.</p>`;
  $$(".tabs-inline button").forEach(b => b.addEventListener("click", () => { failTab = b.dataset.tab; render(); }));
  $("#failPrint").addEventListener("click", () => Reports.run("failures", {}));
  $("#main").onclick = async e => {
    const r = e.target.closest("[data-repair]"); if (r) return recordRepair(r.dataset.repair);
    const t = e.target.closest("[data-test]"); if (t) return openTest({ assetId: t.dataset.test });
    const del = e.target.closest("[data-delrep]");
    if (del && await confirmBox("Delete repair entry", "Remove this entry from the repair log?", "Delete", "danger")) { db.repairs = db.repairs.filter(x => x.id !== del.dataset.delrep); changed(); render(); }
  };
  $$("tr[data-id]", $("#main")).forEach(tr => tr.addEventListener("dblclick", () => openAsset(tr.dataset.id)));
};

async function recordRepair(assetId) {
  const a = idx().asset.get(assetId); if (!a) return;
  const last = latestFor(assetId);
  const fault = last && last.overall === "fail" ? [Object.entries(last.results || {}).filter(([, v]) => v === "fail").map(([k]) => RESULT_NAMES[k]).join(", "), last.notes].filter(Boolean).join(" — ") : "";
  const r = await modal({
    title: `Repair / action — ${esc(a.assetNo)} ${esc(a.description)}`, width: 560, ok: "Save",
    body: `<div class="frow c2"><div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}"></div>
      <div class="field"><label>Action</label><select name="action">${REPAIR_ACTIONS.map(x => opt(x[0], x[1])).join("")}</select></div></div>
      <div class="field" style="margin-bottom:10px"><label>Fault</label><input type="text" name="fault" value="${esc(fault)}"></div>
      <div class="field" style="margin-bottom:10px"><label>Work done / parts</label><input type="text" name="work" placeholder="e.g. Replaced 13 A plug and 3 A fuse"></div>
      <div class="frow c2"><div class="field"><label>By</label><input type="text" name="by" value="${esc(engName(db.settings.defaultEngineerId))}"></div>
      <div class="field"><label>Cost (£)</label><input type="number" step="0.01" min="0" name="cost"></div></div>
      <p class="hint">Choosing <b>Scrapped</b> or <b>Removed from service</b> retires the asset. After a repair, retest the asset to put it back in service.</p>`,
    onSubmit: d => ({ id: uid(), assetId, testId: last ? last.id : "", created: Date.now(), date: fieldVal(d, "date") || todayISO(), action: fieldVal(d, "action"), fault: fieldVal(d, "fault"), work: fieldVal(d, "work"), by: fieldVal(d, "by"), cost: fieldVal(d, "cost") })
  });
  if (!r) return;
  db.repairs.push(r);
  if (r.action === "scrapped" || r.action === "removed") a.retired = true;
  changed(); renderTree(); render(); toast("Action recorded");
  if (r.action === "repaired" || r.action === "replaced-part") { if (await confirmBox("Retest now?", `Retest ${esc(a.assetNo)} now that it has been repaired?`, "Retest")) openTest({ assetId }); }
}

/* ---------------- Test history ---------------- */
const histFilter = { q: "", from: "", to: "", result: "", eng: "" };
VIEWS.history = () => {
  const ids = new Set(db.assets.filter(a => inScope(a)).map(a => a.id));
  const q = histFilter.q.toLowerCase();
  const list = db.tests.filter(t => {
    if (!ids.has(t.assetId)) return false;
    if (histFilter.from && t.date < histFilter.from) return false;
    if (histFilter.to && t.date > histFilter.to) return false;
    if (histFilter.result && t.overall !== histFilter.result) return false;
    if (histFilter.eng && (t.tester || engName(t.engineerId)) !== histFilter.eng) return false;
    if (q) { const a = idx().asset.get(t.assetId) || {}; if (![a.assetNo, a.description, t.notes, t.tester].join(" ").toLowerCase().includes(q)) return false; }
    return true;
  }).sort(byDateDesc);
  const shown = list.slice(0, 1000);
  const engs = [...new Set(db.tests.map(t => t.tester || engName(t.engineerId)).filter(Boolean))].sort();
  $("#main").innerHTML = `
    <div class="page-head"><h1>Test History</h1><span class="crumbs">${esc(scopeLabel())}</span><span class="spacer"></span>
      <button class="btn" id="hCsv">${icon("import")} Export CSV</button><button class="btn" id="hPrint">${icon("print")} Print test schedule</button></div>
    <div class="filters">
      <input type="search" id="h-q" placeholder="Search…" value="${esc(histFilter.q)}">
      From <input type="date" id="h-from" value="${histFilter.from}"> to <input type="date" id="h-to" value="${histFilter.to}">
      <select id="h-res">${opt("", "All results")}${opt("pass", "Pass", histFilter.result)}${opt("fail", "Fail", histFilter.result)}</select>
      <select id="h-eng">${opt("", "All engineers")}${engs.map(e => opt(e, e, histFilter.eng)).join("")}</select>
    </div>
    <div class="table-wrap" style="max-height:calc(100vh - 220px)">${shown.length ? `<table class="grid"><thead><tr><th>Date</th><th>Asset no.</th><th>Description</th><th>Client › Site</th><th>Engineer</th><th class="n">Earth Ω</th><th class="n">IR MΩ</th><th class="n">Leak mA</th><th>Result</th><th>Next due</th><th>Notes</th></tr></thead><tbody>
      ${shown.map(t => { const a = idx().asset.get(t.assetId) || {}; return `<tr data-t="${t.id}"><td>${fmtDate(t.date)}</td><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc(clientName(a.clientId))} › ${esc(siteName(a.siteId))}</td><td>${esc(t.tester || engName(t.engineerId))}</td>
        <td class="n">${esc(show(t.earth))}</td><td class="n">${esc(show(t.ir))}</td><td class="n">${esc(show(t.leak))}</td><td><span class="chip ${t.overall}">${RES[t.overall]}</span></td><td>${fmtDate(t.nextDue)}</td><td>${esc(t.notes)}</td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No tests match.</div>`}</div>
    <div class="table-foot">${list.length} test${list.length === 1 ? "" : "s"}${list.length > shown.length ? ` (showing the latest ${shown.length})` : ""} · double-click to view</div>`;
  const rr = debounce(() => { VIEWS.history(); const q = $("#h-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200);
  $("#h-q").addEventListener("input", e => { histFilter.q = e.target.value; rr(); });
  $("#h-from").addEventListener("change", e => { histFilter.from = e.target.value; render(); });
  $("#h-to").addEventListener("change", e => { histFilter.to = e.target.value; render(); });
  $("#h-res").addEventListener("change", e => { histFilter.result = e.target.value; render(); });
  $("#h-eng").addEventListener("change", e => { histFilter.eng = e.target.value; render(); });
  $("#hCsv").addEventListener("click", () => exportTestsCSV(list));
  $("#hPrint").addEventListener("click", () => Reports.run("schedule", { tests: list }));
  $$("tr[data-t]", $("#main")).forEach(tr => tr.addEventListener("dblclick", () => showTest(tr.dataset.t)));
};

/* ---------------- Clients & sites ---------------- */
VIEWS.clients = () => {
  const cnt = new Map(); db.assets.forEach(a => { if (!a.retired) cnt.set(a.clientId, (cnt.get(a.clientId) || 0) + 1); });
  const sc = new Map(); db.assets.forEach(a => { if (!a.retired) sc.set(a.siteId, (sc.get(a.siteId) || 0) + 1); });
  $("#main").innerHTML = `
    <div class="page-head"><h1>Clients &amp; Sites</h1><span class="spacer"></span><button class="btn primary" data-cmd="new-client">${icon("plus")} New client</button></div>
    ${db.clients.length ? [...db.clients].sort(byName).map(c => {
      const sites = db.sites.filter(s => s.clientId === c.id).sort(byName);
      return `<div class="card" style="margin-bottom:12px"><div class="card-head">${icon("building")} <span>${esc(c.name)}</span> <span class="chip">${cnt.get(c.id) || 0} assets</span>
        <span class="hint" style="font-weight:400">${esc([c.contact, c.phone, c.email].filter(Boolean).join(" · "))}</span><span class="spacer" style="flex:1"></span>
        <button class="btn sm" data-ec="${c.id}">${icon("edit")} Edit</button><button class="btn sm" data-as="${c.id}">${icon("plus")} Add site</button><button class="btn sm" data-cert="${c.id}">${icon("print")} Certificate</button><button class="btn sm danger" data-dc="${c.id}">${icon("trash")}</button></div>
        ${sites.length ? `<table class="grid"><thead><tr><th>Site</th><th>Address</th><th>Contact</th><th>Locations</th><th class="n">Assets</th><th></th></tr></thead><tbody>
        ${sites.map(s => { const locs = db.locations.filter(l => l.siteId === s.id).sort(byName); return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.address)}</td><td>${esc([s.contact, s.phone].filter(Boolean).join(" · "))}</td><td style="white-space:normal">${locs.map(l => `<span class="chip" style="margin:1px">${esc(l.name)}</span>`).join(" ")}</td><td class="n">${sc.get(s.id) || 0}</td>
          <td class="act"><button class="btn sm" data-es="${s.id}">${icon("edit")} Edit</button> <button class="btn sm" data-al="${s.id}">${icon("plus")} Location</button> <button class="btn sm danger" data-ds="${s.id}">${icon("trash")}</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="card-body hint">No sites yet.</div>`}</div>`;
    }).join("") : `<div class="card"><div class="empty">No clients yet. Add one, or they are created automatically when you test.</div></div>`}`;
  $("#main").onclick = async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ec) editClient(b.dataset.ec);
    else if (b.dataset.as) editSite(null, b.dataset.as);
    else if (b.dataset.es) editSite(b.dataset.es);
    else if (b.dataset.cert) Reports.run("certificate", { scope: { type: "client", id: b.dataset.cert } });
    else if (b.dataset.al) {
      const r = await modal({ title: "Add location", width: 380, body: `<div class="field"><label>Location name</label><input type="text" name="n" placeholder="e.g. Kitchen, Ground floor"></div>`, onSubmit: d => fieldVal(d, "n") || false });
      if (r) { ensureLocation(b.dataset.al, r); changed(); renderTree(); render(); }
    } else if (b.dataset.dc || b.dataset.ds) {
      const isC = !!b.dataset.dc, id = b.dataset.dc || b.dataset.ds;
      const n = db.assets.filter(a => isC ? a.clientId === id : a.siteId === id).length;
      if (n) { toast(`Can’t delete — ${n} asset(s) still belong to it. Move or delete them first.`, 3500); return; }
      if (!await confirmBox("Delete", `Delete this ${isC ? "client and its sites" : "site"}?`, "Delete", "danger")) return;
      if (isC) { const sids = db.sites.filter(s => s.clientId === id).map(s => s.id); db.locations = db.locations.filter(l => !sids.includes(l.siteId)); db.sites = db.sites.filter(s => s.clientId !== id); db.clients = db.clients.filter(c => c.id !== id); }
      else { db.locations = db.locations.filter(l => l.siteId !== id); db.sites = db.sites.filter(s => s.id !== id); }
      if (scope.id === id) scope = { type: "all", id: "" };
      changed(); renderTree(); render();
    }
  };
};
async function editClient(id) {
  const c = id ? idx().client.get(id) : {};
  const r = await modal({
    title: id ? "Edit client" : "New client", width: 560, ok: "Save",
    body: `<div class="field" style="margin-bottom:10px"><label>Client name *</label><input type="text" name="name" value="${esc(c.name || "")}"></div>
      <div class="frow c3"><div class="field"><label>Contact</label><input type="text" name="contact" value="${esc(c.contact || "")}"></div>
      <div class="field"><label>Phone</label><input type="tel" name="phone" value="${esc(c.phone || "")}"></div>
      <div class="field"><label>Email</label><input type="email" name="email" value="${esc(c.email || "")}"></div></div>
      <div class="field" style="margin-bottom:10px"><label>Address</label><textarea name="address">${esc(c.address || "")}</textarea></div>
      <div class="field"><label>Notes</label><input type="text" name="notes" value="${esc(c.notes || "")}"></div>`,
    onSubmit: d => {
      const o = { name: fieldVal(d, "name"), contact: fieldVal(d, "contact"), phone: fieldVal(d, "phone"), email: fieldVal(d, "email"), address: fieldVal(d, "address"), notes: fieldVal(d, "notes") };
      if (!o.name) { toast("Enter a name"); return false; }
      if (db.clients.some(x => x.id !== id && x.name.toLowerCase() === o.name.toLowerCase())) { toast("A client with that name exists"); return false; }
      return o;
    }
  });
  if (!r) return;
  if (id) Object.assign(c, r); else db.clients.push(Object.assign({ id: uid(), created: Date.now() }, r));
  changed(); renderTree(); render();
}
async function editSite(id, clientId) {
  const s = id ? idx().site.get(id) : { clientId };
  const r = await modal({
    title: id ? "Edit site" : `New site for ${esc(clientName(clientId))}`, width: 560, ok: "Save",
    body: `<div class="field" style="margin-bottom:10px"><label>Site name *</label><input type="text" name="name" value="${esc(s.name || "")}"></div>
      <div class="field" style="margin-bottom:10px"><label>Address</label><textarea name="address">${esc(s.address || "")}</textarea></div>
      <div class="frow c2"><div class="field"><label>Site contact</label><input type="text" name="contact" value="${esc(s.contact || "")}"></div>
      <div class="field"><label>Phone</label><input type="tel" name="phone" value="${esc(s.phone || "")}"></div></div>`,
    onSubmit: d => { const o = { name: fieldVal(d, "name"), address: fieldVal(d, "address"), contact: fieldVal(d, "contact"), phone: fieldVal(d, "phone") }; if (!o.name) { toast("Enter a name"); return false; } return o; }
  });
  if (!r) return;
  if (id) Object.assign(s, r); else db.sites.push(Object.assign({ id: uid(), clientId, created: Date.now() }, r));
  expanded.add(s.clientId);
  changed(); renderTree(); render();
}

/* ---------------- Instruments ---------------- */
VIEWS.instruments = () => {
  const list = [...db.instruments].sort((a, b) => cmpNat(a.calDue, b.calDue));
  $("#main").innerHTML = `
    <div class="page-head"><h1>Test Instruments</h1><span class="spacer"></span><button class="btn primary" id="addInst">${icon("plus")} Add instrument</button></div>
    <div class="table-wrap">${list.length ? `<table class="grid"><thead><tr><th>Make</th><th>Model</th><th>Serial no.</th><th>Last calibrated</th><th>Calibration due</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>
      ${list.map(i => { const d = i.calDue ? daysUntil(i.calDue) : null; const st = i.retired ? ["", "Retired"] : d === null ? ["", "—"] : d < 0 ? ["fail", "Expired"] : d <= 30 ? ["warn", `Due in ${d}d`] : ["pass", "In calibration"];
        return `<tr><td>${esc(i.make)}</td><td>${esc(i.model)}</td><td>${esc(i.serial)}</td><td>${fmtDate(i.calDate)}</td><td>${fmtDate(i.calDue)}</td><td><span class="chip ${st[0]}">${st[1]}</span></td><td>${esc(i.notes)}</td>
        <td class="act"><button class="btn sm" data-ei="${i.id}">${icon("edit")} Edit</button> <button class="btn sm danger" data-di="${i.id}">${icon("trash")}</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">Add your PAT tester so its serial number and calibration go on certificates.</div>`}</div>`;
  $("#addInst").addEventListener("click", () => editInstrument());
  $("#main").onclick = async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ei) editInstrument(b.dataset.ei);
    if (b.dataset.di && await confirmBox("Delete instrument", "Delete this instrument? Past tests keep its name.", "Delete", "danger")) { db.instruments = db.instruments.filter(x => x.id !== b.dataset.di); changed(); render(); }
  };
};
async function editInstrument(id) {
  const i = id ? idx().inst.get(id) : {};
  const r = await modal({
    title: id ? "Edit instrument" : "Add instrument", width: 520, ok: "Save",
    body: `<div class="frow c3"><div class="field"><label>Make *</label><input type="text" name="make" value="${esc(i.make || "")}" placeholder="e.g. Seaward"></div>
      <div class="field"><label>Model</label><input type="text" name="model" value="${esc(i.model || "")}"></div>
      <div class="field"><label>Serial no.</label><input type="text" name="serial" value="${esc(i.serial || "")}"></div></div>
      <div class="frow c2"><div class="field"><label>Last calibrated</label><input type="date" name="calDate" value="${esc(i.calDate || "")}"></div>
      <div class="field"><label>Calibration due</label><input type="date" name="calDue" value="${esc(i.calDue || "")}"></div></div>
      <div class="field" style="margin-bottom:10px"><label>Notes</label><input type="text" name="notes" value="${esc(i.notes || "")}"></div>
      <label class="chk"><input type="checkbox" name="retired"${i.retired ? " checked" : ""}> Retired</label>`,
    onOpen: d => d.querySelector("[name=calDate]").addEventListener("change", e => { const due = d.querySelector("[name=calDue]"); if (e.target.value && !due.value) due.value = addMonths(e.target.value, 12); }),
    onSubmit: d => { const o = {}; ["make", "model", "serial", "calDate", "calDue", "notes", "retired"].forEach(k => o[k] = fieldVal(d, k)); if (!o.make) { toast("Enter the make"); return false; } return o; }
  });
  if (!r) return;
  if (id) Object.assign(i, r); else db.instruments.push(Object.assign({ id: uid() }, r));
  changed(); render();
}

/* ---------------- Engineers ---------------- */
VIEWS.engineers = () => {
  const n = new Map(); db.tests.forEach(t => n.set(t.engineerId, (n.get(t.engineerId) || 0) + 1));
  $("#main").innerHTML = `
    <div class="page-head"><h1>Engineers</h1><span class="spacer"></span><button class="btn primary" id="addEng">${icon("plus")} Add engineer</button></div>
    <div class="table-wrap">${db.engineers.length ? `<table class="grid"><thead><tr><th>Name</th><th>Qualifications</th><th>Position</th><th class="n">Tests</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...db.engineers].sort(byName).map(e => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.quals)}</td><td>${esc(e.position)}</td><td class="n">${n.get(e.id) || 0}</td><td>${e.retired ? "Inactive" : `<span class="chip pass">Active</span>`}</td>
        <td class="act"><button class="btn sm" data-ee="${e.id}">${icon("edit")} Edit</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Add the people who carry out testing. Their name goes on each test and on certificates.</div>`}</div>`;
  $("#addEng").addEventListener("click", () => editEngineer());
  $("#main").onclick = e => { const b = e.target.closest("[data-ee]"); if (b) editEngineer(b.dataset.ee); };
};
async function editEngineer(id) {
  const e = id ? idx().eng.get(id) : {};
  const r = await modal({
    title: id ? "Edit engineer" : "Add engineer", width: 480, ok: "Save",
    body: `<div class="field" style="margin-bottom:10px"><label>Name *</label><input type="text" name="name" value="${esc(e.name || "")}"></div>
      <div class="field" style="margin-bottom:10px"><label>Qualifications</label><input type="text" name="quals" value="${esc(e.quals || "")}" placeholder="e.g. City & Guilds 2377-22"></div>
      <div class="field" style="margin-bottom:10px"><label>Position</label><input type="text" name="position" value="${esc(e.position || "")}"></div>
      <label class="chk"><input type="checkbox" name="retired"${e.retired ? " checked" : ""}> Inactive</label>`,
    onSubmit: d => { const o = { name: fieldVal(d, "name"), quals: fieldVal(d, "quals"), position: fieldVal(d, "position"), retired: fieldVal(d, "retired") }; if (!o.name) { toast("Enter a name"); return false; } return o; }
  });
  if (!r) return;
  if (id) Object.assign(e, r); else { const n = Object.assign({ id: uid() }, r); db.engineers.push(n); if (!db.settings.defaultEngineerId) db.settings.defaultEngineerId = n.id; }
  changed(); render();
}

/* ---------------- Reports view ---------------- */
let reportSel = "certificate";
VIEWS.reports = () => {
  const tiles = Reports.list();
  const def = tiles.find(t => t.id === reportSel) || tiles[0];
  $("#main").innerHTML = `
    <div class="page-head"><h1>Reports &amp; Certificates</h1><span class="crumbs">${esc(scopeLabel())}</span></div>
    <div class="report-tiles">${tiles.map(t => `<button class="rtile${t.id === def.id ? " on" : ""}" data-r="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join("")}</div>
    <div class="card" style="margin-top:16px"><h2>${esc(def.name)}</h2><div class="card-body">
      <div class="frow c4">
        <div class="field"><label>Client / site</label><select id="rp-scope">${scopeOptions(scope)}</select></div>
        ${def.dates ? `<div class="field"><label>Tests from</label><input type="date" id="rp-from" value="${addMonths(todayISO(), -12)}"></div><div class="field"><label>Tests to</label><input type="date" id="rp-to" value="${todayISO()}"></div>` : ""}
        ${def.id === "due" ? `<div class="field"><label>Due within</label><select id="rp-range">${[["overdue", "Overdue only"], ["warn", `Next ${db.settings.dueWarnDays} days`], ["60", "60 days"], ["90", "90 days"], ["365", "12 months"]].map(x => opt(x[0], x[1], "warn")).join("")}</select></div>` : ""}
        ${def.id === "labels" ? `<div class="field"><label>Which assets</label><select id="rp-which"><option value="tested">Passed (with test date)</option><option value="all">All in scope</option></select></div>` : ""}
      </div>
      <div style="display:flex;gap:8px"><button class="btn primary" id="rp-preview">${icon("print")} Preview &amp; print</button><button class="btn" id="rp-pdf">${icon("save")} Save as PDF</button></div>
      <p class="hint">${esc(def.help || "")}</p></div></div>`;
  $$(".rtile").forEach(b => b.addEventListener("click", () => { reportSel = b.dataset.r; render(); }));
  const opts = () => {
    const [type, id] = $("#rp-scope").value.split(":");
    return { scope: { type, id: id || "" }, from: $("#rp-from") ? $("#rp-from").value : "", to: $("#rp-to") ? $("#rp-to").value : "", range: $("#rp-range") ? $("#rp-range").value : "", which: $("#rp-which") ? $("#rp-which").value : "" };
  };
  $("#rp-preview").addEventListener("click", () => Reports.run(def.id, opts()));
  $("#rp-pdf").addEventListener("click", () => Reports.run(def.id, Object.assign(opts(), { pdf: true })));
};
function scopeOptions(sel) {
  let h = opt("all:", "All clients", sel.type === "all" ? "all:" : "");
  const cur = `${sel.type}:${sel.id}`;
  for (const c of [...db.clients].sort(byName)) {
    h += opt(`client:${c.id}`, c.name, cur);
    for (const s of db.sites.filter(x => x.clientId === c.id).sort(byName)) {
      h += opt(`site:${s.id}`, `   ${c.name} › ${s.name}`, cur);
      for (const l of db.locations.filter(x => x.siteId === s.id).sort(byName)) h += opt(`location:${l.id}`, `      ${s.name} › ${l.name}`, cur);
    }
  }
  return h;
}

/* ---------------- Settings ---------------- */
VIEWS.settings = async () => {
  const st = db.settings, c = st.company;
  const info = window.api ? await window.api.info() : { version: "dev", dataFile: dataPath };
  const limitRows = std => {
    const L = st.limits[std], D = S.DEFAULT_LIMITS[std];
    const lab = { earthBase: "Earth base (Ω)", earthBaseLen: "Base cord length (m)", earthStep: "Earth step (Ω)", earthStepLen: "Step length (m)", earthMax: "Earth max (Ω)", irClassI: "IR Class I (MΩ)", irClassIHeat: "IR Class I heating (MΩ)", irHeatKw: "Heating threshold (kW)", irClassII: "IR Class II (MΩ)", irClassIII: "IR Class III (MΩ)", leakClassI: "PE current Class I (mA)", leakClassII: "Touch current Class II (mA)", leakHeatPerKw: "Heating mA per kW", leakHeatMax: "Heating max (mA)", leakHeatKw: "Heating leakage threshold (kW)", rcdX1: "RCD ×1 (ms)", rcdX5: "RCD ×5 (ms)" };
    return Object.keys(D).map(k => `<div class="field"><label>${lab[k] || k}</label><input type="number" step="any" data-lim="${std}.${k}" value="${esc(L[k])}"></div>`).join("");
  };
  $("#main").innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="grid2">
      <div class="card"><h2>Your company (shown on certificates)</h2><div class="card-body">
        <div class="frow c2"><div class="field"><label>Company name</label><input type="text" data-co="name" value="${esc(c.name)}"></div>
        <div class="field"><label>Registration / scheme no.</label><input type="text" data-co="regNo" value="${esc(c.regNo)}"></div></div>
        <div class="field" style="margin-bottom:10px"><label>Address</label><textarea data-co="address">${esc(c.address)}</textarea></div>
        <div class="frow c3"><div class="field"><label>Phone</label><input type="text" data-co="phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>Email</label><input type="text" data-co="email" value="${esc(c.email)}"></div>
        <div class="field"><label>Website</label><input type="text" data-co="website" value="${esc(c.website)}"></div></div>
        <div class="field"><label>Logo</label><div style="display:flex;gap:8px;align-items:center">${c.logo ? `<img class="logo-prev" src="${esc(c.logo)}" alt="Logo">` : `<span class="hint">None</span>`}
          <button class="btn sm" id="logoPick">Choose image…</button>${c.logo ? `<button class="btn sm" id="logoClear">Remove</button>` : ""}</div></div>
      </div></div>
      <div class="card"><h2>Testing defaults</h2><div class="card-body">
        <div class="frow c3"><div class="field"><label>Standard</label><select id="s-std">${Object.values(S.STANDARDS).map(s => opt(s.id, s.name, st.standard)).join("")}</select></div>
        <div class="field"><label>Default retest (months)</label><input type="number" min="1" max="120" id="s-iv" value="${esc(st.interval)}"></div>
        <div class="field"><label>"Due soon" warning (days)</label><input type="number" min="1" max="365" id="s-warn" value="${esc(st.dueWarnDays)}"></div></div>
        <div class="field" style="margin-bottom:10px"><label>Label layout</label><select id="s-label">${[["3x8", "24 per A4 sheet (3 × 8, 64 × 34 mm)"], ["2x7", "14 per A4 sheet (2 × 7, 99 × 38 mm)"], ["4x10", "40 per A4 sheet (4 × 10, 48 × 25 mm)"]].map(x => opt(x[0], x[1], st.labelLayout)).join("")}</select></div>
        <div class="field"><label>Certificate declaration</label><textarea id="s-cert" rows="3">${esc(st.certNotes)}</textarea></div>
      </div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Pass/fail limits <span class="hint" style="font-weight:400">— check these against your copy of the standard and your test policy</span><span style="flex:1"></span><button class="btn sm" id="limReset">Reset to defaults</button></h2><div class="card-body">
      <h4 style="margin:0 0 8px">${S.STANDARDS.iet.name}</h4><div class="frow" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${limitRows("iet")}</div>
      <h4 style="margin:12px 0 8px">${S.STANDARDS.en50699.name}</h4><div class="frow" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${limitRows("en50699")}</div>
    </div></div>
    <div class="card" style="margin-top:16px"><h2>Data</h2><div class="card-body">
      <dl class="kv"><dt>Data file</dt><dd><code>${esc(info.dataFile)}</code></dd><dt>Automatic backups</dt><dd>Daily, in a <code>Backups</code> folder next to the data file (last 30 kept)</dd><dt>Version</dt><dd>PAT Manager ${esc(info.version)}</dd></dl>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn" id="dShow">Show data folder</button><button class="btn" id="dOpen">Open another data file…</button><button class="btn" id="dNew">Start a new data file…</button>
        <button class="btn" data-cmd="backup">Back up now…</button><button class="btn" data-cmd="restore">Restore from backup…</button><button class="btn" id="dDemo">Load demo data</button></div>
      <p class="hint">Put the data file on a shared or synced drive (e.g. OneDrive) to use it from more than one PC — but only open it on one PC at a time.</p>
    </div></div>`;
  const m = $("#main");
  m.querySelectorAll("[data-co]").forEach(i => i.addEventListener("change", () => { c[i.dataset.co] = i.value.trim(); changed(); }));
  $("#s-std").addEventListener("change", e => { st.standard = e.target.value; changed(); });
  $("#s-iv").addEventListener("change", e => { st.interval = Number(e.target.value) || 12; changed(); });
  $("#s-warn").addEventListener("change", e => { st.dueWarnDays = Number(e.target.value) || 30; changed(); });
  $("#s-label").addEventListener("change", e => { st.labelLayout = e.target.value; changed(); });
  $("#s-cert").addEventListener("change", e => { st.certNotes = e.target.value; changed(); });
  m.querySelectorAll("[data-lim]").forEach(i => i.addEventListener("change", () => { const [s, k] = i.dataset.lim.split("."); const v = Number(i.value); if (isFinite(v) && i.value !== "") { st.limits[s][k] = v; changed(); } }));
  $("#limReset").addEventListener("click", async () => { if (await confirmBox("Reset limits", "Reset all pass/fail limits to the defaults?")) { st.limits = JSON.parse(JSON.stringify(S.DEFAULT_LIMITS)); changed(); render(); } });
  $("#logoPick").addEventListener("click", async () => {
    if (!window.api) return;
    const f = await window.api.openFile({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"] }], asDataUrl: true });
    if (!f) return;
    if (f.content.length > 1.5e6) { toast("Logo is too large — use an image under 1 MB"); return; }
    c.logo = f.content; changed(); render();
  });
  if ($("#logoClear")) $("#logoClear").addEventListener("click", () => { c.logo = ""; changed(); render(); });
  $("#dShow").addEventListener("click", () => window.api && window.api.showData());
  $("#dOpen").addEventListener("click", () => switchDataFile("open"));
  $("#dNew").addEventListener("click", () => switchDataFile("new"));
  $("#dDemo").addEventListener("click", loadDemo);
};

async function switchDataFile(mode) {
  if (!window.api) return;
  await flush();
  const p = await window.api.chooseDb(mode);
  if (!p) return;
  await boot();
  toast(mode === "open" ? "Opened " + p : "New data file created");
}

/* ======================= Import / export ======================= */
function csvCell(v) { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function toCSV(header, rows) { return "﻿" + [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n"); }
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], cur = "", q = false;
  const delim = (text.split(/\r?\n/)[0].match(/;/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
async function saveText(name, content, filters) {
  if (window.api) { const r = await window.api.saveFile({ defaultName: name, content, filters }); if (r.ok) toast("Saved " + r.path); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content])); a.download = name; a.click();
}
const ASSET_CSV = ["Asset No", "Description", "Client", "Site", "Location", "Make", "Model", "Serial", "Class", "Type", "Fuse", "Cord CSA", "Cord Length", "Power kW", "Heating", "Retest Months", "Last Test", "Result", "Next Due", "Status", "Notes"];
function exportAssetsCSV(list, name = "Asset_register") {
  const rows = list.map(a => { const s = assetStatus(a); return [a.assetNo, a.description, clientName(a.clientId), siteName(a.siteId), locName(a.locationId), a.make, a.model, a.serial, a.cls, a.type, a.fuse, a.csa, a.length, a.powerKw, a.heating ? "Yes" : "", a.interval, s.last ? s.last.date : "", s.last ? s.last.overall : "", s.last && s.last.overall === "pass" ? s.last.nextDue : "", s.txt, a.notes]; });
  saveText(`${name}_${todayISO()}.csv`, toCSV(ASSET_CSV, rows), [{ name: "CSV", extensions: ["csv"] }]);
}
function exportTestsCSV(list) {
  const h = ["Date", "Asset No", "Description", "Client", "Site", "Location", "Class", "Engineer", "Instrument", "Standard", "Visual", "Earth Ω", "Earth limit", "IR MΩ", "IR limit", "IR V", "Leakage mA", "Leakage limit", "Leakage method", "Polarity", "Functional", "RCD x1 ms", "RCD x5 ms", "Result", "Next Due", "Notes"];
  const rows = list.map(t => { const a = idx().asset.get(t.assetId) || {}; return [t.date, a.assetNo, a.description, clientName(a.clientId), siteName(a.siteId), locName(a.locationId), a.cls, t.tester || engName(t.engineerId), t.instrument, t.standard, (t.results || {}).visual, t.earth, t.earthLimit, t.ir, t.irLimit, t.irV, t.leak, t.leakLimit, t.leakMethod, t.polarity, t.functional, t.rcd1, t.rcd5, t.overall, t.nextDue, t.notes]; });
  saveText(`Test_history_${todayISO()}.csv`, toCSV(h, rows), [{ name: "CSV", extensions: ["csv"] }]);
}

async function importData() {
  const choice = await modal({
    title: "Import", width: 560, ok: false,
    body: `<div class="stack" style="gap:10px">
      <button type="submit" class="rtile" value="csv"><b>Asset list / results from CSV</b><span>A spreadsheet saved as CSV — e.g. an export from another PAT program or from your tester’s software. You’ll match the columns next.</span></button>
      <button type="submit" class="rtile" value="patlog"><b>PAT Test Log backup (phone app)</b><span>The JSON backup from the PAT Test Log phone app: assets, sites, locations and every test.</span></button>
      <button type="button" class="rtile" id="tplBtn"><b>Download a blank CSV template</b><span>Fill this in with Excel and import it.</span></button></div>`,
    onOpen: d => $("#tplBtn", d).addEventListener("click", () => saveText("PAT_import_template.csv", toCSV(ASSET_CSV.filter(h => !["Status"].includes(h)), [["A0001", "Kettle", "Acme Ltd", "Head Office", "Kitchen", "Russell Hobbs", "", "", "I", "Portable", "13", "1.0", "0.8", "3", "Yes", "12", "2026-01-15", "pass", "2027-01-15", "", ""]]), [{ name: "CSV", extensions: ["csv"] }]))
  });
  if (!choice) return;
  if (!window.api) { toast("Import needs the desktop app"); return; }
  const f = await window.api.openFile({ filters: choice === "csv" ? [{ name: "CSV", extensions: ["csv", "txt"] }] : [{ name: "Backup", extensions: ["json"] }] });
  if (!f) return;
  if (choice === "csv") return importCSV(f.content, f.name);
  return importPatLog(f.content);
}

async function importPatLog(text) {
  let data; try { data = JSON.parse(text); } catch (_) { toast("That isn’t a valid JSON file"); return; }
  if (data.app !== "pat-log") { toast("That isn’t a PAT Test Log backup"); return; }
  const r = await modal({ title: "Import PAT Test Log backup", width: 460, ok: "Import",
    body: `<p style="margin-top:0">${data.assets.length} assets and ${data.tests.length} tests found. The phone app has sites but not clients, so choose the client to put them under.</p>
      <div class="field"><label>Client</label><input type="text" name="client" list="dl-ic" value="${esc(scopeNames().client || "")}">${dlist("dl-ic", db.clients.map(c => c.name))}</div><p class="hint">Photos are not imported.</p>`,
    onSubmit: d => fieldVal(d, "client") || (toast("Enter a client"), false) });
  if (!r) return;
  const cid = ensureClient(r);
  const map = new Map(); let na = 0, nt = 0;
  for (const pa of data.assets) {
    const sid = ensureSite(cid, pa.site || "Main site"), lid = ensureLocation(sid, pa.location);
    let a = findAssetsByNo(pa.assetNo).find(x => x.clientId === cid);
    const fields = { assetNo: keyOf(pa.assetNo), description: pa.description || "", make: pa.make || "", model: pa.model || "", serial: pa.serial || "", cls: pa.cls || "I", type: pa.type || "Portable", fuse: pa.fuse || "", csa: pa.csa || "", length: pa.length || "", powerKw: pa.powerKw || "", heating: !!pa.heating, notes: pa.notes || "", clientId: cid, siteId: sid, locationId: lid };
    if (a) Object.assign(a, fields); else { a = Object.assign({ id: uid(), created: pa.created || Date.now(), interval: Number(db.settings.interval) }, fields); db.assets.push(a); na++; }
    map.set(pa.id, a);
  }
  const have = new Set(db.tests.map(t => t.importId).filter(Boolean));
  for (const t of data.tests) {
    const a = map.get(t.assetId); if (!a || have.has("patlog:" + t.id)) continue;
    const n = Object.assign({}, t, { id: uid(), importId: "patlog:" + t.id, assetId: a.id, photos: undefined });
    db.tests.push(n); nt++;
    if (t.interval) a.interval = t.interval;
  }
  changed(); renderTree(); render();
  toast(`Imported ${na} new assets and ${nt} tests`, 4000);
}

async function importCSV(text, fname) {
  const rows = parseCSV(text);
  if (rows.length < 2) { toast("The file has no data rows"); return; }
  const header = rows[0].map(h => h.trim());
  const FIELDS = [
    ["assetNo", "Asset no. *", /asset\s*(no|num|id|#)|^asset$|^id$|barcode|tag/i], ["description", "Description", /desc|appliance|item|name/i],
    ["client", "Client", /client|customer|company/i], ["site", "Site", /site|premises|building/i], ["location", "Location", /loc|room|area|dept/i],
    ["make", "Make", /make|manuf|brand/i], ["model", "Model", /model/i], ["serial", "Serial no.", /serial/i], ["cls", "Class", /class/i], ["type", "Type", /type|category/i],
    ["fuse", "Fuse", /fuse/i], ["csa", "Cord CSA", /csa|mm|conductor/i], ["length", "Cord length", /length|len/i], ["powerKw", "Power kW", /power|kw|watt/i], ["heating", "Heating", /heat/i], ["interval", "Retest months", /interval|retest|freq|month/i],
    ["date", "Test date", /last\s*test|test\s*date|^date|tested/i], ["result", "Result", /result|pass|outcome|status/i], ["nextDue", "Next due", /next|due|retest\s*date/i],
    ["earth", "Earth Ω", /earth|bond|continuity/i], ["ir", "Insulation MΩ", /insul|^ir/i], ["leak", "Leakage mA", /leak|touch|substitute/i], ["engineer", "Engineer", /engineer|tester|tested\s*by|user/i], ["notes", "Notes", /note|comment|remark/i]
  ];
  const used = new Set();
  const guess = FIELDS.map(([k, , re]) => { const i = header.findIndex((h, j) => !used.has(j) && re.test(h)); if (i >= 0) used.add(i); return i; });
  const r = await modal({
    title: `Import ${esc(fname)} — match columns`, width: 760, ok: `Import ${rows.length - 1} rows`,
    body: `<p style="margin-top:0" class="hint">Match each field to a column from your file. Rows with a test date and result also create a test record.</p>
      <div class="frow" style="grid-template-columns:repeat(3,1fr)">${FIELDS.map(([k, l], fi) => `<div class="field"><label>${l}</label><select name="m-${k}">${opt("-1", "— not in file —", guess[fi])}${header.map((h, i) => opt(i, h || `Column ${i + 1}`, guess[fi])).join("")}</select></div>`).join("")}</div>
      <div class="field" style="margin-top:6px"><label>Client for rows without one</label><input type="text" name="defClient" list="dl-ic2" value="${esc(scopeNames().client || "")}">${dlist("dl-ic2", db.clients.map(c => c.name))}</div>`,
    onSubmit: d => {
      const m = {}; FIELDS.forEach(([k]) => m[k] = Number(fieldVal(d, "m-" + k)));
      if (m.assetNo < 0) { toast("Match the asset number column"); return false; }
      return { m, defClient: fieldVal(d, "defClient") };
    }
  });
  if (!r) return;
  const { m } = r;
  const get = (row, k) => m[k] >= 0 ? String(row[m[k]] ?? "").trim() : "";
  const normDate = s => {
    if (!s) return "";
    let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (x) return `${x[1]}-${x[2].padStart(2, "0")}-${x[3].padStart(2, "0")}`;
    x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (x) { const y = x[3].length === 2 ? "20" + x[3] : x[3]; return `${y}-${x[2].padStart(2, "0")}-${x[1].padStart(2, "0")}`; }
    return "";
  };
  const normCls = s => /iii|3/i.test(s) ? "III" : /ii|2/i.test(s) ? "II" : "I";
  let na = 0, nu = 0, nt = 0, skipped = 0;
  for (const row of rows.slice(1)) {
    const no = keyOf(get(row, "assetNo"));
    const cname = get(row, "client") || r.defClient;
    if (!no || !cname) { skipped++; continue; }
    const cid = ensureClient(cname), sid = ensureSite(cid, get(row, "site") || "Main site"), lid = ensureLocation(sid, get(row, "location"));
    const f = { assetNo: no, clientId: cid, siteId: sid, locationId: lid };
    for (const k of ["description", "make", "model", "serial", "fuse", "csa", "length", "powerKw", "notes"]) { const v = get(row, k); if (v) f[k] = v; }
    if (m.cls >= 0 && get(row, "cls")) f.cls = normCls(get(row, "cls"));
    if (m.type >= 0) { const t = get(row, "type"); const tt = TYPES.find(x => x.toLowerCase() === t.toLowerCase()); if (tt) f.type = tt; }
    if (m.heating >= 0) f.heating = /^(y|yes|true|1)$/i.test(get(row, "heating"));
    if (m.interval >= 0 && Number(get(row, "interval"))) f.interval = Number(get(row, "interval"));
    let a = findAssetsByNo(no).find(x => x.clientId === cid);
    if (a) { Object.assign(a, f, { updated: Date.now() }); nu++; }
    else { a = Object.assign({ id: uid(), created: Date.now(), cls: "I", type: "Portable", interval: Number(db.settings.interval), description: "" }, f); db.assets.push(a); na++; }
    const date = normDate(get(row, "date")), res = get(row, "result");
    if (date && res) {
      const overall = /fail|^f$|x/i.test(res) ? "fail" : "pass";
      if (!db.tests.some(t => t.assetId === a.id && t.date === date)) {
        const iv = a.interval || db.settings.interval;
        db.tests.push({ id: uid(), assetId: a.id, created: Date.now(), date, standard: db.settings.standard, tester: get(row, "engineer"), interval: iv,
          nextDue: overall === "pass" ? (normDate(get(row, "nextDue")) || addMonths(date, iv)) : "", visual: {}, earth: get(row, "earth"), ir: get(row, "ir"), leak: get(row, "leak"),
          results: {}, overall, notes: "Imported from " + fname, importId: "csv" });
        nt++;
      }
    }
    _idx = null;
  }
  changed(); renderTree(); render();
  toast(`Imported: ${na} new, ${nu} updated assets, ${nt} tests${skipped ? `, ${skipped} rows skipped` : ""}`, 5000);
}

async function backupNow() {
  await flush();
  const name = `PAT_Manager_backup_${todayISO()}.json`;
  if (window.api) { const r = await window.api.saveFile({ defaultName: name, content: JSON.stringify(db), filters: [{ name: "PAT Manager backup", extensions: ["json"] }] }); if (r.ok) toast("Backup saved to " + r.path, 4000); }
  else saveText(name, JSON.stringify(db));
}
async function restoreBackup() {
  if (!window.api) return;
  const f = await window.api.openFile({ filters: [{ name: "PAT Manager backup", extensions: ["json"] }] });
  if (!f) return;
  let data; try { data = JSON.parse(f.content); } catch (_) { toast("Not a valid backup file"); return; }
  if (data.app === "pat-log") return importPatLog(f.content);
  if (data.app !== "pat-manager") { toast("Not a PAT Manager backup"); return; }
  if (!await confirmBox("Restore backup", `Replace everything in the current data file with this backup (${data.assets.length} assets, ${data.tests.length} tests)? The current data is backed up automatically first.`, "Restore", "danger")) return;
  await window.api.saveFile({ defaultName: `PAT_Manager_before_restore_${Date.now()}.json`, content: JSON.stringify(db), filters: [{ name: "JSON", extensions: ["json"] }] });
  db = normalise(data); _idx = null; changed(); scope = { type: "all", id: "" }; renderTree(); render(); toast("Backup restored");
}

/* ======================= Demo data ======================= */
async function loadDemo() {
  if (db.assets.length && !await confirmBox("Load demo data", "Add a demo client with sample assets and tests to your current data? You can delete the demo client afterwards.")) return;
  const items = [["Kettle", "I", "Portable", "1.0", 0.8, 3, true], ["Microwave", "I", "Stationary", "1.0", 1, 1.2, false], ["Desktop PC", "I", "IT equipment", "0.75", 1.8, 0.3, false], ["Monitor", "II", "IT equipment", "", "", 0.05, false], ["Extension lead 4-way", "I", "Extension lead", "1.25", 5, "", false], ["Desk fan", "II", "Portable", "", "", 0.04, false], ["Vacuum cleaner", "II", "Portable", "", "", 1.4, false], ["Fridge", "I", "Stationary", "0.75", 1.5, 0.15, false], ["Toaster", "I", "Portable", "0.75", 0.9, 1.6, true], ["Laptop charger", "II", "IT equipment", "", "", 0.09, false], ["IEC lead", "I", "IEC lead", "0.75", 1.8, "", false], ["Heater", "I", "Portable", "1.0", 1.8, 2.5, true], ["Drill", "II", "Hand-held", "", "", 0.7, false], ["Photocopier", "I", "Stationary", "1.0", 2, 1.5, false]];
  const cid = ensureClient("Demo — Riverside Dental Group");
  const sites = [["Riverside Surgery", ["Reception", "Surgery 1", "Surgery 2", "Staff room"]], ["Hilltop Clinic", ["Office", "Kitchen", "Store"]]];
  if (!db.engineers.length) db.engineers.push({ id: uid(), name: "Alex Morgan", quals: "City & Guilds 2377-22" });
  if (!db.settings.defaultEngineerId) db.settings.defaultEngineerId = db.engineers[0].id;
  if (!db.instruments.length) db.instruments.push({ id: uid(), make: "Seaward", model: "Apollo 600+", serial: "4A1234", calDate: addMonths(todayISO(), -10), calDue: addMonths(todayISO(), 2) });
  if (!db.settings.defaultInstrumentId) db.settings.defaultInstrumentId = db.instruments[0].id;
  _idx = null;
  const eng = db.engineers[0], inst = db.instruments[0];
  let n = 1;
  for (const [sn, locs] of sites) {
    const sid = ensureSite(cid, sn);
    for (const ln of locs) {
      const lid = ensureLocation(sid, ln);
      for (let k = 0; k < 4; k++) {
        const it = items[(n * 5 + Math.floor(n / items.length)) % items.length];
        const no = "RDG" + String(n++).padStart(4, "0");
        if (findAssetsByNo(no).some(x => x.clientId === cid)) continue;
        const a = { id: uid(), created: Date.now(), assetNo: no, clientId: cid, siteId: sid, locationId: lid, description: it[0], cls: it[1], type: it[2], csa: it[3], length: String(it[4]), powerKw: String(it[5]), heating: it[6], fuse: it[5] > 0.7 ? "13" : "3", make: "", model: "", serial: "", interval: it[2] === "Hand-held" ? 6 : 12, notes: "" };
        db.assets.push(a);
        const back = [430, 330, 200, 60][(n + k) % 4] + (n % 40);
        for (const ago of [back + 365, back]) {
          const date = addDays(todayISO(), -ago);
          const fail = ago === back && n % 11 === 0;
          const L = limitsFor("iet");
          const el = a.cls === "I" ? S.earthLimit("iet", a.csa, a.length, L).limit : null;
          const vis = Object.fromEntries(VISUAL_ITEMS.map(([vk]) => [vk, fail && vk === "flex" ? "fail" : "pass"]));
          const t = { id: uid(), assetId: a.id, created: Date.now() - ago * 864e5, date, standard: "iet", engineerId: eng.id, tester: eng.name, instrumentId: inst.id, instrument: instName(inst.id) || "Seaward Apollo 600+",
            interval: a.interval, visual: vis, visualFails: fail ? ["flex"] : [], earth: a.cls === "I" ? (0.05 + (n % 5) * 0.02).toFixed(2) : "", earthLimit: el === null ? "" : String(el),
            ir: n % 3 ? ">299" : String(80 + n), irLimit: String(S.irLimit("iet", a, L).limit), irV: "500", leak: a.type === "Extension lead" || a.type === "IEC lead" ? "" : (a.cls === "II" ? 0.02 : 0.12 + (n % 4) * 0.05).toFixed(2),
            leakLimit: a.type === "Extension lead" || a.type === "IEC lead" ? "" : String(S.leakLimit("iet", a, L).limit), leakMethod: a.cls === "II" ? "Touch current" : "Substitute", polarity: "pass", functional: "pass", rcd1: "", rcd5: "",
            results: { visual: fail ? "fail" : "pass", earth: a.cls === "I" ? "pass" : null, ir: "pass", polarity: "pass", functional: "pass" }, overall: fail ? "fail" : "pass", notes: fail ? "Flex damaged near plug" : "" };
          t.nextDue = t.overall === "pass" ? addMonths(date, a.interval) : "";
          db.tests.push(t);
        }
      }
    }
  }
  expanded.add(cid);
  changed(); renderTree(); go("dashboard"); toast("Demo data added");
}

/* ======================= Commands & boot ======================= */
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function quickFind(no) {
  const m = findAssetsByNo(no);
  if (m.length === 1) openAsset(m[0].id);
  else if (m.length > 1) { assetFilter.q = no; go("assets"); }
  else if (await confirmBox("Asset not found", `No asset numbered <b>${esc(keyOf(no))}</b>. Test it as a new asset?`, "New test")) {
    openTest({}); setTimeout(() => { const i = document.querySelector("dialog [name=assetNo]"); if (i) { i.value = keyOf(no); i.dispatchEvent(new Event("change")); } }, 0);
  }
}
function command(c) {
  if (c.startsWith("go:")) return go(c.slice(3));
  switch (c) {
    case "new-test": return openTest({});
    case "new-asset": return editAsset(null);
    case "new-client": return editClient();
    case "labels": return Reports.run("labels", { scope, which: "tested" });
    case "import": return importData();
    case "export-csv": return exportAssetsCSV(scopedAssets());
    case "backup": return backupNow();
    case "restore": return restoreBackup();
    case "about": return modal({ title: "About PAT Manager", width: 440, cancel: false, ok: "Close", body: `<p style="margin-top:0"><b>PAT Manager</b> — in-service inspection &amp; testing records for portable electrical equipment.</p><p class="hint">Limits default to the IET Code of Practice (5th ed.) and BS EN 50699:2021. Check them against your test policy under Settings.</p><p class="hint">Data file: ${esc(dataPath)}</p>` });
  }
}

async function boot() {
  const r = await store.load();
  dataPath = r.path;
  if (r.error) alert(r.error + "\n\nThe app will start with an empty database; your file has not been changed. Use Settings → Open another data file, or restore from the Backups folder.");
  db = normalise(r.data);
  _idx = null; scope = { type: "all", id: "" }; selected.clear();
  if (!r.data && !r.error) { dirty = true; flush(); }
  $("#sbSaved").textContent = r.data ? "Loaded" : "New data file";
  renderTree(); refreshChrome(); go(view);
}

function bind() {
  document.addEventListener("click", e => { const b = e.target.closest("[data-cmd]"); if (b) command(b.dataset.cmd); });
  $("#nav").addEventListener("click", e => { const a = e.target.closest("a[data-view]"); if (a) go(a.dataset.view); });
  $("#treeAdd").addEventListener("click", () => editClient());
  $("#tree").addEventListener("click", e => {
    const n = e.target.closest(".node"); if (!n) return;
    const { type, id } = n.dataset;
    if (e.target.closest("[data-twist]") && id) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTree(); return; }
    if (id) expanded.add(id);
    setScope({ type, id });
  });
  $("#tree").addEventListener("dblclick", e => { const n = e.target.closest(".node"); if (n && n.dataset.id) { const id = n.dataset.id; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTree(); } });
  $("#tree").addEventListener("contextmenu", e => {
    const n = e.target.closest(".node"); if (!n || !n.dataset.id) return;
    e.preventDefault(); closeCtx();
    const { type, id } = n.dataset;
    const m = document.createElement("div"); m.className = "ctx";
    const items = type === "client" ? [["edit", "Edit client…"], ["site", "Add site…"], ["cert", "Certificate…"]] : type === "site" ? [["edit", "Edit site…"], ["loc", "Add location…"], ["cert", "Certificate…"]] : [["rename", "Rename location…"], ["cert", "Certificate…"]];
    m.innerHTML = items.map(i => `<button data-a="${i[0]}">${i[1]}</button>`).join("") + `<hr><button data-a="test">${icon("test")} New test here</button>`;
    document.body.appendChild(m); m.style.left = e.clientX + "px"; m.style.top = e.clientY + "px";
    m.addEventListener("click", async ev => {
      const b = ev.target.closest("button"); if (!b) return; closeCtx();
      setScope({ type, id });
      const a = b.dataset.a;
      if (a === "edit") type === "client" ? editClient(id) : editSite(id);
      if (a === "site") editSite(null, id);
      if (a === "cert") Reports.run("certificate", { scope: { type, id } });
      if (a === "test") openTest({});
      if (a === "loc" || a === "rename") {
        const l = a === "rename" ? idx().loc.get(id) : null;
        const nm = await modal({ title: l ? "Rename location" : "Add location", width: 380, body: `<div class="field"><label>Name</label><input type="text" name="n" value="${esc(l ? l.name : "")}"></div>`, onSubmit: d => fieldVal(d, "n") || false });
        if (!nm) return;
        if (l) l.name = nm; else ensureLocation(id, nm);
        changed(); renderTree(); render();
      }
    });
    setTimeout(() => document.addEventListener("mousedown", ctxOutside, { once: true }));
  });
  $("#quickFind").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.value.trim()) { quickFind(e.target.value.trim()); e.target.value = ""; } });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeCtx();
    if (!window.api && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") { e.preventDefault(); command("new-test"); }
    if (e.key === "F3" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !document.querySelector("dialog[open]"))) { e.preventDefault(); $("#quickFind").focus(); }
  });
  if (window.api) { window.api.onMenu(command); window.api.onBeforeClose(() => flush()); }
  window.addEventListener("beforeunload", () => { if (dirty) flush(); });
}

window.PM = {
  get db() { return db; }, idx, esc, fmtDate, todayISO, addMonths, addDays, daysUntil, show, RES, VISUAL_ITEMS, RESULT_NAMES, REPAIR_ACTIONS, toast, modal,
  assetStatus, testsFor, latestFor, repairsFor, clientName, siteName, locName, engName, instName, inScope, scopeLabel, dueRows, cmpNat, keyOf, get scope() { return scope; }
};
bind();
boot();
