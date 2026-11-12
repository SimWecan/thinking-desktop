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
import { spawn } from "node:child_process";
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
   * @param {(lines: string[], file: {path:string,size:number,mtimeMs:number}, lastMarker: string|null) => ({ type: string, payload?: object }|null)} [opts.onFirstSight]
   *        首次见到某个会话文件时调用（历史不回放）；DSH 用它补报「重启时回合还没结束」
   * @param {RegExp} [opts.firstSightMarker] 首次解码时顺带记住最后一条匹配的行（只扫一次，不增加常态开销）
   */
  constructor({
    source,
    dir,
    intervalMs = 2000,
    maxDepth = 4,
    activeWindowMs = 2 * 60 * 60_000,
    maxBurst = 40,
    summarize,
    onFirstSight = null,
    firstSightMarker = null,
  }) {
    super(source, "session");
    this.dir = dir;
    this.intervalMs = intervalMs;
    this.maxDepth = maxDepth;
    this.activeWindowMs = activeWindowMs;
    this.maxBurst = maxBurst;
    this.summarize = summarize ?? defaultSummarize;
    this.onFirstSight = onFirstSight;
    this.firstSightMarker = firstSightMarker;
    this._warned = false;
    /** @type {Map<string, {seen: number, size: number, mtimeMs: number}>} */
    this._states = new Map();
    this._timer = null;
    this._busy = false;
  }

  start() {
    if (!existsSync(this.dir)) {
      console.warn(`[${this.source}] dir not found: ${this.dir}`);
      return;
    }
    this._poll(); // 首次轮询只登记偏移量，不回放历史（解码是流式的，见 _decodeTail）
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

  /**
   * 流式解码，只保留最后 keepLines 行 + 总行数。
   * 会话文件会持续增长（DSH 单会话已到 10MB+），整段 spawnSync 每次轮询都要分配
   * 十几 MB 字符串，常驻内存会冲到 300MB；这里改成边读边丢，内存只跟 keepLines 有关。
   */
  _decodeTail(path, keepLines, markerRe = null) {
    return new Promise((resolve) => {
      let proc;
      try { proc = spawn("zstd", ["-q", "-d", "-c", path]); } catch (e) {
        resolve({ lines: [], total: 0, error: e });
        return;
      }
      const tail = [];
      let total = 0, buf = "", failed = false, stderr = "", lastMarker = null;
      const take = (line) => {
        total++;
        if (markerRe && markerRe.test(line)) lastMarker = line;
        tail.push(line);
        if (tail.length > keepLines) tail.shift();
      };
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          take(line);
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (d) => { stderr += d; });
      proc.on("error", (e) => { failed = true; resolve({ lines: [], total: 0, error: e }); });
      proc.on("close", (code) => {
        if (failed) return;
        if (buf.trim()) take(buf);
        resolve({ lines: tail, total, error: code === 0 ? null : new Error(stderr.trim() || `exit ${code}`), lastMarker });
      });
    });
  }

  async _poll() {
    if (this._busy) return;   // 解码未完成就跳过这一轮，避免堆积
    this._busy = true;
    try {
      const files = this._scan();
      const alive = new Set(files.map((f) => f.path));
      for (const p of this._states.keys()) if (!alive.has(p)) this._states.delete(p);

      for (const f of files) {
        const st = this._states.get(f.path);
        if (st && st.size === f.size && st.mtimeMs === f.mtimeMs) continue; // 未变化，免解码

        const isFirst = !st;
        const { lines, total, error, lastMarker } = await this._decodeTail(
          f.path, this.maxBurst * 4, isFirst ? this.firstSightMarker : null);
        if (error) {
          if (!this._warned) {
            this._warned = true;
            console.warn(`[${this.source}] zstd 解码失败（${error.message}），检查 zstd 是否已安装`);
          }
          continue;
        }
        if (!st) {
          // 首次见到：只登记偏移量，跳过历史内容（含服务重启前已存在的会话）。
          // onFirstSight 允许适配器从尾巴里恢复「进行中的回合」（服务重启时不至于丢状态）。
          this._states.set(f.path, { seen: total, size: f.size, mtimeMs: f.mtimeMs });
          if (this.onFirstSight) {
            try {
              const ev = this.onFirstSight(lines, f, lastMarker);
              if (ev) this.emit(ev);
            } catch { /* 恢复失败不影响正常轮询 */ }
          }
          continue;
        }
        st.size = f.size;
        st.mtimeMs = f.mtimeMs;
        if (total < st.seen) { st.seen = total; continue; }          // 文件被重写/回滚
        const skip = Math.max(0, st.seen - (total - lines.length));   // 尾巴里的偏移
        const fresh = lines.slice(skip);
        st.seen = total;
        for (const line of fresh.slice(-this.maxBurst)) {
          let obj = null;
          try { obj = JSON.parse(line); } catch { /* 半行/坏行 */ }
          let summary = null;
          try { summary = this.summarize(obj, line); } catch { summary = null; }
          if (Array.isArray(summary)) { for (const s of summary) if (s) this.emit(s); }
          else if (summary) this.emit(summary);
        }
      }
    } finally {
      this._busy = false;
    }
  }
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
