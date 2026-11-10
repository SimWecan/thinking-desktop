/**
 * Zstd 压缩 JSONL 轮询连接器：面向 DeepSeek Harness (~/.dsh/sessions) 这类
 * 会话以 zstd 多帧追加写入的软件。
 *
 * 关键点：
 * - 会话文件位于 `dir/<workspace>/session-<id>/session.v4.jsonl.zstd`（多层目录），
 *   递归扫描而不是只看一层；
 * - 同时跟踪窗口期内**所有**活跃会话，不止最新一个（多个工作区可并行思考）；
 * - 按文件维护已消费行数，只用 size/mtime 变化触发解码，避免空转与重复上报；
 * - 服务启动时不回放历史内容，只消费之后新追加的行。
 *
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
   * @param {string} opts.dir      会话根目录（递归查找 *.jsonl.zstd）
   * @param {number} [opts.intervalMs] 默认 2000
   * @param {number} [opts.maxDepth] 递归深度上限，默认 4
   * @param {number} [opts.activeWindowMs] 只看这么久之内写过的会话，默认 2 小时
   * @param {number} [opts.maxBurst] 单次轮询单文件最多上报的行数，默认 40
   * @param {(obj: any, raw: string) => ({ type: string, payload?: object }|null)} [opts.summarize]
   */
  constructor({
    source,
    dir,
    intervalMs = 2000,
    maxDepth = 4,
    activeWindowMs = 2 * 60 * 60_000,
    maxBurst = 40,
    summarize,
  }) {
    super(source, "session");
    this.dir = dir;
    this.intervalMs = intervalMs;
    this.maxDepth = maxDepth;
    this.activeWindowMs = activeWindowMs;
    this.maxBurst = maxBurst;
    this.summarize = summarize ?? defaultSummarize;
    this._warned = false;
    /** @type {Map<string, {seen: number, size: number, mtimeMs: number}>} */
    this._states = new Map();
    this._timer = null;
  }

  start() {
    if (!existsSync(this.dir)) {
      console.warn(`[${this.source}] dir not found: ${this.dir}`);
      return;
    }
    this._poll(); // 首次轮询只登记偏移量，不回放历史
    this._timer = setInterval(() => this._poll(), this.intervalMs);
    this._timer.unref?.();
    console.log(`[${this.source}] watching ${this.dir} (depth≤${this.maxDepth})`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** 递归扫描窗口期内有写入的会话文件（按 mtime 升序） */
  _scan() {
    const out = [];
    const now = Date.now();
    const walk = (d, depth) => {
      if (depth > this.maxDepth) return;
      let names;
      try { names = readdirSync(d); } catch { return; }
      for (const n of names) {
        const p = join(d, n);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) { walk(p, depth + 1); continue; }
        if (!n.endsWith(".jsonl.zstd") || st.size === 0) continue;
        if (now - st.mtimeMs > this.activeWindowMs) continue;
        out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
      }
    };
    walk(this.dir, 0);
    return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  _decode(path) {
    const { status, stdout, error, stderr } = spawnSyncZstd(path);
    if (status !== 0) {
      if (!this._warned) {
        this._warned = true;
        const why = error?.message || String(stderr ?? "").trim() || `exit ${status}`;
        console.warn(`[${this.source}] zstd 解码失败（${why}），检查 zstd 是否已安装`);
      }
      return [];
    }
    return stdoutLines(stdout);
  }

  _poll() {
    const files = this._scan();
    const alive = new Set(files.map((f) => f.path));
    for (const p of this._states.keys()) if (!alive.has(p)) this._states.delete(p);

    for (const f of files) {
      const st = this._states.get(f.path);
      if (!st) {
        // 首次见到：只登记，跳过历史内容（含服务重启前已存在的会话）
        this._states.set(f.path, { seen: this._decode(f.path).length, size: f.size, mtimeMs: f.mtimeMs });
        continue;
      }
      if (st.size === f.size && st.mtimeMs === f.mtimeMs) continue; // 未变化，免解码
      const lines = this._decode(f.path);
      st.size = f.size;
      st.mtimeMs = f.mtimeMs;
      if (lines.length < st.seen) { st.seen = lines.length; continue; } // 文件被重写/回滚
      const fresh = lines.slice(st.seen);
      st.seen = lines.length;
      for (const line of fresh.slice(-this.maxBurst)) {
        let obj = null;
        try { obj = JSON.parse(line); } catch { /* 半行/坏行 */ }
        let summary = null;
        try { summary = this.summarize(obj, line); } catch { summary = null; }
        if (Array.isArray(summary)) { for (const s of summary) if (s) this.emit(s); }
        else if (summary) this.emit(summary);
      }
    }
  }
}

function spawnSyncZstd(path) {
  // 限制单次解码体积，避免超大会话把内存打满；encoding 必须给，否则拿到 Buffer 无法按行切分
  return spawnSync("zstd", ["-q", "-d", "-c", path], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
}

const stdoutLines = (s) => String(s ?? "").split("\n").filter(Boolean);

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
