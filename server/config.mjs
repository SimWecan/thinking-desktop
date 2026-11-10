/**
 * 界面行为配置：config/ui.json（可选）。默认值在这里，改配置不用改代码。
 *
 * {
 *   "ringText": "headline",     // headline=环带只铺每段首句；full=整段原文
 *   "panel": "hover",           // hover=鼠标停在环带上才展开；always=常驻
 *   "holdSec": 20,              // 多久没有工作事件就停环
 *   "lightsWindowSec": 12,      // 光源/粒子淡出窗口
 *   "ringChars": 90             // headline 模式每段最多多少字
 * }
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UI_DEFAULTS = Object.freeze({
  ringText: "headline",
  panel: "hover",
  holdSec: 20,
  lightsWindowSec: 12,
  ringChars: 90,
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
    holdSec: Math.round(clamp(r.holdSec, 5, 600, UI_DEFAULTS.holdSec)),
    lightsWindowSec: Math.round(clamp(r.lightsWindowSec, 3, 600, UI_DEFAULTS.lightsWindowSec)),
    ringChars: Math.round(clamp(r.ringChars, 30, 400, UI_DEFAULTS.ringChars)),
  };
}

export function loadUiConfig(root) {
  try {
    return normalizeUiConfig(JSON.parse(readFileSync(join(root, "config", "ui.json"), "utf8")));
  } catch {
    return { ...UI_DEFAULTS };
  }
}
