/* PAT Test Log — all data lives in IndexedDB on the device. No server. */
"use strict";
const S = window.PATStd;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const keyOf = no => String(no || "").trim().toUpperCase();
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + Number(n), 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const daysUntil = iso => Math.round((Date.parse(iso) - Date.parse(todayISO())) / 864e5);
const num = v => { const r = S.parseReading(v); return r ? r.value : null; };
const show = v => (v === null || v === undefined || v === "") ? "—" : String(v);
const RES = { pass: "Pass", fail: "Fail", na: "N/A" };

function toast(msg, ms = 2400) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open("pat-log", 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("tests", { keyPath: "id" }).createIndex("assetId", "assetId");
        db.createObjectStore("photos", { keyPath: "id" });
        db.createObjectStore("meta", { keyPath: "k" });
      };
      rq.onsuccess = () => { this.db = rq.result; res(); };
      rq.onerror = () => rej(rq.error);
    });
  },
  _rq(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && "result" in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  get(s, k) { return this._rq(s, "readonly", o => o.get(k)); },
  all(s) { return this._rq(s, "readonly", o => o.getAll()); },
  put(s, v) { return this._rq(s, "readwrite", o => o.put(v)); },
  del(s, k) { return this._rq(s, "readwrite", o => o.delete(k)); },
  clear(s) { return this._rq(s, "readwrite", o => o.clear()); }
};

/* ---------------- State ---------------- */
const DEFAULT_SETTINGS = { company: "", tester: "", instrument: "", standard: "iet", interval: "12", keepSite: true, limits: JSON.parse(JSON.stringify(S.DEFAULT_LIMITS)) };
let settings = DEFAULT_SETTINGS;
const assets = new Map();   // id -> asset
let tests = [];             // all tests
let draft;                  // current test form state (visual answers, photos, tri-states)

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

const limitsFor = std => Object.assign({}, S.DEFAULT_LIMITS[std], (settings.limits || {})[std]);
const testsFor = id => tests.filter(t => t.assetId === id).sort(byDateDesc);
function byDateDesc(a, b) { return (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0); }
const latestFor = id => testsFor(id)[0];

async function loadAll() {
  const [a, t, s] = await Promise.all([DB.all("assets"), DB.all("tests"), DB.get("meta", "settings")]);
  assets.clear(); a.forEach(x => assets.set(x.id, x));
  tests = t;
  if (s) settings = Object.assign({}, DEFAULT_SETTINGS, s.v, { limits: Object.assign({}, JSON.parse(JSON.stringify(S.DEFAULT_LIMITS)), s.v.limits || {}) });
}
const saveSettings = () => DB.put("meta", { k: "settings", v: settings });

/* ---------------- Routing ---------------- */
function route() {
  const h = location.hash.slice(1) || "test";
  const [name, arg] = h.split("/");
  const id = { test: "test", assets: "assets", asset: "asset", records: "records", calc: "calc", settings: "settings" }[name] || "test";
  $$(".view").forEach(v => v.hidden = v.id !== "view-" + id);
  const tab = id === "asset" ? "assets" : id;
  $$(".tabs a").forEach(a => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (id === "assets") renderAssets();
  if (id === "asset") renderAssetDetail(decodeURIComponent(arg || ""));
  if (id === "records") renderRecords();
  if (id === "calc") renderCalc();
  if (id === "settings") renderSettings();
  if (id === "test" && arg) { loadAssetIntoForm(decodeURIComponent(arg)); history.replaceState(null, "", "#test"); }
  window.scrollTo(0, 0);
}

/* ---------------- Test form ---------------- */
const F = name => $("#testForm").elements.namedItem(name); // namedItem: "length"/"type" would hit collection properties
const ASSET_FIELDS = ["description", "site", "location", "make", "model", "serial", "cls", "type", "csa", "length", "fuse", "powerKw"];

function newDraft() {
  draft = { visual: {}, polarity: "", functional: "", photos: [] };
}

function buildChecklist() {
  $("#checklist").innerHTML = VISUAL_ITEMS.map(([k, label]) =>
    `<li data-k="${k}"><span>${esc(label)}</span><div class="seg" data-vis="${k}">${triButtons()}</div></li>`).join("");
  $$("[data-tri]").forEach(el => el.innerHTML = triButtons());
}
const triButtons = () => ["pass", "fail", "na"].map(v => `<button type="button" data-v="${v}" aria-pressed="false">${RES[v]}</button>`).join("");

function setSeg(seg, v) { $$("button", seg).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))); }

function resetForm(keepSite) {
  const f = $("#testForm");
  const site = F("site").value, loc = F("location").value;
  f.reset();
  newDraft();
  $$(".seg", f).forEach(s => setSeg(s, ""));
  $$("[data-limit-manual]").forEach(i => delete i.dataset.limitManual);
  delete F("irV").dataset.manual; delete F("leakMethod").dataset.manual;
  $$(".btn.gt").forEach(b => b.setAttribute("aria-pressed", "false"));
  if (keepSite) { F("site").value = site; F("location").value = loc; }
  F("date").value = todayISO();
  F("tester").value = settings.tester || "";
  F("instrument").value = settings.instrument || "";
  F("standard").value = settings.standard || "iet";
  F("interval").value = String(settings.interval || 12);
  $("#prevPanel").hidden = true;
  renderPhotos();
  updateForm();
}

function formAsset() {
  const a = {};
  ASSET_FIELDS.forEach(k => a[k] = F(k).value.trim());
  a.heating = F("heating").checked;
  a.notes = F("assetNotes").value.trim();
  a.assetNo = F("assetNo").value.trim();
  a.id = keyOf(a.assetNo);
  return a;
}

function loadAssetIntoForm(no) {
  const a = assets.get(keyOf(no));
  F("assetNo").value = a ? a.assetNo : no;
  if (a) {
    ASSET_FIELDS.forEach(k => { if (a[k] !== undefined) F(k).value = a[k]; });
    F("heating").checked = !!a.heating;
    F("assetNotes").value = a.notes || "";
    const last = latestFor(a.id);
    if (last) F("interval").value = String(last.interval || settings.interval);
  }
  $$("[data-limit-manual]").forEach(i => delete i.dataset.limitManual);
  updateForm();
}

function onAssetNoChange() {
  const id = keyOf(F("assetNo").value);
  if (id && assets.has(id)) loadAssetIntoForm(F("assetNo").value);
  else updateForm();
}

/** Recompute auto limits, per-test results, comparisons and the overall verdict. */
function updateForm() {
  const a = formAsset();
  const std = F("standard").value;
  const L = limitsFor(std);
  $("#topStd").textContent = S.STANDARDS[std].short;

  const known = assets.get(a.id);
  const chip = $("#assetState");
  chip.textContent = !a.id ? "New asset" : known ? `Known · ${testsFor(a.id).length} test${testsFor(a.id).length === 1 ? "" : "s"}` : "New asset";
  chip.className = "chip" + (known ? " known" : "");

  // Earth
  const earthOn = S.needsEarth(a);
  $("#t-earth").classList.toggle("off", !earthOn);
  $("#t-earth").querySelectorAll("input").forEach(i => i.disabled = !earthOn);
  const el = S.earthLimit(std, a.csa, a.length, L);
  setAutoLimit(F("earthLimit"), el.limit);
  $("#earthWorking").textContent = !earthOn ? "Class II/III — no earth continuity test." : el.limit === null ? el.reason + " to calculate the limit, or type one." : el.working;
  $("#earthWorking").classList.toggle("warn", earthOn && el.limit === null && !F("earthLimit").value);

  // IR
  const il = S.irLimit(std, a, L);
  setAutoLimit(F("irLimit"), il.limit);
  if (!F("irV").dataset.manual) F("irV").value = String(il.voltage);

  // Leakage
  const ll = S.leakLimit(std, a, L);
  $("#leakTitle").textContent = ll.kind || "Leakage current";
  $("#t-leak").classList.toggle("off", ll.limit === null);
  $("#t-leak").querySelectorAll("input,select").forEach(i => i.disabled = ll.limit === null);
  setAutoLimit(F("leakLimit"), ll.limit);
  if (!F("leakMethod").dataset.manual) F("leakMethod").value = a.cls === "II" ? "Touch current" : "Substitute";

  $("#rcdHint").textContent = `Limits: × 1 ≤ ${L.rcdX1} ms, × 5 ≤ ${L.rcdX5} ms.`;

  const r = evaluate();
  for (const k of ["earth", "ir", "leak"]) {
    const span = $(`[data-res="${k}"]`); const v = r.results[k];
    span.textContent = v ? RES[v] : ""; span.className = "res " + (v || "");
  }
  // Visual state
  const vs = r.results.visual, answered = Object.keys(draft.visual).length;
  $("#visualState").textContent = vs ? (vs === "pass" ? "Pass" : `Fail · ${r.visualFails.length} item${r.visualFails.length > 1 ? "s" : ""}`) : answered ? `${answered}/${VISUAL_ITEMS.length} checked` : "Not started";
  $("#visualState").className = "chip " + (vs || "");
  $$("#checklist li").forEach(li => li.classList.toggle("is-fail", draft.visual[li.dataset.k] === "fail"));

  // Overall
  const v = $("#verdict");
  v.className = "verdict " + (r.overall || "");
  $("#overall").textContent = r.overall ? (r.overall === "pass" ? "PASS" : "FAIL") : "Incomplete";
  $("#overallWhy").textContent = r.overall === "fail" ? r.failWhy.join(", ") : r.missing.length ? "Needs: " + r.missing.join(", ") : `Next test due ${fmtDate(addMonths(F("date").value || todayISO(), F("interval").value))}`;

  renderPrev(a);
}

function setAutoLimit(input, val) {
  if (input.dataset.limitManual) return;
  input.value = val === null || val === undefined ? "" : String(val);
}

function evaluate() {
  const a = formAsset();
  const results = {};
  const vals = Object.values(draft.visual);
  const visualFails = Object.entries(draft.visual).filter(([, v]) => v === "fail").map(([k]) => k);
  results.visual = visualFails.length ? "fail" : vals.length === VISUAL_ITEMS.length ? "pass" : null;
  const earthOn = S.needsEarth(a);
  results.earth = earthOn ? S.judge(F("earth").value, F("earthLimit").value, "max") : null;
  results.ir = S.judge(F("ir").value, F("irLimit").value, "min");
  results.leak = F("leak").disabled ? null : S.judge(F("leak").value, F("leakLimit").value, "max");
  results.polarity = draft.polarity || null;
  results.functional = draft.functional || null;
  const L = limitsFor(F("standard").value);
  results.rcd1 = S.judge(F("rcd1").value, L.rcdX1, "max");
  results.rcd5 = S.judge(F("rcd5").value, L.rcdX5, "max");

  const names = { visual: "visual", earth: "earth", ir: "insulation", leak: "leakage", polarity: "polarity", functional: "functional", rcd1: "RCD ×1", rcd5: "RCD ×5" };
  const failWhy = Object.entries(results).filter(([, v]) => v === "fail").map(([k]) => names[k]);
  const missing = [];
  if (!a.id) missing.push("asset number");
  if (!results.visual) missing.push("visual inspection");
  if (earthOn && !results.earth) missing.push(F("earth").value ? "earth limit" : "earth reading");
  if (!results.ir && !results.leak) missing.push("insulation or leakage reading");
  if (F("ir").value && !results.ir) missing.push("IR limit");
  let overall = null;
  if (failWhy.length && a.id) overall = "fail";
  else if (!missing.length) overall = "pass";
  return { results, overall, failWhy, missing, visualFails };
}

function compare(kind, now, prev) {
  const p = S.parseReading(prev), n = S.parseReading(now);
  if (!p) return "";
  const unit = { earth: "Ω", ir: "MΩ", leak: "mA" }[kind];
  let txt = `Previous: ${p.over ? ">" : ""}${p.value} ${unit}`;
  let worse = false;
  if (n && !n.over && !p.over && p.value > 0) {
    const ch = (n.value - p.value) / p.value * 100;
    txt += ` → ${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%`;
    if (kind === "earth") worse = ch >= 50 && n.value - p.value >= 0.05;
    if (kind === "leak") worse = ch >= 50 && n.value - p.value >= 0.1;
    if (kind === "ir") worse = ch <= -50;
  } else if (n && p.over && !n.over && kind === "ir") { worse = true; txt += ` → now ${n.value} ${unit}`; }
  if (worse) txt += " — significant deterioration, investigate";
  return { txt, worse };
}

function renderPrev(a) {
  const last = a.id ? latestFor(a.id) : null;
  const box = $("#prevPanel");
  for (const k of ["earth", "ir", "leak"]) {
    const el = $(`[data-cmp="${k}"]`);
    const c = last ? compare(k, F(k).value, last[k]) : "";
    el.textContent = c ? c.txt : ""; el.classList.toggle("worse", !!(c && c.worse));
  }
  if (!last) { box.hidden = true; return; }
  box.hidden = false;
  const due = last.nextDue ? daysUntil(last.nextDue) : null;
  box.innerHTML = `<div><b>Last tested ${fmtDate(last.date)}</b> — <span class="chip ${last.overall}">${RES[last.overall]}</span> by ${esc(last.tester || "—")}</div>
    <div class="muted">Earth ${show(last.earth)} Ω · IR ${show(last.ir)} MΩ · Leakage ${show(last.leak)} mA${due !== null ? ` · ${due < 0 ? `overdue by ${-due} days` : `due in ${due} days`}` : ""}</div>
    <div><a href="#asset/${encodeURIComponent(last.assetId)}">View full history</a></div>`;
}

/* ---------------- Photos ---------------- */
async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.78));
    return { id: uid(), blob, w, h, created: Date.now() };
  } finally { URL.revokeObjectURL(url); }
}
const photoUrls = new Map();
function photoURL(p) { if (!photoUrls.has(p.id)) photoUrls.set(p.id, URL.createObjectURL(p.blob)); return photoUrls.get(p.id); }

function renderPhotos() {
  $("#photoStrip").innerHTML = draft.photos.map(p => `<button type="button" data-photo="${p.id}"><img src="${photoURL(p)}" alt="Photo"></button>`).join("");
  $("#photoCount").textContent = draft.photos.length ? `${draft.photos.length} photo${draft.photos.length > 1 ? "s" : ""}` : "";
}

function openPhoto(p, onDelete) {
  const d = $("#photoDlg");
  $("#photoBig").src = photoURL(p);
  $("#photoDel").hidden = !onDelete;
  $("#photoDel").onclick = () => { onDelete(); d.close(); };
  d.showModal();
}

/* ---------------- Barcode scanner ---------------- */
const Scanner = {
  stream: null, running: false, detector: null, zx: null,
  async open(onCode) {
    const dlg = $("#scanDlg"), video = $("#scanVideo");
    $("#scanMsg").textContent = "Starting camera…";
    dlg.showModal();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      $("#scanMsg").textContent = location.protocol !== "https:" && location.hostname !== "localhost" ? "Camera needs the app to be opened over https." : "Camera unavailable: " + (e.message || e.name);
      return;
    }
    video.srcObject = this.stream; await video.play().catch(() => {});
    const track = this.stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const torch = $("#scanTorch"); torch.hidden = !caps.torch; let on = false;
    torch.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
    $("#scanMsg").textContent = "Point the camera at the barcode or QR code";

    this.detector = null;
    if ("BarcodeDetector" in window) {
      try {
        const fm = await BarcodeDetector.getSupportedFormats();
        if (fm.length) this.detector = new BarcodeDetector({ formats: fm });
      } catch (e) { this.detector = null; }
    }
    if (!this.detector && window.ZXing) {
      const hints = new Map();
      const B = ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [B.QR_CODE, B.CODE_128, B.CODE_39, B.CODE_93, B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.ITF, B.CODABAR, B.DATA_MATRIX]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      this.zx = new ZXing.MultiFormatReader(); this.zx.setHints(hints);
    }
    if (!this.detector && !this.zx) { $("#scanMsg").textContent = "Barcode reading isn’t supported on this browser."; return; }

    this.running = true;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = async () => {
      if (!this.running) return;
      if (video.readyState >= 2) {
        let code = null;
        try {
          if (this.detector) {
            const r = await this.detector.detect(video);
            if (r.length) code = r[0].rawValue;
          } else {
            const vw = video.videoWidth, vh = video.videoHeight;
            const cw = Math.round(vw * 0.8), ch = Math.round(vh * 0.6);
            canvas.width = cw; canvas.height = ch;
            ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
            const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
            code = this.zx.decode(bmp).getText();
          }
        } catch (e) { /* not found in this frame */ }
        if (code) { navigator.vibrate && navigator.vibrate(60); this.close(); onCode(code.trim()); return; }
      }
      setTimeout(tick, this.detector ? 120 : 180);
    };
    tick();
  },
  close() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    const d = $("#scanDlg"); if (d.open) d.close();
  }
};

/* ---------------- Save test ---------------- */
async function saveTest(e) {
  e.preventDefault();
  const r = evaluate();
  if (!r.overall) { toast("Incomplete — " + r.missing.join(", ")); return; }
  const a = formAsset();
  const prevAsset = assets.get(a.id);
  const now = Date.now();
  const asset = Object.assign({}, prevAsset || { created: now, photos: [] }, a, { updated: now });
  const t = {
    id: uid(), assetId: a.id, assetNo: a.assetNo, created: now,
    date: F("date").value || todayISO(), standard: F("standard").value,
    tester: F("tester").value.trim(), instrument: F("instrument").value.trim(),
    interval: Number(F("interval").value), nextDue: r.overall === "pass" ? addMonths(F("date").value || todayISO(), F("interval").value) : "",
    visual: Object.assign({}, draft.visual), visualFails: r.visualFails,
    earth: F("earth").disabled ? "" : F("earth").value.trim(), earthLimit: F("earth").disabled ? "" : F("earthLimit").value.trim(),
    ir: F("ir").value.trim(), irLimit: F("irLimit").value.trim(), irV: F("irV").value,
    leak: F("leak").disabled ? "" : F("leak").value.trim(), leakLimit: F("leak").disabled ? "" : F("leakLimit").value.trim(), leakMethod: F("leakMethod").value,
    polarity: draft.polarity, functional: draft.functional,
    rcd1: F("rcd1").value.trim(), rcd5: F("rcd5").value.trim(),
    results: r.results, overall: r.overall, notes: F("notes").value.trim(),
    photos: draft.photos.map(p => p.id),
    snap: { description: a.description, site: a.site, location: a.location, cls: a.cls, type: a.type, csa: a.csa, length: a.length, fuse: a.fuse, make: a.make, model: a.model, serial: a.serial }
  };
  for (const p of draft.photos) await DB.put("photos", p);
  await DB.put("assets", asset);
  await DB.put("tests", t);
  assets.set(asset.id, asset); tests.push(t);
  if (t.tester && !settings.tester) { settings.tester = t.tester; saveSettings(); }
  refreshDatalists();
  toast(`${a.assetNo} saved — ${r.overall.toUpperCase()}`);
  resetForm(settings.keepSite);
  F("assetNo").focus();
}

/* ---------------- Assets ---------------- */
function assetStatus(a) {
  const last = latestFor(a.id);
  if (!last) return { cls: "", txt: "Not tested" };
  if (last.overall === "fail") return { cls: "fail", txt: "Failed", last };
  const d = last.nextDue ? daysUntil(last.nextDue) : null;
  if (d !== null && d < 0) return { cls: "fail", txt: `Overdue ${-d}d`, last, overdue: true };
  if (d !== null && d <= 30) return { cls: "warn", txt: `Due in ${d}d`, last, due: true };
  return { cls: "pass", txt: "Pass", last };
}

function renderAssets() {
  const q = $("#assetSearch").value.trim().toLowerCase(), site = $("#assetSite").value, due = $("#assetDue").value;
  const list = [...assets.values()].filter(a => {
    if (site && a.site !== site) return false;
    if (q && ![a.assetNo, a.description, a.location, a.make, a.model, a.serial].join(" ").toLowerCase().includes(q)) return false;
    if (due) { const s = assetStatus(a); if (due === "overdue" && !s.overdue) return false; if (due === "due" && !(s.due || s.overdue)) return false; if (due === "fail" && s.txt !== "Failed") return false; }
    return true;
  }).sort((x, y) => x.assetNo.localeCompare(y.assetNo, undefined, { numeric: true }));
  $("#assetCount").textContent = `${list.length} of ${assets.size}`;
  $("#assetList").innerHTML = list.length ? list.map(a => {
    const s = assetStatus(a);
    return `<li><a href="#asset/${encodeURIComponent(a.id)}"><span class="no">${esc(a.assetNo)}</span><span class="chip ${s.cls}">${s.txt}</span>
      <span class="sub">${esc(a.description || "No description")} · ${esc([a.site, a.location].filter(Boolean).join(" / ") || "No location")}${s.last ? ` · tested ${fmtDate(s.last.date)}` : ""}</span></a></li>`;
  }).join("") : `<li class="empty">${assets.size ? "No assets match." : "No assets yet. Save a test to add one."}</li>`;
}

function trendSVG(ts, key, limitKey, unit) {
  const pts = ts.slice().reverse().map(t => ({ d: t.date, r: S.parseReading(t[key]), lim: num(t[limitKey]) })).filter(p => p.r);
  if (pts.length < 2) return "";
  const vals = pts.map(p => p.r.value === Infinity ? null : p.r.value).filter(v => v !== null);
  const lim = pts[pts.length - 1].lim;
  const all = vals.concat(lim !== null ? [lim] : []);
  const max = Math.max(...all) * 1.15 || 1, W = 300, H = 120, pl = 34, pb = 18, pt = 8;
  const x = i => pl + (i / (pts.length - 1)) * (W - pl - 8), y = v => pt + (1 - v / max) * (H - pt - pb);
  const line = pts.map((p, i) => `${x(i)},${y(p.r.value === Infinity ? max : p.r.value)}`).join(" ");
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${unit} trend">
    <line class="ax" x1="${pl}" y1="${H - pb}" x2="${W}" y2="${H - pb}"/>
    <text x="2" y="${pt + 8}">${+max.toPrecision(2)}</text><text x="2" y="${H - pb}">0</text>
    ${lim !== null ? `<line class="lim" x1="${pl}" x2="${W}" y1="${y(lim)}" y2="${y(lim)}"/>` : ""}
    <polyline class="ln" points="${line}"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.r.value === Infinity ? max : p.r.value)}" r="3"><title>${fmtDate(p.d)}: ${p.r.over ? ">" : ""}${p.r.value} ${unit}</title></circle>`).join("")}
    <text x="${pl}" y="${H - 4}">${fmtDate(pts[0].d)}</text><text x="${W - 60}" y="${H - 4}">${fmtDate(pts[pts.length - 1].d)}</text></svg>`;
}

async function renderAssetDetail(id) {
  const a = assets.get(id);
  const box = $("#assetDetail");
  if (!a) { box.innerHTML = `<p class="empty">Asset not found. <a href="#assets">Back to assets</a></p>`; return; }
  const ts = testsFor(id), s = assetStatus(a);
  const trends = [trendSVG(ts, "earth", "earthLimit", "Ω"), trendSVG(ts, "ir", "irLimit", "MΩ"), trendSVG(ts, "leak", "leakLimit", "mA")];
  const kv = [["Description", a.description], ["Site", a.site], ["Location", a.location], ["Class", a.cls && "Class " + a.cls], ["Type", a.type], ["Make", a.make], ["Model", a.model], ["Serial", a.serial],
    ["Cord", [a.csa && a.csa + " mm²", a.length && a.length + " m"].filter(Boolean).join(", ")], ["Fuse", a.fuse && a.fuse + " A"], ["Power", a.powerKw && a.powerKw + " kW"], ["Heating", a.heating ? "Yes" : ""], ["Notes", a.notes],
    ["Next due", s.last && s.last.nextDue ? fmtDate(s.last.nextDue) : ""]];
  box.innerHTML = `
    <div class="view">
    <a href="#assets" class="muted small">← Assets</a>
    <div class="sec-head"><h1 style="font-family:var(--f-mono)">${esc(a.assetNo)}</h1><span class="chip ${s.cls}">${s.txt}</span></div>
    <div class="actions">
      <a class="btn primary" href="#test/${encodeURIComponent(a.id)}">Retest</a>
      <button class="btn" data-act="pdf">PDF report</button>
      <button class="btn" data-act="csv">CSV history</button>
      <button class="btn ghost" data-act="edit">Edit details</button>
    </div>
    <div class="card" id="assetInfo"><dl class="kv">${kv.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>
    ${trends.some(Boolean) ? `<div class="card"><h2>Trends</h2><div class="trend-grid">
      ${trends[0] ? `<figure><figcaption>Earth continuity (Ω)</figcaption>${trends[0]}</figure>` : ""}
      ${trends[1] ? `<figure><figcaption>Insulation resistance (MΩ)</figcaption>${trends[1]}</figure>` : ""}
      ${trends[2] ? `<figure><figcaption>Leakage (mA)</figcaption>${trends[2]}</figure>` : ""}
      </div><p class="hint">Dashed line: limit at the latest test.</p></div>` : ""}
    <div class="card"><h2>Test history (${ts.length})</h2>
      <div class="table-wrap"><table class="rec" style="min-width:560px"><thead><tr><th>Date</th><th>Visual</th><th class="n">Earth Ω</th><th class="n">IR MΩ</th><th class="n">Leak mA</th><th>Result</th><th>Tester</th></tr></thead>
      <tbody>${ts.map((t, i) => {
        const p = ts[i + 1];
        const cell = (k) => { const c = p ? compare(k, t[k], p[k]) : null; return `<td class="n"${c && c.worse ? ' style="color:var(--warn);font-weight:700" title="Significant change vs previous"' : ""}>${esc(show(t[k]))}</td>`; };
        return `<tr data-test="${t.id}"><td>${fmtDate(t.date)}</td><td>${RES[t.results.visual] || "—"}</td>${cell("earth")}${cell("ir")}${cell("leak")}<td><span class="chip ${t.overall}">${RES[t.overall]}</span></td><td>${esc(t.tester)}</td></tr>`;
      }).join("") || `<tr><td colspan="7" class="muted">No tests</td></tr>`}</tbody></table></div>
      <div id="testDetail"></div>
    </div>
    <div class="card"><h2>Photos</h2><div class="photos" id="assetPhotos"></div><p class="hint" id="noPhotos">No photos.</p></div>
    <div class="actions"><button class="btn danger" data-act="delete">Delete asset and its history</button></div>
    </div>`;

  // Photos from all tests
  const ids = ts.flatMap(t => t.photos || []);
  const photos = (await Promise.all(ids.map(i => DB.get("photos", i)))).filter(Boolean);
  $("#assetPhotos").innerHTML = photos.map(p => `<button type="button" data-photo="${p.id}"><img src="${photoURL(p)}" alt="Asset photo"></button>`).join("");
  $("#noPhotos").hidden = photos.length > 0;
  $("#assetPhotos").onclick = e => { const b = e.target.closest("[data-photo]"); if (b) openPhoto(photos.find(p => p.id === b.dataset.photo)); };

  box.querySelector("tbody").onclick = e => { const tr = e.target.closest("[data-test]"); if (tr) showTestDetail(a, ts.find(t => t.id === tr.dataset.test)); };
  box.querySelector(".actions").onclick = async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "pdf") pdfAssets([a]);
    if (act === "csv") downloadCSV(ts, `PAT_${a.assetNo}_history.csv`);
    if (act === "edit") editAsset(a);
  };
  box.querySelector("[data-act=delete]").onclick = async () => {
    if (!confirm(`Delete ${a.assetNo} and all ${ts.length} test records? This cannot be undone.`)) return;
    for (const t of ts) { for (const p of t.photos || []) await DB.del("photos", p); await DB.del("tests", t.id); }
    await DB.del("assets", a.id);
    assets.delete(a.id); tests = tests.filter(t => t.assetId !== a.id);
    toast("Asset deleted"); location.hash = "#assets";
  };
}

function showTestDetail(a, t) {
  const box = $("#testDetail");
  const L = (k, lim, unit, res) => `<tr><td>${k}</td><td class="n">${esc(show(t[lim[0]]))} ${unit}</td><td class="n">${t[lim[1]] ? (lim[2] || "≤") + " " + esc(t[lim[1]]) + " " + unit : "—"}</td><td>${res ? `<span class="chip ${res}">${RES[res]}</span>` : "—"}</td></tr>`;
  box.innerHTML = `<div class="card" style="background:var(--sunk);margin-top:10px">
    <div class="sec-head"><h3>Test on ${fmtDate(t.date)} · ${esc(S.STANDARDS[t.standard]?.short || "")}</h3><span class="chip ${t.overall}">${RES[t.overall]}</span></div>
    <table class="mini"><tbody>
      ${L("Earth continuity", ["earth", "earthLimit"], "Ω", t.results.earth)}
      ${L("Insulation (" + t.irV + " V)", ["ir", "irLimit", "≥"], "MΩ", t.results.ir)}
      ${L("Leakage (" + esc(t.leakMethod) + ")", ["leak", "leakLimit"], "mA", t.results.leak)}
      <tr><td>Polarity</td><td colspan="2"></td><td>${RES[t.polarity] || "—"}</td></tr>
      <tr><td>Functional</td><td colspan="2"></td><td>${RES[t.functional] || "—"}</td></tr>
      ${t.rcd1 || t.rcd5 ? `<tr><td>RCD ×1 / ×5</td><td class="n" colspan="2">${esc(show(t.rcd1))} / ${esc(show(t.rcd5))} ms</td><td>${[t.results.rcd1, t.results.rcd5].filter(Boolean).map(r => RES[r]).join(" / ")}</td></tr>` : ""}
    </tbody></table>
    ${t.visualFails && t.visualFails.length ? `<p><b>Visual failures:</b> ${t.visualFails.map(k => esc(visualLabel(k))).join("; ")}</p>` : `<p class="muted small">Visual inspection: ${RES[t.results.visual] || "—"}</p>`}
    ${t.notes ? `<p><b>Comments:</b> ${esc(t.notes)}</p>` : ""}
    <p class="muted small">Tester: ${esc(t.tester || "—")} · Instrument: ${esc(t.instrument || "—")} · Next due: ${t.nextDue ? fmtDate(t.nextDue) : "—"}</p>
    <div class="actions"><button class="btn small" id="tdPdf">PDF of this test</button><button class="btn small danger" id="tdDel">Delete this test</button></div></div>`;
  $("#tdPdf").onclick = () => pdfAssets([a], { testId: t.id });
  $("#tdDel").onclick = async () => {
    if (!confirm(`Delete the test from ${fmtDate(t.date)}?`)) return;
    for (const p of t.photos || []) await DB.del("photos", p);
    await DB.del("tests", t.id); tests = tests.filter(x => x.id !== t.id);
    toast("Test deleted"); renderAssetDetail(a.id);
  };
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function editAsset(a) {
  const box = $("#assetInfo");
  const fields = [["description", "Description"], ["site", "Site", "dl-site"], ["location", "Location", "dl-location"], ["make", "Make"], ["model", "Model"], ["serial", "Serial"], ["length", "Cord length (m)"], ["powerKw", "Power (kW)"], ["notes", "Notes"]];
  const sel = (k, label, opts) => `<div class="field"><label>${label}</label><select name="${k}">${opts.map(o => `<option value="${o[0]}"${String(a[k] || "") === o[0] ? " selected" : ""}>${o[1]}</option>`).join("")}</select></div>`;
  box.innerHTML = `<form id="editForm"><div class="row">${fields.map(([k, l, dl]) => `<div class="field"><label>${l}</label><input name="${k}" value="${esc(a[k] || "")}"${dl ? ` list="${dl}"` : ""}></div>`).join("")}
    ${sel("cls", "Class", [["I", "Class I"], ["II", "Class II"], ["III", "Class III"]])}
    ${sel("type", "Type", $$("#f-type option").map(o => [o.value, o.value]))}
    ${sel("csa", "Cord size (mm²)", $$("#f-csa option").map(o => [o.value, o.textContent]))}
    ${sel("fuse", "Fuse (A)", $$("#f-fuse option").map(o => [o.value, o.textContent]))}
    </div><label class="check"><input type="checkbox" name="heating"${a.heating ? " checked" : ""}> Contains heating element</label>
    <div class="actions"><button class="btn primary">Save details</button><button type="button" class="btn ghost" id="editCancel">Cancel</button></div></form>`;
  $("#editCancel").onclick = () => renderAssetDetail(a.id);
  $("#editForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target.elements;
    ["description", "site", "location", "make", "model", "serial", "length", "powerKw", "notes", "cls", "type", "csa", "fuse"].forEach(k => a[k] = f[k].value.trim());
    a.heating = f.heating.checked; a.updated = Date.now();
    await DB.put("assets", a); refreshDatalists(); toast("Details saved"); renderAssetDetail(a.id);
  };
}

/* ---------------- Records ---------------- */
function recordFilters() {
  return { from: $("#r-from").value, to: $("#r-to").value, site: $("#r-site").value, location: $("#r-location").value, result: $("#r-result").value, tester: $("#r-tester").value, q: $("#r-q").value.trim().toLowerCase(), latest: $("#r-latest").checked };
}
function filteredTests() {
  const f = recordFilters();
  let list = f.latest ? [...assets.keys()].map(latestFor).filter(Boolean) : tests.slice();
  list = list.filter(t => {
    const sn = t.snap || {};
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.site && sn.site !== f.site) return false;
    if (f.location && sn.location !== f.location) return false;
    if (f.result && t.overall !== f.result) return false;
    if (f.tester && t.tester !== f.tester) return false;
    if (f.q && ![t.assetNo, sn.description, sn.site, sn.location, "class " + sn.cls, sn.type, sn.make, sn.model, sn.serial, t.notes].join(" ").toLowerCase().includes(f.q)) return false;
    return true;
  });
  return list.sort(byDateDesc);
}
function fillSelect(sel, values, keep) {
  const cur = sel.value, first = sel.options[0].outerHTML;
  sel.innerHTML = first + [...new Set(values.filter(Boolean))].sort().map(v => `<option>${esc(v)}</option>`).join("");
  if (keep) sel.value = cur;
}
function renderRecords() {
  fillSelect($("#r-site"), tests.map(t => t.snap?.site), true);
  fillSelect($("#r-location"), tests.filter(t => !$("#r-site").value || t.snap?.site === $("#r-site").value).map(t => t.snap?.location), true);
  fillSelect($("#r-tester"), tests.map(t => t.tester), true);
  const list = filteredTests();
  const passN = list.filter(t => t.overall === "pass").length;
  $("#recCount").textContent = `${list.length} record${list.length === 1 ? "" : "s"} · ${passN} pass · ${list.length - passN} fail`;
  $("#recTable tbody").innerHTML = list.length ? list.map(t => `<tr data-asset="${esc(t.assetId)}"><td>${fmtDate(t.date)}</td><td style="font-family:var(--f-mono)">${esc(t.assetNo)}</td><td>${esc(t.snap?.description)}</td>
    <td>${esc([t.snap?.site, t.snap?.location].filter(Boolean).join(" / "))}</td><td>${esc(t.snap?.cls)}</td><td class="n">${esc(show(t.earth))}</td><td class="n">${esc(show(t.ir))}</td><td class="n">${esc(show(t.leak))}</td>
    <td><span class="chip ${t.overall}">${RES[t.overall]}</span></td></tr>`).join("") : `<tr><td colspan="9" class="muted">No records match these filters.</td></tr>`;
}

/* ---------------- CSV ---------------- */
const CSV_COLS = [
  ["Test date", t => fmtDate(t.date)], ["Asset no", t => t.assetNo], ["Description", t => t.snap?.description], ["Site", t => t.snap?.site], ["Location", t => t.snap?.location],
  ["Make", t => t.snap?.make], ["Model", t => t.snap?.model], ["Serial", t => t.snap?.serial], ["Class", t => t.snap?.cls], ["Type", t => t.snap?.type],
  ["Cord mm²", t => t.snap?.csa], ["Cord length m", t => t.snap?.length], ["Fuse A", t => t.snap?.fuse], ["Standard", t => S.STANDARDS[t.standard]?.short],
  ["Visual", t => RES[t.results.visual]], ["Visual failures", t => (t.visualFails || []).map(visualLabel).join("; ")],
  ["Earth Ω", t => t.earth], ["Earth limit Ω", t => t.earthLimit], ["Earth result", t => RES[t.results.earth]],
  ["IR MΩ", t => t.ir], ["IR limit MΩ", t => t.irLimit], ["IR test V", t => t.irV], ["IR result", t => RES[t.results.ir]],
  ["Leakage mA", t => t.leak], ["Leakage limit mA", t => t.leakLimit], ["Leakage method", t => t.leak ? t.leakMethod : ""], ["Leakage result", t => RES[t.results.leak]],
  ["Polarity", t => RES[t.polarity]], ["Functional", t => RES[t.functional]], ["RCD x1 ms", t => t.rcd1], ["RCD x5 ms", t => t.rcd5],
  ["Overall", t => RES[t.overall]], ["Retest months", t => t.interval], ["Next due", t => fmtDate(t.nextDue)], ["Tester", t => t.tester], ["Instrument", t => t.instrument], ["Comments", t => t.notes]
];
function toCSV(list) {
  const cell = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) && isNaN(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [CSV_COLS.map(c => cell(c[0])).join(","), ...list.map(t => CSV_COLS.map(c => cell(c[1](t))).join(","))].join("\r\n");
}
function downloadCSV(list, name) {
  if (!list.length) { toast("Nothing to export"); return; }
  saveFile(new Blob([toCSV(list)], { type: "text/csv;charset=utf-8" }), name);
}
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const touch = matchMedia("(pointer:coarse)").matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------------- PDF ---------------- */
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const PASS_RGB = [22, 121, 74], FAIL_RGB = [180, 35, 24], INK = [22, 27, 24], MUTED = [91, 101, 95];

function pdfHeader(doc, title, sub) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(26, 32, 28); doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(title, 12, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(sub, 12, 16.5);
  if (settings.company) { doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(settings.company, W - 12, 13, { align: "right" }); }
  doc.setTextColor(...INK);
}
function pdfFooters(doc, note) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(note, 12, H - 7); doc.text(`Page ${i} of ${n}`, W - 12, H - 7, { align: "right" });
  }
}
// The PDF core fonts only cover WinAnsi, so swap symbols they can't draw.
const pdfSafe = s => typeof s === "string" ? s.replace(/MΩ/g, "MOhm").replace(/Ω/g, "Ohm").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/Δ/g, "d").replace(/’/g, "'") : s;
function newPdf(o) {
  const doc = new window.jspdf.jsPDF(o);
  const text = doc.text.bind(doc);
  doc.text = (t, ...r) => text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(t), ...r);
  const at = doc.autoTable.bind(doc);
  doc.autoTable = opt => {
    const user = opt.didParseCell;
    return at(Object.assign({}, opt, { didParseCell: d => { d.cell.text = d.cell.text.map(pdfSafe); if (user) user(d); } }));
  };
  return doc;
}
const resultCellStyle = data => {
  const v = String(data.cell.raw || "").toLowerCase();
  if (data.section === "body" && (v === "pass" || v === "fail")) { data.cell.styles.textColor = v === "pass" ? PASS_RGB : FAIL_RGB; data.cell.styles.fontStyle = "bold"; }
};

/** One section per asset. opts.testId picks a specific test; otherwise the latest. */
async function pdfAssets(list, opts = {}) {
  if (!window.jspdf) { toast("PDF library still loading — try again"); return; }
  if (!list.length) { toast("Nothing to report"); return; }
  toast("Building PDF…");
  const doc = newPdf({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let first = true;
  for (const a of list) {
    const ts = testsFor(a.id);
    const wanted = opts.testId || (opts.pick && opts.pick.get(a.id));
    const t = wanted ? ts.find(x => x.id === wanted) : ts[0];
    if (!t) continue;
    if (!first) doc.addPage(); first = false;
    pdfHeader(doc, "PAT inspection & test record", `${S.STANDARDS[t.standard]?.name || ""} · generated ${fmtDate(todayISO())}`);
    const sn = Object.assign({}, a, t.snap);
    // Asset number + verdict
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(a.assetNo, 12, 34);
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.text(sn.description || "", 12, 40);
    doc.setFillColor(...(t.overall === "pass" ? PASS_RGB : FAIL_RGB)); doc.roundedRect(W - 52, 27, 40, 14, 2, 2, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(t.overall.toUpperCase(), W - 32, 36.5, { align: "center" });
    doc.setTextColor(...INK);

    const kv = [["Site", sn.site], ["Location", sn.location], ["Class", sn.cls && "Class " + sn.cls], ["Type", sn.type], ["Make / model", [sn.make, sn.model].filter(Boolean).join(" ")], ["Serial", sn.serial],
      ["Cord", [sn.csa && sn.csa + " mm²", sn.length && sn.length + " m"].filter(Boolean).join(", ")], ["Fuse", sn.fuse && sn.fuse + " A"],
      ["Test date", fmtDate(t.date)], ["Next due", t.nextDue ? fmtDate(t.nextDue) : "—"], ["Tested by", t.tester], ["Instrument", t.instrument]];
    const rows = []; for (let i = 0; i < kv.length; i += 2) rows.push([kv[i][0], kv[i][1] || "—", kv[i + 1]?.[0] || "", kv[i + 1]?.[1] || "—"]);
    doc.autoTable({ startY: 46, body: rows, theme: "plain", styles: { fontSize: 9, cellPadding: 1.4 }, columnStyles: { 0: { textColor: MUTED, cellWidth: 26 }, 2: { textColor: MUTED, cellWidth: 26 } }, margin: { left: 12, right: 12 } });

    const prev = ts[ts.indexOf(t) + 1];
    const res = r => r ? RES[r] : "—";
    const testRows = [["Visual inspection", res(t.results.visual), "—", res(t.results.visual), "—"]];
    if (t.earth || t.results.earth) testRows.push(["Earth continuity", `${t.earth} Ω`, t.earthLimit ? `≤ ${t.earthLimit} Ω` : "—", res(t.results.earth), prev?.earth ? prev.earth + " Ω" : "—"]);
    if (t.ir) testRows.push([`Insulation resistance (${t.irV} V)`, `${t.ir} MΩ`, t.irLimit ? `≥ ${t.irLimit} MΩ` : "—", res(t.results.ir), prev?.ir ? prev.ir + " MΩ" : "—"]);
    if (t.leak) testRows.push([`${t.leakMethod} leakage`, `${t.leak} mA`, t.leakLimit ? `≤ ${t.leakLimit} mA` : "—", res(t.results.leak), prev?.leak ? prev.leak + " mA" : "—"]);
    if (t.polarity) testRows.push(["Polarity", "", "", res(t.polarity), prev ? res(prev.polarity) : "—"]);
    if (t.functional) testRows.push(["Functional check", "", "", res(t.functional), prev ? res(prev.functional) : "—"]);
    if (t.rcd1) testRows.push(["RCD trip × 1 IΔn", `${t.rcd1} ms`, `≤ ${limitsFor(t.standard).rcdX1} ms`, res(t.results.rcd1), prev?.rcd1 ? prev.rcd1 + " ms" : "—"]);
    if (t.rcd5) testRows.push(["RCD trip × 5 IΔn", `${t.rcd5} ms`, `≤ ${limitsFor(t.standard).rcdX5} ms`, res(t.results.rcd5), prev?.rcd5 ? prev.rcd5 + " ms" : "—"]);
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [["Test", "Reading", "Limit", "Result", prev ? `Previous (${fmtDate(prev.date)})` : "Previous"]], body: testRows,
      styles: { fontSize: 9 }, headStyles: { fillColor: [233, 235, 230], textColor: INK }, didParseCell: resultCellStyle, margin: { left: 12, right: 12 } });

    const vis = VISUAL_ITEMS.map(([k, l]) => [l, res(t.visual?.[k])]);
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [["Visual inspection item", "Result"]], body: vis, styles: { fontSize: 8.5, cellPadding: 1.3 },
      headStyles: { fillColor: [233, 235, 230], textColor: INK }, columnStyles: { 1: { cellWidth: 22 } }, didParseCell: resultCellStyle, margin: { left: 12, right: 12 } });
    let y = doc.lastAutoTable.finalY + 6;
    if (t.notes) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text("Comments / remedial action", 12, y);
      doc.setFont("helvetica", "normal"); const lines = doc.splitTextToSize(t.notes, W - 24); doc.text(lines, 12, y + 5); y += 7 + lines.length * 4.2;
    }
    // Photos
    const photos = (await Promise.all((t.photos || []).slice(0, 6).map(i => DB.get("photos", i)))).filter(Boolean);
    if (photos.length) {
      const cols = 3, gap = 4, pw = (W - 24 - gap * (cols - 1)) / cols, ph = pw * 0.75;
      if (y + ph + 10 > H - 14) { doc.addPage(); y = 16; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text("Photos", 12, y); y += 3;
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i], c = i % cols;
        if (i && c === 0) { y += ph + gap; if (y + ph > H - 14) { doc.addPage(); y = 16; } }
        const sc = Math.min(pw / p.w, ph / p.h), w = p.w * sc, h = p.h * sc;
        doc.addImage(await blobToDataURL(p.blob), "JPEG", 12 + c * (pw + gap) + (pw - w) / 2, y + (ph - h) / 2, w, h, undefined, "FAST");
      }
      y += ph + 6;
    }
    // History
    if (ts.length > 1) {
      if (y > H - 40) { doc.addPage(); y = 16; }
      doc.autoTable({ startY: y, head: [["History: date", "Visual", "Earth Ω", "IR MΩ", "Leak mA", "Result", "Tester"]],
        body: ts.map(x => [fmtDate(x.date), res(x.results.visual), show(x.earth), show(x.ir), show(x.leak), res(x.overall), x.tester || ""]),
        styles: { fontSize: 8.5, cellPadding: 1.3 }, headStyles: { fillColor: [233, 235, 230], textColor: INK }, didParseCell: resultCellStyle, margin: { left: 12, right: 12 } });
      y = doc.lastAutoTable.finalY + 6;
    }
    if (y > H - 28) { doc.addPage(); y = 20; }
    doc.setDrawColor(...MUTED); doc.line(12, y + 12, 90, y + 12); doc.line(110, y + 12, W - 12, y + 12);
    doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text("Signature", 12, y + 16); doc.text("Name / date", 110, y + 16); doc.setTextColor(...INK);
  }
  pdfFooters(doc, "In-service inspection and testing of electrical equipment");
  const name = list.length === 1 ? `PAT_${list[0].assetNo}.pdf` : `PAT_reports_${todayISO()}.pdf`;
  saveFile(doc.output("blob"), name);
}

function pdfTable(list) {
  if (!window.jspdf) { toast("PDF library still loading — try again"); return; }
  if (!list.length) { toast("Nothing to report"); return; }
  const doc = newPdf({ unit: "mm", format: "a4", orientation: "landscape" });
  const f = recordFilters();
  const dates = list.map(t => t.date).sort();
  pdfHeader(doc, "PAT test schedule", `${list.length} records · ${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])} · generated ${fmtDate(todayISO())}`);
  const pass = list.filter(t => t.overall === "pass").length;
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text(`Passed: ${pass}`, 12, 30); doc.setTextColor(...FAIL_RGB); doc.text(`Failed: ${list.length - pass}`, 42, 30); doc.setTextColor(...INK);
  const fl = [f.site && "Site: " + f.site, f.location && "Location: " + f.location, f.result && "Result: " + RES[f.result], f.tester && "Tester: " + f.tester, f.from && "From " + fmtDate(f.from), f.to && "To " + fmtDate(f.to), f.q && `Search: "${f.q}"`, f.latest && "Latest test per asset"].filter(Boolean);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(fl.length ? "Filters: " + fl.join(" · ") : "All records", 80, 30); doc.setTextColor(...INK);
  doc.autoTable({
    startY: 34,
    head: [["Asset", "Description", "Site", "Location", "Class", "Date", "Visual", "Earth Ω", "IR MΩ", "Leak mA", "Pol.", "Func.", "Result", "Next due", "Tester", "Comments"]],
    body: list.map(t => [t.assetNo, t.snap?.description || "", t.snap?.site || "", t.snap?.location || "", t.snap?.cls || "", fmtDate(t.date), RES[t.results.visual] || "—", show(t.earth), show(t.ir), show(t.leak),
      RES[t.polarity] || "—", RES[t.functional] || "—", RES[t.overall], t.nextDue ? fmtDate(t.nextDue) : "—", t.tester || "", t.notes || ""]),
    styles: { fontSize: 7.6, cellPadding: 1.4, overflow: "linebreak" }, headStyles: { fillColor: [26, 32, 28] },
    columnStyles: { 0: { fontStyle: "bold" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" }, 15: { cellWidth: 40 } },
    didParseCell: resultCellStyle, margin: { left: 8, right: 8, top: 14 }
  });
  pdfFooters(doc, "Limits per " + [...new Set(list.map(t => S.STANDARDS[t.standard]?.name))].join(", "));
  saveFile(doc.output("blob"), `PAT_schedule_${todayISO()}.pdf`);
}

/* ---------------- Calculator ---------------- */
function renderCalc() {
  const csa = $("#c-csa").value, len = $("#c-len").value, extra = Number($("#c-extra").value) || 0;
  const out = (el, std) => {
    const r = S.earthLimit(std, csa, len, limitsFor(std));
    el.innerHTML = `<span class="label">${S.STANDARDS[std].name}</span>` + (r.limit === null ? `<span>${r.reason}</span>` :
      `<b>${S.round(r.limit + extra, 3)} Ω</b><span>${esc(r.working)}${extra ? ` + ${extra} Ω extra` : ""}</span>`);
  };
  out($("#c-iet"), "iet"); out($("#c-en"), "en50699");
  $("#c-table").innerHTML = `<thead><tr><th>mm²</th><th class="n">Ω/m</th><th class="n">mΩ per m</th><th class="n">2 m</th><th class="n">5 m</th><th class="n">10 m</th></tr></thead><tbody>` +
    Object.entries(S.CSA_OHM_PER_M).map(([k, r]) => `<tr><td>${k}</td><td class="n">${r}</td><td class="n">${S.round(r * 1000, 1)}</td><td class="n">${S.round(r * 2, 3)}</td><td class="n">${S.round(r * 5, 3)}</td><td class="n">${S.round(r * 10, 3)}</td></tr>`).join("") + "</tbody>";
  const qa = { cls: $("#q-cls").value, powerKw: $("#q-kw").value, heating: $("#q-heat").checked };
  const row = std => { const L = limitsFor(std), ir = S.irLimit(std, qa, L), lk = S.leakLimit(std, qa, L), e = qa.cls === "I" ? S.earthLimit(std, csa, len, L) : null; return { ir, lk, e }; };
  const a = row("iet"), b = row("en50699");
  $("#q-table").innerHTML = `<thead><tr><th>Test</th><th class="n">IET CoP</th><th class="n">BS EN 50699</th></tr></thead><tbody>
    <tr><td>Earth continuity (cord above)</td><td class="n">${a.e ? (a.e.limit !== null ? "≤ " + a.e.limit + " Ω" : "—") : "N/A"}</td><td class="n">${b.e ? (b.e.limit !== null ? "≤ " + b.e.limit + " Ω" : "—") : "N/A"}</td></tr>
    <tr><td>Insulation resistance</td><td class="n">≥ ${a.ir.limit} MΩ @ ${a.ir.voltage} V</td><td class="n">≥ ${b.ir.limit} MΩ @ ${b.ir.voltage} V</td></tr>
    <tr><td>${a.lk.kind || "Leakage"}</td><td class="n">${a.lk.limit !== null ? "≤ " + a.lk.limit + " mA" : "N/A"}</td><td class="n">${b.lk.limit !== null ? "≤ " + b.lk.limit + " mA" : "N/A"}</td></tr>
    <tr><td>RCD trip ×1 / ×5</td><td class="n">≤ ${limitsFor("iet").rcdX1} / ${limitsFor("iet").rcdX5} ms</td><td class="n">≤ ${limitsFor("en50699").rcdX1} / ${limitsFor("en50699").rcdX5} ms</td></tr></tbody>`;
}

/* ---------------- Settings ---------------- */
const LIMIT_LABELS = {
  earthBase: "Earth: base (Ω)", earthBaseLen: "Earth: base covers cord up to (m)", earthStep: "Earth: step (Ω)", earthStepLen: "Earth: per extra (m)", earthMax: "Earth: maximum (Ω)",
  irClassI: "IR Class I (MΩ)", irClassIHeat: "IR Class I heating (MΩ)", irHeatKw: "IR heating applies from (kW)", irClassII: "IR Class II (MΩ)", irClassIII: "IR Class III (MΩ)",
  leakClassI: "Protective conductor current (mA)", leakClassII: "Touch current Class II (mA)", leakHeatKw: "Heating leakage applies above (kW)", leakHeatPerKw: "Heating leakage per kW (mA)", leakHeatMax: "Heating leakage max (mA)",
  rcdX1: "RCD ×1 max (ms)", rcdX5: "RCD ×5 max (ms)"
};
function renderSettings() {
  $("#s-company").value = settings.company || ""; $("#s-tester").value = settings.tester || ""; $("#s-instrument").value = settings.instrument || "";
  $("#s-standard").value = settings.standard; $("#s-interval").value = String(settings.interval); $("#s-keepSite").checked = !!settings.keepSite;
  renderLimitFields();
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
    $("#storageInfo").textContent = `${assets.size} assets, ${tests.length} tests, about ${(e.usage / 1048576).toFixed(1)} MB used on this device. Records are stored on this device only — back up regularly.`;
  });
}
function renderLimitFields() {
  const std = $("#s-limStd").value, L = limitsFor(std), D = S.DEFAULT_LIMITS[std];
  $("#limitFields").innerHTML = Object.keys(D).map(k => `<div class="field"><label for="lim-${k}">${LIMIT_LABELS[k] || k}</label><input id="lim-${k}" data-lim="${k}" inputmode="decimal" value="${L[k]}"${L[k] !== D[k] ? ' style="border-color:var(--warn)"' : ""}></div>`).join("");
}

function refreshDatalists() {
  const all = [...assets.values()];
  $("#dl-site").innerHTML = [...new Set(all.map(a => a.site).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("");
  $("#dl-location").innerHTML = [...new Set(all.map(a => a.location).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("");
  fillSelect($("#assetSite"), all.map(a => a.site), true);
}

/* ---------------- Backup ---------------- */
async function backup() {
  const photos = await DB.all("photos");
  const out = { app: "pat-log", version: 1, exported: new Date().toISOString(), settings, assets: [...assets.values()], tests,
    photos: await Promise.all(photos.map(async p => ({ id: p.id, w: p.w, h: p.h, created: p.created, data: await blobToDataURL(p.blob) }))) };
  saveFile(new Blob([JSON.stringify(out)], { type: "application/json" }), `PAT_backup_${todayISO()}.json`);
}
async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn’t a valid backup"); return; }
  if (data.app !== "pat-log") { toast("That file isn’t a PAT Log backup"); return; }
  if (!confirm(`Merge ${data.assets.length} assets and ${data.tests.length} tests into this device? Records with the same ID are replaced.`)) return;
  for (const a of data.assets) await DB.put("assets", a);
  for (const t of data.tests) await DB.put("tests", t);
  for (const p of data.photos || []) { const blob = await (await fetch(p.data)).blob(); await DB.put("photos", { id: p.id, w: p.w, h: p.h, created: p.created, blob }); }
  await loadAll(); refreshDatalists(); toast("Backup restored"); route();
}

/* ---------------- Wire up ---------------- */
function bind() {
  const form = $("#testForm");
  form.addEventListener("input", e => {
    if (e.target.name && /Limit$/.test(e.target.name)) { if (e.target.value.trim()) e.target.dataset.limitManual = "1"; else delete e.target.dataset.limitManual; }
    if (e.target.name === "assetNo") return;
    updateForm();
  });
  form.addEventListener("change", e => {
    if (e.target.name === "assetNo") onAssetNoChange();
    if (e.target.name === "irV" || e.target.name === "leakMethod") e.target.dataset.manual = "1";
    if (["cls", "csa", "length", "standard", "heating", "powerKw"].includes(e.target.name)) {
      // asset details changed: recalculate limits unless the user typed their own
      updateForm();
    }
  });
  F("assetNo").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); onAssetNoChange(); F("description").focus(); } });
  form.addEventListener("click", e => {
    const b = e.target.closest(".seg button"); if (!b) return;
    const seg = b.parentElement, v = b.getAttribute("aria-pressed") === "true" ? "" : b.dataset.v;
    setSeg(seg, v);
    if (seg.dataset.vis) { if (v) draft.visual[seg.dataset.vis] = v; else delete draft.visual[seg.dataset.vis]; }
    if (seg.dataset.tri) draft[seg.dataset.tri] = v;
    updateForm();
  });
  $$(".btn.gt").forEach(b => b.onclick = () => {
    const inp = $("#" + b.dataset.gt), on = !inp.value.startsWith(">");
    inp.value = on ? ">" + inp.value.replace(/^>/, "") : inp.value.replace(/^>/, "");
    b.setAttribute("aria-pressed", String(on)); inp.focus(); updateForm();
  });
  $("#visAllPass").onclick = () => { VISUAL_ITEMS.forEach(([k]) => { draft.visual[k] = "pass"; setSeg($(`[data-vis="${k}"]`), "pass"); }); updateForm(); };
  form.addEventListener("submit", saveTest);
  $("#resetTest").onclick = () => { if (confirm("Clear this test?")) resetForm(false); };
  $("#scanBtn").onclick = () => Scanner.open(code => { F("assetNo").value = code; onAssetNoChange(); toast("Scanned " + code); });
  $("#scanClose").onclick = () => Scanner.close();
  $("#scanDlg").addEventListener("cancel", () => Scanner.close());
  $("#photoInput").onchange = async e => {
    for (const f of e.target.files) { try { draft.photos.push(await resizePhoto(f)); } catch (err) { toast("Couldn’t read that image"); } }
    e.target.value = ""; renderPhotos();
  };
  $("#photoStrip").onclick = e => {
    const b = e.target.closest("[data-photo]"); if (!b) return;
    const p = draft.photos.find(x => x.id === b.dataset.photo);
    openPhoto(p, () => { draft.photos = draft.photos.filter(x => x !== p); renderPhotos(); });
  };
  $("#photoClose").onclick = () => $("#photoDlg").close();

  ["#assetSearch", "#assetSite", "#assetDue"].forEach(s => $(s).addEventListener("input", renderAssets));
  ["#r-from", "#r-to", "#r-site", "#r-location", "#r-result", "#r-tester", "#r-q", "#r-latest"].forEach(s => $(s).addEventListener("input", renderRecords));
  $("#clearFilters").onclick = () => { ["#r-from", "#r-to", "#r-site", "#r-location", "#r-result", "#r-tester", "#r-q"].forEach(s => $(s).value = ""); $("#r-latest").checked = true; renderRecords(); };
  $("#recTable tbody").onclick = e => { const tr = e.target.closest("[data-asset]"); if (tr) location.hash = "#asset/" + encodeURIComponent(tr.dataset.asset); };
  $("#exportCsv").onclick = () => downloadCSV(filteredTests(), `PAT_results_${todayISO()}.csv`);
  $("#exportPdfTable").onclick = () => pdfTable(filteredTests());
  $("#exportPdfEach").onclick = () => {
    const list = filteredTests();
    const seen = new Set(), items = [];
    for (const t of list) if (!seen.has(t.assetId) && assets.get(t.assetId)) { seen.add(t.assetId); items.push(assets.get(t.assetId)); }
    if (items.length > 25 && !confirm(`Create a PDF with ${items.length} asset pages? This may take a moment.`)) return;
    // Each asset's page reports its most recent test that matched the filters.
    const latestMatch = new Map(); list.forEach(t => { if (!latestMatch.has(t.assetId)) latestMatch.set(t.assetId, t.id); });
    pdfAssets(items, { pick: latestMatch });
  };

  ["#c-csa", "#c-len", "#c-extra", "#q-cls", "#q-kw", "#q-heat"].forEach(s => $(s).addEventListener("input", renderCalc));

  const sv = () => { settings.company = $("#s-company").value.trim(); settings.tester = $("#s-tester").value.trim(); settings.instrument = $("#s-instrument").value.trim();
    settings.standard = $("#s-standard").value; settings.interval = $("#s-interval").value; settings.keepSite = $("#s-keepSite").checked; saveSettings(); };
  ["#s-company", "#s-tester", "#s-instrument", "#s-standard", "#s-interval", "#s-keepSite"].forEach(s => $(s).addEventListener("change", () => { sv(); toast("Saved"); }));
  $("#s-limStd").onchange = renderLimitFields;
  $("#limitFields").addEventListener("change", e => {
    const k = e.target.dataset.lim, std = $("#s-limStd").value, v = Number(e.target.value);
    if (!k || !isFinite(v)) { toast("Enter a number"); renderLimitFields(); return; }
    settings.limits[std] = Object.assign({}, S.DEFAULT_LIMITS[std], settings.limits[std], { [k]: v });
    saveSettings(); renderLimitFields(); updateForm(); toast("Limit saved");
  });
  $("#resetLimits").onclick = () => { const std = $("#s-limStd").value; settings.limits[std] = JSON.parse(JSON.stringify(S.DEFAULT_LIMITS[std])); saveSettings(); renderLimitFields(); updateForm(); toast("Defaults restored"); };
  $("#backupBtn").onclick = backup;
  $("#restoreInput").onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
  $("#wipeBtn").onclick = async () => {
    if (!confirm("Delete ALL assets, tests and photos on this device?")) return;
    if (prompt('Type DELETE to confirm') !== "DELETE") return;
    await Promise.all(["assets", "tests", "photos"].map(s => DB.clear(s)));
    await loadAll(); refreshDatalists(); toast("All data deleted"); route();
  };
  window.addEventListener("hashchange", route);
}

(async function init() {
  buildChecklist();
  newDraft();
  try { await DB.open(); await loadAll(); } catch (e) { toast("Storage unavailable — records can’t be saved in this browser mode", 6000); }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  bind();
  refreshDatalists();
  resetForm(false);
  route();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
