/* Pass/fail limits for in-service inspection & testing.
 * Defaults follow the IET Code of Practice for In-service Inspection and Testing of
 * Electrical Equipment (5th ed.) and BS EN 50699:2021. Every fixed value can be overridden
 * in Settings, so a site's own policy (or a later edition) can be applied without code changes.
 */
(function (root) {
  "use strict";

  // Resistance of copper conductors at 20 °C, ohms per metre (BS EN 60228 / IET CoP table).
  const CSA_OHM_PER_M = {
    "0.5": 0.039, "0.75": 0.026, "1.0": 0.0195, "1.25": 0.0156,
    "1.5": 0.0133, "2.5": 0.0080, "4.0": 0.0050, "6.0": 0.0033
  };

  const STANDARDS = {
    iet: { id: "iet", name: "IET Code of Practice (5th ed.)", short: "IET CoP" },
    en50699: { id: "en50699", name: "BS EN 50699:2021", short: "BS EN 50699" }
  };

  const DEFAULT_LIMITS = {
    iet: {
      earthBase: 0.1,                 // Ω, added to the protective conductor resistance of the cord
      irClassI: 1.0, irClassIHeat: 0.3, irHeatKw: 3, irClassII: 2.0, irClassIII: 0.25, // MΩ
      leakClassI: 3.5, leakClassII: 0.25, leakHeatPerKw: 1.0, leakHeatMax: 10, leakHeatKw: 3.5, // mA
      rcdX1: 300, rcdX5: 40           // ms
    },
    en50699: {
      earthBase: 0.3, earthBaseLen: 5, earthStep: 0.1, earthStepLen: 7.5, earthMax: 1.0, // Ω
      irClassI: 1.0, irClassIHeat: 0.3, irHeatKw: 0, irClassII: 2.0, irClassIII: 0.25,
      leakClassI: 3.5, leakClassII: 0.5, leakHeatPerKw: 1.0, leakHeatMax: 10, leakHeatKw: 3.5,
      rcdX1: 300, rcdX5: 40
    }
  };

  function round(n, dp) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

  /** Earth bond (protective conductor resistance) limit.
   *  Returns { limit, working } or { limit:null, reason }. */
  function earthLimit(std, csa, lengthM, L) {
    L = L || DEFAULT_LIMITS[std];
    const len = Number(lengthM);
    if (std === "en50699") {
      if (!(len >= 0)) return { limit: null, reason: "Enter the cord length" };
      if (len <= L.earthBaseLen) return { limit: L.earthBase, working: `≤ ${L.earthBaseLen} m cord → ${L.earthBase} Ω` };
      const steps = Math.ceil((len - L.earthBaseLen) / L.earthStepLen);
      const raw = round(L.earthBase + steps * L.earthStep, 3);
      const lim = Math.min(raw, L.earthMax);
      return {
        limit: lim,
        working: `${L.earthBase} Ω + ${steps} × ${L.earthStep} Ω (per extra ${L.earthStepLen} m over ${L.earthBaseLen} m)` +
          (raw > L.earthMax ? ` → capped at ${L.earthMax} Ω` : ` = ${lim} Ω`)
      };
    }
    const r = CSA_OHM_PER_M[csa];
    if (!r) return { limit: null, reason: "Enter the cord conductor size" };
    if (!(len > 0)) return { limit: null, reason: "Enter the cord length" };
    const cord = round(r * len, 4);
    const lim = round(L.earthBase + cord, 3);
    return { limit: lim, working: `${L.earthBase} Ω + (${len} m × ${r} Ω/m = ${cord} Ω) = ${lim} Ω`, cord };
  }

  /** Insulation resistance minimum, MΩ. */
  function irLimit(std, asset, L) {
    L = L || DEFAULT_LIMITS[std];
    const cls = asset.cls;
    if (cls === "III") return { limit: L.irClassIII, voltage: 250 };
    if (cls === "II") return { limit: L.irClassII, voltage: 500 };
    const kw = Number(asset.powerKw) || 0;
    if (asset.heating && kw >= (L.irHeatKw || 0)) return { limit: L.irClassIHeat, voltage: 500, note: "Class I heating" };
    return { limit: L.irClassI, voltage: 500 };
  }

  /** Protective conductor current (Class I) or touch current (Class II) maximum, mA. */
  function leakLimit(std, asset, L) {
    L = L || DEFAULT_LIMITS[std];
    if (asset.cls === "III") return { limit: null, reason: "Not required for Class III" };
    if (asset.cls === "II") return { limit: L.leakClassII, kind: "Touch current" };
    const kw = Number(asset.powerKw) || 0;
    if (asset.heating && kw > L.leakHeatKw) {
      return { limit: Math.min(round(kw * L.leakHeatPerKw, 2), L.leakHeatMax), kind: "Protective conductor current", note: `${L.leakHeatPerKw} mA/kW, max ${L.leakHeatMax} mA` };
    }
    return { limit: L.leakClassI, kind: "Protective conductor current" };
  }

  function needsEarth(asset) { return asset.cls === "I"; }

  /** Parse a meter reading. ">299" / "OL" mean over-range (treated as very high). */
  function parseReading(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^(ol|>)/i.test(s)) {
      const n = parseFloat(s.replace(/^(ol|>)\s*/i, ""));
      return { value: isFinite(n) ? n : Infinity, over: true };
    }
    const n = parseFloat(s.replace(",", "."));
    return isFinite(n) ? { value: n, over: false } : null;
  }

  /** Compare a reading against a limit. kind 'max' means value must be ≤ limit; 'min' means ≥. */
  function judge(reading, limit, kind) {
    const r = parseReading(reading);
    if (!r || limit === null || limit === undefined || limit === "") return null;
    const lim = Number(limit);
    if (!isFinite(lim)) return null;
    if (kind === "min") return r.value >= lim ? "pass" : "fail";
    if (r.over) return "fail";
    return r.value <= lim ? "pass" : "fail";
  }

  root.PATStd = { CSA_OHM_PER_M, STANDARDS, DEFAULT_LIMITS, earthLimit, irLimit, leakLimit, needsEarth, parseReading, judge, round };
})(typeof window !== "undefined" ? window : globalThis);
