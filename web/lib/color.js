/**
 * 专业调色盘的色彩换算（纯函数，可单测）：HSV ↔ RGB/HEX。
 * 控制台的调色盘用它，避免在页面里手写一遍没法测的颜色数学。
 */
(function (root) {
  "use strict";

  function hsvToRgb(h, s, v) {
    const hh = ((Number(h) % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(1, Number(s) || 0));
    const vv = Math.max(0, Math.min(1, Number(v) || 0));
    const c = vv * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = vv - c;
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hh / 60) % 6];
    return seg.map((n) => Math.round((n + m) * 255));
  }

  function rgbToHex([r, g, b]) {
    return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHsv([r, g, b]) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
    let h = 0;
    if (d) h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }

  function hexToHsv(hex) {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHsv(rgb) : null;
  }

  function normalizeHex(hex, fallback) {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb) : fallback;
  }

  root.TDColor = { hsvToRgb, rgbToHex, hexToRgb, rgbToHsv, hexToHsv, normalizeHex };
})(typeof window !== "undefined" ? window : globalThis);
