/**
 * 壁纸页的纯逻辑（不碰 DOM），单独放一份便于单测。
 * 以经典脚本方式挂到 window.TDLogic，页面用 <script src> 引入。
 */
(function (root) {
  "use strict";

  /**
   * 是否进入待机（环带停转）。
   * @param {{now:number, workAt:number, busyUntil:number, hold:number, view?:string, agents?:Array}} s
   */
  function shouldStandby(s) {
    const now = Number(s?.now) || 0;
    const hold = Number(s?.hold) || 0;
    if (s?.view && s.view !== "all") {
      const a = (s.agents || []).find((x) => x && x.source === s.view);
      if (a) return !a.thinking;          // 单一形态：只看该 agent
    }
    return now - (Number(s?.workAt) || 0) > hold && now > (Number(s?.busyUntil) || 0);
  }

  /**
   * 哪些来源算「正在工作」：窗口内有真实事件，且最后一条不是 status。
   * @param {Array<{source:string, agoMs:number, lastType?:string}>} sources
   */
  function activeSources(sources, windowMs) {
    const w = Number(windowMs) || 12000;
    return (sources || []).filter((x) => x && x.agoMs < w && x.lastType !== "status");
  }

  /** 事件速率 → 归一化的 60 点序列（用于迷你曲线，缺的补 0） */
  function normalizeSeries(series, points) {
    const n = Math.max(1, Number(points) || 60);
    const src = Array.isArray(series) ? series.slice(-n) : [];
    const pad = new Array(Math.max(0, n - src.length)).fill(0);
    return pad.concat(src).map((v) => (Number.isFinite(v) ? v : 0));
  }

  /** 每个 agent 的柱高百分比（按累计事件占比） */
  function agentBars(agents, view) {
    const list = (agents || []).filter((a) => a && a.enabled !== false && (!view || view === "all" || a.source === view));
    const max = Math.max(1, ...list.map((a) => a.events || 0));
    return list.map((a) => ({ source: a.source, pct: Math.round(((a.events || 0) / max) * 100) }));
  }

  root.TDLogic = { shouldStandby, activeSources, normalizeSeries, agentBars };
})(typeof window !== "undefined" ? window : globalThis);
