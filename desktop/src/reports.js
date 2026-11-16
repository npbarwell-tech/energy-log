/* PAT Manager — printable reports. Each report is a self-contained HTML document shown in a
 * preview window (Print / Save as PDF) by the main process. */
(function () {
  "use strict";
  const P = () => window.PM;

  const CSS = `
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 9.5pt; color: #111; background: #fff; }
    @media screen { body { background: #525659; padding: 56px 0 30px; } .sheet { background: #fff; width: 210mm; margin: 0 auto 16px; padding: 10mm; box-shadow: 0 2px 12px rgba(0,0,0,.4); min-height: 297mm; }
      body.landscape .sheet { width: 297mm; min-height: 210mm; } }
    @media print { .bar { display: none !important; } .sheet { padding: 0; } .sheet + .sheet { break-before: page; } }
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 44px; background: #2b2e31; color: #fff; display: flex; gap: 8px; align-items: center; padding: 0 14px; z-index: 10; font-size: 13px; }
    .bar b { margin-right: auto; font-weight: 600; }
    .bar button { background: #3d4146; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
    .bar button.p { background: #0b6e4f; border-color: #0b6e4f; }
    .bar button:hover { filter: brightness(1.15); }
    h1 { font-size: 17pt; margin: 0; color: #0b6e4f; }
    h2 { font-size: 11.5pt; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #0b6e4f; color: #0b6e4f; }
    h3 { font-size: 10pt; margin: 10px 0 4px; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 8px; border-bottom: 3px solid #0b6e4f; margin-bottom: 10px; }
    .hdr .co { text-align: right; font-size: 8.5pt; color: #333; line-height: 1.35; }
    .hdr .co b { font-size: 10.5pt; color: #111; }
    .hdr img { max-height: 52px; max-width: 200px; display: block; margin-left: auto; margin-bottom: 4px; }
    .sub { color: #555; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    table.t th { background: #e8f3ee; text-align: left; font-weight: 600; padding: 3.5px 5px; border: 1px solid #b9cfc6; font-size: 8.5pt; }
    table.t td { padding: 3px 5px; border: 1px solid #ccd5d1; font-size: 8.5pt; vertical-align: top; }
    table.t tr { break-inside: avoid; }
    table.t thead { display: table-header-group; }
    table.t td.n, table.t th.n { text-align: right; font-variant-numeric: tabular-nums; }
    table.kv td { padding: 3px 6px; border: 1px solid #ccd5d1; }
    table.kv td:nth-child(odd) { background: #f4f7f6; width: 18%; font-weight: 600; color: #333; }
    .pass { color: #15803d; font-weight: 700; } .fail { color: #b91c1c; font-weight: 700; } .warn { color: #b45309; font-weight: 700; }
    .sum { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0; }
    .sum div { border: 1px solid #ccd5d1; border-radius: 4px; padding: 6px 8px; }
    .sum b { display: block; font-size: 16pt; }
    .sum span { font-size: 8pt; color: #555; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px; }
    .sig > div { border: 1px solid #ccd5d1; padding: 8px 10px; }
    .sig .ln { border-bottom: 1px solid #555; height: 30px; margin-bottom: 3px; }
    .decl { background: #f4f7f6; border-left: 3px solid #0b6e4f; padding: 8px 10px; margin-top: 12px; line-height: 1.45; }
    .muted { color: #666; } .small { font-size: 8pt; }
    .grp { background: #f0f2f1; font-weight: 700; }
    .box { width: 12px; height: 12px; border: 1px solid #555; display: inline-block; }
    .labels { display: grid; justify-content: center; }
    .label { overflow: hidden; display: flex; flex-direction: column; padding: 1.6mm 2.2mm; font-size: 7pt; line-height: 1.2; }
    @media screen { .label { outline: 1px dashed #bbb; outline-offset: -1px; } }
    .label .top { display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: #fff; background: #15803d; padding: .5mm 1.5mm; border-radius: 1mm; font-size: 7.5pt; letter-spacing: .03em; }
    .label.f .top { background: #b91c1c; }
    .label .no { font-size: 11pt; font-weight: 800; letter-spacing: .03em; margin-top: .6mm; }
    .label .bc { flex: 1; min-height: 0; display: flex; align-items: center; margin: .4mm 0; }
    .label .bc svg { width: 100%; height: 100%; }
    .label .rows { display: grid; grid-template-columns: auto 1fr; column-gap: 2mm; }
    .label .rows b { font-weight: 700; }
    .label .co { font-size: 6pt; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  function header(title, sub) {
    const { esc } = P(); const c = P().db.settings.company;
    return `<div class="hdr"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      <div class="co">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ""}<b>${esc(c.name || "")}</b><br>${esc(c.address || "").replace(/\n/g, "<br>")}
      ${c.phone ? "<br>Tel " + esc(c.phone) : ""}${c.email ? "<br>" + esc(c.email) : ""}${c.website ? " · " + esc(c.website) : ""}${c.regNo ? "<br>Reg. no. " + esc(c.regNo) : ""}</div></div>`;
  }

  function doc(title, body, opt = {}) {
    const { esc } = P();
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${opt.css || ""}</style></head>
      <body class="${opt.landscape ? "landscape" : ""}"><div class="bar"><b>${esc(title)}</b><button class="p" id="bp">Print…</button><button id="bf">Save as PDF…</button><button id="bc">Close</button></div>
      ${body}
      <script>
        document.getElementById("bp").onclick = () => window.api ? window.api.printSelf() : window.print();
        document.getElementById("bf").onclick = () => window.api ? window.api.pdfSelf() : window.print();
        document.getElementById("bc").onclick = () => window.close();
      </script></body></html>`;
  }

  const fmtLim = (v, unit, sign) => v ? `${sign}${v}` : "";
  const resCell = r => r ? `<span class="${r}">${P().RES[r]}</span>` : "—";

  function assetsIn(sc, incRetired) { return P().db.assets.filter(a => P().inScope(a, sc) && (incRetired || !a.retired)); }

  /** Latest test per asset within [from, to]. */
  function latestInRange(list, from, to) {
    const out = [];
    for (const a of list) {
      const t = P().testsFor(a.id).find(t => (!from || t.date >= from) && (!to || t.date <= to));
      if (t) out.push({ a, t });
    }
    return out.sort((x, y) => P().cmpNat(P().siteName(x.a.siteId), P().siteName(y.a.siteId)) || P().cmpNat(P().locName(x.a.locationId), P().locName(y.a.locationId)) || P().cmpNat(x.a.assetNo, y.a.assetNo));
  }

  function clientBlock(sc) {
    const { esc } = P(); const I = P().idx();
    let client = null, site = null;
    if (sc.type === "client") client = I.client.get(sc.id);
    if (sc.type === "site") { site = I.site.get(sc.id); client = I.client.get(site.clientId); }
    if (sc.type === "location") { site = I.site.get(I.loc.get(sc.id).siteId); client = I.client.get(site.clientId); }
    if (!client) return `<table class="kv"><tr><td>Client</td><td colspan="3">All clients</td></tr></table>`;
    return `<table class="kv"><tr><td>Client</td><td>${esc(client.name)}</td><td>Contact</td><td>${esc([client.contact, client.phone, client.email].filter(Boolean).join(" · ")) || "—"}</td></tr>
      <tr><td>Address</td><td>${esc(client.address || "").replace(/\n/g, ", ") || "—"}</td><td>Site</td><td>${site ? esc(site.name) + (site.address ? "<br><span class='muted'>" + esc(site.address).replace(/\n/g, ", ") + "</span>" : "") : "All sites"}${sc.type === "location" ? " › " + esc(P().locName(sc.id)) : ""}</td></tr></table>`;
  }

  const scheduleTable = (rows, withSite) => {
    const { esc, fmtDate, show } = P();
    return `<table class="t"><thead><tr><th>Asset no.</th><th>Description</th>${withSite ? "<th>Site</th>" : ""}<th>Location</th><th>Cl.</th><th>Visual</th><th class="n">Earth Ω</th><th class="n">IR MΩ</th><th class="n">Leak mA</th><th>Pol.</th><th>Func.</th><th>Result</th><th>Tested</th><th>Next due</th></tr></thead><tbody>
      ${rows.map(({ a, t }) => `<tr><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td>${withSite ? `<td>${esc(P().siteName(a.siteId))}</td>` : ""}<td>${esc(P().locName(a.locationId))}</td><td>${esc(a.cls)}</td>
        <td>${resCell((t.results || {}).visual)}</td><td class="n">${esc(show(t.earth))}</td><td class="n">${esc(show(t.ir))}</td><td class="n">${esc(show(t.leak))}</td>
        <td>${t.polarity ? P().RES[t.polarity] : "—"}</td><td>${t.functional ? P().RES[t.functional] : "—"}</td><td>${resCell(t.overall)}</td><td>${fmtDate(t.date)}</td><td>${fmtDate(t.nextDue) || "—"}</td></tr>`).join("")}</tbody></table>`;
  };

  /* ---------------- Report builders ---------------- */
  const R = {};

  R.certificate = o => {
    const pm = P(), { esc, fmtDate } = pm, st = pm.db.settings;
    const sc = o.scope || pm.scope;
    const rows = latestInRange(assetsIn(sc), o.from, o.to);
    if (!rows.length) return null;
    const pass = rows.filter(r => r.t.overall === "pass").length, fail = rows.length - pass;
    const dates = rows.map(r => r.t.date).sort();
    const engs = [...new Set(rows.map(r => r.t.tester || pm.engName(r.t.engineerId)).filter(Boolean))];
    const insts = [...new Set(rows.map(r => r.t.instrumentId).filter(Boolean))].map(id => pm.idx().inst.get(id)).filter(Boolean);
    const stds = [...new Set(rows.map(r => r.t.standard))].map(s => (window.PATStd.STANDARDS[s] || {}).name || s);
    const nextDue = rows.map(r => r.t.nextDue).filter(Boolean).sort()[0];
    const certNo = "PAT-" + pm.todayISO().replace(/-/g, "") + "-" + String(rows.length).padStart(4, "0");
    const multiSite = new Set(rows.map(r => r.a.siteId)).size > 1;
    const engRec = engs.map(n => pm.db.engineers.find(e => e.name === n)).filter(Boolean);
    const body = `<div class="sheet">${header("Portable Appliance Inspection & Test Certificate", `Certificate no. <b>${certNo}</b> · Issued ${fmtDate(pm.todayISO())}`)}
      ${clientBlock(sc)}
      <h2>Summary</h2>
      <div class="sum"><div><b>${rows.length}</b><span>Items tested</span></div><div><b class="pass">${pass}</b><span>Passed</span></div><div><b class="fail">${fail}</b><span>Failed</span></div>
        <div><b style="font-size:11pt;line-height:1.9">${fmtDate(dates[0])}${dates[0] !== dates[dates.length - 1] ? " – " + fmtDate(dates[dates.length - 1]) : ""}</b><span>Date(s) of test</span></div>
        <div><b style="font-size:11pt;line-height:1.9">${fmtDate(nextDue) || "—"}</b><span>Earliest retest due</span></div></div>
      <table class="kv"><tr><td>Standard</td><td>${esc(stds.join("; "))}</td><td>Tested by</td><td>${esc(engs.join(", ")) || "—"}${engRec.some(e => e.quals) ? `<br><span class="muted">${esc(engRec.map(e => e.quals).filter(Boolean).join("; "))}</span>` : ""}</td></tr>
        <tr><td>Instrument(s)</td><td colspan="3">${insts.length ? insts.map(i => `${esc([i.make, i.model].join(" "))} s/n ${esc(i.serial || "—")}${i.calDate ? `, calibrated ${fmtDate(i.calDate)}` : ""}${i.calDue ? ` (due ${fmtDate(i.calDue)})` : ""}`).join("<br>") : "—"}</td></tr></table>
      ${fail ? `<h2>Failed items — must not be used until repaired and retested</h2>
        <table class="t"><thead><tr><th>Asset no.</th><th>Description</th><th>Location</th><th>Reason</th><th>Notes</th></tr></thead><tbody>
        ${rows.filter(r => r.t.overall === "fail").map(({ a, t }) => `<tr><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc([pm.siteName(a.siteId), pm.locName(a.locationId)].filter(Boolean).join(" › "))}</td><td class="fail">${esc(Object.entries(t.results || {}).filter(([, v]) => v === "fail").map(([k]) => pm.RESULT_NAMES[k]).join(", "))}</td><td>${esc(t.notes)}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="decl">${esc(st.certNotes || "")}</div>
      <div class="sig"><div><div class="ln"></div>Signed (engineer)<br><br><div class="ln"></div>Name</div><div><div class="ln"></div>Signed (on behalf of client)<br><br><div class="ln"></div>Date</div></div>
      </div>
      <div class="sheet"><h2 style="margin-top:0">Schedule of test results (${rows.length})</h2>${scheduleTable(rows, multiSite)}
      <p class="small muted">Readings: earth continuity (Ω), insulation resistance (MΩ, &gt; = above meter range), protective conductor / touch current (mA). Visual inspection per IET Code of Practice.</p></div>`;
    return { title: "PAT Certificate", html: body, file: `PAT_Certificate_${pm.scopeLabel(sc).replace(/[^\w]+/g, "_")}_${pm.todayISO()}.pdf` };
  };

  R.schedule = o => {
    const pm = P();
    let rows;
    if (o.tests) rows = o.tests.map(t => ({ a: pm.idx().asset.get(t.assetId), t })).filter(r => r.a);
    else rows = latestInRange(assetsIn(o.scope || pm.scope), o.from, o.to);
    if (!rows.length) return null;
    const sc = o.scope || pm.scope;
    return { title: "Test Results Schedule", landscape: true, file: `Test_schedule_${pm.todayISO()}.pdf`,
      html: `<div class="sheet">${header("Schedule of Test Results", pm.esc(pm.scopeLabel(sc)) + (o.from ? ` · ${pm.fmtDate(o.from)} – ${pm.fmtDate(o.to)}` : ""))}${scheduleTable(rows, true)}</div>` };
  };

  R.register = o => {
    const pm = P(), { esc, fmtDate } = pm, sc = o.scope || pm.scope;
    const list = assetsIn(sc).sort((a, b) => pm.cmpNat(pm.clientName(a.clientId), pm.clientName(b.clientId)) || pm.cmpNat(pm.siteName(a.siteId), pm.siteName(b.siteId)) || pm.cmpNat(pm.locName(a.locationId), pm.locName(b.locationId)) || pm.cmpNat(a.assetNo, b.assetNo));
    if (!list.length) return null;
    return { title: "Asset Register", landscape: true, file: `Asset_register_${pm.todayISO()}.pdf`,
      html: `<div class="sheet">${header("Asset Register", esc(pm.scopeLabel(sc)) + ` · ${list.length} assets · ${fmtDate(pm.todayISO())}`)}
      <table class="t"><thead><tr><th>Asset no.</th><th>Description</th><th>Client</th><th>Site</th><th>Location</th><th>Make / model</th><th>Serial</th><th>Cl.</th><th>Type</th><th>Last test</th><th>Result</th><th>Next due</th><th>Status</th></tr></thead><tbody>
      ${list.map(a => { const s = pm.assetStatus(a); return `<tr><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc(pm.clientName(a.clientId))}</td><td>${esc(pm.siteName(a.siteId))}</td><td>${esc(pm.locName(a.locationId))}</td><td>${esc([a.make, a.model].filter(Boolean).join(" "))}</td><td>${esc(a.serial)}</td><td>${esc(a.cls)}</td><td>${esc(a.type)}</td>
        <td>${s.last ? fmtDate(s.last.date) : "—"}</td><td>${s.last ? resCell(s.last.overall) : "—"}</td><td>${s.last && s.last.overall === "pass" ? fmtDate(s.last.nextDue) : "—"}</td><td class="${s.cls === "fail" ? "fail" : s.cls === "warn" ? "warn" : ""}">${esc(s.txt)}</td></tr>`; }).join("")}</tbody></table></div>` };
  };

  R.due = o => {
    const pm = P(), { esc, fmtDate } = pm, sc = o.scope || pm.scope;
    const rows = pm.dueRows(o.range || "warn", sc);
    if (!rows.length) return null;
    const groups = new Map();
    rows.forEach(r => { const k = `${pm.clientName(r.a.clientId)} › ${pm.siteName(r.a.siteId) || "(no site)"}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    return { title: "Retest Due List", file: `Retests_due_${pm.todayISO()}.pdf`,
      html: `<div class="sheet">${header("Retest Due List", esc(pm.scopeLabel(sc)) + ` · ${rows.length} items · printed ${fmtDate(pm.todayISO())}`)}
      <table class="t"><thead><tr><th>Asset no.</th><th>Description</th><th>Location</th><th>Cl.</th><th>Last test</th><th>Due</th><th>Found</th><th>Tested</th></tr></thead><tbody>
      ${[...groups].map(([g, rs]) => `<tr class="grp"><td colspan="8">${esc(g)} (${rs.length})</td></tr>` + rs.map(r => `<tr><td><b>${esc(r.a.assetNo)}</b></td><td>${esc(r.a.description)}</td><td>${esc(pm.locName(r.a.locationId))}</td><td>${esc(r.a.cls)}</td><td>${r.s.last ? fmtDate(r.s.last.date) : "—"}</td><td class="${r.s.key === "overdue" ? "fail" : ""}">${fmtDate(r.due) || "—"}</td><td><span class="box"></span></td><td><span class="box"></span></td></tr>`).join("")).join("")}
      </tbody></table></div>` };
  };

  R.failures = o => {
    const pm = P(), { esc, fmtDate } = pm, sc = o.scope || pm.scope;
    const list = assetsIn(sc).map(a => ({ a, s: pm.assetStatus(a) })).filter(x => x.s.key === "failed");
    if (!list.length) return null;
    return { title: "Failed Items Report", landscape: true, file: `Failed_items_${pm.todayISO()}.pdf`,
      html: `<div class="sheet">${header("Failed Items Report", esc(pm.scopeLabel(sc)) + ` · ${list.length} items · ${fmtDate(pm.todayISO())}`)}
      <p>The following equipment failed inspection or testing and <b>must not be used</b> until it has been repaired and passed a retest, or has been disposed of.</p>
      <table class="t"><thead><tr><th>Asset no.</th><th>Description</th><th>Client › Site › Location</th><th>Failed on</th><th>Tested by</th><th>Reason</th><th>Notes</th><th>Action taken</th></tr></thead><tbody>
      ${list.map(({ a, s }) => `<tr><td><b>${esc(a.assetNo)}</b></td><td>${esc(a.description)}</td><td>${esc([pm.clientName(a.clientId), pm.siteName(a.siteId), pm.locName(a.locationId)].filter(Boolean).join(" › "))}</td><td>${fmtDate(s.last.date)}</td><td>${esc(s.last.tester)}</td>
        <td class="fail">${esc(Object.entries(s.last.results || {}).filter(([, v]) => v === "fail").map(([k]) => pm.RESULT_NAMES[k]).join(", ") + ((s.last.visualFails || []).length ? ": " + s.last.visualFails.map(k => (pm.VISUAL_ITEMS.find(v => v[0] === k) || [k, k])[1]).join("; ") : ""))}</td>
        <td>${esc(s.last.notes)}</td><td>${s.repair ? esc((pm.REPAIR_ACTIONS.find(r => r[0] === s.repair.action) || ["", s.repair.action])[1]) + (s.repair.work ? " — " + esc(s.repair.work) : "") : "—"}</td></tr>`).join("")}</tbody></table></div>` };
  };

  R.summary = o => {
    const pm = P(), { esc, fmtDate } = pm, sc = o.scope || pm.scope;
    const list = assetsIn(sc);
    if (!list.length) return null;
    const groups = new Map();
    for (const a of list) { const k = a.siteId + "|" + a.locationId; if (!groups.has(k)) groups.set(k, { a, n: 0, pass: 0, fail: 0, due: 0, over: 0, un: 0 }); const g = groups.get(k); g.n++; const s = pm.assetStatus(a).key; if (s === "pass") g.pass++; else if (s === "failed") g.fail++; else if (s === "due") g.due++; else if (s === "overdue") g.over++; else g.un++; }
    const gs = [...groups.values()].sort((x, y) => pm.cmpNat(pm.clientName(x.a.clientId), pm.clientName(y.a.clientId)) || pm.cmpNat(pm.siteName(x.a.siteId), pm.siteName(y.a.siteId)) || pm.cmpNat(pm.locName(x.a.locationId), pm.locName(y.a.locationId)));
    const tot = k => gs.reduce((s, g) => s + g[k], 0);
    return { title: "Compliance Summary", file: `Compliance_summary_${pm.todayISO()}.pdf`,
      html: `<div class="sheet">${header("Compliance Summary", esc(pm.scopeLabel(sc)) + ` · ${fmtDate(pm.todayISO())}`)}
      <div class="sum"><div><b>${list.length}</b><span>Assets</span></div><div><b class="pass">${Math.round(tot("pass") / list.length * 100)}%</b><span>In date &amp; passed</span></div><div><b class="warn">${tot("due")}</b><span>Due soon</span></div><div><b class="fail">${tot("over")}</b><span>Overdue</span></div><div><b class="fail">${tot("fail")}</b><span>Failed</span></div></div>
      <table class="t"><thead><tr><th>Client</th><th>Site</th><th>Location</th><th class="n">Assets</th><th class="n">Passed</th><th class="n">Due soon</th><th class="n">Overdue</th><th class="n">Failed</th><th class="n">Not tested</th><th class="n">Compliant</th></tr></thead><tbody>
      ${gs.map(g => `<tr><td>${esc(pm.clientName(g.a.clientId))}</td><td>${esc(pm.siteName(g.a.siteId))}</td><td>${esc(pm.locName(g.a.locationId)) || "—"}</td><td class="n">${g.n}</td><td class="n">${g.pass}</td><td class="n">${g.due || ""}</td><td class="n${g.over ? " fail" : ""}">${g.over || ""}</td><td class="n${g.fail ? " fail" : ""}">${g.fail || ""}</td><td class="n">${g.un || ""}</td><td class="n">${Math.round((g.pass + g.due) / g.n * 100)}%</td></tr>`).join("")}
      </tbody></table></div>` };
  };

  R.asset = o => {
    const pm = P(), { esc, fmtDate, show } = pm;
    const ids = o.assetIds || assetsIn(o.scope || pm.scope).map(a => a.id);
    if (!ids.length) return null;
    const pages = ids.map(id => pm.idx().asset.get(id)).filter(Boolean).map(a => {
      const ts = pm.testsFor(a.id), t = ts[0], reps = pm.repairsFor(a.id);
      return `<div class="sheet">${header("Equipment Test Record", `Asset <b>${esc(a.assetNo)}</b> — ${esc(a.description)}`)}
        <table class="kv"><tr><td>Client</td><td>${esc(pm.clientName(a.clientId))}</td><td>Site / location</td><td>${esc([pm.siteName(a.siteId), pm.locName(a.locationId)].filter(Boolean).join(" › ")) || "—"}</td></tr>
        <tr><td>Make / model</td><td>${esc([a.make, a.model].filter(Boolean).join(" ")) || "—"}</td><td>Serial no.</td><td>${esc(a.serial) || "—"}</td></tr>
        <tr><td>Class / type</td><td>Class ${esc(a.cls)} · ${esc(a.type)}</td><td>Cord / fuse</td><td>${a.csa ? esc(a.csa) + " mm²" : "—"}${a.length ? " × " + esc(a.length) + " m" : ""}${a.fuse ? " · " + esc(a.fuse) + " A" : ""}</td></tr>
        <tr><td>Status</td><td>${esc(pm.assetStatus(a).txt)}</td><td>Retest interval</td><td>${esc(a.interval || pm.db.settings.interval)} months</td></tr></table>
        ${t ? `<h2>Latest test — ${fmtDate(t.date)} <span class="${t.overall}">${pm.RES[t.overall].toUpperCase()}</span></h2>
        <table class="t"><thead><tr><th>Test</th><th class="n">Reading</th><th class="n">Limit</th><th>Result</th></tr></thead><tbody>
          <tr><td>Earth continuity</td><td class="n">${esc(show(t.earth))} Ω</td><td class="n">${fmtLim(t.earthLimit, "Ω", "≤ ")}</td><td>${resCell((t.results || {}).earth)}</td></tr>
          <tr><td>Insulation resistance @ ${esc(t.irV || 500)} V</td><td class="n">${esc(show(t.ir))} MΩ</td><td class="n">${fmtLim(t.irLimit, "MΩ", "≥ ")}</td><td>${resCell((t.results || {}).ir)}</td></tr>
          <tr><td>${esc(t.leakMethod === "Touch current" ? "Touch current" : "Protective conductor current" + (t.leakMethod ? ` (${t.leakMethod})` : ""))}</td><td class="n">${esc(show(t.leak))} mA</td><td class="n">${fmtLim(t.leakLimit, "mA", "≤ ")}</td><td>${resCell((t.results || {}).leak)}</td></tr>
          <tr><td>Polarity</td><td colspan="2"></td><td>${t.polarity ? resCell(t.polarity === "na" ? "" : t.polarity) || "N/A" : "—"}</td></tr>
          <tr><td>Functional check</td><td colspan="2"></td><td>${t.functional ? resCell(t.functional === "na" ? "" : t.functional) || "N/A" : "—"}</td></tr>
          ${t.rcd1 || t.rcd5 ? `<tr><td>RCD trip ×1 / ×5</td><td class="n">${esc(show(t.rcd1))} / ${esc(show(t.rcd5))} ms</td><td></td><td>${resCell((t.results || {}).rcd1 === "fail" || (t.results || {}).rcd5 === "fail" ? "fail" : (t.results || {}).rcd1)}</td></tr>` : ""}
        </tbody></table>
        <h3>Visual inspection</h3><table class="t"><tbody>${pm.VISUAL_ITEMS.map(([k, l]) => `<tr><td>${esc(l)}</td><td style="width:60px">${t.visual && t.visual[k] ? resCell(t.visual[k] === "na" ? "" : t.visual[k]) || "N/A" : "—"}</td></tr>`).join("")}</tbody></table>
        <p>Tested by <b>${esc(t.tester || "—")}</b>${t.instrument ? ` using ${esc(t.instrument)}` : ""} · ${esc((window.PATStd.STANDARDS[t.standard] || {}).name || "")}${t.nextDue ? ` · Next test due <b>${fmtDate(t.nextDue)}</b>` : ""}${t.notes ? `<br>Notes: ${esc(t.notes)}` : ""}</p>` : "<p>Not tested.</p>"}
        ${ts.length > 1 ? `<h2>History</h2><table class="t"><thead><tr><th>Date</th><th>Engineer</th><th class="n">Earth Ω</th><th class="n">IR MΩ</th><th class="n">Leak mA</th><th>Result</th><th>Notes</th></tr></thead><tbody>
          ${ts.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.tester)}</td><td class="n">${esc(show(x.earth))}</td><td class="n">${esc(show(x.ir))}</td><td class="n">${esc(show(x.leak))}</td><td>${resCell(x.overall)}</td><td>${esc(x.notes)}</td></tr>`).join("")}</tbody></table>` : ""}
        ${reps.length ? `<h2>Repairs &amp; actions</h2><table class="t"><thead><tr><th>Date</th><th>Action</th><th>Fault</th><th>Work done</th><th>By</th></tr></thead><tbody>${reps.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${esc((pm.REPAIR_ACTIONS.find(x => x[0] === r.action) || ["", r.action])[1])}</td><td>${esc(r.fault)}</td><td>${esc(r.work)}</td><td>${esc(r.by)}</td></tr>`).join("")}</tbody></table>` : ""}
      </div>`;
    });
    return { title: ids.length === 1 ? "Equipment Test Record" : `Equipment Test Records (${ids.length})`, html: pages.join(""), file: ids.length === 1 ? `Test_record_${pm.idx().asset.get(ids[0]).assetNo}.pdf` : `Test_records_${pm.todayISO()}.pdf` };
  };

  const LAYOUTS = {
    "3x8": { cols: 3, rows: 8, w: 63.5, h: 33.9, top: 13.0, gapX: 2.5, gapY: 0 },
    "2x7": { cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.1, gapX: 2.5, gapY: 0 },
    "4x10": { cols: 4, rows: 10, w: 48.5, h: 25.4, top: 21.5, gapX: 0, gapY: 0 }
  };
  R.labels = o => {
    const pm = P(), { esc, fmtDate } = pm;
    let list = o.assetIds ? o.assetIds.map(id => pm.idx().asset.get(id)).filter(Boolean) : assetsIn(o.scope || pm.scope);
    if (o.which === "tested") list = list.filter(a => pm.latestFor(a.id));
    list.sort((a, b) => pm.cmpNat(a.assetNo, b.assetNo));
    if (!list.length) return null;
    const L = LAYOUTS[pm.db.settings.labelLayout] || LAYOUTS["3x8"];
    const per = L.cols * L.rows, co = pm.db.settings.company;
    const label = a => {
      const t = pm.latestFor(a.id), fail = t && t.overall === "fail";
      return `<div class="label${fail ? " f" : ""}"><div class="top"><span>${fail ? "FAILED — DO NOT USE" : t ? "PAT TESTED · PASS" : "ASSET"}</span></div>
        <div class="no">${esc(a.assetNo)}</div>
        <div class="bc">${window.Barcode128.svg(a.assetNo, { height: 30, quiet: 4 })}</div>
        <div class="rows">${t ? `<span>Tested</span><b>${fmtDate(t.date)}</b>${!fail ? `<span>Next test</span><b>${fmtDate(t.nextDue)}</b>` : ""}<span>By</span><b>${esc(t.tester || "—")}</b>` : `<span>Item</span><b>${esc(a.description)}</b>`}</div>
        ${co.name ? `<div class="co">${esc(co.name)}${co.phone ? " · " + esc(co.phone) : ""}</div>` : ""}</div>`;
    };
    const pages = [];
    for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
    const css = `.lsheet { width: 210mm; height: 297mm; padding-top: ${L.top}mm; overflow: hidden; break-after: page; background: #fff; }
      @media screen { .lsheet { margin: 0 auto 16px; box-shadow: 0 2px 12px rgba(0,0,0,.4); } }
      .labels { grid-template-columns: repeat(${L.cols}, ${L.w}mm); grid-auto-rows: ${L.h}mm; column-gap: ${L.gapX}mm; row-gap: ${L.gapY}mm; }`;
    return { title: `Asset labels (${list.length})`, margins: { top: 0, bottom: 0, left: 0, right: 0 }, noFooter: true, css, file: `Labels_${pm.todayISO()}.pdf`,
      html: pages.map(p => `<div class="lsheet"><div class="labels">${p.map(label).join("")}</div></div>`).join("") };
  };

  const LIST = [
    { id: "certificate", name: "PAT Certificate", desc: "Certificate with summary, failed items, declaration and full results schedule.", dates: true, help: "Uses the latest test for each asset within the date range." },
    { id: "schedule", name: "Test Results Schedule", desc: "Every asset’s latest readings and result, landscape.", dates: true, help: "Uses the latest test for each asset within the date range." },
    { id: "summary", name: "Compliance Summary", desc: "Pass / due / overdue / failed counts by site and location." },
    { id: "due", name: "Retest Due List", desc: "Checklist of items due for retest, grouped by site." },
    { id: "failures", name: "Failed Items Report", desc: "Equipment that must not be used, with reasons and actions taken." },
    { id: "register", name: "Asset Register", desc: "Full equipment inventory with current status." },
    { id: "asset", name: "Equipment Test Records", desc: "One page per asset: details, latest test in full, history and repairs." },
    { id: "labels", name: "Asset Labels", desc: "Printable pass/fail labels with barcode for A4 label sheets.", help: "Change the label sheet layout under Settings." }
  ];

  async function run(id, o = {}) {
    const pm = P();
    const r = R[id](o);
    if (!r) { pm.toast("Nothing to report for this selection"); return; }
    const html = doc(r.title, r.html, { landscape: r.landscape, css: r.css });
    const c = pm.db.settings.company;
    const footer = r.noFooter ? "" : `<div style="font-size:8px;width:100%;padding:0 10mm;display:flex;justify-content:space-between;color:#666;font-family:Segoe UI,Arial"><span>${pm.esc(c.name || "PAT Manager")} · ${pm.esc(r.title)} · printed ${pm.fmtDate(pm.todayISO())}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const payload = { html, title: r.title, landscape: !!r.landscape, fileName: r.file, margins: r.margins, footer };
    if (window.api) return o.pdf ? window.api.pdfReport(payload) : window.api.previewReport(payload);
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  }

  window.Reports = { list: () => LIST, run, _build: (id, o) => R[id](o), _doc: doc };
})();
