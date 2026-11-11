/**
 * tray/main.js — 托盘编排：形态切换 / 宿主高度上报 / 自检截图 / 1.5s 轮询
 * 依赖运行时：build（icons.js）
 */
"use strict";
const tray = document.getElementById("tray");
const composite = document.getElementById("composite");
const icons = new Map();
let expanded = new URLSearchParams(location.search).has("expanded");   // ?expanded=1 供浏览器预览/自检
let view = "all", agents = [];

async function select(agent) {
  view = agent;
  await fetch("/view", { method: "POST", body: JSON.stringify({ agent }) });
  build();
}

let reportTimer = 0;
function reportHeight() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const el = document.getElementById("tray");
    const h = Math.ceil(el.getBoundingClientRect().height) + 2;
    document.documentElement.style.height = h + "px";
    document.body.style.height = h + "px";
    const msg = { height: h };
    try { window.webkit?.messageHandlers?.tray?.postMessage(msg); } catch (e) {}      // macOS 宿主
    try { window.chrome?.webview?.postMessage(msg); } catch (e) {}                    // Windows 宿主
  }, 30);
}
addEventListener("resize", reportHeight);

composite.onclick = async () => {
  if (!expanded) { expanded = true; build(); return; }   // 单击综合按钮：展开侧栏
  await select("all");                                    // 已展开时再点：回到综合形态并收回
  expanded = false;
  build();
};
composite.oncontextmenu = (e) => { e.preventDefault(); expanded = !expanded; build(); };

/** 自检：把托盘渲染成 PNG（商标图先转成 data URL，foreignObject 才能渲染） */
async function shot() {
  try {
    const el = document.getElementById("tray");
    const hidden = Array.from(el.querySelectorAll(".icon.hidden"));
    hidden.forEach((n) => n.classList.remove("hidden"));
    const rect = el.getBoundingClientRect();
    hidden.forEach((n) => n.classList.add("hidden"));
    if (!rect.width || !rect.height) return null;

    const liveIcons = Array.from(el.querySelectorAll(".icon"));
    const liveColors = liveIcons.map((n) => getComputedStyle(n).color);
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".icon.hidden").forEach((n) => n.classList.remove("hidden"));   // 自检时全部展开
    clone.querySelectorAll(".icon").forEach((n, i) => { if (liveColors[i]) n.style.color = liveColors[i]; });

    // 图片转 data URL（SVG 图片渲染不允许外链）
    const liveImgs = Array.from(el.querySelectorAll("img"));
    const cloneImgs = Array.from(clone.querySelectorAll("img"));
    for (let i = 0; i < liveImgs.length; i++) {
      const src = liveImgs[i];
      try {
        const cv = document.createElement("canvas");
        cv.width = src.naturalWidth || 128;
        cv.height = src.naturalHeight || 128;
        cv.getContext("2d").drawImage(src, 0, 0);
        cloneImgs[i].src = cv.toDataURL("image/png");
      } catch { cloneImgs[i].remove(); }
    }

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
      img.onerror = () => rej(new Error("render failed"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    const cv = document.createElement("canvas");
    cv.width = Math.round(rect.width * 2);
    cv.height = Math.round(rect.height * 2);
    const x = cv.getContext("2d");
    x.fillStyle = "#0a0c11";
    x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  } catch (e) { return null; }
}

let lastShotOk = null, pollN = 0;
addEventListener("error", (e) => {
  fetch("/debug", { method: "POST", body: JSON.stringify({ client: "tray", pageError: String(e.message || e.error), src: (e.filename || "") + ":" + e.lineno }) }).catch(() => {});
});

async function poll() {
  try {
    const s = await (await fetch("/agents", { cache: "no-store" })).json();
    agents = s.agents;
    if (view !== s.view) view = s.view;
    build();
    if (s.shot) {
      const png = await shot();
      lastShotOk = !!png;
      if (png) fetch("/snapshot", { method: "POST", body: JSON.stringify({ tray: png }) }).catch(() => {});
    }
    // 动效自检遥测：getComputedStyle 会强制样式重算，降频到每 3 轮一次（轮询仍 1.5s）
    pollN++;
    const reportAnims = s.shot || pollN % 3 === 0;
    let anims = [], sheen = [], logoAnims = [], glyphAnims = [];
    if (reportAnims) {
      anims = Array.from(document.querySelectorAll(".icon.think .tilefx i"))
        .map((el) => getComputedStyle(el).animationName)
        .filter((n) => n && n !== "none");
      sheen = Array.from(document.querySelectorAll(".icon.think .tilefx .sheen"))
        .map((el) => getComputedStyle(el).animationName);
      // 自检：底层商标图必须静止；动态只发生在内容层（glyph SVG / tilefx 特效层）
      logoAnims = Array.from(document.querySelectorAll(".icon.think img.logo, .icon.think img.solo"))
        .map((el) => getComputedStyle(el).animationName)
        .filter((n) => n && n !== "none");
      glyphAnims = Array.from(document.querySelectorAll(".icon.think .glyph"))
        .map((el) => getComputedStyle(el).animationName)
        .filter((n) => n && n !== "none");
    }
    const motion = Array.from(icons.values()).map((el) => (el.className.match(/v-[a-z]+/) || [""])[0]);
    fetch("/debug", {
      method: "POST",
      body: JSON.stringify({ client: "tray", agents: agents.length, expanded, shot: !!s.shot, lastShotOk, anims, sheen, logoAnims, glyphAnims, motion }),
    }).catch(() => {});
  } catch (e) {
    lastShotOk = "poll-error";
    // 轮询异常必须可见：否则页面会静默停更（曾因 build() 抛错导致托盘遥测直接停摆）
    fetch("/debug", { method: "POST", body: JSON.stringify({ client: "tray", pageError: String((e && e.stack) || e) }) }).catch(() => {});
  }
}
poll();
setInterval(poll, 1500);
