/**
 * 进程活动度连接器：给「不落盘文本日志」的闭源 AI 桌面端（Gemini / ChatGPT …）
 * 一条**真实**的工作信号——按该 App 所有进程的 CPU 占用推断它是否在思考/输出。
 *
 * 为什么需要它：这些 App 的对话内容只存在服务端 + WKWebView 内存里，本地既没有
 * 文本日志也没有会话文件，进程守护只能报告「启动/退出」，壁纸对它们等于没反应。
 * 这里用 ps 的 CPU 采样做真实活动检测：空闲时静默，一有生成/渲染就上报事件。
 *
 * 局限（如实记录）：拿不到文本，所以壁纸对闭源端只体现「强度」，环带显示预设动画。
 * 采样依赖 /bin/ps；沙箱或权限受限时只告警一次，不影响其它连接器。
 */

import { Connector } from "./base.mjs";
import { getProcesses, sumByMatch } from "./ps-sample.mjs";


export class ProcessActivityConnector extends Connector {
  /**
   * @param {object} opts
   * @param {string} opts.source        来源标识（与 process-watch 用同一个，便于聚合）
   * @param {string} opts.match         进程路径匹配串，如 "/Gemini.app/"
   * @param {number} [opts.intervalMs]  采样间隔，默认 2000
   * @param {number} [opts.cpuThreshold] 绝对门槛：合计 CPU 超过它才算「工作中」，默认 14
   * @param {number} [opts.minEmitMs]   工作期间事件最小间隔，默认 2500
   * @param {number} [opts.holdSamples] 连续几个采样超门槛才判定开始工作，默认 2
   * @param {number} [opts.exitSamples] 连续几个采样跌破滞后门槛才判定收工，默认 3
   */
  constructor({ source, match, intervalMs = 2000, cpuThreshold = 14, minEmitMs = 2500, holdSamples = 2, exitSamples = 3 }) {
    super(source, "activity");
    this.match = match;
    this.intervalMs = intervalMs;
    this.cpuThreshold = cpuThreshold;
    this.minEmitMs = minEmitMs;
    this.holdSamples = holdSamples;
    this.exitSamples = exitSamples;
    this._base = 0;       // 空闲基线（EMA）
    this._above = 0;
    this._below = 0;
    this._timer = null;
    this._warned = false;
    this._hot = false;
    this._lastEmit = 0;
    this._lastHotAt = 0;
    /** 最近一次采样结果，/health 用来自检 */
    this.last = { cpu: 0, procs: 0, at: 0, hot: false };
  }

  start() {
    this._sample();
    this._timer = setInterval(() => this._sample(), this.intervalMs);
    this._timer.unref?.();
    console.log(`[${this.source}] watching activity "${this.match}" (cpu ≥ ${this.cpuThreshold}%)`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _sample() {
    const snap = sampleProcesses(this.match);
    if (!snap) {
      if (!this._warned) {
        this._warned = true;
        console.warn(`[${this.source}] 无法执行 /bin/ps，活动度检测不可用`);
      }
      return;
    }
    const now = Date.now();
    const cpu = snap.cpu;
    // 空闲基线：只在非工作状态缓慢跟随，用来识别「这台机器上这个 App 的常态 CPU」
    if (!this._hot) this._base = this._base * 0.9 + cpu * 0.1;
    // 带滞后：进入要高门槛（且连续 N 次），退出要明显回落
    const enter = Math.max(this.cpuThreshold, this._base + 8);
    const exit = Math.max(this.cpuThreshold * 0.5, this._base + 4);

    if (!this._hot) {
      this._above = cpu >= enter ? this._above + 1 : 0;
      if (this._above >= this.holdSamples) { this._hot = true; this._above = 0; this._below = 0; }
    } else {
      this._below = cpu < exit ? this._below + 1 : 0;
      if (this._below >= this.exitSamples) { this._hot = false; this._below = 0; }
    }
    this.last = { cpu: +cpu.toFixed(1), procs: snap.procs, at: now, hot: this._hot, base: +this._base.toFixed(1) };

    if (this._hot) {
      this._lastHotAt = now;
      if (now - this._lastEmit >= this.minEmitMs) {
        this._lastEmit = now;
        this.emit({ type: "thought", payload: { cpu: +cpu.toFixed(1), procs: snap.procs } });
      }
    }
  }
}

/**
 * 解析 `ps -A -o pid=,pcpu=,comm=` 输出，汇总匹配进程的 CPU。
 * 独立导出便于单测（不依赖真实进程表）。
 * @param {string} stdout
 * @param {string|RegExp} match
 * @returns {{cpu: number, procs: number}}
 */
export function parsePsCpu(stdout, match) {
  const re = match instanceof RegExp ? match : null;
  let cpu = 0, procs = 0;
  for (const line of String(stdout ?? "").split("\n")) {
    const m = line.match(/^\s*(\d+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    const comm = m[3];
    if (re ? !re.test(comm) : !comm.includes(match)) continue;
    const v = Number.parseFloat(m[2]);
    if (!Number.isFinite(v)) continue;
    cpu += v;
    procs += 1;
  }
  return { cpu, procs };
}

/** @returns {{cpu: number, procs: number}|null} ps 不可用时返回 null（复用共享快照） */
export function sampleProcesses(match) {
  const list = getProcesses();
  return list ? sumByMatch(list, match) : null;
}
