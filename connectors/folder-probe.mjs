/**
 * 通用文件夹探针：给「没有专门连接器」的自定义客户端用。
 *
 * 控制台里给自定义客户端选一个文件夹后，这里轮询该文件夹（深度 ≤2）里最近修改的
 * *.jsonl / *.log / *.txt，增量读取新行并映射成 text / tool_call 事件。
 * 只是「尽力而为」的通用通道：解析不了的行按纯文本处理。
 */

import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { Connector } from "./base.mjs";

const EXTS = new Set([".jsonl", ".ndjson", ".log", ".txt"]);
const MAX_READ = 256 * 1024;

/** 单行 → 事件（纯函数，可单测） */
export function mapProbeLine(line) {
  const raw = String(line || "").trim();
  if (raw.length < 4) return null;
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw);
      if (o && (o.tool || o.type === "tool_call" || o.tool_name)) {
        return { type: "tool_call", payload: { name: String(o.tool || o.tool_name || o.name || "tool").slice(0, 40) } };
      }
      const t = o.text ?? o.delta ?? o.content ?? o.message?.content ?? o.response;
      if (typeof t === "string" && t.trim().length >= 2) {
        return { type: "text", payload: { text: t.trim().slice(0, 4000), kind: "probe" } };
      }
      return null;
    } catch { /* 不是合法 JSON，按纯文本处理 */ }
  }
  return { type: "text", payload: { text: raw.slice(0, 4000), kind: "probe" } };
}

export class FolderProbeConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source 客户端来源 id
   * @param {string} opts.dir    监听文件夹
   * @param {number} [opts.intervalMs] 轮询间隔，默认 3000
   * @param {number} [opts.activeMs]   只看这么久内修改过的文件，默认 30 分钟
   */
  constructor({ source, dir, intervalMs = 3000, activeMs = 30 * 60_000 }) {
    super(source, "folder");
    this.dir = dir;
    this.intervalMs = intervalMs;
    this.activeMs = activeMs;
    this._offsets = new Map();
    this._timer = null;
  }

  start() {
    if (!this.dir) return;
    console.log(`[${this.source}] probing folder ${this.dir}`);
    this._timer = setInterval(() => this._poll(), this.intervalMs);
    this._timer.unref?.();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _newestFiles() {
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 2) return;
      let names = [];
      try { names = readdirSync(dir); } catch { return; }
      for (const n of names) {
        if (n.startsWith(".")) continue;
        const p = join(dir, n);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, depth + 1);
        else if (EXTS.has(extname(n).toLowerCase()) && Date.now() - st.mtimeMs < this.activeMs) {
          out.push({ path: p, size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    walk(this.dir, 0);
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 3);
  }

  _poll() {
    for (const f of this._newestFiles()) {
      const prev = this._offsets.get(f.path);
      if (prev === undefined) { this._offsets.set(f.path, f.size); continue; }   // 首次只登记，不回放历史
      if (f.size <= prev) { this._offsets.set(f.path, f.size); continue; }
      const len = Math.min(f.size - prev, MAX_READ);
      let buf;
      try {
        const fd = openSync(f.path, "r");
        buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, Math.max(prev, f.size - MAX_READ));
        closeSync(fd);
      } catch { continue; }
      this._offsets.set(f.path, f.size);
      for (const line of buf.toString("utf8").split("\n")) {
        const ev = mapProbeLine(line);
        if (ev) this.emit({ ...ev, payload: { ...ev.payload, file: basename(f.path) } });
      }
    }
  }
}
