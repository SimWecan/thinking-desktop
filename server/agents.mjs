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

/** 从连接器数组收集「进程是否在运行」状态（仅进程类连接器暴露 running；其余来源为 null=未知） */
export function collectPresence(connectors) {
  const out = {};
  for (const c of connectors || []) {
    if (c.running !== undefined && c.running !== null) out[c.source] = c.running;
  }
  return out;
}

export class AgentRegistry {
  constructor(root) {
    this.file = join(root, "config", "agents.json");
    this.view = "all";
    this.bindings = {};
    this.connectedSources = null;   // 组合根注入后非空
    try {
      this.bindings = JSON.parse(readFileSync(this.file, "utf8"));
    } catch { /* 首次运行 */ }
  }

  /** 绑定/解绑/改色/改名/自定义图标 */
  update(source, { enabled, color, name, path, iconFile, anim } = {}, presence = null) {
    const cur = this.bindings[source] ?? {};
    if (enabled !== undefined) cur.enabled = !!enabled;
    if (color) cur.color = color;
    if (name) cur.name = String(name).slice(0, 60);
    if (iconFile !== undefined) {
      if (iconFile) cur.iconFile = String(iconFile).slice(0, 200);
      else delete cur.iconFile;
    }
    if (anim) cur.anim = String(anim).slice(0, 20);
    // 自定义客户端路径：空字符串 = 恢复自动探测
    if (typeof path === "string") {
      const p = path.trim();
      if (p) cur.path = p.slice(0, 400); else delete cur.path;
    }
    this.bindings[source] = cur;
    this._save();
    return this.agents(undefined, Date.now(), presence);
  }

  /**
   * 新增一个自定义客户端（下拉框里的「自定义」或用户自己命名的厂商）
   * @returns {string} 生成的 source id
   */
  createCustom({ name, color, path } = {}) {
    const label = String(name || "自定义客户端").trim().slice(0, 40) || "自定义客户端";
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    let id = `custom-${slug || Date.now().toString(36)}`;
    let n = 2;
    while (this.bindings[id]) id = `custom-${slug || "x"}-${n++}`;
    this.bindings[id] = {
      enabled: true,
      custom: true,
      name: label,
      color: color || "#8B5CF6",
      path: String(path || "").slice(0, 400),
      anim: "pulse",
    };
    this._save();
    return id;
  }

  /** 删除自定义客户端 */
  removeCustom(source) {
    const b = this.bindings[source];
    if (!b || !b.custom) return false;
    delete this.bindings[source];
    if (this.view === source) this.view = "all";
    this._save();
    return true;
  }

  /** 组合根注入：有连接器接入的来源集合（没有的来源在 UI 标注「未接入」） */
  setConnectedSources(list) { this.connectedSources = new Set(list); }

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
   * @param {Object<string,boolean>} [presence] 进程运行状态（collectPresence 的产物）
   * @param {(source:string, now?:number) => boolean} [isBusy] 回合/工具是否仍在进行（store.isBusy）
   */
  agents(sourceStats, now = Date.now(), presence = null, isBusy = null) {
    const installed = detectInstalled();
    const busyOf = (source) => {
      if (typeof isBusy !== "function") return false;
      try { return !!isBusy(source, now); } catch { return false; }
    };
    return Object.entries(VENDOR_PRESETS).map(([source, p]) => {
      const b = this.bindings[source] ?? {};
      const st = sourceStats?.get(source);
      const lastReal = st?.lastWorkAt || 0;   // 只看真实工作事件，避免 turn/start 这类 status 把状态打回空闲
      const busy = busyOf(source);
      return {
        source,
        name: b.name ?? p.name,
        short: p.short,
        icon: b.icon ?? p.icon ?? source,   // 同商标的厂商（ChatGPT/Codex）合并显示为一个图标
        color: b.color ?? p.color,
        anim: p.anim,
        installed: !!installed[source],
        // 未接线时（单元测试等）视为已接入，避免误标
        connected: this.connectedSources ? this.connectedSources.has(source) : true,
        running: presence?.[source] ?? null,   // null=无进程探测器或尚未探测
        enabled: b.enabled === undefined ? !!installed[source] : !!b.enabled, // 默认绑定已安装的
        // 回合/工具未结束也算思考中：长构建期间没有新会话行，只按 20s 事件窗口会误判成空闲
        thinking: now - lastReal < 20000 || busy,
        busy,
        events: st?.events ?? 0,
        agoMs: st ? now - st.lastEventAt : null,
        path: b.path ?? "",   // 控制台里可覆盖默认探测路径（重启服务生效）
        iconFile: b.iconFile ?? null,
        iconUrl: b.iconFile ? `/icon/custom/${encodeURIComponent(b.iconFile)}` : null,
        custom: false,
      };
    }).concat(Object.entries(this.bindings)
      .filter(([src, b]) => b.custom && !VENDOR_PRESETS[src])
      .map(([source, b]) => {
        const st = sourceStats?.get(source);
        const lastReal = st?.lastWorkAt || 0;
        const busy = busyOf(source);
        return {
          source,
          name: b.name || source,
          short: (b.name || "AI").slice(0, 2).toUpperCase(),
          icon: source,
          color: b.color || "#8B5CF6",
          anim: b.anim || "pulse",
          installed: true,
          connected: this.connectedSources ? this.connectedSources.has(source) : false,
          running: presence?.[source] ?? null,
          enabled: b.enabled !== false,
          thinking: now - lastReal < 20000 || busy,
          busy,
          events: st?.events ?? 0,
          agoMs: st ? now - st.lastEventAt : null,
          path: b.path || "",
          iconFile: b.iconFile ?? null,
          iconUrl: b.iconFile ? `/icon/custom/${encodeURIComponent(b.iconFile)}` : null,
          custom: true,
        };
      }));
  }
}
