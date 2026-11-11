/**
 * 看板的纯绘制/格式化工具（无 DOM 依赖的只有 fmtAgo/hexA，canvas 绘制需要传入节点）。
 * 壁纸页与弹窗页共用同一份，避免两套面板逻辑漂移。
 */
(function (root) {
  "use strict";

function sizeCanvas(cv, h) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth || cv.parentElement.clientWidth || 200;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
  }
  return dpr;
}

function drawSpark(cv, data, color, opts = {}) {
  if (!cv || !cv.isConnected) return;
  const dense = !!opts.dense;
  const h = opts.height || 54;
  const dpr = sizeCanvas(cv, h);
  const w = cv.width / dpr;
  const x = cv.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  if (!data.length) return;
  const max = Math.max(1, ...data);
  const step = w / Math.max(1, data.length - 1);
  const y = (v) => h - 4 - (v / max) * (h - 8);

  // 基线
  x.strokeStyle = dense ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.08)";
  x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, h - 3.5); x.lineTo(w, h - 3.5); x.stroke();

  // 面积
  const grad = x.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(color, 0.34));
  grad.addColorStop(1, hexA(color, 0.02));
  x.beginPath();
  x.moveTo(0, h - 3.5);
  data.forEach((v, i) => x.lineTo(i * step, y(v)));
  x.lineTo(w, h - 3.5);
  x.closePath();
  x.fillStyle = grad;
  x.fill();

  // 折线
  x.beginPath();
  data.forEach((v, i) => (i ? x.lineTo(i * step, y(v)) : x.moveTo(0, y(v))));
  x.strokeStyle = hexA(color, dense ? 0.85 : 0.92);
  x.lineWidth = dense ? 1 : 1.2;
  x.stroke();

  if (!dense) {
    // 末点
    const lastV = data[data.length - 1];
    x.beginPath(); x.arc(w - 1, y(lastV), 2.2, 0, Math.PI * 2);
    x.fillStyle = hexA(color, 1); x.fill();
  }
}

function hexA(color, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || ""));
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return "刚刚";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

  root.TDPanel = { sizeCanvas, drawSpark, hexA, fmtAgo };
})(typeof window !== "undefined" ? window : globalThis);
