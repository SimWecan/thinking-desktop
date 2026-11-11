/**
 * wall/panel.js — 右侧看板：速率曲线 / agent 行 / 工具分布 / 上下文计量 / 迷你仪表
 * 依赖（运行时共享）：TDPanel、TDLogic、rate/series/view/agentsList/tools/tokens/
 * agentSeries/totalEvents/sources（main.js）、colorOf（text.js）、
 * PANEL_ONLY/HOST_POPUP/TD_CLIENT/halo（main.js）、store.flags（经 /state）
 */
"use strict";
const hud = document.getElementById("hud");
const panel = document.getElementById("panel");
const mini = document.getElementById("mini");
const textpane = document.getElementById("textpane");
const pnRate = document.getElementById("pn-rate");
const pnView = document.getElementById("pn-view");
const pnAgents = document.getElementById("pn-agents");
const pnTools = document.getElementById("pn-tools");
const pnCtx = document.getElementById("pn-ctx");
const miniRate = document.getElementById("mini-rate");
const miniDots = document.getElementById("mini-dots");
const spark = document.getElementById("pn-spark");
const miniSpark = document.getElementById("mini-spark");
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

/** 把右侧看板（DOM）渲染成图片：外框 + canvas 图表一起，用于没有录屏权限的自检 */
async function panelShot() {
  // hostpopup 模式下页内看板是隐藏的：截图时临时显示，截完还原
  const forced = !panel.classList.contains("show");
  if (forced) panel.classList.add("show");
  try {
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const clone = panel.cloneNode(true);
    const srcCanvases = panel.querySelectorAll("canvas");
    const dstCanvases = clone.querySelectorAll("canvas");
    for (let i = 0; i < srcCanvases.length; i++) {
      const img = document.createElement("img");
      img.setAttribute("src", srcCanvases[i].toDataURL("image/png"));
      img.setAttribute("width", String(srcCanvases[i].clientWidth));
      img.setAttribute("height", String(srcCanvases[i].clientHeight));
      img.setAttribute("style", `display:block;width:${srcCanvases[i].clientWidth}px;height:${srcCanvases[i].clientHeight}px`);
      dstCanvases[i].replaceWith(img);
    }
    clone.style.width = "100%";
    clone.style.boxSizing = "border-box";
    clone.style.position = "static";
    clone.style.transform = "none";
    clone.style.opacity = "1";
    clone.style.maxHeight = "none";
    clone.classList.add("show");
    const css = Array.from(document.querySelectorAll("style")).map((n) => n.textContent).join("\n");
    const html = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">` +
      `<foreignObject x="0" y="0" width="${rect.width}" height="${rect.height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;box-sizing:border-box"><style>${css}</style>${html}</div>` +
      `</foreignObject></svg>`;
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("svg render failed"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    const cv = document.createElement("canvas");
    cv.width = Math.round(rect.width * 2);
    cv.height = Math.round(rect.height * 2);
    const cx = cv.getContext("2d");
    // 垫一层深色底，模拟壁纸上的实际观感（面板本身是半透明的）
    cx.fillStyle = "#0a0c11";
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    window.__panelShotInfo = { rect: [Math.round(rect.width), Math.round(rect.height)], out: [cv.width, cv.height] };
    return cv.toDataURL("image/png");
  } catch (e) {
    return null;
  } finally {
    if (forced) panel.classList.remove("show");
  }
}
/** 自检截图 */
let lastShotAt = 0, lastTestClick = 0, lastTestPopup = 0;
let panelMs = 0;   // 看板渲染耗时（EMA，毫秒）
async function captureShot(full) {
  if (Date.now() - lastShotAt < 1500) return;
  lastShotAt = Date.now();
  // 弹窗页没有光环，只负责把看板截给 /snapshot
  if (PANEL_ONLY) {
    const only = await panelShot();
    if (only) fetch("/snapshot", { method: "POST", body: JSON.stringify({ client: TD_CLIENT, panel: only }) }).catch(() => {});
    return;
  }
  try {
    const w = halo.contentWindow;
    // ?full=1 的自检/宣传图：临时把光环截图切到 1:1，截完恢复半分辨率
    try { w.__tdSetShotScale && w.__tdSetShotScale(full ? 1 : 0.5); } catch (e) {}
    const png = w.__tdSnapshot && w.__tdSnapshot();
    const slot = w.__tdSlotShot && w.__tdSlotShot();
    const lights = w.__tdLightsShot && w.__tdLightsShot();
    const ripple = w.__tdRippleShot && w.__tdRippleShot();
    const chart = spark && spark.toDataURL ? spark.toDataURL("image/png") : null;
    const panelPng = HOST_POPUP ? null : await panelShot();   // 壁纸页不画看板，别用空图覆盖弹窗页的截图
    if (png) fetch("/snapshot", { method: "POST", body: JSON.stringify({ client: TD_CLIENT, png, slot, lights, chart, panel: panelPng, ripple }) }).catch(() => {});
  } catch (err) {
    haloError = String((err && err.message) || err);
  }
}

