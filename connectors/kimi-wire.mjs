/**
 * Kimi 桌面端真实文本截流连接器。
 *
 * Kimi Desktop 会把每个会话的完整事件流（用户消息、助手输出、工具调用、
 * 上下文压缩/文本截流）以 JSONL 形式落盘到 sessions/<workspace>/conv-xxxx/agents/main/wire.jsonl。
 * 本连接器尾随「最近活跃」的 wire.jsonl，把真实事件归一化为统一事件协议：
 *
 *   context.apply_compaction        → text（⟲ 截流摘要，即真实文本截流上墙）
 *   agent.message.appended          → text（用户 › / 助手输出；Kimi 3.x 的真实落盘格式）
 *   context.append_message          → text（旧版本格式，保留兼容）
 *   context.append_loop_event       → text（think/text 片段）/ tool_call / tool_result
 *
 * 与 dsh 的 zstd-jsonl 连接器同理：只读取本机已落盘内容，不触碰网络与凭证。
 * 尾随起点为文件末尾，只展示接入后的新活动。
 * 同时跟踪**多个活跃会话**（Kimi 并行跑多个 agent 时，每个 conv 都有自己的 wire.jsonl），
 * 不再只跟「最新那一个」。
 */

import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Connector } from "./base.mjs";

export class KimiWireConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.dir  sessions 根目录（其下为 <workspace>/conv-xxxx/agents/main/wire.jsonl）
   * @param {string} [opts.source]
   * @param {number} [opts.minTextIntervalMs] 截流文本上墙的最小间隔（防刷屏）
   * @param {number} [opts.rescanMs] 活跃会话扫描间隔
   * @param {number} [opts.activeWindowMs] 只跟踪这么久内写过的会话，默认 15 分钟
   * @param {number} [opts.drainMs] 增量读取轮询间隔，默认 1000
   */
  constructor({ dir, source = "kimi-desktop", minTextIntervalMs = 600, rescanMs = 20000, activeWindowMs = 15 * 60_000, drainMs = 1000 }) {
    super(source, "session");
    this.dir = dir;
    this.minTextIntervalMs = minTextIntervalMs;
    this.rescanMs = rescanMs;
    this.activeWindowMs = activeWindowMs;
    this.drainMs = drainMs;
    /** @type {Map<string, {offset:number, mtimeMs:number}>} */
    this._files = new Map();
    this._lastTextAt = 0;
  }

  start() {
    if (!existsSync(this.dir)) {
      console.warn(`[${this.source}] sessions dir not found, waiting: ${this.dir}`);
    }
    this._scan();
    this._timer = setInterval(() => this._scan(), this.rescanMs);
    this._drainTimer = setInterval(() => this._drain(), this.drainMs);
    console.log(`[${this.source}] wire tailing ${this._files.size} session(s)`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._drainTimer) clearInterval(this._drainTimer);
    this._timer = null;
    this._drainTimer = null;
    this._files.clear();
  }

  /** 扫描所有窗口期内活跃的 wire.jsonl（并行 agent 各有自己的会话目录） */
  _scan() {
    const now = Date.now();
    const found = new Set();
    try {
      for (const ws of readdirSync(this.dir)) {
        const wsDir = join(this.dir, ws);
        for (const entry of readdirSync(wsDir)) {
          if (!entry.startsWith("conv-")) continue;
          const f = join(wsDir, entry, "agents", "main", "wire.jsonl");
          if (!existsSync(f)) continue;
          let st;
          try { st = statSync(f); } catch { continue; }
          if (now - st.mtimeMs > this.activeWindowMs) continue;
          found.add(f);
          if (!this._files.has(f)) this._files.set(f, { offset: st.size, mtimeMs: st.mtimeMs }); // 只截新活动
        }
      }
    } catch { /* 目录读取失败下次再试 */ }

    for (const f of [...this._files.keys()]) if (!found.has(f)) this._files.delete(f);
    if (this._files.size) console.log(`[${this.source}] tailing ${this._files.size} active session(s)`);
  }

  /** 增量读取所有被跟踪的会话文件 */
  _drain() {
    for (const [file, state] of this._files) {
      let fd;
      try {
        fd = openSync(file, "r");
        const size = statSync(file).size;
        if (size < state.offset) state.offset = 0;      // 文件被截断/轮换
        if (size === state.offset) continue;
        const buf = Buffer.alloc(size - state.offset);
        readSync(fd, buf, 0, buf.length, state.offset);
        state.offset = size;
        for (const line of buf.toString("utf8").split("\n")) this._handleLine(line);
      } catch { /* 忽略瞬时读取错误 */ }
      finally { if (fd !== undefined) closeSync(fd); }
    }
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let obj;
    try { obj = JSON.parse(line); } catch { return; } // 写入中的半行，跳过

    switch (obj?.type) {
      case "context.apply_compaction": {
        // 真实文本截流事件：压缩点摘要直接上墙
        const s = this._clean(obj.summary ?? obj.note ?? "");
        if (s) this._emitText(`⟲ 截流 ⇄ ${s}`, { kind: "note", force: true });
        break;
      }
      case "agent.message.appended": {
        // Kimi 3.x 实际落盘：message.message.role = user / assistant / tool
        const msg = obj.message?.message;
        const role = msg?.role;
        if (role !== "user" && role !== "assistant") break; // tool 结果由 tool.result 事件覆盖
        const text = this._contentText(msg?.content);
        if (!text) break;
        this._emitText(role === "user" ? `› ${text}` : text, { kind: role === "user" ? "user" : "output" });
        break;
      }
      case "context.append_message": {
        const role = obj.message?.role;
        const text = this._contentText(obj.message?.content);
        if (!text) break;
        if (role === "user") this._emitText(`› ${text}`, { kind: "user" });
        else if (role === "assistant") this._emitText(text, { kind: "output" });
        break;
      }
      case "context.append_loop_event": {
        const ev = obj.event;
        if (ev?.type === "content.part") {
          const part = ev.part;
          if (part?.type === "think" && part.think) this._emitText(part.think, { kind: "think", stream: true });
          else if (part?.type === "text" && part.text) this._emitText(part.text, { kind: "output", stream: true });
        } else if (ev?.type === "tool.call") {
          this.emit({ type: "tool_call", payload: { name: ev.name } });
        } else if (ev?.type === "tool.result") {
          this.emit({ type: "tool_result", payload: { name: ev.name } });
        }
        break;
      }
      default:
        break; // llm.request / usage.record 等心跳与计量行忽略
    }
  }

  _contentText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return null;
    return content.map((c) => c?.text).filter(Boolean).join(" ") || null;
  }

  _clean(raw) {
    const s = String(raw ?? "").replace(/\s+/g, " ").trim();
    return s.length > 4000 ? `${s.slice(0, 4000)} …` : s;
  }

  /**
   * @param {string} raw
   * @param {{kind?: "think"|"output"|"user"|"note", stream?: boolean, force?: boolean}} [opt]
   */
  _emitText(raw, { kind = "output", stream = false, force = false } = {}) {
    const now = Date.now();
    if (!force && now - this._lastTextAt < this.minTextIntervalMs) return;
    const text = this._clean(raw);
    if (text.length < 2) return;
    this._lastTextAt = now;
    this.emit({ type: "text", payload: { text, kind, ...(stream ? { stream: true } : {}) } });
  }
}
