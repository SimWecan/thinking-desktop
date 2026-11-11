/**
 * 界面行为配置：config/ui.json（可选）。默认值在这里，改配置不用改代码。
 *
 * {
 *   "ringText": "headline",     // headline=环带只铺每段首句；full=整段原文
 *   "panel": "hover",           // hover=鼠标停在环带上才展开；always=常驻
 *   "winddownSec": 30,          // 静默过渡窗口：无事件后环带在窗口内逐渐减速、粒子渐弱直至停止
 *   "lightsWindowSec": 12,      // 光源/粒子淡出窗口
 *   "ringChars": 90             // headline 模式每段最多多少字
 * }
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UI_DEFAULTS = Object.freeze({
  ringText: "headline",
  panel: "hover",
  winddownSec: 30,
  lightsWindowSec: 12,
  ringChars: 90,
  ring: { x: 0.5, y: 0.5, scale: 0.30 },   // 圆环中心（归一化）与半径缩放：控制台可拖拽/缩放
});

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** @param {any} raw @returns {typeof UI_DEFAULTS} */
export function normalizeUiConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    ringText: r.ringText === "full" ? "full" : "headline",
    panel: r.panel === "always" ? "always" : "hover",
    // 兼容旧字段 holdSec（语义从「等待后硬停」变为「过渡窗口」，沿用旧值即可）
    winddownSec: Math.round(clamp(r.winddownSec ?? r.holdSec, 5, 600, UI_DEFAULTS.winddownSec)),
    lightsWindowSec: Math.round(clamp(r.lightsWindowSec, 3, 600, UI_DEFAULTS.lightsWindowSec)),
    ringChars: Math.round(clamp(r.ringChars, 30, 400, UI_DEFAULTS.ringChars)),
    ring: {
      x: clamp(r.ring?.x, -0.5, 1.5, UI_DEFAULTS.ring.x),
      y: clamp(r.ring?.y, -0.5, 1.5, UI_DEFAULTS.ring.y),
      scale: clamp(r.ring?.scale, 0.4, 2.5, UI_DEFAULTS.ring.scale),
    },
  };
}

export function loadUiConfig(root) {
  try {
    return normalizeUiConfig(JSON.parse(readFileSync(join(root, "config", "ui.json"), "utf8")));
  } catch {
    return normalizeUiConfig({});
  }
}
