/**
 * tray/icons.js — 托盘图标构建：厂商商标 + 内容层动效（鲸鱼腾跃/流星/四芒星闪烁…）
 * 商标底层图零改动：动态全部发生在内容层（glyph/tilefx）。依赖运行时：select（main.js）
 */
"use strict";
// 动效风格：商标底层图零改动——内容层（鲸鱼/星芒 SVG 或 tilefx 特效层）承担全部动态。
// DeepSeek 鲸鱼腾跃、Kimi 黑底流星、Gemini 四芒星闪烁、ChatGPT 线条流光、Claude 光晕呼吸、Codex 光标闪烁
const MOTION = {
  whale: "v-leap",
  moon: "v-meteor",
  spark4: "v-glimmer",
  knot: "v-flow",
  asterisk: "v-glow",
  term: "v-cursor",
};

/* 内容层 SVG：商标里「内容」图形的剪影层（不替换商标，叠在底层图之上做动态）。
   鲸鱼剪影对准 DeepSeek 商标中鲸鱼的位置；四芒星对准 Gemini 商标的星形。 */
const GLYPHS = {
  whale: `<svg class="glyph whale" viewBox="0 0 32 22" aria-hidden="true"><path fill="currentColor" d="M2 13c0-6 6-10 14-10 5 0 9 2 11 5l3-3c0 4-1 6-3 8l3 3-3 1c-2 2-5 3-8 3-8 0-14-3-14-7z"/><circle cx="9.5" cy="8.5" r="1.3" fill="rgba(10,12,16,.55)"/></svg>`,
  spark4: `<svg class="glyph star" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="M50 2 C56 36 64 44 98 50 C64 56 56 64 50 98 C44 64 36 56 2 50 C36 44 44 36 50 2 Z"/></svg>`,
};
const glyphFor = (anim) => GLYPHS[anim] || "";

/* 未使用：图标地址现在直接内联在 <img src>/srcset 里，保留备查
function SRC_NAME(source) {
  const a = agents.find((x) => x.source === source);
  return (a && a.name) || source;
}

function iconUrl(source, scale = 1) {
  return `/icon/${encodeURIComponent(source)}.png` + (scale > 1 ? "?x=2" : "");
}
*/

function build() {
  reportHeight();

  // 同一商标的厂商（ChatGPT / Codex）合并成一个图标，点击切到该商标的主来源
  const groups = new Map();
  for (const a of agents) {
    if (!a.enabled) continue;
    const key = a.icon || a.source;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  for (const key of [...icons.keys()]) {
    if (!groups.has(key)) { icons.get(key)?.remove(); icons.delete(key); }
  }

  for (const [key, list] of groups) {
    const primary = list.find((a) => a.source === key) || list[0];
    const thinking = list.some((a) => a.thinking);
    let el = icons.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "icon " + (MOTION[primary.anim] || "v-glow");
      el.dataset.src = key;
      el.innerHTML =
        `<div class="fx"><i class="aura"></i><i class="ring"></i>` +
        `<div class="orbit"><i></i><i class="b"></i></div><i class="ping"></i></div>` +
        `<span class="logoWrap">` +
        `<img class="logo" alt="" src="/icon/${key}.png" srcset="/icon/${key}@2x.png 2x" draggable="false">` +
        `<span class="tilefx"><i class="glow"></i><i class="scan"></i><i class="sheen"></i><i class="meteor"></i><i class="meteor"></i><i class="cursor"></i></span>` +
        `</span>` +
        glyphFor(primary.anim);   // 内容层挂在 .icon 下：鲸鱼跃出商标框时不被 logoWrap 裁掉
      // 没有本地商标图时才用中性字母牌（不伪造 logo）
      const img = el.querySelector("img");
      img.addEventListener("error", () => {
        img.remove();
        const mono = document.createElement("span");
        mono.className = "mono";
        mono.textContent = primary.short || key.slice(0, 2).toUpperCase();
        const wrap = el.querySelector(".logoWrap");
        if (wrap) wrap.insertBefore(mono, wrap.firstChild);
        else el.insertBefore(mono, el.firstChild);
      }, { once: true });
      el.onclick = async () => { await select(primary.source); expanded = false; build(); };
      tray.appendChild(el);
      icons.set(key, el);
    }
    el.style.setProperty("--c", primary.color);
    el.classList.toggle("think", thinking);
    el.classList.toggle("hidden", !expanded);
    el.classList.toggle("sel", list.some((a) => a.source === view));
    const names = list.map((a) => a.name || a.source).join(" / ");
    el.title = names + (thinking ? " · 思考中" : "") + (list.some((a) => a.source === view) ? " · 当前形态" : "");
  }

  const solo = view !== "all" ? agents.find((x) => x.source === view) : null;
  const soloIcon = solo ? (solo.icon || solo.source) : null;
  composite.classList.toggle("solo-mode", !!solo);
  composite.classList.toggle("sel", view === "all");
  if (solo) {
    composite.style.setProperty("--c", solo.color);
    composite.classList.toggle("think", !!solo.thinking);
    composite.title = `${solo.name || solo.source} · 当前形态（点击展开）`;
    const img = composite.querySelector(".solo");
    const mono = composite.querySelector(".solo-mono");
    mono.textContent = solo.short || soloIcon.slice(0, 2).toUpperCase();
    if (img.dataset.src !== soloIcon) {
      img.dataset.src = soloIcon;
      composite.classList.remove("no-icon");
      img.onerror = () => composite.classList.add("no-icon");
      img.src = `/icon/${soloIcon}.png`;
      img.srcset = `/icon/${soloIcon}@2x.png 2x`;
    }
  } else {
    composite.classList.remove("no-icon");
    composite.classList.toggle("think", agents.some((a) => a.enabled && a.thinking));
    composite.title = "综合形态 · 全部 agent";
  }
}

