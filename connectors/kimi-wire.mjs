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
 * 尾随起点为文件末尾，只展示接入后的新活动；会话切换（出现更新的 wire.jsonl）
 * 时自动跟随新文件。
 */

import { existsSync, openSync, readSync, closeSync, readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { Connector } from "./base.mjs";

export class KimiWireConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.dir  sessions 根目录（其下为 <workspace>/conv-xxxx/agents/main/wire.jsonl）
   * @param {string} [opts.source]
   * @param {number} [opts.minTextIntervalMs] 截流文本上墙的最小间隔（防刷屏）
   * @param {number} [opts.rescanMs] 新会话文件扫描间隔
   */
  constructor({ dir, source = "kimi-desktop", minTextIntervalMs = 600, rescanMs = 20000 }) {
    super(source, "session");
    this.dir = dir;
    this.minTextIntervalMs = minTextIntervalMs;
    this.rescanMs = rescanMs;
    this._file = null;      // 当前尾随文件
    this._offset = 0;
    this._watcher = null;
    this._lastTextAt = 0;
  }

  start() {
    if (!existsSync(this.dir)) {
      console.warn(`[${this.source}] sessions dir not found, waiting: ${this.dir}`);
    }
    this._scan();
    this._timer = setInterval(() => this._scan(), this.rescanMs);
    console.log(`[${this.source}] wire tailing ${this._file ?? "(waiting for session)"}`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._watcher) { try { this._watcher.close(); } catch { /* 已关闭 */ } }
    this._watcher = null;
  }

  /** 找到最近修改的 wire.jsonl；变化时切换尾随对象 */
  _scan() {
    let newest = null, newestMtime = 0;
    try {
      for (const ws of readdirSync(this.dir)) {
        const wsDir = join(this.dir, ws);
        for (const entry of readdirSync(wsDir)) {
          if (!entry.startsWith("conv-")) continue;
          const f = join(wsDir, entry, "agents", "main", "wire.jsonl");
          if (!existsSync(f)) continue;
          const mtime = statSync(f).mtimeMs;
          if (mtime > newestMtime) { newestMtime = mtime; newest = f; }
        }
      }
    } catch { /* 目录读取失败下次再试 */ }

    if (!newest || newest === this._file) return;
    this._file = newest;
    try { this._offset = statSync(newest).size; } catch { this._offset = 0; } // 只截新活动
    if (this._watcher) this._watcher.close();
    try {
      this._watcher = watch(newest, { persistent: false }, () => this._drain());
    } catch { /* 文件写入中短暂不可读，忽略 */ }
    console.log(`[${this.source}] now tailing ${newest}`);
  }

  _drain() {
    if (!this._file) return;
    let fd;
    try {
      fd = openSync(this._file, "r");
      const size = statSync(this._file).size;
      if (size < this._offset) this._offset = 0; // 文件被截断/轮换
      if (size === this._offset) return;
      const buf = Buffer.alloc(size - this._offset);
      readSync(fd, buf, 0, buf.length, this._offset);
      this._offset = size;
      for (const line of buf.toString("utf8").split("\n")) this._handleLine(line);
    } catch { /* 忽略瞬时读取错误 */ }
    finally { if (fd !== undefined) closeSync(fd); }
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
