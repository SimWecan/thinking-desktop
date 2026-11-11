/**
 * wall/main.js — 壁纸编排层：halo iframe 接线 / 待机·动态静默 / SSE / 1s 主循环 / 调试 HUD
 * 页面加载顺序：td-logic.js → panel.js → text.js → panel.js(wall) → main.js（本文件最后执行）
 */
"use strict";
const { sizeCanvas, drawSpark, hexA, fmtAgo } = window.TDPanel;
// 预览实例（?preview=1）用独立遥测 key，避免覆盖壁纸宿主的 debug 记录
const PARAMS = new URLSearchParams(location.search);
const TD_CLIENT = PARAMS.has("preview") ? "wall-preview" : PARAMS.has("panel") ? "wall-panel" : "wall";
const PANEL_ONLY = PARAMS.has("panel");     // 弹出窗口：只渲染右侧看板
const HOST_POPUP = PARAMS.has("hostpopup"); // 桌面壁纸：看板由原生弹窗负责，页内不再画
const DEBUG = !!window.__TD_DEBUG__;
const PAGE_BUILD = "wall-2";   // 自检用：确认壁纸加载的是新页面
let UI = { ringText: "headline", panel: "hover", winddownSec: 30, lightsWindowSec: 12, ringChars: 90 };  // 来自 /state.ui
const WINDDOWN = () => UI.winddownSec * 1000;   // 静默过渡窗口：窗口内环带逐渐减速到停止

// 宿主在鼠标离开环带后驱动 3 秒倒计时；这里把它画在弹窗底部
window.__tdHoverCountdown = function (sec) {
  const el = document.getElementById("pnCountdown");
  if (!el) return;
  const left = Number(sec) || 0;
  if (left <= 0) { el.classList.remove("on"); return; }
  el.classList.add("on");
  const bar = el.querySelector("i"), txt = el.querySelector("span");
  if (bar) bar.style.width = Math.max(0, Math.min(100, (left / 3) * 100)).toFixed(0) + "%";
  if (txt) txt.textContent = left.toFixed(1) + "s 后收起";
};

if (PANEL_ONLY) {
  document.documentElement.classList.add("panel-only");
  document.body.classList.add("panel-only");
  document.documentElement.style.background = "transparent";
}

addEventListener("error", (e) => {
  fetch("/debug", { method: "POST", body: JSON.stringify({ client: TD_CLIENT, pageError: String(e.message || e.error), src: String((e.filename || "").split("/").pop()) + ":" + e.lineno }) }).catch(() => {});
});
addEventListener("unhandledrejection", (e) => {
  fetch("/debug", { method: "POST", body: JSON.stringify({ client: TD_CLIENT, pageError: "rejection: " + String((e.reason && e.reason.message) || e.reason) }) }).catch(() => {});
});

let view = "all";        // all=综合形态；其它=单一 agent 形态（托盘选择）
let agentsList = [];
let workAt = 0;
let busyUntil = 0;
let standby = null;
let lastCalm = 0;
let overRing = false;
let haloError = "";
let lastParamPush = 0, stateTimer = 0;

/** agent 配置色（调色盘选择）优先于内置色 */
function colorOf(source) {
  const a = agentsList.find((x) => x.source === source);
  return (a && a.color) || SOURCE_COLORS[source] || "rgba(255,255,255,.55)";
}

// ---------------- 右侧看板 ----------------
/** 速率曲线：面积 + 折线 + 末点高亮 */
/* 未使用（agent 活跃度已改由 TDLogic.agentBars 计算，保留备查）
function agentActivity(src) {
  return bySource[src] || 0;
}
*/

function renderPanel() {
  pnRate.textContent = rate.toFixed(1);
  miniRate.textContent = rate.toFixed(1);
  pnView.textContent = view === "all" ? "ALL AGENTS" : (SRC_LABEL[view] || view).toUpperCase();

  const accent = view === "all" ? "#ffffff" : colorOf(view);
  drawSpark(spark, series, accent, { height: 54 });
  drawSpark(miniSpark, series, accent, { height: 26 });

  // agents
  // 同一商标（ChatGPT / Codex）合并成一行，事件数相加
  const grouped = new Map();
  for (const a of (agentsList || []).filter((x) => x.enabled !== false)) {
    const key = a.icon || a.source;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(a);
  }
  const list = [...grouped.entries()]
    .map(([key, g]) => {
      const primary = g.find((a) => a.source === key) || g[0];
      return {
        ...primary,
        source: key,
        name: g.map((a) => a.name || a.source).join(" / "),
        events: g.reduce((n, a) => n + (a.events || 0), 0),
        thinking: g.some((a) => a.thinking),
        agoMs: Math.min(...g.map((a) => (a.agoMs == null ? Infinity : a.agoMs))),
      };
    })
    .filter((a) => view === "all" || a.source === view || (agentsList || []).some((x) => x.source === view && (x.icon || x.source) === a.source));
  const bars = new Map(TDLogic.agentBars(list, "all").map((b) => [b.source, b.pct]));
  pnAgents.innerHTML = "";
  if (!list.length) pnAgents.innerHTML = `<div class="empty">未绑定 agent</div>`;
  for (const a of list) {
    /* const act = agentActivity(a.source); // 未使用：柱高改用 bars 预计算 */
    const row = document.createElement("div");
    row.className = "ag" + (a.thinking ? "" : " off");
    row.style.color = a.color;
    row.innerHTML =
      `<span class="dot"></span>` +
      `<span class="name">${a.name || a.source}</span>` +
      `<canvas class="sp" data-src="${a.source}"></canvas>` +
      `<span class="cnt">${a.events || 0}</span>` +
      `<span class="age">${a.thinking ? "active" : fmtAgo(a.agoMs)}</span>`;
    pnAgents.appendChild(row);
  }
  // 每个 agent 自己的 60s 曲线
  pnAgents.querySelectorAll("canvas.sp").forEach((cv) => {
    const src = cv.dataset.src;
    drawSpark(cv, agentSeries[src] || [], colorOf(src), { height: 16, dense: true });
  });

  // stats 行
  const enabled = (agentsList || []).filter((a) => a.enabled !== false).length;
  document.getElementById("pn-stats").innerHTML =
    `<span>EVENTS <b>${totalEvents}</b></span>` +
    `<span>TOOLS <b>${tools.length}</b></span>` +
    `<span>AGENTS <b>${enabled}</b></span>`;

  // tools
  const tmax = Math.max(1, ...tools.map((t) => t.count));
  pnTools.innerHTML = tools.length ? "" : `<div class="empty">暂无工具调用</div>`;
  for (const t of tools.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "tool";
    row.innerHTML =
      `<span class="tn">${t.name}</span><span class="tv">${t.count}</span>` +
      `<span class="tb"><i style="width:${Math.round((t.count / tmax) * 100)}%"></i></span>`;
    pnTools.appendChild(row);
  }

  // context：每个 agent 一行（模型 + 占用率）
  pnCtx.innerHTML = "";
  const ctxRows = list.filter((a) => tokens[a.source]);
  if (!ctxRows.length) pnCtx.innerHTML = `<div class="empty">暂无上下文计量</div>`;
  for (const a of ctxRows) {
    const t = tokens[a.source];
    const pct = Math.max(0, Math.min(1, Number(t.pct) || 0));
    const row = document.createElement("div");
    row.className = "crow";
    row.style.color = a.color;
    const usedTxt = t.used != null && t.window
      ? `${Math.round(t.used / 1000)}k/${Math.round(t.window / 1000)}k`
      : (t.model || "");
    row.innerHTML =
      `<span class="dot"></span>` +
      `<span class="nm">${a.name || a.source}</span>` +
      `<span class="md">${usedTxt}</span>` +
      `<span class="pc">${(pct * 100).toFixed(0)}%</span>`;
    pnCtx.appendChild(row);
  }

  // mini dots
  const lit = (sources || []).filter((x) => x.agoMs < 12000 && x.lastType !== "status");
  miniDots.innerHTML = lit.slice(0, 6).map((x) => `<span class="dot" style="background:${colorOf(x.source)}"></span>`).join("");
}

function syncPanel() {
  if (HOST_POPUP) {                  // 桌面壁纸：交给原生弹窗，页内保持干净
    panel.classList.remove("show");
    mini.classList.remove("hide");
    return;
  }
  const show = PANEL_ONLY || overRing || UI.panel === "always";
  panel.classList.toggle("show", show);
  mini.classList.toggle("hide", show);
}

const halo = document.getElementById("halo");
// 每次加载都带时间戳，避免 WKWebView 用旧缓存的 halo 页面（改了前端却不生效的元凶）
// preview=1 原样透传：配置窗口的小窗预览以低负载模式运行（DPR 封顶 + 25fps）
if (!PANEL_ONLY) {
  halo.src = "/haloflux/?t=" + Date.now() + (PARAMS.has("preview") ? "&preview=1" : "");
}

// ---------------- 状态 ----------------
let energy = 0, rate = 0, byType = {}, bySource = {}, sources = [];
let series = [], tools = [], tokens = {}, agentSeries = {}, totalEvents = 0;
const textLines = [];
let lastTextAt = 0, textSeq = 0;

// 各厂商的专属色：环内外光效 + 文本标签共用同一套（调色盘可覆盖）
// 与 server/agents.mjs 的 VENDOR_PRESETS 保持一致——/agents 拉取失败时的兜底色
// 也必须和注册表相同，否则粒子颜色会闪变
function haloMsg(m) { try { halo.contentWindow?.postMessage(m, "*"); } catch {} }

// 悬停：原生宿主转发全局鼠标位置 → 光环只判断「是否停在环带上」
window.__tdMouse = (x, y) => haloMsg({ td: "mouse", x, y });
addEventListener("mousemove", (e) => window.__tdMouse(e.clientX, e.clientY));
// 点击穿透：原生宿主转发全局点击坐标 → 光环冲击波
window.__tdClick = (x, y) => haloMsg({ td: "click", x, y });
addEventListener("mousedown", (e) => window.__tdClick(e.clientX, e.clientY));

/** 待机 ⇄ 活动 */
function setStandby(on) {
  if (standby === on) return;
  standby = on;
  haloMsg({ td: "standby", value: on });
  setTimeout(() => { if (standby === on) haloMsg({ td: "standby", value: on }); }, 800);
}

/** 活动强度 → HALOFLUX 参数（舒适档） */
let lastRingKey = "";
function pushRing() {
  const r = UI.ring;
  if (!r) return;
  const key = `${r.x},${r.y},${r.scale}`;
  if (key === lastRingKey) return;
  lastRingKey = key;
  haloMsg({ td: "ring", ring: { x: +r.x, y: +r.y, scale: +r.scale } });
}

function pushParams() {
  const now = Date.now();
  if (now - lastParamPush < 1000) return;
  lastParamPush = now;
  const r = Math.min(rate, 2), e = Math.min(energy, 1);
  haloMsg({ td: "set", key: "tempo", value: +(0.55 + r * 0.06 + e * 0.05).toFixed(2) });
  haloMsg({ td: "set", key: "ringSpeed", value: +(0.42 + r * 0.05 + e * 0.04).toFixed(2) });
  haloMsg({ td: "set", key: "beamGlow", value: +(2.3 + e * 0.5).toFixed(2) });
  haloMsg({ td: "set", key: "glow", value: +(1.02 + e * 0.12).toFixed(2) });
}

// 启动即回填最近的思考文本
(async function seedTexts() {
  try {
    // 先取一次配置，避免首屏用默认值（比如 ringChars）再跳变
    try {
      const s = await (await fetch("/state")).json();
      if (s.ui) UI = s.ui;
    } catch {}
    const list = await (await fetch("/texts?limit=14")).json();
    list.forEach((t) => pushText(t.text, t.source, t.kind, false));
  } catch {}
})();


halo.addEventListener("load", () => {
  standby = null;
  setStandby(currentCalm() >= 1);
  pushParams();
});
window.addEventListener("message", (ev) => {
  if (ev.data && ev.data.td === "hover") { overRing = !!ev.data.ring; syncPanel(); return; }
  if (ev.data && ev.data.td === "error") { haloError = `${ev.data.message} @ ${new Date(ev.data.at).toLocaleTimeString()}`; return; }
  if (ev.data && ev.data.td === "ready") {
    standby = null;
    setStandby(currentCalm() >= 1);
    pushParams();
    resendText();
    sendSourceLights();   // iframe 刚加载完：把当前点亮的来源一次性对齐，避免空窗
  }
});

/** 动态静默系数 0→1：0 全速；0<x<1 环带逐渐减速/粒子渐弱；1 完全静默 */
function currentCalm() {
  return TDLogic.winddownCalm({
    now: Date.now(), workAt, busyUntil, winddown: WINDDOWN(), view, agents: agentsList,
  });
}

/** 正在工作的来源 → 光环按各自颜色点亮 */
function sendSourceLights() {
  let list = TDLogic.activeSources(sources, UI.lightsWindowSec * 1000).map((x) => ({
      src: x.source,
      color: colorOf(x.source),
      intensity: Math.min(1, 0.35 + (bySource[x.source] || 0) / 6),
    }));
  if (view !== "all") list = list.filter((x) => x.src === view).map((x) => ({ ...x, intensity: 1 }));
  haloMsg({ td: "sources", list });
}


// ---------------- SSE ----------------
const es = new EventSource("/stream");
es.onmessage = (ev) => {
  const e = JSON.parse(ev.data);
  if (e.type === "hello") {
    rate = e.state.rate; byType = e.state.byType; bySource = e.state.bySource; sources = e.state.sources || [];
    series = e.state.series || series;
    workAt = e.state.lastEventAt;
    sendSourceLights();   // 重连后光环里可能留着旧来源的残影（服务重启前点亮的），立即按当前状态对齐
    return;
  }
  if (e.type === "view") { view = e.payload.agent || "all"; return; }
  if (e.type === "status") {
    if (e.payload && e.payload.running > 0) busyUntil = e.ts + 8000;
    else if (e.payload && e.payload.running === 0) busyUntil = 0;   // 回合结束：立刻允许停环
    return;
  }
  workAt = e.ts;
  if (e.type === "text") {
    if (view === "all" || e.source === view) pushText(e.payload.text, e.source, e.payload.kind, e.payload.stream);
    energy = Math.min(energy + 0.12, 1.6);
    return;
  }
  if (e.type === "tool_call") energy = Math.min(energy + 0.3, 1.6);
  else energy = Math.min(energy + 0.14, 1.6);
};
es.onerror = () => { /* EventSource 自动重连 */ };

setInterval(async () => {
  // 动态静默：空闲时间进入过渡窗口后，每秒把 calm 系数推给光环——
  // 环带转速随之逐渐减缓、粒子/光束强度渐弱；到 1 时转入完全静默（standby 冻结）
  const calm = currentCalm();
  const idle = calm >= 1;
  setStandby(idle);
  if (calm > 0 && calm < 1) haloMsg({ td: "calm", value: +calm.toFixed(3) });
  else if (calm <= 0 && lastCalm > 0) haloMsg({ td: "calm", value: 0 });   // 活动回归：撤掉减速
  if (calm !== lastCalm) lastCalm = calm;
  syncPanel();
  pushRing();            // 圆环几何独立于活动状态：配置一变就推给光环（内部按 key 去重）
  if (!idle) pushParams();
  energy *= 0.995;
  try {
    const s = await (await fetch("/state")).json();
    rate = s.rate; byType = s.byType; bySource = s.bySource; sources = s.sources || [];
    series = TDLogic.normalizeSeries(s.series, 60);
    tools = s.tools || [];
    tokens = s.tokens || {};
    agentSeries = s.agentSeries || {};
    totalEvents = s.totalEvents || 0;
    if (s.ui) UI = s.ui;
    if (s.view) view = s.view;
    agentsList = s.agents || [];
    if (s.shot) captureShot();
    if (s.testPopup && !PANEL_ONLY) {
      const now2 = Date.now();
      if (now2 - lastTestPopup > 6000) {
        lastTestPopup = now2;
        try {
          window.webkit?.messageHandlers?.popup?.postMessage("show");
          // 自检：show 之后让宿主进入 3 秒倒计时（走真实收起链路），而不是直接 hide
          setTimeout(() => { try { window.webkit?.messageHandlers?.popup?.postMessage("countdown"); } catch {} }, 700);
        } catch {}
      }
    }
    if (s.testClick) {
      const now = Date.now();
      if (now - lastTestClick > 2000) {
        lastTestClick = now;
        try { halo.contentWindow.__tdSelfTestClick?.(); } catch {}
      }
    }
    sendSourceLights();
    const __p0 = performance.now();
    renderPanel();
    panelMs = panelMs ? panelMs * 0.8 + (performance.now() - __p0) * 0.2 : (performance.now() - __p0);
    let haloState = {};
    try {
      const w = halo.contentWindow;
      haloState = {
        haloText: (w.__tdText || []).length,
        ringText: !!w.__tdRingText,
        haloRaf: !!w.__tdRafOn,
        haloTextId: w.__tdTextId || 0,
        haloBuild: w.__tdHaloBuild || null,
        haloGeom: (() => { try { return w.__tdGeomGet ? w.__tdGeomGet() : null; } catch (e) { return null; } })(),
      };
    } catch (err) { haloState = { haloError: String((err && err.message) || err) }; }
    fetch("/debug", {
      method: "POST",
      body: JSON.stringify({
        client: TD_CLIENT,
        idle, standby, workAt, busyUntil, energy: +energy.toFixed(3), overRing, haloError,
        idleFor: Math.round((Date.now() - workAt) / 1000),
        busyIn: busyUntil ? Math.round((busyUntil - Date.now()) / 1000) : 0,
        hold: WINDDOWN(),
        winddownSec: UI.winddownSec,
        calm: +calm.toFixed(3),
        textPushes,
        lights: TDLogic.activeSources(sources, UI.lightsWindowSec * 1000).map((x) => x.source),
        seriesPeak: Math.max(0, ...series),
        tools: tools.slice(0, 3).map((t) => t.name),
        agentsShown: (agentsList || []).filter((a) => a.enabled !== false).length,
        panelShown: panel.classList.contains("show"),
        panelRect: [panel.offsetWidth, panel.offsetHeight],
        lineW: (textpane.querySelector(".tp-line") || {}).offsetWidth || 0,
        rowW: (pnAgents.querySelector(".ag") || {}).offsetWidth || 0,
        sparkRect: [spark.offsetWidth, spark.offsetHeight],
        panelShotInfo: window.__panelShotInfo || null,
        panelMs: Math.round(panelMs * 100) / 100,
        build: PAGE_BUILD,
        ...haloState,
      }),
    }).catch(() => {});
  } catch {}
  if (DEBUG) {
    hud.style.opacity = 1;
    if (Date.now() - stateTimer > 500) {
      stateTimer = Date.now();
      hud.innerHTML =
        `<b>Thinking Desktop</b> · ${idle ? "待机 · 圆环停止" : "思考中"} · 速率 <b>${rate}</b> 事件/s` +
        `<br>来源: ${Object.entries(bySource).map(([k, v]) => `${k}×${v}`).join(" ") || "—"}` +
        `<br>类型: ${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(" ") || "—"}` +
        `<br>最近事件: ${sources.map((x) => `${x.source} ${fmtAgo(x.agoMs)}`).join(" · ") || "—"}` +
        `<br><span style="opacity:.7">悬停圆带 → 打开右侧看板</span>`;
    }
  }
}, 1000);

// 面板尺寸变化时重绘曲线
addEventListener("resize", () => { renderPanel(); });
