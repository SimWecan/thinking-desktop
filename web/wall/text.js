/**
 * wall/text.js — 思考文本墙：截流文本缓冲 + 上环扁平化 + 右侧滚动区渲染
 * 依赖（运行时共享）：TDLogic、haloMsg、syncPanel、agentsList、UI
 */
"use strict";
const SOURCE_COLORS = {
  "deepseek-harness": "#1E3A8A",  // 深蓝
  "kimi-desktop": "#FFFFFF",      // 白
  "gemini-desktop": "#7C6BF2",    // 蓝紫
  "chatgpt-desktop": "#8B5CF6",   // 紫
  "codex": "#8B5CF6",             // 紫
  "claude-desktop": "#D97757",
  "anthropic": "#D97757",
};
const SRC_LABEL = {
  "deepseek-harness": "DSH",
  "kimi-desktop": "Kimi",
  codex: "Codex",
  "gemini-desktop": "Gemini",
  "chatgpt-desktop": "GPT",
  "claude-desktop": "Claude",
  "anthropic": "ClaudeCode",
  tail: "LOG",
};

/** 思考日志上墙：raw 保留换行，环带用扁平版；stream=true 的快照会原地替换而不是叠行 */
let textPushes = 0;
function pushText(text, source, kind, stream) {
  textPushes++;
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (raw.length < 2) return;
  const last = textLines[textLines.length - 1];
  const grow = stream && last && last.key === source &&
    (raw.startsWith(last.text) || last.text.startsWith(raw));
  if (grow) {
    if (raw.length >= last.text.length) last.text = raw.slice(0, 6000);
  } else {
    const id = ++textSeq;
    textLines.push({ id, src: SRC_LABEL[source] ?? (source || ""), key: source, kind, text: raw.slice(0, 6000) });
    if (textLines.length > 60) textLines.shift();
  }
  lastTextAt = Date.now();
  const flat = UI.ringText === "headline"
    ? TDLogic.headline(raw, UI.ringChars)
    : raw.replace(/\s+/g, " ").slice(0, 220);
  if (grow) {
    last.id = ++textSeq;
    haloMsg({ td: "text", id: last.id, text: flat, replace: true });
  } else {
    haloMsg({ td: "text", id: textLines[textLines.length - 1].id, text: flat });
  }
  renderText();
  syncPanel();
}

function renderText() {
  textpane.querySelectorAll(".tp-line").forEach((n) => n.remove());
  const frag = document.createDocumentFragment();
  const recent = textLines.slice(-20);
  recent.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "tp-line" + (i < recent.length - 2 ? " dim" : "");
    const tag = document.createElement("span");
    tag.className = "tp-src";
    tag.textContent = line.src;
    tag.style.color = colorOf(line.key);
    div.appendChild(tag);
    div.appendChild(document.createTextNode(line.text));
    frag.appendChild(div);
  });
  textpane.appendChild(frag);
}

function resendText() {
  textLines.slice(-8).forEach((line) => {
    const text = UI.ringText === "headline"
      ? TDLogic.headline(line.text, UI.ringChars)
      : line.text.replace(/\s+/g, " ").slice(0, 220);
    haloMsg({ td: "text", id: line.id, text });
  });
}
