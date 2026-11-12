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
const PAGE_BUILD = "wall-4";   // 自检用：确认壁纸加载的是新页面
let UI = { ringText: "headline", panel: "hover", winddownSec: 30, lightsWindowSec: 12, ringChars: 90 };  // 来自 /state.ui
const WINDDOWN = () => UI.winddownSec * 1000;   // 静默过渡窗口：窗口内环带逐渐减速到停止

// 宿主在鼠标离开环带后驱动 3 秒倒计时；这里把它画在弹窗底部
const HOVER_HIDE_SEC = 2.0;   // 与宿主 hoverCountdownEnd 保持一致
window.__tdHoverCountdown = function (sec) {
  const el = document.getElementById("pnCountdown");
  if (!el) return;
  const left = Number(sec) || 0;
  if (left <= 0) { el.classList.remove("on"); return; }
  el.classList.add("on");
  const bar = el.querySelector("i"), txt = el.querySelector("span");
  if (bar) bar.style.width = Math.max(0, Math.min(100, (left / HOVER_HIDE_SEC) * 100)).toFixed(0) + "%";
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
let lastIdle = null;   // 上一拍的待机态：只在翻转时写日志，避免刷屏
let lastParamPush = 0, stateTimer = 0;

/** agent 配置色（调色盘选择）优先于内置色 */
function colorOf(source) {
  const a = agentsList.find((x) => x.source === source);
  return (a && a.color) || SOURCE_COLORS[source] || "rgba(255,255,255,.55)";
}

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

/** 关键状态翻转写一行服务端日志（logs/wall-events.log）：事后能区分「正常待机」和「帧链卡死」 */
function reportEvent(event, extra) {
  fetch("/debug", {
    method: "POST",
    body: JSON.stringify({ client: TD_CLIENT, event, at: Date.now(), ...extra }),
  }).catch(() => {});
}

// 悬停：原生宿主转发全局鼠标位置 → 光环只判断「是否停在环带上」
// 原生宿主做环带命中判定时，会 evaluateJavaScript("window.__tdGeomGet()")；
// 这个函数定义在 halo iframe 里（td-bridge.js），壁纸页必须代理出来，
// 否则宿主拿不到几何、命中判定退化成「永远在环上」→ 弹窗表现异常。
window.__tdGeomGet = () => {
  try { return halo.contentWindow?.__tdGeomGet ? halo.contentWindow.__tdGeomGet() : null; } catch { return null; }
};

// 宿主读到闭源端 AX 文本后通过这个钩子交给页面，由页面带着 Cookie/令牌注入 /ingest
window.__tdAxText = (source, text) => {
  const t = String(text || "").trim();
  if (!t || t.length < 8) return;
  fetch("/ingest", {
    method: "POST",
    body: JSON.stringify({ source, type: "text", payload: { text: t.slice(0, 1200), kind: "ax" } }),
  }).catch(() => {});
};

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
  // 让宿主立刻刷新命中几何，避免拖完环带后要等 3s 才能正常悬停
  try { window.webkit?.messageHandlers?.geom?.postMessage("ring"); } catch (e) {}
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
  if (ev.data && ev.data.td === "stall") { reportEvent("halo-stall", { silentMs: ev.data.silentFor }); return; }
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
  // 有来源的回合/工具还没结束 → 就是在工作，不能按「多久没新事件」停环。
  // （长构建/长思考期间会话文件不追加新行，旧口径会在 30s 后把环冻住。）
  if (view === "all" && TDLogic.hasBusy && TDLogic.hasBusy(sources)) return 0;
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
  if (idle !== lastIdle) {
    lastIdle = idle;
    reportEvent(idle ? "standby-on" : "wake", {
      calm: +calm.toFixed(2),
      idleFor: Math.round((Date.now() - workAt) / 1000),
      busy: (sources || []).filter((x) => x.busy).map((x) => x.source),
    });
  }
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
    if (s.shot) captureShot(!!s.shotFull);
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
    const panelVisible = PANEL_ONLY || panel.classList.contains("show");
    const needPanel = panelVisible || !!s.shot;
    const __p0 = performance.now();
    if (needPanel) renderPanel();
    panelMs = panelMs ? panelMs * 0.8 + (performance.now() - __p0) * 0.2 : (performance.now() - __p0);
    let haloState = {};
    try {
      const w = halo.contentWindow;
      haloState = {
        haloText: (w.__tdText || []).length,
        fps: w.__tdLastFps ?? null,   // halo 采样窗实测帧率（与服务端 /health 的 perf.fps 对齐口径）
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
        panelRect: needPanel ? [panel.offsetWidth, panel.offsetHeight] : null,
        lineW: needPanel ? ((textpane.querySelector(".tp-line") || {}).offsetWidth || 0) : null,
        rowW: needPanel ? ((pnAgents.querySelector(".ag") || {}).offsetWidth || 0) : null,
        sparkRect: needPanel ? [spark.offsetWidth, spark.offsetHeight] : null,
        panelShotInfo: window.__panelShotInfo || null,
        panelMs: Math.round(panelMs * 100) / 100,
        axTrusted: !!window.__tdAxTrusted,
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
