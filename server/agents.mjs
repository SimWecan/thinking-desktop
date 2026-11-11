/**
 * 绑定的 AI 桌面端注册表：厂商预设、安装检测、颜色配置、视图选择。
 * 配置持久化到 config/agents.json；安装检测按平台路径探测。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library", "Application Support");

/** 厂商预设：默认色 + 托盘图标动画类型 */
export const VENDOR_PRESETS = {
  "deepseek-harness": { name: "DeepSeek Harness", short: "DS", color: "#1E3A8A", anim: "whale" },   // 深蓝
  "kimi-desktop":     { name: "Kimi",           short: "K",  color: "#FFFFFF", anim: "moon" },    // 白
  "gemini-desktop":   { name: "Gemini",         short: "G",  color: "#7C6BF2", anim: "spark4" }, // 蓝紫
  "chatgpt-desktop":  { name: "ChatGPT",        short: "C",  color: "#8B5CF6", anim: "knot" },   // 紫
  "claude-desktop":   { name: "Claude",         short: "Cl", color: "#D97757", anim: "asterisk" },
  "codex":            { name: "Codex",          short: "Cx", color: "#8B5CF6", anim: "term", icon: "chatgpt-desktop" },   // 紫；与 ChatGPT 共用商标
  "anthropic":        { name: "Claude Code",    short: "Cc", color: "#D97757", anim: "asterisk" },
};

/** 安装检测：任一存在即视为已安装（macOS 路径为主，Windows 在 win/ 文档里给出对应项） */
const DETECT = {
  "deepseek-harness": [
    () => join(HOME, ".dsh"),
    () => join(APP_SUPPORT, "@deepseek-ai", "dsh-desktop"),
  ],
  "kimi-desktop": [
    () => join(APP_SUPPORT, "kimi-desktop", "kimi-agent"),
    () => "/Applications/Kimi.app",
  ],
  "gemini-desktop": [
    () => join(APP_SUPPORT, "com.google.GeminiMacOS"),
    () => "/Applications/Gemini.app",
  ],
  "chatgpt-desktop": [
    () => join(APP_SUPPORT, "OpenAI"),
    () => "/Applications/ChatGPT.app",
  ],
  "claude-desktop": [
    () => join(APP_SUPPORT, "Claude"),
    () => "/Applications/Claude.app",
  ],
  "codex": [
    () => join(HOME, ".codex", "logs_2.sqlite"),
  ],
  "anthropic": [
    () => join(HOME, ".claude", "projects"),
  ],
};

export function detectInstalled() {
  const out = {};
  for (const [source, paths] of Object.entries(DETECT)) {
    out[source] = paths.some((p) => { try { return existsSync(p()); } catch { return false; } });
  }
  return out;
}

export class AgentRegistry {
  constructor(root) {
    this.file = join(root, "config", "agents.json");
    this.view = "all";
    this.bindings = {};
    try {
      this.bindings = JSON.parse(readFileSync(this.file, "utf8"));
    } catch { /* 首次运行 */ }
  }

  /** 绑定/解绑/改色/改名 */
  update(source, { enabled, color, name } = {}) {
    const cur = this.bindings[source] ?? {};
    if (enabled !== undefined) cur.enabled = !!enabled;
    if (color) cur.color = color;
    if (name) cur.name = name;
    this.bindings[source] = cur;
    this._save();
    return this.agents();
  }

  setView(agent) { this.view = agent || "all"; return this.view; }

  _save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.bindings, null, 2));
    } catch (err) { console.error("[agents] save failed:", err.message); }
  }

  /**
   * 全量列表：预设 + 安装 + 绑定 + 实时状态
   * @param {Map} sourceStats 服务端来源统计
   * @param {number} now
   */
  agents(sourceStats, now = Date.now()) {
    const installed = detectInstalled();
    return Object.entries(VENDOR_PRESETS).map(([source, p]) => {
      const b = this.bindings[source] ?? {};
      const st = sourceStats?.get(source);
      const lastReal = st?.lastWorkAt || 0;   // 只看真实工作事件，避免 turn/start 这类 status 把状态打回空闲
      return {
        source,
        name: b.name ?? p.name,
        short: p.short,
        icon: b.icon ?? p.icon ?? source,   // 同商标的厂商（ChatGPT/Codex）合并显示为一个图标
        color: b.color ?? p.color,
        anim: p.anim,
        installed: !!installed[source],
        enabled: b.enabled === undefined ? !!installed[source] : !!b.enabled, // 默认绑定已安装的
        thinking: now - lastReal < 20000,
        events: st?.events ?? 0,
        agoMs: st ? now - st.lastEventAt : null,
      };
    });
  }
}
