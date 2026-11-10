/**
 * Zstd 压缩 JSONL 轮询连接器：面向 DeepSeek Harness (~/.dsh/sessions) 这类
 * 会话以 zstd 多帧追加写入的软件。轮询发现新行时整体解码并差量提取。
 * 依赖系统 zstd 命令（macOS: brew install zstd）。
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Connector } from "./base.mjs";

export class ZstdJsonlPollConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source   来源标识
   * @param {string} opts.dir      会话目录（其下 *.jsonl.zstd 中最新的被跟踪）
   * @param {number} [opts.intervalMs] 默认 2000
   * @param {(obj: any, raw: string) => ({ type: string, payload?: object })|null} [opts.summarize]
   */
  constructor({ source, dir, intervalMs = 2000, summarize }) {
    super(source);
    this.dir = dir;
    this.intervalMs = intervalMs;
    this.summarize = summarize ?? defaultSummarize;
    this._seen = 0; // 已消费行数
  }

  start() {
    if (!existsSync(this.dir)) {
      console.warn(`[${this.source}] dir not found: ${this.dir}`);
      return;
    }
    const f = this._latest();
    if (f) this._seen = this._countLines(f); // 只消费新追加内容
    setInterval(() => this._poll(), this.intervalMs);
    console.log(`[${this.source}] watching ${this.dir}`);
  }

  _latest() {
    try {
      // 支持两级目录：dir/<workspace>/session-*.jsonl.zstd
      const out = [];
      const walk = (d, depth) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          let st;
          try { st = statSync(p); } catch { continue; }
          if (st.isDirectory() && depth > 0) walk(p, depth - 1);
          else if (n.endsWith(".jsonl.zstd") && st.size > 0) out.push(p);
        }
      };
      walk(this.dir, 1);
      return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
    } catch { return null; }
  }

  _countLines(path) {
    return this._decode(path).length;
  }

  _decode(path) {
    try {
      const { status, stdout } = spawnSyncZstd(path);
      if (status !== 0) return [];
      return stdout.split("\n").filter(Boolean);
    } catch { return []; }
  }

  _poll() {
    const f = this._latest();
    if (!f) return;
    const lines = this._decode(f);
    const fresh = lines.slice(this._seen);
    this._seen = lines.length;
    for (const line of fresh.slice(-30)) {
      let obj = null;
      try { obj = JSON.parse(line); } catch { /* 半行/坏行 */ }
      const summary = this.summarize(obj, line);
      if (summary) this.emit(summary);
    }
  }
}

function spawnSyncZstd(path) {
  return spawnSync("zstd", ["-q", "-d", "-c", path], { maxBuffer: 64 * 1024 * 1024 });
}

/** 默认行摘要：按文本特征推断事件类型 */
export function defaultSummarize(obj, raw) {
  const text = raw.toLowerCase();
  let type = "thought";
  if (text.includes('"error"') || text.includes("exception")) type = "error";
  else if (text.includes("tool_use") || text.includes("tool_call")) type = "tool_call";
  const payload = { preview: raw.slice(0, 120) };
  if (obj && typeof obj === "object") payload.keys = Object.keys(obj).slice(0, 6);
  return { type, payload };
}
