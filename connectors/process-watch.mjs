/**
 * 进程守护连接器：定期检查某个 AI 桌面端是否在运行，状态变化即上报。
 * 适用于活动数据不落盘（或落盘为二进制库）的桌面应用，如 Gemini / ChatGPT 桌面版。
 */

import { Connector } from "./base.mjs";
import { getProcesses, hasProcess } from "./ps-sample.mjs";

export class ProcessWatchConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source       来源标识
   * @param {string} opts.processName  pgrep 匹配名（如 "Gemini"）
   * @param {number} [opts.intervalMs] 默认 3000
   */
  constructor({ source, processName, intervalMs = 3000 }) {
    super(source, "process");
    this.processName = processName;
    this.intervalMs = intervalMs;
    this._running = null; // null=未知
  }

  start() {
    setInterval(() => this._check(), this.intervalMs);
    this._check();
    console.log(`[${this.source}] watching process "${this.processName}"`);
  }

  _check() {
    // 复用共享进程快照：进程名取 comm 的 basename（等价于 pgrep -x），不再单独 spawn
    const list = getProcesses();
    const running = hasProcess(list, this.processName);
    try {
      if (this._running === null) {
        this._running = running;
        this.emit({ type: "status", payload: { running, note: "initial" } });
        return;
      }
      if (running !== this._running) {
        this._running = running;
        this.emit({
          type: "status",
          payload: { running, note: running ? "app launched" : "app quit" },
        });
      }
    } catch { /* 忽略瞬时错误 */ }
  }
}
