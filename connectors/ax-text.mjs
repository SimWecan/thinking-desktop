/**
 * AX 读屏连接器：给「不落盘任何文本日志」的闭源桌面端（Gemini / ChatGPT）补真实文本。
 *
 * 依赖 macos/axread.swift 编译出的 bin/axread（install.sh 会自动编译），
 * 并且需要在「系统设置 → 隐私与安全性 → 辅助功能」里授权该二进制。
 * 未授权时安静降级：只告警一次，不影响其它连接器。
 */

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Connector } from "./base.mjs";

export class AxTextConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source    来源标识（与其它 connector 聚合）
   * @param {string} opts.bundleId  App 的 bundle id
   * @param {string} opts.bin       axread 可执行文件路径
   * @param {number} [opts.intervalMs] 轮询间隔，默认 2000
   * @param {number} [opts.minDelta] 新增文本至少多少字才上报，默认 8
   */
  constructor({ source, bundleId, bin, intervalMs = 2000, minDelta = 8 }) {
    super(source, "activity");
    this.bundleId = bundleId;
    this.bin = bin;
    this.intervalMs = intervalMs;
    this.minDelta = minDelta;
    this._last = "";
    this._warned = false;
    this._timer = null;
  }

  start() {
    if (!existsSync(this.bin)) {
      console.log(`[${this.source}] 未找到 bin/axread，跳过 AX 读屏（macos/build-axread.sh 可编译）`);
      return;
    }
    this._poll();
    this._timer = setInterval(() => this._poll(), this.intervalMs);
    this._timer.unref?.();
    console.log(`[${this.source}] AX 读屏 ${this.bundleId}（需辅助功能授权）`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _poll() {
    let out = "";
    try {
      out = execFileSync(this.bin, [this.bundleId], { encoding: "utf8", timeout: 4000, maxBuffer: 2 * 1024 * 1024 });
    } catch {
      return; // 工具执行失败（被系统拒绝等）→ 本轮跳过
    }
    let data;
    try { data = JSON.parse(out); } catch { return; }
    if (!data.trusted) {
      if (!this._warned) {
        this._warned = true;
        console.warn(`[${this.source}] 未获得辅助功能授权，AX 读屏不可用（系统设置 → 隐私与安全性 → 辅助功能 → 添加 bin/axread）`);
      }
      return;
    }
    const text = String(data.apps?.[this.bundleId] || "");
    if (!text) return;

    let delta = "";
    if (this._last && text.startsWith(this._last)) delta = text.slice(this._last.length);
    else if (text !== this._last) delta = text.slice(-300);   // 窗口/会话切换：只取末尾一段
    this._last = text;

    const clean = delta.replace(/\s+/g, " ").trim();
    if (clean.length < this.minDelta) return;
    this.emit({ type: "text", payload: { text: clean.slice(0, 1200), kind: "ax" } });
  }
}
