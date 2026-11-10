/**
 * JSON 存储轮询连接器：轮询 macOS 应用支持目录下的 JSON 状态文件，
 * 内容变化即上报事件。适用于 Kimi 桌面端 (kimi-agent) 等以 JSON store 落盘的应用。
 */

import { statSync, existsSync, readFileSync } from "node:fs";
import { Connector } from "./base.mjs";

export class JsonStorePollConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source   来源标识
   * @param {string} opts.path     JSON 文件路径
   * @param {(json: any) => ({ type: string, payload?: object })|null} opts.summarize
   *   解析后的 JSON → 事件；返回 null 表示本次变化忽略（如只有时间戳跳动）
   * @param {number} [opts.intervalMs] 默认 2000
   * @param {boolean} [opts.contentBased] 用内容而非 mtime 判断变化（小文件适用，
   *   避免应用重写相同内容时误报活动）
   */
  constructor({ source, path, summarize, intervalMs = 2000, contentBased = false }) {
    super(source, "json");
    this.path = path;
    this.summarize = summarize;
    this.intervalMs = intervalMs;
    this.contentBased = contentBased;
    this._sig = null;
  }

  start() {
    if (!existsSync(this.path)) {
      console.warn(`[${this.source}] file not found: ${this.path}`);
      return;
    }
    if (!this.contentBased) this._sig = this._signature();
    setInterval(() => this._poll(), this.intervalMs);
    console.log(`[${this.source}] watching ${this.path}`);
  }

  _signature() {
    const s = statSync(this.path);
    return `${s.mtimeMs}:${s.size}`;
  }

  _poll() {
    if (!this.contentBased) {
      let sig;
      try { sig = this._signature(); } catch { return; }
      if (sig === this._sig) return;
      this._sig = sig;
    }

    let json;
    try { json = JSON.parse(readFileSync(this.path, "utf8")); } catch { return; }

    if (this.contentBased) {
      const sig = JSON.stringify(json);
      if (sig === this._sig) return; // 内容没变：应用重写相同文件不算活动
      this._sig = sig;
    }

    let summary;
    try { summary = this.summarize(json); } catch { return; }
    if (summary) this.emit(summary);
  }
}
