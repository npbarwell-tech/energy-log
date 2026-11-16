/* Code 128 (set B) barcode as inline SVG — used on asset labels. No dependencies. */
(function (root) {
  "use strict";
  const P = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
    "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
    "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
    "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
    "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
    "311141 411131 211412 211214 211232 2331112").split(" ");

  /** Returns module widths (alternating bar/space) for the text, or null if it has characters outside Code 128B. */
  function encode(text) {
    const vals = [104];
    for (const ch of String(text)) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) return null;
      vals.push(c - 32);
    }
    let sum = vals[0];
    for (let i = 1; i < vals.length; i++) sum += i * vals[i];
    vals.push(sum % 103, 106);
    return vals.map(v => P[v]).join("");
  }

  /** SVG string. opts: { height (px units), module (px per module), quiet (modules) } */
  function svg(text, opts) {
    opts = opts || {};
    const widths = encode(text);
    if (!widths) return "";
    const m = opts.module || 1, h = opts.height || 40, q = opts.quiet == null ? 10 : opts.quiet;
    let x = q, rects = "";
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`;
      x += w;
    }
    const total = x + q;
    return `<svg class="barcode" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${total * m}" height="${h}" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="#000">${rects}</g></svg>`;
  }

  root.Barcode128 = { encode, svg };
})(typeof window !== "undefined" ? window : globalThis);
