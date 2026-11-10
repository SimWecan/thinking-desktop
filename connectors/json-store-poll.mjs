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
   */
  constructor({ source, path, summarize, intervalMs = 2000 }) {
    super(source);
    this.path = path;
    this.summarize = summarize;
    this.intervalMs = intervalMs;
    this._sig = null;
  }

  start() {
    if (!existsSync(this.path)) {
      console.warn(`[${this.source}] file not found: ${this.path}`);
      return;
    }
    this._sig = this._signature();
    setInterval(() => this._poll(), this.intervalMs);
    console.log(`[${this.source}] watching ${this.path}`);
  }

  _signature() {
    const s = statSync(this.path);
    return `${s.mtimeMs}:${s.size}`;
  }

  _poll() {
    let sig;
    try { sig = this._signature(); } catch { return; }
    if (sig === this._sig) return;
    this._sig = sig;

    let json;
    try { json = JSON.parse(readFileSync(this.path, "utf8")); } catch { return; }

    let summary;
    try { summary = this.summarize(json); } catch { return; }
    if (summary) this.emit(summary);
  }
}
